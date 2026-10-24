'use strict';
// Backups of the local database: automatic (daily), manual, and a safety copy before every restore and update.
// Files are gzip-compressed (the data is mostly text, so they are several times smaller) and written by a worker thread.
// Optional second copy to a chosen folder (USB or external drive). Optional encryption (AES-256-GCM) with a key kept
// by Windows for this user (Electron safeStorage); an encrypted backup can only be restored on this computer and
// Windows account, so the cloud copy remains the way to rebuild a computer that is lost.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nowIso } = require('./core/ids');
const { AppError } = require('./core/errors');
const { t } = require('./core/messages');
const log = require('./core/log');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { makeBackupFile, MAGIC2 } = require('./backup-copy');

const MAGIC = Buffer.from('MEDIBK1'); // older encrypted backups (whole file, not compressed)
const GZIP = Buffer.from([0x1f, 0x8b]);
const SQLITE = Buffer.from('SQLite format 3');
const KEEP_AUTO = 14;
const KEEP_OTHER = 20;

function settings(app) {
  try { return { external: '', encrypt: false, ...JSON.parse(app.localGet('backup_settings') || '{}') }; } catch (_) { return { external: '', encrypt: false }; }
}

function saveSettings(app, next) {
  app.localSet('backup_settings', JSON.stringify(next));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function encrypt(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(buffer, key) {
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an encrypted backup');
  const iv = buffer.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buffer.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(MAGIC.length + 28)), decipher.final()]);
}

function record(app, row) {
  app.db.prepare('INSERT INTO backups (at, kind, file, size, encrypted, copied_to, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), row.kind, row.file, row.size || null, row.encrypted ? 1 : 0, row.copiedTo || null, row.status, row.message || null);
}

function rotate(app) {
  for (const [kinds, keep] of [[['auto'], KEEP_AUTO], [['manual', 'safety'], KEEP_OTHER]]) {
    const rows = app.db.prepare(`SELECT * FROM backups WHERE status = 'ok' AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY id DESC`).all(...kinds);
    for (const r of rows.slice(keep)) {
      try { fs.rmSync(r.file, { force: true }); } catch (_) { /* gone already */ }
      app.db.prepare("UPDATE backups SET status = 'error', message = 'Removed (older than the ones kept)' WHERE id = ?").run(r.id);
    }
  }
}

// Runs the copy in a worker thread; if a worker cannot start (for example inside a packaged app), here instead.
function writeBackupFile(job) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      const { Worker } = require('worker_threads');
      worker = new Worker(path.join(__dirname, 'backup-worker.js'), { workerData: job });
    } catch (_) {
      makeBackupFile(job).then(resolve, reject);
      return;
    }
    let done = false;
    worker.once('message', (m) => { done = true; if (m.ok) resolve(m.size); else reject(new Error(m.error)); });
    worker.once('error', (err) => {
      if (done) return;
      done = true;
      log.info(`Backup worker could not run (${err && err.message}); copying on the main thread`);
      makeBackupFile(job).then(resolve, reject);
    });
  });
}

let running = null;

// Makes a consistent, compressed copy (encrypted if asked) and copies it to the external folder if set.
// One backup at a time: a second request waits for the one in progress.
async function create(app, kind = 'manual') {
  while (running) { try { await running; } catch (_) { /* the next one runs anyway */ } }
  running = createNow(app, kind);
  try { return await running; } finally { running = null; }
}

async function createNow(app, kind) {
  const s = settings(app);
  fs.mkdirSync(app.backupDir, { recursive: true });
  const base = path.join(app.backupDir, `mediescare-${kind}-${stamp()}.db`);
  const file = s.encrypt ? `${base}.gz.enc` : `${base}.gz`;
  try {
    const key = s.encrypt ? app.backupKey() : null;
    const size = await writeBackupFile({ dbFile: app.dbFile, tmp: `${base}.tmp`, out: file, key });
    let copiedTo = null;
    let message = null;
    if (s.external) {
      try {
        fs.mkdirSync(s.external, { recursive: true });
        copiedTo = path.join(s.external, path.basename(file));
        await fs.promises.copyFile(file, copiedTo);
      } catch (err) {
        message = `Saved here, but the copy to ${s.external} failed (is the drive connected?)`;
        copiedTo = null;
      }
    }
    record(app, { kind, file, size, encrypted: s.encrypt, copiedTo, status: 'ok', message });
    rotate(app);
    return { file, size, copiedTo, encrypted: s.encrypt, message };
  } catch (err) {
    log.error('Backup failed', err && err.stack);
    for (const f of [file, `${base}.tmp`]) fs.rmSync(f, { force: true });
    record(app, { kind, file, status: 'error', message: 'The backup could not be written. Check free disk space.' });
    throw new AppError('BACKUP_FAILED', t('backup.failed'));
  }
}

// Daily automatic backup: once a day, the first time the app checks after the last one is 24 hours old.
async function autoIfDue(app) {
  const last = app.db.prepare("SELECT at FROM backups WHERE kind = 'auto' AND status = 'ok' ORDER BY id DESC LIMIT 1").get();
  if (last && Date.now() - Date.parse(last.at) < 24 * 3600 * 1000) return null;
  return create(app, 'auto');
}

// Checks a backup file (unpacking and decrypting it if needed) and returns the path of a plain copy ready to put in
// place. Reads plain databases, gzip files, and both encrypted formats (MEDIBK1 older, MEDIBK2 compressed).
async function prepareRestore(app, file) {
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', t('backup.missing'));
  const head = Buffer.alloc(32);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 32, 0);
  fs.closeSync(fd);
  let plain = file;
  const out = path.join(app.backupDir, `restore-${stamp()}.db`);
  fs.mkdirSync(app.backupDir, { recursive: true });
  const keyOrFail = () => { try { return app.backupKey(); } catch (_) { throw new AppError('BACKUP_KEY', t('backup.keyMissing')); } };
  if (head.subarray(0, MAGIC.length).equals(MAGIC)) {
    const key = keyOrFail();
    try { fs.writeFileSync(out, decrypt(fs.readFileSync(file), key)); } catch (_) { fs.rmSync(out, { force: true }); throw new AppError('BACKUP_KEY', t('backup.keyMissing')); }
    plain = out;
  } else if (head.subarray(0, MAGIC2.length).equals(MAGIC2)) {
    const key = keyOrFail();
    const size = fs.statSync(file).size;
    const iv = head.subarray(MAGIC2.length, MAGIC2.length + 12);
    const tag = Buffer.alloc(16);
    const fd2 = fs.openSync(file, 'r');
    fs.readSync(fd2, tag, 0, 16, size - 16);
    fs.closeSync(fd2);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      await pipeline(fs.createReadStream(file, { start: MAGIC2.length + 12, end: size - 17 }), decipher, zlib.createGunzip(), fs.createWriteStream(out));
    } catch (_) { fs.rmSync(out, { force: true }); throw new AppError('BACKUP_KEY', t('backup.keyMissing')); }
    plain = out;
  } else if (head.subarray(0, 2).equals(GZIP)) {
    try { await pipeline(fs.createReadStream(file), zlib.createGunzip(), fs.createWriteStream(out)); } catch (_) { fs.rmSync(out, { force: true }); throw new AppError('BAD_BACKUP', t('backup.notOurs')); }
    plain = out;
  } else if (!head.subarray(0, SQLITE.length).equals(SQLITE)) {
    throw new AppError('BAD_BACKUP', t('backup.notOurs'));
  }
  // Must be a Mediescare database of the same organisation.
  const Database = require('better-sqlite3');
  let ok = false;
  try {
    const other = new Database(plain, { readonly: true, fileMustExist: true });
    const org = other.prepare("SELECT id FROM org LIMIT 1").get();
    const mine = app.db.prepare('SELECT id FROM org LIMIT 1').get();
    ok = !!org && (!mine || org.id === mine.id) && !!other.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get();
    other.close();
  } catch (_) { ok = false; }
  if (!ok) { if (plain !== file) fs.rmSync(plain, { force: true }); throw new AppError('BAD_BACKUP', t('backup.notOurs')); }
  return plain;
}

// Restores: takes a safety copy first, then puts the backup in place and reopens the database.
// The caller (main process) restarts the app afterwards so every screen starts clean.
async function restore(app, file) {
  const plain = await prepareRestore(app, file);
  const safety = await create(app, 'safety');
  app.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(app.dbFile + ext, { force: true });
  fs.copyFileSync(plain, app.dbFile);
  if (plain !== file) fs.rmSync(plain, { force: true });
  app.sessions.clear();
  app.start();
  record(app, { kind: 'safety', file: safety.file, size: safety.size, status: 'ok', message: `Safety copy taken before restoring ${path.basename(file)}` });
  return { restored: true, safetyCopy: safety.file };
}

function list(app) {
  return app.db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 200').all().map((b) => ({
    id: b.id, at: b.at, kind: b.kind, file: b.file, name: path.basename(b.file), size: b.size, encrypted: b.encrypted === 1, copiedTo: b.copied_to, status: b.status, message: b.message,
    exists: b.status === 'ok' && fs.existsSync(b.file),
  }));
}

module.exports = { create, autoIfDue, restore, list, settings, saveSettings, encrypt, decrypt, prepareRestore };

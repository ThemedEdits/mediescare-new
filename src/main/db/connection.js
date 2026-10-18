'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrations = require('./migrations');
const { rebuildTriggers } = require('./triggers');
const log = require('../core/log');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL'); // a sale must survive a power cut right after it is saved
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function currentVersion(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row.v || 0;
}

// Safety copy taken before any schema change. VACUUM INTO writes a consistent snapshot.
function safetyBackup(db, file, fromVersion, backupDir) {
  const hasData = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'org'").get().n > 0;
  if (!hasData) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `pre-migration-v${fromVersion}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  log.info('Safety backup before migration', target);
  return target;
}

function migrate(db, { file, backupDir } = {}) {
  const from = currentVersion(db);
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  let backup = null;
  if (pending.length && file && backupDir) backup = safetyBackup(db, file, from, backupDir);
  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    })();
    log.info('Applied migration', m.version, m.name);
  }
  db.transaction(() => rebuildTriggers(db))();
  return { from, to: currentVersion(db), applied: pending.map((m) => m.version), backup };
}

module.exports = { open, migrate, currentVersion };

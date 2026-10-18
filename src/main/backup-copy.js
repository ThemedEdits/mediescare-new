'use strict';
// Writes one backup file: VACUUM INTO a consistent copy, then gzip it (and encrypt it when a key is given) as a stream,
// never holding the database in memory. Used by backup-worker.js (off the main thread) and directly as a fallback.
// Encrypted format: "MEDIBK2" + 12-byte IV + AES-256-GCM(gzip(database)) + 16-byte tag. Plain format: gzip.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const MAGIC2 = Buffer.from('MEDIBK2');

async function makeBackupFile({ dbFile, tmp, out, key }) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile, { fileMustExist: true, timeout: 10000 });
  try { db.prepare('VACUUM INTO ?').run(tmp); } finally { db.close(); }
  try {
    if (key) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
      fs.writeFileSync(out, Buffer.concat([MAGIC2, iv]));
      await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), cipher, fs.createWriteStream(out, { flags: 'a' }));
      fs.appendFileSync(out, cipher.getAuthTag());
    } else {
      await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(out));
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return fs.statSync(out).size;
}

module.exports = { makeBackupFile, MAGIC2 };

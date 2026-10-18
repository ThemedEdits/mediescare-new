'use strict';
// Document numbers that never collide between PCs working offline: PREFIX-<BRANCH><DEVICE>-<seq>, e.g. INV-LHR2-0001.
// The sequence lives in doc_sequences, which is local to this PC and never synced.

function next(db, prefix, branchCode, deviceNo) {
  const key = `${prefix}:${branchCode}:${deviceNo}`;
  db.prepare('INSERT INTO doc_sequences (key, next) VALUES (?, 1) ON CONFLICT(key) DO NOTHING').run(key);
  const row = db.prepare('UPDATE doc_sequences SET next = next + 1 WHERE key = ? RETURNING next - 1 AS value').get(key);
  return `${prefix}-${branchCode}${deviceNo}-${String(row.value).padStart(4, '0')}`;
}

module.exports = { next };

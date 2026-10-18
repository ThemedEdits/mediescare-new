'use strict';
// Reading the operation log for a peer, cursors (how far each peer has been sent / received), and the sync log.
const { nowIso } = require('../core/ids');

const WIRE = 'seq, op_id, tbl, row_id, kind, branch_id, branch_id2, data, updated_at, origin_device, created_at';

// Operations after `after` that this peer may see. A branch computer sees its branch and shared rows; Head Office sees all.
function readOps(db, { after = 0, limit = 500, branchId = null, allBranches = true, excludeSource = null }) {
  const where = ['seq > @after'];
  if (!allBranches) where.push('(branch_id IS NULL OR branch_id = @branch OR branch_id2 = @branch)');
  if (excludeSource) where.push('(source IS NULL OR source <> @source)');
  return db.prepare(`SELECT ${WIRE} FROM sync_ops WHERE ${where.join(' AND ')} ORDER BY seq LIMIT @limit`)
    .all({ after, limit, branch: branchId, source: excludeSource });
}

function lastSeq(db) {
  return db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM sync_ops').get().s;
}

function getCursor(db, peer, direction) {
  const row = db.prepare('SELECT value FROM sync_cursors WHERE peer = ? AND direction = ?').get(peer, direction);
  return row ? row.value : 0;
}

function setCursor(db, peer, direction, value) {
  db.prepare(`INSERT INTO sync_cursors (peer, direction, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (peer, direction) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(peer, direction, value, nowIso());
}

// How many operations are waiting to be sent to this peer.
function pending(db, peer, { excludeSource = null } = {}) {
  const after = getCursor(db, peer, 'push');
  return db.prepare(`SELECT COUNT(*) AS n FROM sync_ops WHERE seq > ? ${excludeSource ? 'AND (source IS NULL OR source <> ?)' : ''}`)
    .get(...[after, excludeSource].filter((x) => x !== null)).n;
}

function logSync(db, { channel, direction, status, pushed = 0, pulled = 0, message = null }) {
  db.prepare('INSERT INTO sync_log (at, channel, direction, status, pushed, pulled, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), channel, direction, status, pushed, pulled, message);
  // Keep the log readable: the last 5,000 entries.
  db.prepare('DELETE FROM sync_log WHERE id < (SELECT MAX(id) - 5000 FROM sync_log)').run();
}

module.exports = { readOps, lastSeq, getCursor, setCursor, pending, logSync, WIRE };

'use strict';
// Append-only audit log. Always called inside the same transaction as the change it records.
const { newId, nowIso } = require('./ids');

// Fields that must never be copied into the audit log.
const SECRET_FIELDS = new Set(['password_hash', 'password']);

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return JSON.stringify(value);
  const copy = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELDS.has(k)) continue;
    copy[k] = v;
  }
  return JSON.stringify(copy);
}

// Only the keys whose value changed, so the log shows exactly what was edited.
function diff(before, after) {
  const oldOut = {};
  const newOut = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (SECRET_FIELDS.has(key) || key === 'updated_at') continue;
    const a = before ? before[key] : undefined;
    const b = after ? after[key] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      oldOut[key] = a === undefined ? null : a;
      newOut[key] = b === undefined ? null : b;
    }
  }
  return { old: oldOut, new: newOut, changed: Object.keys(newOut).length > 0 };
}

function write(db, actor, entry) {
  const at = nowIso();
  db.prepare(`INSERT INTO audit_log (id, at, user_id, username, branch_id, device_id, module, action, record_type, record_id,
      summary, old_value, new_value, reason, updated_at)
    VALUES (@id, @at, @user_id, @username, @branch_id, @device_id, @module, @action, @record_type, @record_id,
      @summary, @old_value, @new_value, @reason, @at)`).run({
    id: newId(),
    at,
    user_id: actor && actor.userId ? actor.userId : null,
    username: actor && actor.username ? actor.username : null,
    branch_id: entry.branchId !== undefined ? entry.branchId : (actor && actor.branchId) || null,
    device_id: actor && actor.deviceId ? actor.deviceId : null,
    module: entry.module,
    action: entry.action,
    record_type: entry.recordType || null,
    record_id: entry.recordId || null,
    summary: entry.summary || null,
    old_value: clean(entry.old),
    new_value: clean(entry.new),
    reason: entry.reason || null,
  });
}

module.exports = { write, diff };

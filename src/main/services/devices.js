'use strict';
// Computers registered to the organisation; one-time join codes for a branch's new main computer; the organisation
// recovery key (the way back when the Head Office computer is lost). Codes and keys are shown once; only hashes are kept.
const { newId, nowIso } = require('../core/ids');
const joinCodes = require('../core/joincodes');
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const { seesAllBranches, assertBranchAccess } = require('./guards');

function shape(app, d) {
  return {
    id: d.id, name: d.name, kind: d.kind, deviceNo: d.device_no, branchId: d.branch_id, branchName: d.branch_name, branchCode: d.branch_code,
    revoked: !!d.revoked_at, revokedAt: d.revoked_at, lastSeenAt: d.last_seen_at, createdAt: d.created_at,
    isThisComputer: app.device && app.device.id === d.id,
  };
}

const SELECT = 'SELECT d.*, b.name AS branch_name, b.code AS branch_code FROM devices d JOIN branches b ON b.id = d.branch_id';
const JOIN_CODE_HOURS = 24;

function codeShape(c) {
  const now = nowIso();
  const status = c.used_at ? 'used' : c.cancelled_at ? 'cancelled' : c.expires_at < now ? 'expired' : 'active';
  return {
    id: c.id, branchId: c.branch_id, branchName: c.branch_name, hint: c.hint, status, createdBy: c.created_name, createdAt: c.created_at,
    expiresAt: c.expires_at, usedAt: c.used_at, usedBy: c.used_device_name, cancelledAt: c.cancelled_at,
  };
}

const CODE_SELECT = `SELECT j.*, b.name AS branch_name, u.full_name AS created_name, d.name AS used_device_name FROM join_codes j JOIN branches b ON b.id = j.branch_id
  LEFT JOIN users u ON u.id = j.created_by LEFT JOIN devices d ON d.id = j.used_device_id`;

// Starts a cloud sync now (without waiting) so a new join code reaches the cloud straight away.
function syncSoon(app) {
  try { if (app.sync && app.sync.cloudPeer && app.sync.cloudPeer()) app.sync.run('cloud').catch(() => {}); else if (app.sync && app.sync.lanPeer && app.sync.lanPeer()) app.sync.run('lan').catch(() => {}); } catch (_) { /* the normal timer sends it */ }
}

function register(define) {
  define('devices.list', { perm: 'devices.view' }, (ctx) => {
    const rows = seesAllBranches(ctx)
      ? ctx.db.prepare(`${SELECT} ORDER BY b.name, d.device_no`).all()
      : ctx.db.prepare(`${SELECT} WHERE d.branch_id = ? ORDER BY d.device_no`).all(ctx.branchId);
    return rows.map((d) => shape(ctx.app, d));
  });

  define('devices.rename', { perm: 'devices.edit' }, (ctx, params) => {
    const d = ctx.db.prepare(`${SELECT} WHERE d.id = ?`).get(v.id(params, 'id'));
    if (!d) fail('NOT_FOUND', 'error.notFound', { thing: 'computer' });
    assertBranchAccess(ctx, d.branch_id);
    const name = v.text(params, 'name', 'Computer name', { required: true, max: 60 });
    if (name === d.name) return shape(ctx.app, d);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE devices SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), d.id);
      audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'rename', recordType: 'device', recordId: d.id, branchId: d.branch_id, summary: `Computer renamed to ${name}`, old: { name: d.name }, new: { name } });
    })();
    if (ctx.app.device && ctx.app.device.id === d.id) ctx.app.loadDevice();
    return shape(ctx.app, ctx.db.prepare(`${SELECT} WHERE d.id = ?`).get(d.id));
  });

  define('devices.revoke', { perm: 'devices.edit' }, (ctx, params) => {
    const d = ctx.db.prepare(`${SELECT} WHERE d.id = ?`).get(v.id(params, 'id'));
    if (!d) fail('NOT_FOUND', 'error.notFound', { thing: 'computer' });
    assertBranchAccess(ctx, d.branch_id);
    if (ctx.app.device && ctx.app.device.id === d.id) fail('FORBIDDEN', 'error.readOnly');
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    if (d.revoked_at) return shape(ctx.app, d);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE devices SET revoked_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), d.id);
      audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'revoke', recordType: 'device', recordId: d.id, branchId: d.branch_id, summary: `Computer ${d.name} blocked from syncing`, reason });
    })();
    return shape(ctx.app, ctx.db.prepare(`${SELECT} WHERE d.id = ?`).get(d.id));
  });

  // ---- join codes ----
  define('devices.joinCodes', { perm: 'devices.edit' }, (ctx) => {
    const rows = seesAllBranches(ctx)
      ? ctx.db.prepare(`${CODE_SELECT} ORDER BY j.created_at DESC LIMIT 100`).all()
      : ctx.db.prepare(`${CODE_SELECT} WHERE j.branch_id = ? ORDER BY j.created_at DESC LIMIT 100`).all(ctx.branchId);
    return rows.map(codeShape);
  });

  define('devices.createJoinCode', { perm: 'devices.edit' }, (ctx, params) => {
    const branchId = v.id(params, 'branchId', 'Branch');
    assertBranchAccess(ctx, branchId);
    const branch = ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
    if (!branch) fail('NOT_FOUND', 'error.notFound', { thing: 'branch' });
    if (!branch.active) fail('VALIDATION', 'error.branchInactive');
    const code = joinCodes.generate(joinCodes.JOIN_LENGTH);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + JOIN_CODE_HOURS * 3600 * 1000).toISOString();
    const id = newId();
    ctx.db.transaction(() => {
      ctx.db.prepare(`INSERT INTO join_codes (id, branch_id, code_hash, hint, created_by, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, branchId, joinCodes.hash(code), `...${code.slice(-4)}`, ctx.userId, now.toISOString(), expiresAt, now.toISOString());
      audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'join_code', recordType: 'join_code', recordId: id, branchId, summary: `Join code made for a new main computer of ${branch.name} (ends ${code.slice(-4)}, valid ${JOIN_CODE_HOURS} hours)` });
    })();
    syncSoon(ctx.app);
    return { code, expiresAt, branchName: branch.name, orgCode: ctx.db.prepare('SELECT code FROM org LIMIT 1').get().code, cloudConnected: !!ctx.app.localGet('cloud_token') || !!ctx.app.localGet('lan_token') };
  });

  define('devices.cancelJoinCode', { perm: 'devices.edit' }, (ctx, params) => {
    const c = ctx.db.prepare(`${CODE_SELECT} WHERE j.id = ?`).get(v.id(params, 'id'));
    if (!c) fail('NOT_FOUND', 'error.notFound', { thing: 'join code' });
    assertBranchAccess(ctx, c.branch_id);
    if (c.used_at || c.cancelled_at) return codeShape(c);
    const now = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE join_codes SET cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ?').run(now, ctx.userId, now, c.id);
      audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'join_code_cancel', recordType: 'join_code', recordId: c.id, branchId: c.branch_id, summary: `Join code ${c.hint} for ${c.branch_name} cancelled` });
    })();
    syncSoon(ctx.app);
    return codeShape(ctx.db.prepare(`${CODE_SELECT} WHERE j.id = ?`).get(c.id));
  });

  // ---- organisation recovery key (owner only) ----
  define('org.recoveryInfo', { perm: 'devices.edit' }, (ctx) => {
    const o = ctx.db.prepare('SELECT recovery_hash, recovery_set_at FROM org LIMIT 1').get();
    return { set: !!o.recovery_hash, setAt: o.recovery_set_at, canChange: ctx.isSuper };
  });

  define('org.newRecoveryKey', { perm: 'devices.edit' }, (ctx) => {
    if (!ctx.isSuper) fail('FORBIDDEN', 'error.noPermission');
    const key = joinCodes.generate(joinCodes.RECOVERY_LENGTH);
    const now = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE org SET recovery_hash = ?, recovery_set_at = ?, updated_at = ?').run(joinCodes.hash(key), now, now);
      audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'recovery_key', recordType: 'org', summary: 'A new organisation recovery key was made (the old one no longer works)' });
    })();
    syncSoon(ctx.app);
    return { recoveryKey: key, setAt: now };
  });
}

module.exports = { register, codeShape };

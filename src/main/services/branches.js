'use strict';
// Branches: create (with the branch manager account), edit, deactivate, and switch the active branch.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const { seesAllBranches, assertBranchAccess, assertCanGrantRole } = require('./guards');
const { insertUser, readNewPassword, assertUsernameFree } = require('./users');
const { mePayload } = require('./auth');

function shape(b) {
  return {
    id: b.id, code: b.code, name: b.name, isHeadOffice: b.is_head_office === 1, address: b.address, phone: b.phone, email: b.email,
    licenceNo: b.licence_no, ntn: b.ntn, active: b.active === 1, userCount: b.user_count || 0, deviceCount: b.device_count || 0,
    createdAt: b.created_at, updatedAt: b.updated_at,
  };
}

const SELECT = `SELECT b.*,
    (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.status = 'active') AS user_count,
    (SELECT COUNT(*) FROM devices d WHERE d.branch_id = b.id AND d.revoked_at IS NULL) AS device_count
  FROM branches b`;

function load(db, id) {
  const b = db.prepare(`${SELECT} WHERE b.id = ?`).get(id);
  if (!b) fail('NOT_FOUND', 'error.notFound', { thing: 'branch' });
  return b;
}

function readDetails(params) {
  return {
    name: v.text(params, 'name', 'Branch name', { required: true, max: 120 }),
    address: v.text(params, 'address', 'Address', { max: 300 }),
    phone: v.text(params, 'phone', 'Phone', { max: 40 }),
    email: v.email(params, 'email'),
    licence_no: v.text(params, 'licenceNo', 'Drug sale licence number', { max: 60 }),
    ntn: v.text(params, 'ntn', 'NTN', { max: 40 }),
  };
}

async function create(ctx, params) {
  const code = v.code(params, 'code', 'Branch code');
  const details = readDetails(params);
  if (ctx.db.prepare('SELECT id FROM branches WHERE code = ? COLLATE NOCASE').get(code)) invalid('code', 'branches.codeTaken');

  // Every new branch gets its manager account at the same time.
  const admin = params.admin || {};
  const adminFullName = v.text(admin, 'fullName', 'Branch manager name', { required: true, max: 120 });
  const adminUsername = v.username(admin, 'username');
  assertUsernameFree(ctx.db, adminUsername);
  const role = admin.roleId
    ? ctx.db.prepare('SELECT * FROM roles WHERE id = ? AND active = 1').get(admin.roleId)
    : ctx.db.prepare("SELECT * FROM roles WHERE name = 'Branch Admin' COLLATE NOCASE AND active = 1").get();
  if (!role || role.is_super) invalid('admin.roleId', 'error.required', { field: 'Branch manager role' });
  assertCanGrantRole(ctx, role);
  const pw = await readNewPassword(ctx, admin);

  const id = newId();
  const now = nowIso();
  let userId;
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO branches (id, code, name, is_head_office, address, phone, email, licence_no, ntn, active, created_by, created_at, updated_at)
      VALUES (@id, @code, @name, 0, @address, @phone, @email, @licence_no, @ntn, 1, @by, @now, @now)`).run({ id, code, ...details, by: ctx.userId, now });
    audit.write(ctx.db, ctx.actor, { module: 'branches', action: 'create', recordType: 'branch', recordId: id, branchId: id, summary: `Branch ${details.name} (${code}) created`, new: { code, ...details } });
    userId = insertUser(ctx, { fullName: adminFullName, username: adminUsername, hash: pw.hash, roleId: role.id, branchId: id, phone: null, email: null });
    audit.write(ctx.db, ctx.actor, { module: 'users', action: 'create', recordType: 'user', recordId: userId, branchId: id, summary: `Branch manager ${adminUsername} (${role.name}) created for ${details.name}`, new: { username: adminUsername, full_name: adminFullName, role: role.name } });
  })();
  return { branch: shape(load(ctx.db, id)), admin: { id: userId, username: adminUsername, temporaryPassword: pw.plain } };
}

function update(ctx, params) {
  const b = load(ctx.db, v.id(params, 'id'));
  assertBranchAccess(ctx, b.id);
  const details = readDetails(params);
  const before = { name: b.name, address: b.address, phone: b.phone, email: b.email, licence_no: b.licence_no, ntn: b.ntn };
  const change = audit.diff(before, details);
  if (!change.changed) return shape(b);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE branches SET name = @name, address = @address, phone = @phone, email = @email, licence_no = @licence_no, ntn = @ntn, updated_at = @now WHERE id = @id')
      .run({ ...details, now: nowIso(), id: b.id });
    audit.write(ctx.db, ctx.actor, { module: 'branches', action: 'update', recordType: 'branch', recordId: b.id, branchId: b.id, summary: `Branch ${details.name} details changed`, old: change.old, new: change.new });
  })();
  return shape(load(ctx.db, b.id));
}

function setActive(ctx, params) {
  const b = load(ctx.db, v.id(params, 'id'));
  assertBranchAccess(ctx, b.id);
  const active = v.bool(params, 'active');
  if (b.is_head_office && !active) fail('FORBIDDEN', 'branches.headOfficeLocked');
  const reason = v.text(params, 'reason', 'Reason', { required: !active, max: 300 });
  if ((b.active === 1) === active) return shape(b);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE branches SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), b.id);
    audit.write(ctx.db, ctx.actor, { module: 'branches', action: active ? 'activate' : 'deactivate', recordType: 'branch', recordId: b.id, branchId: b.id, summary: `Branch ${b.name} ${active ? 're-activated' : 'deactivated'}`, old: { active: b.active === 1 }, new: { active }, reason });
  })();
  return shape(load(ctx.db, b.id));
}

function switchBranch(ctx, params) {
  const b = load(ctx.db, v.id(params, 'branchId', 'Branch'));
  if (!b.active) fail('BRANCH_INACTIVE', 'error.branchInactive');
  if (b.id === ctx.branchId) return mePayload(ctx);
  const from = ctx.branchId;
  ctx.session.branchId = b.id;
  ctx.db.transaction(() => {
    audit.write(ctx.db, { ...ctx.actor, branchId: b.id }, { module: 'branches', action: 'switch', recordType: 'branch', recordId: b.id, summary: `Switched active branch to ${b.name}`, old: { branch_id: from }, new: { branch_id: b.id } });
  })();
  const { buildContext } = require('../rpc');
  return mePayload(buildContext(ctx.app, ctx.clientKey));
}

function register(define) {
  // The branch picker needs the list for anyone allowed to switch, even without the Branches page.
  define('branches.list', { perm: ['branches.view', 'branch.switch', 'branches.view_all', 'users.view'] }, (ctx, params) => {
    const all = seesAllBranches(ctx) || ctx.can('branch.switch');
    const rows = all
      ? ctx.db.prepare(`${SELECT} ORDER BY b.is_head_office DESC, b.name`).all()
      : ctx.db.prepare(`${SELECT} WHERE b.id = ?`).all(ctx.branchId);
    return rows.filter((b) => params.includeInactive || b.active).map(shape);
  });
  define('branches.get', { perm: 'branches.view' }, (ctx, params) => {
    const b = load(ctx.db, v.id(params, 'id'));
    if (!ctx.can('branch.switch')) assertBranchAccess(ctx, b.id);
    return shape(b);
  });
  define('branches.create', { perm: 'branches.create' }, create);
  define('branches.update', { perm: 'branches.edit' }, update);
  define('branches.setActive', { perm: 'branches.delete' }, setActive);
  define('branches.switch', { perm: 'branch.switch' }, switchBranch);
}

module.exports = { register };

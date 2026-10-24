'use strict';
// Staff accounts and the signed-in user's own profile.
const { newId, nowIso } = require('../core/ids');
const { hashPassword, temporaryPassword } = require('../core/password');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const settings = require('./settings');
const { assertCanGrantRole, withinActor, seesAllBranches, assertBranchAccess } = require('./guards');
const { mePayload } = require('./auth');

const SELECT = `SELECT u.*, r.name AS role_name, r.is_super, r.permissions AS role_permissions, b.name AS branch_name, b.code AS branch_code,
    la.locked_until
  FROM users u JOIN roles r ON r.id = u.role_id JOIN branches b ON b.id = u.branch_id
  LEFT JOIN login_attempts la ON la.user_id = u.id`;

function shape(ctx, u) {
  const locked = !!(u.locked_until && Date.parse(u.locked_until) > Date.now());
  return {
    id: u.id, username: u.username, fullName: u.full_name, roleId: u.role_id, roleName: u.role_name, isSuper: u.is_super === 1,
    isOwner: u.is_owner === 1, branchId: u.branch_id, branchName: u.branch_name, branchCode: u.branch_code, status: u.status,
    phone: u.phone, email: u.email, mustChangePassword: u.must_change_password === 1, lastLoginAt: u.last_login_at,
    locked, lockedUntil: locked ? u.locked_until : null, createdAt: u.created_at, updatedAt: u.updated_at,
    canManage: canManageUser(ctx, u),
  };
}

// Editable fields only, for the audit diff.
function auditView(u) {
  return { username: u.username, full_name: u.full_name, role_id: u.role_id, branch_id: u.branch_id, phone: u.phone, email: u.email, status: u.status };
}

function canManageUser(ctx, u) {
  if (u.is_owner === 1) return ctx.user.is_owner === 1;
  if (!seesAllBranches(ctx) && u.branch_id !== ctx.branchId) return false;
  return withinActor(ctx, { is_super: u.is_super, permissions: u.role_permissions });
}

function load(db, id) {
  const u = db.prepare(`${SELECT} WHERE u.id = ?`).get(id);
  if (!u) fail('NOT_FOUND', 'error.notFound', { thing: 'user' });
  return u;
}

function assertManage(ctx, u) {
  if (u.is_owner === 1 && ctx.user.is_owner !== 1) fail('FORBIDDEN', 'users.cannotChangeOwner');
  if (!canManageUser(ctx, u)) fail('FORBIDDEN', 'error.noPermission');
}

function readRole(ctx, roleId) {
  const role = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId || '');
  if (!role || !role.active) invalid('roleId', 'error.required', { field: 'Role' });
  if (role.is_super) invalid('roleId', 'users.onlyOneSuper');
  assertCanGrantRole(ctx, role);
  return role;
}

function readBranch(ctx, branchId) {
  const branch = ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId || '');
  if (!branch) invalid('branchId', 'error.required', { field: 'Branch' });
  assertBranchAccess(ctx, branch.id);
  if (!branch.active) invalid('branchId', 'error.branchInactive');
  return branch;
}

function assertUsernameFree(db, username, exceptId) {
  const clash = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(username, exceptId || '');
  if (clash) invalid('username', 'error.duplicate', { thing: 'user', field: 'username' });
}

// Creates a user inside the caller's transaction. Used by users.create and branches.create.
function insertUser(ctx, { fullName, username, hash, roleId, branchId, phone, email }) {
  const id = newId();
  const now = nowIso();
  ctx.db.prepare(`INSERT INTO users (id, username, full_name, password_hash, must_change_password, role_id, branch_id, status, is_owner,
      phone, email, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, 'active', 0, ?, ?, ?, ?, ?)`).run(id, username, fullName, hash, roleId, branchId, phone, email, ctx.userId, now, now);
  return id;
}

async function readNewPassword(ctx, params) {
  const given = params.password ? String(params.password) : '';
  const min = settings.get(ctx.db, 'security.minPasswordLength', ctx.branchId);
  const plain = given ? v.password(params, 'password', min) : temporaryPassword();
  return { plain, hash: await hashPassword(plain), generated: !given };
}

async function create(ctx, params) {
  const fullName = v.text(params, 'fullName', 'Full name', { required: true, max: 120 });
  const username = v.username(params);
  const role = readRole(ctx, params.roleId);
  const branch = readBranch(ctx, params.branchId || ctx.branchId);
  const phone = v.text(params, 'phone', 'Phone', { max: 40 });
  const email = v.email(params, 'email');
  assertUsernameFree(ctx.db, username);
  const pw = await readNewPassword(ctx, params);
  let id;
  ctx.db.transaction(() => {
    id = insertUser(ctx, { fullName, username, hash: pw.hash, roleId: role.id, branchId: branch.id, phone, email });
    audit.write(ctx.db, ctx.actor, { module: 'users', action: 'create', recordType: 'user', recordId: id, branchId: branch.id, summary: `User ${username} (${role.name}) created for ${branch.name}`, new: { username, full_name: fullName, role: role.name, branch: branch.name, phone, email } });
  })();
  return { user: shape(ctx, load(ctx.db, id)), temporaryPassword: pw.plain };
}

function update(ctx, params) {
  const u = load(ctx.db, v.id(params, 'id'));
  assertManage(ctx, u);
  const fullName = v.text(params, 'fullName', 'Full name', { required: true, max: 120 });
  const username = v.username(params);
  const phone = v.text(params, 'phone', 'Phone', { max: 40 });
  const email = v.email(params, 'email');
  let roleId = u.role_id;
  let branchId = u.branch_id;
  if (u.is_owner !== 1) {
    if (params.roleId && params.roleId !== u.role_id) {
      if (u.id === ctx.userId) invalid('roleId', 'users.cannotChangeOwnRole');
      roleId = readRole(ctx, params.roleId).id;
    }
    if (params.branchId && params.branchId !== u.branch_id) branchId = readBranch(ctx, params.branchId).id;
  }
  assertUsernameFree(ctx.db, username, u.id);
  const after = { ...auditView(u), username, full_name: fullName, role_id: roleId, branch_id: branchId, phone, email };
  const change = audit.diff(auditView(u), after);
  if (!change.changed) return shape(ctx, u);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET username = ?, full_name = ?, role_id = ?, branch_id = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?')
      .run(username, fullName, roleId, branchId, phone, email, nowIso(), u.id);
    audit.write(ctx.db, ctx.actor, { module: 'users', action: 'update', recordType: 'user', recordId: u.id, branchId, summary: `User ${username} changed (${Object.keys(change.new).join(', ')})`, old: change.old, new: change.new, reason: v.text(params, 'reason', 'Reason', { max: 300 }) });
  })();
  return shape(ctx, load(ctx.db, u.id));
}

function setStatus(ctx, params) {
  const u = load(ctx.db, v.id(params, 'id'));
  const status = params.status === 'active' ? 'active' : 'disabled';
  if (u.id === ctx.userId) fail('FORBIDDEN', 'users.cannotDisableSelf');
  if (u.is_owner === 1) fail('FORBIDDEN', 'users.cannotChangeOwner');
  assertManage(ctx, u);
  const reason = v.text(params, 'reason', 'Reason', { required: status === 'disabled', max: 300 });
  if (u.status === status) return shape(ctx, u);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), u.id);
    audit.write(ctx.db, ctx.actor, { module: 'users', action: status === 'active' ? 'enable' : 'disable', recordType: 'user', recordId: u.id, branchId: u.branch_id, summary: `User ${u.username} ${status === 'active' ? 're-enabled' : 'disabled'}`, old: { status: u.status }, new: { status }, reason });
  })();
  // A disabled user is signed out everywhere on this PC at their next action (the router re-reads the user).
  return shape(ctx, load(ctx.db, u.id));
}

async function resetPassword(ctx, params) {
  const u = load(ctx.db, v.id(params, 'id'));
  assertManage(ctx, u);
  if (u.id === ctx.userId) fail('FORBIDDEN', 'error.noPermission'); // use the profile page for your own password
  const pw = await readNewPassword(ctx, params);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(pw.hash, nowIso(), u.id);
    ctx.db.prepare('DELETE FROM login_attempts WHERE user_id = ?').run(u.id);
    audit.write(ctx.db, ctx.actor, { module: 'users', action: 'reset_password', recordType: 'user', recordId: u.id, branchId: u.branch_id, summary: `Temporary password set for ${u.username}; they must change it at next sign-in` });
  })();
  return { user: shape(ctx, load(ctx.db, u.id)), temporaryPassword: pw.plain };
}

function unlock(ctx, params) {
  const u = load(ctx.db, v.id(params, 'id'));
  assertManage(ctx, u);
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM login_attempts WHERE user_id = ?').run(u.id);
    audit.write(ctx.db, ctx.actor, { module: 'users', action: 'unlock', recordType: 'user', recordId: u.id, branchId: u.branch_id, summary: `Account ${u.username} unlocked` });
  })();
  return shape(ctx, load(ctx.db, u.id));
}

function list(ctx, params) {
  const where = [];
  const args = {};
  if (!seesAllBranches(ctx)) { where.push('u.branch_id = @branch'); args.branch = ctx.branchId; }
  else if (params.branchId) { where.push('u.branch_id = @branch'); args.branch = params.branchId; }
  if (params.status === 'active' || params.status === 'disabled') { where.push('u.status = @status'); args.status = params.status; }
  if (params.roleId) { where.push('u.role_id = @role'); args.role = params.roleId; }
  if (params.search) {
    where.push("(u.username LIKE @q ESCAPE '\\' OR u.full_name LIKE @q ESCAPE '\\' OR u.phone LIKE @q ESCAPE '\\')");
    args.q = `%${String(params.search).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  }
  const rows = ctx.db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.is_owner DESC, u.full_name`).all(args);
  return rows.map((u) => shape(ctx, u));
}

function updateProfile(ctx, params) {
  const fullName = v.text(params, 'fullName', 'Full name', { required: true, max: 120 });
  const username = v.username(params);
  const phone = v.text(params, 'phone', 'Phone', { max: 40 });
  const email = v.email(params, 'email');
  assertUsernameFree(ctx.db, username, ctx.userId);
  const before = auditView(ctx.user);
  const change = audit.diff(before, { ...before, full_name: fullName, username, phone, email });
  if (change.changed) {
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE users SET full_name = ?, username = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?').run(fullName, username, phone, email, nowIso(), ctx.userId);
      audit.write(ctx.db, ctx.actor, { module: 'profile', action: 'update', recordType: 'user', recordId: ctx.userId, summary: 'Updated own profile', old: change.old, new: change.new });
    })();
  }
  return refreshedMe(ctx);
}

const PREF_RULES = {
  theme: ['light', 'dark', 'system'],
  language: ['en'],
  density: ['comfortable', 'compact'],
};

function setPrefs(ctx, params) {
  let prefs = {};
  try { prefs = JSON.parse(ctx.user.prefs || '{}'); } catch (_) { prefs = {}; }
  for (const [key, allowed] of Object.entries(PREF_RULES)) {
    if (params[key] === undefined) continue;
    if (!allowed.includes(params[key])) invalid(key, 'error.invalid', { field: key });
    prefs[key] = params[key];
  }
  ctx.db.prepare('UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(prefs), nowIso(), ctx.userId);
  return refreshedMe(ctx);
}

function refreshedMe(ctx) {
  const { buildContext } = require('../rpc');
  return mePayload(buildContext(ctx.app, ctx.clientKey));
}

function register(define) {
  define('users.list', { perm: 'users.view' }, list);
  define('users.get', { perm: 'users.view' }, (ctx, params) => {
    const u = load(ctx.db, v.id(params, 'id'));
    assertBranchAccess(ctx, u.branch_id);
    return shape(ctx, u);
  });
  define('users.create', { perm: 'users.create' }, create);
  define('users.update', { perm: 'users.edit' }, update);
  define('users.setStatus', { perm: 'users.delete' }, setStatus);
  define('users.resetPassword', { perm: 'users.edit' }, resetPassword);
  define('users.unlock', { perm: 'users.edit' }, unlock);
  define('profile.update', {}, updateProfile);
  define('profile.setPrefs', { allowMustChange: true }, setPrefs);
}

module.exports = { register, insertUser, readNewPassword, assertUsernameFree };

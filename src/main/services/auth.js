'use strict';
// Sign in, sign out, password change and the "who am I" payload used by every screen.
const { newId, nowIso } = require('../core/ids');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../core/password');
const { fail, invalid } = require('../core/errors');
const { t } = require('../core/messages');
const audit = require('../core/audit');
const settings = require('./settings');
const { permissionSet } = require('../rpc');

function branchSummary(db, branchId) {
  const b = db.prepare('SELECT id, code, name, is_head_office, active FROM branches WHERE id = ?').get(branchId);
  return b ? { id: b.id, code: b.code, name: b.name, isHeadOffice: b.is_head_office === 1, active: b.active === 1 } : null;
}

// What the screens need to know about the signed-in user. Permissions are sent so menus can hide items;
// the main process still checks every call on its own.
function mePayload(ctx) {
  if (!ctx.session) return null;
  const u = ctx.user;
  let prefs = {};
  try { prefs = JSON.parse(u.prefs || '{}'); } catch (_) { prefs = {}; }
  return {
    user: {
      id: u.id, username: u.username, fullName: u.full_name, roleId: u.role_id, roleName: u.role_name,
      isSuper: ctx.isSuper, isOwner: u.is_owner === 1, mustChangePassword: u.must_change_password === 1,
      homeBranchId: u.branch_id, phone: u.phone, email: u.email, prefs,
    },
    branch: branchSummary(ctx.db, ctx.branchId),
    permissions: ctx.isSuper ? ['*'] : [...ctx.perms],
  };
}

function startSession(app, clientKey, userId, branchId) {
  const session = { id: newId(), userId, branchId, startedAt: Date.now(), lastActivity: Date.now() };
  app.sessions.set(clientKey, session);
  return session;
}

function lockState(db, userId) {
  return db.prepare('SELECT failed, locked_until FROM login_attempts WHERE user_id = ?').get(userId) || { failed: 0, locked_until: null };
}

async function login(ctx, params) {
  const { app, db } = ctx;
  const username = String(params.username || '').trim();
  const password = String(params.password || '');
  if (!username) invalid('username', 'error.required', { field: 'Username' });
  if (!password) invalid('password', 'error.required', { field: 'Password' });
  const device = app.device;
  const deviceActor = { deviceId: device.id, branchId: device.branch_id };

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    db.transaction(() => audit.write(db, { ...deviceActor, username }, { module: 'auth', action: 'login_failed', summary: 'Sign-in with an unknown username' }))();
    fail('BAD_LOGIN', 'auth.badLogin');
  }

  const now = Date.now();
  const lock = lockState(db, user.id);
  if (lock.locked_until && Date.parse(lock.locked_until) > now) {
    fail('LOCKED', 'auth.locked', { minutes: Math.ceil((Date.parse(lock.locked_until) - now) / 60000) });
  }

  const ok = await verifyPassword(password, user.password_hash);
  const actor = { ...deviceActor, userId: user.id, username: user.username };
  if (!ok) {
    const limit = settings.get(db, 'security.lockoutAttempts', device.branch_id);
    const minutes = settings.get(db, 'security.lockoutMinutes', device.branch_id);
    const failed = (lock.failed || 0) + 1;
    const lockNow = failed >= limit;
    db.transaction(() => {
      db.prepare(`INSERT INTO login_attempts (user_id, failed, locked_until) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET failed = excluded.failed, locked_until = excluded.locked_until`)
        .run(user.id, lockNow ? 0 : failed, lockNow ? new Date(now + minutes * 60000).toISOString() : null);
      audit.write(db, actor, { module: 'auth', action: lockNow ? 'account_locked' : 'login_failed', recordType: 'user', recordId: user.id, summary: lockNow ? `Locked for ${minutes} minutes after ${limit} wrong passwords` : 'Wrong password' });
    })();
    if (lockNow) fail('LOCKED', 'auth.locked', { minutes });
    fail('BAD_LOGIN', 'auth.badLogin');
  }

  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
  if (user.status !== 'active' || !role || !role.active) fail('DISABLED', 'auth.disabled');
  const isSuper = role.is_super === 1;
  const perms = permissionSet({ role_permissions: role.permissions });
  const roaming = isSuper || perms.has('branch.switch') || perms.has('branches.view_all');
  // A PC belongs to one branch. Staff of another branch can only sign in here if they may work across branches.
  if (user.branch_id !== device.branch_id && !roaming) fail('WRONG_BRANCH', 'auth.branchMissing');
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(device.branch_id);
  if (!branch.active && !roaming) fail('BRANCH_INACTIVE', 'error.branchInactive');

  db.transaction(() => {
    db.prepare('DELETE FROM login_attempts WHERE user_id = ?').run(user.id);
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
    audit.write(db, actor, { module: 'auth', action: 'login', recordType: 'user', recordId: user.id, summary: 'Signed in' });
  })();
  startSession(app, ctx.clientKey, user.id, device.branch_id);
  const { buildContext } = require('../rpc');
  return mePayload(buildContext(app, ctx.clientKey));
}

async function changePassword(ctx, params) {
  const { db } = ctx;
  const minLength = settings.get(db, 'security.minPasswordLength', ctx.branchId);
  const current = String(params.currentPassword || '');
  if (!current) invalid('currentPassword', 'error.required', { field: 'Current password' });
  const next = String(params.newPassword || '');
  if (!next) invalid('newPassword', 'error.required', { field: 'New password' });
  if (next.length < minLength) invalid('newPassword', 'auth.passwordShort', { min: minLength });
  if (next.length > 200) invalid('newPassword', 'error.tooLong', { field: 'Password', max: 200 });
  if (params.confirmPassword !== undefined && params.confirmPassword !== next) invalid('confirmPassword', 'auth.passwordMismatch');
  if (!(await verifyPassword(current, ctx.user.password_hash))) invalid('currentPassword', 'auth.wrongCurrent');
  if (current === next) invalid('newPassword', 'auth.passwordSame');
  const hash = await hashPassword(next);
  const now = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?').run(hash, now, now, ctx.userId);
    audit.write(db, ctx.actor, { module: 'auth', action: 'password_changed', recordType: 'user', recordId: ctx.userId, summary: 'Changed own password' });
  })();
  ctx.user.must_change_password = 0;
  return { changed: true };
}

function register(define) {
  define('auth.login', { auth: 'none' }, login);

  define('auth.logout', { allowMustChange: true }, (ctx) => {
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'auth', action: 'logout', recordType: 'user', recordId: ctx.userId, summary: 'Signed out' }))();
    ctx.app.sessions.delete(ctx.clientKey);
    return { signedOut: true };
  });

  define('auth.me', { allowMustChange: true }, (ctx) => mePayload(ctx));

  // Called by the screen on keyboard or mouse use so idle sign-out only happens when nobody is working.
  define('auth.ping', { allowMustChange: true }, () => ({ ok: true }));

  define('auth.changePassword', { allowMustChange: true }, changePassword);

  define('app.state', { auth: 'none', allowBeforeSetup: true }, (ctx) => {
    const { app, db } = ctx;
    if (!app.isSetUp()) return { setUp: false, version: app.version || null };
    let session = null;
    if (ctx.session) {
      try {
        const minutes = settings.get(db, 'security.autoLogoutMinutes', ctx.branchId);
        if (minutes > 0 && Date.now() - ctx.session.lastActivity > minutes * 60000) app.sessions.delete(ctx.clientKey);
        else session = mePayload(ctx);
      } catch (_) { session = null; }
    }
    const org = db.prepare('SELECT id, code, name FROM org LIMIT 1').get();
    const branchId = session ? session.branch.id : app.device.branch_id;
    return {
      setUp: true,
      version: app.version || null,
      org,
      device: { id: app.device.id, name: app.device.name, kind: app.device.kind, deviceNo: app.device.device_no, branch: branchSummary(db, app.device.branch_id) },
      session,
      settings: settings.publicSettings(db, branchId),
      messages: { sessionExpired: t('error.sessionExpired') },
    };
  });
}

module.exports = { register, mePayload, startSession, branchSummary };

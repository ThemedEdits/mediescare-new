'use strict';
// The single RPC router between the screens and the main process.
// Every method declares who may call it; the check happens here, before any service code runs.
const { AppError, fail, toPayload } = require('./core/errors');
const settings = require('./services/settings');

const methods = new Map();

// opts.auth: 'none' (no sign-in needed) or 'session' (default)
// opts.perm: permission key, array of keys (any one is enough), or null (any signed-in user)
// opts.allowMustChange: callable while the user still has to replace a temporary password
// opts.allowBeforeSetup: callable before this PC is set up
function define(name, opts, handler) {
  if (methods.has(name)) throw new Error(`RPC method ${name} defined twice`);
  methods.set(name, { auth: 'session', perm: null, allowMustChange: false, allowBeforeSetup: false, ...opts, handler });
}

function loadUser(db, userId) {
  return db.prepare(`SELECT u.*, r.name AS role_name, r.permissions AS role_permissions, r.is_super, r.active AS role_active,
      b.active AS branch_active
    FROM users u JOIN roles r ON r.id = u.role_id JOIN branches b ON b.id = u.branch_id WHERE u.id = ?`).get(userId);
}

function permissionSet(user) {
  if (!user) return new Set();
  try { return new Set(JSON.parse(user.role_permissions)); } catch (_) { return new Set(); }
}

// Builds the per-call context. The user is re-read every call so a disabled user or a changed role takes effect at once.
function buildContext(app, clientKey) {
  const ctx = { app, db: app.db, clientKey, session: null, can: () => false };
  const session = app.sessions.get(clientKey);
  if (!session) return ctx;
  const user = loadUser(app.db, session.userId);
  if (!user || user.status !== 'active' || !user.role_active) {
    app.sessions.delete(clientKey);
    return ctx;
  }
  const perms = permissionSet(user);
  const isSuper = user.is_super === 1;
  ctx.session = session;
  ctx.user = user;
  ctx.userId = user.id;
  ctx.username = user.username;
  ctx.branchId = session.branchId;
  ctx.deviceId = app.device ? app.device.id : null;
  ctx.isSuper = isSuper;
  ctx.perms = perms;
  ctx.can = (perm) => isSuper || perms.has(perm);
  ctx.actor = { userId: user.id, username: user.username, branchId: session.branchId, deviceId: ctx.deviceId };
  return ctx;
}

function checkIdle(app, ctx) {
  const minutes = settings.get(app.db, 'security.autoLogoutMinutes', ctx.branchId);
  if (minutes > 0 && Date.now() - ctx.session.lastActivity > minutes * 60 * 1000) {
    app.sessions.delete(ctx.clientKey);
    fail('SESSION_EXPIRED', 'error.sessionExpired');
  }
}

async function call(app, clientKey, method, params) {
  try {
    const def = methods.get(method);
    if (!def) fail('UNKNOWN_METHOD', 'error.unknownAction');
    if (!def.allowBeforeSetup && !app.isSetUp()) fail('NOT_SET_UP', 'error.notSignedIn');
    const ctx = buildContext(app, clientKey);
    if (def.auth !== 'none') {
      if (!ctx.session) fail('NOT_SIGNED_IN', 'error.notSignedIn');
      checkIdle(app, ctx);
      if (ctx.user.must_change_password && !def.allowMustChange) fail('MUST_CHANGE_PASSWORD', 'auth.mustChange');
      if (def.perm) {
        const needed = Array.isArray(def.perm) ? def.perm : [def.perm];
        if (!needed.some((p) => ctx.can(p))) fail('FORBIDDEN', 'error.noPermission');
      }
      ctx.session.lastActivity = Date.now();
    }
    const data = await def.handler(ctx, params || {});
    return { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    return { ok: false, error: toPayload(translateDbError(err), method) };
  }
}

// Database guard triggers raise these markers; turn them into plain messages.
function translateDbError(err) {
  if (err instanceof AppError || !err || !err.message) return err;
  const { t } = require('./core/messages');
  if (err.message.includes('MEDI_NO_DELETE') || err.message.includes('MEDI_APPEND_ONLY')) {
    return new AppError('READ_ONLY', t('error.readOnly'));
  }
  return err;
}

function list() {
  return [...methods.entries()].map(([name, d]) => ({ name, auth: d.auth, perm: d.perm }));
}

module.exports = { define, call, list, buildContext, permissionSet };

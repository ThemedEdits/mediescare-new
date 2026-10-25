'use strict';
// First start: create a new Head Office, or join an existing organisation (needs sync, Phase 3).
const os = require('os');
const { newId, nowIso } = require('../core/ids');
const { hashPassword, verifyPassword } = require('../core/password');
const joinCodes = require('../core/joincodes');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const { DEFAULT_ROLES } = require('../core/permissions');
const { startSession, mePayload } = require('./auth');
const { buildContext } = require('../rpc');
const { joinCloud, joinLan } = require('../sync/join');

const SETUP_MIN_PASSWORD = 8; // the owner account protects every branch, so it needs a stronger password

async function createHeadOffice(ctx, params) {
  const { app, db } = ctx;
  if (app.isSetUp()) fail('ALREADY_SET_UP', 'setup.alreadyDone');
  if (db.prepare('SELECT COUNT(*) AS n FROM org').get().n > 0) fail('ALREADY_SET_UP', 'setup.alreadyDone');

  const orgName = v.text(params, 'orgName', 'Organisation name', { required: true, max: 120 });
  const orgCode = v.code(params, 'orgCode', 'Organisation code', { min: 3, max: 12, messageKey: 'setup.orgCodeFormat' });
  const branchName = v.text(params, 'branchName', 'Head Office name', { required: true, max: 120 });
  const branchCode = v.code(params, 'branchCode', 'Head Office code');
  const address = v.text(params, 'address', 'Address', { max: 300 });
  const phone = v.text(params, 'phone', 'Phone', { max: 40 });
  const licenceNo = v.text(params, 'licenceNo', 'Licence number', { max: 60 });
  const fullName = v.text(params, 'fullName', 'Your full name', { required: true, max: 120 });
  const username = v.username(params);
  const password = v.password(params, 'password', SETUP_MIN_PASSWORD);
  if (params.confirmPassword !== password) invalid('confirmPassword', 'auth.passwordMismatch');
  const deviceName = v.text(params, 'deviceName', 'Computer name', { max: 60 }) || os.hostname();

  const hash = await hashPassword(password);
  const now = nowIso();
  // The organisation recovery key: shown once to the owner, only its hash is kept (it syncs to the cloud gateway).
  const recoveryKey = joinCodes.generate(joinCodes.RECOVERY_LENGTH);
  const ids = { org: newId(), branch: newId(), device: newId(), user: newId() };

  db.transaction(() => {
    // The device id must be known before the first insert so every operation records where it came from.
    db.prepare('UPDATE sync_ctx SET device_id = ? WHERE id = 1').run(ids.device);
    db.prepare('INSERT INTO org (id, code, name, recovery_hash, recovery_set_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ids.org, orgCode, orgName, joinCodes.hash(recoveryKey), now, now, now);
    db.prepare(`INSERT INTO branches (id, code, name, is_head_office, address, phone, licence_no, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?)`).run(ids.branch, branchCode, branchName, address, phone, licenceNo, ids.user, now, now);

    let superRoleId = null;
    for (const role of DEFAULT_ROLES) {
      const roleId = newId();
      if (role.isSuper) superRoleId = roleId;
      db.prepare(`INSERT INTO roles (id, name, description, permissions, is_super, is_system, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(roleId, role.name, role.description, JSON.stringify(role.permissions), role.isSuper ? 1 : 0, role.isSuper ? 1 : 0, now, now);
    }

    db.prepare(`INSERT INTO users (id, username, full_name, password_hash, must_change_password, role_id, branch_id, status, is_owner,
        password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, 'active', 1, ?, ?, ?)`).run(ids.user, username, fullName, hash, superRoleId, ids.branch, now, now, now);

    db.prepare(`INSERT INTO devices (id, branch_id, device_no, name, kind, registered_by, created_at, updated_at)
      VALUES (?, ?, 1, ?, 'primary', ?, ?, ?)`).run(ids.device, ids.branch, deviceName, ids.user, now, now);

    app.localSet('device_id', ids.device);
    app.localSet('org_id', ids.org);
    require('./lookups').seedDefaults(db);

    const actor = { userId: ids.user, username, branchId: ids.branch, deviceId: ids.device };
    audit.write(db, actor, { module: 'setup', action: 'create_head_office', recordType: 'org', recordId: ids.org, summary: `Organisation ${orgName} (${orgCode}) created with Head Office ${branchName} (${branchCode})`, new: { orgName, orgCode, branchName, branchCode } });
    audit.write(db, actor, { module: 'users', action: 'create', recordType: 'user', recordId: ids.user, summary: `Super Admin ${username} created`, new: { username, full_name: fullName, role: 'Super Admin' } });
    audit.write(db, actor, { module: 'devices', action: 'register', recordType: 'device', recordId: ids.device, summary: `This computer (${deviceName}) registered as the Head Office primary computer` });
  })();

  app.loadDevice();
  // Start the shop network service (and the cloud, if this build has one) for the new Head Office computer.
  if (app.onJoined) await app.onJoined();
  startSession(app, ctx.clientKey, ids.user, ids.branch);
  return { ...mePayload(buildContext(app, ctx.clientKey)), recoveryKey };
}

// Joins an existing organisation: as the main computer of a branch (through the cloud) or as an extra computer of a
// branch (through its main computer on the shop network). The person joining is signed in afterwards.
async function joinExisting(ctx, params) {
  const { app } = ctx;
  if (app.isSetUp()) fail('ALREADY_SET_UP', 'setup.alreadyDone');
  const username = v.username(params);
  const password = v.text(params, 'password', 'Password', { required: true, max: 200 });
  const deviceName = v.text(params, 'deviceName', 'Computer name', { max: 60 }) || os.hostname();
  let joined;
  if (params.mode === 'client') {
    const code = String(params.pairingCode || '').trim();
    if (!/^\d{6}$/.test(code)) invalid('pairingCode', 'error.invalid', { field: 'Pairing code' });
    let url = v.text(params, 'primaryUrl', 'Main computer address', { required: true, max: 200 });
    if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    if (!/:\d+$/.test(url.replace(/\/+$/, ''))) url = `${url.replace(/\/+$/, '')}:${require('../config').lanPort}`;
    joined = await joinLan(app, { primaryUrl: url.replace(/\/+$/, ''), pairingCode: code, username, password, deviceName, fetchImpl: app.fetchImpl });
  } else {
    v.code(params, 'orgCode', 'Organisation code', { min: 3, max: 12, messageKey: 'setup.orgCodeFormat' });
    // Without a cloud address in this build, say so before asking for any code.
    const cloudUrl = v.text(params, 'cloudUrl', 'Cloud gateway address') || (app.sync && app.sync.cloudUrl) || app.localGet('cloud_url') || require('../config').cloudUrl;
    if (!cloudUrl) fail('SYNC_NOT_AVAILABLE', 'setup.joinNeedsSync');
    const useRecovery = v.bool(params, 'useRecovery');
    const code = joinCodes.normalise(useRecovery ? params.recoveryKey : params.joinCode);
    if (useRecovery && code.length !== joinCodes.RECOVERY_LENGTH) invalid('recoveryKey', 'setup.recoveryFormat');
    if (!useRecovery && code.length !== joinCodes.JOIN_LENGTH) invalid('joinCode', 'setup.joinCodeFormat');
    joined = await joinCloud(app, { cloudUrl, orgCode: String(params.orgCode).toUpperCase(), joinCode: useRecovery ? null : code, recoveryKey: useRecovery ? code : null, deviceName, fetchImpl: app.fetchImpl });
    // The cloud only checked the code. The manager's own login is checked here, against the users just downloaded.
    const user = await joinLogin(app, username, password, joined.branchId);
    if (app.onJoined) await app.onJoined();
    auditJoin(app, { userId: user ? user.id : null }, deviceName);
    if (!user) fail('JOINED_SIGN_IN', 'setup.joinedSignIn');
    app.db.prepare('UPDATE devices SET registered_by = ?, updated_at = ? WHERE id = ?').run(user.id, nowIso(), app.device.id);
    startSession(app, ctx.clientKey, user.id, app.device.branch_id);
    return mePayload(buildContext(app, ctx.clientKey));
  }
  if (app.onJoined) await app.onJoined();
  auditJoin(app, joined, deviceName);
  startSession(app, ctx.clientKey, joined.userId, app.device.branch_id);
  return mePayload(buildContext(app, ctx.clientKey));
}

// A manager of the joined branch (or the owner) who may add computers, with the right password. Null otherwise.
async function joinLogin(app, username, password, branchId) {
  const u = app.db.prepare(`SELECT u.*, r.permissions AS role_permissions, r.is_super, r.active AS role_active FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.username = ? COLLATE NOCASE`).get(username);
  if (!u || u.status !== 'active' || !u.role_active || u.branch_id !== branchId) return null;
  if (!(await verifyPassword(password, u.password_hash))) return null;
  let perms = [];
  try { perms = JSON.parse(u.role_permissions || '[]'); } catch (_) { perms = []; }
  return u.is_super === 1 || perms.includes('devices.edit') ? u : null;
}

function auditJoin(app, joined, deviceName) {
  const db = app.db;
  db.transaction(() => audit.write(db, { userId: joined.userId, branchId: app.device.branch_id, deviceId: app.device.id }, {
    module: 'devices', action: 'join', recordType: 'device', recordId: app.device.id, summary: `This computer (${deviceName}) joined as ${app.device.kind === 'primary' ? 'the main computer' : 'an extra computer'} of the branch`,
  }))();
}

function register(define) {
  define('setup.createHeadOffice', { auth: 'none', allowBeforeSetup: true }, createHeadOffice);
  define('setup.joinExisting', { auth: 'none', allowBeforeSetup: true }, joinExisting);
  define('setup.defaults', { auth: 'none', allowBeforeSetup: true }, (ctx) => ({
    deviceName: os.hostname(),
    minPassword: SETUP_MIN_PASSWORD,
    hasCloud: !!(require('../config').cloudUrl || (ctx.app && ctx.app.sync && ctx.app.sync.cloudUrl) || (ctx.app && ctx.app.localGet('cloud_url'))),
    cloudUrl: (ctx.app && ctx.app.localGet('cloud_url')) || require('../config').cloudUrl || '',
  }));
}

module.exports = { register, SETUP_MIN_PASSWORD };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, client, setUpHeadOffice, signIn, OWNER } = require('./helpers');

async function freshOrg() {
  const app = makeApp();
  const { c: owner, me } = await setUpHeadOffice(app);
  return { app, owner, me };
}

async function roleId(c, name) {
  const roles = await c.call('roles.list', {});
  return roles.find((r) => r.name === name).id;
}

// Creates a user and replaces the temporary password so the user can work.
async function makeUser(app, owner, { username, role, branchId }) {
  const { user, temporaryPassword } = await owner.call('users.create', {
    fullName: `${username} person`, username, roleId: await roleId(owner, role), branchId,
  });
  const { c } = await signIn(app, username, temporaryPassword);
  await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123', confirmPassword: 'Secret#123' });
  return { c, user };
}

test('first start creates organisation, head office, six roles, owner and registers this PC', async () => {
  const app = makeApp();
  const before = await client(app).call('app.state');
  assert.equal(before.setUp, false);
  const { c, me } = await setUpHeadOffice(app);
  assert.equal(me.user.username, 'owner');
  assert.equal(me.user.isSuper, true);
  assert.equal(me.user.isOwner, true);
  assert.equal(me.branch.isHeadOffice, true);
  assert.deepEqual(me.permissions, ['*']);
  const roles = await c.call('roles.list', {});
  assert.deepEqual(roles.map((r) => r.name).sort(), ['Accountant', 'Branch Admin', 'Cashier', 'Pharmacist', 'Store Keeper', 'Super Admin']);
  const state = await c.call('app.state');
  assert.equal(state.setUp, true);
  assert.equal(state.device.kind, 'primary');
  assert.equal(state.device.deviceNo, 1);
  assert.equal(state.org.code, 'TPC');
  // Setting up twice is refused.
  const err = await client(app).fail('setup.createHeadOffice', { orgName: 'X', orgCode: 'XYZ', branchName: 'H', branchCode: 'H1', fullName: 'A', username: 'abc', password: 'Password1', confirmPassword: 'Password1' });
  assert.equal(err.code, 'ALREADY_SET_UP');
  app.close();
});

test('setup validates input with plain-language messages', async () => {
  const app = makeApp();
  const c = client(app);
  let err = await c.fail('setup.createHeadOffice', { orgName: '', orgCode: 'TPC' });
  assert.equal(err.code, 'VALIDATION');
  assert.equal(err.details.field, 'orgName');
  assert.match(err.message, /Please fill in Organisation name/);
  err = await c.fail('setup.createHeadOffice', { orgName: 'A', orgCode: 'TPC', branchName: 'HO', branchCode: 'H O!', fullName: 'A', username: 'owner', password: 'Owner#2026', confirmPassword: 'Owner#2026' });
  assert.equal(err.details.field, 'branchCode');
  err = await c.fail('setup.createHeadOffice', { orgName: 'A', orgCode: 'TPC', branchName: 'HO', branchCode: 'HO', fullName: 'A', username: 'owner', password: 'short', confirmPassword: 'short' });
  assert.match(err.message, /at least 8 characters/);
  err = await c.fail('setup.createHeadOffice', { orgName: 'A', orgCode: 'TPC', branchName: 'HO', branchCode: 'HO', fullName: 'A', username: 'owner', password: 'Owner#2026', confirmPassword: 'Other#2026' });
  assert.equal(err.details.field, 'confirmPassword');
  // Joining an existing organisation explains that sync must be set up first.
  err = await c.fail('setup.joinExisting', { orgCode: 'TPC', username: 'owner', password: 'x', mode: 'primary' });
  assert.equal(err.code, 'SYNC_NOT_AVAILABLE');
  app.close();
});

test('audit log is append-only and synced tables refuse hard deletes', async () => {
  const { app } = await freshOrg();
  const db = app.db;
  const entry = db.prepare('SELECT id FROM audit_log LIMIT 1').get();
  assert.throws(() => db.prepare("UPDATE audit_log SET summary = 'x' WHERE id = ?").run(entry.id), /MEDI_APPEND_ONLY/);
  assert.throws(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(entry.id), /MEDI_APPEND_ONLY/);
  assert.throws(() => db.prepare('DELETE FROM users').run(), /MEDI_NO_DELETE/);
  assert.throws(() => db.prepare('DELETE FROM branches').run(), /MEDI_NO_DELETE/);
  app.close();
});

test('every change to a synced table is recorded as an operation with this PC as origin; applying remote ops does not echo', async () => {
  const { app, owner } = await freshOrg();
  const db = app.db;
  const ops = db.prepare('SELECT * FROM sync_ops ORDER BY seq').all();
  assert.ok(ops.length >= 10);
  assert.ok(ops.every((o) => o.origin_device === app.device.id));
  const tables = new Set(ops.map((o) => o.tbl));
  for (const t of ['org', 'branches', 'roles', 'users', 'devices', 'audit_log']) assert.ok(tables.has(t), `ops for ${t}`);
  const userOp = ops.find((o) => o.tbl === 'users');
  assert.ok(JSON.parse(userOp.data).password_hash.startsWith('scrypt$'));
  const auditOp = ops.find((o) => o.tbl === 'audit_log');
  assert.equal(auditOp.kind, 'insert');
  assert.equal(auditOp.branch_id, app.device.branch_id);

  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM sync_ops').get().n;
  await owner.call('settings.update', { scope: 'global', values: { 'currency.symbol': 'PKR' } });
  const added = db.prepare('SELECT tbl FROM sync_ops WHERE seq > (SELECT MAX(seq) - 2 FROM sync_ops)').all().map((r) => r.tbl);
  assert.deepEqual(added.sort(), ['audit_log', 'settings']);

  db.prepare('UPDATE sync_ctx SET applying = 1').run();
  db.prepare("UPDATE org SET name = 'Remote name', updated_at = ?").run(new Date().toISOString());
  db.prepare('UPDATE sync_ctx SET applying = 0').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_ops').get().n, countBefore + 2);
  app.close();
});

test('wrong passwords lock the account; an admin can unlock it', async () => {
  const { app, owner } = await freshOrg();
  const { user } = await makeUser(app, owner, { username: 'cash1', role: 'Cashier', branchId: app.device.branch_id });
  const c = client(app);
  for (let i = 0; i < 4; i++) assert.equal((await c.fail('auth.login', { username: 'cash1', password: 'nope' })).code, 'BAD_LOGIN');
  const fifth = await c.fail('auth.login', { username: 'cash1', password: 'nope' });
  assert.equal(fifth.code, 'LOCKED');
  // Even the right password is refused while locked.
  assert.equal((await c.fail('auth.login', { username: 'cash1', password: 'Secret#123' })).code, 'LOCKED');
  const listed = (await owner.call('users.list', {})).find((u) => u.id === user.id);
  assert.equal(listed.locked, true);
  await owner.call('users.unlock', { id: user.id });
  await c.call('auth.login', { username: 'cash1', password: 'Secret#123' });
  // Unknown usernames get the same message as a wrong password.
  assert.equal((await c.fail('auth.login', { username: 'ghost', password: 'x' })).message, 'The username or password is not correct.');
  app.close();
});

test('a temporary password must be replaced before anything else works', async () => {
  const { app, owner } = await freshOrg();
  const { temporaryPassword } = await owner.call('users.create', { fullName: 'New Cashier', username: 'newcash', roleId: await roleId(owner, 'Cashier') });
  assert.match(temporaryPassword, /^[a-z]+-\d{4}$/);
  const { c, me } = await signIn(app, 'newcash', temporaryPassword);
  assert.equal(me.user.mustChangePassword, true);
  assert.equal((await c.fail('users.list', {})).code, 'MUST_CHANGE_PASSWORD');
  assert.equal((await c.fail('auth.changePassword', { currentPassword: temporaryPassword, newPassword: temporaryPassword })).details.field, 'newPassword');
  assert.equal((await c.fail('auth.changePassword', { currentPassword: 'wrong', newPassword: 'Another#1' })).details.field, 'currentPassword');
  await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Another#1', confirmPassword: 'Another#1' });
  const after = await c.call('auth.me');
  assert.equal(after.user.mustChangePassword, false);
  app.close();
});

test('permissions are enforced in the main process, not only in menus', async () => {
  const { app, owner } = await freshOrg();
  const { c: cashier } = await makeUser(app, owner, { username: 'cash2', role: 'Cashier', branchId: app.device.branch_id });
  for (const [method, params] of [['users.list', {}], ['roles.create', { name: 'X' }], ['branches.create', {}], ['settings.update', {}], ['audit.list', {}], ['branches.switch', { branchId: 'X' }]]) {
    assert.equal((await cashier.fail(method, params)).code, 'FORBIDDEN', method);
  }
  assert.equal((await client(app).fail('users.list', {})).code, 'NOT_SIGNED_IN');
  assert.equal((await owner.fail('no.such.method', {})).code, 'UNKNOWN_METHOD');
  const me = await cashier.call('auth.me');
  assert.ok(!me.permissions.includes('users.view'));
  app.close();
});

test('nobody can hand out more power than they have', async () => {
  const { app, owner } = await freshOrg();
  const { c: manager } = await makeUser(app, owner, { username: 'mgr', role: 'Branch Admin', branchId: app.device.branch_id });
  // A role with a permission the manager lacks.
  const strong = await owner.call('roles.create', { name: 'Regional', permissions: ['branches.create', 'users.view'] });
  assert.equal((await manager.fail('users.create', { fullName: 'X', username: 'xuser', roleId: strong.id })).code, 'FORBIDDEN');
  assert.equal((await manager.fail('roles.create', { name: 'Sneaky', permissions: ['branches.create'] })).code, 'FORBIDDEN');
  // The Super Admin role can never be given to a second user.
  const superId = await roleId(owner, 'Super Admin');
  assert.equal((await owner.fail('users.create', { fullName: 'X', username: 'xuser', roleId: superId })).details.field, 'roleId');
  // Super Admin role is locked.
  assert.equal((await owner.fail('roles.update', { id: superId, name: 'Boss', permissions: [] })).code, 'FORBIDDEN');
  // Within their own permissions it works.
  const cashierRole = await roleId(manager, 'Cashier');
  const made = await manager.call('users.create', { fullName: 'Till Two', username: 'till2', roleId: cashierRole });
  assert.equal(made.user.roleName, 'Cashier');
  // The manager cannot touch the owner.
  const ownerId = (await owner.call('auth.me')).user.id;
  assert.equal((await manager.fail('users.update', { id: ownerId, fullName: 'Hacked', username: 'owner' })).code, 'FORBIDDEN');
  assert.equal((await manager.fail('users.resetPassword', { id: ownerId })).code, 'FORBIDDEN');
  app.close();
});

test('branches: creating one also creates its manager; data stays inside the branch', async () => {
  const { app, owner } = await freshOrg();
  const res = await owner.call('branches.create', { code: 'lhr', name: 'Lahore Main', address: 'Mall Road', admin: { fullName: 'Lahore Manager', username: 'lhrmgr' } });
  assert.equal(res.branch.code, 'LHR');
  assert.ok(res.admin.temporaryPassword);
  assert.equal((await owner.fail('branches.create', { code: 'LHR', name: 'Again', admin: { fullName: 'x', username: 'zz1' } })).details.field, 'code');

  const users = await owner.call('users.list', { branchId: res.branch.id });
  assert.equal(users.length, 1);
  assert.equal(users[0].roleName, 'Branch Admin');

  // The Lahore manager cannot sign in on the Head Office computer.
  assert.equal((await client(app).fail('auth.login', { username: 'lhrmgr', password: res.admin.temporaryPassword })).code, 'WRONG_BRANCH');

  // A Head Office manager only sees Head Office users.
  const { c: hoMgr } = await makeUser(app, owner, { username: 'homgr', role: 'Branch Admin', branchId: app.device.branch_id });
  const seen = await hoMgr.call('users.list', {});
  assert.ok(seen.every((u) => u.branchId === app.device.branch_id));
  assert.equal((await hoMgr.fail('users.get', { id: users[0].id })).code, 'FORBIDDEN');
  assert.equal((await hoMgr.fail('users.create', { fullName: 'X', username: 'xx9', roleId: await roleId(owner, 'Cashier'), branchId: res.branch.id })).code, 'FORBIDDEN');

  // Switching branch: owner may, Head Office cannot be deactivated, a deactivated branch cannot be opened.
  const switched = await owner.call('branches.switch', { branchId: res.branch.id });
  assert.equal(switched.branch.code, 'LHR');
  const hoId = app.device.branch_id;
  assert.equal((await owner.fail('branches.setActive', { id: hoId, active: false, reason: 'x' })).code, 'FORBIDDEN');
  assert.equal((await owner.fail('branches.setActive', { id: res.branch.id, active: false })).details.field, 'reason');
  await owner.call('branches.switch', { branchId: hoId });
  await owner.call('branches.setActive', { id: res.branch.id, active: false, reason: 'Closed for renovation' });
  assert.equal((await owner.fail('branches.switch', { branchId: res.branch.id })).code, 'BRANCH_INACTIVE');
  app.close();
});

test('users are disabled, never deleted; a disabled user is thrown out at the next action', async () => {
  const { app, owner } = await freshOrg();
  const { c, user } = await makeUser(app, owner, { username: 'temp1', role: 'Cashier', branchId: app.device.branch_id });
  assert.equal((await owner.fail('users.setStatus', { id: user.id, status: 'disabled' })).details.field, 'reason');
  await owner.call('users.setStatus', { id: user.id, status: 'disabled', reason: 'Left the job' });
  assert.equal((await c.fail('auth.me')).code, 'NOT_SIGNED_IN');
  assert.equal((await client(app).fail('auth.login', { username: 'temp1', password: 'Secret#123' })).code, 'DISABLED');
  const ownerId = (await owner.call('auth.me')).user.id;
  assert.equal((await owner.fail('users.setStatus', { id: ownerId, status: 'disabled', reason: 'x' })).code, 'FORBIDDEN');
  await owner.call('users.setStatus', { id: user.id, status: 'active' });
  await client(app).call('auth.login', { username: 'temp1', password: 'Secret#123' });
  app.close();
});

test('roles: edit, cannot deactivate while in use, audit records what changed', async () => {
  const { app, owner } = await freshOrg();
  const role = await owner.call('roles.create', { name: 'Counter Helper', permissions: ['pos.view'] });
  await owner.call('roles.update', { id: role.id, name: 'Counter Helper', permissions: ['pos.view', 'pos.create'] });
  const log = await owner.call('audit.list', { recordId: role.id });
  assert.ok(log.rows.some((r) => /added: pos.create/.test(r.summary)));
  await makeUser(app, owner, { username: 'helper', role: 'Counter Helper', branchId: app.device.branch_id });
  assert.equal((await owner.fail('roles.setActive', { id: role.id, active: false })).code, 'IN_USE');
  assert.equal((await owner.fail('roles.create', { name: 'counter helper', permissions: [] })).details.field, 'name');
  assert.equal((await owner.fail('roles.create', { name: 'Bad', permissions: ['made.up'] })).details.field, 'permissions');
  app.close();
});

test('settings: organisation values, branch overrides, and who may change them', async () => {
  const { app, owner } = await freshOrg();
  await owner.call('settings.update', { scope: 'global', values: { 'currency.decimals': 0, 'security.autoLogoutMinutes': 10 }, orgName: 'Renamed Chain' });
  let s = await owner.call('settings.get');
  assert.equal(s.values['currency.decimals'], 0);
  assert.equal(s.org.name, 'Renamed Chain');
  await owner.call('settings.update', { scope: 'branch', values: { 'security.autoLogoutMinutes': 5 } });
  s = await owner.call('settings.get');
  assert.equal(s.values['security.autoLogoutMinutes'], 5);
  assert.equal(s.overridden['security.autoLogoutMinutes'], true);
  assert.equal((await owner.fail('settings.update', { scope: 'branch', values: { 'currency.symbol': '$' } })).code, 'FORBIDDEN');
  assert.equal((await owner.fail('settings.update', { scope: 'global', values: { 'security.lockoutAttempts': 1 } })).details.field, 'security.lockoutAttempts');
  const { c: mgr } = await makeUser(app, owner, { username: 'mgr2', role: 'Branch Admin', branchId: app.device.branch_id });
  assert.equal((await mgr.fail('settings.update', { scope: 'global', values: { 'currency.symbol': '$' } })).code, 'FORBIDDEN');
  await mgr.call('settings.update', { scope: 'branch', values: { 'receipt.footer': 'Get well soon' } });
  app.close();
});

test('idle sessions are signed out after the configured minutes', async () => {
  const { app, owner } = await freshOrg();
  await owner.call('settings.update', { scope: 'global', values: { 'security.autoLogoutMinutes': 1 } });
  const session = app.sessions.get(owner.key);
  session.lastActivity = Date.now() - 61 * 1000;
  assert.equal((await owner.fail('auth.me')).code, 'SESSION_EXPIRED');
  assert.equal((await owner.fail('auth.me')).code, 'NOT_SIGNED_IN');
  app.close();
});

test('audit log: never contains password hashes, filters work, export is safe for spreadsheets', async () => {
  const { app, owner } = await freshOrg();
  await owner.call('users.create', { fullName: '=HYPERLINK("http://bad")', username: 'evil', roleId: await roleId(owner, 'Cashier') });
  const all = app.db.prepare('SELECT old_value, new_value FROM audit_log').all();
  assert.ok(all.every((r) => !String(r.new_value).includes('scrypt$') && !String(r.old_value).includes('scrypt$')));
  const page = await owner.call('audit.list', { module: 'users', pageSize: 10 });
  assert.ok(page.total >= 2);
  assert.ok(page.rows.every((r) => r.module === 'users'));
  const res = await owner.call('audit.export', { format: 'csv', search: 'evil' });
  assert.equal(res.saved, true);
  const csv = app.saved[0].content;
  assert.match(csv, /Test Pharmacy Chain - Audit log/);
  assert.ok(!/,=HYPERLINK/.test(csv), 'formula must be neutralised');
  const exportLogged = await owner.call('audit.list', { action: 'export' });
  assert.equal(exportLogged.total, 1);
  for (const format of ['json', 'xml', 'txt']) assert.equal((await owner.call('audit.export', { format })).saved, true);
  assert.equal((await owner.fail('audit.export', { format: 'exe' })).details.field, 'format');
  app.close();
});

test('profile: users change their own name, username and preferences', async () => {
  const { app, owner } = await freshOrg();
  const me = await owner.call('profile.update', { fullName: 'The Owner', username: 'boss' });
  assert.equal(me.user.username, 'boss');
  const prefs = await owner.call('profile.setPrefs', { theme: 'dark' });
  assert.equal(prefs.user.prefs.theme, 'dark');
  assert.equal((await owner.fail('profile.setPrefs', { theme: 'pink' })).details.field, 'theme');
  await owner.call('auth.logout');
  await signIn(app, 'boss', OWNER.password);
  app.close();
});

test('reopening an existing database keeps data and does not re-run migrations', async () => {
  const { app } = await freshOrg();
  const dir = app.dataDir;
  app.close();
  const again = makeApp(dir);
  assert.equal(again.migration.applied.length, 0);
  assert.equal(again.isSetUp(), true);
  await signIn(again, OWNER.username, OWNER.password);
  again.close();
});

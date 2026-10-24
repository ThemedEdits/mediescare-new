'use strict';
// Joining a new main computer without any password check in the cloud: one-time join codes made at Head Office, the
// organisation recovery key for a lost Head Office computer, and the manager's login checked on the new computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { makeApp, tempDir, setUpHeadOffice, signIn, client } = require('./helpers');
const { SyncEngine } = require('../src/main/sync/engine');
const { joinCloud } = require('../src/main/sync/join');
const { createServer } = require('../gateway/server');
const { sqliteAdapter } = require('../gateway/src/adapters');
const joinCodes = require('../src/main/core/joincodes');

async function gateway() {
  const db = sqliteAdapter(path.join(tempDir(), 'gateway.db'));
  const server = createServer({ db, setupKey: '' });
  const url = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  return { url, db, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

function engineFor(app, cloudUrl) {
  app.sync = new SyncEngine(app, { lanPort: 0, cloudUrl, discovery: false, autoStart: false });
  return app.sync;
}

async function headOffice(gw) {
  const ho = makeApp();
  const { c: owner, me } = await setUpHeadOffice(ho);
  const engine = engineFor(ho, gw.url);
  await engine.start();
  const { branch: lhr, admin } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'Lahore Manager', username: 'lhrmgr' } });
  await engine.run('cloud');
  return { ho, owner, me, engine, lhr, admin };
}

const post = (url, body) => fetch(`${url}/v1/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const deviceId = () => require('../src/main/core/ids').newId();

test('codes: readable format, app and gateway hash them the same way', () => {
  const code = joinCodes.generate(joinCodes.JOIN_LENGTH);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(joinCodes.generate(joinCodes.RECOVERY_LENGTH), /^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(joinCodes.hash('k7qm 4xpa-9rtd'), joinCodes.hash('K7QM-4XPA-9RTD'), 'spaces, dashes and case do not matter');
  const gatewayHash = crypto.createHash('sha256').update('K7QM4XPA9RTD').digest('hex');
  assert.equal(joinCodes.hash('K7QM-4XPA-9RTD'), gatewayHash);
});

test('join codes: used once, refused when wrong, cancelled or expired, limited tries, only for their branch', async () => {
  const gw = await gateway();
  const { ho, owner, engine, lhr } = await headOffice(gw);
  const { code, expiresAt, branchName } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  assert.equal(branchName, 'Lahore');
  assert.ok(Date.parse(expiresAt) - Date.now() > 23 * 3600 * 1000);
  // Making the code starts a sync at once, so it is in the cloud within moments.
  await engine.run('cloud');
  assert.equal((await post(gw.url, { orgCode: 'XXX', joinCode: code, deviceId: deviceId() })).status, 403, 'wrong organisation code');
  const ok = await post(gw.url, { orgCode: 'tpc', joinCode: code.toLowerCase(), deviceId: deviceId(), deviceName: 'LHR-1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.branchId, lhr.id);
  assert.equal(ok.body.allBranches, false, 'a branch computer does not see other branches');
  const again = await post(gw.url, { orgCode: 'TPC', joinCode: code, deviceId: deviceId() });
  assert.equal(again.status, 403);
  assert.match(again.body.error, /already used/);
  // Cancelled before use.
  const c2 = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  const listed = await owner.call('devices.joinCodes', {});
  assert.equal(listed.find((x) => x.hint === `...${c2.code.slice(-4)}`).status, 'active');
  await owner.call('devices.cancelJoinCode', { id: listed.find((x) => x.hint === `...${c2.code.slice(-4)}`).id });
  await engine.run('cloud');
  assert.match((await post(gw.url, { orgCode: 'TPC', joinCode: c2.code, deviceId: deviceId() })).body.error, /cancelled/);
  // Expired (made to look 25 hours old).
  const c3 = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  const old = new Date(Date.now() - 3600 * 1000).toISOString();
  ho.db.prepare('UPDATE join_codes SET expires_at = ?, updated_at = ? WHERE code_hash = ?').run(old, new Date().toISOString(), joinCodes.hash(c3.code));
  await engine.run('cloud');
  assert.match((await post(gw.url, { orgCode: 'TPC', joinCode: c3.code, deviceId: deviceId() })).body.error, /expired/);
  // Two computers with the same fresh code at the same moment: exactly one gets in.
  const c4 = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await engine.run('cloud');
  const both = await Promise.all([1, 2].map(() => post(gw.url, { orgCode: 'TPC', joinCode: c4.code, deviceId: deviceId() })));
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 403]);
  // Guessing is stopped after 20 wrong codes an hour.
  let last;
  for (let i = 0; i < 25; i++) last = await post(gw.url, { orgCode: 'TPC', joinCode: `WRONG${i}`, deviceId: deviceId() });
  assert.equal(last.status, 429);
  await gw.close();
  await ho.sync.stop();
  ho.close();
});

test('setup screen join: code + manager login checked on the new computer; a wrong login still joins but signs nobody in', async () => {
  const gw = await gateway();
  const { ho, owner, engine, lhr, admin } = await headOffice(gw);
  const { code } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await engine.run('cloud');
  const br = makeApp();
  br.sync = new SyncEngine(br, { lanPort: 0, cloudUrl: gw.url, discovery: false, autoStart: false });
  const c = client(br);
  // Format checked before anything is sent.
  assert.equal((await c.fail('setup.joinExisting', { mode: 'primary', orgCode: 'TPC', joinCode: '123', username: 'lhrmgr', password: 'x' })).details.field, 'joinCode');
  const me = await c.call('setup.joinExisting', { mode: 'primary', orgCode: 'TPC', joinCode: code, username: 'lhrmgr', password: admin.temporaryPassword, deviceName: 'LHR-MAIN' });
  assert.equal(me.user.username, 'lhrmgr');
  assert.equal(me.user.mustChangePassword, true, 'the temporary password still has to be changed');
  assert.equal(br.device.branch_id, lhr.id);
  assert.equal(br.db.prepare('SELECT registered_by FROM devices WHERE id = ?').get(br.device.id).registered_by, br.db.prepare("SELECT id FROM users WHERE username = 'lhrmgr'").get().id);
  // The used code travels back to Head Office.
  await br.sync.run('cloud');
  await engine.run('cloud');
  assert.equal((await owner.call('devices.joinCodes', {})).find((x) => x.hint === `...${code.slice(-4)}`).status, 'used');

  // Wrong password: the computer joins (the code is spent), but nobody is signed in; the login screen comes next.
  const { code: code2 } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await engine.run('cloud');
  const br2 = makeApp();
  br2.sync = new SyncEngine(br2, { lanPort: 0, cloudUrl: gw.url, discovery: false, autoStart: false });
  const c2 = client(br2);
  const err = await c2.fail('setup.joinExisting', { mode: 'primary', orgCode: 'TPC', joinCode: code2, username: 'lhrmgr', password: 'wrong-password', deviceName: 'LHR-2' });
  assert.equal(err.code, 'JOINED_SIGN_IN');
  assert.ok(br2.isSetUp());
  assert.equal((await c2.call('auth.me', {}).catch((e) => e)).code, 'NOT_SIGNED_IN');
  // The owner is not a Lahore user, so the owner's login does not sign in on a Lahore computer either.
  const { code: code3 } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await engine.run('cloud');
  const br3 = makeApp();
  br3.sync = new SyncEngine(br3, { lanPort: 0, cloudUrl: gw.url, discovery: false, autoStart: false });
  assert.equal((await client(br3).fail('setup.joinExisting', { mode: 'primary', orgCode: 'TPC', joinCode: code3, username: 'owner', password: 'Owner#2026', deviceName: 'LHR-3' })).code, 'JOINED_SIGN_IN');
  await gw.close();
  for (const a of [ho, br, br2, br3]) { await a.sync.stop(); a.close(); }
});

test('recovery key: shown once at setup, brings back the Head Office computer, and can be replaced by the owner only', async () => {
  const gw = await gateway();
  const { ho, owner, me, engine } = await headOffice(gw);
  assert.match(me.recoveryKey, /^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(ho.db.prepare('SELECT recovery_hash FROM org').get().recovery_hash, joinCodes.hash(me.recoveryKey), 'only the hash is stored');
  // The Head Office computer is lost: a new one joins with the recovery key and becomes a Head Office computer.
  const fresh = makeApp();
  const joined = await joinCloud(fresh, { cloudUrl: gw.url, orgCode: 'TPC', recoveryKey: me.recoveryKey, deviceName: 'HO-NEW' });
  assert.equal(joined.allBranches, true);
  assert.equal(fresh.device.branch_id, ho.device.branch_id);
  assert.ok(fresh.db.prepare('SELECT COUNT(*) AS n FROM branches').get().n >= 2, 'all branches came back');
  const { c: ownerAgain } = await signIn(fresh, 'owner', 'Owner#2026');
  assert.ok(ownerAgain);
  // A recovery key can join a Head Office computer only; a wrong key is refused.
  const bad = makeApp();
  await assert.rejects(joinCloud(bad, { cloudUrl: gw.url, orgCode: 'TPC', recoveryKey: 'AAAA-BBBB-CCCC-DDDD-EEEE', deviceName: 'X' }), /recovery key is not correct/);
  // Only the owner makes a new key; the old one stops working once it has synced.
  const mgrHo = await owner.call('users.create', { fullName: 'HO manager', username: 'homgr', roleId: (await owner.call('roles.list', {})).find((r) => r.name === 'Branch Admin').id });
  const { c: mgr } = await signIn(ho, 'homgr', mgrHo.temporaryPassword);
  await mgr.call('auth.changePassword', { currentPassword: mgrHo.temporaryPassword, newPassword: 'Manager#1' });
  assert.equal((await mgr.fail('org.newRecoveryKey', {})).code, 'FORBIDDEN');
  const { recoveryKey } = await owner.call('org.newRecoveryKey', {});
  assert.notEqual(recoveryKey, me.recoveryKey);
  await engine.run('cloud');
  const bad2 = makeApp();
  await assert.rejects(joinCloud(bad2, { cloudUrl: gw.url, orgCode: 'TPC', recoveryKey: me.recoveryKey, deviceName: 'X' }), /recovery key is not correct/);
  await gw.close();
  for (const a of [ho]) { await a.sync.stop(); a.close(); }
  for (const a of [fresh, bad, bad2]) a.close();
});

test('a push bigger than the gateway takes is sent in parts, nothing lost', async () => {
  const gw = await gateway();
  const { ho, owner, engine } = await headOffice(gw);
  // 700 new suppliers -> several push rounds of at most 250.
  for (let i = 0; i < 700; i++) await owner.call('suppliers.create', { name: `Supplier ${i}` });
  await engine.run('cloud');
  const n = await gw.db.get("SELECT COUNT(*) AS n FROM ops WHERE tbl = 'suppliers'");
  assert.equal(n.n, ho.db.prepare("SELECT COUNT(*) AS n FROM sync_ops WHERE tbl = 'suppliers'").get().n);
  assert.equal(engine.status().cloud.pending, 0);
  await gw.close();
  await ho.sync.stop();
  ho.close();
});

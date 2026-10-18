'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeApp, tempDir, setUpHeadOffice, signIn } = require('./helpers');
const { applyOps } = require('../src/main/sync/apply');
const { SyncEngine } = require('../src/main/sync/engine');
const { joinCloud, joinLan } = require('../src/main/sync/join');
const { createServer } = require('../gateway/server');
const { sqliteAdapter, tursoAdapter } = require('../gateway/src/adapters');
const backup = require('../src/main/backup');
const stock = require('../src/main/core/stock');
const { newId } = require('../src/main/core/ids');

const future = (days) => stock.addDays(stock.today(), days);

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function gateway() {
  const db = sqliteAdapter(path.join(tempDir(), 'gateway.db'));
  const server = createServer({ db, setupKey: '' });
  const url = await listen(server);
  return { url, db, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

function engineFor(app, cloudUrl) {
  app.sync = new SyncEngine(app, { lanPort: 0, cloudUrl, discovery: false, autoStart: false });
  return app.sync;
}

// ---- merge rules ---------------------------------------------------------------------------------------------------

function op(tbl, row, extra = {}) {
  return { op_id: crypto.randomBytes(16).toString('hex'), tbl, row_id: row.id, kind: extra.kind || 'upsert', branch_id: extra.branch_id || null, branch_id2: null, data: JSON.stringify(row), updated_at: row.updated_at, origin_device: 'X', created_at: row.updated_at, ...extra };
}

test('merge rules: same op twice changes nothing; newer wins; older is ignored; ties go to the larger op id', async () => {
  const app = makeApp();
  await setUpHeadOffice(app);
  const lk = { id: newId(), kind: 'category', name: 'Skin', active: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
  const first = op('lookups', lk);
  assert.equal(applyOps(app.db, [first]).applied, 1);
  assert.equal(applyOps(app.db, [first]).duplicates, 1);
  applyOps(app.db, [op('lookups', { ...lk, name: 'Skin care', updated_at: '2026-02-01T00:00:00.000Z' })]);
  applyOps(app.db, [op('lookups', { ...lk, name: 'OLD', updated_at: '2025-12-01T00:00:00.000Z' })]);
  assert.equal(app.db.prepare('SELECT name FROM lookups WHERE id = ?').get(lk.id).name, 'Skin care');
  const tieA = op('lookups', { ...lk, name: 'Tie A', updated_at: '2026-03-01T00:00:00.000Z' }, { op_id: 'aaaa' });
  const tieB = op('lookups', { ...lk, name: 'Tie B', updated_at: '2026-03-01T00:00:00.000Z' }, { op_id: 'bbbb' });
  applyOps(app.db, [tieB]);
  applyOps(app.db, [tieA]);
  assert.equal(app.db.prepare('SELECT name FROM lookups WHERE id = ?').get(lk.id).name, 'Tie B');
  // Applied rows are not recorded again as new local operations (no echo).
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM sync_ops WHERE tbl = 'lookups' AND row_id = ?").get(lk.id).n, 5);
  app.close();
});

test('merge rules: the same username made on two computers ends the same on both, whatever the order', async () => {
  const appA = makeApp();
  const { c: owner } = await setUpHeadOffice(appA);
  const roleId = (await owner.call('roles.list', {})).find((r) => r.name === 'Cashier').id;
  const branchId = appA.device.branch_id;
  const base = { full_name: 'Ali', password_hash: 'scrypt$x', must_change_password: 1, role_id: roleId, branch_id: branchId, status: 'active', is_owner: 0, prefs: '{}', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
  const u1 = { ...base, id: '01AAAAAAAAAAAAAAAAAAAAAAAA', username: 'ali' };
  const u2 = { ...base, id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', username: 'ALI' };
  // Order 1 on this database.
  applyOps(appA.db, [op('users', u1)]);
  applyOps(appA.db, [op('users', u2)]);
  const a = appA.db.prepare('SELECT id, username FROM users WHERE id IN (?, ?) ORDER BY id').all(u1.id, u2.id);
  // Order 2 on a copy of the same organisation.
  const dir = tempDir();
  appA.db.prepare('VACUUM INTO ?').run(path.join(dir, 'mediescare.db'));
  const appB = makeApp(dir);
  appB.db.prepare('UPDATE sync_ctx SET applying = 1').run();
  appB.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(u1.id, u2.id);
  appB.db.prepare('UPDATE sync_ctx SET applying = 0').run();
  appB.db.prepare('DELETE FROM sync_ops WHERE row_id IN (?, ?)').run(u1.id, u2.id);
  applyOps(appB.db, [op('users', u2)]);
  applyOps(appB.db, [op('users', u1)]);
  const b = appB.db.prepare('SELECT id, username FROM users WHERE id IN (?, ?) ORDER BY id').all(u1.id, u2.id);
  assert.deepEqual(a, b);
  assert.equal(a[0].username, 'ali', 'the older id keeps the name');
  assert.equal(a[1].username, 'ALI-ZZZZ');
  assert.ok(appA.db.prepare("SELECT COUNT(*) AS n FROM sync_conflicts WHERE kind = 'duplicate'").get().n >= 1);
  appA.close();
  appB.close();
});

// ---- end to end ----------------------------------------------------------------------------------------------------

async function chain() {
  const gw = await gateway();
  // Head Office.
  const ho = makeApp();
  const { c: owner } = await setUpHeadOffice(ho);
  const hoEngine = engineFor(ho, gw.url);
  await hoEngine.start();
  assert.ok(ho.localGet('cloud_token'), 'Head Office registered with the cloud');
  const { branch: lhr, admin } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'Lahore Manager', username: 'lhrmgr' } });
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors' });
  const panadol = await owner.call('products.create', { brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25', barcodes: ['8964000111222'] });
  await owner.call('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'I-1', post: true, lines: [{ productId: panadol.id, batchNo: 'B1', expiryDate: future(300), qty: 200, price: '25' }] });
  await owner.call('transfers.create', { mode: 'send', otherBranchId: lhr.id, dispatch: true, lines: [{ productId: panadol.id, qty: 50 }] });
  // Head Office makes a one-time join code for Lahore's main computer; the next sync takes it to the cloud.
  const { code: joinCode } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await hoEngine.run('cloud');
  return { gw, ho, owner, hoEngine, lhr, admin, panadol, joinCode };
}

test('cloud: a branch joins, gets only its data, receives a transfer; Head Office sees it the same day', async () => {
  const { gw, ho, owner, hoEngine, lhr, admin, panadol, joinCode } = await chain();
  // A wrong join code is refused by the gateway.
  const br = makeApp();
  await assert.rejects(joinCloud(br, { cloudUrl: gw.url, orgCode: 'TPC', joinCode: 'AAAABBBBCCCC', deviceName: 'LHR-1' }), /not correct/);
  const joined = await joinCloud(br, { cloudUrl: gw.url, orgCode: 'TPC', joinCode, deviceName: 'LHR-1' });
  assert.equal(joined.branchId, lhr.id);
  assert.equal(br.device.branch_id, lhr.id);
  assert.equal(br.device.kind, 'primary');
  assert.equal(br.device.device_no, 1);
  // Shared data arrived; Head Office's own stock movements did not.
  assert.equal(br.db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  assert.equal(br.db.prepare('SELECT COUNT(*) AS n FROM stock_ledger WHERE branch_id = ?').get(ho.device.branch_id).n, 0);
  assert.equal(br.db.prepare('SELECT status FROM transfers').get().status, 'dispatched');
  // The manager signs in at the branch (temporary password -> new one) and receives the transfer.
  const { c: mgr } = await signIn(br, 'lhrmgr', admin.temporaryPassword);
  await mgr.call('auth.changePassword', { currentPassword: admin.temporaryPassword, newPassword: 'Lahore#1' });
  const t = (await mgr.call('transfers.list', { direction: 'in' })).rows[0];
  await mgr.call('transfers.receive', { id: t.id });
  assert.equal(stock.productBalance(br.db, lhr.id, panadol.id), 50);
  const brEngine = engineFor(br, gw.url);
  await brEngine.run('cloud');
  await hoEngine.run('cloud');
  // Head Office now sees the transfer received and Lahore's stock.
  assert.equal(ho.db.prepare('SELECT status FROM transfers').get().status, 'received');
  assert.equal(stock.productBalance(ho.db, lhr.id, panadol.id), 50);
  // The new password travelled back too: the manager could sign in at Head Office if allowed.
  const hash = br.db.prepare("SELECT password_hash FROM users WHERE username = 'lhrmgr'").get().password_hash;
  assert.equal(ho.db.prepare("SELECT password_hash FROM users WHERE username = 'lhrmgr'").get().password_hash, hash);
  // Every ledger row is the same on both sides (nothing lost, nothing doubled).
  const ledger = (app) => app.db.prepare('SELECT id, qty FROM stock_ledger WHERE branch_id = ? ORDER BY id').all(lhr.id);
  assert.deepEqual(ledger(br), ledger(ho));
  assert.deepEqual(stock.checkBalances(br.db), []);
  assert.deepEqual(stock.checkBalances(ho.db), []);
  // Sync log has entries.
  assert.ok((await owner.call('sync.log', {})).total > 0);
  await gw.close();
  for (const a of [ho, br]) { await a.sync.stop(); a.close(); }
});

test('shop network: a counter computer pairs with its main computer; sales flow up to Head Office; offline days catch up', async () => {
  const { gw, ho, hoEngine, lhr, admin, panadol, joinCode } = await chain();
  const primary = makeApp();
  await joinCloud(primary, { cloudUrl: gw.url, orgCode: 'TPC', joinCode, deviceName: 'LHR-MAIN' });
  const pEngine = engineFor(primary, gw.url);
  await pEngine.start();
  const { c: mgr } = await signIn(primary, 'lhrmgr', admin.temporaryPassword);
  await mgr.call('auth.changePassword', { currentPassword: admin.temporaryPassword, newPassword: 'Lahore#1' });
  await mgr.call('transfers.receive', { id: (await mgr.call('transfers.list', { direction: 'in' })).rows[0].id });
  const code = (await mgr.call('lan.pairingCode')).code;
  const lanUrl = `http://127.0.0.1:${pEngine.server.port}`;
  // Pairing: wrong code refused; right code + manager login works.
  const counter = makeApp();
  await assert.rejects(joinLan(counter, { primaryUrl: lanUrl, pairingCode: '000000', username: 'lhrmgr', password: 'Lahore#1', deviceName: 'Counter 2' }), /pairing code is wrong/);
  await joinLan(counter, { primaryUrl: lanUrl, pairingCode: code, username: 'lhrmgr', password: 'Lahore#1', deviceName: 'Counter 2' });
  assert.equal(counter.device.kind, 'client');
  assert.equal(counter.device.device_no, 2);
  assert.equal(stock.productBalance(counter.db, lhr.id, panadol.id), 50);
  const cEngine = engineFor(counter, gw.url);
  // A cashier at the counter sells. Bill numbers carry the counter number, so they never clash with the main computer.
  const { temporaryPassword } = await mgr.call('users.create', { fullName: 'Counter Cashier', username: 'lhrcash', roleId: (await mgr.call('roles.list', {})).find((r) => r.name === 'Cashier').id });
  await pEngine.run('lan'); // nothing to do on the primary itself
  await cEngine.run('lan');
  const { c: cashier } = await signIn(counter, 'lhrcash', temporaryPassword);
  await cashier.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Cash#123' });
  await cashier.call('shifts.open', { openingCash: '500' });
  const unit = (await cashier.call('products.get', { id: panadol.id })).units.find((u) => u.name === 'Strip').id;
  const sell = async (c, qty) => {
    const q = await c.call('pos.quote', { productId: panadol.id, unitId: unit, qty });
    return c.call('pos.complete', { lines: q.pieces.map((p) => ({ productId: panadol.id, unitId: unit, batchId: p.batchId, qty: p.qty })), cashTendered: String(qty * 30) });
  };
  const sale = await sell(cashier, 2);
  assert.equal(sale.docNo, 'INV-LHR2-0001');
  await cEngine.run('lan');
  assert.equal(stock.productBalance(primary.db, lhr.id, panadol.id), 30, 'the main computer has the counter sale');
  await pEngine.run('cloud');
  await hoEngine.run('cloud');
  assert.ok(ho.db.prepare('SELECT 1 FROM sales WHERE doc_no = ?').get('INV-LHR2-0001'), 'Head Office has the branch sale');

  // Offline: the main computer is switched off; the counter keeps selling, then catches up.
  await pEngine.stop();
  await sell(cashier, 1);
  await sell(cashier, 1);
  const offline = await cEngine.run('lan');
  assert.equal(offline, null);
  assert.equal(cEngine.lan.state, 'offline');
  assert.ok(cEngine.status().lan.pending > 0);
  await pEngine.startServer();
  // The server may come back on a new port; the counter is told the new address.
  counter.localSet('primary_url', `http://127.0.0.1:${pEngine.server.port}`);
  await cEngine.run('lan');
  assert.equal(cEngine.lan.state, 'synced');
  assert.equal(cEngine.status().lan.pending, 0);
  assert.equal(stock.productBalance(primary.db, lhr.id, panadol.id), 10);

  // Two computers sell the last strip while apart: allowed, flagged afterwards, ledger still adds up.
  await pEngine.stop();
  const { c: mgr2 } = await signIn(primary, 'lhrmgr', 'Lahore#1');
  await mgr2.call('shifts.open', { openingCash: '0' });
  await sell(mgr2, 1);
  await sell(cashier, 1);
  await pEngine.startServer();
  counter.localSet('primary_url', `http://127.0.0.1:${pEngine.server.port}`);
  await cEngine.run('lan');
  await cEngine.run('lan');
  // One strip was left and both sold it: -10 tablets on both computers, the same everywhere, and flagged on both.
  assert.equal(stock.productBalance(primary.db, lhr.id, panadol.id), -10);
  assert.equal(stock.productBalance(counter.db, lhr.id, panadol.id), -10);
  for (const a of [primary, counter]) {
    assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM sync_conflicts WHERE kind = 'negative_stock' AND resolved = 0").get().n, 1);
    assert.deepEqual(stock.checkBalances(a.db), []);
  }
  // The batch shows up in the "below zero" list so someone can count it and correct it.
  assert.equal((await mgr2.call('stock.batches', { status: 'negative' })).total, 1);

  // A blocked counter can no longer sync.
  await mgr2.call('devices.revoke', { id: counter.device.id, reason: 'Stolen' });
  const blocked = await cEngine.run('lan');
  assert.equal(blocked, null);
  assert.match(cEngine.lan.lastError, /blocked/);

  await gw.close();
  for (const a of [ho, primary, counter]) { await a.sync.stop(); a.close(); }
});

test('a branch that comes back online after a busy week catches up in pages, with nothing lost or doubled', async () => {
  const { gw, ho, hoEngine, lhr, admin, panadol, joinCode } = await chain();
  const br = makeApp();
  await joinCloud(br, { cloudUrl: gw.url, orgCode: 'TPC', joinCode, deviceName: 'LHR-1' });
  const brEngine = engineFor(br, gw.url);
  const { c: mgr } = await signIn(br, 'lhrmgr', admin.temporaryPassword);
  await mgr.call('auth.changePassword', { currentPassword: admin.temporaryPassword, newPassword: 'Lahore#1' });
  await mgr.call('transfers.receive', { id: (await mgr.call('transfers.list', { direction: 'in' })).rows[0].id });
  await mgr.call('shifts.open', { openingCash: '0' });
  const unit = (await mgr.call('products.get', { id: panadol.id })).units.find((u) => u.name === 'Tablet').id;
  // A week offline: 400 single-tablet bills (thousands of operations).
  for (let i = 0; i < 400; i++) {
    if (i === 0) await mgr.call('adjustments.create', { kind: 'opening', reason: 'Found', lines: [{ productId: panadol.id, batchNo: 'B2', expiryDate: future(200), cost: '25', mrp: '30', qty: 500 }] });
    const q = await mgr.call('pos.quote', { productId: panadol.id, unitId: unit, qty: 1 });
    await mgr.call('pos.complete', { lines: [{ productId: panadol.id, unitId: unit, batchId: q.pieces[0].batchId, qty: 1 }], cashTendered: '3' });
  }
  const waiting = brEngine.status().cloud.pending;
  assert.ok(waiting > 2000, `many operations waiting (${waiting})`);
  await brEngine.run('cloud');
  assert.equal(brEngine.status().cloud.pending, 0);
  await hoEngine.run('cloud');
  assert.equal(ho.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?').get(lhr.id).n, 400);
  assert.equal(stock.productBalance(ho.db, lhr.id, panadol.id), stock.productBalance(br.db, lhr.id, panadol.id));
  const totals = (app) => app.db.prepare("SELECT COUNT(*) AS n, SUM(total) AS t FROM sales WHERE branch_id = ? AND status = 'completed'").get(lhr.id);
  assert.deepEqual(totals(ho), totals(br));
  assert.deepEqual(stock.checkBalances(ho.db), []);
  await gw.close();
  for (const a of [ho, br]) { await a.sync.stop(); a.close(); }
});

test('a crash after the other side stored a batch is harmless: the batch is sent again and ignored', async () => {
  const { gw, ho, owner, hoEngine, joinCode } = await chain();
  await owner.call('suppliers.create', { name: 'Second Supplier' });
  const peer = hoEngine.cloudPeer();
  const { readOps, getCursor } = require('../src/main/sync/ops');
  const ops = readOps(ho.db, { after: getCursor(ho.db, 'cloud', 'push'), excludeSource: 'cloud' });
  await peer.push(ops); // the gateway stores them, then "the computer crashes" before the cursor moves
  const before = (await gw.db.get('SELECT COUNT(*) AS n FROM ops', [])).n;
  await hoEngine.run('cloud');
  assert.equal((await gw.db.get('SELECT COUNT(*) AS n FROM ops', [])).n, before, 'no duplicates in the cloud');
  await gw.close();
  await ho.sync.stop();
  ho.close();
});

test('gateway: tokens are needed, branch devices cannot read other branches or push for them', async () => {
  const { gw, ho, admin, joinCode } = await chain();
  const res = await fetch(`${gw.url}/v1/pull?after=0`);
  assert.equal(res.status, 401);
  const br = makeApp();
  await joinCloud(br, { cloudUrl: gw.url, orgCode: 'TPC', joinCode, deviceName: 'LHR-1' });
  const token = br.localGet('cloud_token');
  const fake = { op_id: 'x'.repeat(32), tbl: 'stock_ledger', row_id: 'R1', kind: 'insert', branch_id: ho.device.branch_id, data: '{}', updated_at: '2026-01-01T00:00:00.000Z' };
  const push = await fetch(`${gw.url}/v1/push`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [fake] }) });
  assert.equal((await push.json()).rejected, 1);
  // Registering the same organisation code from another computer is refused.
  const other = await fetch(`${gw.url}/v1/org/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'OTHER', orgCode: 'TPC', deviceId: 'D', branchId: 'B' }) });
  assert.equal(other.status, 409);
  await gw.close();
  await ho.sync.stop();
  ho.close();
  br.close();
});

test('backups: automatic once a day, copy to an external folder, encrypted, restored with a safety copy first', async () => {
  const key = crypto.randomBytes(32);
  const dir = tempDir();
  const { App } = require('../src/main/core/app');
  const app = new App({ dataDir: dir, backupKey: () => key });
  app.start();
  const { c: owner } = await setUpHeadOffice(app);
  const ext = path.join(tempDir(), 'usb');
  backup.saveSettings(app, { external: ext, encrypt: false });
  const first = await backup.autoIfDue(app);
  assert.ok(fs.existsSync(first.file));
  assert.ok(fs.existsSync(first.copiedTo));
  assert.equal(await backup.autoIfDue(app), null, 'only once a day');
  // Data changes after the backup, then the backup is restored.
  await owner.call('suppliers.create', { name: 'Made after the backup' });
  backup.saveSettings(app, { external: '', encrypt: true });
  const enc = await owner.call('backups.create');
  assert.ok(enc.file.endsWith('.enc'));
  assert.notEqual(fs.readFileSync(enc.file).subarray(0, 7).toString(), 'SQLite ');
  const res = await backup.restore(app, first.file);
  assert.ok(fs.existsSync(res.safetyCopy));
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE name = 'Made after the backup'").get().n, 0);
  // The encrypted one restores too (same key), bringing the supplier back.
  await backup.restore(app, enc.file);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE name = 'Made after the backup'").get().n, 1);
  // A file that is not ours is refused before anything changes.
  const junk = path.join(tempDir(), 'junk.db');
  fs.writeFileSync(junk, 'not a database');
  await assert.rejects(() => backup.restore(app, junk), /not a Mediescare backup/);
  // Signing in still works after restores (sessions were cleared).
  await signIn(app, 'owner', 'Owner#2026');
  app.close();
});

test('Turso adapter sends the HTTP pipeline the gateway expects, and a failed batch is rolled back', async () => {
  // A stand-in for Turso's /v2/pipeline that runs the statements on a local SQLite database.
  const Database = require('better-sqlite3');
  const sql = new Database(':memory:');
  const val = (v) => (v.type === 'null' ? null : v.type === 'integer' ? Number(v.value) : v.value);
  const fakeFetch = async (url, init) => {
    assert.match(url, /\/v2\/pipeline$/);
    assert.equal(init.headers.authorization, 'Bearer secret');
    const body = JSON.parse(init.body);
    const results = [];
    for (const r of body.requests) {
      if (r.type === 'close') { results.push({ type: 'ok', response: { type: 'close' } }); continue; }
      const run = (st) => {
        const s = sql.prepare(st.sql);
        if (s.reader) { const rows = s.raw().all(...st.args.map(val)); return { cols: s.columns().map((c) => ({ name: c.name })), rows: rows.map((row) => row.map((x) => (x === null ? { type: 'null' } : typeof x === 'number' ? { type: 'integer', value: String(x) } : { type: 'text', value: x }))), affected_row_count: 0 }; }
        const info = s.run(...st.args.map(val));
        return { cols: [], rows: [], affected_row_count: info.changes };
      };
      if (r.type === 'execute') { results.push({ type: 'ok', response: { type: 'execute', result: run(r.stmt) } }); continue; }
      const ok = [];
      const errors = [];
      const evalCond = (c) => (c.type === 'ok' ? ok[c.step] === true : c.type === 'not' ? !evalCond(c.cond) : false);
      r.batch.steps.forEach((step, i) => {
        if (step.condition && !evalCond(step.condition)) { ok[i] = false; errors[i] = null; return; }
        try { run(step.stmt); ok[i] = true; errors[i] = null; } catch (e) { ok[i] = false; errors[i] = { message: e.message }; }
      });
      results.push({ type: 'ok', response: { type: 'batch', result: { step_results: [], step_errors: errors } } });
    }
    return { ok: true, json: async () => ({ results }) };
  };
  const db = tursoAdapter({ url: 'libsql://example.turso.io', authToken: 'secret', fetchImpl: fakeFetch });
  await db.batch([{ sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE)', args: [] }]);
  await db.run('INSERT INTO t (id, name) VALUES (?, ?)', [1, 'a']);
  await assert.rejects(db.batch([{ sql: 'INSERT INTO t (id, name) VALUES (?, ?)', args: [2, 'b'] }, { sql: 'INSERT INTO t (id, name) VALUES (?, ?)', args: [3, 'a'] }]), /UNIQUE/);
  assert.deepEqual(await db.all('SELECT id, name FROM t ORDER BY id', []), [{ id: 1, name: 'a' }], 'nothing from the failed batch stayed');
  assert.deepEqual(await db.get('SELECT name FROM t WHERE id = ?', [1]), { name: 'a' });
});

test('backups made by older versions (plain database, old encrypted format) still restore', async () => {
  const key = crypto.randomBytes(32);
  const { App } = require('../src/main/core/app');
  const app = new App({ dataDir: tempDir(), backupKey: () => key });
  app.start();
  const { c: owner } = await setUpHeadOffice(app);
  const plain = path.join(tempDir(), 'old.db');
  app.db.prepare('VACUUM INTO ?').run(plain);
  const old = path.join(tempDir(), 'old.db.enc');
  fs.writeFileSync(old, backup.encrypt(fs.readFileSync(plain), key));
  await owner.call('suppliers.create', { name: 'Later supplier' });
  await backup.restore(app, plain);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE name = 'Later supplier'").get().n, 0);
  await backup.restore(app, old);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM org').get().n, 1);
  // A new backup is compressed: much smaller than the database.
  const made = await backup.create(app, 'manual');
  assert.ok(made.file.endsWith('.db.gz'));
  assert.ok(made.size < fs.statSync(plain).size / 2, `compressed ${made.size} vs ${fs.statSync(plain).size}`);
  app.close();
});

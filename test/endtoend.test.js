'use strict';
// The definition of done from the brief, as one test: a branch runs a full day offline on two computers with different
// roles; Head Office receives stock by batch, transfers it to the branch, and the same day (when the network is back)
// sees that branch's sales, expiry and money; every number traces back to its records.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeApp, tempDir, setUpHeadOffice, signIn } = require('./helpers');
const { SyncEngine } = require('../src/main/sync/engine');
const { joinCloud, joinLan } = require('../src/main/sync/join');
const { createServer } = require('../gateway/server');
const { sqliteAdapter } = require('../gateway/src/adapters');
const stock = require('../src/main/core/stock');

const today = () => stock.today();
const future = (days) => stock.addDays(today(), days);

async function gateway() {
  const server = createServer({ db: sqliteAdapter(path.join(tempDir(), 'gateway.db')), setupKey: '' });
  const url = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  return { url, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

function engineFor(app, cloudUrl) {
  app.sync = new SyncEngine(app, { lanPort: 0, cloudUrl, discovery: false, autoStart: false });
  return app.sync;
}

async function newUser(mgr, app, username, role) {
  const roleId = (await mgr.call('roles.list', {})).find((r) => r.name === role).id;
  return { username, temp: (await mgr.call('users.create', { fullName: `${username} person`, username, roleId })).temporaryPassword };
}

async function firstSignIn(app, u, password) {
  const { c } = await signIn(app, u.username, u.temp);
  await c.call('auth.changePassword', { currentPassword: u.temp, newPassword: password });
  return c;
}

test('definition of done: offline branch day on two computers, Head Office sees sales, expiry and money the same day', async () => {
  const gw = await gateway();
  // ---- Head Office receives stock by batch and sends some to Lahore ----
  const ho = makeApp();
  const { c: owner } = await setUpHeadOffice(ho);
  const hoEngine = engineFor(ho, gw.url);
  await hoEngine.start();
  const { branch: lhr, admin } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'Lahore Manager', username: 'lhrmgr' } });
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors' });
  const panadol = await owner.call('products.create', { brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25' });
  await owner.call('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'INV-77', post: true, lines: [
    { productId: panadol.id, batchNo: 'SOON', expiryDate: future(25), qty: 600, price: '24', mrp: '30' },
    { productId: panadol.id, batchNo: 'LATER', expiryDate: future(400), qty: 5000, price: '25', mrp: '30' },
  ] });
  const tr = await owner.call('transfers.create', { mode: 'send', otherBranchId: lhr.id, dispatch: true, lines: [{ productId: panadol.id, qty: 1000 }] });
  const sent = await owner.call('transfers.get', { id: tr.id });
  assert.deepEqual(sent.lines.map((l) => [l.batchNo, l.qty]), [['SOON', 600], ['LATER', 400]], 'FEFO: the batch expiring first goes first (quantities in tablets)');
  const { code: joinCode } = await owner.call('devices.createJoinCode', { branchId: lhr.id });
  await hoEngine.run('cloud');

  // ---- Lahore: main computer joins over the cloud with Head Office's join code, a counter over the shop network ----
  const main = makeApp();
  await joinCloud(main, { cloudUrl: gw.url, orgCode: 'TPC', joinCode, deviceName: 'LHR-MAIN' });
  const mEngine = engineFor(main, gw.url);
  await mEngine.start();
  const mgr = await firstSignIn(main, { username: 'lhrmgr', temp: admin.temporaryPassword }, 'Lahore#1');
  await mgr.call('transfers.receive', { id: (await mgr.call('transfers.list', { direction: 'in' })).rows[0].id });
  const pharmU = await newUser(mgr, main, 'lhrpharm', 'Pharmacist');
  const cashU = await newUser(mgr, main, 'lhrcash', 'Cashier');
  const counter = makeApp();
  await joinLan(counter, { primaryUrl: `http://127.0.0.1:${mEngine.server.port}`, pairingCode: (await mgr.call('lan.pairingCode')).code, username: 'lhrmgr', password: 'Lahore#1', deviceName: 'Counter 2' });
  const cEngine = engineFor(counter, gw.url);

  // ---- The internet and the main computer's service go down for the whole day ----
  await mEngine.stop();
  const cashier = await firstSignIn(counter, cashU, 'Cash#1234');
  const pharm = await firstSignIn(main, pharmU, 'Pharm#1234');
  await cashier.call('shifts.open', { openingCash: '1000' });
  await pharm.call('shifts.open', { openingCash: '500' });
  const strip = (await cashier.call('products.get', { id: panadol.id })).units.find((u) => u.name === 'Strip').id;
  const sell = async (c, strips, pay = {}) => {
    const q = await c.call('pos.quote', { productId: panadol.id, unitId: strip, qty: strips });
    return c.call('pos.complete', { lines: q.pieces.map((p) => ({ productId: panadol.id, unitId: strip, batchId: p.batchId, qty: p.qty })), cashTendered: String(strips * 30), ...pay });
  };
  const bills = [];
  bills.push(await sell(cashier, 2));
  bills.push(await sell(cashier, 3));
  bills.push(await sell(cashier, 1, { cashTendered: '0', payments: [{ method: 'card', amount: '30' }] }));
  bills.push(await sell(pharm, 4));
  assert.deepEqual(bills.map((b) => b.docNo), ['INV-LHR2-0001', 'INV-LHR2-0002', 'INV-LHR2-0003', 'INV-LHR1-0001'], 'numbers never clash between computers');
  // The pharmacist takes back one strip of their own bill; the manager pays for tea from the drawer.
  const pbill = await pharm.call('sales.get', { id: bills[3].id });
  const ret = await pharm.call('sales.return', { saleId: bills[3].id, reason: 'Doctor changed the medicine', lines: [{ lineId: pbill.lines[0].id, qty: 10 }] });
  const tea = (await mgr.call('expenses.categories', {})).find((x) => x.name === 'Tea and refreshments').id;
  await mgr.call('expenses.create', { date: today(), categoryId: tea, description: 'Tea for staff', amount: '150', method: 'drawer' });
  // Nothing has left the branch yet.
  assert.equal(ho.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?").get(lhr.id).n, 0);

  // ---- Evening: the network is back ----
  await mEngine.startServer();
  counter.localSet('primary_url', `http://127.0.0.1:${mEngine.server.port}`);
  await cEngine.run('lan');
  await mEngine.run('cloud');
  await hoEngine.run('cloud');

  // ---- Head Office the same day ----
  const salesTotal = bills.reduce((a, b) => a + b.total, 0);
  assert.equal(salesTotal, 10 * 3000);
  const daily = await owner.call('reports.run', { report: 'daily_sales', from: today(), to: today(), branchId: lhr.id });
  assert.equal(daily.rows[0].bills, 4);
  assert.equal(daily.rows[0].sales, salesTotal);
  assert.equal(daily.rows[0].returns, ret.total);
  assert.equal(daily.rows[0].card, 3000);
  const expiry = await owner.call('reports.run', { report: 'expiry', branchId: lhr.id, days: 30 });
  assert.equal(expiry.rows.length, 1);
  assert.equal(expiry.rows[0].batchNo, 'SOON');
  assert.equal(expiry.rows[0].qty, 600 - 100 + 10, 'the near-expiry batch went first on both computers; one strip came back');
  const journal = await owner.call('finance.journal', { from: today(), to: today(), branchId: lhr.id });
  const by = Object.fromEntries(journal.summary.map((s) => [s.kind, s]));
  assert.equal(by.sale.count, 4);
  assert.equal(by.sale.moneyIn, salesTotal);
  assert.equal(by.sale_return.moneyOut, ret.refundAmount);
  assert.equal(by.expense.moneyOut, 15000);
  const all = await owner.call('dashboard.allBranches', { from: today(), to: today() });
  assert.equal(all.rows.find((r) => r.id === lhr.id).net, salesTotal - ret.total);
  const recon = await owner.call('reports.run', { report: 'reconciliation', from: today(), to: today(), branchId: lhr.id });
  assert.ok(recon.rows.every((r) => r.difference === 0));
  assert.equal(recon.rows[0].transfersIn, 1000);
  assert.equal(recon.rows[0].sales, -100);
  assert.equal(recon.rows[0].customerReturns, 10);
  // Every number traces to its records: each bill opens at Head Office with its lines, payments and batches.
  for (const b of bills) {
    const s = await owner.call('sales.get', { id: b.id });
    assert.equal(s.total, b.total);
    assert.ok(s.lines.every((l) => l.batchNo));
  }
  // The same data on every computer: ledgers equal, balances consistent.
  const ledger = (app) => app.db.prepare('SELECT id, qty FROM stock_ledger WHERE branch_id = ? ORDER BY id').all(lhr.id);
  assert.deepEqual(ledger(main), ledger(ho));
  assert.deepEqual(ledger(counter), ledger(main));
  for (const a of [ho, main, counter]) assert.deepEqual(stock.checkBalances(a.db), []);

  await gw.close();
  for (const a of [ho, main, counter]) { if (a.sync) await a.sync.stop(); a.close(); }
});

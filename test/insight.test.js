'use strict';
// Phase 4: expenses and petty cash, the financial journal, reports, dashboards, approvals, notifications, search
// and keyboard shortcuts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, setUpHeadOffice, signIn } = require('./helpers');
const stock = require('../src/main/core/stock');

const future = (days) => stock.addDays(stock.today(), days);
const today = () => stock.today();

async function roleId(c, name) {
  return (await c.call('roles.list', {})).find((r) => r.name === name).id;
}

async function makeUser(app, owner, username, role) {
  const { temporaryPassword } = await owner.call('users.create', { fullName: `${username} person`, username, roleId: await roleId(owner, role) });
  const { c } = await signIn(app, username, temporaryPassword);
  await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123' });
  return c;
}

async function world() {
  const app = makeApp();
  const { c: owner } = await setUpHeadOffice(app);
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors' });
  const panadol = await owner.call('products.create', { brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25', barcodes: ['8964000111222'] });
  const calpol = await owner.call('products.create', { brandName: 'Calpol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '28', tradePrice: '22', reorderLevel: 500 });
  await owner.call('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'I-1', post: true, lines: [
    { productId: panadol.id, batchNo: 'SOON', expiryDate: future(20), qty: 50, price: '25', mrp: '30' },
    { productId: panadol.id, batchNo: 'LATER', expiryDate: future(400), qty: 500, price: '26', mrp: '32' },
    { productId: calpol.id, batchNo: 'C1', expiryDate: future(300), qty: 100, price: '22', mrp: '28' },
  ] });
  const cashier = await makeUser(app, owner, 'cash1', 'Cashier');
  await cashier.call('shifts.open', { openingCash: '1000' });
  const units = (p) => Object.fromEntries(p.units.map((u) => [u.name, u.id]));
  return { app, owner, cashier, supplier, panadol, calpol, units };
}

async function cartLines(c, items) {
  const lines = [];
  const reserved = [];
  for (const it of items) {
    const q = await c.call('pos.quote', { productId: it.product.id, unitId: it.unitId, qty: it.qty, reserved });
    for (const piece of q.pieces) {
      lines.push({ productId: it.product.id, unitId: q.unitId, batchId: piece.batchId, qty: piece.qty, discount: it.discount });
      reserved.push({ batchId: piece.batchId, qty: piece.qty });
    }
  }
  return lines;
}

const expected = async (c) => (await c.call('shifts.current')).shift.summary.expectedCash;

test('expenses and petty cash: drawer, petty box, cancel, approval above the limit', async () => {
  const { app, owner, cashier } = await world();
  const acc = await makeUser(app, owner, 'acc1', 'Accountant');
  const cats = await acc.call('expenses.categories', { active: true });
  assert.equal(cats.length, 10, 'default categories are there');
  const tea = cats.find((c) => c.name === 'Tea and refreshments').id;
  assert.equal(await expected(cashier), 100000);

  // Petty cash top-up through the drawer: cash leaves the drawer, the box gets it.
  await acc.call('pettycash.move', { kind: 'topup', amount: '500', viaDrawer: true, reason: 'Weekly float' });
  assert.equal(await expected(cashier), 50000);
  const e1 = await acc.call('expenses.create', { date: today(), categoryId: tea, description: 'Tea for staff', amount: '200', method: 'petty' });
  assert.equal(e1.status, 'posted');
  assert.match(e1.docNo, /^EXP-HO1-/);
  assert.equal((await acc.call('pettycash.book', {})).balance, 30000);
  assert.match((await acc.fail('expenses.create', { date: today(), categoryId: tea, description: 'Biscuits', amount: '400', method: 'petty' })).message, /only 300.00/);
  assert.equal((await acc.fail('expenses.create', { date: future(1), categoryId: tea, description: 'x', amount: '1', method: 'petty' })).code, 'VALIDATION');

  // Paid from the drawer: a cash movement of the open shift, so the expected cash goes down; cancel puts it back.
  const e2 = await acc.call('expenses.create', { date: today(), categoryId: tea, description: 'Milk', amount: '150', method: 'drawer' });
  assert.equal(await expected(cashier), 35000);
  await acc.call('expenses.cancel', { id: e2.id, reason: 'Entered twice' });
  assert.equal(await expected(cashier), 50000);
  assert.equal((await acc.fail('expenses.cancel', { id: e2.id, reason: 'again' })).code, 'WRONG_STATUS');
  assert.equal((await acc.fail('expenses.create', { date: today(), categoryId: tea, description: 'x', amount: '5', method: 'bank' })).code, 'VALIDATION', 'bank needs a reference');

  // Above the limit: waits for a manager (or, from the drawer, needs one now).
  await owner.call('settings.update', { scope: 'global', values: { 'expenses.approvalValue': 100 } });
  const rent = cats.find((c) => c.name === 'Rent').id;
  const big = await acc.call('expenses.create', { date: today(), categoryId: rent, description: 'Shop rent', amount: '500', method: 'bank', reference: 'TRX-9' });
  assert.equal(big.status, 'pending');
  const err = await acc.fail('expenses.create', { date: today(), categoryId: rent, description: 'Cash rent', amount: '500', method: 'drawer' });
  assert.equal(err.code, 'NEEDS_APPROVAL');
  assert.deepEqual(err.details.needs, ['expenses.approve']);
  assert.equal((await acc.fail('expenses.decide', { id: big.id, approve: true })).code, 'FORBIDDEN');
  const queue = await owner.call('approvals.list', {});
  const item = queue.rows.find((r) => r.kind === 'expense' && r.id === big.id);
  assert.ok(item && item.canDecide, 'the owner sees the expense in the approval queue');
  const decided = await owner.call('expenses.decide', { id: big.id, approve: true });
  assert.equal(decided.status, 'posted');
  assert.equal(decided.decidedBy, 'Owner Person');
  const history = await owner.call('approvals.list', { status: 'decided' });
  assert.ok(history.rows.some((r) => r.id === big.id && r.status === 'approved'));

  const list = await acc.call('expenses.list', { from: today(), to: today() });
  assert.equal(list.totals.posted, 20000 + 50000);

  // The journal: expenses are money out, the drawer/petty move is not, the cancelled one shows both sides.
  const j = await acc.call('finance.journal', { from: today(), to: today(), kinds: ['expense', 'expense_cancel', 'petty_topup', 'cash_out'] });
  const by = Object.fromEntries(j.summary.map((s) => [s.kind, s]));
  assert.equal(by.expense.count, 3);
  assert.equal(by.expense.moneyOut, 20000 + 15000 + 50000);
  assert.equal(by.expense_cancel.moneyIn, 15000);
  assert.equal(by.petty_topup.moneyOut + by.petty_topup.moneyIn, 0);
  assert.equal(by.cash_out, undefined, 'the top-up from the drawer is not shown as cash taken out');
  app.close();
});

test('journal, reports and dashboard agree with the documents', async () => {
  const { app, owner, cashier, panadol, calpol, units } = await world();
  const s1 = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 7 }]), cashTendered: '250' });
  const s2 = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: calpol, unitId: units(calpol).Strip, qty: 1 }]), payments: [{ method: 'card', amount: '28' }] });
  assert.equal(s1.total + s2.total, 24200);
  const sale = await owner.call('sales.get', { id: s1.id });
  const ret = await owner.call('sales.return', { saleId: s1.id, reason: 'Not needed', lines: [{ lineId: sale.lines[1].id, qty: 1 }] });
  await cashier.call('shifts.cashMove', { kind: 'in', amount: '50', reason: 'Change from the bank' });

  const j = await owner.call('finance.journal', { from: today(), to: today() });
  const by = Object.fromEntries(j.summary.map((s) => [s.kind, s]));
  assert.equal(by.sale.amount, 24200);
  assert.equal(by.sale.moneyIn, 24200);
  assert.equal(by.sale_return.moneyOut, ret.refundAmount);
  assert.equal(by.cash_in.moneyIn, 5000);
  assert.equal(by.purchase.payable, by.purchase.amount);
  assert.equal(j.totals.moneyIn - j.totals.moneyOut, 24200 - ret.refundAmount + 5000);
  assert.ok(j.rows.every((r) => r.kindLabel));

  // Every report in the catalogue runs.
  const catalog = await owner.call('reports.catalog', {});
  assert.ok(catalog.length >= 18);
  for (const r of catalog) {
    const res = await owner.call('reports.run', { report: r.key, from: today(), to: today() });
    assert.ok(Array.isArray(res.rows) && res.columns.length, `report ${r.key}`);
  }
  const daily = await owner.call('reports.run', { report: 'daily_sales', from: today(), to: today() });
  assert.equal(daily.rows.length, 1);
  assert.equal(daily.rows[0].sales, 24200);
  assert.equal(daily.rows[0].returns, ret.total);
  assert.equal(daily.rows[0].cash, 21400);
  assert.equal(daily.rows[0].card, 2800);
  assert.equal(daily.totals.net, 24200 - ret.total);
  const byProduct = await owner.call('reports.run', { report: 'sales_by_product', from: today(), to: today() });
  assert.equal(byProduct.rows.find((r) => r.name === 'Panadol 500mg').qty, 69);
  const recon = await owner.call('reports.run', { report: 'reconciliation', from: today(), to: today() });
  assert.ok(recon.rows.length >= 2);
  assert.ok(recon.rows.every((r) => r.difference === 0), 'expected closing equals on-hand stock');
  const pan = recon.rows.find((r) => r.product === 'Panadol 500mg');
  assert.equal(pan.purchases, 550);
  assert.equal(pan.sales, -70);
  assert.equal(pan.customerReturns, 1);
  assert.equal(pan.actual, 481);
  const summary = await owner.call('reports.run', { report: 'management_summary', from: today(), to: today() });
  assert.equal(summary.rows.find((r) => r.measure === 'Net sales').value, 24200 - ret.total);

  // A cashier has no reports; an accountant sees money reports but a store keeper does not.
  assert.equal((await cashier.fail('reports.run', { report: 'daily_sales', from: today(), to: today() })).code, 'FORBIDDEN');
  const keeper = await makeUser(app, owner, 'store1', 'Store Keeper');
  assert.equal((await keeper.fail('reports.run', { report: 'management_summary', from: today(), to: today() })).code, 'FORBIDDEN');
  assert.ok((await keeper.call('reports.catalog', {})).every((r) => !['management_summary', 'tax', 'receivables'].includes(r.key)));
  assert.equal((await owner.fail('reports.run', { report: 'daily_sales', from: today(), to: future(-1) })).code, 'VALIDATION');

  // Export uses the same rows.
  const exp = await owner.call('export.run', { source: 'reports.run', title: 'Daily sales', format: 'csv', params: { report: 'daily_sales', from: today(), to: today() },
    columns: daily.columns });
  assert.ok(exp.saved);

  const d = await owner.call('dashboard.branch', {});
  assert.equal(d.todayFigures.sales, 24200);
  assert.equal(d.todayFigures.cash, 21400);
  assert.equal(d.todayFigures.card, 2800);
  assert.equal(d.todayFigures.returns.total, ret.total);
  assert.equal(d.trend.length, 30);
  assert.equal(d.trend[29].net, 24200 - ret.total);
  assert.equal(d.stock.low, 1, 'Calpol is below its reorder level');
  assert.equal(d.expiry.near, 0, 'FEFO sold the batch expiring soon first');
  assert.ok(d.topProducts[0].name.startsWith('Panadol'));
  const all = await owner.call('dashboard.allBranches', {});
  assert.equal(all.rows.length, 1);
  assert.equal(all.rows[0].net, 24200 - ret.total);
  app.close();
});

test('approval requests from another computer: decided by a manager, used once by the requester', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 2, discount: '15' }]);
  const err = await cashier.fail('pos.complete', { lines, cashTendered: '100' });
  assert.equal(err.code, 'NEEDS_APPROVAL');
  const req = await cashier.call('approvals.request', { needs: err.details.needs, summary: '15% discount for a regular customer', kind: 'sale' });
  assert.equal(req.status, 'pending');
  assert.equal(req.token, null);
  assert.equal((await cashier.fail('approvals.decide', { id: req.id, approve: true })).code, 'FORBIDDEN');
  const queue = await owner.call('approvals.list', {});
  assert.ok(queue.rows.find((r) => r.kind === 'counter' && r.id === req.id).canDecide);
  assert.equal((await owner.call('notifications.list', {})).items.find((n) => n.key === 'approvals.pending').count, 1);
  await owner.call('approvals.decide', { id: req.id, approve: true, reason: 'Known customer' });
  const st = await cashier.call('approvals.status', { id: req.id });
  assert.equal(st.status, 'approved');
  assert.equal(st.token, `req:${req.id}`);
  const sale = await cashier.call('pos.complete', { lines, cashTendered: '100', approvalToken: st.token });
  assert.equal(app.db.prepare('SELECT approved_by FROM sales WHERE id = ?').get(sale.id).approved_by, app.db.prepare("SELECT id FROM users WHERE username = 'owner'").get().id);
  assert.equal((await cashier.fail('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1, discount: '15' }]), cashTendered: '100', approvalToken: st.token })).code, 'APPROVAL');
  assert.equal((await cashier.call('approvals.status', { id: req.id })).status, 'used');
  // Another person cannot use someone else's approval.
  const other = await makeUser(app, owner, 'cash2', 'Cashier');
  assert.equal((await other.fail('approvals.status', { id: req.id })).code, 'FORBIDDEN');

  // Cancelling a bill: rejected first, then approved.
  assert.equal((await cashier.fail('sales.void', { id: sale.id, reason: 'Wrong items' })).code, 'NEEDS_APPROVAL');
  const v1 = await cashier.call('approvals.request', { needs: ['sales.void'], summary: `Cancel ${sale.docNo}`, kind: 'void' });
  assert.equal((await owner.fail('approvals.decide', { id: v1.id, approve: false })).code, 'VALIDATION', 'a rejection needs a reason');
  await owner.call('approvals.decide', { id: v1.id, approve: false, reason: 'Sell the right items instead' });
  assert.equal((await cashier.call('approvals.status', { id: v1.id })).status, 'rejected');
  assert.equal((await cashier.fail('sales.void', { id: sale.id, reason: 'Wrong items', approvalToken: `req:${v1.id}` })).code, 'APPROVAL');
  const v2 = await cashier.call('approvals.request', { needs: ['sales.void'], summary: `Cancel ${sale.docNo}`, kind: 'void' });
  await owner.call('approvals.decide', { id: v2.id, approve: true });
  const voided = await cashier.call('sales.void', { id: sale.id, reason: 'Wrong items', approvalToken: `req:${v2.id}` });
  assert.equal(voided.status, 'voided');

  // Nobody decides their own request, even a manager.
  const mgr = await makeUser(app, owner, 'mgr1', 'Branch Admin');
  const own = await mgr.call('approvals.request', { needs: ['discount.above_limit'], summary: 'x' });
  assert.match((await mgr.fail('approvals.decide', { id: own.id, approve: true })).message, /your own request/);
  assert.equal((await cashier.fail('approvals.request', { needs: ['users.delete'], summary: 'x' })).code, 'VALIDATION');
  app.close();
});

test('notifications, global search and keyboard shortcuts', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const n = await owner.call('notifications.list', {});
  const keys = n.items.map((x) => x.key);
  assert.ok(keys.includes('stock.low'), 'Calpol is low');
  assert.ok(keys.includes('expiry.near'), 'batch SOON expires in 20 days');
  assert.ok(keys.includes('backup.stale'), 'no backup yet');
  assert.ok(n.unread >= 3);
  const seen = await owner.call('notifications.markSeen', {});
  assert.equal(seen.unread, 0);
  // A cashier sees no stock or backup warnings they cannot act on.
  assert.ok((await cashier.call('notifications.list', {})).items.every((x) => !x.key.startsWith('backup') && !x.key.startsWith('sync')));

  const sale = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1 }]), cashTendered: '50' });
  assert.deepEqual((await owner.call('search.global', { q: '8964000111222' })).exact, { path: 'product', params: { id: panadol.id } });
  assert.deepEqual((await owner.call('search.global', { q: sale.docNo })).exact, { path: 'sale', params: { id: sale.id } });
  const res = await owner.call('search.global', { q: 'para' });
  assert.ok(res.groups.find((g) => g.key === 'products').items.length === 2);
  assert.ok(!(await cashier.call('search.global', { q: 'ali' })).groups.some((g) => g.key === 'suppliers'), 'a cashier cannot search suppliers');
  assert.deepEqual((await owner.call('search.global', { q: 'x' })).groups, []);

  const sc = await cashier.call('shortcuts.get', {});
  assert.equal(sc.bindings['pos.pay'], 'F10');
  assert.match((await cashier.fail('shortcuts.save', { bindings: { 'go.pos': 'F2' } })).message, /F2 is used for both/);
  assert.equal((await cashier.fail('shortcuts.save', { bindings: { 'go.pos': 'P' } })).code, 'VALIDATION');
  const saved = await cashier.call('shortcuts.save', { bindings: { 'go.pos': 'Alt+O', 'pos.pay': 'F12' } });
  assert.equal(saved.bindings['go.pos'], 'Alt+O');
  assert.deepEqual(saved.overrides, { 'go.pos': 'Alt+O', 'pos.pay': 'F12' });
  assert.equal((await cashier.call('auth.me', {})).user.prefs.shortcuts['pos.pay'], 'F12');
  const ownerId = app.db.prepare("SELECT id FROM users WHERE username = 'owner'").get().id;
  assert.equal((await cashier.fail('shortcuts.get', { userId: ownerId })).code, 'FORBIDDEN');
  const cashierId = app.db.prepare("SELECT id FROM users WHERE username = 'cash1'").get().id;
  const reset = await owner.call('shortcuts.reset', { userId: cashierId });
  assert.deepEqual(reset.overrides, {});
  app.close();
});

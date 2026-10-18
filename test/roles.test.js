'use strict';
// Role-by-role permission tests. For every default role and every RPC method that needs a permission:
//   - a role without any of the method's permissions is refused before the service runs;
//   - a role with one of them is never refused for lack of permission.
// Then: cost and profit never reach roles without cost.view, and branch data stays in its branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, setUpHeadOffice, signIn } = require('./helpers');
const rpc = require('../src/main/rpc');
const { DEFAULT_ROLES } = require('../src/main/core/permissions');
const { t } = require('../src/main/core/messages');
const stock = require('../src/main/core/stock');

const NO_PERMISSION = t('error.noPermission');
// Methods that change things on this computer even with empty parameters; only the refusal side is checked for them.
const SIDE_EFFECTS = new Set(['shifts.open', 'backups.create', 'lan.setPrimary', 'sync.now', 'cloud.connect', 'backups.restore', 'backups.settings',
  'lan.pairingCode', 'device.saveSettings', 'org.newRecoveryKey', 'devices.createJoinCode', 'settings.update', 'export.print', 'labels.print', 'notifications.markSeen', 'shortcuts.reset']);

async function world() {
  const app = makeApp();
  const { c: owner } = await setUpHeadOffice(app);
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors' });
  const p = await owner.call('products.create', { brandName: 'Panadol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25' });
  await owner.call('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'I-1', post: true, lines: [{ productId: p.id, batchNo: 'B1', expiryDate: stock.addDays(stock.today(), 300), qty: 100, price: '25', mrp: '30' }] });
  const roles = await owner.call('roles.list', {});
  const users = {};
  for (const r of DEFAULT_ROLES.filter((x) => !x.isSuper)) {
    const username = r.name.toLowerCase().replace(/\s+/g, '');
    const { temporaryPassword } = await owner.call('users.create', { fullName: `${r.name} person`, username, roleId: roles.find((x) => x.name === r.name).id });
    const { c } = await signIn(app, username, temporaryPassword);
    await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123' });
    users[r.name] = { c, perms: new Set(r.permissions) };
  }
  return { app, owner, users, product: p };
}

test('every permission-protected method refuses roles without the permission and accepts roles with it', async () => {
  const { app, users } = await world();
  const methods = rpc.list().filter((m) => m.auth !== 'none' && m.perm);
  assert.ok(methods.length > 150, `found ${methods.length} protected methods`);
  const wrong = [];
  for (const [role, u] of Object.entries(users)) {
    for (const m of methods) {
      const needed = Array.isArray(m.perm) ? m.perm : [m.perm];
      const has = needed.some((p) => u.perms.has(p));
      if (has && SIDE_EFFECTS.has(m.name)) continue;
      const res = await rpc.call(app, u.c.key, m.name, {});
      const refused = !res.ok && res.error.code === 'FORBIDDEN' && res.error.message === NO_PERMISSION;
      if (!has && !refused) wrong.push(`${role} could call ${m.name} without ${needed.join(' or ')}`);
      if (has && refused) wrong.push(`${role} was refused ${m.name} although it has ${needed.join(' or ')}`);
    }
  }
  assert.deepEqual(wrong, []);
  app.close();
});

test('cost and profit never reach roles without cost.view', async () => {
  const { app, owner, users, product } = await world();
  const cashier = users.Cashier.c;
  const pharm = users.Pharmacist.c;
  await cashier.call('shifts.open', { openingCash: '0' });
  const q = await cashier.call('pos.quote', { productId: product.id, qty: 10 });
  const sale = await cashier.call('pos.complete', { lines: q.pieces.map((x) => ({ productId: product.id, unitId: q.unitId, batchId: x.batchId, qty: x.qty })), cashTendered: '10000' });
  for (const [label, c] of [['Cashier', cashier], ['Pharmacist', pharm]]) {
    const list = await c.call('products.list', {});
    assert.equal(list.rows[0].tradePrice, null, `${label}: trade price hidden in the product list`);
    const one = await c.call('products.get', { id: product.id });
    assert.equal(one.tradePrice, null, `${label}: trade price hidden on the product`);
    const sales = await c.call('sales.list', {});
    assert.equal(sales.rows[0].profit, null, `${label}: profit hidden in sales`);
    assert.equal(sales.totals.profit, null);
    const bill = JSON.stringify(await c.call('sales.get', { id: sale.id }));
    assert.ok(!/"cost":\d/.test(bill), `${label}: no cost on the bill`);
  }
  const batches = await pharm.call('stock.batches', {});
  assert.ok(batches.rows.every((b) => b.cost === null), 'batch cost hidden');
  assert.equal((await pharm.fail('stock.valuation', {})).message, t('error.costHidden'));
  const dash = await pharm.call('dashboard.branch', {});
  assert.equal(dash.todayFigures.profit, null, 'no profit on the dashboard');
  assert.equal(dash.balances, undefined, 'no money owed without financial reports');
  // The store keeper has cost.view but not financial reports.
  const keeper = users['Store Keeper'].c;
  assert.ok((await keeper.call('stock.batches', {})).rows.every((b) => typeof b.cost === 'number'));
  // Export cannot be used to get round it.
  const exp = await pharm.fail('export.run', { source: 'stock.valuation', title: 'x', format: 'csv', columns: [{ key: 'value', type: 'money' }] });
  assert.equal(exp.code, 'FORBIDDEN');
  void owner;
  app.close();
});

test('branch staff only see their branch; the owner can choose', async () => {
  const { app, owner, users } = await world();
  const { branch: lhr, admin } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'Lahore manager', username: 'lhrmgr' } });
  const mgr = (await signIn(app, 'lhrmgr', admin.temporaryPassword).catch((e) => ({ error: e }))) || {};
  // The Lahore manager cannot sign in on the Head Office computer at all (devices belong to one branch).
  assert.ok(mgr.error, 'branch user cannot sign in on another branch computer');
  const accountant = users.Accountant.c;
  for (const method of ['finance.journal', 'reports.run', 'expenses.list']) {
    const res = await accountant.fail(method, { branchId: lhr.id, from: stock.today(), to: stock.today(), report: 'daily_sales' });
    assert.equal(res.code, 'FORBIDDEN', `${method} refuses another branch`);
  }
  assert.equal((await accountant.fail('dashboard.allBranches', {})).code, 'FORBIDDEN');
  const all = await owner.call('reports.run', { report: 'daily_sales', from: stock.today(), to: stock.today(), branchId: 'all' });
  assert.equal(all.branchName, 'All branches');
  app.close();
});

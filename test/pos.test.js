'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, setUpHeadOffice, signIn } = require('./helpers');
const stock = require('../src/main/core/stock');

const future = (days) => stock.addDays(stock.today(), days);

async function roleId(c, name) {
  return (await c.call('roles.list', {})).find((r) => r.name === name).id;
}

async function makeUser(app, owner, username, role) {
  const { temporaryPassword } = await owner.call('users.create', { fullName: `${username} person`, username, roleId: await roleId(owner, role) });
  const { c } = await signIn(app, username, temporaryPassword);
  await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123' });
  return c;
}

// Org with Panadol (strip of 10, MRP 30/strip) in two batches, a controlled drug, and a cashier with an open shift.
async function world() {
  const app = makeApp();
  const { c: owner } = await setUpHeadOffice(app);
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors' });
  const panadol = await owner.call('products.create', { brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25', units: [{ name: 'Box', factor: 100 }] });
  const calpol = await owner.call('products.create', { brandName: 'Calpol', genericName: 'paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '28', tradePrice: '22' });
  const xanax = await owner.call('products.create', { brandName: 'Xanax', genericName: 'Alprazolam', strength: '0.5mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '100', tradePrice: '80', rxRequired: true, controlled: true });
  const augmentin = await owner.call('products.create', { brandName: 'Augmentin', strength: '625mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 6, mrp: '300', tradePrice: '250', rxRequired: true, taxRate: '17' });
  await owner.call('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'I-1', post: true, lines: [
    { productId: panadol.id, batchNo: 'SOON', expiryDate: future(20), qty: 50, price: '25', mrp: '30' },
    { productId: panadol.id, batchNo: 'LATER', expiryDate: future(400), qty: 500, price: '26', mrp: '32' },
    { productId: calpol.id, batchNo: 'C1', expiryDate: future(300), qty: 100, price: '22', mrp: '28' },
    { productId: xanax.id, batchNo: 'X1', expiryDate: future(300), qty: 100, price: '80', mrp: '100' },
    { productId: augmentin.id, batchNo: 'A1', expiryDate: future(300), qty: 60, price: '250', mrp: '300' },
  ] });
  const cashier = await makeUser(app, owner, 'cash1', 'Cashier');
  await cashier.call('shifts.open', { openingCash: '1000' });
  const units = (p) => Object.fromEntries(p.units.map((u) => [u.name, u.id]));
  return { app, owner, cashier, supplier, panadol, calpol, xanax, augmentin, units };
}

// Builds sale lines from quotes, the way the counter screen does.
async function cartLines(c, items) {
  const lines = [];
  const reserved = [];
  for (const it of items) {
    const q = await c.call('pos.quote', { productId: it.product.id, unitId: it.unitId, qty: it.qty, reserved, batchId: it.batchId });
    for (const piece of q.pieces) {
      lines.push({ productId: it.product.id, unitId: q.unitId, batchId: piece.batchId, qty: piece.qty, discount: it.discount, price: it.price });
      reserved.push({ batchId: piece.batchId, qty: piece.qty });
    }
  }
  return lines;
}

test('quote: FEFO batches, unit prices from the batch MRP, near-expiry flag, branch price', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const u = units(panadol);
  const q = await cashier.call('pos.quote', { productId: panadol.id, unitId: u.Strip, qty: 7 });
  // 7 strips = 70 tablets: 50 from the batch expiring first, 20 from the next.
  assert.deepEqual(q.pieces.map((p) => [p.batchNo, p.qty, p.unitPrice]), [['SOON', 50, 3000], ['LATER', 20, 3200]]);
  assert.equal(q.pieces[0].nearExpiry, true);
  assert.equal(q.pieces[0].gross, 15000);
  assert.equal(q.units.find((x) => x.name === 'Tablet').price, 300);
  assert.equal(q.units.find((x) => x.name === 'Box').price, 30000);
  // Reserved stock in the cart is not offered twice.
  const q2 = await cashier.call('pos.quote', { productId: panadol.id, unitId: u.Tablet, qty: 10, reserved: [{ batchId: q.pieces[0].batchId, qty: 50 }] });
  assert.equal(q2.pieces[0].batchNo, 'LATER');
  // A branch price replaces the batch MRP.
  await owner.call('products.setBranch', { id: panadol.id, branchMrp: '35', priceReason: 'Local price' });
  const q3 = await cashier.call('pos.quote', { productId: panadol.id, unitId: u.Strip, qty: 1 });
  assert.equal(q3.pieces[0].unitPrice, 3500);
  // Substitutes: same salt, any case.
  const subs = await cashier.call('pos.substitutes', { productId: panadol.id });
  assert.deepEqual(subs.map((s) => s.label), ['Calpol 500mg']);
  app.close();
});

test('cash sale: totals, change is not revenue, stock and cost of goods, shift cash', async () => {
  const { app, cashier, panadol, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 7 }]);
  const res = await cashier.call('pos.complete', { lines, cashTendered: '250' });
  assert.equal(res.docNo, 'INV-HO1-0001');
  assert.equal(res.total, 15000 + 6400);
  assert.equal(res.change, 25000 - 21400);
  const sale = await cashier.call('sales.get', { id: res.id });
  assert.equal(sale.total, 21400);
  assert.equal(sale.paid, 21400);
  assert.equal(sale.payments[0].amount, 21400, 'only the applied cash is recorded, not what was handed over');
  assert.equal(sale.lines.length, 2);
  assert.equal(stock.productBalance(app.db, app.device.branch_id, panadol.id), 550 - 70);
  // Cost of goods = batch cost of what left the shelf.
  const row = app.db.prepare('SELECT cost FROM sales WHERE id = ?').get(res.id);
  assert.equal(row.cost, stock.valueOf(2500, 50, 10) + stock.valueOf(2600, 20, 10));
  const shift = (await cashier.call('shifts.current')).shift;
  assert.equal(shift.summary.expectedCash, 100000 + 21400);
  assert.equal(shift.summary.salesTotal, 21400);
  assert.deepEqual(stock.checkBalances(app.db), []);
  app.close();
});

test('a shift is needed to sell; a second person cannot open a shift on the same computer', async () => {
  const { app, owner, panadol, units } = await world();
  const lines = await cartLines(owner, [{ product: panadol, unitId: units(panadol).Strip, qty: 1 }]);
  assert.equal((await owner.fail('pos.complete', { lines, cashTendered: '30' })).code, 'NO_SHIFT');
  const other = await owner.fail('shifts.open', { openingCash: '0' });
  assert.match(other.message, /cash1 person/);
  app.close();
});

test('discount above the limit needs a manager; the approval is single use and cannot be self-given', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 2, discount: '15' }]);
  const err = await cashier.fail('pos.complete', { lines, cashTendered: '100' });
  assert.equal(err.code, 'NEEDS_APPROVAL');
  assert.deepEqual(err.details.needs, ['discount.above_limit']);
  assert.match(err.message, /15.00% is more than you may give \(10.00%\)/);
  // Wrong password, then a person without the right, then the owner.
  assert.equal((await cashier.fail('pos.approve', { username: 'owner', password: 'wrong', needs: ['discount.above_limit'] })).code, 'BAD_LOGIN');
  await makeUser(app, owner, 'pharm1', 'Pharmacist');
  assert.equal((await cashier.fail('pos.approve', { username: 'pharm1', password: 'Secret#123', needs: ['discount.above_limit'] })).code, 'FORBIDDEN');
  assert.equal((await cashier.fail('pos.approve', { username: 'cash1', password: 'Secret#123', needs: ['discount.above_limit'] })).code, 'FORBIDDEN');
  const ok = await cashier.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['discount.above_limit'], reason: 'Regular customer' });
  const res = await cashier.call('pos.complete', { lines, cashTendered: '100', approvalToken: ok.token });
  assert.equal(res.total, 6000 - 900);
  assert.ok(app.db.prepare('SELECT approved_by FROM sales WHERE id = ?').get(res.id).approved_by);
  // The token is used up.
  assert.equal((await cashier.fail('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1, discount: '15' }]), cashTendered: '100', approvalToken: ok.token })).code, 'APPROVAL');
  app.close();
});

test('bill discount is spread over lines exactly; tax is worked out inside the price', async () => {
  const { cashier, panadol, augmentin, units, app } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1 }, { product: augmentin, unitId: units(augmentin).Strip, qty: 1 }]);
  const err = await cashier.fail('pos.complete', { lines, cashTendered: '400', billDiscountType: 'amount', billDiscount: '33' });
  assert.equal(err.code, 'RX_NEEDED');
  const res = await cashier.call('pos.complete', { lines, cashTendered: '400', billDiscountType: 'amount', billDiscount: '33', prescription: { patientName: 'Sana', doctorName: 'Dr Khan' } });
  const s = await cashier.call('sales.get', { id: res.id });
  assert.equal(s.billDiscount, 3300);
  assert.equal(s.total, 3000 + 30000 - 3300);
  assert.equal(s.lines.reduce((a, l) => a + l.net, 0), s.total);
  // 17% inside Augmentin's net: net * 17 / 117
  const aug = s.lines.find((l) => l.productLabel.startsWith('Augmentin'));
  assert.equal(aug.tax, Math.round((aug.net * 1700) / 11700));
  assert.equal(s.tax, aug.tax);
  assert.equal(s.prescription.patientName, 'Sana');
  app.close();
});

test('price change at the counter needs permission', async () => {
  const { app, cashier, panadol, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1, price: '20' }]);
  const err = await cashier.fail('pos.complete', { lines, cashTendered: '30' });
  assert.deepEqual(err.details.needs, ['price.override']);
  app.close();
});

test('mixed payments; card cannot be more than the bill; wallets need a reference', async () => {
  const { app, cashier, panadol, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 5 }]);
  assert.equal((await cashier.fail('pos.complete', { lines, payments: [{ method: 'card', amount: '200' }] })).details.field, 'payments');
  assert.match((await cashier.fail('pos.complete', { lines, payments: [{ method: 'easypaisa', amount: '50' }], cashTendered: '100' })).message, /Easypaisa/);
  const res = await cashier.call('pos.complete', { lines, payments: [{ method: 'card', amount: '100' }, { method: 'jazzcash', amount: '20', reference: 'JC-778' }], cashTendered: '50' });
  assert.equal(res.total, 15000);
  assert.equal(res.change, 2000);
  const s = await cashier.call('sales.get', { id: res.id });
  assert.deepEqual(s.payments.map((p) => [p.method, p.amount]).sort(), [['card', 10000], ['cash', 3000], ['jazzcash', 2000]]);
  app.close();
});

test('credit sales: customer and limit needed; later payments go to the oldest bills', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const lines = () => cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 2 }]);
  assert.equal((await cashier.fail('pos.complete', { lines: await lines(), cashTendered: '10' })).details.field, 'customerId');
  const walkIn = await cashier.call('customers.create', { name: 'Bilal', phone: '0300-1' });
  assert.match((await cashier.fail('pos.complete', { lines: await lines(), customerId: walkIn.id, cashTendered: '10' })).message, /no credit limit/);
  const regular = await owner.call('customers.create', { name: 'Hamid', phone: '0300-2', creditLimit: '115' });
  // The cashier does not have the credit permission.
  const err = await cashier.fail('pos.complete', { lines: await lines(), customerId: regular.id, cashTendered: '10' });
  assert.deepEqual(err.details.needs, ['sales.credit']);
  const ok = await cashier.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['sales.credit'] });
  const s1 = await cashier.call('pos.complete', { lines: await lines(), customerId: regular.id, cashTendered: '10', approvalToken: ok.token });
  assert.equal(s1.credit, 5000);
  const ok2 = await cashier.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['sales.credit'] });
  const s2 = await cashier.call('pos.complete', { lines: await lines(), customerId: regular.id, approvalToken: ok2.token });
  assert.equal(s2.credit, 6000);
  const ok3 = await cashier.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['sales.credit'] });
  assert.match((await cashier.fail('pos.complete', { lines: await lines(), customerId: regular.id, approvalToken: ok3.token })).message, /more than their credit limit/);
  assert.equal((await cashier.call('customers.get', { id: regular.id })).balance, 11000);
  assert.match((await cashier.fail('customers.receive', { customerId: regular.id, amount: '200', method: 'cash' })).message, /owes 110.00/);
  const r = await cashier.call('customers.receive', { customerId: regular.id, amount: '70', method: 'cash' });
  assert.deepEqual(r.allocations.map((a) => [a.docNo, a.amount]), [[s1.docNo, 5000], [s2.docNo, 2000]]);
  const c = await cashier.call('customers.get', { id: regular.id });
  assert.equal(c.balance, 4000);
  assert.deepEqual(c.openBills.map((b) => b.due), [4000]);
  const st = await owner.call('customers.statement', { id: regular.id });
  assert.equal(st.closing, 4000);
  // Cash received later goes into the drawer of the open shift.
  assert.equal((await cashier.call('shifts.current')).shift.summary.receipts, 7000);
  app.close();
});

test('prescription and controlled drugs: details required, register shows running balance with patient', async () => {
  const { app, owner, cashier, xanax, units } = await world();
  const lines = await cartLines(cashier, [{ product: xanax, unitId: units(xanax).Tablet, qty: 6 }]);
  let err = await cashier.fail('pos.complete', { lines, cashTendered: '100' });
  assert.equal(err.code, 'RX_NEEDED');
  err = await cashier.fail('pos.complete', { lines, cashTendered: '100', prescription: { patientName: 'Ali', doctorName: 'Dr Raza' } });
  assert.match(err.message, /controlled drug/);
  const res = await cashier.call('pos.complete', { lines, cashTendered: '100', prescription: { patientName: 'Ali', patientCnic: '35202-1234567-1', doctorName: 'Dr Raza', doctorPmdc: '12345-P', rxNumber: 'RX-9' } });
  assert.equal(res.total, 6000);
  const reg = await owner.call('controlled.register', {});
  assert.deepEqual(reg.rows.map((r) => [r.movement, r.qtyIn, r.qtyOut, r.balance]), [['PURCHASE', 100, 0, 100], ['SALE', 0, 6, 94]]);
  assert.equal(reg.rows[1].patientName, 'Ali');
  assert.equal(reg.rows[1].doctorPmdc, '12345-P');
  const rx = await owner.call('prescriptions.list', { search: 'raza' });
  assert.equal(rx.total, 1);
  // A cashier cannot open the register.
  assert.equal((await cashier.fail('controlled.register', {})).code, 'FORBIDDEN');
  app.close();
});

test('void puts stock and money back; the drawer total follows', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  const res = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 3 }]), cashTendered: '100' });
  assert.equal((await cashier.fail('sales.void', { id: res.id, reason: 'x' })).code, 'NEEDS_APPROVAL', 'a cashier needs a manager to cancel a bill');
  // A manager voids on the cashier's computer? Shifts are per person, so the cashier closes or the manager uses their own shift.
  const shift = (await cashier.call('shifts.current')).shift;
  await cashier.call('shifts.close', { id: shift.id, countedCash: '1090' });
  await owner.call('shifts.open', { openingCash: '0' });
  await owner.call('sales.void', { id: res.id, reason: 'Wrong item' });
  const s = await owner.call('sales.get', { id: res.id });
  assert.equal(s.status, 'voided');
  assert.equal(stock.productBalance(app.db, app.device.branch_id, panadol.id), 550);
  const mine = (await owner.call('shifts.current')).shift;
  assert.equal(mine.summary.expectedCash, -9000, 'the refund came out of the manager drawer');
  assert.equal((await owner.fail('sales.void', { id: res.id, reason: 'again' })).code, 'WRONG_STATUS');
  assert.deepEqual(stock.checkBalances(app.db), []);
  app.close();
});

test('returns: exact partial refunds, stock condition, approval above the limit, credit bills reduce what is owed', async () => {
  const { app, owner, cashier, panadol, units } = await world();
  // Returns are taken by the pharmacist at this counter; refunds come out of the open drawer here.
  const pharm = await makeUser(app, owner, 'pharm1', 'Pharmacist');
  // 3 tablets from a strip of 10 at 30.00: 9.00
  const res = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Tablet, qty: 3 }]), cashTendered: '10' });
  const s = await cashier.call('sales.get', { id: res.id });
  const line = s.lines[0];
  assert.equal(line.net, 900);
  const r1 = await pharm.call('sales.return', { saleId: res.id, reason: 'Not needed', lines: [{ lineId: line.id, qty: 1 }] });
  const r2 = await pharm.call('sales.return', { saleId: res.id, reason: 'Not needed', lines: [{ lineId: line.id, qty: 1, condition: 'damaged' }] });
  const r3 = await pharm.call('sales.return', { saleId: res.id, reason: 'Not needed', lines: [{ lineId: line.id, qty: 1, condition: 'quarantine' }] });
  assert.equal(r1.total + r2.total + r3.total, 900, 'a full return gives back exactly what was paid');
  assert.match((await pharm.fail('sales.return', { saleId: res.id, reason: 'x', lines: [{ lineId: line.id, qty: 1 }] })).message, /Only 0 Tablets/);
  // Damaged came back and went straight out; quarantine came back and the batch is blocked.
  assert.equal(stock.productBalance(app.db, app.device.branch_id, panadol.id), 550 - 3 + 1 + 1);
  assert.equal(stock.isQuarantined(app.db, app.device.branch_id, line.batchId), true);
  const movements = app.db.prepare("SELECT movement, qty FROM stock_ledger WHERE ref_type = 'sale_return' ORDER BY at, rowid").all().map((m) => `${m.movement}:${m.qty}`);
  assert.deepEqual(movements, ['SALE_RETURN:1', 'SALE_RETURN:1', 'DAMAGED:-1', 'SALE_RETURN:1']);
  assert.equal((await cashier.call('shifts.current')).shift.summary.refunds, 900);

  // A return above the branch limit needs a manager.
  await owner.call('settings.update', { scope: 'branch', values: { 'pos.returnApprovalValue': 500 } });
  const big = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Box, qty: 2 }]), cashTendered: '700' });
  const bigSale = await cashier.call('sales.get', { id: big.id });
  const err = await pharm.fail('sales.return', { saleId: big.id, reason: 'x', lines: bigSale.lines.map((l) => ({ lineId: l.id, qty: l.qty })) });
  assert.equal(err.code, 'NEEDS_APPROVAL');
  const ok = await pharm.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['sales.void'] });
  const rb = await pharm.call('sales.return', { saleId: big.id, reason: 'Doctor changed it', approvalToken: ok.token, lines: bigSale.lines.map((l) => ({ lineId: l.id, qty: l.qty })) });
  assert.equal(rb.total, bigSale.total);

  // Credit bill: the return lowers what the customer owes before any cash is paid back.
  const cust = await owner.call('customers.create', { name: 'Hamid', creditLimit: '500' });
  const ok2 = await cashier.call('pos.approve', { username: 'owner', password: 'Owner#2026', needs: ['sales.credit'] });
  const cr = await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 4 }]), customerId: cust.id, cashTendered: '50', approvalToken: ok2.token });
  // The first batch is in quarantine now, so FEFO sells from the batch at 32.00 a strip.
  assert.equal(cr.total, 12800);
  assert.equal(cr.credit, 12800 - 5000);
  const crSale = await cashier.call('sales.get', { id: cr.id });
  const back = await pharm.call('sales.return', { saleId: cr.id, reason: 'Extra', lines: [{ lineId: crSale.lines[0].id, qty: 30 }] });
  assert.equal(back.total, 9600);
  assert.equal(back.accountAmount, 7800);
  assert.equal(back.refundAmount, 1800);
  assert.equal((await cashier.call('customers.get', { id: cust.id })).balance, 0);
  assert.deepEqual(stock.checkBalances(app.db), []);
  app.close();
});

test('shift close: counted cash, over or short needs a note, cash in and out', async () => {
  const { app, cashier, panadol, units } = await world();
  await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1 }]), cashTendered: '100' });
  await cashier.call('shifts.cashMove', { kind: 'out', amount: '200', reason: 'Tea and milk' });
  await cashier.call('shifts.cashMove', { kind: 'in', amount: '50', reason: 'Change from bank' });
  const shift = (await cashier.call('shifts.current')).shift;
  assert.equal(shift.summary.expectedCash, 100000 + 3000 - 20000 + 5000);
  assert.equal((await cashier.fail('shifts.close', { id: shift.id, countedCash: '875' })).details.field, 'notes');
  const closed = await cashier.call('shifts.close', { id: shift.id, countedCash: '875', notes: 'Rs 5 coin missing' });
  assert.equal(closed.overShort, -500);
  assert.equal(closed.status, 'closed');
  assert.equal((await cashier.call('shifts.current')).shift, null);
  app.close();
});

test('bills on hold, receipts, reprint permission, sales history filters', async () => {
  const { app, owner, cashier, panadol, xanax, units } = await world();
  const lines = await cartLines(cashier, [{ product: panadol, unitId: units(panadol).Strip, qty: 1 }]);
  const held = await cashier.call('pos.hold', { cart: { lines, customerId: null }, label: 'Lady in blue', total: 3000 });
  assert.equal((await cashier.call('pos.holds')).length, 1);
  const back = await cashier.call('pos.resume', { id: held.id });
  assert.equal(back.cart.lines.length, 1);
  assert.equal((await cashier.fail('pos.resume', { id: held.id })).code, 'NOT_FOUND');
  const res = await cashier.call('pos.complete', { lines: back.cart.lines, cashTendered: '50' });
  const html = (await cashier.call('sales.receiptHtml', { id: res.id })).html;
  assert.match(html, new RegExp(res.docNo));
  assert.match(html, /Batch SOON/);
  assert.match(html, /Change/);
  assert.match(html, /<svg/);
  await cashier.call('sales.print', { id: res.id });
  assert.equal(app.printed.length, 1);
  // Reprints need permission and are logged.
  assert.equal((await cashier.fail('sales.print', { id: res.id, reprint: true })).code, 'FORBIDDEN');
  await owner.call('sales.print', { id: res.id, reprint: true });
  assert.match(app.printed[1].html, /COPY/);
  assert.equal((await owner.call('audit.list', { action: 'reprint' })).total, 1);
  for (const format of ['58', 'A4']) assert.match((await owner.call('sales.receiptHtml', { id: res.id, format })).html, /<table/);
  await cashier.call('pos.complete', { lines: await cartLines(cashier, [{ product: xanax, unitId: units(xanax).Tablet, qty: 1 }]), cashTendered: '10', prescription: { patientName: 'A', patientCnic: '35202-1234567-1', doctorName: 'B', doctorPmdc: '1', rxNumber: '2' } });
  const all = await owner.call('sales.list', {});
  assert.equal(all.total, 2);
  assert.equal(all.totals.total, 3000 + 1000);
  assert.equal((await owner.call('sales.list', { productId: xanax.id })).total, 1);
  assert.equal((await owner.call('sales.list', { method: 'card' })).total, 0);
  assert.equal((await owner.call('sales.list', { search: res.docNo })).total, 1);
  assert.equal((await owner.call('sales.findByNo', { docNo: res.docNo.toLowerCase() })).id, res.id);
  // Medicine labels.
  const s = await owner.call('sales.get', { id: res.id });
  await owner.call('sales.labels', { id: res.id, lines: [{ lineId: s.lines[0].id, instructions: '1 tablet three times a day after food' }] });
  assert.match(app.printed[app.printed.length - 1].html, /three times a day/);
  app.close();
});

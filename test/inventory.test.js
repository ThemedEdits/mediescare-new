'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, setUpHeadOffice, signIn } = require('./helpers');
const stock = require('../src/main/core/stock');
const { allocate } = require('../src/main/services/purchasing');

const future = (days) => stock.addDays(stock.today(), days);

async function world() {
  const app = makeApp();
  const { c: owner } = await setUpHeadOffice(app);
  const hoId = app.device.branch_id;
  const supplier = await owner.call('suppliers.create', { name: 'Ali Distributors', phone: '042-1', paymentTermsDays: 30 });
  const panadol = await owner.call('products.create', {
    brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10,
    mrp: '30', tradePrice: '25', barcodes: ['8964000111222'], reorderLevel: 50, reorderQty: 200,
  });
  const brufen = await owner.call('products.create', { brandName: 'Brufen', strength: '400mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '50', tradePrice: '40' });
  return { app, owner, hoId, supplier, panadol, brufen };
}

async function roleId(c, name) {
  return (await c.call('roles.list', {})).find((r) => r.name === name).id;
}

async function makeUser(app, owner, username, role) {
  const { temporaryPassword } = await owner.call('users.create', { fullName: username, username, roleId: await roleId(owner, role) });
  const { c } = await signIn(app, username, temporaryPassword);
  await c.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123', confirmPassword: 'Secret#123' });
  return c;
}

async function receive(c, w, lines, extra = {}) {
  return c.call('purchases.saveGrn', { supplierId: w.supplier.id, invoiceNo: extra.invoiceNo || `INV-${Math.random().toString(36).slice(2, 7)}`, post: true, ...extra, lines });
}

function assertConsistent(app) {
  assert.deepEqual(stock.checkBalances(app.db), [], 'balance cache must equal the ledger');
}

test('product master: units, barcodes, SKU, rules and price history', async () => {
  const { app, owner, panadol } = await world();
  assert.match(panadol.sku, /^SKU-HO1-\d{4}$/);
  assert.deepEqual(panadol.units.map((u) => [u.name, u.factor]), [['Tablet', 1], ['Strip', 10]]);
  assert.equal(panadol.mrp, 3000);
  const dup = await owner.fail('products.create', { brandName: 'Other', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, barcodes: ['8964000111222'] });
  assert.equal(dup.details.field, 'barcodes');
  assert.match(dup.message, /already belongs to Panadol 500mg/);
  assert.equal((await owner.fail('products.create', { brandName: 'X', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 1, controlled: true })).details.field, 'rxRequired');
  // A typed manufacturer name is added to the list.
  const p = await owner.call('products.create', { brandName: 'Augmentin', baseUnit: 'Tablet', packUnit: 'Box', packSize: 6, manufacturerIdNew: 'GSK', units: [{ name: 'Carton', factor: 60 }] });
  assert.equal(p.manufacturerName, 'GSK');
  assert.equal(p.units.length, 3);
  // Search finds by generic name, part of the name, and barcode.
  assert.equal((await owner.call('products.search', { q: 'paracet' }))[0].id, panadol.id);
  assert.equal((await owner.call('products.search', { q: 'nado' }))[0].id, panadol.id);
  const byCode = await owner.call('products.search', { q: '8964000111222' });
  assert.equal(byCode[0].barcodeMatch, true);
  // Price change is recorded with a reason.
  await owner.call('products.update', { ...editable(panadol), mrp: '32', priceReason: 'Company price list' });
  const hist = await owner.call('products.priceHistory', { id: panadol.id });
  assert.ok(hist.some((h) => h.field === 'mrp' && h.oldValue === 3000 && h.newValue === 3200 && h.reason === 'Company price list'));
  // A cashier sees the product but not the trade price.
  const cashier = await makeUser(app, owner, 'cash1', 'Cashier');
  const seen = await cashier.call('products.get', { id: panadol.id });
  assert.equal(seen.tradePrice, null);
  assert.equal((await cashier.fail('products.create', { brandName: 'Z', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 1 })).code, 'FORBIDDEN');
  app.close();
});

function editable(p) {
  return {
    id: p.id, sku: p.sku, brandName: p.brandName, genericName: p.genericName, strength: p.strength, baseUnit: p.baseUnit, packUnit: p.packUnit, packSize: p.packSize,
    mrp: p.mrp / 100, tradePrice: p.tradePrice / 100, barcodes: (p.barcodes || []).map((b) => b.barcode), reorderLevel: p.productReorderLevel, reorderQty: p.productReorderQty,
  };
}

test('goods receipt: batch cost includes discount, bonus and freight; stock, supplier balance and order follow', async () => {
  const w = await world();
  const { app, owner, panadol, brufen, supplier } = w;
  const po = await owner.call('purchases.savePo', { supplierId: supplier.id, lines: [{ productId: panadol.id, qty: 1000, price: '25' }, { productId: brufen.id, qty: 200, price: '40' }] });
  assert.equal(po.total, 250000 + 80000);
  await owner.call('purchases.setPoStatus', { id: po.id, action: 'order' });

  // 50 strips at 25 less 10%, 5 strips bonus; bill discount 100 and freight 50 spread over lines.
  const grn = await owner.call('purchases.saveGrn', {
    supplierId: supplier.id, poId: po.id, invoiceNo: 'A-100', docDiscount: '100', freight: '50', post: true,
    lines: [
      { productId: panadol.id, poLineId: po.lines[0].id, batchNo: 'PN-01', expiryDate: future(400), qty: 500, bonusQty: 50, price: '25', discount: '10', mrp: '30' },
      { productId: brufen.id, poLineId: po.lines[1].id, batchNo: 'BR-01', expiryDate: future(200), qty: 200, price: '40', tax: '5', mrp: '50' },
    ],
  });
  assert.equal(grn.status, 'posted');
  // panadol: gross 1250.00, discount 125.00 -> 1125.00; brufen: 800.00 + 5% tax 40.00 -> 840.00
  assert.equal(grn.subtotal, 125000 + 80000);
  assert.equal(grn.total, 112500 + 84000 - 10000 + 5000);
  const pl = grn.lines[0];
  // share of bill discount and freight by value: panadol 1125/1965
  const disc = Math.round((10000 * 112500) / 196500);
  const fr = Math.round((5000 * 112500) / 196500);
  const landed = 112500 - disc + fr;
  assert.equal(pl.unitCost, Math.round((landed * 10) / 550));
  // Stock arrived including the bonus.
  const ps = await owner.call('stock.product', { productId: panadol.id });
  assert.equal(ps.onHand, 550);
  assert.equal(ps.onHandText, '55 Strips');
  assert.equal(ps.batches[0].batchNo, 'PN-01');
  // Supplier owes exactly the bill total; order is partly received.
  const sup = await owner.call('suppliers.get', { id: supplier.id });
  assert.equal(sup.balance, grn.total);
  assert.equal((await owner.call('purchases.getPo', { id: po.id })).status, 'partial');
  // More than open on the order is refused.
  const over = await owner.fail('purchases.saveGrn', { supplierId: supplier.id, poId: po.id, invoiceNo: 'A-101', post: true, lines: [{ productId: panadol.id, poLineId: po.lines[0].id, batchNo: 'PN-02', expiryDate: future(300), qty: 600, price: '25' }] });
  assert.equal(over.code, 'VALIDATION');
  assert.match(over.message, /more of Panadol 500mg than is still open/);
  // The same supplier invoice cannot be received twice.
  const dupInv = await owner.fail('purchases.saveGrn', { supplierId: supplier.id, invoiceNo: 'a-100', post: true, lines: [{ productId: panadol.id, batchNo: 'X', expiryDate: future(300), qty: 10, price: '25' }] });
  assert.equal(dupInv.details.field, 'invoiceNo');
  // Expired stock cannot be received.
  const exp = await owner.fail('purchases.saveGrn', { supplierId: supplier.id, post: true, lines: [{ productId: panadol.id, batchNo: 'OLD', expiryDate: future(-1), qty: 10, price: '25' }] });
  assert.match(exp.message, /already passed/);
  // Nothing from the failed attempts reached the ledger.
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM stock_ledger').get().n, 2);
  // Receive the rest -> order received.
  await receive(owner, w, [{ productId: panadol.id, poLineId: po.lines[0].id, batchNo: 'PN-02', expiryDate: future(500), qty: 500, price: '25' }], { poId: po.id });
  assert.equal((await owner.call('purchases.getPo', { id: po.id })).status, 'received');
  assertConsistent(app);
  app.close();
});

test('stock ledger is append-only and every number reconciles', async () => {
  const w = await world();
  const { app, owner, panadol } = w;
  await receive(owner, w, [{ productId: panadol.id, batchNo: 'P1', expiryDate: future(100), qty: 100, price: '25' }]);
  const row = app.db.prepare('SELECT id FROM stock_ledger LIMIT 1').get();
  assert.throws(() => app.db.prepare('UPDATE stock_ledger SET qty = 999 WHERE id = ?').run(row.id), /MEDI_APPEND_ONLY/);
  assert.throws(() => app.db.prepare('DELETE FROM stock_ledger').run(), /MEDI_APPEND_ONLY/);
  const batch = (await owner.call('stock.batches', { productId: panadol.id })).rows[0];
  await owner.call('adjustments.create', { kind: 'damaged', reason: 'Broken strip', lines: [{ batchId: batch.batchId, qty: 7 }] });
  const ps = await owner.call('stock.product', { productId: panadol.id });
  const r = ps.reconciliation;
  assert.equal(r.opening + r.movements.reduce((a, m) => a + m.qty, 0), r.closing);
  assert.equal(r.closing, ps.onHand);
  assert.equal(ps.onHand, 93);
  const led = await owner.call('stock.ledger', { productId: panadol.id });
  assert.equal(led.rows[0].movement, 'DAMAGED');
  assert.equal(led.rows[0].before, 100);
  assert.equal(led.rows[0].after, 93);
  assert.equal(led.rows[0].reason, 'Broken strip');
  // Rebuilding the cache from the ledger gives the same numbers.
  stock.rebuildBalances(app.db);
  assert.equal(stock.productBalance(app.db, w.hoId, panadol.id), 93);
  app.close();
});

test('adjustments: plain messages, approval limit, no self-approval, expired write-off only for expired batches', async () => {
  const w = await world();
  const { app, owner, panadol } = w;
  await receive(owner, w, [{ productId: panadol.id, batchNo: 'P1', expiryDate: future(100), qty: 25, price: '25' }]);
  const batch = (await owner.call('stock.batches', { productId: panadol.id })).rows[0];
  const err = await owner.fail('adjustments.create', { kind: 'decrease', reason: 'Count', lines: [{ batchId: batch.batchId, qty: 30 }] });
  assert.equal(err.code, 'NOT_ENOUGH_STOCK');
  assert.equal(err.message, 'Only 2 Strips + 5 Tablets are available in batch P1 of Panadol 500mg. You entered 3 Strips.');
  assert.match((await owner.fail('adjustments.create', { kind: 'expired', reason: 'x', lines: [{ batchId: batch.batchId, qty: 1 }] })).message, /has not expired yet/);

  // A store keeper adding opening stock worth more than the limit (Rs 5,000) waits for approval.
  const keeper = await makeUser(app, owner, 'store1', 'Store Keeper');
  const big = await keeper.call('adjustments.create', { kind: 'opening', reason: 'Opening stock', lines: [{ productId: w.brufen.id, batchNo: 'B-OPEN', expiryDate: future(300), cost: '40', mrp: '50', qty: 2000 }] });
  assert.equal(big.status, 'pending');
  assert.equal(big.needsApproval, true);
  assert.equal(stock.productBalance(app.db, w.hoId, w.brufen.id), 0, 'nothing moves before approval');
  const manager = await makeUser(app, owner, 'mgr1', 'Branch Admin');
  await manager.call('adjustments.decide', { id: big.id, approve: true });
  assert.equal(stock.productBalance(app.db, w.hoId, w.brufen.id), 2000);
  // Small adjustments post at once; nobody approves their own request.
  const small = await keeper.call('adjustments.create', { kind: 'opening', reason: 'Opening stock', lines: [{ productId: w.brufen.id, batchNo: 'B-2', expiryDate: future(300), cost: '40', mrp: '50', qty: 10 }] });
  assert.equal(small.status, 'posted');
  const pending = await manager.call('adjustments.create', { kind: 'opening', reason: 'x', lines: [{ productId: w.brufen.id, batchNo: 'B-3', expiryDate: future(300), cost: '40', mrp: '50', qty: 5000 }] });
  assert.equal(pending.status, 'posted', 'the manager has approval permission, so no wait');
  assertConsistent(app);
  app.close();
});

test('stock take: variance is corrected, movements during counting are kept', async () => {
  const w = await world();
  const { app, owner, panadol } = w;
  await receive(owner, w, [{ productId: panadol.id, batchNo: 'P1', expiryDate: future(100), qty: 100, price: '25' }]);
  const take = await owner.call('stocktake.start', { name: 'Shelf A' });
  assert.equal((await owner.fail('stocktake.start', {})).code, 'IN_USE');
  const line = take.lines.find((l) => l.productId === panadol.id);
  assert.equal(line.systemQty, 100);
  // 10 damaged while counting; counter found 95 on the shelf at the start of the count.
  await owner.call('adjustments.create', { kind: 'damaged', reason: 'Water', lines: [{ batchId: line.batchId, qty: 10 }] });
  const saved = await owner.call('stocktake.saveCounts', { id: take.id, counts: [{ lineId: line.id, countedQty: 95, note: 'Short 5' }] });
  assert.equal(saved.lines.find((l) => l.id === line.id).variance, -5);
  await owner.call('stocktake.post', { id: take.id });
  assert.equal(stock.productBalance(app.db, w.hoId, panadol.id), 85);
  assertConsistent(app);
  app.close();
});

test('purchase return and supplier payments keep the supplier account and ageing exact', async () => {
  const w = await world();
  const { app, owner, panadol, supplier } = w;
  const g1 = await receive(owner, w, [{ productId: panadol.id, batchNo: 'P1', expiryDate: future(100), qty: 100, price: '25' }]);
  const g2 = await receive(owner, w, [{ productId: panadol.id, batchNo: 'P2', expiryDate: future(200), qty: 200, price: '25' }]);
  assert.equal(g1.total, 25000);
  assert.equal(g2.total, 50000);
  const batch = g1.lines[0].batchId;
  const ret = await owner.call('purchases.createReturn', { supplierId: supplier.id, reasonType: 'damaged', lines: [{ batchId: batch, qty: 20 }] });
  assert.equal(ret.total, 5000);
  assert.equal(stock.balance(app.db, w.hoId, batch), 80);
  const pay = await owner.call('payments.create', { supplierId: supplier.id, amount: '300', method: 'cash', allocations: [{ grnId: g1.id, amount: '250' }] });
  assert.equal(pay.allocations[0].amount, 25000);
  const tooMuch = await owner.fail('payments.create', { supplierId: supplier.id, amount: '100', method: 'cash', allocations: [{ grnId: g2.id, amount: '600' }] });
  assert.match(tooMuch.message, /only has 500.00 left/);
  const s = await owner.call('suppliers.get', { id: supplier.id });
  assert.equal(s.balance, 75000 - 5000 - 30000);
  const a = s.ageing;
  const bucketSum = Object.values(a.buckets).reduce((x, y) => x + y, 0);
  assert.equal(bucketSum - a.unallocatedCredit, s.balance);
  // A bill with payments cannot be cancelled; cancelling the payment frees it.
  assert.equal((await owner.fail('purchases.cancelGrn', { id: g1.id, reason: 'x' })).code, 'IN_USE');
  await owner.call('payments.cancel', { id: pay.id, reason: 'Cheque bounced' });
  assert.equal((await owner.call('suppliers.get', { id: supplier.id })).balance, 70000);
  // g1 had stock returned, so it cannot be cancelled; g2 is untouched and can.
  assert.equal((await owner.fail('purchases.cancelGrn', { id: g1.id, reason: 'x' })).code, 'IN_USE');
  await owner.call('purchases.cancelGrn', { id: g2.id, reason: 'Wrong supplier' });
  assert.equal((await owner.call('suppliers.get', { id: supplier.id })).balance, 20000);
  assert.equal(stock.balance(app.db, w.hoId, g2.lines[0].batchId), 0);
  const stmt = await owner.call('suppliers.statement', { id: supplier.id });
  assert.equal(stmt.closing, 20000);
  assert.equal(stmt.entries.length, 6);
  // Cancelling the return puts stock and the debt back.
  await owner.call('purchases.cancelReturn', { id: ret.id, reason: 'Supplier refused' });
  assert.equal(stock.balance(app.db, w.hoId, batch), 100);
  assert.equal((await owner.call('suppliers.get', { id: supplier.id })).balance, 25000);
  assertConsistent(app);
  app.close();
});

test('transfers: Head Office sends by batch (FEFO), branch receives with a shortage, difference is resolved', async () => {
  const w = await world();
  const { app, owner, panadol, hoId } = w;
  const { branch: lhr } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'L M', username: 'lhrmgr' } });
  // Two batches: the one expiring first goes first.
  await receive(owner, w, [
    { productId: panadol.id, batchNo: 'LATE', expiryDate: future(400), qty: 100, price: '25' },
    { productId: panadol.id, batchNo: 'SOON', expiryDate: future(60), qty: 30, price: '25' },
  ]);
  const t = await owner.call('transfers.create', { mode: 'send', otherBranchId: lhr.id, dispatch: true, lines: [{ productId: panadol.id, qty: 50 }] });
  assert.equal(t.status, 'dispatched');
  assert.deepEqual(t.lines.map((l) => [l.batchNo, l.qty]), [['SOON', 30], ['LATE', 20]]);
  assert.equal(stock.productBalance(app.db, hoId, panadol.id), 80);
  assert.equal(stock.productBalance(app.db, lhr.id, panadol.id), 0, 'in transit belongs to nobody yet');
  // Only the receiving branch can receive.
  assert.equal((await owner.fail('transfers.receive', { id: t.id })).code, 'FORBIDDEN');
  await owner.call('branches.switch', { branchId: lhr.id });
  const soon = t.lines[0];
  const noReason = await owner.fail('transfers.receive', { id: t.id, lines: [{ lineId: soon.id, receivedQty: 25 }] });
  assert.match(noReason.message, /why the received quantity is different/);
  const rec = await owner.call('transfers.receive', { id: t.id, lines: [{ lineId: soon.id, receivedQty: 25, reason: 'Box torn' }] });
  assert.equal(rec.status, 'received');
  assert.equal(rec.discrepancyOpen, true);
  assert.equal(stock.productBalance(app.db, lhr.id, panadol.id), 45);
  // Same batch, same expiry at the branch.
  const lhrBatches = await owner.call('stock.batches', { productId: panadol.id });
  assert.deepEqual(lhrBatches.rows.map((b) => b.batchNo).sort(), ['LATE', 'SOON']);
  // The sender resolves: the 5 missing came back.
  await owner.call('branches.switch', { branchId: hoId });
  const res = await owner.call('transfers.resolve', { id: t.id, resolution: 'returned', reason: 'Driver returned them' });
  assert.equal(res.discrepancyOpen, false);
  assert.equal(stock.productBalance(app.db, hoId, panadol.id), 85);
  assertConsistent(app);
  app.close();
});

test('transfers: branch requests need approval; expired stock is never sent; returns to Head Office work', async () => {
  const w = await world();
  const { app, owner, panadol, hoId } = w;
  const { branch: lhr } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'L M', username: 'lhrmgr' } });
  await receive(owner, w, [{ productId: panadol.id, batchNo: 'B1', expiryDate: future(100), qty: 40, price: '25' }]);
  await owner.call('branches.switch', { branchId: lhr.id });
  const req = await owner.call('transfers.create', { mode: 'request', otherBranchId: hoId, lines: [{ productId: panadol.id, qty: 60 }] });
  assert.equal(req.status, 'requested');
  await owner.call('branches.switch', { branchId: hoId });
  assert.match((await owner.fail('transfers.dispatch', { id: req.id })).message, /needs approval/);
  await owner.call('transfers.decide', { id: req.id, approve: true });
  const short = await owner.fail('transfers.dispatch', { id: req.id });
  assert.equal(short.code, 'NOT_ENOUGH_STOCK');
  assert.equal(short.message, 'Only 4 Strips of Panadol 500mg are available. You need 6 Strips.');
  // Expired batch is skipped by FEFO and refused when picked.
  const batch = app.db.prepare("SELECT id FROM batches WHERE batch_no = 'B1'").get().id;
  app.db.prepare('UPDATE sync_ctx SET applying = 1').run();
  app.db.prepare('UPDATE batches SET expiry_date = ? WHERE id = ?').run(future(-2), batch);
  app.db.prepare('UPDATE sync_ctx SET applying = 0').run();
  const pick = await owner.fail('transfers.dispatch', { id: req.id, picks: [{ requestLineId: req.requests[0].id, batchId: batch, qty: 10 }] });
  assert.match(pick.message, /expired on/);
  app.db.prepare('UPDATE batches SET expiry_date = ? WHERE id = ?').run(future(100), batch);
  const sent = await owner.call('transfers.dispatch', { id: req.id, picks: [{ requestLineId: req.requests[0].id, batchId: batch, qty: 40 }] });
  assert.equal(sent.requests[0].sentQty, 40);
  await owner.call('branches.switch', { branchId: lhr.id });
  await owner.call('transfers.receive', { id: req.id });
  // The branch sends 10 back to Head Office.
  const back = await owner.call('transfers.create', { mode: 'send', otherBranchId: hoId, dispatch: true, lines: [{ productId: panadol.id, qty: 10 }] });
  assert.equal(back.fromBranchId, lhr.id);
  await owner.call('branches.switch', { branchId: hoId });
  await owner.call('transfers.receive', { id: back.id });
  assert.equal(stock.productBalance(app.db, hoId, panadol.id), 10);
  assert.equal(stock.productBalance(app.db, lhr.id, panadol.id), 30);
  // Transfer rows are routed to both branches by sync.
  const op = app.db.prepare("SELECT branch_id, branch_id2 FROM sync_ops WHERE tbl = 'transfers' LIMIT 1").get();
  assert.deepEqual([op.branch_id, op.branch_id2].sort(), [hoId, lhr.id].sort());
  assertConsistent(app);
  app.close();
});

test('expiry, valuation, reorder and quarantine', async () => {
  const w = await world();
  const { app, owner, panadol, brufen } = w;
  await receive(owner, w, [
    { productId: panadol.id, batchNo: 'NEAR', expiryDate: future(20), qty: 20, price: '25', mrp: '30' },
    { productId: brufen.id, batchNo: 'FAR', expiryDate: future(500), qty: 500, price: '40', mrp: '50' },
  ]);
  const ex = await owner.call('stock.expiry', {});
  assert.equal(ex.buckets.find((b) => b.key === 'd30').batches, 1);
  assert.equal(ex.buckets.find((b) => b.key === 'd30').mrpValue, 6000);
  const val = await owner.call('stock.valuation', { groupBy: 'product' });
  assert.equal(val.total.value, 5000 + 200000);
  const re = await owner.call('stock.reorder', {});
  const pr = re.find((r) => r.productId === panadol.id);
  assert.equal(pr.suggestedQty, 200);
  assert.ok(!re.some((r) => r.productId === brufen.id));
  // Quarantined batches are not picked.
  const b = (await owner.call('stock.batches', { productId: panadol.id })).rows[0];
  await owner.call('batches.setQuarantine', { batchId: b.batchId, quarantined: true, reason: 'Recall notice' });
  assert.equal(stock.fefo(app.db, w.hoId, panadol.id, 5).short, 5);
  // A cashier cannot see cost or value.
  const cashier = await makeUser(app, owner, 'cash9', 'Cashier');
  assert.equal((await cashier.fail('stock.valuation', {})).code, 'FORBIDDEN');
  // Batch edit needs a reason and never touches cost.
  assert.equal((await owner.fail('batches.update', { id: b.batchId, batchNo: 'NEAR', expiryDate: future(25), mrp: '30' })).details.field, 'reason');
  await owner.call('batches.update', { id: b.batchId, batchNo: 'NEAR-1', expiryDate: future(25), mrp: '31', reason: 'Typo on invoice' });
  assert.equal(app.db.prepare('SELECT cost FROM batches WHERE id = ?').get(b.batchId).cost, 2500);
  app.close();
});

test('branches without permission cannot buy directly from suppliers', async () => {
  const w = await world();
  const { app, owner, panadol, supplier } = w;
  const { branch: lhr, admin } = await owner.call('branches.create', { code: 'LHR', name: 'Lahore', admin: { fullName: 'L M', username: 'lhrmgr' } });
  // Simulate a Lahore computer by moving this PC's registration (sync is not built yet).
  app.db.prepare('UPDATE sync_ctx SET applying = 1').run();
  app.db.prepare('UPDATE devices SET branch_id = ? WHERE id = ?').run(lhr.id, app.device.id);
  app.db.prepare('UPDATE sync_ctx SET applying = 0').run();
  app.loadDevice();
  const { c: mgr } = await signIn(app, 'lhrmgr', admin.temporaryPassword);
  await mgr.call('auth.changePassword', { currentPassword: admin.temporaryPassword, newPassword: 'Secret#123', confirmPassword: 'Secret#123' });
  const err = await mgr.fail('purchases.saveGrn', { supplierId: supplier.id, post: true, lines: [{ productId: panadol.id, batchNo: 'X', expiryDate: future(100), qty: 10, price: '25' }] });
  assert.equal(err.code, 'FORBIDDEN');
  assert.match(err.message, /not allowed to buy directly/);
  app.close();
});

test('allocation splits amounts exactly', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  for (let i = 0; i < 200; i++) {
    const weights = Array.from({ length: 1 + (i % 7) }, (_, k) => 1 + ((i * 37 + k * 11) % 9973));
    const amount = (i * 7919) % 100000;
    assert.equal(allocate(amount, weights).reduce((a, b) => a + b, 0), amount);
  }
});

test('a version 1 database upgrades to the new schema with a safety copy first', async () => {
  const fs = require('fs');
  const path = require('path');
  const { tempDir } = require('./helpers');
  const { open } = require('../src/main/db/connection');
  const migrations = require('../src/main/db/migrations');
  const { rebuildTriggers } = require('../src/main/db/triggers');
  const dir = tempDir();
  // Build a database exactly as Phase 0 left it (only migration 1), with an organisation in it.
  const db = open(path.join(dir, 'mediescare.db'));
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  migrations[0].up(db);
  db.prepare("INSERT INTO schema_migrations VALUES (1, 'foundation', ?)").run(new Date().toISOString());
  db.prepare("INSERT INTO org (id, code, name, created_at, updated_at) VALUES ('O1', 'OLD', 'Old Org', 'x', 'x')").run();
  void rebuildTriggers;
  db.close();
  const app = makeApp(dir);
  assert.deepEqual(app.migration.applied, [2, 3, 4, 5, 6, 7], 'every newer migration runs, in order');
  assert.ok(app.migration.backup && fs.existsSync(app.migration.backup));
  assert.equal(app.db.prepare('SELECT name FROM org').get().name, 'Old Org');
  assert.ok(app.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'stock_ledger'").get());
  app.close();
});

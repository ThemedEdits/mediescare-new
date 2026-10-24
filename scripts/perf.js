'use strict';
// Performance test with a large catalogue: 50,000 products, 100,000 batches, 500,000 stock movements and 100,000
// bills spread over the last 330 days (sync triggers stay on, so the operation log grows as it would in real use).
// Then the screens' own RPC calls are timed against limits. Run: npm run test:perf  (KEEP_DB=1 keeps the folder).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeApp, setUpHeadOffice } = require('../test/helpers');
const { newId } = require('../src/main/core/ids');
const stock = require('../src/main/core/stock');

const N_PRODUCTS = Number(process.env.PERF_PRODUCTS) || 50000;
const N_BILLS = Number(process.env.PERF_BILLS) || 100000;
const DAYS = 330;

// Upper limits in milliseconds. Counter work must feel instant; screens under a second; big reports a few seconds.
const LIMITS = { counter: 150, screen: 1000, report: 4000 };

function rng(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

async function generate(app) {
  const db = app.db;
  const r = rng(42);
  const branch = app.device.branch_id;
  const userId = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const shiftId = newId();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO shifts (id, branch_id, device_id, doc_no, user_id, status, opened_at, opening_cash, closed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'SHF-PERF-1', ?, 'closed', ?, 0, ?, ?, ?)`).run(shiftId, branch, app.device.id, userId, now, now, now, now);
  const cats = db.prepare("SELECT id FROM lookups WHERE kind = 'category'").all().map((x) => x.id);
  const supplier = newId();
  db.prepare("INSERT INTO suppliers (id, code, name, created_at, updated_at) VALUES (?, 'PERF', 'Perf Supplier', ?, ?)").run(supplier, now, now);
  const salts = ['Paracetamol', 'Ibuprofen', 'Amoxicillin', 'Omeprazole', 'Metformin', 'Atorvastatin', 'Cetirizine', 'Azithromycin', 'Losartan', 'Diclofenac'];
  const products = [];
  const batches = [];
  const t0 = Date.now();
  const insP = db.prepare(`INSERT INTO products (id, sku, brand_name, generic_name, strength, category_id, base_unit, pack_unit, pack_size, mrp, trade_price, reorder_level, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'Tablet', 'Strip', 10, ?, ?, ?, 1, ?, ?)`);
  const insU = db.prepare('INSERT INTO product_units (id, product_id, name, factor, sellable, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)');
  const insBc = db.prepare('INSERT INTO product_barcodes (id, product_id, barcode, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
  const insB = db.prepare(`INSERT INTO batches (id, product_id, batch_no, expiry_date, mrp, cost, trade_price, supplier_id, received_at, origin_branch_id, source_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opening', ?, ?)`);
  const insL = db.prepare(`INSERT INTO stock_ledger (id, branch_id, product_id, batch_id, qty, movement, ref_type, ref_id, ref_no, cost, pack_size, value, before_qty, after_qty, user_id, at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, ?, ?, ?)`);
  const bal = new Map();
  const post = (b, qty, movement, refType, refId, refNo, at) => {
    const before = bal.get(b.id) || 0;
    bal.set(b.id, before + qty);
    insL.run(newId(), branch, b.product_id, b.id, qty, movement, refType, refId, refNo, b.cost, Math.round((b.cost * qty) / 10), before, before + qty, userId, at, at);
  };
  const atDay = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(9 + Math.floor(r() * 12), Math.floor(r() * 60)); return d; };
  const chunk = (n, fn) => { for (let i = 0; i < n; i += 5000) db.transaction(() => { for (let j = i; j < Math.min(n, i + 5000); j++) fn(j); })(); };

  chunk(N_PRODUCTS, (i) => {
    const id = newId();
    const mrp = 1000 + Math.floor(r() * 50000);
    insP.run(id, `P${String(i).padStart(6, '0')}`, `Brand${i} ${['Forte', 'Plus', 'DS', 'XR', ''][i % 5]}`.trim(), salts[i % salts.length], `${(1 + (i % 10)) * 50}mg`, cats[i % cats.length] || null, mrp, Math.round(mrp * 0.8), i % 7 === 0 ? 3000 : 0, now, now);
    insU.run(newId(), id, 'Tablet', 1, 0, now, now);
    insU.run(newId(), id, 'Strip', 10, 1, now, now);
    insBc.run(newId(), id, `89640${String(i).padStart(8, '0')}`, now, now);
    products.push({ id, mrp });
    for (let k = 0; k < 2; k++) {
      const b = { id: newId(), product_id: id, cost: Math.round(mrp * 0.75) };
      const days = 30 + Math.floor(r() * 700) - (i % 50 === 0 && k === 0 ? 760 : 0); // a few already expired
      insB.run(b.id, id, `B${i}-${k}`, stock.addDays(stock.today(), days), mrp, b.cost, Math.round(mrp * 0.8), supplier, now, branch, now, now);
      batches.push(b);
      post(b, 2000, 'OPENING', 'adjustment', null, 'OPEN', atDay(DAYS + 1).toISOString());
    }
  });
  console.log(`products and batches: ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const insS = db.prepare(`INSERT INTO sales (id, branch_id, doc_no, device_id, shift_id, cashier_id, status, sold_at, sale_date, gross, tax, total, paid, cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 0, ?, ?, ?, ?, ?)`);
  const insSL = db.prepare(`INSERT INTO sale_lines (id, sale_id, branch_id, line_no, product_id, batch_id, unit_name, unit_factor, qty, unit_price, list_price, gross, net, cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'Tablet', 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insPay = db.prepare(`INSERT INTO sale_payments (id, branch_id, sale_id, shift_id, kind, method, amount, user_id, at, updated_at) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?)`);
  // Popular products sell more often, like a real shop.
  const hot = batches.slice(0, 20000);
  chunk(N_BILLS, (i) => {
    const d = atDay(Math.floor((i / N_BILLS) * DAYS));
    const at = d.toISOString();
    const id = newId();
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const b = hot[Math.floor(r() * hot.length)];
      const qty = 1 + Math.floor(r() * 10);
      const price = Math.round(b.cost / 7.5); // per tablet, a little above cost
      lines.push({ b, qty, gross: price * qty, cost: Math.round((b.cost * qty) / 10) });
    }
    const total = lines.reduce((a, l) => a + l.gross, 0);
    insS.run(id, branch, `INV-PERF-${i}`, app.device.id, shiftId, userId, at, stock.today(d), total, total, total, lines.reduce((a, l) => a + l.cost, 0), at, at);
    lines.forEach((l, k) => {
      insSL.run(newId(), id, branch, k + 1, l.b.product_id, l.b.id, l.qty, Math.round(l.gross / l.qty), Math.round(l.gross / l.qty), l.gross, l.gross, l.cost, at, at);
      post(l.b, -l.qty, 'SALE', 'sale', id, `INV-PERF-${i}`, at);
    });
    insPay.run(newId(), branch, id, shiftId, i % 4 === 0 ? 'card' : 'cash', total, userId, at, at);
  });
  console.log(`bills: ${Date.now() - t1} ms`);

  const t2 = Date.now();
  const moves = 500000 - db.prepare('SELECT COUNT(*) AS n FROM stock_ledger').get().n;
  const kinds = [['ADJUST_IN', 5], ['ADJUST_OUT', -3], ['DAMAGED', -1], ['SALE_RETURN', 1], ['STOCKTAKE', -2]];
  chunk(Math.max(moves, 0), (i) => {
    const b = batches[Math.floor(r() * batches.length)];
    const [m, q] = kinds[i % kinds.length];
    post(b, q, m, 'adjustment', null, `ADJ-PERF-${i}`, atDay(Math.floor(r() * DAYS)).toISOString());
  });
  console.log(`other movements: ${Date.now() - t2} ms`);
  return { products, batches };
}

async function time(label, kind, fn) {
  const t = process.hrtime.bigint();
  await fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { label, kind, ms: Math.round(ms), ok: ms <= LIMITS[kind] };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediescare-perf-'));
  const app = makeApp(dir);
  const { c } = await setUpHeadOffice(app);
  const start = Date.now();
  const { products, batches } = await generate(app);
  const db = app.db;
  const counts = Object.fromEntries(['products', 'batches', 'stock_ledger', 'sales', 'sale_lines', 'sync_ops'].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  console.log(`data ready in ${Math.round((Date.now() - start) / 1000)} s:`, counts);
  console.log(`database file: ${Math.round(fs.statSync(path.join(dir, 'mediescare.db')).size / 1048576)} MB`);
  db.exec('ANALYZE');

  const today = stock.today();
  const from30 = stock.addDays(today, -29);
  const from365 = stock.addDays(today, -364);
  const p = products[123];
  const call = (m, params) => c.call(m, params);
  const results = [];
  const run = async (label, kind, m, params) => results.push(await time(label, kind, () => call(m, params)));
  await run('counter: search by name', 'counter', 'products.search', { q: 'Brand4567', limit: 25 });
  await run('counter: search by salt', 'counter', 'products.search', { q: 'parac', limit: 25 });
  await run('counter: scan a barcode', 'counter', 'products.search', { q: '8964000012345', limit: 25 });
  await run('counter: price quote (FEFO)', 'counter', 'pos.quote', { productId: p.id, qty: 25 });
  await run('counter: customer search', 'counter', 'customers.search', { q: 'ali' });
  await c.call('shifts.open', { openingCash: '0' });
  const q = await c.call('pos.quote', { productId: p.id, qty: 5 });
  await run('counter: finish a sale', 'counter', 'pos.complete', { lines: q.pieces.map((x) => ({ productId: p.id, unitId: q.unitId, batchId: x.batchId, qty: x.qty })), cashTendered: '100000' });
  await run('global search', 'screen', 'search.global', { q: 'Brand123' });
  await run('global search: bill number', 'screen', 'search.global', { q: 'INV-PERF-99999' });
  await run('products list page 1', 'screen', 'products.list', { page: 1, pageSize: 50 });
  await run('products list search', 'screen', 'products.list', { search: 'Forte', page: 1, pageSize: 50 });
  await run('batches page 1', 'screen', 'stock.batches', { page: 1, pageSize: 50 });
  await run('batches near expiry', 'screen', 'stock.batches', { status: 'near', page: 1, pageSize: 50 });
  await run('stock of one product (why this stock)', 'screen', 'stock.ledger', { productId: p.id, page: 1, pageSize: 50 });
  await run('sales history page 1', 'screen', 'sales.list', { page: 1, pageSize: 50 });
  await run('sales history, 30 days', 'screen', 'sales.list', { from: from30, to: today, page: 1, pageSize: 50 });
  await run('dashboard', 'report', 'dashboard.branch', {});
  await run('notifications', 'screen', 'notifications.list', {});
  await run('financial journal, one day', 'screen', 'finance.journal', { from: today, to: today });
  await run('financial journal, 30 days', 'report', 'finance.journal', { from: from30, to: today });
  for (const [report, from] of [['daily_sales', from30], ['monthly_sales', from365], ['sales_by_product', from30], ['sales_by_category', from30], ['sales_by_cashier', from30],
    ['gross_profit', from30], ['discounts', from30], ['tax', from30], ['management_summary', from30], ['expiry', null], ['stock_valuation', null], ['reconciliation', from30]]) {
    await run(`report: ${report}`, 'report', 'reports.run', { report, from: from || from30, to: today, days: 90 });
  }
  await run('reorder list', 'report', 'stock.reorder', {});
  await run('stock consistency check', 'report', 'stock.check', {});
  await run('sync status', 'screen', 'sync.status', {});

  // A backup of the whole database runs in a worker thread; the counter must keep answering meanwhile.
  const backup = require('../src/main/backup');
  const tb = Date.now();
  const pending = backup.create(app, 'manual');
  const during = await time('counter: search while a backup runs', 'counter', () => call('products.search', { q: 'Brand777', limit: 25 }));
  const made = await pending;
  results.push(during);
  console.log(`backup: ${Math.round((Date.now() - tb) / 1000)} s, ${Math.round(made.size / 1048576)} MB compressed`);
  const opsBytes = db.prepare('SELECT SUM(length(data)) AS b FROM sync_ops').get().b;
  console.log(`sync log payload: ${Math.round(opsBytes / 1048576)} MB in ${counts.sync_ops} operations`);

  const w = Math.max(...results.map((r) => r.label.length));
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'SLOW'}  ${r.label.padEnd(w)}  ${String(r.ms).padStart(6)} ms  (limit ${LIMITS[r.kind]})`);
  const slow = results.filter((r) => !r.ok);
  console.log(`\n${results.length - slow.length} within limits, ${slow.length} too slow.`);
  app.close();
  if (!process.env.KEEP_DB) fs.rmSync(dir, { recursive: true, force: true });
  else console.log(`kept ${dir}`);
  void batches;
  process.exit(slow.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });

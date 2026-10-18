'use strict';
// The one-time legacy migration builds a working organisation from the sample folder, and the result opens normally.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { tempDir, makeApp, signIn } = require('./helpers');

test('legacy migration: products, suppliers, customers, opening stock and balances from CSV and JSON', async () => {
  const out = path.join(tempDir(), 'data');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate-legacy.js'), path.join(__dirname, '..', 'docs', 'legacy-sample'), '--out', out],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /opening_stock\.csv: 5 added/);

  const app = makeApp(out);
  const { c } = await signIn(app, 'ayesha', 'Change#Me2026');
  const db = app.db;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 4);
  const pan = db.prepare("SELECT * FROM products WHERE sku = 'PAN500'").get();
  assert.equal(db.prepare('SELECT SUM(qty) AS q FROM stock_balances WHERE product_id = ?').get(pan.id).q, 40 * 10 + 5 + 20 * 10);
  assert.equal(db.prepare("SELECT SUM(credit - debit) AS b FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id WHERE s.code = 'ALI'").get().b, 1500000);
  const hamid = (await c.call('customers.search', { q: 'Hamid' }))[0];
  assert.equal(hamid.balance, 125050);
  assert.deepEqual((await c.call('stock.check', {})).mismatches, []);
  // A second run into the same folder is refused, so nothing is imported twice.
  const again = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate-legacy.js'), path.join(__dirname, '..', 'docs', 'legacy-sample'), '--out', out],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  app.close();
});

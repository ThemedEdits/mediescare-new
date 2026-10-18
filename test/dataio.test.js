'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { makeApp, setUpHeadOffice, signIn } = require('./helpers');
const parsers = require('../src/main/core/parsers');
const barcode = require('../src/main/core/barcode');
const stock = require('../src/main/core/stock');

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function world() {
  const app = makeApp();
  const { c: owner } = await setUpHeadOffice(app);
  return { app, owner };
}

async function roleId(c, name) {
  return (await c.call('roles.list', {})).find((r) => r.name === name).id;
}

test('parsers read CSV with quotes, TXT, JSON, XML, XLSX and XLS', () => {
  const csv = '﻿Brand name,Notes\r\n"Panadol, Extra","He said ""hi""\nnext line"\r\nBrufen,\r\n';
  const a = parsers.parseFile('x.csv', Buffer.from(csv));
  assert.deepEqual(a.headers, ['Brand name', 'Notes']);
  assert.deepEqual(a.rows[0], ['Panadol, Extra', 'He said "hi"\nnext line']);
  assert.equal(a.rows.length, 2);
  assert.deepEqual(parsers.parseFile('x.txt', Buffer.from('A\tB\n1\t2\n')).rows, [['1', '2']]);
  assert.deepEqual(parsers.parseFile('x.csv', Buffer.from('A;B\n1;2\n')).rows, [['1', '2']]);
  assert.deepEqual(parsers.parseFile('x.json', Buffer.from(JSON.stringify([{ A: 1, B: 'x' }, { A: 2 }]))).rows, [['1', 'x'], ['2', '']]);
  const xml = '<?xml version="1.0"?><export><report>R</report><rows><row><Brand_name>A &amp; B</Brand_name><Qty>3</Qty></row><row><Brand_name>C</Brand_name><Qty>4</Qty></row></rows></export>';
  const x = parsers.parseFile('x.xml', Buffer.from(xml));
  assert.deepEqual(x.headers, ['Brand_name', 'Qty']);
  assert.deepEqual(x.rows, [['A & B', '3'], ['C', '4']]);
  for (const bookType of ['xlsx', 'biff8']) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Expiry'], ['Panadol', '2027-03-31']]), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType });
    const t = parsers.parseFile(bookType === 'xlsx' ? 'a.xlsx' : 'a.xls', buf);
    assert.deepEqual(t.rows, [['Panadol', '2027-03-31']]);
  }
  assert.throws(() => parsers.parseFile('a.exe', Buffer.from('x')));
});

test('loose dates and yes/no', () => {
  assert.equal(parsers.looseDate('2027-03-31'), '2027-03-31');
  assert.equal(parsers.looseDate('31/03/2027'), '2027-03-31');
  assert.equal(parsers.looseDate('03/2027'), '2027-03-31');
  assert.equal(parsers.looseDate('02/2028'), '2028-02-29');
  assert.equal(parsers.looseDate('Mar-27'), '2027-03-31');
  assert.equal(parsers.looseDate('31/02/2027'), null);
  assert.equal(parsers.looseDate('46477'), '2027-03-31');
  assert.equal(parsers.looseBool('Yes'), true);
  assert.equal(parsers.looseBool(''), false);
  assert.equal(parsers.looseBool('maybe'), null);
});

test('Code 128 patterns are well formed and the checksum is right', () => {
  assert.equal(barcode.PATTERNS.length, 107);
  for (const [i, p] of barcode.PATTERNS.entries()) {
    const sum = [...p].reduce((a, c) => a + Number(c), 0);
    assert.equal(sum, i === 106 ? 13 : 11, `pattern ${i}`);
  }
  // PJJ123C in set B: (104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7) mod 103 = 879 mod 103 = 55
  const codes = barcode.encode('PJJ123C');
  assert.equal(codes[0], 104);
  assert.equal(codes[codes.length - 2], 55);
  // Long digit runs switch to set C.
  const digits = barcode.encode('8964000111222');
  // 13 digits: start in set C for 12 digits (6 symbols), switch to B (100) for the last one.
  assert.equal(digits[0], 105);
  assert.deepEqual(digits.slice(1, 7), [89, 64, 0, 1, 11, 22]);
  assert.equal(digits[7], 100);
  assert.equal(digits[8], '2'.charCodeAt(0) - 32);
  assert.ok(barcode.encode('AB123456').includes(99), 'a long digit run after letters switches to set C');
  assert.match(barcode.svg('ABC-1'), /^<svg/);
  assert.throws(() => barcode.encode('café'));
});

test('product import: preview shows row errors, nothing is written until all rows are valid', async () => {
  const { app, owner } = await world();
  const csv = [
    'Brand name,Generic name (salt),Strength,Units in one pack,MRP per pack,Barcode,Manufacturer,Prescription only (yes or no)',
    'Panadol,Paracetamol,500mg,10,30,111,GSK,no',
    ',Missing brand,1mg,10,5,,,no',
    'Brufen,Ibuprofen,400mg,ten,50,,Abbott,no',
    'Augmentin,Co-amoxiclav,625mg,6,450,111,GSK,maybe',
  ].join('\n');
  const loaded = await owner.call('import.load', { kind: 'products', fileName: 'products.csv', contentBase64: b64(csv) });
  assert.equal(loaded.rowCount, 4);
  assert.equal(loaded.mapping.brandName, 'Brand name');
  assert.equal(loaded.mapping.packSize, 'Units in one pack');
  const prev = await owner.call('import.preview', { sessionId: loaded.sessionId, mapping: loaded.mapping });
  assert.deepEqual(prev.counts, { new: 1, update: 0, skip: 0, error: 3 });
  assert.deepEqual(prev.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(prev.errors[0].error, /Brand name/);
  assert.match(prev.errors[1].error, /whole number/);
  assert.match(prev.errors[2].error, /also on row 2|yes or no/);
  const err = await owner.fail('import.commit', { sessionId: loaded.sessionId, mapping: loaded.mapping });
  assert.match(err.message, /Fix the 3 row/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0);

  const good = ['Brand name,Strength,Units in one pack,MRP per pack,Barcode,Manufacturer,Dosage form', 'Panadol,500mg,10,30,111,GSK,Tablet', 'Brufen,400mg,10,50,,Abbott,Tablet'].join('\n');
  const l2 = await owner.call('import.load', { kind: 'products', fileName: 'p.csv', contentBase64: b64(good) });
  const res = await owner.call('import.commit', { sessionId: l2.sessionId, mapping: l2.mapping });
  assert.deepEqual(res.counts, { new: 2, update: 0, skip: 0, error: 0 });
  const found = await owner.call('products.search', { q: '111' });
  assert.equal(found[0].brandName, 'Panadol');
  assert.equal(found[0].manufacturerName, 'GSK');
  assert.equal(found[0].mrp, 3000);
  // Session is single use.
  assert.equal((await owner.fail('import.preview', { sessionId: l2.sessionId, mapping: l2.mapping })).code, 'EXPIRED');

  // Same file again: skip by default, update on request.
  const again = ['Brand name,Strength,Units in one pack,MRP per pack,Barcode', 'Panadol,500mg,10,32,111'].join('\n');
  const l3 = await owner.call('import.load', { kind: 'products', fileName: 'p.csv', contentBase64: b64(again) });
  assert.deepEqual((await owner.call('import.preview', { sessionId: l3.sessionId, mapping: l3.mapping })).counts, { new: 0, update: 0, skip: 1, error: 0 });
  const upd = await owner.call('import.commit', { sessionId: l3.sessionId, mapping: l3.mapping, duplicates: 'update' });
  assert.equal(upd.counts.update, 1);
  assert.equal((await owner.call('products.search', { q: 'Panadol' }))[0].mrp, 3200);
  assert.equal((await owner.call('products.search', { q: 'Panadol' }))[0].manufacturerName, 'GSK', 'empty cells keep the old value');
  // An import is audited.
  assert.ok((await owner.call('audit.list', { module: 'import' })).total >= 2);
  app.close();
});

test('opening stock import from Excel creates batches and one opening adjustment', async () => {
  const { app, owner } = await world();
  await owner.call('products.create', { brandName: 'Panadol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, sku: 'PAN500' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Product', 'Batch', 'Expiry', 'Packs', 'Loose', 'Cost per pack', 'MRP per pack'],
    ['PAN500', 'A1', '12/2028', 5, 3, 25, 30],
    ['Panadol 500mg', 'A2', '2029-01-31', 2, 0, 26, 31],
  ]), 'Stock');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const l = await owner.call('import.load', { kind: 'opening_stock', fileName: 'stock.xlsx', contentBase64: buf.toString('base64') });
  const mapping = { product: 'Product', batchNo: 'Batch', expiryDate: 'Expiry', packs: 'Packs', loose: 'Loose', cost: 'Cost per pack', mrp: 'MRP per pack' };
  const prev = await owner.call('import.preview', { sessionId: l.sessionId, mapping });
  assert.deepEqual(prev.counts, { new: 2, update: 0, skip: 0, error: 0 });
  assert.equal(prev.rows[0].detail, '5 Strips + 3 Tablets');
  const res = await owner.call('import.commit', { sessionId: l.sessionId, mapping });
  assert.equal(res.adjustment.status, 'posted');
  const batches = (await owner.call('stock.batches', {})).rows;
  assert.deepEqual(batches.map((b) => [b.batchNo, b.expiryDate, b.onHand]), [['A1', '2028-12-31', 53], ['A2', '2029-01-31', 20]]);
  assert.equal(batches[0].cost, 2500);
  assert.deepEqual(stock.checkBalances(app.db), []);
  // A cashier cannot import.
  const { temporaryPassword } = await owner.call('users.create', { fullName: 'C', username: 'cashx', roleId: await roleId(owner, 'Cashier') });
  const { c: cashier } = await signIn(app, 'cashx', temporaryPassword);
  await cashier.call('auth.changePassword', { currentPassword: temporaryPassword, newPassword: 'Secret#123' });
  assert.equal((await cashier.fail('import.load', { kind: 'opening_stock', fileName: 'x.csv', contentBase64: b64('a') })).code, 'FORBIDDEN');
  app.close();
});

test('supplier import updates by code and templates download', async () => {
  const { app, owner } = await world();
  const csv = 'Company name,Supplier code,City,Payment terms (days),Opening balance owed\nAli Distributors,ALI,Lahore,30,1500\nZeta Pharma,ZET,Karachi,15,0\n';
  const l = await owner.call('import.load', { kind: 'suppliers', fileName: 's.csv', contentBase64: b64(csv) });
  await owner.call('import.commit', { sessionId: l.sessionId, mapping: l.mapping });
  const list = await owner.call('suppliers.list', {});
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.code === 'ALI').balance, 150000);
  const l2 = await owner.call('import.load', { kind: 'suppliers', fileName: 's.csv', contentBase64: b64('Company name,Supplier code,City\nAli Distributors,ALI,Multan\n') });
  await owner.call('import.commit', { sessionId: l2.sessionId, mapping: l2.mapping, duplicates: 'update' });
  const ali = (await owner.call('suppliers.list', {})).find((s) => s.code === 'ALI');
  assert.equal(ali.city, 'Multan');
  assert.equal(ali.paymentTermsDays, 30);
  for (const format of ['csv', 'xlsx']) {
    const r = await owner.call('import.template', { kind: 'products', format });
    assert.equal(r.saved, true);
  }
  const csvTemplate = app.saved.find((f) => f.ext === 'csv').content;
  assert.match(csvTemplate, /Brand name \*/);
  // A template filled in and loaded again maps every column by itself.
  const back = await owner.call('import.load', { kind: 'products', fileName: 't.csv', contentBase64: b64(csvTemplate) });
  assert.equal(Object.keys(back.mapping).length, back.fields.length);
  app.close();
});

test('export of any list in every format respects permissions and hides cost', async () => {
  const { app, owner } = await world();
  await owner.call('products.create', { brandName: 'Panadol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', tradePrice: '25' });
  const columns = [{ key: 'brandName', label: 'Brand' }, { key: 'mrp', label: 'MRP', type: 'money' }, { key: 'tradePrice', label: 'Trade price', type: 'money' }, { key: 'onHand', label: 'On hand', type: 'number', total: true }];
  for (const format of ['csv', 'xlsx', 'xls', 'pdf', 'txt', 'json', 'xml']) {
    const r = await owner.call('export.run', { source: 'products.list', title: 'Products', format, columns, params: {} });
    assert.equal(r.saved, true, format);
    assert.equal(r.rows, 1);
  }
  const csv = app.saved.find((f) => f.ext === 'csv').content;
  assert.match(csv, /Panadol,30.00,25.00,0/);
  assert.match(csv, /Total/);
  const xlsx = XLSX.read(app.saved.find((f) => f.ext === 'xlsx').content);
  const sheet = XLSX.utils.sheet_to_json(xlsx.Sheets[xlsx.SheetNames[0]], { header: 1 });
  const headerAt = sheet.findIndex((r) => r[0] === 'Brand');
  assert.deepEqual(sheet[headerAt + 1], ['Panadol', 30, 25, 0]);
  assert.ok(Buffer.isBuffer(app.saved.find((f) => f.ext === 'pdf').content));
  // Unknown sources are refused; a store keeper without products.export permission... has it; a cashier does not.
  assert.equal((await owner.fail('export.run', { source: 'users.list', title: 'U', columns })).code, 'UNKNOWN_METHOD');
  const pharm = (await owner.call('users.create', { fullName: 'P', username: 'pharm1', roleId: await roleId(owner, 'Pharmacist') }));
  const { c } = await signIn(app, 'pharm1', pharm.temporaryPassword);
  await c.call('auth.changePassword', { currentPassword: pharm.temporaryPassword, newPassword: 'Secret#123' });
  assert.equal((await c.fail('export.run', { source: 'products.list', title: 'P', columns })).code, 'FORBIDDEN');
  // Give the pharmacist export rights: cost columns still stay out of the file.
  const role = (await owner.call('roles.list', {})).find((r) => r.name === 'Pharmacist');
  await owner.call('roles.update', { id: role.id, name: role.name, permissions: [...role.permissions, 'products.export'] });
  app.saved.length = 0;
  await c.call('export.run', { source: 'products.list', title: 'P', format: 'csv', columns, params: {} });
  assert.ok(!/Trade price/.test(app.saved[0].content));
  app.close();
});

test('barcode labels print and save as PDF', async () => {
  const { app, owner } = await world();
  const p = await owner.call('products.create', { brandName: 'Panadol', strength: '500mg', baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, mrp: '30', barcodes: ['8964000111222'] });
  const prev = await owner.call('labels.preview', { items: [{ productId: p.id, copies: 2 }] });
  assert.equal(prev.length, 2);
  assert.equal(prev[0].code, '8964000111222');
  assert.match(prev[0].price, /MRP Rs 30.00 \/ Strip/);
  await owner.call('labels.print', { items: [{ productId: p.id, copies: 3 }], size: '38x25' });
  assert.equal((app.printed[0].html.match(/class="label"/g) || []).length, 3);
  assert.match(app.printed[0].html, /size: 38mm 25mm/);
  const pdf = await owner.call('labels.print', { items: [{ productId: p.id }], output: 'pdf' });
  assert.equal(pdf.saved, true);
  app.close();
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../src/main/core/money');
const { newId } = require('../src/main/core/ids');
const docnum = require('../src/main/core/docnum');
const { hashPassword, verifyPassword } = require('../src/main/core/password');
const { makeApp } = require('./helpers');

test('money parsing and rounding uses integers only', () => {
  assert.equal(money.parseMoney('1,250.50'), 125050);
  assert.equal(money.parseMoney('0.005'), 1);
  assert.equal(money.parseMoney('0.004'), 0);
  assert.equal(money.parseMoney(1.005), 101);
  assert.equal(money.parseMoney('-12.345'), -1235);
  assert.equal(money.parseMoney(''), null);
  assert.ok(Number.isNaN(money.parseMoney('12a')));
  // 3 tablets out of a strip of 10 priced 125.00
  assert.equal(money.mulRound(12500, 3, 10), 3750);
  assert.equal(money.mulRound(1000, 1, 3), 333);
  assert.equal(money.mulRound(-1000, 1, 3), -333);
  assert.equal(money.mulRound(5, 1, 2), 3);
  assert.equal(money.percentOf(10000, 1250), 1250);
  // 17% inclusive tax on 117.00 is 17.00
  assert.equal(money.inclusiveTax(11700, 1700), 1700);
  assert.equal(money.format(123456, { symbol: 'Rs', decimals: 2 }), 'Rs 1,234.56');
  assert.equal(money.format(123456, { symbol: 'Rs', decimals: 0 }), 'Rs 1,235');
  assert.equal(money.format(-5, { symbol: '', decimals: 2 }), '-0.05');
  assert.throws(() => money.sum([1, 0.5]));
});

test('ids are unique, ordered and 26 characters', () => {
  const ids = Array.from({ length: 5000 }, newId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)));
  const sorted = [...ids].sort();
  assert.deepEqual(sorted, ids);
});

test('document numbers include branch and device and never repeat', () => {
  const app = makeApp();
  const a = docnum.next(app.db, 'INV', 'LHR', 2);
  const b = docnum.next(app.db, 'INV', 'LHR', 2);
  const c = docnum.next(app.db, 'INV', 'LHR', 3);
  assert.equal(a, 'INV-LHR2-0001');
  assert.equal(b, 'INV-LHR2-0002');
  assert.equal(c, 'INV-LHR3-0001');
  app.close();
});

test('passwords are salted scrypt hashes', async () => {
  const h1 = await hashPassword('Secret#1');
  const h2 = await hashPassword('Secret#1');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('Secret#1', h1), true);
  assert.equal(await verifyPassword('secret#1', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

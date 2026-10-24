'use strict';
// The stock ledger engine. Every change to stock goes through post(); nothing else writes stock_ledger.
// Quantities are base units. Value of a movement = batch cost per pack * qty / pack size (batch costing).
const { newId, nowIso } = require('./ids');
const { mulRound } = require('./money');
const { fail } = require('./errors');

// Local calendar date (YYYY-MM-DD). Expiry dates are calendar dates, so the local day is what matters.
function today(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return today(new Date(y, m - 1, d + days));
}

// A moment on a local calendar date: now when the date is today, otherwise that date at the current local time.
// Used when a document carries a business date (received on, returned on) that may be in the past.
function atOnDate(isoDate) {
  if (!isoDate || isoDate === today()) return nowIso();
  const [y, m, d] = isoDate.split('-').map(Number);
  const n = new Date();
  return new Date(y, m - 1, d, n.getHours(), n.getMinutes(), n.getSeconds(), n.getMilliseconds()).toISOString();
}

function valueOf(cost, qty, packSize) {
  return mulRound(cost, qty, packSize);
}

// "3 Strips + 4 Tablets" style text so cashiers read quantities the way they count them.
function qtyText(qty, product) {
  const pack = product.pack_size || 1;
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(qty);
  if (pack <= 1) return `${sign}${abs} ${plural(product.base_unit, abs)}`;
  const packs = Math.floor(abs / pack);
  const loose = abs % pack;
  const parts = [];
  if (packs) parts.push(`${packs} ${plural(product.pack_unit, packs)}`);
  if (loose || !packs) parts.push(`${loose} ${plural(product.base_unit, loose)}`);
  return sign + parts.join(' + ');
}

function plural(word, n) {
  const w = word || 'unit';
  if (n === 1) return w;
  if (/(s|x|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

function balance(db, branchId, batchId) {
  const row = db.prepare('SELECT qty FROM stock_balances WHERE branch_id = ? AND batch_id = ?').get(branchId, batchId);
  return row ? row.qty : 0;
}

function productBalance(db, branchId, productId) {
  return db.prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_balances WHERE branch_id = ? AND product_id = ?').get(branchId, productId).q;
}

function loadBatch(db, batchId) {
  const b = db.prepare(`SELECT b.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit
    FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?`).get(batchId);
  if (!b) fail('NOT_FOUND', 'error.notFound', { thing: 'batch' });
  return b;
}

function productLabel(b) {
  return [b.brand_name, b.strength].filter(Boolean).join(' ');
}

// Posts one movement. Must be called inside the caller's transaction.
// qty is signed: positive adds stock, negative removes it.
function post(db, actor, m) {
  if (!Number.isSafeInteger(m.qty) || m.qty === 0) throw new Error('Stock movement quantity must be a non-zero integer');
  const batch = m.batch || loadBatch(db, m.batchId);
  const before = balance(db, m.branchId, batch.id);
  const after = before + m.qty;
  if (after < 0 && !m.allowNegative) {
    fail('NOT_ENOUGH_STOCK', 'stock.notEnough', {
      available: qtyText(Math.max(before, 0), batch), batch: batch.batch_no, product: productLabel(batch), wanted: qtyText(-m.qty, batch),
    }, { batchId: batch.id, available: before });
  }
  const at = m.at || nowIso();
  const row = {
    id: newId(), branch_id: m.branchId, product_id: batch.product_id, batch_id: batch.id, qty: m.qty, movement: m.movement,
    ref_type: m.refType, ref_id: m.refId || null, ref_no: m.refNo || null, cost: batch.cost, pack_size: batch.pack_size,
    value: valueOf(batch.cost, m.qty, batch.pack_size), before_qty: before, after_qty: after, reason: m.reason || null,
    user_id: actor ? actor.userId || null : null, device_id: actor ? actor.deviceId || null : null, at, updated_at: at,
  };
  db.prepare(`INSERT INTO stock_ledger (id, branch_id, product_id, batch_id, qty, movement, ref_type, ref_id, ref_no, cost, pack_size,
      value, before_qty, after_qty, reason, user_id, device_id, at, updated_at)
    VALUES (@id, @branch_id, @product_id, @batch_id, @qty, @movement, @ref_type, @ref_id, @ref_no, @cost, @pack_size,
      @value, @before_qty, @after_qty, @reason, @user_id, @device_id, @at, @updated_at)`).run(row);
  return row;
}

// Rebuilds the local balance cache from the ledger. Used after restore and by the consistency check.
function rebuildBalances(db) {
  db.transaction(() => {
    db.prepare('DELETE FROM stock_balances').run();
    db.prepare(`INSERT INTO stock_balances (branch_id, batch_id, product_id, qty)
      SELECT branch_id, batch_id, product_id, SUM(qty) FROM stock_ledger GROUP BY branch_id, batch_id, product_id`).run();
  })();
}

// Rows where the cache does not match the ledger. Empty means consistent.
function checkBalances(db) {
  return db.prepare(`SELECT l.branch_id, l.batch_id, l.total, COALESCE(s.qty, 0) AS cached FROM
      (SELECT branch_id, batch_id, SUM(qty) AS total FROM stock_ledger GROUP BY branch_id, batch_id) l
      LEFT JOIN stock_balances s ON s.branch_id = l.branch_id AND s.batch_id = l.batch_id
    WHERE l.total <> COALESCE(s.qty, 0)
    UNION ALL
    SELECT s.branch_id, s.batch_id, 0, s.qty FROM stock_balances s
    WHERE s.qty <> 0 AND NOT EXISTS (SELECT 1 FROM stock_ledger l WHERE l.branch_id = s.branch_id AND l.batch_id = s.batch_id)`).all();
}

function isQuarantined(db, branchId, batchId) {
  const r = db.prepare('SELECT quarantined FROM batch_status WHERE branch_id = ? AND batch_id = ?').get(branchId, batchId);
  return !!(r && r.quarantined);
}

// First expiry, first out. Returns [{ batch, qty }] covering `qty`, skipping expired and quarantined batches.
function fefo(db, branchId, productId, qty, { onDate = today(), includeExpired = false } = {}) {
  const rows = db.prepare(`SELECT b.*, s.qty AS on_hand, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit,
      COALESCE(bs.quarantined, 0) AS quarantined
    FROM stock_balances s JOIN batches b ON b.id = s.batch_id JOIN products p ON p.id = b.product_id
    LEFT JOIN batch_status bs ON bs.branch_id = s.branch_id AND bs.batch_id = s.batch_id
    WHERE s.branch_id = ? AND s.product_id = ? AND s.qty > 0
    ORDER BY b.expiry_date, b.received_at, b.id`).all(branchId, productId);
  const picks = [];
  let left = qty;
  for (const b of rows) {
    if (left <= 0) break;
    if (b.quarantined) continue;
    if (!includeExpired && b.expiry_date < onDate) continue;
    const take = Math.min(left, b.on_hand);
    picks.push({ batch: b, qty: take });
    left -= take;
  }
  return { picks, short: left > 0 ? left : 0, available: qty - Math.max(left, 0) };
}

module.exports = { today, addDays, atOnDate, valueOf, qtyText, plural, balance, productBalance, loadBatch, post, rebuildBalances, checkBalances, isQuarantined, fefo, productLabel };

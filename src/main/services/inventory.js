'use strict';
// Stock questions: batches on hand, the ledger ("why is this stock what it is"), expiry, valuation, reorder,
// fast/slow/dead movers; and batch edits and quarantine.
const { newId, nowIso } = require('../core/ids');
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const { canSeeCost, paging, like } = require('../core/docs');
const settings = require('./settings');
const { label, levels, stockStatus } = require('./products');
const { seesAllBranches } = require('./guards');

const MOVEMENT_LABELS = {
  OPENING: 'Opening stock', PURCHASE: 'Goods received', PURCHASE_CANCEL: 'Goods receipt cancelled', PURCHASE_RETURN: 'Returned to supplier',
  PURCHASE_RETURN_CANCEL: 'Supplier return cancelled', SALE: 'Sold', SALE_RETURN: 'Customer return', ADJUST_IN: 'Adjustment (increase)',
  ADJUST_OUT: 'Adjustment (decrease)', DAMAGED: 'Damaged', LOST: 'Lost', EXPIRED: 'Expired write-off', STOCKTAKE: 'Stock take correction',
  TRANSFER_OUT: 'Sent to branch', TRANSFER_IN: 'Received from branch', TRANSFER_BACK: 'Transfer shortage returned',
};

// Branch whose stock is shown: the active one, a chosen one (Head Office), or all.
function scope(ctx, params) {
  if (params.branchId === 'all') {
    if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
    return null;
  }
  if (params.branchId && params.branchId !== ctx.branchId) {
    if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
    return params.branchId;
  }
  return ctx.branchId;
}

function expiryState(expiry, onDate, nearDays) {
  if (expiry < onDate) return 'expired';
  const max = Math.max(...nearDays);
  if (expiry <= stock.addDays(onDate, max)) return 'near';
  return 'ok';
}

function daysLeft(expiry, onDate) {
  return Math.round((Date.parse(expiry) - Date.parse(onDate)) / 86400000);
}

function batchShape(ctx, r, onDate, nearDays) {
  const c = canSeeCost(ctx);
  return {
    batchId: r.id, productId: r.product_id, productLabel: label(r), sku: r.sku, genericName: r.generic_name, batchNo: r.batch_no,
    expiryDate: r.expiry_date, mfgDate: r.mfg_date, daysLeft: daysLeft(r.expiry_date, onDate), expiryState: expiryState(r.expiry_date, onDate, nearDays),
    mrp: r.mrp, cost: c ? r.cost : null, supplierName: r.supplier_name, receivedAt: r.received_at, branchId: r.branch_id, branchName: r.branch_name,
    onHand: r.on_hand, onHandText: stock.qtyText(r.on_hand, r), packSize: r.pack_size, packUnit: r.pack_unit, baseUnit: r.base_unit,
    quarantined: r.quarantined === 1, quarantineReason: r.q_reason,
    value: c ? stock.valueOf(r.cost, r.on_hand, r.pack_size) : null, mrpValue: money.mulRound(r.mrp, r.on_hand, r.pack_size),
    rack: r.rack, categoryName: r.category_name,
  };
}

const BATCH_SELECT = `SELECT b.*, s.qty AS on_hand, s.branch_id, br.name AS branch_name, p.brand_name, p.strength, p.sku, p.generic_name, p.pack_size, p.pack_unit, p.base_unit,
    sup.name AS supplier_name, COALESCE(bs.quarantined, 0) AS quarantined, bs.reason AS q_reason, pb.rack, cl.name AS category_name
  FROM stock_balances s JOIN batches b ON b.id = s.batch_id JOIN products p ON p.id = b.product_id JOIN branches br ON br.id = s.branch_id
  LEFT JOIN suppliers sup ON sup.id = b.supplier_id
  LEFT JOIN batch_status bs ON bs.branch_id = s.branch_id AND bs.batch_id = s.batch_id
  LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = s.branch_id
  LEFT JOIN lookups cl ON cl.id = p.category_id`;

const LEAN_FROM = `FROM stock_balances s JOIN batches b ON b.id = s.batch_id JOIN products p ON p.id = b.product_id
  LEFT JOIN batch_status bs ON bs.branch_id = s.branch_id AND bs.batch_id = s.batch_id`;

function batches(ctx, params) {
  const branchId = scope(ctx, params);
  const onDate = stock.today();
  const nearDays = settings.get(ctx.db, 'expiry.nearDays', ctx.branchId);
  const days = v.int(params, 'days', 'Days', { min: 0, max: 3650, fallback: Math.max(...nearDays) });
  const where = [];
  const args = { branch: branchId, onDate, nearTo: stock.addDays(onDate, days) };
  if (branchId) where.push('s.branch_id = @branch');
  if (params.productId) { where.push('s.product_id = @product'); args.product = params.productId; }
  if (params.categoryId) { where.push('p.category_id = @cat'); args.cat = params.categoryId; }
  if (params.supplierId) { where.push('b.supplier_id = @sup'); args.sup = params.supplierId; }
  if (params.search) { where.push("(p.brand_name LIKE @q ESCAPE '\\' OR p.generic_name LIKE @q ESCAPE '\\' OR b.batch_no LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
  switch (params.status || 'in_stock') {
    case 'in_stock': where.push('s.qty > 0'); break;
    case 'expired': where.push('s.qty > 0 AND b.expiry_date < @onDate'); break;
    case 'near': where.push('s.qty > 0 AND b.expiry_date >= @onDate AND b.expiry_date <= @nearTo'); break;
    case 'quarantine': where.push('COALESCE(bs.quarantined, 0) = 1 AND s.qty > 0'); break;
    case 'negative': where.push('s.qty < 0'); break;
    case 'all': break;
    default: break;
  }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pg = paging(params, { def: 100, max: 1000 });
  const sortMap = { expiryDate: 'b.expiry_date', productLabel: 'p.brand_name COLLATE NOCASE', onHand: 's.qty', batchNo: 'b.batch_no', receivedAt: 'b.received_at' };
  const sort = sortMap[params.sort] || 'b.expiry_date';
  const dir = params.dir === 'desc' ? 'DESC' : 'ASC';
  const rows = ctx.db.prepare(`${BATCH_SELECT} ${sql} ORDER BY ${sort} ${dir}, p.brand_name, b.id LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  // Count and totals read only the columns they need (the full select with every join is slow on 100,000 batches).
  const totalsRows = ctx.db.prepare(`SELECT b.cost, b.mrp, s.qty AS on_hand, p.pack_size ${LEAN_FROM} ${sql}`).all(args);
  const total = totalsRows.length;
  const totals = {
    qtyRows: totalsRows.length,
    value: canSeeCost(ctx) ? totalsRows.reduce((a, r) => a + stock.valueOf(r.cost, r.on_hand, r.pack_size), 0) : null,
    mrpValue: totalsRows.reduce((a, r) => a + money.mulRound(r.mrp, r.on_hand, r.pack_size), 0),
  };
  return { rows: rows.map((r) => batchShape(ctx, r, onDate, nearDays)), total, page: pg.page, pageSize: pg.pageSize, totals, nearDays, days };
}

// Every movement, newest first, with before and after quantities: the answer to "why is this stock what it is".
function ledger(ctx, params) {
  const branchId = scope(ctx, params);
  const where = [];
  const args = { branch: branchId };
  if (branchId) where.push('l.branch_id = @branch');
  if (params.productId) { where.push('l.product_id = @product'); args.product = params.productId; }
  if (params.batchId) { where.push('l.batch_id = @batch'); args.batch = params.batchId; }
  if (params.movement) { where.push('l.movement = @movement'); args.movement = params.movement; }
  if (params.refId) { where.push('l.ref_id = @ref'); args.ref = params.refId; }
  if (params.from) { where.push('l.at >= @from'); args.from = params.from; }
  if (params.to) { where.push('l.at < @to'); args.to = params.to; }
  if (params.search) { where.push("(p.brand_name LIKE @q ESCAPE '\\' OR b.batch_no LIKE @q ESCAPE '\\' OR l.ref_no LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pg = paging(params, { def: 100, max: 1000 });
  const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
  const from = `FROM stock_ledger l JOIN products p ON p.id = l.product_id JOIN batches b ON b.id = l.batch_id JOIN branches br ON br.id = l.branch_id LEFT JOIN users u ON u.id = l.user_id`;
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n ${from} ${sql}`).get(args).n;
  const rows = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, b.batch_no, b.expiry_date, br.name AS branch_name, u.username
    ${from} ${sql} ORDER BY l.at ${dir}, l.id ${dir} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  const c = canSeeCost(ctx);
  const sums = ctx.db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.qty > 0 THEN l.qty END), 0) AS qty_in, COALESCE(SUM(CASE WHEN l.qty < 0 THEN -l.qty END), 0) AS qty_out,
      COALESCE(SUM(l.value), 0) AS value ${from} ${sql}`).get(args);
  return {
    rows: rows.map((r) => ({
      id: r.id, at: r.at, movement: r.movement, movementLabel: MOVEMENT_LABELS[r.movement] || r.movement, productId: r.product_id, productLabel: label(r),
      batchId: r.batch_id, batchNo: r.batch_no, expiryDate: r.expiry_date, qty: r.qty, qtyText: stock.qtyText(r.qty, r),
      before: r.before_qty, after: r.after_qty, beforeText: stock.qtyText(r.before_qty, r), afterText: stock.qtyText(r.after_qty, r),
      refType: r.ref_type, refId: r.ref_id, refNo: r.ref_no, reason: r.reason, username: r.username, branchName: r.branch_name, value: c ? r.value : null,
    })),
    total, page: pg.page, pageSize: pg.pageSize,
    totals: { qtyIn: sums.qty_in, qtyOut: sums.qty_out, value: c ? sums.value : null },
  };
}

// One product at one branch: batches, on hand, and the ledger reconciliation for a period.
function productStock(ctx, params) {
  const productId = v.id(params, 'productId', 'Product');
  const branchId = scope(ctx, params) || ctx.branchId;
  const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
  const onDate = stock.today();
  const nearDays = settings.get(ctx.db, 'expiry.nearDays', ctx.branchId);
  const rows = ctx.db.prepare(`${BATCH_SELECT} WHERE s.branch_id = ? AND s.product_id = ? AND (s.qty <> 0 OR b.expiry_date >= ?) ORDER BY b.expiry_date`).all(branchId, productId, stock.addDays(onDate, -365));
  const from = v.date(params, 'from', 'From date') || stock.addDays(onDate, -30);
  const to = v.date(params, 'to', 'To date') || onDate;
  const fromIso = new Date(`${from}T00:00:00`).toISOString();
  const toIso = new Date(`${stock.addDays(to, 1)}T00:00:00`).toISOString();
  const opening = ctx.db.prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_ledger WHERE branch_id = ? AND product_id = ? AND at < ?').get(branchId, productId, fromIso).q;
  const byMove = ctx.db.prepare('SELECT movement, SUM(qty) AS q FROM stock_ledger WHERE branch_id = ? AND product_id = ? AND at >= ? AND at < ? GROUP BY movement').all(branchId, productId, fromIso, toIso);
  const closing = opening + byMove.reduce((a, m) => a + m.q, 0);
  const onHand = stock.productBalance(ctx.db, branchId, productId);
  return {
    product: { id: p.id, label: label(p), packSize: p.pack_size, packUnit: p.pack_unit, baseUnit: p.base_unit },
    onHand, onHandText: stock.qtyText(onHand, p),
    batches: rows.map((r) => batchShape(ctx, r, onDate, nearDays)),
    reconciliation: {
      from, to, opening, openingText: stock.qtyText(opening, p), closing, closingText: stock.qtyText(closing, p),
      movements: byMove.map((m) => ({ movement: m.movement, label: MOVEMENT_LABELS[m.movement], qty: m.q, qtyText: stock.qtyText(m.q, p) })),
    },
  };
}

// Expiry overview in the configured periods (for example 30, 60, 90 days).
function expiry(ctx, params) {
  const branchId = scope(ctx, params);
  const onDate = stock.today();
  const nearDays = settings.get(ctx.db, 'expiry.nearDays', ctx.branchId);
  const rows = ctx.db.prepare(`${BATCH_SELECT} WHERE s.qty > 0 ${branchId ? 'AND s.branch_id = @branch' : ''} AND b.expiry_date <= @limit`)
    .all({ branch: branchId, limit: stock.addDays(onDate, Math.max(...nearDays)) });
  const buckets = [{ key: 'expired', label: 'Expired', maxDays: -1 }, ...nearDays.map((d) => ({ key: `d${d}`, label: `Within ${d} days`, maxDays: d }))]
    .map((b) => ({ ...b, batches: 0, mrpValue: 0, value: canSeeCost(ctx) ? 0 : null }));
  for (const r of rows) {
    const left = daysLeft(r.expiry_date, onDate);
    const bucket = left < 0 ? buckets[0] : buckets.slice(1).find((b) => left <= b.maxDays);
    if (!bucket) continue;
    bucket.batches += 1;
    bucket.mrpValue += money.mulRound(r.mrp, r.on_hand, r.pack_size);
    if (bucket.value !== null) bucket.value += stock.valueOf(r.cost, r.on_hand, r.pack_size);
  }
  return { onDate, nearDays, buckets };
}

// Stock value at batch cost (and at MRP), grouped by branch, category, product or batch.
function valuation(ctx, params) {
  if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
  const branchId = scope(ctx, params);
  const groupBy = v.oneOf(params, 'groupBy', 'Group by', ['branch', 'category', 'product', 'batch'], { required: false, fallback: 'category' });
  const rows = ctx.db.prepare(`${BATCH_SELECT} WHERE s.qty <> 0 ${branchId ? 'AND s.branch_id = @branch' : ''}`).all({ branch: branchId });
  const groups = new Map();
  for (const r of rows) {
    const key = groupBy === 'branch' ? r.branch_id : groupBy === 'category' ? r.category_id || '-' : groupBy === 'product' ? r.product_id : r.id;
    const name = groupBy === 'branch' ? r.branch_name : groupBy === 'category' ? r.category_name || 'No category' : groupBy === 'product' ? label(r) : `${label(r)} - ${r.batch_no}`;
    const g = groups.get(key) || { key, name, qty: 0, batches: 0, value: 0, mrpValue: 0 };
    g.batches += 1;
    g.qty += r.on_hand;
    g.value += stock.valueOf(r.cost, r.on_hand, r.pack_size);
    g.mrpValue += money.mulRound(r.mrp, r.on_hand, r.pack_size);
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.value - a.value);
  return { groupBy, method: 'batch_cost', rows: list, total: { value: money.sum(list.map((g) => g.value)), mrpValue: money.sum(list.map((g) => g.mrpValue)), batches: rows.length } };
}

// Products at or below their reorder point, with a suggested quantity (in base units).
function reorder(ctx, params) {
  const rows = ctx.db.prepare(`SELECT p.*, pb.min_stock AS b_min, pb.max_stock AS b_max, pb.reorder_level AS b_reorder, pb.reorder_qty AS b_reorder_qty,
      s.name AS supplier_name,
      COALESCE((SELECT SUM(qty) FROM stock_balances sb WHERE sb.branch_id = @branch AND sb.product_id = p.id), 0) AS on_hand
    FROM products p LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = @branch LEFT JOIN suppliers s ON s.id = p.default_supplier_id
    WHERE p.active = 1 ${params.supplierId ? 'AND p.default_supplier_id = @supplier' : ''}`).all({ branch: ctx.branchId, supplier: params.supplierId || null });
  const out = [];
  for (const r of rows) {
    const lv = levels(r);
    const status = stockStatus(r.on_hand, lv);
    const trigger = lv.reorderLevel || lv.minStock;
    if (!trigger || r.on_hand > trigger) continue;
    let suggested = lv.reorderQty || (lv.maxStock ? lv.maxStock - r.on_hand : Math.max(lv.minStock * 2, trigger * 2) - r.on_hand);
    // Round up to whole packs: suppliers sell packs.
    suggested = Math.max(Math.ceil(Math.max(suggested, 1) / r.pack_size) * r.pack_size, r.pack_size);
    out.push({
      productId: r.id, productLabel: label(r), sku: r.sku, onHand: r.on_hand, onHandText: stock.qtyText(r.on_hand, r), status,
      reorderLevel: trigger, suggestedQty: suggested, suggestedText: stock.qtyText(suggested, r), packSize: r.pack_size, packUnit: r.pack_unit, baseUnit: r.base_unit,
      supplierId: r.default_supplier_id, supplierName: r.supplier_name, lastPrice: canSeeCost(ctx) ? r.trade_price : null,
    });
  }
  return out.sort((a, b) => (a.status === 'out' ? -1 : 0) - (b.status === 'out' ? -1 : 0) || a.productLabel.localeCompare(b.productLabel));
}

// Fast, slow and dead movers from sales in the last N days. Empty until selling starts (Phase 2).
function movers(ctx, params) {
  const days = v.int(params, 'days', 'Days', { min: 1, max: 3650, fallback: 90 });
  const kind = v.oneOf(params, 'kind', 'Type', ['fast', 'slow', 'dead'], { required: false, fallback: 'fast' });
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = ctx.db.prepare(`SELECT p.*, COALESCE(sold.q, 0) AS sold, COALESCE(sb.q, 0) AS on_hand FROM products p
    LEFT JOIN (SELECT product_id, -SUM(qty) AS q FROM stock_ledger WHERE branch_id = @branch AND movement IN ('SALE', 'SALE_RETURN') AND at >= @since GROUP BY product_id) sold ON sold.product_id = p.id
    LEFT JOIN (SELECT product_id, SUM(qty) AS q FROM stock_balances WHERE branch_id = @branch GROUP BY product_id) sb ON sb.product_id = p.id
    WHERE p.active = 1`).all({ branch: ctx.branchId, since });
  let list = rows.map((r) => ({ productId: r.id, productLabel: label(r), sold: r.sold, soldText: stock.qtyText(r.sold, r), onHand: r.on_hand, onHandText: stock.qtyText(r.on_hand, r), perDay: Math.round((r.sold / days) * 100) / 100 }));
  if (kind === 'dead') list = list.filter((x) => x.onHand > 0 && x.sold <= 0);
  else if (kind === 'fast') list = list.filter((x) => x.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 200);
  else list = list.filter((x) => x.onHand > 0 && x.sold > 0).sort((a, b) => a.sold - b.sold).slice(0, 200);
  return { days, kind, rows: list };
}

function updateBatch(ctx, params) {
  const b = ctx.db.prepare('SELECT * FROM batches WHERE id = ?').get(v.id(params, 'id', 'Batch'));
  if (!b) fail('NOT_FOUND', 'error.notFound', { thing: 'batch' });
  const next = {
    batch_no: v.text(params, 'batchNo', 'Batch number', { required: true, max: 40 }),
    expiry_date: v.date(params, 'expiryDate', 'Expiry date', { required: true }),
    mfg_date: v.date(params, 'mfgDate', 'Manufacture date'),
    mrp: v.money(params, 'mrp', 'MRP', { required: true }),
  };
  if (next.mfg_date && next.mfg_date > next.expiry_date) fail('VALIDATION', 'stock.expiryBeforeMfg');
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const change = audit.diff({ batch_no: b.batch_no, expiry_date: b.expiry_date, mfg_date: b.mfg_date, mrp: b.mrp }, next);
  if (!change.changed) return { changed: false };
  ctx.db.transaction(() => {
    // Cost is never edited here: it is the basis of stock value and cost of goods sold already recorded.
    ctx.db.prepare('UPDATE batches SET batch_no = @batch_no, expiry_date = @expiry_date, mfg_date = @mfg_date, mrp = @mrp, updated_at = @now WHERE id = @id').run({ ...next, id: b.id, now: nowIso() });
    audit.write(ctx.db, ctx.actor, { module: 'batches', action: 'update', recordType: 'batch', recordId: b.id, summary: `Batch ${b.batch_no} changed (${Object.keys(change.new).join(', ')})`, old: change.old, new: change.new, reason });
  })();
  return { changed: true };
}

function setQuarantine(ctx, params) {
  const batchId = v.id(params, 'batchId', 'Batch');
  const b = stock.loadBatch(ctx.db, batchId);
  const quarantined = v.bool(params, 'quarantined');
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const current = ctx.db.prepare('SELECT * FROM batch_status WHERE branch_id = ? AND batch_id = ?').get(ctx.branchId, batchId);
  const now = nowIso();
  ctx.db.transaction(() => {
    if (current) ctx.db.prepare('UPDATE batch_status SET quarantined = ?, reason = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(quarantined ? 1 : 0, reason, ctx.userId, now, current.id);
    else ctx.db.prepare('INSERT INTO batch_status (id, branch_id, batch_id, quarantined, reason, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId(), ctx.branchId, batchId, quarantined ? 1 : 0, reason, ctx.userId, now, now);
    audit.write(ctx.db, ctx.actor, { module: 'batches', action: quarantined ? 'quarantine' : 'release', recordType: 'batch', recordId: batchId, summary: `Batch ${b.batch_no} of ${stock.productLabel(b)} ${quarantined ? 'put in quarantine' : 'released from quarantine'}`, reason });
  })();
  return { quarantined };
}

function register(define) {
  define('stock.batches', { perm: ['batches.view', 'stock.view'] }, batches);
  define('stock.ledger', { perm: ['stock.view', 'batches.view'] }, ledger);
  define('stock.product', { perm: ['stock.view', 'products.view'] }, productStock);
  define('stock.expiry', { perm: ['batches.view', 'stock.view'] }, expiry);
  define('stock.valuation', { perm: 'stock.view' }, valuation);
  define('stock.reorder', { perm: ['stock.view', 'purchases.view'] }, reorder);
  define('stock.movers', { perm: ['stock.view', 'reports.view'] }, movers);
  define('stock.movements', { perm: ['stock.view', 'batches.view'] }, () => Object.entries(MOVEMENT_LABELS).map(([key, text]) => ({ key, label: text })));
  define('stock.check', { perm: 'stock.approve' }, (ctx) => ({ mismatches: stock.checkBalances(ctx.db) }));
  define('batches.update', { perm: 'batches.edit' }, updateBatch);
  define('batches.setQuarantine', { perm: 'batches.edit' }, setQuarantine);
}

module.exports = { register, MOVEMENT_LABELS };

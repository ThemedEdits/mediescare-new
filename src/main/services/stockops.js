'use strict';
// Stock adjustments (opening, increase, decrease, damaged, lost, expired write-off) with an approval limit,
// and stock takes (count, variance report, post corrections).
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const { nextNo, canSeeCost, paging } = require('../core/docs');
const settings = require('./settings');
const { label } = require('./products');
const { seesAllBranches } = require('./guards');

const KIND = {
  opening: { movement: 'OPENING', sign: 1, label: 'Opening stock' },
  increase: { movement: 'ADJUST_IN', sign: 1, label: 'Increase' },
  decrease: { movement: 'ADJUST_OUT', sign: -1, label: 'Decrease' },
  damaged: { movement: 'DAMAGED', sign: -1, label: 'Damaged' },
  lost: { movement: 'LOST', sign: -1, label: 'Lost or stolen' },
  expired: { movement: 'EXPIRED', sign: -1, label: 'Expired write-off' },
};

function assertBranchDoc(ctx, doc, thing) {
  if (!doc) fail('NOT_FOUND', 'error.notFound', { thing });
  if (doc.branch_id !== ctx.branchId && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
}

// ---- adjustments ---------------------------------------------------------------------------------------------------

function readAdjustmentLines(ctx, kind, params) {
  const raw = Array.isArray(params.lines) ? params.lines : [];
  if (!raw.length) invalid('lines', 'error.noLines');
  const today = stock.today();
  return raw.map((l, i) => {
    // Opening stock and increases may create a new batch; everything else works on an existing batch.
    if (!l.batchId && KIND[kind].sign > 0) {
      if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
      const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(l.productId || '');
      if (!p) invalid(`lines.${i}.productId`, 'error.required', { field: 'Product' });
      const line = {
        product: p, batch: null,
        batch_no: v.text(l, 'batchNo', `Batch number of ${label(p)}`, { required: true, max: 40 }),
        expiry_date: v.date(l, 'expiryDate', `Expiry date of ${label(p)}`, { required: true }),
        mfg_date: v.date(l, 'mfgDate', 'Manufacture date'),
        mrp: v.money(l, 'mrp', `MRP of ${label(p)}`, { fallback: p.mrp }),
        cost: v.money(l, 'cost', `Cost of ${label(p)}`, { fallback: p.trade_price }),
        qty: v.int(l, 'qty', `Quantity of ${label(p)}`, { required: true, min: 1 }),
      };
      if (line.mfg_date && line.mfg_date > line.expiry_date) invalid(`lines.${i}.mfgDate`, 'stock.expiryBeforeMfg');
      line.value = stock.valueOf(line.cost, line.qty, p.pack_size);
      return line;
    }
    const batch = stock.loadBatch(ctx.db, v.id(l, 'batchId', 'Batch'));
    if (l.productId && l.productId !== batch.product_id) invalid(`lines.${i}.batchId`, 'stock.batchWrongProduct');
    const qty = v.int(l, 'qty', `Quantity of ${stock.productLabel(batch)}`, { required: true, min: 1 });
    if (kind === 'expired' && batch.expiry_date >= today) invalid(`lines.${i}.batchId`, 'stock.notExpired', { batch: batch.batch_no });
    return { product: { id: batch.product_id, pack_size: batch.pack_size }, batch, qty, value: stock.valueOf(batch.cost, qty, batch.pack_size) };
  });
}

// Writes the ledger rows (and new batches) for an adjustment. Runs inside a transaction.
function postAdjustment(ctx, adj, actor) {
  const db = ctx.db;
  const k = KIND[adj.kind];
  const lines = db.prepare('SELECT * FROM stock_adjustment_lines WHERE adjustment_id = ?').all(adj.id);
  for (const l of lines) {
    let batchId = l.batch_id;
    if (!batchId) {
      batchId = newId();
      const now = nowIso();
      db.prepare(`INSERT INTO batches (id, product_id, batch_no, expiry_date, mfg_date, mrp, cost, trade_price, supplier_id, received_at, origin_branch_id, source_type, source_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(batchId, l.product_id, l.batch_no, l.expiry_date, l.mfg_date, l.mrp, l.cost, l.cost, now, adj.branch_id,
        adj.kind === 'opening' ? 'opening' : 'adjustment', adj.id, now, now);
      db.prepare('UPDATE stock_adjustment_lines SET batch_id = ?, updated_at = ? WHERE id = ?').run(batchId, now, l.id);
    }
    stock.post(db, actor, { branchId: adj.branch_id, batchId, qty: k.sign * l.qty, movement: k.movement, refType: 'adjustment', refId: adj.id, refNo: adj.doc_no, reason: adj.reason });
  }
}

function adjustmentShape(ctx, a, withLines) {
  const c = canSeeCost(ctx);
  const out = {
    id: a.id, docNo: a.doc_no, branchId: a.branch_id, kind: a.kind, kindLabel: KIND[a.kind].label, status: a.status, reason: a.reason,
    totalValue: c ? a.total_value : null, requestedBy: a.requested_by_name, decidedBy: a.decided_by_name, decidedAt: a.decided_at,
    decisionReason: a.decision_reason, createdAt: a.created_at, requestedById: a.requested_by,
  };
  if (withLines) {
    out.lines = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, b.batch_no AS b_no, b.expiry_date AS b_exp
      FROM stock_adjustment_lines l JOIN products p ON p.id = l.product_id LEFT JOIN batches b ON b.id = l.batch_id WHERE l.adjustment_id = ?`).all(a.id).map((l) => ({
      id: l.id, productId: l.product_id, productLabel: label(l), batchId: l.batch_id, batchNo: l.b_no || l.batch_no, expiryDate: l.b_exp || l.expiry_date,
      qty: l.qty, qtyText: stock.qtyText(l.qty, l), value: c ? l.value : null,
    }));
  }
  return out;
}

function loadAdjustment(ctx, id) {
  const a = ctx.db.prepare(`SELECT a.*, u1.username AS requested_by_name, u2.username AS decided_by_name FROM stock_adjustments a
    LEFT JOIN users u1 ON u1.id = a.requested_by LEFT JOIN users u2 ON u2.id = a.decided_by WHERE a.id = ?`).get(id);
  assertBranchDoc(ctx, a, 'adjustment');
  return a;
}

function createAdjustment(ctx, params) {
  const kind = v.oneOf(params, 'kind', 'Type', Object.keys(KIND));
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 500 });
  const lines = readAdjustmentLines(ctx, kind, params);
  const total = money.sum(lines.map((l) => l.value));
  const limit = settings.get(ctx.db, 'stock.adjustApprovalValue', ctx.branchId) * 100;
  // Above the limit, someone with approval permission must decide (unless the creator has it).
  const needsApproval = total > limit && !ctx.can('stock.approve');
  const id = newId();
  const now = nowIso();
  ctx.db.transaction(() => {
    const docNo = nextNo(ctx, 'ADJ');
    ctx.db.prepare(`INSERT INTO stock_adjustments (id, branch_id, doc_no, kind, status, reason, total_value, requested_by, decided_by, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.branchId, docNo, kind, needsApproval ? 'pending' : 'posted', reason, total, ctx.userId,
      needsApproval ? null : ctx.userId, needsApproval ? null : now, now, now);
    const insert = ctx.db.prepare(`INSERT INTO stock_adjustment_lines (id, adjustment_id, branch_id, product_id, batch_id, batch_no, expiry_date, mfg_date, mrp, cost, qty, value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lines) {
      insert.run(newId(), id, ctx.branchId, l.product.id, l.batch ? l.batch.id : null, l.batch ? null : l.batch_no, l.batch ? null : l.expiry_date,
        l.batch ? null : l.mfg_date, l.batch ? null : l.mrp, l.batch ? null : l.cost, l.qty, l.value, now, now);
      // Check stock now so a pending request is not obviously impossible.
      if (l.batch && KIND[kind].sign < 0) {
        const available = stock.balance(ctx.db, ctx.branchId, l.batch.id);
        if (available < l.qty) {
          fail('NOT_ENOUGH_STOCK', 'stock.notEnough', { available: stock.qtyText(Math.max(available, 0), l.batch), batch: l.batch.batch_no, product: stock.productLabel(l.batch), wanted: stock.qtyText(l.qty, l.batch) });
        }
      }
    }
    const adj = ctx.db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(id);
    if (!needsApproval) postAdjustment(ctx, adj, ctx.actor);
    audit.write(ctx.db, ctx.actor, { module: 'stock', action: needsApproval ? 'request_adjustment' : 'post_adjustment', recordType: 'adjustment', recordId: id,
      summary: `${KIND[kind].label} ${docNo}: ${lines.length} item(s)${needsApproval ? ', waiting for approval' : ''}`, new: { kind, total, lines: lines.length }, reason });
  })();
  return { ...adjustmentShape(ctx, loadAdjustment(ctx, id), true), needsApproval };
}

function decideAdjustment(ctx, params) {
  const a = loadAdjustment(ctx, v.id(params, 'id'));
  if (a.status !== 'pending') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'adjustment', status: a.status });
  if (a.requested_by === ctx.userId) fail('FORBIDDEN', 'stock.selfApprove');
  const approve = v.bool(params, 'approve');
  const reason = v.text(params, 'reason', 'Reason', { required: !approve, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE stock_adjustments SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ? WHERE id = ?')
      .run(approve ? 'posted' : 'rejected', ctx.userId, now, reason, now, a.id);
    // The ledger rows carry the approver, who is the person who made the stock change happen.
    if (approve) postAdjustment(ctx, { ...a, status: 'posted' }, ctx.actor);
    audit.write(ctx.db, ctx.actor, { module: 'stock', action: approve ? 'approve_adjustment' : 'reject_adjustment', recordType: 'adjustment', recordId: a.id, summary: `Adjustment ${a.doc_no} ${approve ? 'approved and posted' : 'rejected'}`, reason });
  })();
  return adjustmentShape(ctx, loadAdjustment(ctx, a.id), true);
}

// ---- stock takes ---------------------------------------------------------------------------------------------------

function takeShape(ctx, t, withLines) {
  const c = canSeeCost(ctx);
  const out = { id: t.id, docNo: t.doc_no, branchId: t.branch_id, name: t.name, status: t.status, filter: JSON.parse(t.filter), startedAt: t.started_at, postedAt: t.posted_at, notes: t.notes, startedBy: t.started_by_name };
  const lines = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, b.batch_no, b.expiry_date, b.cost, pb.rack
    FROM stock_take_lines l JOIN products p ON p.id = l.product_id JOIN batches b ON b.id = l.batch_id
    LEFT JOIN product_branch pb ON pb.product_id = l.product_id AND pb.branch_id = l.branch_id
    WHERE l.take_id = ? ORDER BY pb.rack, p.brand_name COLLATE NOCASE, b.expiry_date`).all(t.id);
  const counted = lines.filter((l) => l.counted_qty !== null);
  out.summary = {
    lines: lines.length, counted: counted.length,
    varianceLines: counted.filter((l) => l.counted_qty !== l.system_qty).length,
    varianceValue: c ? counted.reduce((a, l) => a + stock.valueOf(l.cost, l.counted_qty - l.system_qty, l.pack_size), 0) : null,
  };
  if (withLines) {
    out.lines = lines.map((l) => {
      const variance = l.counted_qty === null ? null : l.counted_qty - l.system_qty;
      return {
        id: l.id, productId: l.product_id, productLabel: label(l), batchId: l.batch_id, batchNo: l.batch_no, expiryDate: l.expiry_date, rack: l.rack,
        packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit,
        systemQty: l.system_qty, systemText: stock.qtyText(l.system_qty, l), countedQty: l.counted_qty, countedText: l.counted_qty === null ? '' : stock.qtyText(l.counted_qty, l),
        variance, varianceText: variance === null ? '' : stock.qtyText(variance, l), value: c && variance !== null ? stock.valueOf(l.cost, variance, l.pack_size) : null, note: l.note,
      };
    });
  }
  return out;
}

function loadTake(ctx, id) {
  const t = ctx.db.prepare('SELECT t.*, u.username AS started_by_name FROM stock_takes t LEFT JOIN users u ON u.id = t.started_by WHERE t.id = ?').get(id);
  assertBranchDoc(ctx, t, 'stock take');
  return t;
}

function startTake(ctx, params) {
  const open = ctx.db.prepare("SELECT doc_no FROM stock_takes WHERE branch_id = ? AND status = 'counting'").get(ctx.branchId);
  if (open) fail('IN_USE', 'stock.takeOpen', { doc: open.doc_no });
  const name = v.text(params, 'name', 'Name', { max: 120 }) || `Stock take ${stock.today()}`;
  const filter = { categoryId: v.optionalId(params, 'categoryId', 'Category'), rack: v.text(params, 'rack', 'Rack', { max: 40 }), productId: v.optionalId(params, 'productId', 'Product') };
  const where = ['s.branch_id = @branch', 's.qty > 0'];
  if (filter.categoryId) where.push('p.category_id = @categoryId');
  if (filter.rack) where.push('pb.rack = @rack');
  if (filter.productId) where.push('p.id = @productId');
  const rows = ctx.db.prepare(`SELECT s.* FROM stock_balances s JOIN products p ON p.id = s.product_id
    LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = s.branch_id WHERE ${where.join(' AND ')}`).all({ branch: ctx.branchId, ...filter });
  if (!rows.length) fail('VALIDATION', 'stock.takeNothing');
  const id = newId();
  const now = nowIso();
  ctx.db.transaction(() => {
    const docNo = nextNo(ctx, 'STK');
    ctx.db.prepare(`INSERT INTO stock_takes (id, branch_id, doc_no, name, status, filter, started_by, started_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'counting', ?, ?, ?, ?, ?, ?)`).run(id, ctx.branchId, docNo, name, JSON.stringify(filter), ctx.userId, now, v.text(params, 'notes', 'Notes', { max: 500 }), now, now);
    const insert = ctx.db.prepare('INSERT INTO stock_take_lines (id, take_id, branch_id, product_id, batch_id, system_qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) insert.run(newId(), id, ctx.branchId, r.product_id, r.batch_id, r.qty, now, now);
    audit.write(ctx.db, ctx.actor, { module: 'stocktake', action: 'start', recordType: 'stock_take', recordId: id, summary: `Stock take ${docNo} started with ${rows.length} batch(es)`, new: filter });
  })();
  return takeShape(ctx, loadTake(ctx, id), true);
}

function saveCounts(ctx, params) {
  const t = loadTake(ctx, v.id(params, 'id'));
  if (t.status !== 'counting') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'stock take', status: t.status });
  const counts = Array.isArray(params.counts) ? params.counts : [];
  const now = nowIso();
  ctx.db.transaction(() => {
    for (const [i, c] of counts.entries()) {
      const line = ctx.db.prepare('SELECT * FROM stock_take_lines WHERE id = ? AND take_id = ?').get(c.lineId || '', t.id);
      if (!line) invalid(`counts.${i}.lineId`, 'error.invalid', { field: 'Line' });
      const counted = c.countedQty === null || c.countedQty === '' ? null : v.int(c, 'countedQty', 'Counted quantity', { min: 0 });
      ctx.db.prepare('UPDATE stock_take_lines SET counted_qty = ?, note = ?, counted_by = ?, updated_at = ? WHERE id = ?').run(counted, v.text(c, 'note', 'Note', { max: 200 }), ctx.userId, now, line.id);
    }
    // A batch found on the shelf that was not in the list (system quantity is what the ledger says now).
    for (const add of Array.isArray(params.add) ? params.add : []) {
      const batch = stock.loadBatch(ctx.db, v.id(add, 'batchId', 'Batch'));
      if (ctx.db.prepare('SELECT 1 FROM stock_take_lines WHERE take_id = ? AND batch_id = ?').get(t.id, batch.id)) continue;
      ctx.db.prepare('INSERT INTO stock_take_lines (id, take_id, branch_id, product_id, batch_id, system_qty, counted_qty, counted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), t.id, t.branch_id, batch.product_id, batch.id, stock.balance(ctx.db, t.branch_id, batch.id), v.int(add, 'countedQty', 'Counted quantity', { min: 0 }), ctx.userId, now, now);
    }
    ctx.db.prepare('UPDATE stock_takes SET updated_at = ? WHERE id = ?').run(now, t.id);
  })();
  return takeShape(ctx, loadTake(ctx, t.id), true);
}

// Posting applies counted - system (the quantity at the start of the count). Sales and receipts made while
// counting are real movements and stay; only the difference found by counting is corrected.
function postTake(ctx, params) {
  const t = loadTake(ctx, v.id(params, 'id'));
  if (t.status !== 'counting') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'stock take', status: t.status });
  const lines = ctx.db.prepare('SELECT * FROM stock_take_lines WHERE take_id = ? AND counted_qty IS NOT NULL').all(t.id);
  const now = nowIso();
  ctx.db.transaction(() => {
    for (const l of lines) {
      const variance = l.counted_qty - l.system_qty;
      const batch = stock.loadBatch(ctx.db, l.batch_id);
      ctx.db.prepare('UPDATE stock_take_lines SET variance = ?, value = ?, updated_at = ? WHERE id = ?').run(variance, stock.valueOf(batch.cost, variance, batch.pack_size), now, l.id);
      if (variance !== 0) stock.post(ctx.db, ctx.actor, { branchId: t.branch_id, batch, qty: variance, movement: 'STOCKTAKE', refType: 'stock_take', refId: t.id, refNo: t.doc_no, reason: l.note || 'Counted' });
    }
    ctx.db.prepare("UPDATE stock_takes SET status = 'posted', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, now, t.id);
    audit.write(ctx.db, ctx.actor, { module: 'stocktake', action: 'post', recordType: 'stock_take', recordId: t.id, summary: `Stock take ${t.doc_no} posted: ${lines.filter((l) => l.counted_qty !== l.system_qty).length} correction(s)` });
  })();
  return takeShape(ctx, loadTake(ctx, t.id), true);
}

function register(define) {
  define('adjustments.list', { perm: 'stock.view' }, (ctx, params) => {
    const where = ['a.branch_id = @branch'];
    const args = { branch: ctx.branchId };
    if (params.status) { where.push('a.status = @status'); args.status = params.status; }
    if (params.kind) { where.push('a.kind = @kind'); args.kind = params.kind; }
    if (params.search) { where.push("(a.doc_no LIKE @q OR a.reason LIKE @q)"); args.q = `%${params.search}%`; }
    const pg = paging(params);
    const sql = `FROM stock_adjustments a LEFT JOIN users u1 ON u1.id = a.requested_by LEFT JOIN users u2 ON u2.id = a.decided_by WHERE ${where.join(' AND ')}`;
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(args).n;
    const rows = ctx.db.prepare(`SELECT a.*, u1.username AS requested_by_name, u2.username AS decided_by_name ${sql} ORDER BY a.created_at ${params.dir === 'asc' ? 'ASC' : 'DESC'} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
    return { rows: rows.map((a) => adjustmentShape(ctx, a, false)), total, page: pg.page, pageSize: pg.pageSize };
  });
  define('adjustments.get', { perm: 'stock.view' }, (ctx, params) => adjustmentShape(ctx, loadAdjustment(ctx, v.id(params, 'id')), true));
  define('adjustments.create', { perm: 'stock.create' }, createAdjustment);
  define('adjustments.decide', { perm: 'stock.approve' }, decideAdjustment);

  define('stocktake.list', { perm: 'stocktake.view' }, (ctx) => ctx.db.prepare(`SELECT t.*, u.username AS started_by_name FROM stock_takes t LEFT JOIN users u ON u.id = t.started_by
    WHERE t.branch_id = ? ORDER BY t.started_at DESC LIMIT 500`).all(ctx.branchId).map((t) => takeShape(ctx, t, false)));
  define('stocktake.get', { perm: 'stocktake.view' }, (ctx, params) => takeShape(ctx, loadTake(ctx, v.id(params, 'id')), true));
  define('stocktake.start', { perm: 'stocktake.create' }, startTake);
  define('stocktake.saveCounts', { perm: 'stocktake.create' }, saveCounts);
  define('stocktake.post', { perm: 'stocktake.approve' }, postTake);
  define('stocktake.cancel', { perm: 'stocktake.approve' }, (ctx, params) => {
    const t = loadTake(ctx, v.id(params, 'id'));
    if (t.status !== 'counting') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'stock take', status: t.status });
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE stock_takes SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), t.id);
      audit.write(ctx.db, ctx.actor, { module: 'stocktake', action: 'cancel', recordType: 'stock_take', recordId: t.id, summary: `Stock take ${t.doc_no} cancelled`, reason });
    })();
    return takeShape(ctx, loadTake(ctx, t.id), false);
  });
}

module.exports = { register, KIND, createAdjustment };

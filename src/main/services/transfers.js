'use strict';
// Transfers between branches: request -> approve -> dispatch (stock leaves, by batch) -> receive (stock arrives,
// same batches and expiry) with differences recorded and resolved. Also used to return stock to the Head Office.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const { nextNo, canSeeCost, paging } = require('../core/docs');
const settings = require('./settings');
const { label } = require('./products');
const { seesAllBranches } = require('./guards');

function loadTransfer(ctx, id) {
  const t = ctx.db.prepare(`SELECT t.*, bf.name AS from_name, bt.name AS to_name FROM transfers t
    JOIN branches bf ON bf.id = t.from_branch_id JOIN branches bt ON bt.id = t.to_branch_id WHERE t.id = ?`).get(id);
  if (!t) fail('NOT_FOUND', 'error.notFound', { thing: 'transfer' });
  if (![t.from_branch_id, t.to_branch_id].includes(ctx.branchId) && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
  return t;
}

// Each step happens at one side: sending branch approves, dispatches and resolves; receiving branch receives.
function assertSide(ctx, t, side) {
  const branchId = side === 'from' ? t.from_branch_id : t.to_branch_id;
  if (ctx.branchId !== branchId) fail('FORBIDDEN', 'transfers.wrongSide', { side: side === 'from' ? `sending (${t.from_name})` : `receiving (${t.to_name})` });
}

function assertStatus(t, allowed) {
  if (!allowed.includes(t.status)) fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'transfer', status: t.status });
}

function shape(ctx, t, withLines) {
  const c = canSeeCost(ctx);
  const out = {
    id: t.id, docNo: t.doc_no, fromBranchId: t.from_branch_id, fromName: t.from_name, toBranchId: t.to_branch_id, toName: t.to_name,
    status: t.status, notes: t.notes, requestedAt: t.requested_at, decidedAt: t.decided_at, decisionReason: t.decision_reason,
    dispatchedAt: t.dispatched_at, receivedAt: t.received_at, hasDiscrepancy: t.has_discrepancy === 1, discrepancyOpen: t.discrepancy_open === 1,
    direction: t.from_branch_id === ctx.branchId ? 'out' : t.to_branch_id === ctx.branchId ? 'in' : 'other', createdAt: t.created_at,
  };
  if (withLines) {
    const rows = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, b.batch_no, b.expiry_date FROM transfer_lines l
      JOIN products p ON p.id = l.product_id LEFT JOIN batches b ON b.id = l.batch_id WHERE l.transfer_id = ? AND l.deleted_at IS NULL ORDER BY l.created_at, l.id`).all(t.id);
    out.requests = rows.filter((l) => l.line_type === 'request').map((l) => {
      const sent = rows.filter((d) => d.parent_id === l.id).reduce((a, d) => a + d.qty, 0);
      return { id: l.id, productId: l.product_id, productLabel: label(l), qty: l.qty, qtyText: stock.qtyText(l.qty, l), sentQty: sent, sentText: stock.qtyText(sent, l), packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit };
    });
    out.lines = rows.filter((l) => l.line_type === 'dispatch').map((l) => ({
      id: l.id, parentId: l.parent_id, productId: l.product_id, productLabel: label(l), batchId: l.batch_id, batchNo: l.batch_no, expiryDate: l.expiry_date,
      qty: l.qty, qtyText: stock.qtyText(l.qty, l), receivedQty: l.received_qty, receivedText: l.received_qty === null ? '' : stock.qtyText(l.received_qty, l),
      shortQty: l.received_qty === null ? null : l.qty - l.received_qty, discrepancyReason: l.discrepancy_reason, resolution: l.resolution,
      packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit, value: c && l.cost !== null ? stock.valueOf(l.cost, l.qty, l.pack_size) : null,
    }));
  }
  return out;
}

function readRequestLines(ctx, params) {
  const raw = Array.isArray(params.lines) ? params.lines : [];
  if (!raw.length) invalid('lines', 'error.noLines');
  return raw.map((l, i) => {
    const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(l.productId || '');
    if (!p) invalid(`lines.${i}.productId`, 'error.required', { field: 'Product' });
    return { product: p, qty: v.int(l, 'qty', `Quantity of ${label(p)}`, { required: true, min: 1 }), batchId: v.optionalId(l, 'batchId', 'Batch') };
  });
}

// mode 'request': this branch asks another branch (usually Head Office) for stock.
// mode 'send': this branch sends stock to another branch (Head Office supplying, or a branch returning stock).
function create(ctx, params) {
  const mode = v.oneOf(params, 'mode', 'Type', ['request', 'send']);
  const other = ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(params.otherBranchId || '');
  if (!other) invalid('otherBranchId', 'error.required', { field: 'Branch' });
  if (!other.active) invalid('otherBranchId', 'error.branchInactive');
  if (other.id === ctx.branchId) invalid('otherBranchId', 'transfers.sameBranch');
  const from = mode === 'request' ? other.id : ctx.branchId;
  const to = mode === 'request' ? ctx.branchId : other.id;
  const lines = readRequestLines(ctx, params);
  const notes = v.text(params, 'notes', 'Notes', { max: 500 });
  const needApproval = mode === 'request' && settings.get(ctx.db, 'transfers.requireApproval', null);
  const id = newId();
  const now = nowIso();
  ctx.db.transaction(() => {
    const docNo = nextNo(ctx, 'TRF');
    ctx.db.prepare(`INSERT INTO transfers (id, doc_no, from_branch_id, to_branch_id, status, notes, requested_by, requested_at, decided_by, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, docNo, from, to, needApproval ? 'requested' : 'approved', notes, ctx.userId, now,
      needApproval ? null : ctx.userId, needApproval ? null : now, now, now);
    for (const l of lines) {
      ctx.db.prepare(`INSERT INTO transfer_lines (id, transfer_id, from_branch_id, to_branch_id, line_type, product_id, qty, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'request', ?, ?, ?, ?)`).run(l.lineId = newId(), id, from, to, l.product.id, l.qty, now, now);
    }
    audit.write(ctx.db, ctx.actor, { module: 'transfers', action: mode === 'request' ? 'request' : 'create', recordType: 'transfer', recordId: id, summary: `Transfer ${docNo} ${mode === 'request' ? 'requested from' : 'to'} ${other.name}: ${lines.length} item(s)`, new: { from, to, lines: lines.length } });
  })();
  // "Send now": dispatch straight away (FEFO, or the batches chosen on the lines).
  if (mode === 'send' && v.bool(params, 'dispatch')) {
    const picks = lines.filter((l) => l.batchId).map((l) => ({ requestLineId: l.lineId, batchId: l.batchId, qty: l.qty }));
    return dispatch(ctx, { id, picks: picks.length === lines.length ? picks : undefined });
  }
  return shape(ctx, loadTransfer(ctx, id), true);
}

function decide(ctx, params) {
  const t = loadTransfer(ctx, v.id(params, 'id'));
  assertSide(ctx, t, 'from');
  assertStatus(t, ['requested']);
  const approve = v.bool(params, 'approve');
  const reason = v.text(params, 'reason', 'Reason', { required: !approve, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE transfers SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ? WHERE id = ?').run(approve ? 'approved' : 'rejected', ctx.userId, now, reason, now, t.id);
    audit.write(ctx.db, ctx.actor, { module: 'transfers', action: approve ? 'approve' : 'reject', recordType: 'transfer', recordId: t.id, branchId: t.from_branch_id, summary: `Transfer ${t.doc_no} ${approve ? 'approved' : 'rejected'}`, reason });
  })();
  return shape(ctx, loadTransfer(ctx, t.id), true);
}

// Stock leaves the sending branch by batch. picks: [{ requestLineId, batchId, qty }]; without picks FEFO is used.
function dispatch(ctx, params) {
  const t = loadTransfer(ctx, v.id(params, 'id'));
  assertSide(ctx, t, 'from');
  if (t.status === 'requested') fail('WRONG_STATUS', 'transfers.approvalRequired');
  assertStatus(t, ['approved']);
  const db = ctx.db;
  const requests = db.prepare("SELECT * FROM transfer_lines WHERE transfer_id = ? AND line_type = 'request' AND deleted_at IS NULL").all(t.id);
  const today = stock.today();
  let picks = [];
  if (Array.isArray(params.picks) && params.picks.length) {
    picks = params.picks.map((p, i) => {
      const req = requests.find((r) => r.id === p.requestLineId);
      if (!req) invalid(`picks.${i}.requestLineId`, 'error.invalid', { field: 'Line' });
      const batch = stock.loadBatch(db, v.id(p, 'batchId', 'Batch'));
      if (batch.product_id !== req.product_id) invalid(`picks.${i}.batchId`, 'stock.batchWrongProduct');
      if (batch.expiry_date < today) invalid(`picks.${i}.batchId`, 'stock.expiredBatch', { batch: batch.batch_no, product: stock.productLabel(batch), date: batch.expiry_date });
      if (stock.isQuarantined(db, t.from_branch_id, batch.id)) invalid(`picks.${i}.batchId`, 'stock.quarantined', { batch: batch.batch_no, product: stock.productLabel(batch) });
      return { req, batch, qty: v.int(p, 'qty', 'Quantity', { required: true, min: 1 }) };
    });
    for (const req of requests) {
      const sum = picks.filter((p) => p.req.id === req.id).reduce((a, p) => a + p.qty, 0);
      if (sum > req.qty) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(req.product_id);
        invalid('picks', 'transfers.dispatchTooMuch', { product: label(prod) });
      }
    }
  } else {
    for (const req of requests) {
      const r = stock.fefo(db, t.from_branch_id, req.product_id, req.qty, { onDate: today });
      if (r.short > 0) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(req.product_id);
        fail('NOT_ENOUGH_STOCK', 'stock.notEnoughProduct', { available: stock.qtyText(r.available, prod), product: label(prod), wanted: stock.qtyText(req.qty, prod) });
      }
      for (const pk of r.picks) picks.push({ req, batch: pk.batch, qty: pk.qty });
    }
  }
  if (!picks.length) invalid('picks', 'error.noLines');
  const now = nowIso();
  db.transaction(() => {
    for (const p of picks) {
      db.prepare(`INSERT INTO transfer_lines (id, transfer_id, from_branch_id, to_branch_id, line_type, parent_id, product_id, batch_id, qty, cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'dispatch', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), t.id, t.from_branch_id, t.to_branch_id, p.req.id, p.batch.product_id, p.batch.id, p.qty, p.batch.cost, now, now);
      stock.post(db, ctx.actor, { branchId: t.from_branch_id, batch: p.batch, qty: -p.qty, movement: 'TRANSFER_OUT', refType: 'transfer', refId: t.id, refNo: t.doc_no, reason: `To ${t.to_name}` });
    }
    db.prepare("UPDATE transfers SET status = 'dispatched', dispatched_by = ?, dispatched_at = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, now, t.id);
    audit.write(db, ctx.actor, { module: 'transfers', action: 'dispatch', recordType: 'transfer', recordId: t.id, branchId: t.from_branch_id, summary: `Transfer ${t.doc_no} dispatched to ${t.to_name}: ${picks.length} batch line(s)` });
  })();
  return shape(ctx, loadTransfer(ctx, t.id), true);
}

// Stock arrives at the receiving branch, batch by batch. lines: [{ lineId, receivedQty, reason }]; missing lines = all received.
function receive(ctx, params) {
  const t = loadTransfer(ctx, v.id(params, 'id'));
  assertSide(ctx, t, 'to');
  assertStatus(t, ['dispatched']);
  const db = ctx.db;
  const lines = db.prepare(`SELECT l.*, p.brand_name, p.strength FROM transfer_lines l JOIN products p ON p.id = l.product_id
    WHERE l.transfer_id = ? AND l.line_type = 'dispatch' AND l.deleted_at IS NULL`).all(t.id);
  const given = new Map((Array.isArray(params.lines) ? params.lines : []).map((x) => [x.lineId, x]));
  const now = nowIso();
  let discrepancy = false;
  const plan = lines.map((l) => {
    const g = given.get(l.id) || {};
    const received = g.receivedQty === undefined || g.receivedQty === null || g.receivedQty === '' ? l.qty : v.int(g, 'receivedQty', `Received quantity of ${label(l)}`, { min: 0 });
    if (received > l.qty) invalid(`lines.${l.id}`, 'transfers.receiveMore');
    const reason = v.text(g, 'reason', 'Reason', { max: 300 });
    if (received < l.qty) {
      discrepancy = true;
      if (!reason) invalid(`lines.${l.id}`, 'transfers.discrepancyReason', { product: label(l) });
    }
    return { l, received, reason };
  });
  db.transaction(() => {
    for (const p of plan) {
      db.prepare('UPDATE transfer_lines SET received_qty = ?, discrepancy_reason = ?, updated_at = ? WHERE id = ?').run(p.received, p.received < p.l.qty ? p.reason : null, now, p.l.id);
      if (p.received > 0) stock.post(db, ctx.actor, { branchId: t.to_branch_id, batchId: p.l.batch_id, qty: p.received, movement: 'TRANSFER_IN', refType: 'transfer', refId: t.id, refNo: t.doc_no, reason: `From ${t.from_name}` });
    }
    db.prepare("UPDATE transfers SET status = 'received', received_by = ?, received_at = ?, has_discrepancy = ?, discrepancy_open = ?, updated_at = ? WHERE id = ?")
      .run(ctx.userId, now, discrepancy ? 1 : 0, discrepancy ? 1 : 0, now, t.id);
    audit.write(db, ctx.actor, { module: 'transfers', action: 'receive', recordType: 'transfer', recordId: t.id, branchId: t.to_branch_id, summary: `Transfer ${t.doc_no} received from ${t.from_name}${discrepancy ? ' with differences' : ''}` });
  })();
  return shape(ctx, loadTransfer(ctx, t.id), true);
}

// The sending branch decides about missing stock: it came back (stock returns to the sender) or it is lost.
function resolve(ctx, params) {
  const t = loadTransfer(ctx, v.id(params, 'id'));
  assertSide(ctx, t, 'from');
  if (!t.discrepancy_open) fail('WRONG_STATUS', 'transfers.nothingToResolve');
  const resolution = v.oneOf(params, 'resolution', 'Decision', ['returned', 'written_off']);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const db = ctx.db;
  const open = db.prepare("SELECT * FROM transfer_lines WHERE transfer_id = ? AND line_type = 'dispatch' AND received_qty < qty AND resolution IS NULL AND deleted_at IS NULL").all(t.id)
    .filter((l) => !params.lineId || l.id === params.lineId);
  if (!open.length) fail('WRONG_STATUS', 'transfers.nothingToResolve');
  const now = nowIso();
  db.transaction(() => {
    for (const l of open) {
      if (resolution === 'returned') {
        stock.post(db, ctx.actor, { branchId: t.from_branch_id, batchId: l.batch_id, qty: l.qty - l.received_qty, movement: 'TRANSFER_BACK', refType: 'transfer', refId: t.id, refNo: t.doc_no, reason });
      }
      // Written off: the stock already left the sender and never arrived, so no stock row is needed; the loss stays on the transfer.
      db.prepare('UPDATE transfer_lines SET resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?').run(resolution, ctx.userId, now, now, l.id);
    }
    const still = db.prepare("SELECT COUNT(*) AS n FROM transfer_lines WHERE transfer_id = ? AND line_type = 'dispatch' AND received_qty < qty AND resolution IS NULL").get(t.id).n;
    db.prepare('UPDATE transfers SET discrepancy_open = ?, updated_at = ? WHERE id = ?').run(still ? 1 : 0, now, t.id);
    audit.write(db, ctx.actor, { module: 'transfers', action: `resolve_${resolution}`, recordType: 'transfer', recordId: t.id, branchId: t.from_branch_id, summary: `Transfer ${t.doc_no} difference ${resolution === 'returned' ? 'returned to stock' : 'written off as lost'}`, reason });
  })();
  return shape(ctx, loadTransfer(ctx, t.id), true);
}

function cancel(ctx, params) {
  const t = loadTransfer(ctx, v.id(params, 'id'));
  assertStatus(t, ['requested', 'approved']);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE transfers SET status = 'cancelled', decision_reason = ?, updated_at = ? WHERE id = ?").run(reason, now, t.id);
    audit.write(ctx.db, ctx.actor, { module: 'transfers', action: 'cancel', recordType: 'transfer', recordId: t.id, summary: `Transfer ${t.doc_no} cancelled`, reason });
  })();
  return shape(ctx, loadTransfer(ctx, t.id), true);
}

function list(ctx, params) {
  const where = [];
  const args = { branch: ctx.branchId };
  const dir = params.direction || 'all';
  if (params.branchId === 'all' && seesAllBranches(ctx)) { /* everything */ } else if (dir === 'in') where.push('t.to_branch_id = @branch');
  else if (dir === 'out') where.push('t.from_branch_id = @branch');
  else where.push('(t.from_branch_id = @branch OR t.to_branch_id = @branch)');
  if (params.status === 'open') where.push("t.status IN ('requested', 'approved', 'dispatched')");
  else if (params.status === 'discrepancy') where.push('t.discrepancy_open = 1');
  else if (params.status) { where.push('t.status = @status'); args.status = params.status; }
  if (params.search) { where.push('t.doc_no LIKE @q'); args.q = `%${params.search}%`; }
  const pg = paging(params);
  const from = 'FROM transfers t JOIN branches bf ON bf.id = t.from_branch_id JOIN branches bt ON bt.id = t.to_branch_id';
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n ${from} ${sql}`).get(args).n;
  const rows = ctx.db.prepare(`SELECT t.*, bf.name AS from_name, bt.name AS to_name ${from} ${sql} ORDER BY t.created_at DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  return { rows: rows.map((t) => shape(ctx, t, false)), total, page: pg.page, pageSize: pg.pageSize };
}

function register(define) {
  define('transfers.list', { perm: 'transfers.view' }, list);
  define('transfers.get', { perm: 'transfers.view' }, (ctx, params) => shape(ctx, loadTransfer(ctx, v.id(params, 'id')), true));
  define('transfers.create', { perm: 'transfers.create' }, create);
  define('transfers.decide', { perm: 'transfers.approve' }, decide);
  define('transfers.dispatch', { perm: 'transfers.dispatch' }, dispatch);
  define('transfers.receive', { perm: 'transfers.receive' }, receive);
  define('transfers.resolve', { perm: 'transfers.approve' }, resolve);
  define('transfers.cancel', { perm: 'transfers.create' }, cancel);
}

module.exports = { register };

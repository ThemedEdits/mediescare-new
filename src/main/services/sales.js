'use strict';
// Bills after the counter: history with filters, one bill, cancel (void), returns and refunds, receipts and reprints,
// medicine labels, the controlled drug register and prescriptions.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const receipt = require('../core/receipt');
const { nextNo, canSeeCost, paging, like } = require('../core/docs');
const settings = require('./settings');
const customers = require('./customers');
const { shiftForRefund } = require('./shifts');
const { useApproval, consumeApproval } = require('./pos');
const { label } = require('./products');
const { seesAllBranches } = require('./guards');

function loadSale(ctx, id) {
  const s = ctx.db.prepare(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS cashier_name, b.name AS branch_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id JOIN branches b ON b.id = s.branch_id WHERE s.id = ?`).get(id || '');
  if (!s) fail('NOT_FOUND', 'error.notFound', { thing: 'bill' });
  if (s.branch_id !== ctx.branchId && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
  return s;
}

function saleLines(db, saleId) {
  return db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, p.rx_required, p.controlled, b.batch_no, b.expiry_date,
      COALESCE((SELECT SUM(r.qty) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS returned_qty,
      COALESCE((SELECT SUM(r.amount) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS returned_amount,
      COALESCE((SELECT SUM(r.cost) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS returned_cost
    FROM sale_lines l JOIN products p ON p.id = l.product_id JOIN batches b ON b.id = l.batch_id WHERE l.sale_id = ? ORDER BY l.line_no`).all(saleId);
}

function detail(ctx, s) {
  const c = canSeeCost(ctx);
  const db = ctx.db;
  const lines = saleLines(db, s.id);
  const payments = db.prepare("SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY at").all(s.id);
  const returns = db.prepare('SELECT r.*, u.full_name FROM sale_returns r LEFT JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.returned_at').all(s.id);
  const rx = s.prescription_id ? db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(s.prescription_id) : null;
  const received = db.prepare(`SELECT COALESCE(SUM(a.amount), 0) AS x FROM receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.sale_id = ? AND r.status = 'posted'`).get(s.id).x;
  const returnedToAccount = returns.reduce((a, r) => a + r.account_amount, 0);
  return {
    id: s.id, docNo: s.doc_no, branchId: s.branch_id, branchName: s.branch_name, status: s.status, soldAt: s.sold_at, saleDate: s.sale_date,
    customerId: s.customer_id, customerName: s.customer_name, customerPhone: s.customer_phone, cashierId: s.cashier_id, cashierName: s.cashier_name,
    gross: s.gross, lineDiscount: s.line_discount, billDiscount: s.bill_discount, discount: s.line_discount + s.bill_discount, tax: s.tax, total: s.total,
    paid: s.paid, tendered: s.tendered, change: s.change_given, credit: s.credit_amount, due: s.status === 'completed' ? Math.max(s.credit_amount - received - returnedToAccount, 0) : 0,
    returnedTotal: returns.reduce((a, r) => a + r.total, 0), cost: c ? s.cost : null, profit: c ? s.total - s.cost : null,
    notes: s.notes, voidReason: s.void_reason, voidedAt: s.voided_at, approvedBy: s.approved_by,
    lines: lines.map((l) => ({
      id: l.id, lineNo: l.line_no, productId: l.product_id, productLabel: label(l), batchId: l.batch_id, batchNo: l.batch_no, expiryDate: l.expiry_date,
      unitName: l.unit_name, unitFactor: l.unit_factor, qty: l.qty, qtyText: stock.qtyText(l.qty, l), unitPrice: l.unit_price, listPrice: l.list_price,
      gross: l.gross, discount: l.discount + l.bill_discount, net: l.net, tax: l.tax, cost: c ? l.cost : null, instructions: l.instructions,
      returnedQty: l.returned_qty, returnableQty: l.qty - l.returned_qty, returnableText: stock.qtyText(l.qty - l.returned_qty, l),
      packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit, rxRequired: l.rx_required === 1, controlled: l.controlled === 1,
    })),
    payments: payments.map((p) => ({ kind: p.kind, method: p.method, amount: p.amount, reference: p.reference, at: p.at })),
    returns: returns.map((r) => ({ id: r.id, docNo: r.doc_no, total: r.total, refundMethod: r.refund_method, refundAmount: r.refund_amount, accountAmount: r.account_amount, reason: r.reason, at: r.returned_at, by: r.full_name })),
    prescription: rx ? rxShape(rx) : null,
  };
}

function rxShape(r) {
  return {
    id: r.id, saleId: r.sale_id, patientName: r.patient_name, patientCnic: r.patient_cnic, patientPhone: r.patient_phone, patientAddress: r.patient_address,
    doctorName: r.doctor_name, doctorPmdc: r.doctor_pmdc, doctorClinic: r.doctor_clinic, rxNumber: r.rx_number, rxDate: r.rx_date, hasPhoto: !!r.photo, notes: r.notes, createdAt: r.created_at,
  };
}

function list(ctx, params) {
  const where = [];
  const args = {};
  if (params.branchId === 'all' && seesAllBranches(ctx)) { /* all branches */ } else if (params.branchId && seesAllBranches(ctx)) { where.push('s.branch_id = @branch'); args.branch = params.branchId; } else { where.push('s.branch_id = @branch'); args.branch = ctx.branchId; }
  if (params.from) { where.push('s.sale_date >= @from'); args.from = params.from; }
  if (params.to) { where.push('s.sale_date <= @to'); args.to = params.to; }
  if (params.cashierId) { where.push('s.cashier_id = @cashier'); args.cashier = params.cashierId; }
  if (params.customerId) { where.push('s.customer_id = @customer'); args.customer = params.customerId; }
  if (params.shiftId) { where.push('s.shift_id = @shift'); args.shift = params.shiftId; }
  if (params.status) { where.push('s.status = @status'); args.status = params.status; }
  if (params.method === 'credit') where.push('s.credit_amount > 0');
  else if (params.method) { where.push("EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id = s.id AND p.kind = 'sale' AND p.method = @method)"); args.method = params.method; }
  if (params.productId) { where.push('EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = s.id AND l.product_id = @product)'); args.product = params.productId; }
  if (params.batchId) { where.push('EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = s.id AND l.batch_id = @batch)'); args.batch = params.batchId; }
  if (params.minTotal) { where.push('s.total >= @min'); args.min = v.money(params, 'minTotal', 'Minimum amount'); }
  if (params.maxTotal) { where.push('s.total <= @max'); args.max = v.money(params, 'maxTotal', 'Maximum amount'); }
  if (params.returned === 'yes') where.push('EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id)');
  if (params.returned === 'no') where.push('NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id)');
  if (params.search) { where.push("(s.doc_no LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
  const sql = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id JOIN branches b ON b.id = s.branch_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const pg = paging(params);
  const sortMap = { soldAt: 's.sold_at', docNo: 's.doc_no', total: 's.total', customerName: 'c.name', cashierName: 'u.full_name' };
  const sort = sortMap[params.sort] || 's.sold_at';
  const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
  const totals = ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total END), 0) AS total,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.line_discount + s.bill_discount END), 0) AS discount,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.credit_amount END), 0) AS credit,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.cost END), 0) AS cost,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN (SELECT COALESCE(SUM(total), 0) FROM sale_returns r WHERE r.sale_id = s.id) END), 0) AS returned ${sql}`).get(args);
  const rows = ctx.db.prepare(`SELECT s.*, c.name AS customer_name, u.full_name AS cashier_name, b.name AS branch_name,
      (SELECT COALESCE(SUM(total), 0) FROM sale_returns r WHERE r.sale_id = s.id) AS returned,
      (SELECT group_concat(DISTINCT method) FROM sale_payments p WHERE p.sale_id = s.id AND p.kind = 'sale') AS methods,
      (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id = s.id) AS line_count
    ${sql} ORDER BY ${sort} ${dir}, s.id ${dir} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  const c = canSeeCost(ctx);
  return {
    rows: rows.map((s) => ({
      id: s.id, docNo: s.doc_no, soldAt: s.sold_at, saleDate: s.sale_date, branchName: s.branch_name, customerName: s.customer_name, cashierName: s.cashier_name,
      status: s.status, lines: s.line_count, total: s.total, discount: s.line_discount + s.bill_discount, paid: s.paid, credit: s.credit_amount, returned: s.returned,
      methods: [...(s.methods ? s.methods.split(',') : []), ...(s.credit_amount ? ['credit'] : [])], profit: c ? s.total - s.cost : null,
    })),
    total: totals.n, page: pg.page, pageSize: pg.pageSize,
    totals: { bills: totals.n, total: totals.total, discount: totals.discount, credit: totals.credit, returned: totals.returned, profit: c ? totals.total - totals.cost : null },
  };
}

// Cancel a whole bill: stock back, money back (from this drawer), customer account reversed.
function voidSale(ctx, params) {
  const s = loadSale(ctx, v.id(params, 'id'));
  if (s.status !== 'completed') fail('WRONG_STATUS', 'pos.voidedBill');
  // Cancelling a bill needs the right, or a manager's approval (at the counter or from the Approvals screen).
  const approval = ctx.can('sales.void') ? null : useApproval(ctx, params.approvalToken);
  if (!ctx.can('sales.void') && !(approval && approval.can('sales.void'))) fail('NEEDS_APPROVAL', 'pos.voidNeedsApproval', { doc: s.doc_no }, { needs: ['sales.void'] });
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const db = ctx.db;
  const hasReturns = db.prepare('SELECT 1 FROM sale_returns WHERE sale_id = ? LIMIT 1').get(s.id);
  const hasReceipts = db.prepare(`SELECT 1 FROM receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.sale_id = ? AND r.status = 'posted' LIMIT 1`).get(s.id);
  if (hasReturns || hasReceipts) fail('IN_USE', 'pos.voidHasReturns');
  const shift = shiftForRefund(ctx);
  const now = nowIso();
  db.transaction(() => {
    for (const l of saleLines(db, s.id)) {
      stock.post(db, ctx.actor, { branchId: s.branch_id, batchId: l.batch_id, qty: l.qty, movement: 'SALE_RETURN', refType: 'sale_void', refId: s.id, refNo: s.doc_no, reason: `Bill cancelled: ${reason}` });
    }
    for (const p of db.prepare("SELECT * FROM sale_payments WHERE sale_id = ? AND kind = 'sale'").all(s.id)) {
      db.prepare(`INSERT INTO sale_payments (id, branch_id, sale_id, shift_id, kind, method, amount, reference, user_id, at, updated_at) VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`)
        .run(newId(), s.branch_id, s.id, shift ? shift.id : null, p.method, p.amount, `Cancelled ${s.doc_no}`, ctx.userId, now, now);
    }
    if (s.customer_id && s.credit_amount) {
      customers.ledgerEntry(db, ctx, { customerId: s.customer_id, branchId: s.branch_id, type: 'void', refType: 'sale', refId: s.id, refNo: s.doc_no, credit: s.credit_amount, description: `Bill cancelled: ${reason}` });
    }
    db.prepare("UPDATE sales SET status = 'voided', voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, s.id);
    audit.write(db, ctx.actor, { module: 'pos', action: 'void', recordType: 'sale', recordId: s.id, summary: `Bill ${s.doc_no} cancelled (${money.format(s.total, { symbol: '' })})${approval ? `, approved by ${approval.name}` : ''}`, reason });
    consumeApproval(ctx, approval, s.doc_no);
  })();
  return detail(ctx, loadSale(ctx, s.id));
}

// Return part or all of a bill. Each line says what happens to the stock that came back.
function returnSale(ctx, params) {
  const db = ctx.db;
  const s = loadSale(ctx, v.id(params, 'saleId', 'Bill'));
  if (s.status !== 'completed') fail('WRONG_STATUS', 'pos.voidedBill');
  const approval = useApproval(ctx, params.approvalToken);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const lines = saleLines(db, s.id);
  const raw = Array.isArray(params.lines) ? params.lines.filter((l) => Number(l.qty) > 0) : [];
  if (!raw.length) fail('VALIDATION', 'error.noLines');
  const items = raw.map((r, i) => {
    const l = lines.find((x) => x.id === r.lineId);
    if (!l) invalid(`lines.${i}.lineId`, 'error.invalid', { field: 'Line' });
    const qty = v.int(r, 'qty', `Quantity of ${label(l)}`, { required: true, min: 1 });
    if (qty > l.qty - l.returned_qty) invalid(`lines.${i}.qty`, 'pos.returnTooMuch', { qty: stock.qtyText(l.qty - l.returned_qty, l), product: label(l) });
    const condition = v.oneOf(r, 'condition', 'Condition', ['restock', 'damaged', 'expired', 'quarantine'], { required: false, fallback: 'restock' });
    // Money and cost back in proportion; worked out cumulatively so a full return gives back exactly the line.
    const amount = money.mulRound(l.net, l.returned_qty + qty, l.qty) - money.mulRound(l.net, l.returned_qty, l.qty);
    const cost = money.mulRound(l.cost, l.returned_qty + qty, l.qty) - money.mulRound(l.cost, l.returned_qty, l.qty);
    return { l, qty, condition, amount, cost };
  });
  const total = money.sum(items.map((x) => x.amount));
  const limit = settings.get(db, 'pos.returnApprovalValue', ctx.branchId) * 100;
  if (limit > 0 && total > limit && !ctx.can('sales.void') && !(approval && approval.can('sales.void'))) {
    fail('NEEDS_APPROVAL', 'pos.returnNeedsApproval', { amount: money.format(total, { symbol: '' }) }, { needs: ['sales.void'] });
  }
  // What the customer still owes on this bill is reduced first; the rest is paid back.
  const d = detail(ctx, s);
  let method = v.oneOf(params, 'refundMethod', 'Refund by', ['cash', 'card', 'easypaisa', 'jazzcash', 'bank', 'account'], { required: false, fallback: 'cash' });
  if (method === 'account' && !s.customer_id) invalid('refundMethod', 'pos.refundAccountNoCustomer');
  const accountAmount = method === 'account' ? total : Math.min(total, d.due);
  const refundAmount = total - accountAmount;
  if (!refundAmount && method !== 'account') method = 'account';
  const shift = refundAmount > 0 ? shiftForRefund(ctx) : null;
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    const docNo = nextNo(ctx, 'SRN');
    db.prepare(`INSERT INTO sale_returns (id, branch_id, doc_no, sale_id, customer_id, shift_id, total, refund_method, refund_amount, account_amount, cost, reason, approved_by, user_id, returned_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, s.branch_id, docNo, s.id, s.customer_id, shift ? shift.id : null, total, method, refundAmount, accountAmount,
      money.sum(items.map((x) => x.cost)), reason, approval ? approval.userId : null, ctx.userId, now, now, now);
    for (const x of items) {
      db.prepare(`INSERT INTO sale_return_lines (id, return_id, branch_id, sale_line_id, product_id, batch_id, qty, amount, cost, condition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newId(), id, s.branch_id, x.l.id, x.l.product_id, x.l.batch_id, x.qty, x.amount, x.cost, x.condition, now, now);
      stock.post(db, ctx.actor, { branchId: s.branch_id, batchId: x.l.batch_id, qty: x.qty, movement: 'SALE_RETURN', refType: 'sale_return', refId: id, refNo: docNo, reason });
      // Stock that cannot be sold again comes back and goes straight out, so the history shows both steps.
      if (x.condition === 'damaged' || x.condition === 'expired') {
        stock.post(db, ctx.actor, { branchId: s.branch_id, batchId: x.l.batch_id, qty: -x.qty, movement: x.condition === 'damaged' ? 'DAMAGED' : 'EXPIRED', refType: 'sale_return', refId: id, refNo: docNo, reason: `Customer return: ${reason}` });
      }
      if (x.condition === 'quarantine') {
        const cur = db.prepare('SELECT id FROM batch_status WHERE branch_id = ? AND batch_id = ?').get(s.branch_id, x.l.batch_id);
        if (cur) db.prepare('UPDATE batch_status SET quarantined = 1, reason = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(`Customer return ${docNo}`, ctx.userId, now, cur.id);
        else db.prepare('INSERT INTO batch_status (id, branch_id, batch_id, quarantined, reason, updated_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)').run(newId(), s.branch_id, x.l.batch_id, `Customer return ${docNo}`, ctx.userId, now, now);
      }
    }
    if (refundAmount > 0) {
      db.prepare(`INSERT INTO sale_payments (id, branch_id, sale_id, return_id, shift_id, kind, method, amount, reference, user_id, at, updated_at) VALUES (?, ?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`)
        .run(newId(), s.branch_id, s.id, id, shift ? shift.id : null, method, refundAmount, docNo, ctx.userId, now, now);
    }
    if (s.customer_id && accountAmount > 0) {
      customers.ledgerEntry(db, ctx, { customerId: s.customer_id, branchId: s.branch_id, type: 'return', refType: 'sale_return', refId: id, refNo: docNo, credit: accountAmount, description: `Return on ${s.doc_no}` });
    }
    audit.write(db, ctx.actor, { module: 'pos', action: 'return', recordType: 'sale', recordId: s.id, summary: `Return ${docNo} on bill ${s.doc_no}: ${money.format(total, { symbol: '' })}${refundAmount ? `, refunded ${money.format(refundAmount, { symbol: '' })} by ${method}` : ''}${accountAmount ? `, ${money.format(accountAmount, { symbol: '' })} off the account` : ''}`,
      new: { total, refundAmount, accountAmount, items: items.map((x) => ({ line: x.l.line_no, qty: x.qty, condition: x.condition })) }, reason });
    consumeApproval(ctx, approval, docNo);
  })();
  return { returnId: id, total, refundAmount, accountAmount, refundMethod: method, sale: detail(ctx, loadSale(ctx, s.id)) };
}

// ---- receipts ------------------------------------------------------------------------------------------------------

function deviceSettings(app) {
  try { return JSON.parse(app.localGet('device_settings') || '{}'); } catch (_) { return {}; }
}

function receiptHtml(ctx, s, { format, reprint }) {
  const branch = ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(s.branch_id);
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get();
  const vals = settings.readAll(ctx.db, s.branch_id).values;
  return receipt.render({
    org, branch, sale: detail(ctx, s), format: format || deviceSettings(ctx.app).paper || vals['receipt.paper'],
    showBatch: vals['receipt.showBatch'], footer: vals['receipt.footer'], taxLabel: vals['tax.label'], reprint,
    currency: { symbol: vals['currency.symbol'], decimals: vals['currency.decimals'] }, dateFormat: vals['date.format'],
  });
}

async function printReceipt(ctx, params) {
  const s = loadSale(ctx, v.id(params, 'id'));
  const reprint = v.bool(params, 'reprint');
  if (reprint && !ctx.can('sales.reprint')) fail('FORBIDDEN', 'error.noPermission');
  const html = receiptHtml(ctx, s, { format: params.format, reprint });
  const dev = deviceSettings(ctx.app);
  if (reprint) ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'pos', action: 'reprint', recordType: 'sale', recordId: s.id, summary: `Receipt ${s.doc_no} printed again` }))();
  if (params.output === 'pdf') {
    const pdf = await ctx.app.renderPdf(html, { pageSize: receipt.pageSize(params.format || dev.paper || settings.get(ctx.db, 'receipt.paper', s.branch_id)) });
    return ctx.app.saveFile({ defaultName: `${s.doc_no}.pdf`, content: pdf, ext: 'pdf', label: 'PDF' });
  }
  return ctx.app.printHtml(html, { title: s.doc_no, silent: !!dev.silentPrint, deviceName: dev.printerName || undefined });
}

function medicineLabels(ctx, params) {
  const s = loadSale(ctx, v.id(params, 'id'));
  const d = detail(ctx, s);
  const wanted = new Map((Array.isArray(params.lines) ? params.lines : []).map((l) => [l.lineId, l]));
  const branch = ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(s.branch_id);
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get();
  const items = d.lines.filter((l) => wanted.has(l.id)).map((l) => ({ ...l, instructions: v.text(wanted.get(l.id), 'instructions', 'Dosage instructions', { max: 200 }) || l.instructions || '' }));
  if (!items.length) fail('VALIDATION', 'error.noLines');
  const patient = d.prescription ? d.prescription.patientName : d.customerName;
  return ctx.app.printHtml(receipt.medicineLabels({ org, branch, sale: d, items, patient }), { title: `${s.doc_no} labels` });
}

// ---- controlled drug register and prescriptions -------------------------------------------------------------------

// Every movement of controlled drugs at this branch with a running balance per drug, built from the stock ledger
// (so it can never disagree with stock) and the prescription details of each sale.
function controlledRegister(ctx, params) {
  const from = v.date(params, 'from', 'From date');
  const to = v.date(params, 'to', 'To date');
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const toIso = to ? new Date(`${stock.addDays(to, 1)}T00:00:00`).toISOString() : null;
  const args = { branch: ctx.branchId, product: params.productId || null, fromIso, toIso };
  const productSql = params.productId ? 'AND l.product_id = @product' : '';
  const openings = new Map(ctx.db.prepare(`SELECT l.product_id, SUM(l.qty) AS q FROM stock_ledger l JOIN products p ON p.id = l.product_id
    WHERE l.branch_id = @branch AND p.controlled = 1 ${productSql} ${fromIso ? 'AND l.at < @fromIso' : 'AND 0'} GROUP BY l.product_id`).all(args).map((r) => [r.product_id, r.q]));
  const rows = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, p.drap_reg_no, b.batch_no, u.username,
      s.doc_no AS sale_no, rx.patient_name, rx.patient_cnic, rx.doctor_name, rx.doctor_pmdc, rx.rx_number, rx.rx_date
    FROM stock_ledger l JOIN products p ON p.id = l.product_id JOIN batches b ON b.id = l.batch_id LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN sales s ON s.id = l.ref_id AND l.ref_type IN ('sale', 'sale_void')
    LEFT JOIN sale_returns sr ON sr.id = l.ref_id AND l.ref_type = 'sale_return'
    LEFT JOIN prescriptions rx ON rx.id = COALESCE(s.prescription_id, (SELECT prescription_id FROM sales WHERE id = sr.sale_id))
    WHERE l.branch_id = @branch AND p.controlled = 1 ${productSql} ${fromIso ? 'AND l.at >= @fromIso' : ''} ${toIso ? 'AND l.at < @toIso' : ''}
    ORDER BY p.brand_name, l.at, l.id`).all(args);
  const running = new Map();
  const out = rows.map((r) => {
    const bal = (running.has(r.product_id) ? running.get(r.product_id) : openings.get(r.product_id) || 0) + r.qty;
    running.set(r.product_id, bal);
    return {
      id: r.id, at: r.at, productId: r.product_id, productLabel: label(r), drapRegNo: r.drap_reg_no, batchNo: r.batch_no, movement: r.movement, refNo: r.ref_no,
      qtyIn: r.qty > 0 ? r.qty : 0, qtyOut: r.qty < 0 ? -r.qty : 0, qtyText: stock.qtyText(r.qty, r), balance: bal, balanceText: stock.qtyText(bal, r),
      patientName: r.patient_name, patientCnic: r.patient_cnic, doctorName: r.doctor_name, doctorPmdc: r.doctor_pmdc, rxNumber: r.rx_number, rxDate: r.rx_date, username: r.username,
    };
  });
  return { rows: out, from, to };
}

function register(define) {
  define('sales.list', { perm: 'sales.view' }, list);
  define('sales.get', { perm: ['sales.view', 'pos.view'] }, (ctx, params) => detail(ctx, loadSale(ctx, v.id(params, 'id'))));
  define('sales.findByNo', { perm: ['sales.view', 'pos.view'] }, (ctx, params) => {
    const s = ctx.db.prepare('SELECT id FROM sales WHERE doc_no = ? COLLATE NOCASE').get(String(params.docNo || '').trim());
    if (!s) fail('NOT_FOUND', 'error.notFound', { thing: 'bill' });
    return detail(ctx, loadSale(ctx, s.id));
  });
  define('sales.void', { perm: ['sales.void', 'pos.create'] }, voidSale);
  define('sales.return', { perm: 'sales.return' }, returnSale);
  define('sales.receiptHtml', { perm: ['sales.view', 'pos.view'] }, (ctx, params) => ({ html: receiptHtml(ctx, loadSale(ctx, v.id(params, 'id')), { format: params.format, reprint: v.bool(params, 'reprint') }) }));
  define('sales.print', { perm: ['pos.create', 'sales.reprint'] }, printReceipt);
  define('sales.labels', { perm: ['pos.create', 'sales.view'] }, medicineLabels);
  define('controlled.register', { perm: 'controlled.view' }, controlledRegister);
  define('prescriptions.list', { perm: 'controlled.view' }, (ctx, params) => {
    const where = ['rx.branch_id = @branch'];
    const args = { branch: ctx.branchId };
    if (params.search) { where.push("(rx.patient_name LIKE @q ESCAPE '\\' OR rx.doctor_name LIKE @q ESCAPE '\\' OR rx.rx_number LIKE @q ESCAPE '\\' OR rx.patient_cnic LIKE @q ESCAPE '\\' OR s.doc_no LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
    if (params.from) { where.push('rx.created_at >= @from'); args.from = new Date(`${params.from}T00:00:00`).toISOString(); }
    if (params.to) { where.push('rx.created_at < @to'); args.to = new Date(`${stock.addDays(params.to, 1)}T00:00:00`).toISOString(); }
    const pg = paging(params);
    const sql = `FROM prescriptions rx LEFT JOIN sales s ON s.id = rx.sale_id WHERE ${where.join(' AND ')}`;
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(args).n;
    const rows = ctx.db.prepare(`SELECT rx.*, s.doc_no AS sale_no ${sql} ORDER BY rx.created_at DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
    return { rows: rows.map((r) => ({ ...rxShape(r), saleNo: r.sale_no })), total, page: pg.page, pageSize: pg.pageSize };
  });
  define('prescriptions.photo', { perm: 'controlled.view' }, (ctx, params) => {
    const r = ctx.db.prepare('SELECT photo, branch_id FROM prescriptions WHERE id = ?').get(params.id || '');
    if (!r || (r.branch_id !== ctx.branchId && !seesAllBranches(ctx))) fail('NOT_FOUND', 'error.notFound', { thing: 'prescription' });
    return { photo: r.photo };
  });
}

module.exports = { register, detail, loadSale, deviceSettings };

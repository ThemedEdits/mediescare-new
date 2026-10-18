'use strict';
// Customers and patients: profile, price level (default discount), credit limit, account at this branch,
// payments received later (allocated to the oldest unpaid bills) and the statement.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const money = require('../core/money');
const stock = require('../core/stock');
const { nextNo, paging, like } = require('../core/docs');
const { openShiftOnDevice } = require('./shifts');

const FIELDS = ['code', 'name', 'phone', 'cnic', 'address', 'credit_limit', 'discount_bp', 'notes'];

function balanceOf(db, customerId, branchId) {
  return db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS b FROM customer_ledger WHERE customer_id = ? AND branch_id = ?').get(customerId, branchId).b;
}

// Credit bills not yet paid, oldest first. Due = credit part - later receipts - returns credited to the account.
function openBills(db, customerId, branchId) {
  return db.prepare(`SELECT s.id, s.doc_no, s.sale_date, s.total, s.credit_amount,
      COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.sale_id = s.id AND r.status = 'posted'), 0) AS received,
      COALESCE((SELECT SUM(account_amount) FROM sale_returns WHERE sale_id = s.id), 0) AS returned
    FROM sales s WHERE s.customer_id = ? AND s.branch_id = ? AND s.status = 'completed' AND s.credit_amount > 0
    ORDER BY s.sold_at`).all(customerId, branchId)
    .map((b) => ({ id: b.id, docNo: b.doc_no, date: b.sale_date, total: b.total, credit: b.credit_amount, received: b.received, returned: b.returned, due: Math.max(b.credit_amount - b.received - b.returned, 0) }))
    .filter((b) => b.due > 0);
}

function shape(ctx, c) {
  return {
    id: c.id, code: c.code, name: c.name, phone: c.phone, cnic: c.cnic, address: c.address, creditLimit: c.credit_limit, discountBp: c.discount_bp,
    notes: c.notes, active: c.active === 1, balance: balanceOf(ctx.db, c.id, ctx.branchId), updatedAt: c.updated_at,
  };
}

function load(db, id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id || '');
  if (!c) fail('NOT_FOUND', 'error.notFound', { thing: 'customer' });
  return c;
}

function readForm(ctx, params, existing) {
  const f = {
    code: v.text(params, 'code', 'Customer code', { max: 20 }),
    name: v.text(params, 'name', 'Name', { required: true, max: 120 }),
    phone: v.text(params, 'phone', 'Phone', { max: 40 }),
    cnic: v.text(params, 'cnic', 'CNIC', { max: 20 }),
    address: v.text(params, 'address', 'Address', { max: 300 }),
    credit_limit: existing && !ctx.can('sales.credit') ? existing.credit_limit : v.money(params, 'creditLimit', 'Credit limit', { fallback: 0 }),
    discount_bp: existing && !ctx.can('discount.above_limit') ? existing.discount_bp : v.percent(params, 'discount', 'Usual discount'),
    notes: v.text(params, 'notes', 'Notes', { max: 1000 }),
  };
  if (f.cnic && !/^\d{5}-?\d{7}-?\d$/.test(f.cnic)) invalid('cnic', 'error.invalid', { field: 'CNIC (13 digits, for example 35202-1234567-1)' });
  if (f.code) {
    f.code = f.code.toUpperCase();
    if (ctx.db.prepare('SELECT 1 FROM customers WHERE code = ? COLLATE NOCASE AND id <> ?').get(f.code, existing ? existing.id : '')) invalid('code', 'error.duplicate', { thing: 'customer', field: 'code' });
  }
  if (f.phone && ctx.db.prepare('SELECT 1 FROM customers WHERE phone = ? AND id <> ? AND active = 1').get(f.phone, existing ? existing.id : '')) invalid('phone', 'error.duplicate', { thing: 'customer', field: 'phone number' });
  return f;
}

// Adds a customer (inside the caller's transaction). An opening balance is what they owed this branch before Mediescare.
function insertCustomer(ctx, f, opening) {
  const id = newId();
  const now = nowIso();
  f.code = f.code || nextNo(ctx, 'CUS');
  ctx.db.prepare(`INSERT INTO customers (id, ${FIELDS.join(', ')}, active, created_by, created_at, updated_at) VALUES (@id, ${FIELDS.map((k) => '@' + k).join(', ')}, 1, @by, @now, @now)`)
    .run({ ...f, id, by: ctx.userId, now });
  if (opening > 0) ledgerEntry(ctx.db, ctx, { customerId: id, branchId: ctx.branchId, type: 'opening', refType: 'customer', refId: id, debit: opening, description: 'Opening balance' });
  audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'create', recordType: 'customer', recordId: id, branchId: null, summary: `Customer ${f.name} (${f.code}) added`, new: { ...f, opening_balance: opening } });
  return id;
}

function ledgerEntry(db, ctx, { customerId, branchId, date, type, refType, refId, refNo, debit = 0, credit = 0, description }) {
  if (!debit && !credit) return;
  const at = nowIso();
  db.prepare(`INSERT INTO customer_ledger (id, branch_id, customer_id, entry_date, entry_type, ref_type, ref_id, ref_no, debit, credit, description, user_id, at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), branchId, customerId, date || stock.today(), type, refType || null, refId || null, refNo || null, debit, credit, description || null, ctx.userId || null, at, at);
}

function receive(ctx, params) {
  const c = load(ctx.db, v.id(params, 'customerId', 'Customer'));
  const amount = v.money(params, 'amount', 'Amount', { required: true, min: 1 });
  const method = v.oneOf(params, 'method', 'Paid by', ['cash', 'card', 'easypaisa', 'jazzcash', 'bank']);
  const reference = v.text(params, 'reference', 'Reference', { required: method !== 'cash', max: 80 });
  const date = v.date(params, 'receivedDate', 'Date') || stock.today();
  if (date !== stock.today() && !ctx.can('payments.edit_date')) fail('FORBIDDEN', 'error.noPermission');
  const owed = balanceOf(ctx.db, c.id, ctx.branchId);
  if (amount > owed) invalid('amount', 'pos.receiptTooMuch', { owed: money.format(owed, { symbol: '' }), amount: money.format(amount, { symbol: '' }) });
  const shift = openShiftOnDevice(ctx);
  const id = newId();
  const now = nowIso();
  ctx.db.transaction(() => {
    const docNo = nextNo(ctx, 'RCP');
    const shiftId = shift && shift.user_id === ctx.userId ? shift.id : null;
    ctx.db.prepare(`INSERT INTO customer_receipts (id, branch_id, doc_no, customer_id, shift_id, received_date, method, reference, amount, notes, status, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`).run(id, ctx.branchId, docNo, c.id, shiftId, date, method, reference, amount, v.text(params, 'notes', 'Notes', { max: 300 }), ctx.userId, now, now);
    ctx.db.prepare(`INSERT INTO sale_payments (id, branch_id, receipt_id, shift_id, kind, method, amount, reference, user_id, at, updated_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?, ?, ?)`)
      .run(newId(), ctx.branchId, id, shiftId, method, amount, reference, ctx.userId, now, now);
    let left = amount;
    for (const b of openBills(ctx.db, c.id, ctx.branchId)) {
      if (left <= 0) break;
      const take = Math.min(left, b.due);
      ctx.db.prepare('INSERT INTO receipt_allocations (id, branch_id, receipt_id, sale_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), ctx.branchId, id, b.id, take, now, now);
      left -= take;
    }
    ledgerEntry(ctx.db, ctx, { customerId: c.id, branchId: ctx.branchId, date, type: 'receipt', refType: 'customer_receipt', refId: id, refNo: docNo, credit: amount, description: `Payment received (${method})` });
    audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'receive_payment', recordType: 'customer_receipt', recordId: id, summary: `${docNo}: ${money.format(amount, { symbol: '' })} received from ${c.name}`, new: { amount, method, reference, date } });
  })();
  return receiptShape(ctx, ctx.db.prepare('SELECT r.*, c.name AS customer_name FROM customer_receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?').get(id));
}

function receiptShape(ctx, r) {
  return {
    id: r.id, docNo: r.doc_no, customerId: r.customer_id, customerName: r.customer_name, date: r.received_date, method: r.method, reference: r.reference,
    amount: r.amount, notes: r.notes, status: r.status, cancelReason: r.cancel_reason, createdAt: r.created_at,
    allocations: ctx.db.prepare('SELECT a.sale_id, a.amount, s.doc_no FROM receipt_allocations a JOIN sales s ON s.id = a.sale_id WHERE a.receipt_id = ?').all(r.id).map((a) => ({ saleId: a.sale_id, docNo: a.doc_no, amount: a.amount })),
  };
}

function register(define) {
  define('customers.search', { perm: ['pos.view', 'customers.view'] }, (ctx, params) => {
    const q = String(params.q || '').trim();
    const rows = q
      ? ctx.db.prepare(`SELECT * FROM customers WHERE active = 1 AND (name LIKE @q ESCAPE '\\' OR phone LIKE @q ESCAPE '\\' OR code LIKE @q ESCAPE '\\' OR cnic LIKE @q ESCAPE '\\')
          ORDER BY CASE WHEN phone = @exact THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT 20`).all({ q: like(q), exact: q })
      : ctx.db.prepare('SELECT * FROM customers WHERE active = 1 ORDER BY updated_at DESC LIMIT 20').all();
    return rows.map((c) => shape(ctx, c));
  });

  define('customers.list', { perm: 'customers.view' }, (ctx, params) => {
    const where = [];
    const args = { branch: ctx.branchId };
    if (params.status !== 'all') where.push(params.status === 'inactive' ? 'c.active = 0' : 'c.active = 1');
    if (params.search) { where.push("(c.name LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\' OR c.code LIKE @q ESCAPE '\\' OR c.cnic LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
    if (params.owing) where.push('balance > 0');
    const pg = paging(params);
    const select = `SELECT c.*, COALESCE((SELECT SUM(debit - credit) FROM customer_ledger l WHERE l.customer_id = c.id AND l.branch_id = @branch), 0) AS balance FROM customers c`;
    const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sortMap = { name: 'c.name COLLATE NOCASE', balance: 'balance', updatedAt: 'c.updated_at' };
    const sort = sortMap[params.sort] || 'c.name COLLATE NOCASE';
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${select} ${sql})`).get(args).n;
    const rows = ctx.db.prepare(`${select} ${sql} ORDER BY ${sort} ${params.dir === 'desc' ? 'DESC' : 'ASC'} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
    return { rows: rows.map((c) => shape(ctx, c)), total, page: pg.page, pageSize: pg.pageSize };
  });

  define('customers.get', { perm: ['customers.view', 'pos.view'] }, (ctx, params) => {
    const c = load(ctx.db, v.id(params, 'id'));
    return { ...shape(ctx, c), openBills: openBills(ctx.db, c.id, ctx.branchId) };
  });

  define('customers.create', { perm: 'customers.create' }, (ctx, params) => {
    const f = readForm(ctx, params, null);
    if (!ctx.can('sales.credit')) f.credit_limit = 0;
    if (!ctx.can('discount.above_limit')) f.discount_bp = 0;
    let id;
    ctx.db.transaction(() => { id = insertCustomer(ctx, f, 0); })();
    return shape(ctx, load(ctx.db, id));
  });

  define('customers.update', { perm: 'customers.edit' }, (ctx, params) => {
    const c = load(ctx.db, v.id(params, 'id'));
    const f = readForm(ctx, params, c);
    f.code = f.code || c.code;
    const change = audit.diff(Object.fromEntries(FIELDS.map((k) => [k, c[k]])), f);
    if (change.changed) {
      ctx.db.transaction(() => {
        ctx.db.prepare(`UPDATE customers SET ${FIELDS.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`).run({ ...f, id: c.id, now: nowIso() });
        audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'update', recordType: 'customer', recordId: c.id, branchId: null, summary: `Customer ${f.name} changed`, old: change.old, new: change.new });
      })();
    }
    return shape(ctx, load(ctx.db, c.id));
  });

  define('customers.setActive', { perm: 'customers.delete' }, (ctx, params) => {
    const c = load(ctx.db, v.id(params, 'id'));
    const active = v.bool(params, 'active');
    const reason = v.text(params, 'reason', 'Reason', { required: !active, max: 300 });
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE customers SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), c.id);
      audit.write(ctx.db, ctx.actor, { module: 'customers', action: active ? 'activate' : 'deactivate', recordType: 'customer', recordId: c.id, branchId: null, summary: `Customer ${c.name} ${active ? 're-activated' : 'deactivated'}`, reason });
    })();
    return shape(ctx, load(ctx.db, c.id));
  });

  define('customers.statement', { perm: 'customers.view' }, (ctx, params) => {
    const c = load(ctx.db, v.id(params, 'id'));
    const from = v.date(params, 'from', 'From date');
    const to = v.date(params, 'to', 'To date');
    const args = { c: c.id, b: ctx.branchId, from, to };
    const opening = from ? ctx.db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS x FROM customer_ledger WHERE customer_id = @c AND branch_id = @b AND entry_date < @from').get(args).x : 0;
    const rows = ctx.db.prepare(`SELECT * FROM customer_ledger WHERE customer_id = @c AND branch_id = @b ${from ? 'AND entry_date >= @from' : ''} ${to ? 'AND entry_date <= @to' : ''} ORDER BY entry_date, at, id`).all(args);
    let running = opening;
    const entries = rows.map((r) => {
      running += r.debit - r.credit;
      return { id: r.id, date: r.entry_date, type: r.entry_type, refType: r.ref_type, refId: r.ref_id, refNo: r.ref_no, description: r.description, debit: r.debit, credit: r.credit, balance: running };
    });
    return { customer: shape(ctx, c), opening, entries, closing: running, from, to };
  });

  define('customers.receive', { perm: ['pos.create', 'customers.edit'] }, receive);

  define('customers.receipts', { perm: ['customers.view', 'pos.view'] }, (ctx, params) => {
    const rows = ctx.db.prepare(`SELECT r.*, c.name AS customer_name FROM customer_receipts r JOIN customers c ON c.id = r.customer_id
      WHERE r.branch_id = @branch ${params.customerId ? 'AND r.customer_id = @customer' : ''} ORDER BY r.created_at DESC LIMIT 500`)
      .all({ branch: ctx.branchId, customer: params.customerId || null });
    return rows.map((r) => receiptShape(ctx, r));
  });

  // "Receive payment later" with a date that can be corrected afterwards, with a reason that is logged.
  define('customers.changeReceiptDate', { perm: 'payments.edit_date' }, (ctx, params) => {
    const r = ctx.db.prepare('SELECT * FROM customer_receipts WHERE id = ? AND branch_id = ?').get(v.id(params, 'id'), ctx.branchId);
    if (!r) fail('NOT_FOUND', 'error.notFound', { thing: 'payment' });
    const date = v.date(params, 'receivedDate', 'Date', { required: true });
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE customer_receipts SET received_date = ?, updated_at = ? WHERE id = ?').run(date, nowIso(), r.id);
      audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'change_receipt_date', recordType: 'customer_receipt', recordId: r.id, summary: `Date of ${r.doc_no} changed`, old: { date: r.received_date }, new: { date }, reason });
    })();
    return { changed: true };
  });

  define('customers.cancelReceipt', { perm: 'sales.void' }, (ctx, params) => {
    const r = ctx.db.prepare('SELECT * FROM customer_receipts WHERE id = ? AND branch_id = ?').get(v.id(params, 'id'), ctx.branchId);
    if (!r) fail('NOT_FOUND', 'error.notFound', { thing: 'payment' });
    if (r.status !== 'posted') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'payment', status: r.status });
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    const shift = openShiftOnDevice(ctx);
    const now = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE customer_receipts SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, r.id);
      ctx.db.prepare(`INSERT INTO sale_payments (id, branch_id, receipt_id, shift_id, kind, method, amount, reference, user_id, at, updated_at) VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`)
        .run(newId(), r.branch_id, r.id, shift && shift.user_id === ctx.userId ? shift.id : null, r.method, r.amount, `Cancelled ${r.doc_no}`, ctx.userId, now, now);
      ledgerEntry(ctx.db, ctx, { customerId: r.customer_id, branchId: r.branch_id, type: 'receipt_cancel', refType: 'customer_receipt', refId: r.id, refNo: r.doc_no, debit: r.amount, description: `Payment cancelled: ${reason}` });
      audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'cancel_receipt', recordType: 'customer_receipt', recordId: r.id, summary: `Payment ${r.doc_no} cancelled`, reason });
    })();
    return { cancelled: true };
  });
}

module.exports = { register, balanceOf, openBills, ledgerEntry, load, shape, readForm, insertCustomer };

'use strict';
// The financial journal: every money event of a branch in one list, worked out from the documents themselves
// (never stored totals), so it always agrees with sales, purchases, payments, expenses and the stock ledger.
//   moneyIn / moneyOut : money that actually came in or went out (any method)
//   receivable         : change in what customers owe us (+ more owed)
//   payable            : change in what we owe suppliers (+ more owed)
//   stockValue         : change in stock value at cost (write-offs and adjustments; needs cost.view)
const { fail } = require('../core/errors');
const v = require('../core/validate');
const { canSeeCost, paging } = require('../core/docs');
const { seesAllBranches } = require('./guards');
const stock = require('../core/stock');

const KINDS = {
  sale: 'Sale', sale_void: 'Bill cancelled', sale_return: 'Customer return', receipt: 'Payment received', receipt_cancel: 'Payment received cancelled',
  purchase: 'Purchase (goods received)', purchase_cancel: 'Purchase cancelled', purchase_return: 'Return to supplier', purchase_return_cancel: 'Return to supplier cancelled',
  supplier_payment: 'Payment to supplier', supplier_payment_cancel: 'Payment to supplier cancelled', expense: 'Expense', expense_cancel: 'Expense cancelled',
  cash_in: 'Cash put in the drawer', cash_out: 'Cash taken from the drawer', petty_topup: 'Petty cash top-up', petty_withdraw: 'Petty cash taken back',
  write_off: 'Stock written off', adjustment: 'Stock adjustment',
};

const LOCAL_DAY = (col) => `date(${col}, 'localtime')`;

// The UTC moment a local calendar day starts.
function localStart(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

// Each part returns the same columns. @b is the branch filter placeholder, replaced per part.
function parts() {
  return {
    sale: `SELECT s.sale_date AS day, s.sold_at AS at, 'sale' AS kind, s.doc_no, COALESCE(c.name, 'Walk-in') AS party,
        (SELECT group_concat(DISTINCT method) FROM sale_payments p WHERE p.sale_id = s.id AND p.kind = 'sale') AS method,
        s.total AS amount, s.line_discount + s.bill_discount AS discount, s.tax, s.paid AS money_in, 0 AS money_out, s.credit_amount AS receivable, 0 AS payable,
        NULL AS stock_value, s.cost AS cost, NULL AS notes, 'sale' AS ref_type, s.id AS ref_id, s.branch_id
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE @b(s) AND @dd(s.sale_date)`,
    sale_void: `SELECT ${LOCAL_DAY('s.voided_at')}, s.voided_at, 'sale_void', s.doc_no, COALESCE(c.name, 'Walk-in'),
        (SELECT group_concat(DISTINCT method) FROM sale_payments p WHERE p.sale_id = s.id AND p.kind = 'refund' AND p.return_id IS NULL),
        -s.total, -(s.line_discount + s.bill_discount), -s.tax, 0,
        (SELECT COALESCE(SUM(amount), 0) FROM sale_payments p WHERE p.sale_id = s.id AND p.kind = 'refund' AND p.return_id IS NULL), -s.credit_amount, 0,
        NULL, -s.cost, s.void_reason, 'sale', s.id, s.branch_id
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status = 'voided' AND @b(s) AND @dt(s.voided_at)`,
    sale_return: `SELECT ${LOCAL_DAY('r.returned_at')}, r.returned_at, 'sale_return', r.doc_no, COALESCE(c.name, 'Walk-in'), r.refund_method,
        -r.total, 0, 0, 0, r.refund_amount, -r.account_amount, 0, NULL, -r.cost, r.reason, 'sale', r.sale_id, r.branch_id
      FROM sale_returns r LEFT JOIN customers c ON c.id = r.customer_id WHERE @b(r) AND @dt(r.returned_at)`,
    receipt: `SELECT r.received_date, r.created_at, 'receipt', r.doc_no, c.name, r.method, r.amount, 0, 0, r.amount, 0, -r.amount, 0, NULL, NULL, r.notes, 'customer', r.customer_id, r.branch_id
      FROM customer_receipts r JOIN customers c ON c.id = r.customer_id WHERE @b(r) AND @dd(r.received_date)`,
    receipt_cancel: `SELECT ${LOCAL_DAY('r.cancelled_at')}, r.cancelled_at, 'receipt_cancel', r.doc_no, c.name, r.method, -r.amount, 0, 0, 0, r.amount, r.amount, 0, NULL, NULL, r.cancel_reason, 'customer', r.customer_id, r.branch_id
      FROM customer_receipts r JOIN customers c ON c.id = r.customer_id WHERE r.status = 'cancelled' AND @b(r) AND @dt(r.cancelled_at)`,
    purchase: `SELECT g.received_date, g.posted_at, 'purchase', g.doc_no, s.name, NULL, g.total, g.line_discount + g.doc_discount, g.tax, 0, 0, 0, g.total, NULL, NULL,
        g.supplier_invoice_no, 'grn', g.id, g.branch_id
      FROM grns g JOIN suppliers s ON s.id = g.supplier_id WHERE g.posted_at IS NOT NULL AND @b(g) AND @dd(g.received_date)`,
    purchase_cancel: `SELECT ${LOCAL_DAY('g.cancelled_at')}, g.cancelled_at, 'purchase_cancel', g.doc_no, s.name, NULL, -g.total, 0, -g.tax, 0, 0, 0, -g.total, NULL, NULL, g.cancel_reason, 'grn', g.id, g.branch_id
      FROM grns g JOIN suppliers s ON s.id = g.supplier_id WHERE g.posted_at IS NOT NULL AND g.status = 'cancelled' AND @b(g) AND @dt(g.cancelled_at)`,
    purchase_return: `SELECT r.return_date, r.created_at, 'purchase_return', r.doc_no, s.name, NULL, -r.total, 0, 0, 0, 0, 0, -r.total, NULL, NULL, r.notes, 'purchase_return', r.id, r.branch_id
      FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id WHERE @b(r) AND @dd(r.return_date)`,
    purchase_return_cancel: `SELECT ${LOCAL_DAY('r.cancelled_at')}, r.cancelled_at, 'purchase_return_cancel', r.doc_no, s.name, NULL, r.total, 0, 0, 0, 0, 0, r.total, NULL, NULL, r.cancel_reason, 'purchase_return', r.id, r.branch_id
      FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id WHERE r.status = 'cancelled' AND @b(r) AND @dt(r.cancelled_at)`,
    supplier_payment: `SELECT p.paid_date, p.created_at, 'supplier_payment', p.doc_no, s.name, p.method, p.amount, 0, 0, 0, p.amount, 0, -p.amount, NULL, NULL, p.reference, 'payment', p.id, p.branch_id
      FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE @b(p) AND @dd(p.paid_date)`,
    supplier_payment_cancel: `SELECT ${LOCAL_DAY('p.cancelled_at')}, p.cancelled_at, 'supplier_payment_cancel', p.doc_no, s.name, p.method, -p.amount, 0, 0, p.amount, 0, 0, p.amount, NULL, NULL, p.cancel_reason, 'payment', p.id, p.branch_id
      FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'cancelled' AND @b(p) AND @dt(p.cancelled_at)`,
    expense: `SELECT e.expense_date, COALESCE(e.decided_at, e.created_at), 'expense', e.doc_no, COALESCE(e.paid_to, c.name), e.method, e.amount, 0, 0, 0, e.amount, 0, 0, NULL, NULL,
        c.name || ': ' || e.description, 'expense', e.id, e.branch_id
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.decided_at IS NOT NULL AND e.status IN ('posted', 'cancelled') AND @b(e) AND @dd(e.expense_date)`,
    expense_cancel: `SELECT ${LOCAL_DAY('e.cancelled_at')}, e.cancelled_at, 'expense_cancel', e.doc_no, COALESCE(e.paid_to, c.name), e.method, -e.amount, 0, 0, e.amount, 0, 0, 0, NULL, NULL,
        e.cancel_reason, 'expense', e.id, e.branch_id
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.status = 'cancelled' AND e.decided_at IS NOT NULL AND @b(e) AND @dt(e.cancelled_at)`,
    cash_in: `SELECT ${LOCAL_DAY('m.at')}, m.at, 'cash_in', sh.doc_no, u.full_name, 'cash', m.amount, 0, 0, m.amount, 0, 0, 0, NULL, NULL, m.reason, 'shift', m.shift_id, m.branch_id
      FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id LEFT JOIN users u ON u.id = m.user_id WHERE m.kind = 'in' AND m.ref_type IS NULL AND @b(m) AND @dt(m.at)`,
    cash_out: `SELECT ${LOCAL_DAY('m.at')}, m.at, 'cash_out', sh.doc_no, u.full_name, 'cash', m.amount, 0, 0, 0, m.amount, 0, 0, NULL, NULL, m.reason, 'shift', m.shift_id, m.branch_id
      FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id LEFT JOIN users u ON u.id = m.user_id WHERE m.kind = 'out' AND m.ref_type IS NULL AND @b(m) AND @dt(m.at)`,
    // Moving cash between the drawer and the petty cash box is not money in or out of the business.
    petty_topup: `SELECT p.entry_date, p.at, 'petty_topup', NULL, u.full_name, NULL, p.amount, 0, 0, 0, 0, 0, 0, NULL, NULL, p.reason, 'petty', NULL, p.branch_id
      FROM petty_cash p LEFT JOIN users u ON u.id = p.user_id WHERE p.kind = 'topup' AND @b(p) AND @dd(p.entry_date)`,
    petty_withdraw: `SELECT p.entry_date, p.at, 'petty_withdraw', NULL, u.full_name, NULL, -p.amount, 0, 0, 0, 0, 0, 0, NULL, NULL, p.reason, 'petty', NULL, p.branch_id
      FROM petty_cash p LEFT JOIN users u ON u.id = p.user_id WHERE p.kind = 'withdraw' AND @b(p) AND @dd(p.entry_date)`,
    write_off: `SELECT ${LOCAL_DAY('MIN(l.at)')}, MIN(l.at), 'write_off', l.ref_no, NULL, NULL, SUM(l.value), 0, 0, 0, 0, 0, 0, SUM(l.value), NULL, group_concat(DISTINCT l.movement),
        l.ref_type, l.ref_id, l.branch_id
      FROM stock_ledger l WHERE l.movement IN ('DAMAGED', 'LOST', 'EXPIRED') AND @b(l) AND @dt(l.at) GROUP BY l.branch_id, l.ref_type, l.ref_id, l.ref_no`,
    adjustment: `SELECT ${LOCAL_DAY('MIN(l.at)')}, MIN(l.at), 'adjustment', l.ref_no, NULL, NULL, SUM(l.value), 0, 0, 0, 0, 0, 0, SUM(l.value), NULL, group_concat(DISTINCT l.movement),
        l.ref_type, l.ref_id, l.branch_id
      FROM stock_ledger l WHERE l.movement IN ('ADJUST_IN', 'ADJUST_OUT', 'STOCKTAKE', 'OPENING') AND @b(l) AND @dt(l.at) GROUP BY l.branch_id, l.ref_type, l.ref_id, l.ref_no`,
  };
}

const COLS = 'day, at, kind, doc_no, party, method, amount, discount, tax, money_in, money_out, receivable, payable, stock_value, cost, notes, ref_type, ref_id, branch_id';

// Branch scope: this branch, or another / all branches for people who see every branch.
function scope(ctx, params) {
  if (params.branchId === 'all') {
    if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
    return null;
  }
  if (params.branchId && params.branchId !== ctx.branchId) {
    if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
    return String(params.branchId);
  }
  return ctx.branchId;
}

function unionSql(kinds, branch) {
  const all = parts();
  const chosen = kinds && kinds.length ? kinds.filter((k) => all[k]) : Object.keys(all);
  // Each part filters its own rows by branch and date so the indexes are used: @dd on a local calendar date column,
  // @dt on a UTC timestamp (compared with the UTC bounds of the local days).
  return chosen.map((k) => all[k].replace(/@b\((\w+)\)/g, (_, a) => (branch ? `${a}.branch_id = @branch` : '1 = 1'))
    .replace(/@dd\(([\w.]+)\)/g, '$1 BETWEEN @from AND @to').replace(/@dt\(([\w.]+)\)/g, '($1 >= @fromAt AND $1 < @toAt)')).join('\nUNION ALL\n');
}

function journal(ctx, params) {
  const from = v.date(params, 'from', 'From', { required: true });
  const to = v.date(params, 'to', 'To', { required: true });
  const branch = scope(ctx, params);
  const kinds = Array.isArray(params.kinds) ? params.kinds.map(String) : params.kind ? [String(params.kind)] : null;
  const cost = canSeeCost(ctx);
  // Stock values are cost figures; without cost.view those rows are left out entirely.
  const allowed = (kinds || Object.keys(KINDS)).filter((k) => cost || (k !== 'write_off' && k !== 'adjustment'));
  if (!allowed.length) return { rows: [], total: 0, page: 1, pageSize: 50, summary: [], totals: {} };
  const base = `WITH j(${COLS}) AS (${unionSql(allowed, branch)}) SELECT j.*, b.name AS branch_name FROM j JOIN branches b ON b.id = j.branch_id WHERE j.day >= @from AND j.day <= @to`;
  const args = { from, to, fromAt: localStart(from), toAt: localStart(stock.addDays(to, 1)), ...(branch ? { branch } : {}) };
  const qWhere = params.q ? " AND (j.doc_no LIKE @q OR j.party LIKE @q OR j.notes LIKE @q)" : '';
  if (params.q) args.q = `%${String(params.q)}%`;
  const methodWhere = params.method ? ' AND j.method LIKE @method' : '';
  if (params.method) args.method = `%${String(params.method)}%`;
  const sql = `${base}${qWhere}${methodWhere}`;
  const pg = paging(params, { def: 100, max: 1000 });
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(args).n;
  const rows = ctx.db.prepare(`${sql} ORDER BY j.at, j.doc_no LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  const summary = ctx.db.prepare(`SELECT kind, COUNT(*) AS n, SUM(amount) AS amount, SUM(discount) AS discount, SUM(tax) AS tax, SUM(money_in) AS money_in, SUM(money_out) AS money_out,
      SUM(receivable) AS receivable, SUM(payable) AS payable, SUM(stock_value) AS stock_value FROM (${sql}) GROUP BY kind`).all(args);
  const sum = (k) => summary.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    rows: rows.map((r) => ({
      day: r.day, at: r.at, kind: r.kind, kindLabel: KINDS[r.kind], docNo: r.doc_no, party: r.party, method: r.method, amount: r.amount, discount: r.discount, tax: r.tax,
      moneyIn: r.money_in, moneyOut: r.money_out, receivable: r.receivable, payable: r.payable, stockValue: cost ? r.stock_value : null, notes: r.notes,
      refType: r.ref_type, refId: r.ref_id, branchName: r.branch_name,
    })),
    total, page: pg.page, pageSize: pg.pageSize,
    summary: Object.keys(KINDS).map((k) => summary.find((s) => s.kind === k)).filter(Boolean).map((s) => ({
      kind: s.kind, kindLabel: KINDS[s.kind], count: s.n, amount: s.amount, discount: s.discount, tax: s.tax, moneyIn: s.money_in, moneyOut: s.money_out,
      receivable: s.receivable, payable: s.payable, stockValue: cost ? s.stock_value : null,
    })),
    totals: { moneyIn: sum('money_in'), moneyOut: sum('money_out'), net: sum('money_in') - sum('money_out'), receivable: sum('receivable'), payable: sum('payable'), stockValue: cost ? sum('stock_value') : null },
  };
}

function register(define) {
  define('finance.kinds', { perm: 'finance.view' }, () => Object.entries(KINDS).map(([key, label]) => ({ key, label })));
  define('finance.journal', { perm: 'finance.view' }, journal);
}

module.exports = { register, journal, scope, localStart, KINDS };

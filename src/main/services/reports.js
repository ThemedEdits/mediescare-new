'use strict';
// Reports. Every report is worked out from the documents and the stock ledger at the moment it is asked for, so it
// always agrees with the screens. One method (reports.run) returns { title, columns, rows, totals, notes } so the
// screen, print, PDF, Excel and CSV all show the same thing (export.run re-uses reports.run).
//   Cancelled (voided) bills are not counted. Returns count on the day they were taken, against the period of the return.
const { invalid, fail } = require('../core/errors');
const v = require('../core/validate');
const money = require('../core/money');
const stock = require('../core/stock');
const { canSeeCost } = require('../core/docs');
const settings = require('./settings');
const customers = require('./customers');
const { scope, localStart } = require('./finance');
const { label } = require('./products');
const { seesAllBranches } = require('./guards');

const DAY = (col) => `date(${col}, 'localtime')`;
const fmt = (x) => money.format(x || 0, { symbol: '' });
const pct = (part, whole) => (whole ? Math.round((part * 1000) / whole) / 10 : 0);

function filters(ctx, params, def) {
  const f = { branch: null, product: null, category: null, supplier: null, customer: null, user: null, method: null, from: null, to: null };
  if (def.filters.includes('dates')) {
    f.from = v.date(params, 'from', 'From', { required: true });
    f.to = v.date(params, 'to', 'To', { required: true });
    if (f.from > f.to) invalid('to', 'reports.badRange');
  }
  f.branch = scope(ctx, params);
  if (def.filters.includes('product') && params.productId) f.product = String(params.productId);
  if (def.filters.includes('category') && params.categoryId) f.category = String(params.categoryId);
  if (def.filters.includes('supplier') && params.supplierId) f.supplier = String(params.supplierId);
  if (def.filters.includes('customer') && params.customerId) f.customer = String(params.customerId);
  if (def.filters.includes('user') && params.userId) f.user = String(params.userId);
  if (def.filters.includes('method') && params.method) f.method = String(params.method);
  f.days = def.filters.includes('days') ? v.int(params, 'days', 'Days', { min: 0, max: 3650, fallback: 90 }) : null;
  f.today = stock.today();
  return f;
}

const B = (f, a) => (f.branch ? `${a}.branch_id = @branch` : '1 = 1');

// Conditions on completed bills of the period (alias s).
function salesWhere(f, { dates = true } = {}) {
  const w = ["s.status = 'completed'", B(f, 's')];
  if (dates) w.push('s.sale_date BETWEEN @from AND @to');
  if (f.customer) w.push('s.customer_id = @customer');
  if (f.user) w.push('s.cashier_id = @user');
  return w.join(' AND ');
}
// Conditions on returns of the period (alias r, original bill s).
function returnsWhere(f) {
  const w = [`${DAY('r.returned_at')} BETWEEN @from AND @to`, B(f, 'r')];
  if (f.customer) w.push('s.customer_id = @customer');
  if (f.user) w.push('s.cashier_id = @user');
  return w.join(' AND ');
}
function productWhere(f, a = 'p') {
  const w = [];
  if (f.product) w.push(`${a}.id = @product`);
  if (f.category) w.push(`${a}.category_id = @category`);
  return w.length ? ` AND ${w.join(' AND ')}` : '';
}

const col = (key, labelText, type = 'text', extra = {}) => ({ key, label: labelText, type, ...extra });

// ---- sales ---------------------------------------------------------------------------------------------------------

function salesByPeriod(ctx, f, monthly) {
  const db = ctx.db;
  const kS = monthly ? 'substr(s.sale_date, 1, 7)' : 's.sale_date';
  const kR = monthly ? `substr(${DAY('r.returned_at')}, 1, 7)` : DAY('r.returned_at');
  const sales = db.prepare(`SELECT ${kS} AS k, COUNT(*) AS bills, SUM(s.gross) AS gross, SUM(s.line_discount + s.bill_discount) AS discount, SUM(s.total) AS sales,
      SUM(s.tax) AS tax, SUM(s.credit_amount) AS credit, SUM(s.cost) AS cost FROM sales s WHERE ${salesWhere(f)} GROUP BY k`).all(f);
  const pays = db.prepare(`SELECT ${kS} AS k, p.method, SUM(p.amount) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.kind = 'sale' AND ${salesWhere(f)} GROUP BY k, p.method`).all(f);
  const rets = db.prepare(`SELECT ${kR} AS k, COUNT(*) AS n, SUM(r.total) AS total, SUM(r.cost) AS cost FROM sale_returns r JOIN sales s ON s.id = r.sale_id
      WHERE ${returnsWhere(f)} GROUP BY k`).all(f);
  const keys = [...new Set([...sales.map((x) => x.k), ...rets.map((x) => x.k)])].sort();
  const c = canSeeCost(ctx);
  const rows = keys.map((k) => {
    const s = sales.find((x) => x.k === k) || {};
    const r = rets.find((x) => x.k === k) || {};
    const m = (method) => pays.filter((p) => p.k === k && (Array.isArray(method) ? method.includes(p.method) : p.method === method)).reduce((a, p) => a + p.amount, 0);
    const net = (s.sales || 0) - (r.total || 0);
    const cost = (s.cost || 0) - (r.cost || 0);
    return {
      period: k, bills: s.bills || 0, gross: s.gross || 0, discount: s.discount || 0, sales: s.sales || 0, returns: r.total || 0, net, tax: s.tax || 0,
      cash: m('cash'), card: m('card'), wallet: m(['easypaisa', 'jazzcash']), bank: m('bank'), credit: s.credit || 0,
      cost: c ? cost : null, profit: c ? net - cost : null, margin: c ? pct(net - cost, net) : null,
      link: monthly ? null : { path: 'sales', params: { from: k, to: k } },
    };
  });
  const columns = [
    col('period', monthly ? 'Month' : 'Date', monthly ? 'text' : 'date'), col('bills', 'Bills', 'number', { total: true }), col('gross', 'Gross', 'money', { total: true }),
    col('discount', 'Discounts', 'money', { total: true }), col('sales', 'Sales', 'money', { total: true }), col('returns', 'Returns', 'money', { total: true }),
    col('net', 'Net sales', 'money', { total: true }), col('tax', 'Tax included', 'money', { total: true }), col('cash', 'Cash', 'money', { total: true }),
    col('card', 'Card', 'money', { total: true }), col('wallet', 'Easypaisa / JazzCash', 'money', { total: true }), col('bank', 'Bank', 'money', { total: true }),
    col('credit', 'On account', 'money', { total: true }),
    ...(c ? [col('cost', 'Cost of sales', 'money', { total: true }), col('profit', 'Gross profit', 'money', { total: true }), col('margin', 'Margin %', 'number')] : []),
  ];
  return { columns, rows, chart: { x: 'period', y: 'net', label: 'Net sales', type: monthly ? 'bar' : 'line' }, notes: ['Cancelled bills are not counted. Returns are taken off on the day they were made. Payments are what was paid at the counter; the rest is on account.'] };
}

function salesByProduct(ctx, f, byCategory) {
  const db = ctx.db;
  const key = byCategory ? "COALESCE(p.category_id, '-')" : 'p.id';
  const sold = db.prepare(`SELECT ${key} AS k, p.id AS pid, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, cat.name AS category,
      SUM(l.qty) AS qty, SUM(l.net) AS net, SUM(l.cost) AS cost, SUM(l.discount + l.bill_discount) AS discount, COUNT(DISTINCT s.id) AS bills
    FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN products p ON p.id = l.product_id LEFT JOIN lookups cat ON cat.id = p.category_id
    WHERE ${salesWhere(f)}${productWhere(f)} GROUP BY k`).all(f);
  const back = db.prepare(`SELECT ${key} AS k, p.id AS pid, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, cat.name AS category,
      SUM(rl.qty) AS qty, SUM(rl.amount) AS amount, SUM(rl.cost) AS cost
    FROM sale_return_lines rl JOIN sale_returns r ON r.id = rl.return_id JOIN sales s ON s.id = r.sale_id JOIN products p ON p.id = rl.product_id LEFT JOIN lookups cat ON cat.id = p.category_id
    WHERE ${returnsWhere(f)}${productWhere(f)} GROUP BY k`).all(f);
  const keys = [...new Set([...sold.map((x) => x.k), ...back.map((x) => x.k)])];
  const c = canSeeCost(ctx);
  const rows = keys.map((k) => {
    const s = sold.find((x) => x.k === k);
    const r = back.find((x) => x.k === k);
    const any = s || r;
    const net = (s ? s.net : 0) - (r ? r.amount : 0);
    const cost = (s ? s.cost : 0) - (r ? r.cost : 0);
    const out = {
      name: byCategory ? any.category || 'No category' : label(any), category: any.category || '', bills: s ? s.bills : 0,
      sales: s ? s.net : 0, discount: s ? s.discount : 0, returns: r ? r.amount : 0, net, cost: c ? cost : null, profit: c ? net - cost : null, margin: c ? pct(net - cost, net) : null,
    };
    if (!byCategory) {
      out.qty = (s ? s.qty : 0) - (r ? r.qty : 0);
      out.qtyText = stock.qtyText(out.qty, any);
      out.returnedQty = r ? r.qty : 0;
      out.link = { path: 'product', params: { id: any.pid } };
    }
    return out;
  }).sort((a, b) => b.net - a.net);
  const columns = [
    col('name', byCategory ? 'Category' : 'Product'), ...(byCategory ? [] : [col('category', 'Category'), col('qtyText', 'Net quantity sold'), col('qty', 'Net base units', 'number', { total: true })]),
    col('bills', 'Bills', 'number'), col('sales', 'Sales', 'money', { total: true }), col('discount', 'Discounts', 'money', { total: true }),
    col('returns', 'Returns', 'money', { total: true }), col('net', 'Net sales', 'money', { total: true }),
    ...(c ? [col('cost', 'Cost', 'money', { total: true }), col('profit', 'Gross profit', 'money', { total: true }), col('margin', 'Margin %', 'number')] : []),
  ];
  return { columns, rows, chart: { x: 'name', y: 'net', label: 'Net sales', type: 'hbar', top: 10 }, notes: ['Sales are after discounts. Returns are taken off on the day they were made.'] };
}

function salesByCashier(ctx, f) {
  const db = ctx.db;
  const sold = db.prepare(`SELECT s.cashier_id AS k, u.full_name, COUNT(*) AS bills, SUM(s.total) AS sales, SUM(s.line_discount + s.bill_discount) AS discount, SUM(s.credit_amount) AS credit
    FROM sales s JOIN users u ON u.id = s.cashier_id WHERE ${salesWhere(f)} GROUP BY k`).all(f);
  const back = db.prepare(`SELECT s.cashier_id AS k, u.full_name, COUNT(*) AS n, SUM(r.total) AS total FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = s.cashier_id
    WHERE ${returnsWhere(f)} GROUP BY k`).all(f);
  const voids = db.prepare(`SELECT s.cashier_id AS k, COUNT(*) AS n, SUM(s.total) AS total FROM sales s WHERE s.status = 'voided' AND ${B(f, 's')} AND ${DAY('s.voided_at')} BETWEEN @from AND @to
    ${f.user ? 'AND s.cashier_id = @user' : ''} GROUP BY k`).all(f);
  const keys = [...new Set([...sold.map((x) => x.k), ...back.map((x) => x.k), ...voids.map((x) => x.k)])];
  const rows = keys.map((k) => {
    const s = sold.find((x) => x.k === k) || {};
    const r = back.find((x) => x.k === k) || {};
    const vd = voids.find((x) => x.k === k) || {};
    return {
      name: s.full_name || r.full_name || db.prepare('SELECT full_name FROM users WHERE id = ?').get(k).full_name, bills: s.bills || 0, sales: s.sales || 0, discount: s.discount || 0,
      credit: s.credit || 0, returns: r.total || 0, net: (s.sales || 0) - (r.total || 0), average: s.bills ? Math.round(s.sales / s.bills) : 0, voids: vd.n || 0, voidTotal: vd.total || 0,
      link: { path: 'sales', params: { from: f.from, to: f.to, cashierId: k } },
    };
  }).sort((a, b) => b.net - a.net);
  return {
    columns: [col('name', 'Cashier'), col('bills', 'Bills', 'number', { total: true }), col('sales', 'Sales', 'money', { total: true }), col('discount', 'Discounts', 'money', { total: true }),
      col('credit', 'On account', 'money', { total: true }), col('returns', 'Returns on their bills', 'money', { total: true }), col('net', 'Net sales', 'money', { total: true }),
      col('average', 'Average bill', 'money'), col('voids', 'Bills cancelled', 'number', { total: true }), col('voidTotal', 'Cancelled value', 'money', { total: true })],
    rows, chart: { x: 'name', y: 'net', label: 'Net sales', type: 'hbar' }, notes: ['Returns are counted against the cashier who made the original bill.'],
  };
}

function salesByBranch(ctx, f) {
  const db = ctx.db;
  const all = seesAllBranches(ctx);
  const g = { ...f, branch: all ? null : ctx.branchId };
  const sold = db.prepare(`SELECT s.branch_id AS k, COUNT(*) AS bills, SUM(s.total) AS sales, SUM(s.line_discount + s.bill_discount) AS discount, SUM(s.cost) AS cost
    FROM sales s WHERE ${salesWhere(g)} GROUP BY k`).all(g);
  const back = db.prepare(`SELECT r.branch_id AS k, SUM(r.total) AS total, SUM(r.cost) AS cost FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE ${returnsWhere(g)} GROUP BY k`).all(g);
  const branches = db.prepare(`SELECT id, name, code FROM branches ${all ? '' : 'WHERE id = @b'} ORDER BY is_head_office DESC, name`).all({ b: ctx.branchId });
  const c = canSeeCost(ctx);
  const rows = branches.map((b) => {
    const s = sold.find((x) => x.k === b.id) || {};
    const r = back.find((x) => x.k === b.id) || {};
    const net = (s.sales || 0) - (r.total || 0);
    const cost = (s.cost || 0) - (r.cost || 0);
    return { name: b.name, bills: s.bills || 0, sales: s.sales || 0, discount: s.discount || 0, returns: r.total || 0, net, average: s.bills ? Math.round(s.sales / s.bills) : 0,
      profit: c ? net - cost : null, margin: c ? pct(net - cost, net) : null };
  });
  return {
    columns: [col('name', 'Branch'), col('bills', 'Bills', 'number', { total: true }), col('sales', 'Sales', 'money', { total: true }), col('discount', 'Discounts', 'money', { total: true }),
      col('returns', 'Returns', 'money', { total: true }), col('net', 'Net sales', 'money', { total: true }), col('average', 'Average bill', 'money'),
      ...(c ? [col('profit', 'Gross profit', 'money', { total: true }), col('margin', 'Margin %', 'number')] : [])],
    rows, chart: { x: 'name', y: 'net', label: 'Net sales', type: 'hbar' }, notes: all ? [] : ['Only your own branch is shown.'],
  };
}

const METHOD_LABELS = { cash: 'Cash', card: 'Card', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', bank: 'Bank transfer' };

function salesByMethod(ctx, f) {
  const rows = ctx.db.prepare(`SELECT p.method, p.kind, COUNT(*) AS n, SUM(p.amount) AS amount FROM sale_payments p
    WHERE ${B(f, 'p')} AND ${DAY('p.at')} BETWEEN @from AND @to ${f.user ? 'AND p.user_id = @user' : ''} GROUP BY p.method, p.kind`).all(f);
  const credit = ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.credit_amount), 0) AS amount FROM sales s WHERE ${salesWhere(f)} AND s.credit_amount > 0`).get(f);
  const out = Object.keys(METHOD_LABELS).map((m) => {
    const get = (k) => rows.filter((r) => r.method === m && r.kind === k).reduce((a, r) => a + r.amount, 0);
    return { name: METHOD_LABELS[m], sales: get('sale'), receipts: get('receipt'), refunds: get('refund'), net: get('sale') + get('receipt') - get('refund'),
      count: rows.filter((r) => r.method === m && r.kind === 'sale').reduce((a, r) => a + r.n, 0) };
  });
  out.push({ name: 'On account (credit)', sales: credit.amount, receipts: 0, refunds: 0, net: credit.amount, count: credit.n });
  return {
    columns: [col('name', 'Payment method'), col('count', 'Payments at bills', 'number', { total: true }), col('sales', 'Paid at the counter', 'money', { total: true }),
      col('receipts', 'Received on account', 'money', { total: true }), col('refunds', 'Refunds', 'money', { total: true }), col('net', 'Net', 'money', { total: true })],
    rows: out, chart: { x: 'name', y: 'net', label: 'Net', type: 'hbar' }, notes: ['Refunds include cancelled bills and returns paid back. "On account" is the part of bills not paid at the counter.'],
  };
}

function grossProfit(ctx, f) {
  if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
  const base = salesByPeriod(ctx, f, false);
  return {
    columns: [col('period', 'Date', 'date'), col('net', 'Net sales', 'money', { total: true }), col('cost', 'Cost of sales', 'money', { total: true }),
      col('profit', 'Gross profit', 'money', { total: true }), col('margin', 'Margin %', 'number')],
    rows: base.rows, chart: { x: 'period', y: 'profit', label: 'Gross profit', type: 'line' },
    notes: ['Cost is the purchase cost of the batch each unit came from (batch costing). Returned units give their cost back.'],
  };
}

function discounts(ctx, f) {
  const rows = ctx.db.prepare(`SELECT s.*, u.full_name AS cashier, c.name AS customer, a.full_name AS approver FROM sales s JOIN users u ON u.id = s.cashier_id
    LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users a ON a.id = s.approved_by
    WHERE ${salesWhere(f)} AND (s.line_discount + s.bill_discount) > 0 ORDER BY s.sold_at`).all(f);
  return {
    columns: [col('date', 'Date', 'date'), col('docNo', 'Bill'), col('cashier', 'Cashier'), col('customer', 'Customer'), col('gross', 'Before discount', 'money', { total: true }),
      col('lineDiscount', 'Item discounts', 'money', { total: true }), col('billDiscount', 'Bill discount', 'money', { total: true }), col('discount', 'Total discount', 'money', { total: true }),
      col('percent', 'Discount %', 'number'), col('approver', 'Approved by')],
    rows: rows.map((s) => ({ date: s.sale_date, docNo: s.doc_no, cashier: s.cashier, customer: s.customer || 'Walk-in', gross: s.gross, lineDiscount: s.line_discount, billDiscount: s.bill_discount,
      discount: s.line_discount + s.bill_discount, percent: pct(s.line_discount + s.bill_discount, s.gross), approver: s.approver || '', link: { path: 'sale', params: { id: s.id } } })),
    notes: ['A bill shows "Approved by" when a manager allowed a discount above the limit.'],
  };
}

function taxReport(ctx, f) {
  const sold = ctx.db.prepare(`SELECT l.tax_bp, COUNT(*) AS n, SUM(l.net) AS net, SUM(l.tax) AS tax FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE ${salesWhere(f)} GROUP BY l.tax_bp`).all(f);
  const back = ctx.db.prepare(`SELECT l.tax_bp, rl.amount FROM sale_return_lines rl JOIN sale_returns r ON r.id = rl.return_id JOIN sale_lines l ON l.id = rl.sale_line_id
    JOIN sales s ON s.id = r.sale_id WHERE ${returnsWhere(f)}`).all(f);
  const rates = [...new Set([...sold.map((x) => x.tax_bp), ...back.map((x) => x.tax_bp)])].sort((a, b) => a - b);
  const rows = rates.map((bp) => {
    const s = sold.find((x) => x.tax_bp === bp) || {};
    const rs = back.filter((x) => x.tax_bp === bp);
    const returns = money.sum(rs.map((x) => x.amount));
    const returnTax = money.sum(rs.map((x) => money.inclusiveTax(x.amount, bp)));
    return { rate: bp / 100, lines: s.n || 0, sales: s.net || 0, tax: s.tax || 0, returns, returnTax, netSales: (s.net || 0) - returns, netTax: (s.tax || 0) - returnTax };
  });
  return {
    columns: [col('rate', 'Tax rate %', 'number'), col('lines', 'Bill lines', 'number', { total: true }), col('sales', 'Sales (tax included)', 'money', { total: true }),
      col('tax', 'Tax in sales', 'money', { total: true }), col('returns', 'Returns', 'money', { total: true }), col('returnTax', 'Tax in returns', 'money', { total: true }),
      col('netSales', 'Net sales', 'money', { total: true }), col('netTax', 'Net tax', 'money', { total: true })],
    rows, notes: ['Prices include tax. Tax in a line = amount x rate / (100 + rate), rounded per line.'],
  };
}

function shiftsReport(ctx, f) {
  const { summary } = require('./shifts');
  const rows = ctx.db.prepare(`SELECT s.*, u.full_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE ${B(f, 's')} AND ${DAY('s.opened_at')} BETWEEN @from AND @to
    ${f.user ? 'AND s.user_id = @user' : ''} ORDER BY s.opened_at`).all(f);
  return {
    columns: [col('docNo', 'Shift'), col('cashier', 'Cashier'), col('openedAt', 'Opened', 'datetime'), col('closedAt', 'Closed', 'datetime'), col('status', 'Status'),
      col('bills', 'Bills', 'number', { total: true }), col('sales', 'Sales', 'money', { total: true }), col('expected', 'Expected cash', 'money'), col('counted', 'Counted cash', 'money'),
      col('overShort', 'Over (+) / short (-)', 'money', { total: true })],
    rows: rows.map((s) => {
      const sum = summary(ctx.db, s);
      return { docNo: s.doc_no, cashier: s.full_name, openedAt: s.opened_at, closedAt: s.closed_at, status: s.status === 'open' ? 'Open' : 'Closed', bills: sum.bills, sales: sum.salesTotal,
        expected: s.status === 'closed' ? s.expected_cash : sum.expectedCash, counted: s.counted_cash, overShort: s.over_short || 0, link: { path: 'shift', params: { id: s.id } }, flag: !!s.over_short };
    }),
    notes: ['Expected cash = opening cash + cash sales + cash received - cash refunds + cash in - cash out (expenses paid from the drawer are cash out).'],
  };
}

// ---- purchases and accounts ----------------------------------------------------------------------------------------

function purchases(ctx, f) {
  if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
  const rows = ctx.db.prepare(`SELECT g.*, s.name AS supplier FROM grns g JOIN suppliers s ON s.id = g.supplier_id WHERE g.posted_at IS NOT NULL AND ${B(f, 'g')}
    AND g.received_date BETWEEN @from AND @to ${f.supplier ? 'AND g.supplier_id = @supplier' : ''} ORDER BY g.received_date, g.doc_no`).all(f);
  return {
    columns: [col('date', 'Received on', 'date'), col('docNo', 'Goods receipt'), col('supplier', 'Supplier'), col('invoice', 'Supplier invoice'), col('subtotal', 'Subtotal', 'money', { total: true }),
      col('discount', 'Discounts', 'money', { total: true }), col('tax', 'Tax', 'money', { total: true }), col('freight', 'Freight', 'money', { total: true }), col('total', 'Total', 'money', { total: true }),
      col('status', 'Status')],
    rows: rows.map((g) => {
      const cancelled = g.status === 'cancelled';
      const sign = cancelled ? 0 : 1;
      return { date: g.received_date, docNo: g.doc_no, supplier: g.supplier, invoice: g.supplier_invoice_no || '', subtotal: sign * g.subtotal, discount: sign * (g.line_discount + g.doc_discount),
        tax: sign * g.tax, freight: sign * g.freight, total: sign * g.total, status: cancelled ? 'Cancelled' : 'Posted', link: { path: 'grn', params: { id: g.id } }, flag: cancelled };
    }),
    chart: null, notes: ['Cancelled goods receipts are listed with zero amounts.'],
  };
}

function supplierBalances(ctx, f) {
  const rows = ctx.db.prepare(`SELECT s.id, s.name, s.code,
      SUM(CASE WHEN l.entry_date < @from THEN l.credit - l.debit ELSE 0 END) AS opening,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('purchase', 'purchase_cancel') THEN l.credit - l.debit ELSE 0 END) AS purchases,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('return', 'return_cancel') THEN l.debit - l.credit ELSE 0 END) AS returns,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('payment', 'payment_cancel') THEN l.debit - l.credit ELSE 0 END) AS payments,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('opening', 'adjustment') THEN l.credit - l.debit ELSE 0 END) AS other,
      SUM(CASE WHEN l.entry_date <= @to THEN l.credit - l.debit ELSE 0 END) AS closing
    FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id WHERE ${B(f, 'l')} ${f.supplier ? 'AND l.supplier_id = @supplier' : ''}
    GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).all(f).filter((r) => r.opening || r.purchases || r.returns || r.payments || r.other || r.closing);
  return {
    columns: [col('name', 'Supplier'), col('opening', 'Opening balance', 'money', { total: true }), col('purchases', 'Purchases', 'money', { total: true }),
      col('returns', 'Returns', 'money', { total: true }), col('payments', 'Payments', 'money', { total: true }), col('other', 'Other', 'money', { total: true }),
      col('closing', 'We owe (closing)', 'money', { total: true })],
    rows: rows.map((r) => ({ ...r, link: { path: 'supplier', params: { id: r.id } } })),
    notes: ['Closing = opening + purchases - returns - payments + other. A minus balance means the supplier owes us.'],
  };
}

function customerBalances(ctx, f) {
  const rows = ctx.db.prepare(`SELECT c.id, c.name, c.phone, l.branch_id,
      SUM(CASE WHEN l.entry_date < @from THEN l.debit - l.credit ELSE 0 END) AS opening,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('sale', 'sale_payment', 'void') THEN l.debit - l.credit ELSE 0 END) AS onAccount,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('receipt', 'receipt_cancel') THEN l.credit - l.debit ELSE 0 END) AS receipts,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type = 'return' THEN l.credit - l.debit ELSE 0 END) AS returns,
      SUM(CASE WHEN l.entry_date BETWEEN @from AND @to AND l.entry_type IN ('opening', 'adjustment') THEN l.debit - l.credit ELSE 0 END) AS other,
      SUM(CASE WHEN l.entry_date <= @to THEN l.debit - l.credit ELSE 0 END) AS closing
    FROM customer_ledger l JOIN customers c ON c.id = l.customer_id WHERE ${B(f, 'l')} ${f.customer ? 'AND l.customer_id = @customer' : ''}
    GROUP BY c.id, l.branch_id ORDER BY c.name COLLATE NOCASE`).all(f).filter((r) => r.opening || r.onAccount || r.receipts || r.returns || r.other || r.closing);
  const merged = new Map();
  for (const r of rows) {
    const m = merged.get(r.id) || { id: r.id, name: r.name, phone: r.phone || '', opening: 0, onAccount: 0, receipts: 0, returns: 0, other: 0, closing: 0 };
    for (const k of ['opening', 'onAccount', 'receipts', 'returns', 'other', 'closing']) m[k] += r[k];
    merged.set(r.id, m);
  }
  return {
    columns: [col('name', 'Customer'), col('phone', 'Phone'), col('opening', 'Opening balance', 'money', { total: true }), col('onAccount', 'Bought on account', 'money', { total: true }),
      col('receipts', 'Paid', 'money', { total: true }), col('returns', 'Returns to account', 'money', { total: true }), col('other', 'Other', 'money', { total: true }),
      col('closing', 'Owes us (closing)', 'money', { total: true })],
    rows: [...merged.values()].map((r) => ({ ...r, link: { path: 'customer', params: { id: r.id } } })),
    notes: ['Closing = opening + bought on account - paid - returns + other.'],
  };
}

function receivables(ctx, f) {
  const days = settings.get(ctx.db, 'customers.creditDays', ctx.branchId);
  const branches = f.branch ? [f.branch] : ctx.db.prepare('SELECT id FROM branches').all().map((b) => b.id);
  const today = f.today;
  const age = (date) => Math.floor((Date.parse(today) - Date.parse(date)) / 86400000);
  const rows = [];
  for (const branchId of branches) {
    const branchName = ctx.db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId).name;
    const list = ctx.db.prepare(`SELECT c.id, c.name, c.phone, c.credit_limit, SUM(l.debit - l.credit) AS balance FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
      WHERE l.branch_id = @bid ${f.customer ? 'AND l.customer_id = @customer' : ''} GROUP BY c.id HAVING balance <> 0 ORDER BY c.name COLLATE NOCASE`).all({ bid: branchId, customer: f.customer });
    for (const c of list) {
      const bills = customers.openBills(ctx.db, c.id, branchId);
      const b = { b0: 0, b31: 0, b61: 0, b91: 0, overdue: 0 };
      for (const bill of bills) {
        const a = age(bill.date);
        if (a <= 30) b.b0 += bill.due; else if (a <= 60) b.b31 += bill.due; else if (a <= 90) b.b61 += bill.due; else b.b91 += bill.due;
        if (a > days) b.overdue += bill.due;
      }
      const billed = b.b0 + b.b31 + b.b61 + b.b91;
      rows.push({ branchName, name: c.name, phone: c.phone || '', limit: c.credit_limit, balance: c.balance, ...b, unallocated: c.balance - billed, oldest: bills.length ? bills[0].date : null,
        link: { path: 'customer', params: { id: c.id } }, flag: b.overdue > 0 });
    }
  }
  return {
    columns: [...(f.branch ? [] : [col('branchName', 'Branch')]), col('name', 'Customer'), col('phone', 'Phone'), col('limit', 'Credit limit', 'money'), col('balance', 'Owes us', 'money', { total: true }),
      col('b0', '0-30 days', 'money', { total: true }), col('b31', '31-60 days', 'money', { total: true }), col('b61', '61-90 days', 'money', { total: true }), col('b91', 'Over 90 days', 'money', { total: true }),
      col('unallocated', 'Not linked to a bill', 'money', { total: true }), col('overdue', `Overdue (over ${days} days)`, 'money', { total: true }), col('oldest', 'Oldest open bill', 'date')],
    rows, notes: [`Age is counted from the bill date to today. Bills on account are overdue after ${days} days (setting). "Not linked to a bill" is the opening balance or payments not matched to bills.`],
  };
}

function expensesReport(ctx, f) {
  const rows = ctx.db.prepare(`SELECT c.name, COUNT(*) AS n, SUM(e.amount) AS amount, SUM(CASE WHEN e.method IN ('drawer', 'petty') THEN e.amount ELSE 0 END) AS cash
    FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.status = 'posted' AND ${B(f, 'e')} AND e.expense_date BETWEEN @from AND @to
    ${f.method ? 'AND e.method = @method' : ''} GROUP BY c.id ORDER BY amount DESC`).all(f);
  const total = money.sum(rows.map((r) => r.amount));
  return {
    columns: [col('name', 'Category'), col('count', 'Expenses', 'number', { total: true }), col('cash', 'Paid in cash', 'money', { total: true }), col('amount', 'Amount', 'money', { total: true }), col('share', 'Share %', 'number')],
    rows: rows.map((r) => ({ name: r.name, count: r.n, cash: r.cash, amount: r.amount, share: pct(r.amount, total), link: { path: 'expenses', params: { from: f.from, to: f.to } } })),
    chart: { x: 'name', y: 'amount', label: 'Amount', type: 'hbar' }, notes: ['Only posted expenses are counted (not those waiting for approval, rejected or cancelled).'],
  };
}

// ---- stock ---------------------------------------------------------------------------------------------------------

function batchRows(ctx, f, extraWhere = '') {
  return ctx.db.prepare(`SELECT s.branch_id, s.qty AS on_hand, b.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, cat.name AS category, br.name AS branch_name
    FROM stock_balances s JOIN batches b ON b.id = s.batch_id JOIN products p ON p.id = s.product_id LEFT JOIN lookups cat ON cat.id = p.category_id JOIN branches br ON br.id = s.branch_id
    WHERE s.qty > 0 AND ${B(f, 's')}${productWhere(f)} ${extraWhere} ORDER BY b.expiry_date, p.brand_name`).all(f);
}

function expiryReport(ctx, f) {
  const until = stock.addDays(f.today, f.days);
  const c = canSeeCost(ctx);
  const rows = batchRows(ctx, { ...f, until }, 'AND b.expiry_date <= @until').map((r) => {
    const daysLeft = Math.round((Date.parse(r.expiry_date) - Date.parse(f.today)) / 86400000);
    return { branchName: r.branch_name, product: label(r), batchNo: r.batch_no, expiry: r.expiry_date, daysLeft, status: daysLeft < 0 ? 'Expired' : 'Near expiry', qtyText: stock.qtyText(r.on_hand, r),
      qty: r.on_hand, value: c ? stock.valueOf(r.cost, r.on_hand, r.pack_size) : null, mrpValue: money.mulRound(r.mrp, r.on_hand, r.pack_size), link: { path: 'product', params: { id: r.product_id } }, flag: daysLeft < 0 };
  });
  return {
    columns: [...(f.branch ? [] : [col('branchName', 'Branch')]), col('product', 'Product'), col('batchNo', 'Batch'), col('expiry', 'Expiry', 'date'), col('daysLeft', 'Days left', 'number'),
      col('status', 'Status'), col('qtyText', 'In stock'), col('qty', 'Base units', 'number', { total: true }), ...(c ? [col('value', 'Value at cost', 'money', { total: true })] : []),
      col('mrpValue', 'Value at MRP', 'money', { total: true })],
    rows, notes: [`Batches in stock that expire within ${f.days} days, and those already expired.`],
  };
}

function valuationReport(ctx, f) {
  const c = canSeeCost(ctx);
  const groups = new Map();
  for (const r of batchRows(ctx, f)) {
    const g = groups.get(r.product_id) || { product: label(r), category: r.category || '', qty: 0, value: 0, mrpValue: 0, batches: 0, p: r, id: r.product_id };
    g.qty += r.on_hand;
    g.batches += 1;
    g.value += stock.valueOf(r.cost, r.on_hand, r.pack_size);
    g.mrpValue += money.mulRound(r.mrp, r.on_hand, r.pack_size);
    groups.set(r.product_id, g);
  }
  const rows = [...groups.values()].map((g) => ({ product: g.product, category: g.category, batches: g.batches, qtyText: stock.qtyText(g.qty, g.p), qty: g.qty,
    value: c ? g.value : null, mrpValue: g.mrpValue, margin: c ? g.mrpValue - g.value : null, link: { path: 'product', params: { id: g.id } } })).sort((a, b) => b.mrpValue - a.mrpValue);
  return {
    columns: [col('product', 'Product'), col('category', 'Category'), col('batches', 'Batches', 'number'), col('qtyText', 'In stock'), col('qty', 'Base units', 'number', { total: true }),
      ...(c ? [col('value', 'Value at cost', 'money', { total: true })] : []), col('mrpValue', 'Value at MRP', 'money', { total: true }), ...(c ? [col('margin', 'Possible margin', 'money', { total: true })] : [])],
    rows, notes: ['Stock as it is now. Cost is the batch cost (what was paid for that batch).'],
  };
}

const RECON = {
  purchases: ['PURCHASE', 'PURCHASE_CANCEL'], supplierReturns: ['PURCHASE_RETURN', 'PURCHASE_RETURN_CANCEL'], sales: ['SALE'], customerReturns: ['SALE_RETURN'],
  transfersIn: ['TRANSFER_IN', 'TRANSFER_BACK'], transfersOut: ['TRANSFER_OUT'], adjustments: ['OPENING', 'ADJUST_IN', 'ADJUST_OUT'], writeOffs: ['DAMAGED', 'LOST', 'EXPIRED'], stocktake: ['STOCKTAKE'],
};

// Inventory reconciliation: opening + purchases + returns + adjustments - sales - write-offs = closing, per product.
// "Expected" is worked out from the movements; "On hand" is the stock the counter sells from (when the period ends
// today) or the ledger at the end date. Any difference, and every stock-take correction, is highlighted.
function reconciliation(ctx, f) {
  // Timestamps are compared with the UTC bounds of the local days, so the covering index ledger_product_time is enough.
  const sums = Object.entries(RECON).map(([k, list]) => `SUM(CASE WHEN l.at >= @fromAt AND l.movement IN (${list.map((m) => `'${m}'`).join(', ')}) THEN l.qty ELSE 0 END) AS ${k}`).join(',\n      ');
  const rows = ctx.db.prepare(`SELECT p.id, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit,
      SUM(CASE WHEN l.at < @fromAt THEN l.qty ELSE 0 END) AS opening,
      ${sums},
      SUM(l.qty) AS ledger
    FROM stock_ledger l JOIN products p ON p.id = l.product_id
    WHERE l.at < @toAt AND ${B(f, 'l')}${productWhere(f)} GROUP BY p.id ORDER BY p.brand_name COLLATE NOCASE`).all({ ...f, fromAt: localStart(f.from), toAt: localStart(stock.addDays(f.to, 1)) });
  const live = f.to >= f.today;
  const onHand = live ? new Map(ctx.db.prepare(`SELECT product_id, SUM(qty) AS q FROM stock_balances s WHERE ${B(f, 's')} GROUP BY product_id`).all(f).map((r) => [r.product_id, r.q])) : null;
  const out = rows.map((r) => {
    const expected = r.opening + Object.keys(RECON).reduce((a, k) => a + r[k], 0);
    const actual = live ? onHand.get(r.id) || 0 : r.ledger;
    return {
      product: label(r), unit: r.base_unit, opening: r.opening, purchases: r.purchases, customerReturns: r.customerReturns, transfersIn: r.transfersIn, adjustments: r.adjustments,
      sales: r.sales, writeOffs: r.writeOffs, transfersOut: r.transfersOut, supplierReturns: r.supplierReturns, stocktake: r.stocktake, expected, actual, difference: actual - expected,
      flag: actual !== expected || r.stocktake !== 0, link: { path: 'product', params: { id: r.id } },
    };
  }).filter((r) => r.opening || r.expected || r.actual || Object.keys(RECON).some((k) => r[k]));
  return {
    columns: [col('product', 'Product'), col('unit', 'Unit'), col('opening', 'Opening', 'number', { total: true }), col('purchases', 'Purchases', 'number', { total: true }),
      col('customerReturns', 'Customer returns', 'number', { total: true }), col('transfersIn', 'Transfers in', 'number', { total: true }), col('adjustments', 'Adjustments', 'number', { total: true }),
      col('sales', 'Sales', 'number', { total: true }), col('writeOffs', 'Write-offs', 'number', { total: true }), col('transfersOut', 'Transfers out', 'number', { total: true }),
      col('supplierReturns', 'Returned to suppliers', 'number', { total: true }), col('stocktake', 'Stock-take corrections', 'number', { total: true }),
      col('expected', 'Expected closing', 'number', { total: true }), col('actual', 'On hand', 'number', { total: true }), col('difference', 'Difference', 'number', { total: true })],
    rows: out,
    notes: ['Quantities are in the smallest unit (tablet, ml). Outgoing movements are shown as minus numbers.',
      'Highlighted rows have a difference between expected and on-hand stock, or a stock-take correction (counted stock was different from the system).'],
  };
}

// ---- management summary --------------------------------------------------------------------------------------------

function periodBefore(from, to) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from: stock.addDays(from, -days), to: stock.addDays(from, -1) };
}

function measures(ctx, f) {
  const db = ctx.db;
  const s = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(s.total), 0) AS sales, COALESCE(SUM(s.line_discount + s.bill_discount), 0) AS discount, COALESCE(SUM(s.tax), 0) AS tax,
    COALESCE(SUM(s.cost), 0) AS cost, COALESCE(SUM(s.credit_amount), 0) AS credit FROM sales s WHERE ${salesWhere(f)}`).get(f);
  const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(r.total), 0) AS total, COALESCE(SUM(r.cost), 0) AS cost FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE ${returnsWhere(f)}`).get(f);
  const exp = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS a FROM expenses e WHERE e.status = 'posted' AND ${B(f, 'e')} AND e.expense_date BETWEEN @from AND @to`).get(f).a;
  const pur = db.prepare(`SELECT COALESCE(SUM(total), 0) AS a FROM grns g WHERE g.status = 'posted' AND ${B(f, 'g')} AND g.received_date BETWEEN @from AND @to`).get(f).a;
  const paid = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS a FROM supplier_payments p WHERE p.status = 'posted' AND ${B(f, 'p')} AND p.paid_date BETWEEN @from AND @to`).get(f).a;
  const rec = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS a FROM customer_receipts r WHERE r.status = 'posted' AND ${B(f, 'r')} AND r.received_date BETWEEN @from AND @to`).get(f).a;
  const wo = db.prepare(`SELECT COALESCE(SUM(-value), 0) AS a FROM stock_ledger l WHERE l.movement IN ('DAMAGED', 'LOST', 'EXPIRED') AND ${B(f, 'l')} AND ${DAY('l.at')} BETWEEN @from AND @to`).get(f).a;
  const net = s.sales - r.total;
  const gp = net - (s.cost - r.cost);
  return { bills: s.bills, sales: s.sales, returns: r.total, net, discount: s.discount, tax: s.tax, credit: s.credit, cost: s.cost - r.cost, gp, margin: pct(gp, net), expenses: exp,
    profit: gp - exp - wo, average: s.bills ? Math.round(s.sales / s.bills) : 0, purchases: pur, paid, received: rec, writeOff: wo };
}

function managementSummary(ctx, f) {
  const c = canSeeCost(ctx);
  const now = measures(ctx, f);
  const prevRange = periodBefore(f.from, f.to);
  const prev = measures(ctx, { ...f, ...prevRange });
  const receivable = ctx.db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS a FROM customer_ledger l WHERE ${B(f, 'l')}`).get(f).a;
  const payable = ctx.db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS a FROM supplier_ledger l WHERE ${B(f, 'l')}`).get(f).a;
  const stockValue = c ? batchRows(ctx, f).reduce((a, x) => a + stock.valueOf(x.cost, x.on_hand, x.pack_size), 0) : null;
  const line = (measure, key, kind = 'money', costOnly = false) => {
    if (costOnly && !c) return null;
    const a = now[key];
    const b = prev[key];
    const show = (x) => (kind === 'money' ? fmt(x) : kind === 'percent' ? `${x}%` : String(x));
    const change = b ? `${(Math.round(((a - b) * 1000) / Math.abs(b)) / 10).toFixed(1)}%` : '';
    return { measure, current: show(a), previous: show(b), change, value: a, previousValue: b, kind };
  };
  const rows = [
    line('Bills', 'bills', 'number'), line('Sales', 'sales'), line('Returns', 'returns'), line('Net sales', 'net'), line('Average bill', 'average'), line('Discounts given', 'discount'),
    line('Tax included in sales', 'tax'), line('Sold on account', 'credit'), line('Cost of sales', 'cost', 'money', true), line('Gross profit', 'gp', 'money', true),
    line('Gross margin', 'margin', 'percent', true), line('Expenses', 'expenses'), line('Stock written off (at cost)', 'writeOff', 'money', true),
    line('Net profit (gross profit - expenses - write-offs)', 'profit', 'money', true), line('Purchases (goods received)', 'purchases', 'money', true),
    line('Paid to suppliers', 'paid'), line('Received from customers on account', 'received'),
  ].filter(Boolean);
  rows.push({ measure: 'Customers owe us (now)', current: fmt(receivable), previous: '', change: '', value: receivable, kind: 'money' });
  rows.push({ measure: 'We owe suppliers (now)', current: fmt(payable), previous: '', change: '', value: payable, kind: 'money' });
  if (c) rows.push({ measure: 'Stock value at cost (now)', current: fmt(stockValue), previous: '', change: '', value: stockValue, kind: 'money' });
  return {
    columns: [col('measure', 'Measure'), col('current', `${f.from} to ${f.to}`), col('previous', `Previous period (${prevRange.from} to ${prevRange.to})`), col('change', 'Change')],
    rows, notes: ['The previous period has the same number of days, just before the chosen period.'],
  };
}

// ---- catalogue -----------------------------------------------------------------------------------------------------

const D = ['dates', 'branch'];
const REPORTS = [
  { key: 'daily_sales', group: 'sales', title: 'Daily sales', filters: [...D, 'customer', 'user'], run: (ctx, f) => salesByPeriod(ctx, f, false) },
  { key: 'monthly_sales', group: 'sales', title: 'Monthly sales', filters: [...D, 'customer', 'user'], run: (ctx, f) => salesByPeriod(ctx, f, true) },
  { key: 'sales_by_product', group: 'sales', title: 'Sales by product', filters: [...D, 'product', 'category', 'customer', 'user'], run: (ctx, f) => salesByProduct(ctx, f, false) },
  { key: 'sales_by_category', group: 'sales', title: 'Sales by category', filters: [...D, 'category', 'customer', 'user'], run: (ctx, f) => salesByProduct(ctx, f, true) },
  { key: 'sales_by_cashier', group: 'sales', title: 'Sales by cashier', filters: [...D, 'user'], run: salesByCashier },
  { key: 'sales_by_branch', group: 'sales', title: 'Sales by branch', filters: ['dates'], run: salesByBranch },
  { key: 'sales_by_method', group: 'sales', title: 'Sales by payment method', filters: [...D, 'user'], financial: true, run: salesByMethod },
  { key: 'discounts', group: 'sales', title: 'Discounts given', filters: [...D, 'customer', 'user'], run: discounts },
  { key: 'shifts', group: 'sales', title: 'Cashier shifts', filters: [...D, 'user'], financial: true, run: shiftsReport },
  { key: 'gross_profit', group: 'money', title: 'Gross profit', filters: [...D, 'customer', 'user'], financial: true, cost: true, run: grossProfit },
  { key: 'tax', group: 'money', title: 'Tax report', filters: D, financial: true, run: taxReport },
  { key: 'expenses', group: 'money', title: 'Expenses by category', filters: [...D, 'method'], financial: true, run: expensesReport },
  { key: 'receivables', group: 'money', title: 'Customer balances and ageing', filters: ['branch', 'customer'], financial: true, run: receivables },
  { key: 'customer_ledger', group: 'money', title: 'Customer accounts for a period', filters: [...D, 'customer'], financial: true, run: customerBalances },
  { key: 'supplier_ledger', group: 'money', title: 'Supplier accounts for a period', filters: [...D, 'supplier'], financial: true, run: supplierBalances },
  { key: 'management_summary', group: 'money', title: 'Management summary', filters: D, financial: true, run: managementSummary },
  { key: 'purchases', group: 'purchases', title: 'Purchases', filters: [...D, 'supplier'], cost: true, run: purchases },
  { key: 'expiry', group: 'stock', title: 'Expiry', filters: ['branch', 'product', 'category', 'days'], run: expiryReport },
  { key: 'stock_valuation', group: 'stock', title: 'Stock valuation', filters: ['branch', 'product', 'category'], run: valuationReport },
  { key: 'reconciliation', group: 'stock', title: 'Inventory reconciliation and stock movement', filters: [...D, 'product', 'category'], run: reconciliation },
];

function allowedReport(ctx, def) {
  if (def.financial && !ctx.can('reports.financial')) return false;
  if (def.cost && !canSeeCost(ctx)) return false;
  return true;
}

function run(ctx, params) {
  const def = REPORTS.find((r) => r.key === params.report);
  if (!def) invalid('report', 'error.invalid', { field: 'Report' });
  if (!allowedReport(ctx, def)) fail('FORBIDDEN', def.cost && !canSeeCost(ctx) ? 'error.costHidden' : 'error.noPermission');
  const f = filters(ctx, params, def);
  const res = def.run(ctx, f);
  const totals = {};
  for (const c of res.columns) if (c.total) totals[c.key] = res.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
  const branchName = f.branch ? ctx.db.prepare('SELECT name FROM branches WHERE id = ?').get(f.branch).name : 'All branches';
  return { key: def.key, title: def.title, branchName, from: f.from, to: f.to, columns: res.columns, rows: res.rows, totals, notes: res.notes || [], chart: res.chart || null, total: res.rows.length };
}

function catalog(ctx) {
  return REPORTS.filter((d) => allowedReport(ctx, d)).map((d) => ({ key: d.key, title: d.title, group: d.group, filters: d.filters }));
}

function register(define) {
  define('reports.catalog', { perm: 'reports.view' }, catalog);
  define('reports.run', { perm: 'reports.view' }, run);
}

module.exports = { register, run, measures, salesByPeriod, REPORTS };

'use strict';
// Dashboards. The branch dashboard answers "how is today going and what needs attention"; the all-branches view lets
// the owner compare branches. Everything is worked out from the documents when asked, and every figure says where
// it came from so the screen can open the transactions behind it.
const { fail } = require('../core/errors');
const v = require('../core/validate');
const money = require('../core/money');
const stock = require('../core/stock');
const { canSeeCost } = require('../core/docs');
const settings = require('./settings');
const { levels } = require('./products');
const { seesAllBranches } = require('./guards');
const { scope } = require('./finance');
const reports = require('./reports');

const DAY = (col) => `date(${col}, 'localtime')`;

// Products at or below their reorder level (or minimum) in a branch, and those with a level that are out of stock.
function stockAlerts(db, branchId) {
  const rows = db.prepare(`SELECT p.id, p.min_stock, p.reorder_level, pb.min_stock AS b_min, pb.reorder_level AS b_reorder,
      COALESCE((SELECT SUM(qty) FROM stock_balances sb WHERE sb.branch_id = @branch AND sb.product_id = p.id), 0) AS on_hand
    FROM products p LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = @branch WHERE p.active = 1`).all({ branch: branchId });
  let low = 0;
  let out = 0;
  for (const r of rows) {
    const lv = levels(r);
    const trigger = lv.reorderLevel || lv.minStock;
    if (!trigger || r.on_hand > trigger) continue;
    if (r.on_hand <= 0) out += 1; else low += 1;
  }
  return { low, out };
}

function expiryAlerts(db, branchId) {
  const today = stock.today();
  const near = settings.get(db, 'expiry.nearDays', branchId)[0] || 30;
  const until = stock.addDays(today, near);
  const r = db.prepare(`SELECT SUM(CASE WHEN b.expiry_date < @today THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN b.expiry_date >= @today AND b.expiry_date <= @until THEN 1 ELSE 0 END) AS near
    FROM stock_balances s JOIN batches b ON b.id = s.batch_id WHERE s.branch_id = @branch AND s.qty > 0`).get({ today, until, branch: branchId });
  return { expired: r.expired || 0, near: r.near || 0, nearDays: near };
}

function overdueSupplierBills(db, branchId) {
  const today = stock.today();
  return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(g.total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
      WHERE a.grn_id = g.id AND p.status = 'posted'), 0)), 0) AS due
    FROM grns g WHERE g.branch_id = ? AND g.status = 'posted' AND g.due_date IS NOT NULL AND g.due_date < ?
      AND g.total > COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.grn_id = g.id AND p.status = 'posted'), 0)`).get(branchId, today);
}

function overdueCustomerBills(db, branchId) {
  const days = settings.get(db, 'customers.creditDays', branchId);
  const before = stock.addDays(stock.today(), -days);
  const r = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT s.customer_id) AS customers, COALESCE(SUM(s.credit_amount
      - COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.sale_id = s.id AND r.status = 'posted'), 0)
      - COALESCE((SELECT SUM(account_amount) FROM sale_returns x WHERE x.sale_id = s.id), 0)), 0) AS due
    FROM sales s WHERE s.branch_id = ? AND s.status = 'completed' AND s.credit_amount > 0 AND s.sale_date < ?
      AND s.credit_amount > COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.sale_id = s.id AND r.status = 'posted'), 0)
        + COALESCE((SELECT SUM(account_amount) FROM sale_returns x WHERE x.sale_id = s.id), 0)`).get(branchId, before);
  return { ...r, days };
}

function balances(db, branchId) {
  const receivable = db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS a FROM customer_ledger WHERE branch_id = ?').get(branchId).a;
  const payable = db.prepare('SELECT COALESCE(SUM(credit - debit), 0) AS a FROM supplier_ledger WHERE branch_id = ?').get(branchId).a;
  return { receivable, payable };
}

function dayFigures(db, branchId, day, withCost) {
  const s = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(credit_amount), 0) AS credit, COALESCE(SUM(cost), 0) AS cost,
    COALESCE(SUM(line_discount + bill_discount), 0) AS discount FROM sales WHERE branch_id = ? AND status = 'completed' AND sale_date = ?`).get(branchId, day);
  const pays = db.prepare(`SELECT p.method, SUM(p.amount) AS a FROM sale_payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.kind = 'sale' AND s.branch_id = ? AND s.status = 'completed' AND s.sale_date = ? GROUP BY p.method`).all(branchId, day);
  const m = (list) => pays.filter((p) => list.includes(p.method)).reduce((a, p) => a + p.a, 0);
  const ret = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(cost), 0) AS cost FROM sale_returns WHERE branch_id = ? AND ${DAY('returned_at')} = ?`).get(branchId, day);
  const rec = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM customer_receipts WHERE branch_id = ? AND status = 'posted' AND received_date = ?`).get(branchId, day);
  const exp = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE branch_id = ? AND status = 'posted' AND expense_date = ?`).get(branchId, day);
  const net = s.total - ret.total;
  return {
    bills: s.bills, sales: s.total, net, discount: s.discount, cash: m(['cash']), card: m(['card']), online: m(['easypaisa', 'jazzcash', 'bank']), credit: s.credit,
    returns: { count: ret.n, total: ret.total }, collections: { count: rec.n, total: rec.total }, expenses: { count: exp.n, total: exp.total },
    profit: withCost ? net - (s.cost - ret.cost) : null, average: s.bills ? Math.round(s.total / s.bills) : 0,
  };
}

// Net sales per day for the last `days` days, with empty days filled in so the line has no gaps.
function trend(ctx, branchId, days) {
  const to = stock.today();
  const from = stock.addDays(to, -(days - 1));
  const f = { branch: branchId, from, to, customer: null, user: null };
  const res = reports.salesByPeriod(ctx, f, false).rows;
  const out = [];
  for (let d = from; d <= to; d = stock.addDays(d, 1)) {
    const r = res.find((x) => x.period === d);
    out.push({ day: d, net: r ? r.net : 0, bills: r ? r.bills : 0, profit: r ? r.profit : null });
  }
  return out;
}

function topProducts(ctx, branchId, from, to) {
  return ctx.db.prepare(`SELECT p.id, p.brand_name, p.strength, SUM(l.net) AS net, SUM(l.qty) AS qty FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN products p ON p.id = l.product_id
    WHERE s.branch_id = ? AND s.status = 'completed' AND s.sale_date BETWEEN ? AND ? GROUP BY p.id ORDER BY net DESC LIMIT 8`).all(branchId, from, to)
    .map((r) => ({ id: r.id, name: [r.brand_name, r.strength].filter(Boolean).join(' '), net: r.net }));
}

function categoryShare(ctx, branchId, from, to) {
  const rows = ctx.db.prepare(`SELECT COALESCE(c.id, '') AS id, COALESCE(c.name, 'No category') AS name, SUM(l.net) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale_id
    JOIN products p ON p.id = l.product_id LEFT JOIN lookups c ON c.id = p.category_id
    WHERE s.branch_id = ? AND s.status = 'completed' AND s.sale_date BETWEEN ? AND ? GROUP BY COALESCE(c.id, '') ORDER BY net DESC`).all(branchId, from, to);
  const total = money.sum(rows.map((r) => r.net));
  // Seven categories at most; the rest are folded into "Other".
  const head = rows.slice(0, 6);
  const rest = rows.slice(6);
  if (rest.length) head.push({ id: 'other', name: 'Other', net: money.sum(rest.map((r) => r.net)) });
  return head.map((r) => ({ ...r, share: total ? Math.round((r.net * 1000) / total) / 10 : 0 }));
}

function salesVsPurchases(ctx, branchId, months) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, sales: 0, purchases: 0 });
  }
  const from = `${out[0].month}-01`;
  const sales = ctx.db.prepare(`SELECT substr(sale_date, 1, 7) AS k, SUM(total) AS a FROM sales WHERE branch_id = ? AND status = 'completed' AND sale_date >= ? GROUP BY k`).all(branchId, from);
  const rets = ctx.db.prepare(`SELECT substr(${DAY('returned_at')}, 1, 7) AS k, SUM(total) AS a FROM sale_returns WHERE branch_id = ? AND ${DAY('returned_at')} >= ? GROUP BY k`).all(branchId, from);
  const pur = ctx.db.prepare(`SELECT substr(received_date, 1, 7) AS k, SUM(total) AS a FROM grns WHERE branch_id = ? AND status = 'posted' AND received_date >= ? GROUP BY k`).all(branchId, from);
  for (const o of out) {
    o.sales = ((sales.find((x) => x.k === o.month) || {}).a || 0) - ((rets.find((x) => x.k === o.month) || {}).a || 0);
    o.purchases = (pur.find((x) => x.k === o.month) || {}).a || 0;
  }
  return out;
}

function branchDashboard(ctx, params) {
  const branchId = scope(ctx, { branchId: params.branchId }) || ctx.branchId;
  const db = ctx.db;
  const c = canSeeCost(ctx);
  const today = stock.today();
  const yesterday = stock.addDays(today, -1);
  const from30 = stock.addDays(today, -29);
  const branch = db.prepare('SELECT id, name, code FROM branches WHERE id = ?').get(branchId);
  const out = {
    branch: { id: branch.id, name: branch.name }, today, from30,
    todayFigures: dayFigures(db, branchId, today, c), yesterday: dayFigures(db, branchId, yesterday, c),
    stock: stockAlerts(db, branchId), expiry: expiryAlerts(db, branchId),
    trend: trend(ctx, branchId, 30), topProducts: topProducts(ctx, branchId, from30, today), categories: categoryShare(ctx, branchId, from30, today),
  };
  // Money owed and purchases are financial figures.
  if (ctx.can('reports.financial')) {
    out.balances = balances(db, branchId);
    out.overdueSuppliers = overdueSupplierBills(db, branchId);
    out.overdueCustomers = overdueCustomerBills(db, branchId);
    out.salesVsPurchases = c ? salesVsPurchases(ctx, branchId, 6) : null;
  }
  out.pendingApprovals = require('./approvals').pendingCount(ctx, branchId);
  return out;
}

function allBranches(ctx, params) {
  if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
  const to = v.date(params, 'to', 'To') || stock.today();
  const from = v.date(params, 'from', 'From') || stock.addDays(to, -29);
  const c = canSeeCost(ctx);
  const fin = ctx.can('reports.financial');
  const branches = ctx.db.prepare('SELECT * FROM branches WHERE active = 1 ORDER BY is_head_office DESC, name').all();
  const rows = branches.map((b) => {
    const m = reports.measures(ctx, { branch: b.id, from, to, customer: null, user: null });
    const al = stockAlerts(ctx.db, b.id);
    const ex = expiryAlerts(ctx.db, b.id);
    const bal = fin ? balances(ctx.db, b.id) : null;
    const value = c ? ctx.db.prepare(`SELECT s.qty, bt.cost, p.pack_size FROM stock_balances s JOIN batches bt ON bt.id = s.batch_id JOIN products p ON p.id = s.product_id
      WHERE s.branch_id = ? AND s.qty > 0`).all(b.id).reduce((a, r) => a + stock.valueOf(r.cost, r.qty, r.pack_size), 0) : null;
    return {
      id: b.id, name: b.name, code: b.code, isHeadOffice: b.is_head_office === 1, bills: m.bills, net: m.net, average: m.average, discount: m.discount, returns: m.returns,
      profit: c ? m.gp : null, margin: c ? m.margin : null, expenses: fin ? m.expenses : null, receivable: bal ? bal.receivable : null, payable: bal ? bal.payable : null,
      stockValue: value, lowStock: al.low + al.out, nearExpiry: ex.near, expired: ex.expired,
    };
  });
  const sum = (k) => (rows.some((r) => r[k] === null) ? null : rows.reduce((a, r) => a + r[k], 0));
  return { from, to, rows, totals: { bills: sum('bills'), net: sum('net'), profit: sum('profit'), expenses: sum('expenses'), receivable: sum('receivable'), payable: sum('payable'), stockValue: sum('stockValue') } };
}

function register(define) {
  define('dashboard.branch', { perm: 'dashboard.view' }, branchDashboard);
  define('dashboard.allBranches', { perm: 'dashboard.view' }, allBranches);
}

module.exports = { register, stockAlerts, expiryAlerts, overdueSupplierBills, overdueCustomerBills };

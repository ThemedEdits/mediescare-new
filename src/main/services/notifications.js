'use strict';
// Notifications are worked out from the data when asked (never stored), so they disappear by themselves once the
// cause is fixed. Each one has a signature (its count and newest item); the bell counts one as new until this person
// has seen that exact signature (notification_reads, local to this computer).
const { nowIso } = require('../core/ids');
const stock = require('../core/stock');
const dash = require('./dashboard');
const approvals = require('./approvals');

function list(ctx) {
  const db = ctx.db;
  const b = ctx.branchId;
  const can = (...p) => p.some((x) => ctx.can(x));
  const out = [];
  const add = (key, severity, title, text, count, route, extra = '') => {
    if (count > 0) out.push({ key, severity, title, text, count, route, signature: `${count}|${extra}` });
  };

  if (can('products.view', 'stock.view')) {
    const s = dash.stockAlerts(db, b);
    add('stock.out', 'critical', 'Out of stock', `${s.out} product(s) with a reorder level have no stock.`, s.out, { path: 'reorder' });
    add('stock.low', 'warning', 'Low stock', `${s.low} product(s) are at or below their reorder level.`, s.low, { path: 'reorder' });
  }
  if (can('batches.view', 'stock.view')) {
    const e = dash.expiryAlerts(db, b);
    add('expiry.expired', 'critical', 'Expired stock on the shelf', `${e.expired} batch(es) in stock have expired. Write them off or return them.`, e.expired, { path: 'batches', params: { status: 'expired' } });
    add('expiry.near', 'warning', 'Expiring soon', `${e.near} batch(es) expire within ${e.nearDays} days.`, e.near, { path: 'batches', params: { status: 'near' } });
    const neg = db.prepare('SELECT COUNT(*) AS n FROM stock_balances WHERE branch_id = ? AND qty < 0').get(b).n;
    add('stock.negative', 'critical', 'Stock below zero', `${neg} batch(es) went below zero after computers synced. Check them and correct the stock.`, neg, { path: 'batches', params: { status: 'negative' } });
  }
  if (can('customers.view')) {
    const o = dash.overdueCustomerBills(db, b);
    add('customers.overdue', 'warning', 'Customer payments overdue', `${o.customers} customer(s) have ${o.n} bill(s) on account older than ${o.days} days.`, o.n,
      ctx.can('reports.financial') && ctx.can('reports.view') ? { path: 'reports', params: { report: 'receivables' } } : { path: 'customers' }, String(o.due));
  }
  if (can('supplier_payments.view', 'suppliers.view')) {
    const o = dash.overdueSupplierBills(db, b);
    add('suppliers.overdue', 'warning', 'Supplier bills overdue', `${o.n} supplier bill(s) are past their due date.`, o.n, { path: ctx.can('supplier_payments.view') ? 'payments' : 'suppliers' }, String(o.due));
  }
  if (can('approvals.view', 'approvals.approve', 'stock.approve', 'expenses.approve', 'transfers.approve')) {
    const waiting = approvals.items(ctx, b, { pending: true }).filter((x) => x.canDecide);
    add('approvals.pending', 'info', 'Waiting for your approval', `${waiting.length} request(s) wait for a decision.`, waiting.length,
      can('approvals.view', 'approvals.approve') ? { path: 'approvals' } : { path: 'adjustments' }, waiting.map((x) => x.id).sort().join(',').slice(-60));
  }
  if (can('transfers.receive')) {
    const n = db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM transfers WHERE to_branch_id = ? AND status = 'dispatched'").get(b);
    add('transfers.incoming', 'info', 'Transfers on the way', `${n.n} transfer(s) were sent to this branch and wait to be received.`, n.n, { path: 'transfers' }, n.at || '');
  }
  if (can('transfers.dispatch')) {
    const n = db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM transfers WHERE from_branch_id = ? AND status = 'approved'").get(b);
    add('transfers.dispatch', 'info', 'Transfers to send', `${n.n} approved transfer request(s) wait to be dispatched.`, n.n, { path: 'transfers' }, n.at || '');
  }
  if (can('transfers.approve')) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE from_branch_id = ? AND discrepancy_open = 1').get(b).n;
    add('transfers.shortage', 'warning', 'Transfer shortages to settle', `${n} transfer(s) arrived short and need a decision.`, n, { path: 'transfers' });
  }
  if (can('sync.view')) {
    const st = require('./sync').status(ctx);
    const failing = ['lan', 'cloud'].filter((ch) => st[ch] && st[ch].state === 'error');
    add('sync.error', 'critical', 'Sync is failing', `${failing.map((c) => (c === 'lan' ? 'Shop network' : 'Cloud')).join(' and ')} sync has errors. Work is saved here and will be sent when it works again.`,
      failing.length, { path: 'sync' }, failing.join(','));
    add('sync.conflicts', 'warning', 'Sync needs a look', `${st.conflicts} item(s) were changed on two computers and were settled automatically.`, st.conflicts, { path: 'sync' });
    add('sync.clock', 'warning', 'Computer clock is wrong', 'This computer\'s clock differs from the main computer by more than 2 minutes.', st.clockWarning ? 1 : 0, { path: 'sync' });
  }
  if (can('backups.view')) {
    const st = require('./sync').status(ctx).backup;
    add('backup.failed', 'critical', 'Backup failed', st.lastMessage || 'The last backup could not be written.', st.lastStatus === 'error' ? 1 : 0, { path: 'backups' }, st.lastMessage || '');
    add('backup.stale', 'warning', 'No recent backup', st.lastAt ? 'The last good backup is more than 2 days old.' : 'No backup has been made on this computer yet.', st.stale ? 1 : 0, { path: 'backups' }, st.lastAt || '');
  }

  const seen = new Map(db.prepare('SELECT key, signature FROM notification_reads WHERE user_id = ?').all(ctx.userId).map((r) => [r.key, r.signature]));
  for (const n of out) n.unread = seen.get(n.key) !== n.signature;
  const order = { critical: 0, warning: 1, info: 2 };
  out.sort((a, c) => order[a.severity] - order[c.severity] || a.title.localeCompare(c.title));
  return { items: out, unread: out.filter((n) => n.unread).length, at: nowIso(), today: stock.today() };
}

function markSeen(ctx, params) {
  const current = list(ctx).items;
  const keys = Array.isArray(params.keys) ? new Set(params.keys.map(String)) : null;
  const now = nowIso();
  const up = ctx.db.prepare(`INSERT INTO notification_reads (user_id, key, signature, seen_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, key) DO UPDATE SET signature = excluded.signature, seen_at = excluded.seen_at`);
  ctx.db.transaction(() => { for (const n of current) if (!keys || keys.has(n.key)) up.run(ctx.userId, n.key, n.signature, now); })();
  return list(ctx);
}

function register(define) {
  define('notifications.list', {}, list);
  define('notifications.markSeen', {}, markSeen);
}

module.exports = { register, list };

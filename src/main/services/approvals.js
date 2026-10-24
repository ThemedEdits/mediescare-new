'use strict';
// The approval queue. One list of everything in a branch that waits for a manager:
//   counter requests  - a cashier asks for a discount above the limit, a typed price, credit, a big return or a bill
//                       cancellation, and a manager decides on another computer (approval_requests)
//   expenses          - above the branch limit (expenses.approvalValue)
//   stock adjustments - above stock.adjustApprovalValue, including expired write-offs
//   transfer requests - when transfers.requireApproval is on
// Every item goes created -> pending -> approved or rejected, with who decided, when and why. Nobody decides their own.
// An approved counter request can be used once, by the person who asked, within approvals.validMinutes.
const { newId, nowIso } = require('../core/ids');
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const { canSeeCost } = require('../core/docs');
const { isKnown } = require('../core/permissions');
const settings = require('./settings');

const COUNTER_NEEDS = ['discount.above_limit', 'price.override', 'sales.credit', 'sales.void', 'expenses.approve'];

function needsOf(r) {
  try { return JSON.parse(r.needs); } catch (_) { return []; }
}

function canDecideRequest(ctx, r) {
  return r.requested_by !== ctx.userId && ctx.can('approvals.approve') && needsOf(r).every((p) => ctx.can(p));
}

function request(ctx, params) {
  const needs = (Array.isArray(params.needs) ? params.needs : [params.needs]).map(String).filter(Boolean);
  if (!needs.length || needs.some((n) => !isKnown(n) || !COUNTER_NEEDS.includes(n))) fail('VALIDATION', 'error.invalid', { field: 'Approval' });
  const summary = v.text(params, 'summary', 'What needs approval', { required: true, max: 300 });
  const amount = params.amount === undefined || params.amount === null ? null : v.money(params, 'amount', 'Amount', { min: 0 });
  const kind = v.oneOf(params, 'kind', 'Type', ['sale', 'return', 'void', 'expense'], { required: false, fallback: 'sale' });
  const id = newId();
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO approval_requests (id, branch_id, kind, needs, summary, amount, payload, status, requested_by, requested_at, device_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?, ?)`).run(id, ctx.branchId, kind, JSON.stringify(needs), summary, amount, ctx.userId, now, ctx.app.device.id, now, now);
    audit.write(ctx.db, ctx.actor, { module: 'approvals', action: 'request', recordType: 'approval_request', recordId: id, summary: `Approval asked: ${summary}` });
  })();
  return status(ctx, { id });
}

function loadRequest(ctx, id) {
  const r = ctx.db.prepare(`SELECT a.*, u1.full_name AS requested_name, u2.full_name AS decided_name FROM approval_requests a
    LEFT JOIN users u1 ON u1.id = a.requested_by LEFT JOIN users u2 ON u2.id = a.decided_by WHERE a.id = ?`).get(id || '');
  if (!r) fail('NOT_FOUND', 'error.notFound', { thing: 'approval request' });
  if (r.branch_id !== ctx.branchId) fail('FORBIDDEN', 'error.wrongBranch');
  return r;
}

// The person who asked checks their request. Once approved it gives the token to finish the bill with.
function status(ctx, params) {
  const r = loadRequest(ctx, v.id(params, 'id', 'Request'));
  if (r.requested_by !== ctx.userId) fail('FORBIDDEN', 'error.noPermission');
  const minutes = settings.get(ctx.db, 'approvals.validMinutes', ctx.branchId);
  const expired = r.status === 'approved' && Date.parse(r.decided_at) + minutes * 60000 < Date.now();
  return {
    id: r.id, status: expired ? 'expired' : r.status, decidedBy: r.decided_name, decidedAt: r.decided_at, reason: r.decision_reason,
    token: r.status === 'approved' && !expired ? `req:${r.id}` : null,
  };
}

function cancelRequest(ctx, params) {
  const r = loadRequest(ctx, v.id(params, 'id', 'Request'));
  if (r.requested_by !== ctx.userId) fail('FORBIDDEN', 'error.noPermission');
  if (r.status !== 'pending' && r.status !== 'approved') return status(ctx, params);
  const now = nowIso();
  ctx.db.prepare("UPDATE approval_requests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, r.id);
  return status(ctx, params);
}

function decide(ctx, params) {
  const r = loadRequest(ctx, v.id(params, 'id', 'Request'));
  if (r.status !== 'pending') fail('WRONG_STATUS', 'approvals.alreadyDecided');
  if (r.requested_by === ctx.userId) fail('FORBIDDEN', 'approvals.notOwn');
  if (!canDecideRequest(ctx, r)) fail('FORBIDDEN', 'approvals.noRight');
  const approve = v.bool(params, 'approve');
  const reason = v.text(params, 'reason', 'Reason', { required: !approve, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ? WHERE id = ?')
      .run(approve ? 'approved' : 'rejected', ctx.userId, now, reason, now, r.id);
    audit.write(ctx.db, ctx.actor, { module: 'approvals', action: approve ? 'approve' : 'reject', recordType: 'approval_request', recordId: r.id,
      summary: `${approve ? 'Approved' : 'Rejected'} for ${r.requested_name}: ${r.summary}`, reason });
  })();
  return { ok: true };
}

// ---- the queue -----------------------------------------------------------------------------------------------------

function items(ctx, branchId, { pending }) {
  const db = ctx.db;
  const c = canSeeCost(ctx);
  const out = [];
  const limit = pending ? '' : 'LIMIT 300';
  if (ctx.can('approvals.view') || ctx.can('approvals.approve')) {
    const rows = db.prepare(`SELECT a.*, u1.full_name AS requested_name, u2.full_name AS decided_name FROM approval_requests a
      LEFT JOIN users u1 ON u1.id = a.requested_by LEFT JOIN users u2 ON u2.id = a.decided_by
      WHERE a.branch_id = ? AND ${pending ? "a.status = 'pending'" : "a.status IN ('approved', 'rejected', 'used')"} ORDER BY a.requested_at DESC ${limit}`).all(branchId);
    for (const r of rows) {
      out.push({ kind: 'counter', id: r.id, docNo: null, summary: r.summary, amount: r.amount, needs: needsOf(r), requestedBy: r.requested_name, requestedAt: r.requested_at,
        status: r.status, decidedBy: r.decided_name, decidedAt: r.decided_at, reason: r.decision_reason, canDecide: pending && canDecideRequest(ctx, r), link: null });
    }
  }
  if (ctx.can('expenses.view') || ctx.can('expenses.approve')) {
    const rows = db.prepare(`SELECT e.*, c.name AS category, u1.full_name AS requested_name, u2.full_name AS decided_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN users u1 ON u1.id = e.requested_by LEFT JOIN users u2 ON u2.id = e.decided_by
      WHERE e.branch_id = ? AND ${pending ? "e.status = 'pending'" : "e.decided_by IS NOT NULL AND e.decided_by <> e.requested_by"} ORDER BY e.created_at DESC ${limit}`).all(branchId);
    for (const e of rows) {
      out.push({ kind: 'expense', id: e.id, docNo: e.doc_no, summary: `${e.category}: ${e.description}`, amount: e.amount, requestedBy: e.requested_name, requestedAt: e.created_at,
        status: e.status === 'posted' ? 'approved' : e.status, decidedBy: e.decided_name, decidedAt: e.decided_at, reason: e.decision_reason,
        canDecide: pending && ctx.can('expenses.approve') && e.requested_by !== ctx.userId, link: { path: 'expenses', params: { id: e.id } } });
    }
  }
  if (ctx.can('stock.view') || ctx.can('stock.approve')) {
    const rows = db.prepare(`SELECT a.*, u1.full_name AS requested_name, u2.full_name AS decided_name FROM stock_adjustments a
      LEFT JOIN users u1 ON u1.id = a.requested_by LEFT JOIN users u2 ON u2.id = a.decided_by
      WHERE a.branch_id = ? AND ${pending ? "a.status = 'pending'" : "a.decided_by IS NOT NULL AND a.decided_by <> a.requested_by"} ORDER BY a.created_at DESC ${limit}`).all(branchId);
    for (const a of rows) {
      out.push({ kind: a.kind === 'expired' ? 'write_off' : 'adjustment', id: a.id, docNo: a.doc_no, summary: a.reason, amount: c ? a.total_value : null, requestedBy: a.requested_name,
        requestedAt: a.created_at, status: a.status === 'posted' ? 'approved' : a.status, decidedBy: a.decided_name, decidedAt: a.decided_at, reason: a.decision_reason,
        canDecide: pending && ctx.can('stock.approve') && a.requested_by !== ctx.userId, link: { path: 'adjustment', params: { id: a.id } } });
    }
  }
  if (ctx.can('transfers.view') || ctx.can('transfers.approve')) {
    const rows = db.prepare(`SELECT t.*, b.name AS to_name, u1.full_name AS requested_name, u2.full_name AS decided_name FROM transfers t JOIN branches b ON b.id = t.to_branch_id
      LEFT JOIN users u1 ON u1.id = t.requested_by LEFT JOIN users u2 ON u2.id = t.decided_by
      WHERE t.from_branch_id = ? AND ${pending ? "t.status = 'requested'" : 't.decided_by IS NOT NULL'} ORDER BY t.created_at DESC ${limit}`).all(branchId);
    for (const t of rows) {
      out.push({ kind: 'transfer', id: t.id, docNo: t.doc_no, summary: `Stock for ${t.to_name}${t.notes ? `: ${t.notes}` : ''}`, amount: null, requestedBy: t.requested_name,
        requestedAt: t.requested_at || t.created_at, status: t.status === 'requested' ? 'pending' : t.status === 'rejected' ? 'rejected' : 'approved', decidedBy: t.decided_name,
        decidedAt: t.decided_at, reason: t.decision_reason, canDecide: pending && ctx.can('transfers.approve'), link: { path: 'transfer', params: { id: t.id } } });
    }
  }
  const at = (x) => (pending ? x.requestedAt : x.decidedAt || x.requestedAt) || '';
  return out.sort((a, b) => at(b).localeCompare(at(a)));
}

function list(ctx, params) {
  const pending = params.status !== 'decided';
  const rows = items(ctx, ctx.branchId, { pending });
  const kinds = params.kind ? rows.filter((r) => r.kind === params.kind) : rows;
  return { rows: kinds, total: kinds.length };
}

// How many waiting items this person could decide (for the bell and the dashboard).
function pendingCount(ctx, branchId = ctx.branchId) {
  return items(ctx, branchId, { pending: true }).filter((x) => x.canDecide).length;
}

function register(define) {
  define('approvals.request', { perm: ['pos.view', 'sales.view', 'expenses.create'] }, request);
  define('approvals.status', { perm: ['pos.view', 'sales.view', 'expenses.create'] }, status);
  define('approvals.cancelRequest', { perm: ['pos.view', 'sales.view', 'expenses.create'] }, cancelRequest);
  define('approvals.list', { perm: ['approvals.view', 'approvals.approve'] }, list);
  define('approvals.decide', { perm: 'approvals.approve' }, decide);
}

module.exports = { register, pendingCount, items };

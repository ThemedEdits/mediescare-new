'use strict';
// Expenses (rent, salaries, bills, tea) and the petty cash book.
// An expense is paid from the drawer of this computer (a cash movement of the open shift), from the petty cash box,
// or by bank, card or online transfer. Above the branch limit it waits for someone with expenses.approve; an expense
// paid from the drawer cannot wait (the cash leaves now), so the screen asks a manager at once instead.
// Expenses are never deleted: a wrong one is cancelled and the money goes back where it came from.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const money = require('../core/money');
const stock = require('../core/stock');
const { nextNo, paging, like } = require('../core/docs');
const settings = require('./settings');
const { openShiftOnDevice } = require('./shifts');
const { useApproval, consumeApproval } = require('./pos');
const { seesAllBranches } = require('./guards');

const METHODS = ['drawer', 'petty', 'bank', 'card', 'online'];
const fmt = (x) => money.format(x, { symbol: '' });

function pettyBalance(db, branchId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM petty_cash WHERE branch_id = ?').get(branchId).b;
}

function drawerShift(ctx) {
  const s = openShiftOnDevice(ctx);
  if (!s || s.branch_id !== ctx.branchId) fail('NO_SHIFT', 'expenses.needShift');
  return s;
}

function cashMove(ctx, shift, kind, amount, reason, refType, refId, at) {
  ctx.db.prepare('INSERT INTO cash_movements (id, branch_id, shift_id, kind, amount, reason, user_id, at, updated_at, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), shift.branch_id, shift.id, kind, amount, reason, ctx.userId, at, at, refType, refId);
}

function pettyEntry(ctx, branchId, { kind, amount, date, expenseId = null, reason = null }) {
  const at = nowIso();
  ctx.db.prepare('INSERT INTO petty_cash (id, branch_id, entry_date, kind, amount, expense_id, reason, user_id, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), branchId, date || stock.today(), kind, amount, expenseId, reason, ctx.userId, at, at);
}

function load(ctx, id) {
  const e = ctx.db.prepare(`SELECT e.*, c.name AS category_name, u1.full_name AS requested_name, u2.full_name AS decided_name, u3.full_name AS cancelled_name, b.name AS branch_name
    FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users u1 ON u1.id = e.requested_by LEFT JOIN users u2 ON u2.id = e.decided_by LEFT JOIN users u3 ON u3.id = e.cancelled_by WHERE e.id = ?`).get(id || '');
  if (!e) fail('NOT_FOUND', 'error.notFound', { thing: 'expense' });
  if (e.branch_id !== ctx.branchId && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
  return e;
}

function shape(e) {
  return {
    id: e.id, docNo: e.doc_no, branchId: e.branch_id, branchName: e.branch_name, date: e.expense_date, categoryId: e.category_id, categoryName: e.category_name,
    description: e.description, paidTo: e.paid_to, amount: e.amount, method: e.method, reference: e.reference, status: e.status,
    requestedBy: e.requested_name, requestedById: e.requested_by, decidedBy: e.decided_name, decidedAt: e.decided_at, decisionReason: e.decision_reason,
    cancelledBy: e.cancelled_name, cancelledAt: e.cancelled_at, cancelReason: e.cancel_reason, createdAt: e.created_at,
  };
}

// Money leaves (drawer, petty box) when an expense is posted. Called inside the transaction.
function payOut(ctx, e, shift) {
  if (e.method === 'drawer') cashMove(ctx, shift, 'out', e.amount, `Expense ${e.doc_no}: ${e.description}`, 'expense', e.id, nowIso());
  if (e.method === 'petty') {
    const bal = pettyBalance(ctx.db, e.branch_id);
    if (bal < e.amount) fail('VALIDATION', 'expenses.pettyShort', { balance: fmt(bal), amount: fmt(e.amount) });
    pettyEntry(ctx, e.branch_id, { kind: 'expense', amount: -e.amount, date: e.expense_date, expenseId: e.id, reason: e.description });
  }
}

function create(ctx, params) {
  const db = ctx.db;
  const date = v.date(params, 'date', 'Date', { required: true });
  if (date > stock.today()) invalid('date', 'expenses.future');
  const categoryId = v.id(params, 'categoryId', 'Category');
  const cat = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(categoryId);
  if (!cat || !cat.active) invalid('categoryId', 'error.invalid', { field: 'Category' });
  const description = v.text(params, 'description', 'Description', { required: true, max: 200 });
  const paidTo = v.text(params, 'paidTo', 'Paid to', { max: 120 });
  const amount = v.money(params, 'amount', 'Amount', { required: true, min: 1 });
  const method = v.oneOf(params, 'method', 'Paid from', METHODS);
  const reference = v.text(params, 'reference', 'Reference', { max: 60 });
  if ((method === 'bank' || method === 'online') && !reference) invalid('reference', 'expenses.needsReference');
  const limit = settings.get(db, 'expenses.approvalValue', ctx.branchId) * 100;
  let approval = null;
  let pending = false;
  if (limit > 0 && amount > limit && !ctx.can('expenses.approve')) {
    approval = useApproval(ctx, params.approvalToken);
    if (!approval || !approval.can('expenses.approve')) {
      // Cash from the drawer leaves now, so a manager must approve now; other methods wait in the approval queue.
      if (method === 'drawer') fail('NEEDS_APPROVAL', 'expenses.needsApproval', { amount: fmt(amount) }, { needs: ['expenses.approve'] });
      approval = null;
      pending = true;
    }
  }
  const shift = method === 'drawer' ? drawerShift(ctx) : null;
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    const docNo = nextNo(ctx, 'EXP');
    const decidedBy = pending ? null : approval ? approval.userId : ctx.userId;
    db.prepare(`INSERT INTO expenses (id, branch_id, doc_no, expense_date, category_id, description, paid_to, amount, method, reference, shift_id, status,
        requested_by, decided_by, decided_at, decision_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.branchId, docNo, date, categoryId, description, paidTo, amount, method, reference, shift ? shift.id : null, pending ? 'pending' : 'posted',
        ctx.userId, decidedBy, pending ? null : now, approval ? approval.reason : null, now, now);
    if (!pending) payOut(ctx, db.prepare('SELECT * FROM expenses WHERE id = ?').get(id), shift);
    audit.write(db, ctx.actor, { module: 'expenses', action: pending ? 'request' : 'create', recordType: 'expense', recordId: id,
      summary: `Expense ${docNo} ${fmt(amount)} (${cat.name}, ${method})${pending ? ' waiting for approval' : ''}${approval ? `, approved by ${approval.name}` : ''}`,
      new: { date, category: cat.name, description, amount, method } });
    consumeApproval(ctx, approval, docNo);
  })();
  return shape(load(ctx, id));
}

function decide(ctx, params) {
  const e = load(ctx, v.id(params, 'id', 'Expense'));
  if (e.status !== 'pending') fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'expense', status: e.status });
  if (e.requested_by === ctx.userId) fail('FORBIDDEN', 'approvals.notOwn');
  const approve = v.bool(params, 'approve');
  const reason = v.text(params, 'reason', 'Reason', { required: !approve, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE expenses SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ? WHERE id = ?')
      .run(approve ? 'posted' : 'rejected', ctx.userId, now, reason, now, e.id);
    if (approve) payOut(ctx, e, null);
    audit.write(ctx.db, ctx.actor, { module: 'expenses', action: approve ? 'approve' : 'reject', recordType: 'expense', recordId: e.id, branchId: e.branch_id,
      summary: `Expense ${e.doc_no} ${fmt(e.amount)} ${approve ? 'approved' : 'rejected'}`, reason });
  })();
  return shape(load(ctx, e.id));
}

function cancel(ctx, params) {
  const e = load(ctx, v.id(params, 'id', 'Expense'));
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  if (e.status === 'pending') {
    if (e.requested_by !== ctx.userId && !ctx.can('expenses.approve')) fail('FORBIDDEN', 'error.noPermission');
  } else if (e.status !== 'posted') {
    fail('WRONG_STATUS', 'error.wrongStatus', { thing: 'expense', status: e.status });
  } else if (!ctx.can('expenses.edit')) {
    fail('FORBIDDEN', 'error.noPermission');
  }
  // Cash goes back into the drawer of this computer (the shift it came from may be closed by now).
  const shift = e.status === 'posted' && e.method === 'drawer' ? drawerShift(ctx) : null;
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE expenses SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, e.id);
    if (e.status === 'posted' && e.method === 'drawer') cashMove(ctx, shift, 'in', e.amount, `Expense ${e.doc_no} cancelled`, 'expense', e.id, now);
    if (e.status === 'posted' && e.method === 'petty') pettyEntry(ctx, e.branch_id, { kind: 'expense_cancel', amount: e.amount, expenseId: e.id, reason });
    audit.write(ctx.db, ctx.actor, { module: 'expenses', action: 'cancel', recordType: 'expense', recordId: e.id, branchId: e.branch_id, summary: `Expense ${e.doc_no} ${fmt(e.amount)} cancelled`, reason });
  })();
  return shape(load(ctx, e.id));
}

// This branch, or another / all branches for people who see every branch; anyone else asking for another branch is refused.
function branchFilter(ctx, params, alias) {
  const b = require('./finance').scope(ctx, params);
  return b ? { sql: `${alias}.branch_id = @branch`, args: { branch: b } } : { sql: '1 = 1', args: {} };
}

function list(ctx, params) {
  const bf = branchFilter(ctx, params, 'e');
  const where = [bf.sql];
  const args = { ...bf.args };
  if (params.from) { where.push('e.expense_date >= @from'); args.from = String(params.from); }
  if (params.to) { where.push('e.expense_date <= @to'); args.to = String(params.to); }
  if (params.categoryId) { where.push('e.category_id = @cat'); args.cat = String(params.categoryId); }
  if (params.method) { where.push('e.method = @method'); args.method = String(params.method); }
  if (params.status) { where.push('e.status = @status'); args.status = String(params.status); }
  if (params.q) { where.push("(e.description LIKE @q ESCAPE '\\' OR e.paid_to LIKE @q ESCAPE '\\' OR e.doc_no LIKE @q ESCAPE '\\')"); args.q = like(params.q); }
  const pg = paging(params);
  const sql = `FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users u1 ON u1.id = e.requested_by LEFT JOIN users u2 ON u2.id = e.decided_by LEFT JOIN users u3 ON u3.id = e.cancelled_by WHERE ${where.join(' AND ')}`;
  const totals = ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN e.status = 'posted' THEN e.amount END), 0) AS posted,
    COALESCE(SUM(CASE WHEN e.status = 'pending' THEN e.amount END), 0) AS pending ${sql}`).get(args);
  const rows = ctx.db.prepare(`SELECT e.*, c.name AS category_name, b.name AS branch_name, u1.full_name AS requested_name, u2.full_name AS decided_name, u3.full_name AS cancelled_name
    ${sql} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  return { rows: rows.map(shape), total: totals.n, page: pg.page, pageSize: pg.pageSize, totals: { posted: totals.posted, pending: totals.pending } };
}

// The petty cash book: opening balance, every entry with a running balance, closing balance.
function book(ctx, params) {
  const bf = branchFilter(ctx, { branchId: params.branchId === 'all' ? null : params.branchId }, 'p');
  const from = v.date(params, 'from', 'From') || '0000-01-01';
  const to = v.date(params, 'to', 'To') || '9999-12-31';
  const opening = ctx.db.prepare(`SELECT COALESCE(SUM(amount), 0) AS b FROM petty_cash p WHERE ${bf.sql} AND p.entry_date < @from`).get({ ...bf.args, from }).b;
  const rows = ctx.db.prepare(`SELECT p.*, u.full_name, e.doc_no, e.description AS expense_description, c.name AS category_name FROM petty_cash p LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN expenses e ON e.id = p.expense_id LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE ${bf.sql} AND p.entry_date >= @from AND p.entry_date <= @to ORDER BY p.entry_date, p.at`).all({ ...bf.args, from, to });
  let running = opening;
  const entries = rows.map((p) => {
    running += p.amount;
    return {
      id: p.id, date: p.entry_date, at: p.at, kind: p.kind, docNo: p.doc_no, expenseId: p.expense_id, category: p.category_name,
      description: p.expense_description || p.reason, moneyIn: p.amount > 0 ? p.amount : 0, moneyOut: p.amount < 0 ? -p.amount : 0, balance: running, user: p.full_name,
    };
  });
  return { opening, entries, closing: running, balance: pettyBalance(ctx.db, bf.args.branch || ctx.branchId) };
}

// Put money in the petty cash box (from the drawer of this computer, or from outside) or take it back out.
function pettyMove(ctx, params) {
  const kind = v.oneOf(params, 'kind', 'Type', ['topup', 'withdraw']);
  const amount = v.money(params, 'amount', 'Amount', { required: true, min: 1 });
  const viaDrawer = v.bool(params, 'viaDrawer');
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 200 });
  const bal = pettyBalance(ctx.db, ctx.branchId);
  if (kind === 'withdraw' && amount > bal) fail('VALIDATION', 'expenses.pettyShort', { balance: fmt(bal), amount: fmt(amount) });
  const shift = viaDrawer ? drawerShift(ctx) : null;
  ctx.db.transaction(() => {
    pettyEntry(ctx, ctx.branchId, { kind, amount: kind === 'topup' ? amount : -amount, reason: viaDrawer ? `${reason} (${kind === 'topup' ? 'from' : 'to'} the drawer)` : reason });
    if (shift) cashMove(ctx, shift, kind === 'topup' ? 'out' : 'in', amount, `Petty cash: ${reason}`, 'petty', null, nowIso());
    audit.write(ctx.db, ctx.actor, { module: 'expenses', action: kind === 'topup' ? 'petty_topup' : 'petty_withdraw', recordType: 'petty_cash', recordId: ctx.branchId,
      summary: `Petty cash ${kind === 'topup' ? 'top-up' : 'withdrawal'} ${fmt(amount)}${viaDrawer ? ' through the drawer' : ''}`, reason });
  })();
  return book(ctx, { from: stock.today(), to: stock.today() });
}

function categories(ctx, params) {
  const rows = ctx.db.prepare(`SELECT * FROM expense_categories ${params && params.active ? 'WHERE active = 1' : ''} ORDER BY name COLLATE NOCASE`).all();
  return rows.map((c) => ({ id: c.id, name: c.name, active: c.active === 1 }));
}

function saveCategory(ctx, params) {
  const name = v.text(params, 'name', 'Name', { required: true, max: 80 });
  const active = params.active === undefined ? true : v.bool(params, 'active');
  const id = params.id ? v.id(params, 'id', 'Category') : null;
  const clash = ctx.db.prepare('SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, id || '');
  if (clash) invalid('name', 'error.duplicate', { thing: 'category', field: 'name' });
  const now = nowIso();
  ctx.db.transaction(() => {
    if (id) {
      const old = ctx.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
      if (!old) fail('NOT_FOUND', 'error.notFound', { thing: 'category' });
      ctx.db.prepare('UPDATE expense_categories SET name = ?, active = ?, updated_at = ? WHERE id = ?').run(name, active ? 1 : 0, now, id);
      const d = audit.diff({ name: old.name, active: old.active === 1 }, { name, active });
      if (d.changed) audit.write(ctx.db, ctx.actor, { module: 'expenses', action: 'category_update', recordType: 'expense_category', recordId: id, summary: `Expense category ${name} changed`, old: d.old, new: d.new });
    } else {
      const nid = newId();
      ctx.db.prepare('INSERT INTO expense_categories (id, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(nid, name, active ? 1 : 0, now, now);
      audit.write(ctx.db, ctx.actor, { module: 'expenses', action: 'category_create', recordType: 'expense_category', recordId: nid, summary: `Expense category ${name} added` });
    }
  })();
  return categories(ctx, {});
}

function register(define) {
  define('expenses.categories', { perm: ['expenses.view', 'expenses.create'] }, categories);
  define('expenses.saveCategory', { perm: 'expenses.edit' }, saveCategory);
  define('expenses.list', { perm: 'expenses.view' }, list);
  define('expenses.get', { perm: 'expenses.view' }, (ctx, params) => shape(load(ctx, v.id(params, 'id', 'Expense'))));
  define('expenses.create', { perm: 'expenses.create' }, create);
  define('expenses.decide', { perm: 'expenses.approve' }, decide);
  define('expenses.cancel', { perm: ['expenses.edit', 'expenses.create'] }, cancel);
  define('pettycash.book', { perm: 'expenses.view' }, book);
  define('pettycash.move', { perm: 'expenses.create' }, pettyMove);
}

module.exports = { register, pettyBalance, METHODS };

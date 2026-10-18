'use strict';
// Cashier shifts: open with a cash float, cash in and out with a reason, X report (so far), close with the counted
// cash and the over or short amount (Z report). One open shift per computer; the person who opened it sells on it.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const money = require('../core/money');
const { nextNo, paging } = require('../core/docs');
const settings = require('./settings');
const { seesAllBranches } = require('./guards');

function deviceId(ctx) {
  return ctx.app.device.id;
}

function openShiftOnDevice(ctx) {
  return ctx.db.prepare(`SELECT s.*, u.username, u.full_name FROM shifts s JOIN users u ON u.id = s.user_id
    WHERE s.device_id = ? AND s.status = 'open'`).get(deviceId(ctx)) || null;
}

// The shift a sale or refund goes to. When shifts are required, the seller must have the open shift here.
function shiftForSale(ctx) {
  const s = openShiftOnDevice(ctx);
  const required = settings.get(ctx.db, 'pos.requireShift', ctx.branchId);
  if (s && s.user_id === ctx.userId && s.branch_id === ctx.branchId) return s;
  if (!required) return null;
  if (s && s.user_id !== ctx.userId) fail('NO_SHIFT', 'pos.shiftOther', { user: s.full_name });
  fail('NO_SHIFT', 'pos.noShift');
  return null;
}

// Money paid back (void, return) leaves the drawer of this computer, whoever's shift it is.
function shiftForRefund(ctx) {
  const s = openShiftOnDevice(ctx);
  if (s && s.branch_id === ctx.branchId) return s;
  if (settings.get(ctx.db, 'pos.requireShift', ctx.branchId)) fail('NO_SHIFT', 'pos.noShift');
  return null;
}

// Every number of a shift report, worked out from the records (never stored totals).
function summary(db, shift) {
  const pay = db.prepare(`SELECT kind, method, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM sale_payments WHERE shift_id = ? GROUP BY kind, method`).all(shift.id);
  const by = (kind, method) => pay.filter((p) => p.kind === kind && (!method || p.method === method)).reduce((a, p) => a + p.amount, 0);
  const sales = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(gross), 0) AS gross,
      COALESCE(SUM(line_discount + bill_discount), 0) AS discount, COALESCE(SUM(tax), 0) AS tax, COALESCE(SUM(credit_amount), 0) AS credit,
      COALESCE(SUM(change_given), 0) AS change_given FROM sales WHERE shift_id = ? AND status = 'completed'`).get(shift.id);
  const voided = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM sales WHERE shift_id = ? AND status = 'voided'`).get(shift.id);
  const returns = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM sale_returns WHERE shift_id = ?').get(shift.id);
  const moves = db.prepare("SELECT kind, COALESCE(SUM(amount), 0) AS amount FROM cash_movements WHERE shift_id = ? GROUP BY kind").all(shift.id);
  const cashIn = (moves.find((m) => m.kind === 'in') || { amount: 0 }).amount;
  const cashOut = (moves.find((m) => m.kind === 'out') || { amount: 0 }).amount;
  // Voided bills record their refunds as kind 'refund', so the drawer figure below already nets them out.
  const expectedCash = shift.opening_cash + by('sale', 'cash') + by('receipt', 'cash') - by('refund', 'cash') + cashIn - cashOut;
  const methods = ['cash', 'card', 'easypaisa', 'jazzcash', 'bank'].map((m) => ({
    method: m, sales: by('sale', m), receipts: by('receipt', m), refunds: by('refund', m), net: by('sale', m) + by('receipt', m) - by('refund', m),
  }));
  return {
    bills: sales.n, salesTotal: sales.total, gross: sales.gross, discount: sales.discount, tax: sales.tax, creditSales: sales.credit,
    changeGiven: sales.change_given, voided: { count: voided.n, total: voided.total }, returns: { count: returns.n, total: returns.total },
    receipts: by('receipt'), refunds: by('refund'), cashIn, cashOut, openingCash: shift.opening_cash, expectedCash, methods,
  };
}

function shiftReportHtml(ctx, sh) {
  const sum = summary(ctx.db, sh);
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get();
  const branch = ctx.db.prepare('SELECT name FROM branches WHERE id = ?').get(sh.branch_id);
  const m = (x) => money.format(x, { symbol: '' });
  const esc = (x) => String(x === null || x === undefined ? '' : x).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const row = (k, val) => `<tr><td>${esc(k)}</td><td class="n">${esc(val)}</td></tr>`;
  const when = (iso) => new Date(iso).toLocaleString('en-GB');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: 80mm auto; margin: 2mm; }
    body { font: 9.5pt Arial, sans-serif; width: 74mm; margin: 0 auto; } h1 { font-size: 12pt; text-align: center; margin: 0; }
    table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; } .n { text-align: right; } hr { border: 0; border-top: 1px dashed #000; }</style></head><body>
    <h1>${esc(org.name)}</h1><div style="text-align:center">${esc(branch.name)}<br><strong>${sh.status === 'open' ? 'X REPORT (shift still open)' : 'Z REPORT (shift closed)'}</strong></div><hr>
    <table>${row('Shift', sh.doc_no)}${row('Cashier', sh.full_name)}${row('Opened', when(sh.opened_at))}${sh.closed_at ? row('Closed', when(sh.closed_at)) : ''}</table><hr>
    <table>${row('Bills', sum.bills)}${row('Sales total', m(sum.salesTotal))}${row('Discounts', m(sum.discount))}${row('Tax included', m(sum.tax))}${row('Sold on account', m(sum.creditSales))}
    ${row('Cancelled bills', `${sum.voided.count} / ${m(sum.voided.total)}`)}${row('Returns', `${sum.returns.count} / ${m(sum.returns.total)}`)}</table><hr>
    <table>${sum.methods.filter((x) => x.sales || x.receipts || x.refunds).map((x) => row(`${x.method} (net)`, m(x.net))).join('')}</table><hr>
    <table>${row('Opening cash', m(sum.openingCash))}${row('Cash in', m(sum.cashIn))}${row('Cash out', m(sum.cashOut))}${row('Expected in drawer', m(sum.expectedCash))}
    ${sh.status === 'closed' ? row('Counted', m(sh.counted_cash)) + row(sh.over_short >= 0 ? 'Over' : 'Short', m(Math.abs(sh.over_short))) : ''}</table>
    ${sh.close_notes ? `<hr><div>${esc(sh.close_notes)}</div>` : ''}<hr><div style="text-align:center">Printed ${esc(when(new Date().toISOString()))}</div></body></html>`;
}

function shape(ctx, s, withSummary) {
  const out = {
    id: s.id, docNo: s.doc_no, branchId: s.branch_id, deviceId: s.device_id, userId: s.user_id, userName: s.full_name || s.username, status: s.status,
    openedAt: s.opened_at, openingCash: s.opening_cash, closedAt: s.closed_at, expectedCash: s.expected_cash, countedCash: s.counted_cash,
    overShort: s.over_short, closeNotes: s.close_notes, mine: s.user_id === ctx.userId,
  };
  if (withSummary) {
    out.summary = summary(ctx.db, s);
    out.movements = ctx.db.prepare('SELECT m.*, u.username FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.shift_id = ? ORDER BY m.at').all(s.id)
      .map((m) => ({ id: m.id, kind: m.kind, amount: m.amount, reason: m.reason, at: m.at, username: m.username }));
  }
  return out;
}

function load(ctx, id) {
  const s = ctx.db.prepare('SELECT s.*, u.username, u.full_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
  if (!s) fail('NOT_FOUND', 'error.notFound', { thing: 'shift' });
  if (s.branch_id !== ctx.branchId && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
  return s;
}

function register(define) {
  define('shifts.current', { perm: ['pos.view', 'shifts.view'] }, (ctx) => {
    const s = openShiftOnDevice(ctx);
    return { shift: s ? shape(ctx, s, true) : null, required: settings.get(ctx.db, 'pos.requireShift', ctx.branchId) };
  });

  define('shifts.open', { perm: 'shifts.create' }, (ctx, params) => {
    const existing = openShiftOnDevice(ctx);
    if (existing) fail('IN_USE', existing.user_id === ctx.userId ? 'pos.shiftOpen' : 'pos.shiftOther', { user: existing.full_name });
    const opening = v.money(params, 'openingCash', 'Opening cash', { fallback: 0 });
    const id = newId();
    const now = nowIso();
    ctx.db.transaction(() => {
      const docNo = nextNo(ctx, 'SHF');
      ctx.db.prepare(`INSERT INTO shifts (id, branch_id, device_id, doc_no, user_id, status, opened_at, opening_cash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).run(id, ctx.branchId, deviceId(ctx), docNo, ctx.userId, now, opening, now, now);
      audit.write(ctx.db, ctx.actor, { module: 'shifts', action: 'open', recordType: 'shift', recordId: id, summary: `Shift ${docNo} opened with ${money.format(opening, { symbol: '' })} cash` });
    })();
    return shape(ctx, load(ctx, id), true);
  });

  define('shifts.cashMove', { perm: 'shifts.create' }, (ctx, params) => {
    const s = openShiftOnDevice(ctx);
    if (!s) fail('NO_SHIFT', 'pos.noShift');
    if (s.user_id !== ctx.userId && !ctx.can('shifts.approve')) fail('FORBIDDEN', 'pos.shiftNotYours', { user: s.full_name });
    const kind = v.oneOf(params, 'kind', 'Type', ['in', 'out']);
    const amount = v.money(params, 'amount', 'Amount', { required: true, min: 1 });
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    const now = nowIso();
    ctx.db.transaction(() => {
      const id = newId();
      ctx.db.prepare('INSERT INTO cash_movements (id, branch_id, shift_id, kind, amount, reason, user_id, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, s.branch_id, s.id, kind, amount, reason, ctx.userId, now, now);
      audit.write(ctx.db, ctx.actor, { module: 'shifts', action: kind === 'in' ? 'cash_in' : 'cash_out', recordType: 'shift', recordId: s.id, summary: `Cash ${kind} ${money.format(amount, { symbol: '' })} on shift ${s.doc_no}`, reason });
    })();
    return shape(ctx, load(ctx, s.id), true);
  });

  define('shifts.close', { perm: 'shifts.create' }, (ctx, params) => {
    const s = load(ctx, v.id(params, 'id', 'Shift'));
    if (s.status !== 'open') fail('WRONG_STATUS', 'pos.shiftClosed');
    if (s.user_id !== ctx.userId && !ctx.can('shifts.approve')) fail('FORBIDDEN', 'pos.shiftNotYours', { user: s.full_name });
    const counted = v.money(params, 'countedCash', 'Cash counted in the drawer', { required: true });
    const notes = v.text(params, 'notes', 'Notes', { max: 500 });
    const sum = summary(ctx.db, s);
    const overShort = counted - sum.expectedCash;
    if (overShort !== 0 && !notes) invalid('notes', 'error.required', { field: 'A note explaining the difference' });
    const now = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare(`UPDATE shifts SET status = 'closed', closed_at = ?, closed_by = ?, expected_cash = ?, counted_cash = ?, over_short = ?, close_notes = ?, updated_at = ? WHERE id = ?`)
        .run(now, ctx.userId, sum.expectedCash, counted, overShort, notes, now, s.id);
      audit.write(ctx.db, ctx.actor, { module: 'shifts', action: 'close', recordType: 'shift', recordId: s.id,
        summary: `Shift ${s.doc_no} closed: expected ${money.format(sum.expectedCash, { symbol: '' })}, counted ${money.format(counted, { symbol: '' })}, ${overShort === 0 ? 'exact' : overShort > 0 ? 'over ' + money.format(overShort, { symbol: '' }) : 'short ' + money.format(-overShort, { symbol: '' })}`,
        new: { expected: sum.expectedCash, counted, overShort }, reason: notes });
    })();
    return shape(ctx, load(ctx, s.id), true);
  });

  define('shifts.get', { perm: ['shifts.view', 'pos.view'] }, (ctx, params) => {
    const s = load(ctx, v.id(params, 'id', 'Shift'));
    if (s.user_id !== ctx.userId && !ctx.can('shifts.approve') && !ctx.can('reports.financial')) fail('FORBIDDEN', 'error.noPermission');
    return shape(ctx, s, true);
  });

  // X report (shift still open) or Z report (closed), printed on the receipt printer.
  define('shifts.print', { perm: ['shifts.view', 'pos.view'] }, async (ctx, params) => {
    const sh = load(ctx, v.id(params, 'id', 'Shift'));
    if (sh.user_id !== ctx.userId && !ctx.can('shifts.approve') && !ctx.can('reports.financial')) fail('FORBIDDEN', 'error.noPermission');
    return ctx.app.printHtml(shiftReportHtml(ctx, sh), { title: sh.doc_no });
  });

  define('shifts.list', { perm: 'shifts.view' }, (ctx, params) => {
    const where = ['s.branch_id = @branch'];
    const args = { branch: ctx.branchId };
    // Cashiers see their own shifts; managers see everyone's.
    if (!ctx.can('shifts.approve') && !ctx.can('reports.financial')) { where.push('s.user_id = @me'); args.me = ctx.userId; }
    if (params.status) { where.push('s.status = @status'); args.status = params.status; }
    if (params.userId) { where.push('s.user_id = @user'); args.user = params.userId; }
    if (params.from) { where.push('s.opened_at >= @from'); args.from = params.from; }
    if (params.to) { where.push('s.opened_at < @to'); args.to = params.to; }
    const pg = paging(params);
    const sql = `FROM shifts s JOIN users u ON u.id = s.user_id WHERE ${where.join(' AND ')}`;
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(args).n;
    const rows = ctx.db.prepare(`SELECT s.*, u.username, u.full_name ${sql} ORDER BY s.opened_at DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
    return { rows: rows.map((s) => ({ ...shape(ctx, s, false), salesTotal: summary(ctx.db, s).salesTotal })), total, page: pg.page, pageSize: pg.pageSize };
  });
}

module.exports = { register, shiftForSale, shiftForRefund, openShiftOnDevice, summary };

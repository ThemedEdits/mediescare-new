'use strict';
// Suppliers: profile, account (ledger and statement), open bills with ageing, purchase history and price comparison.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const { nextNo, canSeeCost, like } = require('../core/docs');
const { seesAllBranches } = require('./guards');

const FIELDS = ['code', 'name', 'contact_person', 'phone', 'email', 'address', 'city', 'licence_no', 'ntn', 'strn', 'payment_terms_days', 'credit_limit', 'contacts', 'notes'];

function readForm(ctx, params, existing) {
  const f = {
    code: v.text(params, 'code', 'Supplier code', { max: 20 }),
    name: v.text(params, 'name', 'Company name', { required: true, max: 120 }),
    contact_person: v.text(params, 'contactPerson', 'Contact person', { max: 120 }),
    phone: v.text(params, 'phone', 'Phone', { max: 40 }),
    email: v.email(params, 'email'),
    address: v.text(params, 'address', 'Address', { max: 300 }),
    city: v.text(params, 'city', 'City', { max: 60 }),
    licence_no: v.text(params, 'licenceNo', 'Licence number', { max: 60 }),
    ntn: v.text(params, 'ntn', 'NTN', { max: 40 }),
    strn: v.text(params, 'strn', 'STRN', { max: 40 }),
    payment_terms_days: v.int(params, 'paymentTermsDays', 'Payment terms (days)', { min: 0, max: 365, fallback: 0 }),
    credit_limit: v.money(params, 'creditLimit', 'Credit limit', { fallback: 0 }),
    notes: v.text(params, 'notes', 'Notes', { max: 1000 }),
  };
  const contacts = Array.isArray(params.contacts) ? params.contacts : [];
  f.contacts = JSON.stringify(contacts.slice(0, 20).map((c) => ({
    name: v.text(c, 'name', 'Contact name', { max: 120 }), role: v.text(c, 'role', 'Role', { max: 60 }), phone: v.text(c, 'phone', 'Phone', { max: 40 }), email: v.email(c, 'email'),
  })).filter((c) => c.name || c.phone));
  if (f.code) {
    f.code = f.code.toUpperCase();
    if (!/^[A-Z0-9-]{2,20}$/.test(f.code)) invalid('code', 'error.invalid', { field: 'Supplier code' });
    if (ctx.db.prepare('SELECT 1 FROM suppliers WHERE code = ? COLLATE NOCASE AND id <> ?').get(f.code, existing ? existing.id : '')) invalid('code', 'error.duplicate', { thing: 'supplier', field: 'code' });
  }
  return f;
}

// Creates a supplier inside the caller's transaction. Shared with the importer.
function insertSupplier(ctx, f, opening) {
  const id = newId();
  const now = nowIso();
  f.code = f.code || nextNo(ctx, 'SUP');
  ctx.db.prepare(`INSERT INTO suppliers (id, ${FIELDS.join(', ')}, active, created_by, created_at, updated_at)
    VALUES (@id, ${FIELDS.map((k) => '@' + k).join(', ')}, 1, @by, @now, @now)`).run({ ...f, id, by: ctx.userId, now });
  if (opening > 0) {
    ctx.db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, credit, description, user_id, at, updated_at)
      VALUES (?, ?, ?, ?, 'opening', 'supplier', ?, ?, 'Opening balance', ?, ?, ?)`).run(newId(), ctx.branchId, id, stock.today(), id, opening, ctx.userId, now, now);
  }
  audit.write(ctx.db, ctx.actor, { module: 'suppliers', action: 'create', recordType: 'supplier', recordId: id, branchId: null, summary: `Supplier ${f.name} (${f.code}) created`, new: { ...f, opening_balance: opening } });
  return id;
}

// Writes an edit inside the caller's transaction. Shared with the importer.
function applySupplierUpdate(ctx, s, f) {
  const change = audit.diff(Object.fromEntries(FIELDS.map((k) => [k, s[k]])), f);
  if (!change.changed) return false;
  ctx.db.prepare(`UPDATE suppliers SET ${FIELDS.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`).run({ ...f, id: s.id, now: nowIso() });
  audit.write(ctx.db, ctx.actor, { module: 'suppliers', action: 'update', recordType: 'supplier', recordId: s.id, branchId: null, summary: `Supplier ${f.name} changed`, old: change.old, new: change.new });
  return true;
}

function balanceOf(db, supplierId, branchId) {
  const sql = branchId
    ? 'SELECT COALESCE(SUM(credit - debit), 0) AS b FROM supplier_ledger WHERE supplier_id = ? AND branch_id = ?'
    : 'SELECT COALESCE(SUM(credit - debit), 0) AS b FROM supplier_ledger WHERE supplier_id = ?';
  return branchId ? db.prepare(sql).get(supplierId, branchId).b : db.prepare(sql).get(supplierId).b;
}

// Which branch's account to show: the active branch, or every branch for Head Office users who ask for it.
function scopeBranch(ctx, params) {
  if (params.branchId === 'all' && seesAllBranches(ctx)) return null;
  if (params.branchId && params.branchId !== ctx.branchId) {
    if (!seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
    return params.branchId;
  }
  return ctx.branchId;
}

function shape(ctx, s, branchId) {
  const out = {
    id: s.id, code: s.code, name: s.name, contactPerson: s.contact_person, phone: s.phone, email: s.email, address: s.address, city: s.city,
    licenceNo: s.licence_no, ntn: s.ntn, strn: s.strn, paymentTermsDays: s.payment_terms_days, creditLimit: s.credit_limit,
    contacts: JSON.parse(s.contacts || '[]'), notes: s.notes, active: s.active === 1, updatedAt: s.updated_at,
  };
  if (canSeeCost(ctx)) out.balance = balanceOf(ctx.db, s.id, branchId);
  else out.balance = null;
  return out;
}

function load(db, id) {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) fail('NOT_FOUND', 'error.notFound', { thing: 'supplier' });
  return s;
}

// Bills (posted goods receipts) with what is still unpaid, oldest first.
function openBills(db, supplierId, branchId) {
  const where = branchId ? 'AND g.branch_id = @branch' : '';
  return db.prepare(`SELECT g.id, g.doc_no, g.branch_id, g.supplier_invoice_no, g.received_date, g.due_date, g.total,
      COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
        WHERE a.grn_id = g.id AND p.status = 'posted'), 0) AS paid
    FROM grns g WHERE g.supplier_id = @supplier AND g.status = 'posted' ${where}
    ORDER BY g.received_date, g.doc_no`).all({ supplier: supplierId, branch: branchId })
    .map((b) => ({ id: b.id, docNo: b.doc_no, branchId: b.branch_id, invoiceNo: b.supplier_invoice_no, date: b.received_date, dueDate: b.due_date || b.received_date, total: b.total, paid: b.paid, due: b.total - b.paid }))
    .filter((b) => b.due > 0);
}

// Ageing of open bills by days past due. Credits not allocated to a bill (returns, unallocated payments) are shown
// separately so the buckets plus credits always equal the account balance.
function ageing(db, supplierId, branchId, onDate = stock.today()) {
  const bills = openBills(db, supplierId, branchId);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const dayMs = 86400000;
  for (const b of bills) {
    const late = Math.floor((Date.parse(onDate) - Date.parse(b.dueDate)) / dayMs);
    b.daysOverdue = Math.max(late, 0);
    if (late <= 0) buckets.current += b.due;
    else if (late <= 30) buckets.d1_30 += b.due;
    else if (late <= 60) buckets.d31_60 += b.due;
    else if (late <= 90) buckets.d61_90 += b.due;
    else buckets.d90plus += b.due;
  }
  const billsDue = bills.reduce((a, b) => a + b.due, 0);
  const balance = balanceOf(db, supplierId, branchId);
  return { bills, buckets, billsDue, unallocatedCredit: billsDue - balance, balance };
}

function statement(ctx, params) {
  const s = load(ctx.db, v.id(params, 'id'));
  const branchId = scopeBranch(ctx, params);
  const from = v.date(params, 'from', 'From date');
  const to = v.date(params, 'to', 'To date');
  const args = { s: s.id, b: branchId, from, to };
  const bWhere = branchId ? 'AND l.branch_id = @b' : '';
  const opening = from ? ctx.db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS x FROM supplier_ledger l WHERE supplier_id = @s ${bWhere} AND entry_date < @from`).get(args).x : 0;
  const rows = ctx.db.prepare(`SELECT l.*, br.name AS branch_name FROM supplier_ledger l LEFT JOIN branches br ON br.id = l.branch_id
    WHERE l.supplier_id = @s ${bWhere} ${from ? 'AND l.entry_date >= @from' : ''} ${to ? 'AND l.entry_date <= @to' : ''}
    ORDER BY l.entry_date, l.at, l.id`).all(args);
  let running = opening;
  const entries = rows.map((r) => {
    running += r.credit - r.debit;
    return { id: r.id, date: r.entry_date, type: r.entry_type, refType: r.ref_type, refId: r.ref_id, refNo: r.ref_no, description: r.description, debit: r.debit, credit: r.credit, balance: running, branchName: r.branch_name, dueDate: r.due_date };
  });
  return { supplier: shape(ctx, s, branchId), opening, entries, closing: running, from, to };
}

function register(define) {
  define('suppliers.list', { perm: ['suppliers.view', 'purchases.view', 'products.view'] }, (ctx, params) => {
    const where = [];
    const args = {};
    if (!params.includeInactive) where.push('active = 1');
    if (params.search) { where.push("(name LIKE @q ESCAPE '\\' OR code LIKE @q ESCAPE '\\' OR phone LIKE @q ESCAPE '\\' OR city LIKE @q ESCAPE '\\')"); args.q = like(params.search); }
    const rows = ctx.db.prepare(`SELECT * FROM suppliers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name COLLATE NOCASE`).all(args);
    const branchId = scopeBranch(ctx, params);
    return rows.map((s) => shape(ctx, s, branchId));
  });

  define('suppliers.get', { perm: 'suppliers.view' }, (ctx, params) => {
    const s = load(ctx.db, v.id(params, 'id'));
    const branchId = scopeBranch(ctx, params);
    const out = shape(ctx, s, branchId);
    if (canSeeCost(ctx)) out.ageing = ageing(ctx.db, s.id, branchId);
    return out;
  });

  define('suppliers.create', { perm: 'suppliers.create' }, (ctx, params) => {
    const f = readForm(ctx, params, null);
    const opening = canSeeCost(ctx) ? v.money(params, 'openingBalance', 'Opening balance', { fallback: 0 }) : 0;
    let id;
    ctx.db.transaction(() => { id = insertSupplier(ctx, f, opening); })();
    return shape(ctx, load(ctx.db, id), ctx.branchId);
  });

  define('suppliers.update', { perm: 'suppliers.edit' }, (ctx, params) => {
    const s = load(ctx.db, v.id(params, 'id'));
    const f = readForm(ctx, params, s);
    f.code = f.code || s.code;
    const change = audit.diff(Object.fromEntries(FIELDS.map((k) => [k, s[k]])), f);
    if (!change.changed) return shape(ctx, s, ctx.branchId);
    ctx.db.transaction(() => {
      ctx.db.prepare(`UPDATE suppliers SET ${FIELDS.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`).run({ ...f, id: s.id, now: nowIso() });
      audit.write(ctx.db, ctx.actor, { module: 'suppliers', action: 'update', recordType: 'supplier', recordId: s.id, branchId: null, summary: `Supplier ${f.name} changed`, old: change.old, new: change.new });
    })();
    return shape(ctx, load(ctx.db, s.id), ctx.branchId);
  });

  define('suppliers.setActive', { perm: 'suppliers.delete' }, (ctx, params) => {
    const s = load(ctx.db, v.id(params, 'id'));
    const active = v.bool(params, 'active');
    const reason = v.text(params, 'reason', 'Reason', { required: !active, max: 300 });
    if ((s.active === 1) === active) return shape(ctx, s, ctx.branchId);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE suppliers SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), s.id);
      audit.write(ctx.db, ctx.actor, { module: 'suppliers', action: active ? 'activate' : 'deactivate', recordType: 'supplier', recordId: s.id, branchId: null, summary: `Supplier ${s.name} ${active ? 're-activated' : 'deactivated'}`, reason });
    })();
    return shape(ctx, load(ctx.db, s.id), ctx.branchId);
  });

  define('suppliers.statement', { perm: 'suppliers.view' }, (ctx, params) => {
    if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
    return statement(ctx, params);
  });

  define('suppliers.openBills', { perm: ['suppliers.view', 'supplier_payments.view'] }, (ctx, params) => {
    if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
    return openBills(ctx.db, v.id(params, 'id'), ctx.branchId);
  });

  // Every purchase line from this supplier (what we bought, when, at what price).
  define('suppliers.history', { perm: 'suppliers.view' }, (ctx, params) => {
    const s = load(ctx.db, v.id(params, 'id'));
    const branchId = scopeBranch(ctx, params);
    const rows = ctx.db.prepare(`SELECT g.id AS grn_id, g.doc_no, g.received_date, g.supplier_invoice_no, g.status, g.total, g.branch_id
      FROM grns g WHERE g.supplier_id = @s AND g.status <> 'draft' ${branchId ? 'AND g.branch_id = @b' : ''} ORDER BY g.received_date DESC LIMIT 1000`).all({ s: s.id, b: branchId });
    return rows.map((r) => ({ grnId: r.grn_id, docNo: r.doc_no, date: r.received_date, invoiceNo: r.supplier_invoice_no, status: r.status, total: canSeeCost(ctx) ? r.total : null }));
  });

  // Price comparison: what each supplier charged for a product, latest first.
  define('suppliers.priceComparison', { perm: ['suppliers.view', 'purchases.view'] }, (ctx, params) => {
    if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
    const productId = v.id(params, 'productId', 'Product');
    const rows = ctx.db.prepare(`SELECT s.id AS supplier_id, s.name AS supplier_name, l.price, l.discount_bp, l.unit_cost, l.qty, l.bonus_qty, g.received_date, g.doc_no
      FROM grn_lines l JOIN grns g ON g.id = l.grn_id JOIN suppliers s ON s.id = g.supplier_id
      WHERE l.product_id = ? AND g.status = 'posted' AND l.deleted_at IS NULL ORDER BY g.received_date DESC LIMIT 500`).all(productId);
    const bySupplier = new Map();
    for (const r of rows) {
      const cur = bySupplier.get(r.supplier_id) || { supplierId: r.supplier_id, supplierName: r.supplier_name, purchases: 0, lastPrice: r.price, lastNetCost: r.unit_cost, lastDate: r.received_date, lastDoc: r.doc_no, lowestNetCost: r.unit_cost, history: [] };
      cur.purchases += 1;
      cur.lowestNetCost = Math.min(cur.lowestNetCost, r.unit_cost);
      if (cur.history.length < 10) cur.history.push({ date: r.received_date, docNo: r.doc_no, price: r.price, discountBp: r.discount_bp, netCost: r.unit_cost, qty: r.qty, bonusQty: r.bonus_qty });
      bySupplier.set(r.supplier_id, cur);
    }
    return [...bySupplier.values()].sort((a, b) => a.lastNetCost - b.lastNetCost);
  });
}

module.exports = { register, balanceOf, openBills, ageing, readForm, insertSupplier, applySupplierUpdate };

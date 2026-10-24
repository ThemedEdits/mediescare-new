'use strict';
// Global search (Ctrl+K). Looks through the records this person may open, in their branch (or every branch for
// Head Office). A scanned barcode or an exact document number opens that record directly ("exact").
const { like } = require('../core/docs');
const { seesAllBranches } = require('./guards');
const { label } = require('./products');

const LIMIT = 6;

function search(ctx, params) {
  const q = String(params.q || '').trim().slice(0, 80);
  if (q.length < 2) return { q, groups: [], exact: null };
  const db = ctx.db;
  const all = seesAllBranches(ctx);
  const pat = like(q);
  const args = { q, pat, branch: ctx.branchId };
  const B = (col) => (all ? '1 = 1' : `${col} = @branch`);
  const groups = [];
  let exact = null;
  const add = (key, title, items) => { if (items.length) groups.push({ key, title, items }); };
  const docExact = (items) => { if (!exact) { const hit = items.find((i) => i.docNo && i.docNo.toLowerCase() === q.toLowerCase()); if (hit) exact = hit.route; } };

  if (ctx.can('products.view') || ctx.can('pos.view')) {
    const bc = db.prepare('SELECT p.* FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.barcode = @q AND b.active = 1 LIMIT 1').get(args);
    if (bc && ctx.can('products.view')) exact = { path: 'product', params: { id: bc.id } };
    const rows = db.prepare(`SELECT * FROM products WHERE (brand_name LIKE @pat ESCAPE '\\' OR generic_name LIKE @pat ESCAPE '\\' OR sku = @q COLLATE NOCASE)
      ORDER BY active DESC, brand_name COLLATE NOCASE LIMIT ${LIMIT}`).all(args);
    if (bc && !rows.some((r) => r.id === bc.id)) rows.unshift(bc);
    add('products', 'Medicines and products', rows.map((p) => ({ id: p.id, title: label(p), sub: [p.generic_name, p.sku, p.active ? null : 'Inactive'].filter(Boolean).join(' - '),
      route: ctx.can('products.view') ? { path: 'product', params: { id: p.id } } : { path: 'pos' } })));
  }
  if (ctx.can('batches.view')) {
    const rows = db.prepare(`SELECT b.*, p.brand_name, p.strength FROM batches b JOIN products p ON p.id = b.product_id WHERE b.batch_no LIKE @pat ESCAPE '\\'
      ORDER BY b.expiry_date DESC LIMIT ${LIMIT}`).all(args);
    add('batches', 'Batches', rows.map((b) => ({ id: b.id, title: `${b.batch_no} - ${label(b)}`, sub: `Expires ${b.expiry_date}`, route: { path: 'product', params: { id: b.product_id, tab: 'batches' } } })));
  }
  if (ctx.can('sales.view') || ctx.can('pos.view')) {
    const rows = db.prepare(`SELECT s.id, s.doc_no, s.sale_date, s.total, s.status, c.name AS customer FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.doc_no LIKE @pat ESCAPE '\\' AND ${B('s.branch_id')} ORDER BY s.sold_at DESC LIMIT ${LIMIT}`).all(args);
    const items = rows.map((s) => ({ id: s.id, docNo: s.doc_no, title: s.doc_no, sub: [s.sale_date, s.customer || 'Walk-in', s.status === 'voided' ? 'Cancelled' : null].filter(Boolean).join(' - '),
      amount: s.total, route: { path: 'sale', params: { id: s.id } } }));
    add('sales', 'Bills', items);
    docExact(items);
  }
  if (ctx.can('customers.view')) {
    const rows = db.prepare(`SELECT * FROM customers WHERE name LIKE @pat ESCAPE '\\' OR phone LIKE @pat ESCAPE '\\' OR code = @q COLLATE NOCASE OR cnic = @q
      ORDER BY active DESC, name COLLATE NOCASE LIMIT ${LIMIT}`).all(args);
    add('customers', 'Customers', rows.map((c) => ({ id: c.id, title: c.name, sub: [c.code, c.phone].filter(Boolean).join(' - '), route: { path: 'customer', params: { id: c.id } } })));
  }
  if (ctx.can('suppliers.view')) {
    const rows = db.prepare(`SELECT * FROM suppliers WHERE name LIKE @pat ESCAPE '\\' OR code = @q COLLATE NOCASE OR phone LIKE @pat ESCAPE '\\' ORDER BY active DESC, name COLLATE NOCASE LIMIT ${LIMIT}`).all(args);
    add('suppliers', 'Suppliers', rows.map((s) => ({ id: s.id, title: s.name, sub: [s.code, s.phone].filter(Boolean).join(' - '), route: { path: 'supplier', params: { id: s.id } } })));
  }
  if (ctx.can('purchases.view')) {
    const po = db.prepare(`SELECT p.*, s.name AS supplier FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.doc_no LIKE @pat ESCAPE '\\' AND ${B('p.branch_id')}
      ORDER BY p.created_at DESC LIMIT ${LIMIT}`).all(args).map((p) => ({ id: p.id, docNo: p.doc_no, title: p.doc_no, sub: `Purchase order - ${p.supplier}`, route: { path: 'po', params: { id: p.id } } }));
    const grn = db.prepare(`SELECT g.*, s.name AS supplier FROM grns g JOIN suppliers s ON s.id = g.supplier_id WHERE (g.doc_no LIKE @pat ESCAPE '\\' OR g.supplier_invoice_no = @q) AND ${B('g.branch_id')}
      ORDER BY g.created_at DESC LIMIT ${LIMIT}`).all(args).map((g) => ({ id: g.id, docNo: g.doc_no, title: g.doc_no, sub: `Goods receipt - ${g.supplier}${g.supplier_invoice_no ? ` - invoice ${g.supplier_invoice_no}` : ''}`,
      route: { path: 'grn', params: { id: g.id } } }));
    add('purchases', 'Purchases', [...po, ...grn].slice(0, LIMIT));
    docExact([...po, ...grn]);
  }
  if (ctx.can('transfers.view')) {
    const rows = db.prepare(`SELECT t.*, f.name AS from_name, tb.name AS to_name FROM transfers t JOIN branches f ON f.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
      WHERE t.doc_no LIKE @pat ESCAPE '\\' AND (${all ? '1 = 1' : 't.from_branch_id = @branch OR t.to_branch_id = @branch'}) ORDER BY t.created_at DESC LIMIT ${LIMIT}`).all(args);
    const items = rows.map((t) => ({ id: t.id, docNo: t.doc_no, title: t.doc_no, sub: `${t.from_name} to ${t.to_name} - ${t.status}`, route: { path: 'transfer', params: { id: t.id } } }));
    add('transfers', 'Transfers', items);
    docExact(items);
  }
  const pay = [];
  if (ctx.can('supplier_payments.view')) {
    pay.push(...db.prepare(`SELECT p.*, s.name AS supplier FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE (p.doc_no LIKE @pat ESCAPE '\\' OR p.reference = @q) AND ${B('p.branch_id')}
      ORDER BY p.created_at DESC LIMIT ${LIMIT}`).all(args).map((p) => ({ id: p.id, docNo: p.doc_no, title: p.doc_no, sub: `Paid to ${p.supplier}`, amount: p.amount, route: { path: 'payment', params: { id: p.id } } })));
  }
  if (ctx.can('customers.view')) {
    pay.push(...db.prepare(`SELECT r.*, c.name AS customer FROM customer_receipts r JOIN customers c ON c.id = r.customer_id WHERE (r.doc_no LIKE @pat ESCAPE '\\' OR r.reference = @q) AND ${B('r.branch_id')}
      ORDER BY r.created_at DESC LIMIT ${LIMIT}`).all(args).map((r) => ({ id: r.id, docNo: r.doc_no, title: r.doc_no, sub: `Received from ${r.customer}`, amount: r.amount, route: { path: 'customer', params: { id: r.customer_id } } })));
  }
  if (ctx.can('expenses.view')) {
    pay.push(...db.prepare(`SELECT e.*, c.name AS category FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE (e.doc_no LIKE @pat ESCAPE '\\' OR e.description LIKE @pat ESCAPE '\\')
      AND ${B('e.branch_id')} ORDER BY e.created_at DESC LIMIT ${LIMIT}`).all(args).map((e) => ({ id: e.id, docNo: e.doc_no, title: e.doc_no, sub: `Expense - ${e.category}: ${e.description}`, amount: e.amount,
      route: { path: 'expenses', params: { id: e.id } } })));
  }
  add('payments', 'Payments and expenses', pay.slice(0, LIMIT));
  docExact(pay);
  if (ctx.can('stock.view')) {
    const items = db.prepare(`SELECT * FROM stock_adjustments WHERE doc_no LIKE @pat ESCAPE '\\' AND ${B('branch_id')} ORDER BY created_at DESC LIMIT ${LIMIT}`).all(args)
      .map((a) => ({ id: a.id, docNo: a.doc_no, title: a.doc_no, sub: `Stock adjustment - ${a.reason}`, route: { path: 'adjustment', params: { id: a.id } } }));
    add('adjustments', 'Stock adjustments', items);
    docExact(items);
  }
  if (ctx.can('users.view')) {
    const rows = db.prepare(`SELECT * FROM users WHERE (username LIKE @pat ESCAPE '\\' OR full_name LIKE @pat ESCAPE '\\') AND ${B('branch_id')} ORDER BY full_name LIMIT ${LIMIT}`).all(args);
    add('users', 'Users', rows.map((u) => ({ id: u.id, title: u.full_name, sub: u.username, route: { path: 'users', params: { id: u.id } } })));
  }
  if (ctx.can('branches.view')) {
    const rows = db.prepare(`SELECT * FROM branches WHERE (name LIKE @pat ESCAPE '\\' OR code = @q COLLATE NOCASE) ORDER BY name LIMIT ${LIMIT}`).all(args);
    add('branches', 'Branches', rows.map((b) => ({ id: b.id, title: b.name, sub: b.code, route: { path: 'branches', params: { id: b.id } } })));
  }
  return { q, groups, exact };
}

function register(define) {
  define('search.global', {}, search);
}

module.exports = { register };

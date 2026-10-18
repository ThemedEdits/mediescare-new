'use strict';
// Purchasing: purchase orders, goods receipts (GRN), purchase returns and supplier payments.
// Money is integer paisa. Prices are per pack; quantities are base units.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const { nextNo, canSeeCost, paging, like } = require('../core/docs');
const { recordPrice, label } = require('./products');
const { openBills } = require('./suppliers');
const { seesAllBranches } = require('./guards');

// ---- shared helpers ------------------------------------------------------------------------------------------------

function requireCost(ctx) {
  if (!canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
}

function branchRow(db, id) {
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

// Branches buy from suppliers only if they are the Head Office or the role allows direct buying.
function assertMayBuy(ctx) {
  const b = branchRow(ctx.db, ctx.branchId);
  if (!b.is_head_office && !ctx.can('purchases.direct_branch')) fail('FORBIDDEN', 'purchases.directNotAllowed');
}

function loadSupplier(db, id, { requireActive = true } = {}) {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id || '');
  if (!s) invalid('supplierId', 'error.required', { field: 'Supplier' });
  if (requireActive && !s.active) invalid('supplierId', 'purchases.supplierInactive');
  return s;
}

function loadProduct(db, id, field) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id || '');
  if (!p) invalid(field, 'error.required', { field: 'Product' });
  return p;
}

function assertDocBranch(ctx, doc, thing) {
  if (!doc) fail('NOT_FOUND', 'error.notFound', { thing });
  if (doc.branch_id !== ctx.branchId && !seesAllBranches(ctx)) fail('FORBIDDEN', 'error.wrongBranch');
}

function assertStatus(doc, thing, allowed) {
  if (!allowed.includes(doc.status)) fail('WRONG_STATUS', 'error.wrongStatus', { thing, status: doc.status });
}

// Splits `amount` over lines in proportion to `weights`, using the largest remainder so the parts add up exactly.
function allocate(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!amount || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (BigInt(amount) * BigInt(w)));
  const base = raw.map((r) => Number(r / BigInt(total)));
  let left = amount - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: Number(r % BigInt(total)) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base;
}

function addDaysTo(date, days) {
  return days ? stock.addDays(date, days) : date;
}

// ---- purchase orders -----------------------------------------------------------------------------------------------

function readPoLines(ctx, params) {
  const lines = Array.isArray(params.lines) ? params.lines : [];
  if (!lines.length) invalid('lines', 'error.noLines');
  return lines.map((l, i) => {
    const p = loadProduct(ctx.db, l.productId, `lines.${i}.productId`);
    const qty = v.int(l, 'qty', `Quantity of ${label(p)}`, { required: true, min: 1 });
    const price = v.money(l, 'price', `Price of ${label(p)}`, { fallback: p.trade_price });
    return { product: p, qty, price, line_total: money.mulRound(price, qty, p.pack_size), sort: i };
  });
}

function poShape(ctx, po, withLines) {
  const out = {
    id: po.id, docNo: po.doc_no, branchId: po.branch_id, branchName: po.branch_name, supplierId: po.supplier_id, supplierName: po.supplier_name,
    status: po.status, orderDate: po.order_date, expectedDate: po.expected_date, notes: po.notes, total: canSeeCost(ctx) ? po.total : null,
    createdAt: po.created_at, orderedAt: po.ordered_at, closedReason: po.closed_reason,
  };
  if (withLines) {
    out.lines = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
      WHERE l.po_id = ? AND l.deleted_at IS NULL ORDER BY l.sort`).all(po.id).map((l) => ({
      id: l.id, productId: l.product_id, productLabel: label(l), packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit,
      qty: l.qty, qtyText: stock.qtyText(l.qty, l), receivedQty: l.received_qty, openQty: Math.max(l.qty - l.received_qty, 0),
      price: canSeeCost(ctx) ? l.price : null, lineTotal: canSeeCost(ctx) ? l.line_total : null,
    }));
  }
  return out;
}

function loadPo(ctx, id) {
  const po = ctx.db.prepare(`SELECT po.*, s.name AS supplier_name, b.name AS branch_name FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id JOIN branches b ON b.id = po.branch_id WHERE po.id = ?`).get(id);
  assertDocBranch(ctx, po, 'purchase order');
  return po;
}

function savePo(ctx, params) {
  requireCost(ctx);
  assertMayBuy(ctx);
  const supplier = loadSupplier(ctx.db, params.supplierId);
  const orderDate = v.date(params, 'orderDate', 'Order date') || stock.today();
  const expectedDate = v.date(params, 'expectedDate', 'Expected date');
  const notes = v.text(params, 'notes', 'Notes', { max: 1000 });
  const lines = readPoLines(ctx, params);
  const total = money.sum(lines.map((l) => l.line_total));
  const now = nowIso();
  let id = params.id || null;
  ctx.db.transaction(() => {
    if (id) {
      const po = loadPo(ctx, id);
      assertStatus(po, 'purchase order', ['draft']);
      ctx.db.prepare('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, expected_date = ?, notes = ?, total = ?, updated_at = ? WHERE id = ?')
        .run(supplier.id, orderDate, expectedDate, notes, total, now, id);
      ctx.db.prepare('UPDATE purchase_order_lines SET deleted_at = ?, updated_at = ? WHERE po_id = ? AND deleted_at IS NULL').run(now, now, id);
      audit.write(ctx.db, ctx.actor, { module: 'purchases', action: 'update_po', recordType: 'purchase_order', recordId: id, summary: `Purchase order ${po.doc_no} changed`, new: { supplier: supplier.name, total, lines: lines.length } });
    } else {
      id = newId();
      const docNo = nextNo(ctx, 'PO');
      ctx.db.prepare(`INSERT INTO purchase_orders (id, branch_id, doc_no, supplier_id, status, order_date, expected_date, notes, total, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.branchId, docNo, supplier.id, orderDate, expectedDate, notes, total, ctx.userId, now, now);
      audit.write(ctx.db, ctx.actor, { module: 'purchases', action: 'create_po', recordType: 'purchase_order', recordId: id, summary: `Purchase order ${docNo} created for ${supplier.name}`, new: { supplier: supplier.name, total, lines: lines.length } });
    }
    const insert = ctx.db.prepare(`INSERT INTO purchase_order_lines (id, po_id, branch_id, product_id, qty, price, line_total, received_qty, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`);
    for (const l of lines) insert.run(newId(), id, ctx.branchId, l.product.id, l.qty, l.price, l.line_total, l.sort, now, now);
  })();
  return poShape(ctx, loadPo(ctx, id), true);
}

function setPoStatus(ctx, params) {
  const po = loadPo(ctx, v.id(params, 'id'));
  const action = v.oneOf(params, 'action', 'Action', ['order', 'cancel', 'close']);
  const now = nowIso();
  if (action === 'order') {
    assertStatus(po, 'purchase order', ['draft']);
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE purchase_orders SET status = 'ordered', ordered_by = ?, ordered_at = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, now, po.id);
      audit.write(ctx.db, ctx.actor, { module: 'purchases', action: 'order_po', recordType: 'purchase_order', recordId: po.id, summary: `Purchase order ${po.doc_no} marked as ordered` });
    })();
  } else {
    // cancel: nothing received yet; close: stop waiting for the rest of a partly received order.
    assertStatus(po, 'purchase order', action === 'cancel' ? ['draft', 'ordered'] : ['partial']);
    const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
    const status = action === 'cancel' ? 'cancelled' : 'received';
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE purchase_orders SET status = ?, closed_reason = ?, updated_at = ? WHERE id = ?').run(status, reason, now, po.id);
      audit.write(ctx.db, ctx.actor, { module: 'purchases', action: `${action}_po`, recordType: 'purchase_order', recordId: po.id, summary: `Purchase order ${po.doc_no} ${action === 'cancel' ? 'cancelled' : 'closed with items still open'}`, reason });
    })();
  }
  return poShape(ctx, loadPo(ctx, po.id), true);
}

function refreshPoStatus(db, poId) {
  const lines = db.prepare('SELECT qty, received_qty FROM purchase_order_lines WHERE po_id = ? AND deleted_at IS NULL').all(poId);
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId);
  if (po.status === 'cancelled') return;
  const any = lines.some((l) => l.received_qty > 0);
  const all = lines.every((l) => l.received_qty >= l.qty);
  const status = all ? 'received' : any ? 'partial' : 'ordered';
  db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND status <> ?').run(status, nowIso(), poId, status);
}

// ---- goods receipts ------------------------------------------------------------------------------------------------

function readGrn(ctx, params) {
  const supplier = loadSupplier(ctx.db, params.supplierId);
  const head = {
    supplier,
    po_id: v.optionalId(params, 'poId', 'Purchase order'),
    supplier_invoice_no: v.text(params, 'invoiceNo', 'Supplier invoice number', { max: 60 }),
    invoice_date: v.date(params, 'invoiceDate', 'Invoice date'),
    received_date: v.date(params, 'receivedDate', 'Received date') || stock.today(),
    doc_discount: v.money(params, 'docDiscount', 'Bill discount', { fallback: 0 }),
    freight: v.money(params, 'freight', 'Freight', { fallback: 0 }),
    notes: v.text(params, 'notes', 'Notes', { max: 1000 }),
  };
  head.due_date = v.date(params, 'dueDate', 'Due date') || addDaysTo(head.invoice_date || head.received_date, supplier.payment_terms_days);
  if (head.po_id) {
    const po = loadPo(ctx, head.po_id);
    if (po.supplier_id !== supplier.id) invalid('poId', 'error.invalid', { field: 'Purchase order' });
    if (!['ordered', 'partial', 'draft'].includes(po.status)) invalid('poId', 'purchases.poNotOpen', { status: po.status });
  }
  const rawLines = Array.isArray(params.lines) ? params.lines : [];
  if (!rawLines.length) invalid('lines', 'error.noLines');
  const lines = rawLines.map((l, i) => {
    const p = loadProduct(ctx.db, l.productId, `lines.${i}.productId`);
    const name = label(p);
    const line = {
      product: p,
      po_line_id: v.optionalId(l, 'poLineId', 'Order line'),
      batch_no: v.text(l, 'batchNo', `Batch number of ${name}`, { required: true, max: 40 }),
      expiry_date: v.date(l, 'expiryDate', `Expiry date of ${name}`, { required: true }),
      mfg_date: v.date(l, 'mfgDate', `Manufacture date of ${name}`),
      qty: v.int(l, 'qty', `Quantity of ${name}`, { required: true, min: 1 }),
      bonus_qty: v.int(l, 'bonusQty', `Bonus quantity of ${name}`, { fallback: 0 }),
      price: v.money(l, 'price', `Trade price of ${name}`, { required: true }),
      discount_bp: v.percent(l, 'discount', `Discount of ${name}`),
      tax_bp: v.percent(l, 'tax', `Tax of ${name}`),
      mrp: v.money(l, 'mrp', `MRP of ${name}`, { fallback: p.mrp }),
      sort: i,
    };
    if (line.mfg_date && line.mfg_date > line.expiry_date) invalid(`lines.${i}.mfgDate`, 'stock.expiryBeforeMfg');
    line.gross = money.mulRound(line.price, line.qty, p.pack_size);
    line.discount = money.percentOf(line.gross, line.discount_bp);
    line.tax = money.percentOf(line.gross - line.discount, line.tax_bp);
    line.line_total = line.gross - line.discount + line.tax;
    return line;
  });
  return { head, lines };
}

function grnTotals(head, lines) {
  const subtotal = money.sum(lines.map((l) => l.gross));
  const lineDiscount = money.sum(lines.map((l) => l.discount));
  const tax = money.sum(lines.map((l) => l.tax));
  const net = money.sum(lines.map((l) => l.line_total));
  const docDiscount = Math.min(head.doc_discount, net);
  // Bill discount lowers, and freight raises, the landed cost of each line in proportion to its value.
  const discShare = allocate(docDiscount, lines.map((l) => l.line_total));
  const freightShare = allocate(head.freight, lines.map((l) => l.line_total));
  for (const [i, l] of lines.entries()) {
    const landed = l.line_total - discShare[i] + freightShare[i];
    // Cost per pack spreads the landed amount over paid and bonus units together.
    l.unit_cost = money.mulRound(landed, l.product.pack_size, l.qty + l.bonus_qty);
  }
  return { subtotal, line_discount: lineDiscount, tax, doc_discount: docDiscount, freight: head.freight, total: net - docDiscount + head.freight };
}

function grnShape(ctx, g, withLines) {
  const c = canSeeCost(ctx);
  const out = {
    id: g.id, docNo: g.doc_no, branchId: g.branch_id, branchName: g.branch_name, supplierId: g.supplier_id, supplierName: g.supplier_name,
    poId: g.po_id, poNo: g.po_no, invoiceNo: g.supplier_invoice_no, invoiceDate: g.invoice_date, receivedDate: g.received_date, dueDate: g.due_date,
    status: g.status, notes: g.notes, postedAt: g.posted_at, cancelReason: g.cancel_reason,
    subtotal: c ? g.subtotal : null, lineDiscount: c ? g.line_discount : null, docDiscount: c ? g.doc_discount : null, tax: c ? g.tax : null,
    freight: c ? g.freight : null, total: c ? g.total : null,
  };
  if (c && g.status === 'posted') {
    out.paid = ctx.db.prepare(`SELECT COALESCE(SUM(a.amount), 0) AS x FROM payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.grn_id = ? AND p.status = 'posted'`).get(g.id).x;
    out.due = g.total - out.paid;
  }
  if (withLines) {
    out.lines = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit FROM grn_lines l JOIN products p ON p.id = l.product_id
      WHERE l.grn_id = ? AND l.deleted_at IS NULL ORDER BY l.sort`).all(g.id).map((l) => ({
      id: l.id, productId: l.product_id, productLabel: label(l), packSize: l.pack_size, packUnit: l.pack_unit, baseUnit: l.base_unit,
      poLineId: l.po_line_id, batchId: l.batch_id, batchNo: l.batch_no, expiryDate: l.expiry_date, mfgDate: l.mfg_date,
      qty: l.qty, bonusQty: l.bonus_qty, qtyText: stock.qtyText(l.qty, l), bonusText: l.bonus_qty ? stock.qtyText(l.bonus_qty, l) : '',
      mrp: l.mrp, price: c ? l.price : null, discountBp: c ? l.discount_bp : null, discount: c ? l.discount : null, taxBp: c ? l.tax_bp : null,
      tax: c ? l.tax : null, gross: c ? l.gross : null, lineTotal: c ? l.line_total : null, unitCost: c ? l.unit_cost : null,
    }));
  }
  return out;
}

function loadGrn(ctx, id) {
  const g = ctx.db.prepare(`SELECT g.*, s.name AS supplier_name, b.name AS branch_name, po.doc_no AS po_no FROM grns g
    JOIN suppliers s ON s.id = g.supplier_id JOIN branches b ON b.id = g.branch_id LEFT JOIN purchase_orders po ON po.id = g.po_id WHERE g.id = ?`).get(id);
  assertDocBranch(ctx, g, 'goods receipt');
  return g;
}

function writeGrnLines(ctx, grnId, lines, now) {
  ctx.db.prepare('UPDATE grn_lines SET deleted_at = ?, updated_at = ? WHERE grn_id = ? AND deleted_at IS NULL').run(now, now, grnId);
  const insert = ctx.db.prepare(`INSERT INTO grn_lines (id, grn_id, branch_id, product_id, po_line_id, batch_no, expiry_date, mfg_date, qty, bonus_qty, price,
      discount_bp, discount, tax_bp, tax, gross, line_total, mrp, unit_cost, sort, created_at, updated_at)
    VALUES (@id, @grn, @branch, @product, @po_line_id, @batch_no, @expiry_date, @mfg_date, @qty, @bonus_qty, @price,
      @discount_bp, @discount, @tax_bp, @tax, @gross, @line_total, @mrp, @unit_cost, @sort, @now, @now)`);
  for (const l of lines) {
    l.id = newId();
    insert.run({ ...l, product: l.product.id, grn: grnId, branch: ctx.branchId, now });
  }
}

// Posting: create a batch per line, add stock to the ledger, update the order, and record what is owed.
function postGrn(ctx, grnId, head, lines, totals) {
  const db = ctx.db;
  const today = stock.today();
  const g = db.prepare('SELECT * FROM grns WHERE id = ?').get(grnId);
  for (const [i, l] of lines.entries()) {
    if (l.expiry_date < today) invalid(`lines.${i}.expiryDate`, 'stock.expiryPast', { date: l.expiry_date });
  }
  if (head.supplier_invoice_no) {
    const dup = db.prepare(`SELECT doc_no FROM grns WHERE supplier_id = ? AND supplier_invoice_no = ? COLLATE NOCASE AND status = 'posted' AND id <> ?`).get(head.supplier.id, head.supplier_invoice_no, grnId);
    if (dup) invalid('invoiceNo', 'purchases.invoiceDuplicate', { invoice: head.supplier_invoice_no, doc: dup.doc_no });
  }
  // Received quantities against the order: never more than is still open.
  const perPoLine = new Map();
  for (const l of lines) if (l.po_line_id) perPoLine.set(l.po_line_id, (perPoLine.get(l.po_line_id) || 0) + l.qty);
  for (const [poLineId, qty] of perPoLine) {
    const pl = db.prepare('SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.id = ? AND l.po_id = ?').get(poLineId, head.po_id || '');
    if (!pl) invalid('lines', 'error.invalid', { field: 'Order line' });
    const open = pl.qty - pl.received_qty;
    if (qty > open) invalid('lines', 'purchases.overReceive', { product: label(pl), open: stock.qtyText(Math.max(open, 0), pl) });
    db.prepare('UPDATE purchase_order_lines SET received_qty = received_qty + ?, updated_at = ? WHERE id = ?').run(qty, nowIso(), poLineId);
  }
  if (head.po_id) refreshPoStatus(db, head.po_id);

  const receivedAt = stock.atOnDate(head.received_date);
  for (const l of db.prepare('SELECT * FROM grn_lines WHERE grn_id = ? AND deleted_at IS NULL ORDER BY sort').all(grnId)) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id);
    const batchId = newId();
    const now = nowIso();
    db.prepare(`INSERT INTO batches (id, product_id, batch_no, expiry_date, mfg_date, mrp, cost, trade_price, supplier_id, received_at, origin_branch_id, source_type, source_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'grn', ?, ?, ?)`).run(batchId, p.id, l.batch_no, l.expiry_date, l.mfg_date, l.mrp, l.unit_cost, l.price, head.supplier.id, receivedAt, ctx.branchId, grnId, now, now);
    db.prepare('UPDATE grn_lines SET batch_id = ?, updated_at = ? WHERE id = ?').run(batchId, now, l.id);
    stock.post(db, ctx.actor, { branchId: ctx.branchId, batchId, qty: l.qty + l.bonus_qty, movement: 'PURCHASE', refType: 'grn', refId: grnId, refNo: g.doc_no, at: receivedAt });
    // The latest purchase becomes the product's default MRP and trade price.
    if (l.mrp !== p.mrp || l.price !== p.trade_price) {
      db.prepare('UPDATE products SET mrp = ?, trade_price = ?, updated_at = ? WHERE id = ?').run(l.mrp, l.price, now, p.id);
      recordPrice(ctx, p.id, null, 'mrp', p.mrp, l.mrp, 'grn', g.doc_no);
      recordPrice(ctx, p.id, null, 'trade_price', p.trade_price, l.price, 'grn', g.doc_no);
    }
  }
  const at = nowIso();
  db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, credit, due_date, description, user_id, at, updated_at)
    VALUES (?, ?, ?, ?, 'purchase', 'grn', ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), ctx.branchId, head.supplier.id, head.received_date, grnId, g.doc_no, totals.total, head.due_date,
    `Goods received${head.supplier_invoice_no ? `, invoice ${head.supplier_invoice_no}` : ''}`, ctx.userId, at, at);
  db.prepare("UPDATE grns SET status = 'posted', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(ctx.userId, at, at, grnId);
  audit.write(db, ctx.actor, { module: 'purchases', action: 'post_grn', recordType: 'grn', recordId: grnId, summary: `Goods receipt ${g.doc_no} posted: ${lines.length} item(s), total ${money.format(totals.total, { symbol: '' })}`, new: { supplier: head.supplier.name, invoice: head.supplier_invoice_no, total: totals.total } });
}

function saveGrn(ctx, params) {
  requireCost(ctx);
  assertMayBuy(ctx);
  const { head, lines } = readGrn(ctx, params);
  const totals = grnTotals(head, lines);
  const post = v.bool(params, 'post');
  const now = nowIso();
  let id = params.id || null;
  ctx.db.transaction(() => {
    const fields = {
      supplier_id: head.supplier.id, po_id: head.po_id, supplier_invoice_no: head.supplier_invoice_no, invoice_date: head.invoice_date,
      received_date: head.received_date, due_date: head.due_date, notes: head.notes, ...totals,
    };
    if (id) {
      const g = loadGrn(ctx, id);
      assertStatus(g, 'goods receipt', ['draft']);
      ctx.db.prepare(`UPDATE grns SET supplier_id = @supplier_id, po_id = @po_id, supplier_invoice_no = @supplier_invoice_no, invoice_date = @invoice_date,
          received_date = @received_date, due_date = @due_date, notes = @notes, subtotal = @subtotal, line_discount = @line_discount, doc_discount = @doc_discount,
          tax = @tax, freight = @freight, total = @total, updated_at = @now WHERE id = @id`).run({ ...fields, now, id });
    } else {
      id = newId();
      const docNo = nextNo(ctx, 'GRN');
      ctx.db.prepare(`INSERT INTO grns (id, branch_id, doc_no, supplier_id, po_id, supplier_invoice_no, invoice_date, received_date, due_date, status,
          subtotal, line_discount, doc_discount, tax, freight, total, notes, created_by, created_at, updated_at)
        VALUES (@id, @branch, @doc_no, @supplier_id, @po_id, @supplier_invoice_no, @invoice_date, @received_date, @due_date, 'draft',
          @subtotal, @line_discount, @doc_discount, @tax, @freight, @total, @notes, @by, @now, @now)`).run({ ...fields, id, branch: ctx.branchId, doc_no: docNo, by: ctx.userId, now });
      audit.write(ctx.db, ctx.actor, { module: 'purchases', action: 'create_grn', recordType: 'grn', recordId: id, summary: `Goods receipt ${docNo} started for ${head.supplier.name}` });
    }
    writeGrnLines(ctx, id, lines, now);
    if (post) postGrn(ctx, id, head, lines, totals);
  })();
  return grnShape(ctx, loadGrn(ctx, id), true);
}

function cancelGrn(ctx, params) {
  const g = loadGrn(ctx, v.id(params, 'id'));
  assertStatus(g, 'goods receipt', ['draft', 'posted']);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const db = ctx.db;
  const now = nowIso();
  db.transaction(() => {
    if (g.status === 'posted') {
      const paid = db.prepare(`SELECT 1 FROM payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.grn_id = ? AND p.status = 'posted' LIMIT 1`).get(g.id);
      if (paid) fail('IN_USE', 'purchases.paidGrn');
      const lines = db.prepare('SELECT * FROM grn_lines WHERE grn_id = ? AND deleted_at IS NULL').all(g.id);
      // Only possible while every unit received is still on the shelf untouched.
      for (const l of lines) {
        const moved = db.prepare("SELECT 1 FROM stock_ledger WHERE batch_id = ? AND NOT (ref_type = 'grn' AND ref_id = ?) LIMIT 1").get(l.batch_id, g.id);
        if (moved || stock.balance(db, g.branch_id, l.batch_id) !== l.qty + l.bonus_qty) fail('IN_USE', 'purchases.cannotCancelGrn');
      }
      for (const l of lines) {
        stock.post(db, ctx.actor, { branchId: g.branch_id, batchId: l.batch_id, qty: -(l.qty + l.bonus_qty), movement: 'PURCHASE_CANCEL', refType: 'grn', refId: g.id, refNo: g.doc_no, reason });
        if (l.po_line_id) db.prepare('UPDATE purchase_order_lines SET received_qty = MAX(received_qty - ?, 0), updated_at = ? WHERE id = ?').run(l.qty, now, l.po_line_id);
      }
      if (g.po_id) {
        db.prepare("UPDATE purchase_orders SET status = 'ordered', updated_at = ? WHERE id = ? AND status IN ('partial', 'received')").run(now, g.po_id);
        refreshPoStatus(db, g.po_id);
      }
      db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, debit, description, user_id, at, updated_at)
        VALUES (?, ?, ?, ?, 'purchase_cancel', 'grn', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), g.branch_id, g.supplier_id, stock.today(), g.id, g.doc_no, g.total, `Goods receipt cancelled: ${reason}`, ctx.userId, now, now);
    }
    db.prepare("UPDATE grns SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, g.id);
    audit.write(db, ctx.actor, { module: 'purchases', action: 'cancel_grn', recordType: 'grn', recordId: g.id, summary: `Goods receipt ${g.doc_no} cancelled`, reason });
  })();
  return grnShape(ctx, loadGrn(ctx, g.id), true);
}

// ---- purchase returns ----------------------------------------------------------------------------------------------

function returnShape(ctx, r, withLines) {
  const c = canSeeCost(ctx);
  const out = {
    id: r.id, docNo: r.doc_no, branchId: r.branch_id, supplierId: r.supplier_id, supplierName: r.supplier_name, grnId: r.grn_id, grnNo: r.grn_no,
    reasonType: r.reason_type, status: r.status, returnDate: r.return_date, total: c ? r.total : null, notes: r.notes, cancelReason: r.cancel_reason, createdAt: r.created_at,
  };
  if (withLines) {
    out.lines = ctx.db.prepare(`SELECT l.*, p.brand_name, p.strength, p.pack_size, p.pack_unit, p.base_unit, b.batch_no, b.expiry_date FROM purchase_return_lines l
      JOIN products p ON p.id = l.product_id JOIN batches b ON b.id = l.batch_id WHERE l.return_id = ?`).all(r.id).map((l) => ({
      id: l.id, productId: l.product_id, productLabel: label(l), batchId: l.batch_id, batchNo: l.batch_no, expiryDate: l.expiry_date,
      qty: l.qty, qtyText: stock.qtyText(l.qty, l), price: c ? l.price : null, amount: c ? l.amount : null,
    }));
  }
  return out;
}

function loadReturn(ctx, id) {
  const r = ctx.db.prepare(`SELECT r.*, s.name AS supplier_name, g.doc_no AS grn_no FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id
    LEFT JOIN grns g ON g.id = r.grn_id WHERE r.id = ?`).get(id);
  assertDocBranch(ctx, r, 'purchase return');
  return r;
}

function createReturn(ctx, params) {
  requireCost(ctx);
  const db = ctx.db;
  const supplier = loadSupplier(db, params.supplierId, { requireActive: false });
  const grnId = v.optionalId(params, 'grnId', 'Goods receipt');
  if (grnId) {
    const g = loadGrn(ctx, grnId);
    if (g.supplier_id !== supplier.id || g.status !== 'posted') invalid('grnId', 'error.invalid', { field: 'Goods receipt' });
  }
  const reasonType = v.oneOf(params, 'reasonType', 'Reason', ['expired', 'near_expiry', 'damaged', 'wrong_item', 'other']);
  const returnDate = v.date(params, 'returnDate', 'Return date') || stock.today();
  const notes = v.text(params, 'notes', 'Notes', { required: reasonType === 'other', max: 1000 });
  const raw = Array.isArray(params.lines) ? params.lines : [];
  if (!raw.length) invalid('lines', 'error.noLines');
  const lines = raw.map((l, i) => {
    const batch = stock.loadBatch(db, v.id(l, 'batchId', 'Batch'));
    if (batch.supplier_id && batch.supplier_id !== supplier.id) invalid(`lines.${i}.batchId`, 'purchases.wrongSupplierBatch', { batch: batch.batch_no });
    if (grnId && !db.prepare('SELECT 1 FROM grn_lines WHERE grn_id = ? AND batch_id = ?').get(grnId, batch.id)) invalid(`lines.${i}.batchId`, 'purchases.wrongSupplierBatch', { batch: batch.batch_no });
    const qty = v.int(l, 'qty', `Quantity of ${stock.productLabel(batch)}`, { required: true, min: 1 });
    const price = v.money(l, 'price', 'Return price', { fallback: batch.cost });
    return { batch, qty, price, amount: money.mulRound(price, qty, batch.pack_size) };
  });
  const total = money.sum(lines.map((l) => l.amount));
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    const docNo = nextNo(ctx, 'PRT');
    db.prepare(`INSERT INTO purchase_returns (id, branch_id, doc_no, supplier_id, grn_id, reason_type, status, return_date, total, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?)`).run(id, ctx.branchId, docNo, supplier.id, grnId, reasonType, returnDate, total, notes, ctx.userId, now, now);
    for (const l of lines) {
      db.prepare(`INSERT INTO purchase_return_lines (id, return_id, branch_id, product_id, batch_id, qty, price, amount, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), id, ctx.branchId, l.batch.product_id, l.batch.id, l.qty, l.price, l.amount, now, now);
      // Expired and quarantined stock can be returned: this is how it leaves the shelf.
      stock.post(db, ctx.actor, { branchId: ctx.branchId, batch: l.batch, qty: -l.qty, movement: 'PURCHASE_RETURN', refType: 'purchase_return', refId: id, refNo: docNo, reason: reasonType });
    }
    db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, debit, description, user_id, at, updated_at)
      VALUES (?, ?, ?, ?, 'return', 'purchase_return', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), ctx.branchId, supplier.id, returnDate, id, docNo, total, `Returned to supplier (${reasonType.replace('_', ' ')})`, ctx.userId, now, now);
    audit.write(db, ctx.actor, { module: 'purchases', action: 'create_return', recordType: 'purchase_return', recordId: id, summary: `Purchase return ${docNo} to ${supplier.name}: ${lines.length} item(s)`, new: { reason: reasonType, total }, reason: notes });
  })();
  return returnShape(ctx, loadReturn(ctx, id), true);
}

function cancelReturn(ctx, params) {
  const r = loadReturn(ctx, v.id(params, 'id'));
  assertStatus(r, 'purchase return', ['posted']);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    for (const l of ctx.db.prepare('SELECT * FROM purchase_return_lines WHERE return_id = ?').all(r.id)) {
      stock.post(ctx.db, ctx.actor, { branchId: r.branch_id, batchId: l.batch_id, qty: l.qty, movement: 'PURCHASE_RETURN_CANCEL', refType: 'purchase_return', refId: r.id, refNo: r.doc_no, reason });
    }
    ctx.db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, credit, description, user_id, at, updated_at)
      VALUES (?, ?, ?, ?, 'return_cancel', 'purchase_return', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), r.branch_id, r.supplier_id, stock.today(), r.id, r.doc_no, r.total, `Return cancelled: ${reason}`, ctx.userId, now, now);
    ctx.db.prepare("UPDATE purchase_returns SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, r.id);
    audit.write(ctx.db, ctx.actor, { module: 'purchases', action: 'cancel_return', recordType: 'purchase_return', recordId: r.id, summary: `Purchase return ${r.doc_no} cancelled`, reason });
  })();
  return returnShape(ctx, loadReturn(ctx, r.id), true);
}

// ---- supplier payments ---------------------------------------------------------------------------------------------

function paymentShape(ctx, p) {
  return {
    id: p.id, docNo: p.doc_no, branchId: p.branch_id, supplierId: p.supplier_id, supplierName: p.supplier_name, paidDate: p.paid_date, method: p.method,
    reference: p.reference, amount: p.amount, notes: p.notes, status: p.status, cancelReason: p.cancel_reason, createdAt: p.created_at,
    allocations: ctx.db.prepare('SELECT a.grn_id, a.amount, g.doc_no FROM payment_allocations a JOIN grns g ON g.id = a.grn_id WHERE a.payment_id = ?').all(p.id)
      .map((a) => ({ grnId: a.grn_id, docNo: a.doc_no, amount: a.amount })),
  };
}

function loadPayment(ctx, id) {
  const p = ctx.db.prepare('SELECT p.*, s.name AS supplier_name FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?').get(id);
  assertDocBranch(ctx, p, 'payment');
  return p;
}

function createPayment(ctx, params) {
  requireCost(ctx);
  const db = ctx.db;
  const supplier = loadSupplier(db, params.supplierId, { requireActive: false });
  const amount = v.money(params, 'amount', 'Amount', { required: true, min: 1 });
  const paidDate = v.date(params, 'paidDate', 'Payment date') || stock.today();
  if (paidDate !== stock.today() && !ctx.can('payments.edit_date')) fail('FORBIDDEN', 'error.noPermission');
  const method = v.oneOf(params, 'method', 'Payment method', ['cash', 'bank', 'cheque', 'online']);
  const reference = v.text(params, 'reference', 'Reference (cheque or transaction number)', { required: method !== 'cash', max: 80 });
  const notes = v.text(params, 'notes', 'Notes', { max: 500 });
  const bills = new Map(openBills(db, supplier.id, ctx.branchId).map((b) => [b.id, b]));
  const allocations = (Array.isArray(params.allocations) ? params.allocations : []).map((a, i) => {
    const amt = v.money(a, 'amount', 'Allocated amount', { required: true, min: 1 });
    const bill = bills.get(a.grnId);
    if (!bill) invalid(`allocations.${i}.grnId`, 'error.invalid', { field: 'Bill' });
    if (amt > bill.due) invalid(`allocations.${i}.amount`, 'purchases.allocationOverBill', { doc: bill.docNo, due: money.format(bill.due, { symbol: '' }) });
    return { grnId: bill.id, amount: amt };
  });
  const allocated = money.sum(allocations.map((a) => a.amount));
  if (allocated > amount) invalid('allocations', 'purchases.allocationTooMuch', { allocated: money.format(allocated, { symbol: '' }), amount: money.format(amount, { symbol: '' }) });
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    const docNo = nextNo(ctx, 'SPY');
    db.prepare(`INSERT INTO supplier_payments (id, branch_id, doc_no, supplier_id, paid_date, method, reference, amount, notes, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`).run(id, ctx.branchId, docNo, supplier.id, paidDate, method, reference, amount, notes, ctx.userId, now, now);
    for (const a of allocations) db.prepare('INSERT INTO payment_allocations (id, branch_id, payment_id, grn_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), ctx.branchId, id, a.grnId, a.amount, now, now);
    db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, debit, description, user_id, at, updated_at)
      VALUES (?, ?, ?, ?, 'payment', 'supplier_payment', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), ctx.branchId, supplier.id, paidDate, id, docNo, amount, `Payment by ${method}${reference ? ' ' + reference : ''}`, ctx.userId, now, now);
    audit.write(db, ctx.actor, { module: 'supplier_payments', action: 'create', recordType: 'supplier_payment', recordId: id, summary: `Payment ${docNo} of ${money.format(amount, { symbol: '' })} to ${supplier.name}`, new: { amount, method, reference, paidDate, allocations } });
  })();
  return paymentShape(ctx, loadPayment(ctx, id));
}

function cancelPayment(ctx, params) {
  const p = loadPayment(ctx, v.id(params, 'id'));
  assertStatus(p, 'payment', ['posted']);
  const reason = v.text(params, 'reason', 'Reason', { required: true, max: 300 });
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE supplier_payments SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(ctx.userId, now, reason, now, p.id);
    ctx.db.prepare(`INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_date, entry_type, ref_type, ref_id, ref_no, credit, description, user_id, at, updated_at)
      VALUES (?, ?, ?, ?, 'payment_cancel', 'supplier_payment', ?, ?, ?, ?, ?, ?, ?)`).run(newId(), p.branch_id, p.supplier_id, stock.today(), p.id, p.doc_no, p.amount, `Payment cancelled: ${reason}`, ctx.userId, now, now);
    audit.write(ctx.db, ctx.actor, { module: 'supplier_payments', action: 'cancel', recordType: 'supplier_payment', recordId: p.id, summary: `Payment ${p.doc_no} cancelled`, reason });
  })();
  return paymentShape(ctx, loadPayment(ctx, p.id));
}

// ---- lists ---------------------------------------------------------------------------------------------------------

function docList(ctx, params, { table, alias, select, searchCols, dateCol, extra = '' }) {
  const where = [];
  const args = {};
  if (params.branchId === 'all' && seesAllBranches(ctx)) { /* every branch */ } else { where.push(`${alias}.branch_id = @branch`); args.branch = ctx.branchId; }
  if (params.status) { where.push(`${alias}.status = @status`); args.status = params.status; }
  if (params.supplierId) { where.push(`${alias}.supplier_id = @supplier`); args.supplier = params.supplierId; }
  if (params.from) { where.push(`${alias}.${dateCol} >= @from`); args.from = params.from; }
  if (params.to) { where.push(`${alias}.${dateCol} <= @to`); args.to = params.to; }
  if (params.search) { where.push(`(${searchCols.map((c) => `${c} LIKE @q ESCAPE '\\'`).join(' OR ')})`); args.q = like(params.search); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pg = paging(params);
  const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${alias} JOIN suppliers s ON s.id = ${alias}.supplier_id ${extra} ${sql}`).get(args).n;
  const rows = ctx.db.prepare(`SELECT ${select} FROM ${table} ${alias} JOIN suppliers s ON s.id = ${alias}.supplier_id JOIN branches b ON b.id = ${alias}.branch_id ${extra} ${sql}
    ORDER BY ${alias}.${dateCol} ${dir}, ${alias}.doc_no ${dir} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
  return { rows, total, page: pg.page, pageSize: pg.pageSize };
}

function register(define) {
  define('purchases.listPo', { perm: 'purchases.view' }, (ctx, params) => {
    const res = docList(ctx, params, { table: 'purchase_orders', alias: 'po', select: 'po.*, s.name AS supplier_name, b.name AS branch_name', searchCols: ['po.doc_no', 's.name'], dateCol: 'order_date' });
    res.rows = res.rows.map((r) => poShape(ctx, r, false));
    return res;
  });
  define('purchases.getPo', { perm: 'purchases.view' }, (ctx, params) => poShape(ctx, loadPo(ctx, v.id(params, 'id')), true));
  define('purchases.savePo', { perm: 'purchases.create' }, savePo);
  define('purchases.setPoStatus', { perm: 'purchases.edit' }, setPoStatus);

  define('purchases.listGrn', { perm: 'purchases.view' }, (ctx, params) => {
    const res = docList(ctx, params, { table: 'grns', alias: 'g', select: 'g.*, s.name AS supplier_name, b.name AS branch_name, NULL AS po_no', searchCols: ['g.doc_no', 's.name', 'g.supplier_invoice_no'], dateCol: 'received_date' });
    res.rows = res.rows.map((r) => grnShape(ctx, r, false));
    return res;
  });
  define('purchases.getGrn', { perm: 'purchases.view' }, (ctx, params) => grnShape(ctx, loadGrn(ctx, v.id(params, 'id')), true));
  define('purchases.saveGrn', { perm: 'purchases.create' }, saveGrn);
  define('purchases.cancelGrn', { perm: 'purchases.approve' }, cancelGrn);

  define('purchases.listReturns', { perm: 'purchases.view' }, (ctx, params) => {
    const res = docList(ctx, params, { table: 'purchase_returns', alias: 'r', select: 'r.*, s.name AS supplier_name, b.name AS branch_name, NULL AS grn_no', searchCols: ['r.doc_no', 's.name'], dateCol: 'return_date' });
    res.rows = res.rows.map((r) => returnShape(ctx, r, false));
    return res;
  });
  define('purchases.getReturn', { perm: 'purchases.view' }, (ctx, params) => returnShape(ctx, loadReturn(ctx, v.id(params, 'id')), true));
  define('purchases.createReturn', { perm: 'purchases.create' }, createReturn);
  define('purchases.cancelReturn', { perm: 'purchases.approve' }, cancelReturn);

  define('payments.list', { perm: 'supplier_payments.view' }, (ctx, params) => {
    const res = docList(ctx, params, { table: 'supplier_payments', alias: 'p', select: 'p.*, s.name AS supplier_name, b.name AS branch_name', searchCols: ['p.doc_no', 's.name', 'p.reference'], dateCol: 'paid_date' });
    res.rows = res.rows.map((r) => paymentShape(ctx, r));
    return res;
  });
  define('payments.get', { perm: 'supplier_payments.view' }, (ctx, params) => paymentShape(ctx, loadPayment(ctx, v.id(params, 'id'))));
  define('payments.create', { perm: 'supplier_payments.create' }, createPayment);
  define('payments.cancel', { perm: 'supplier_payments.approve' }, cancelPayment);
}

module.exports = { register, allocate, grnTotals };

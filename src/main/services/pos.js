'use strict';
// The counter: price quotes with FEFO batches, manager approvals, bills on hold, and finishing a sale.
// The screen keeps the cart; this service re-checks every line, price, discount, payment and prescription
// before anything is written, and writes the whole sale in one transaction.
const crypto = require('crypto');
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const pricing = require('../core/pricing');
const { verifyPassword } = require('../core/password');
const { nextNo } = require('../core/docs');
const settings = require('./settings');
const customers = require('./customers');
const { shiftForSale } = require('./shifts');
const { allocate } = require('./purchasing');
const { label } = require('./products');
const { permissionSet } = require('../rpc');

const METHODS = ['cash', 'card', 'easypaisa', 'jazzcash', 'bank'];
const APPROVAL_MS = 5 * 60 * 1000;

function loadProduct(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id || '');
  if (!p) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
  if (!p.active) fail('VALIDATION', 'products.inactive', { product: label(p) });
  return p;
}

function unitsOf(db, productId) {
  return db.prepare('SELECT * FROM product_units WHERE product_id = ? AND active = 1 ORDER BY factor, sort').all(productId);
}

function expiryInfo(db, branchId, expiry) {
  const today = stock.today();
  const near = Math.min(...settings.get(db, 'expiry.nearDays', branchId));
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000);
  return { daysLeft: days, expired: expiry < today, nearExpiry: expiry >= today && days <= near };
}

// Sellable batches (not expired, not in quarantine) with what is left after the cart's own reservations.
function sellableBatches(db, branchId, productId, reserved = {}) {
  const today = stock.today();
  return db.prepare(`SELECT b.*, s.qty AS on_hand, COALESCE(bs.quarantined, 0) AS quarantined FROM stock_balances s
      JOIN batches b ON b.id = s.batch_id LEFT JOIN batch_status bs ON bs.branch_id = s.branch_id AND bs.batch_id = s.batch_id
    WHERE s.branch_id = ? AND s.product_id = ? AND s.qty > 0 ORDER BY b.expiry_date, b.received_at, b.id`).all(branchId, productId)
    .filter((b) => !b.quarantined && b.expiry_date >= today)
    .map((b) => ({ ...b, free: b.on_hand - (reserved[b.id] || 0) }))
    .filter((b) => b.free > 0);
}

function unitShape(u, pack, packSize) {
  return { id: u.id, name: u.name, factor: u.factor, sellable: u.sellable === 1, price: pricing.unitPrice(u, pack, packSize), fixedPrice: u.fixed_price };
}

// What the screen shows when an item is added: units with prices, and the batches the quantity will come from.
function quote(ctx, params) {
  const db = ctx.db;
  const p = loadProduct(db, params.productId);
  const units = unitsOf(db, p.id).filter((u) => u.sellable);
  const unit = units.find((u) => u.id === params.unitId) || units.find((u) => u.factor === p.pack_size) || units[0];
  const reserved = {};
  for (const r of Array.isArray(params.reserved) ? params.reserved : []) reserved[r.batchId] = (reserved[r.batchId] || 0) + (Number(r.qty) || 0);
  const batches = sellableBatches(db, ctx.branchId, p.id, reserved);
  const qty = Math.max(Number(params.qty) || 0, 0);
  const base = Math.round(qty * unit.factor);
  const pieces = [];
  let left = base;
  const list = params.batchId ? batches.filter((b) => b.id === params.batchId) : batches;
  for (const b of list) {
    if (left <= 0) break;
    const take = Math.min(left, b.free);
    const pack = pricing.packPrice(db, ctx.branchId, b);
    pieces.push({
      batchId: b.id, batchNo: b.batch_no, expiryDate: b.expiry_date, ...expiryInfo(db, ctx.branchId, b.expiry_date), qty: take, qtyText: stock.qtyText(take, p),
      unitPrice: pricing.unitPrice(unit, pack, p.pack_size), gross: pricing.gross(unit, pack, p.pack_size, take), mrp: b.mrp,
    });
    left -= take;
  }
  const available = batches.reduce((a, b) => a + b.free, 0);
  const firstPack = batches[0] ? pricing.packPrice(db, ctx.branchId, batches[0]) : (pricing.branchPackPrice(db, ctx.branchId, p.id) ?? p.mrp);
  return {
    product: { id: p.id, label: label(p), genericName: p.generic_name, packSize: p.pack_size, packUnit: p.pack_unit, baseUnit: p.base_unit, rxRequired: p.rx_required === 1, controlled: p.controlled === 1, taxBp: p.tax_rate_bp },
    unitId: unit.id, units: units.map((u) => unitShape(u, firstPack, p.pack_size)), pieces, requested: base, short: Math.max(left, 0),
    available, availableText: stock.qtyText(available, p),
    batches: batches.map((b) => ({ batchId: b.id, batchNo: b.batch_no, expiryDate: b.expiry_date, ...expiryInfo(db, ctx.branchId, b.expiry_date), free: b.free, freeText: stock.qtyText(b.free, p), mrp: b.mrp })),
  };
}

// Medicines with the same generic name (salt) that are in stock: shown when an item is out of stock.
function substitutes(ctx, params) {
  const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(params.productId || '');
  if (!p || !p.generic_name) return [];
  return ctx.db.prepare(`SELECT p.*, COALESCE((SELECT SUM(qty) FROM stock_balances s WHERE s.branch_id = @b AND s.product_id = p.id), 0) AS on_hand
    FROM products p WHERE p.active = 1 AND p.id <> @id AND p.generic_name = @g COLLATE NOCASE ORDER BY on_hand DESC, p.brand_name LIMIT 20`)
    .all({ b: ctx.branchId, id: p.id, g: p.generic_name })
    .filter((x) => x.on_hand > 0)
    .map((x) => ({ id: x.id, label: label(x), strength: x.strength, onHand: x.on_hand, onHandText: stock.qtyText(x.on_hand, x), mrp: x.mrp, samestrength: (x.strength || '') === (p.strength || '') }));
}

// ---- manager approval ----------------------------------------------------------------------------------------------

function approvals(app) {
  if (!app.approvals) app.approvals = new Map();
  return app.approvals;
}

// A manager types their login at the counter. The result is a short-lived token naming what they may approve.
async function approve(ctx, params) {
  const username = v.text(params, 'username', 'Manager username', { required: true, max: 40 });
  const password = String(params.password || '');
  const needs = Array.isArray(params.needs) ? params.needs.map(String) : [String(params.needs || '')];
  const user = ctx.db.prepare(`SELECT u.*, r.permissions AS role_permissions, r.is_super, r.active AS role_active FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? COLLATE NOCASE`).get(username);
  if (!user || !(await verifyPassword(password, user.password_hash)) || user.status !== 'active' || !user.role_active) fail('BAD_LOGIN', 'auth.badLogin');
  if (user.id === ctx.userId) fail('FORBIDDEN', 'pos.approverSelf');
  const perms = permissionSet(user);
  const can = (perm) => user.is_super === 1 || perms.has(perm);
  const missing = needs.filter((n) => n && !can(n));
  if (missing.length) fail('FORBIDDEN', 'pos.approverNoRight', { user: user.full_name });
  const token = crypto.randomBytes(18).toString('hex');
  approvals(ctx.app).set(token, { userId: user.id, name: user.full_name, username: user.username, perms: needs, forUser: ctx.userId, expires: Date.now() + APPROVAL_MS, reason: v.text(params, 'reason', 'Reason', { max: 300 }) });
  ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'pos', action: 'manager_approval', recordType: 'user', recordId: user.id, summary: `${user.full_name} approved ${needs.join(', ')} at the counter` }))();
  return { token, approverName: user.full_name };
}

function useApproval(ctx, token) {
  if (!token) return null;
  // A request approved on another computer (Approvals screen) is passed as "req:<id>".
  if (String(token).startsWith('req:')) {
    const r = ctx.db.prepare('SELECT a.*, u.full_name, u.username FROM approval_requests a LEFT JOIN users u ON u.id = a.decided_by WHERE a.id = ?').get(String(token).slice(4));
    const minutes = settings.get(ctx.db, 'approvals.validMinutes', ctx.branchId);
    if (!r || r.status !== 'approved' || r.requested_by !== ctx.userId || r.branch_id !== ctx.branchId || Date.parse(r.decided_at) + minutes * 60000 < Date.now()) {
      fail('APPROVAL', 'pos.approvalInvalid');
    }
    const perms = JSON.parse(r.needs);
    return { userId: r.decided_by, name: r.full_name, username: r.username, perms, reason: r.decision_reason, token, requestId: r.id, can: (perm) => perms.includes(perm) };
  }
  const a = approvals(ctx.app).get(token);
  if (!a || a.expires < Date.now() || a.forUser !== ctx.userId) fail('APPROVAL', 'pos.approvalInvalid');
  return { ...a, token, can: (perm) => a.perms.includes(perm) };
}

// An approval is used once. Call inside the transaction that writes what was approved.
function consumeApproval(ctx, approval, ref) {
  if (!approval) return;
  if (approval.requestId) {
    const now = nowIso();
    ctx.db.prepare("UPDATE approval_requests SET status = 'used', used_at = ?, used_ref = ?, updated_at = ? WHERE id = ? AND status = 'approved'").run(now, ref || null, now, approval.requestId);
  } else {
    approvals(ctx.app).delete(approval.token);
  }
}

// ---- finishing a sale ----------------------------------------------------------------------------------------------

function readLines(ctx, params, mayDo, needed) {
  const db = ctx.db;
  const raw = Array.isArray(params.lines) ? params.lines : [];
  if (!raw.length) fail('VALIDATION', 'pos.emptyBill');
  const today = stock.today();
  return raw.map((l, i) => {
    const p = loadProduct(db, l.productId);
    const unit = db.prepare('SELECT * FROM product_units WHERE id = ? AND product_id = ? AND active = 1').get(l.unitId || '', p.id);
    if (!unit) invalid(`lines.${i}.unitId`, 'pos.unitWrong', { product: label(p) });
    if (!unit.sellable) invalid(`lines.${i}.unitId`, 'pos.notSellable', { product: label(p), unit: unit.name });
    const batch = stock.loadBatch(db, v.id(l, 'batchId', 'Batch'));
    if (batch.product_id !== p.id) invalid(`lines.${i}.batchId`, 'stock.batchWrongProduct');
    if (batch.expiry_date < today) invalid(`lines.${i}.batchId`, 'stock.expiredBatch', { batch: batch.batch_no, product: label(p), date: batch.expiry_date });
    if (stock.isQuarantined(db, ctx.branchId, batch.id)) invalid(`lines.${i}.batchId`, 'stock.quarantined', { batch: batch.batch_no, product: label(p) });
    const qty = v.int(l, 'qty', `Quantity of ${label(p)}`, { required: true, min: 1, max: 10000000 });
    const pack = pricing.packPrice(db, ctx.branchId, batch);
    const listGross = pricing.gross(unit, pack, p.pack_size, qty);
    const typed = l.price === undefined || l.price === null || l.price === '' ? null : v.money(l, 'price', `Price of ${label(p)}`);
    const gross = typed === null ? listGross : pricing.gross(unit, pack, p.pack_size, qty, typed);
    if (gross !== listGross && !mayDo('price.override')) needed.add('price.override');
    const discountBp = v.percent(l, 'discount', `Discount on ${label(p)}`);
    return {
      product: p, unit, batch, qty, pack, listPrice: pricing.unitPrice(unit, pack, p.pack_size), unitPrice: typed === null ? pricing.unitPrice(unit, pack, p.pack_size) : typed,
      gross, discountBp, discount: money.percentOf(gross, discountBp), instructions: v.text(l, 'instructions', 'Dosage instructions', { max: 200 }),
    };
  });
}

function readPrescription(ctx, lines, params) {
  const rx = lines.filter((l) => l.product.rx_required);
  if (!rx.length) return null;
  const p = params.prescription || {};
  const first = rx[0].product;
  const patient = v.text(p, 'patientName', 'Patient name', { max: 120 });
  const doctor = v.text(p, 'doctorName', 'Doctor name', { max: 120 });
  if (!patient || !doctor) fail('RX_NEEDED', 'pos.rxNeeded', { product: label(first) }, { productId: first.id });
  const out = {
    patient_name: patient, patient_cnic: v.text(p, 'patientCnic', 'Patient CNIC', { max: 20 }), patient_phone: v.text(p, 'patientPhone', 'Patient phone', { max: 40 }),
    patient_address: v.text(p, 'patientAddress', 'Patient address', { max: 300 }), doctor_name: doctor, doctor_pmdc: v.text(p, 'doctorPmdc', 'PMDC number', { max: 40 }),
    doctor_clinic: v.text(p, 'doctorClinic', 'Clinic', { max: 120 }), rx_number: v.text(p, 'rxNumber', 'Prescription number', { max: 60 }),
    rx_date: v.date(p, 'rxDate', 'Prescription date'), notes: v.text(p, 'notes', 'Notes', { max: 500 }),
    photo: p.photo ? String(p.photo) : null,
  };
  if (out.photo && (!/^data:image\/(png|jpeg|webp);base64,/.test(out.photo) || out.photo.length > 1500000)) invalid('prescription.photo', 'error.invalid', { field: 'Prescription photo' });
  const controlled = rx.find((l) => l.product.controlled);
  if (controlled && (!out.patient_cnic || !out.doctor_pmdc || !out.rx_number)) fail('RX_NEEDED', 'pos.controlledNeeded', { product: label(controlled.product) }, { productId: controlled.product.id, controlled: true });
  return out;
}

async function complete(ctx, params) {
  const db = ctx.db;
  const approval = useApproval(ctx, params.approvalToken);
  const mayDo = (perm) => ctx.can(perm) || (approval && approval.can(perm));
  const needed = new Set();
  const shift = shiftForSale(ctx);
  const customer = params.customerId ? customers.load(db, params.customerId) : null;
  const lines = readLines(ctx, params, mayDo, needed);

  // Enough stock in each batch for every line together.
  const perBatch = new Map();
  for (const l of lines) perBatch.set(l.batch.id, (perBatch.get(l.batch.id) || 0) + l.qty);
  for (const [batchId, qty] of perBatch) {
    const have = stock.balance(db, ctx.branchId, batchId);
    if (have < qty) {
      const b = lines.find((l) => l.batch.id === batchId).batch;
      fail('NOT_ENOUGH_STOCK', 'stock.notEnough', { available: stock.qtyText(Math.max(have, 0), b), batch: b.batch_no, product: stock.productLabel(b), wanted: stock.qtyText(qty, b) }, { batchId });
    }
  }

  // Bill discount, spread over the lines by their value after line discounts.
  const afterLine = lines.map((l) => l.gross - l.discount);
  const base = money.sum(afterLine);
  const discType = params.billDiscountType === 'amount' ? 'amount' : params.billDiscountType === 'percent' ? 'percent' : null;
  let billDiscount = 0;
  let discValue = null;
  if (discType === 'percent') { discValue = v.percent(params, 'billDiscount', 'Bill discount'); billDiscount = money.percentOf(base, discValue); }
  else if (discType === 'amount') { discValue = v.money(params, 'billDiscount', 'Bill discount', { fallback: 0 }); billDiscount = Math.min(discValue, base); }
  const shares = allocate(billDiscount, afterLine);
  const gross = money.sum(lines.map((l) => l.gross));
  const lineDiscount = money.sum(lines.map((l) => l.discount));
  for (const [i, l] of lines.entries()) {
    l.billDiscount = shares[i];
    l.net = l.gross - l.discount - l.billDiscount;
    l.tax = money.inclusiveTax(l.net, l.product.tax_rate_bp);
    l.cost = stock.valueOf(l.batch.cost, l.qty, l.batch.pack_size);
  }
  // Discount limit: a customer's usual discount is pre-approved; above the larger of the two needs a manager.
  const discountBp = gross ? Math.floor(((lineDiscount + billDiscount) * 10000) / gross) : 0;
  const allowedBp = Math.max(settings.get(db, 'pos.maxDiscountPercent', ctx.branchId) * 100, customer ? customer.discount_bp : 0);
  if (discountBp > allowedBp && !mayDo('discount.above_limit')) needed.add('discount.above_limit');
  const total = money.sum(lines.map((l) => l.net));

  // Payments: cards and wallets exactly, cash may be more (change), the rest is credit.
  const nonCash = (Array.isArray(params.payments) ? params.payments : []).filter((p) => p && p.method !== 'cash' && String(p.amount || '').trim() !== '').map((p, i) => {
    const method = v.oneOf(p, 'method', 'Payment method', METHODS);
    const amount = v.money(p, 'amount', 'Payment amount', { required: true, min: 1 });
    const reference = v.text(p, 'reference', 'Reference', { max: 80 });
    if (!reference && method !== 'card') invalid(`payments.${i}.reference`, 'pos.referenceNeeded', { method: method === 'bank' ? 'bank' : method === 'easypaisa' ? 'Easypaisa' : 'JazzCash' });
    return { method, amount, reference };
  });
  const nonCashTotal = money.sum(nonCash.map((p) => p.amount));
  if (nonCashTotal > total) invalid('payments', 'pos.overpaidCard');
  const tendered = v.money(params, 'cashTendered', 'Cash received', { fallback: 0 });
  const cashApplied = Math.min(tendered, total - nonCashTotal);
  const change = tendered - cashApplied;
  const paid = nonCashTotal + cashApplied;
  const credit = total - paid;
  if (credit > 0) {
    if (!customer) invalid('customerId', 'pos.creditNeedsCustomer');
    if (!mayDo('sales.credit')) needed.add('sales.credit');
    if (!customer.credit_limit) invalid('customerId', 'pos.noCreditLimit', { customer: customer.name });
    const owed = customers.balanceOf(db, customer.id, ctx.branchId) + credit;
    if (owed > customer.credit_limit) invalid('customerId', 'pos.creditLimit', { customer: customer.name, owed: money.format(owed, { symbol: '' }), limit: money.format(customer.credit_limit, { symbol: '' }) });
  }
  if (needed.size) {
    // Tell the screen exactly which approvals are missing so it can ask a manager once.
    const list = [...needed];
    const key = list.includes('discount.above_limit') ? 'pos.discountTooHigh' : list.includes('price.override') ? 'pos.priceNeedsApproval' : 'pos.creditNotAllowed';
    fail('NEEDS_APPROVAL', key, { percent: (discountBp / 100).toFixed(2), max: (allowedBp / 100).toFixed(2) }, { needs: list });
  }
  const rx = readPrescription(ctx, lines, params);

  const id = newId();
  const now = nowIso();
  const today = stock.today();
  let docNo;
  db.transaction(() => {
    docNo = nextNo(ctx, 'INV');
    const rxId = rx ? newId() : null;
    const insertRx = () => db.prepare(`INSERT INTO prescriptions (id, branch_id, sale_id, patient_name, patient_cnic, patient_phone, patient_address, doctor_name, doctor_pmdc, doctor_clinic,
          rx_number, rx_date, photo, notes, user_id, created_at, updated_at)
        VALUES (@id, @branch, @sale, @patient_name, @patient_cnic, @patient_phone, @patient_address, @doctor_name, @doctor_pmdc, @doctor_clinic, @rx_number, @rx_date, @photo, @notes, @user, @now, @now)`)
        .run({ ...rx, id: rxId, branch: ctx.branchId, sale: id, user: ctx.userId, now });
    db.prepare(`INSERT INTO sales (id, branch_id, doc_no, device_id, shift_id, customer_id, cashier_id, status, sold_at, sale_date, gross, line_discount, bill_discount,
        bill_discount_type, bill_discount_value, tax, total, paid, tendered, change_given, credit_amount, cost, approved_by, approval_reason, prescription_id, notes, created_at, updated_at)
      VALUES (@id, @branch, @doc, @device, @shift, @customer, @cashier, 'completed', @now, @today, @gross, @lineDiscount, @billDiscount,
        @discType, @discValue, @tax, @total, @paid, @tendered, @change, @credit, @cost, @approvedBy, @approvalReason, @rx, @notes, @now, @now)`).run({
      id, branch: ctx.branchId, doc: docNo, device: ctx.app.device.id, shift: shift ? shift.id : null, customer: customer ? customer.id : null, cashier: ctx.userId,
      now, today, gross, lineDiscount, billDiscount, discType, discValue, tax: money.sum(lines.map((l) => l.tax)), total, paid, tendered: tendered || null, change, credit,
      cost: money.sum(lines.map((l) => l.cost)), approvedBy: approval ? approval.userId : null, approvalReason: approval ? approval.reason : null, rx: rxId,
      notes: v.text(params, 'notes', 'Notes', { max: 300 }),
    });
    // The prescription points at the sale, so it is written after it.
    if (rx) insertRx();
    const insLine = db.prepare(`INSERT INTO sale_lines (id, sale_id, branch_id, line_no, product_id, batch_id, unit_id, unit_name, unit_factor, qty, unit_price, list_price,
        gross, discount_bp, discount, bill_discount, tax_bp, tax, net, cost, instructions, created_at, updated_at)
      VALUES (@id, @sale, @branch, @no, @product, @batch, @unit, @unitName, @factor, @qty, @unitPrice, @listPrice, @gross, @discountBp, @discount, @billDiscount, @taxBp, @tax, @net, @cost, @instructions, @now, @now)`);
    for (const [i, l] of lines.entries()) {
      insLine.run({ id: newId(), sale: id, branch: ctx.branchId, no: i + 1, product: l.product.id, batch: l.batch.id, unit: l.unit.id, unitName: l.unit.name, factor: l.unit.factor,
        qty: l.qty, unitPrice: l.unitPrice, listPrice: l.listPrice, gross: l.gross, discountBp: l.discountBp, discount: l.discount, billDiscount: l.billDiscount,
        taxBp: l.product.tax_rate_bp, tax: l.tax, net: l.net, cost: l.cost, instructions: l.instructions, now });
      stock.post(db, ctx.actor, { branchId: ctx.branchId, batch: l.batch, qty: -l.qty, movement: 'SALE', refType: 'sale', refId: id, refNo: docNo, at: now });
    }
    const insPay = db.prepare(`INSERT INTO sale_payments (id, branch_id, sale_id, shift_id, kind, method, amount, reference, user_id, at, updated_at) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?)`);
    if (cashApplied > 0) insPay.run(newId(), ctx.branchId, id, shift ? shift.id : null, 'cash', cashApplied, null, ctx.userId, now, now);
    for (const p of nonCash) insPay.run(newId(), ctx.branchId, id, shift ? shift.id : null, p.method, p.amount, p.reference, ctx.userId, now, now);
    if (customer) {
      customers.ledgerEntry(db, ctx, { customerId: customer.id, branchId: ctx.branchId, date: today, type: 'sale', refType: 'sale', refId: id, refNo: docNo, debit: total, description: 'Bill' });
      customers.ledgerEntry(db, ctx, { customerId: customer.id, branchId: ctx.branchId, date: today, type: 'sale_payment', refType: 'sale', refId: id, refNo: docNo, credit: paid, description: 'Paid at the counter' });
    }
    if (params.holdId) db.prepare('DELETE FROM held_bills WHERE id = ?').run(params.holdId);
    audit.write(db, ctx.actor, {
      module: 'pos', action: 'sale', recordType: 'sale', recordId: id,
      summary: `Bill ${docNo}: ${lines.length} line(s), total ${money.format(total, { symbol: '' })}${credit ? `, credit ${money.format(credit, { symbol: '' })}` : ''}${approval ? `, approved by ${approval.name}` : ''}`,
      new: { total, paid, credit, change, discount: lineDiscount + billDiscount, customer: customer ? customer.name : null },
    });
    consumeApproval(ctx, approval, docNo);
  })();
  return { id, docNo, total, paid, change, credit, autoPrint: settings.get(db, 'receipt.autoPrint', ctx.branchId) };
}

// ---- bills on hold -------------------------------------------------------------------------------------------------

function register(define) {
  define('pos.context', { perm: 'pos.view' }, (ctx) => {
    const s = settings.readAll(ctx.db, ctx.branchId).values;
    return {
      maxDiscountPercent: s['pos.maxDiscountPercent'], requireShift: s['pos.requireShift'], returnApprovalValue: s['pos.returnApprovalValue'],
      paper: s['receipt.paper'], autoPrint: s['receipt.autoPrint'], nearExpiryDays: Math.min(...s['expiry.nearDays']),
      can: { credit: ctx.can('sales.credit'), discount: ctx.can('discount.above_limit'), price: ctx.can('price.override'), customers: ctx.can('customers.create') },
    };
  });
  define('pos.quote', { perm: 'pos.view' }, quote);
  define('pos.substitutes', { perm: 'pos.view' }, substitutes);
  define('pos.approve', { perm: 'pos.view' }, approve);
  define('pos.complete', { perm: 'pos.create' }, complete);

  define('pos.hold', { perm: 'pos.create' }, (ctx, params) => {
    const cart = params.cart && typeof params.cart === 'object' ? params.cart : null;
    if (!cart || !Array.isArray(cart.lines) || !cart.lines.length) fail('VALIDATION', 'pos.emptyBill');
    const json = JSON.stringify(cart);
    if (json.length > 2000000) invalid('cart', 'error.tooLong', { field: 'Bill', max: '2 MB' });
    const id = newId();
    ctx.db.prepare('INSERT INTO held_bills (id, branch_id, user_id, label, cart, item_count, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.branchId, ctx.userId, v.text(params, 'label', 'Name', { max: 60 }), json, cart.lines.length, Number.isSafeInteger(params.total) ? params.total : 0, nowIso());
    return { id };
  });
  define('pos.holds', { perm: 'pos.view' }, (ctx) => ctx.db.prepare(`SELECT h.id, h.label, h.item_count, h.total, h.created_at, u.full_name FROM held_bills h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.branch_id = ? ORDER BY h.created_at`).all(ctx.branchId).map((r) => ({ id: r.id, label: r.label, items: r.item_count, total: r.total, createdAt: r.created_at, by: r.full_name })));
  define('pos.resume', { perm: 'pos.create' }, (ctx, params) => {
    const row = ctx.db.prepare('SELECT * FROM held_bills WHERE id = ? AND branch_id = ?').get(params.id || '', ctx.branchId);
    if (!row) fail('NOT_FOUND', 'pos.holdNotFound');
    ctx.db.prepare('DELETE FROM held_bills WHERE id = ?').run(row.id);
    return { cart: JSON.parse(row.cart), label: row.label };
  });
  define('pos.dropHold', { perm: 'pos.create' }, (ctx, params) => {
    ctx.db.prepare('DELETE FROM held_bills WHERE id = ? AND branch_id = ?').run(params.id || '', ctx.branchId);
    return { dropped: true };
  });
}

module.exports = { register, quote, useApproval, consumeApproval, approvals, METHODS };

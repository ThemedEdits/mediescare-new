'use strict';
// Drug master: products, selling units, barcodes, per-branch values, price history, and fast search for pickers.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const { nextNo, canSeeCost, paging, like } = require('../core/docs');
const lookups = require('./lookups');

const COST_FIELDS = ['tradePrice', 'stockValue', 'lastCost'];

const BASE_SELECT = `SELECT p.*,
    fl.name AS form_name, cl.name AS category_name, ml.name AS manufacturer_name, dl.name AS drug_class_name, sl.name AS storage_name,
    s.name AS supplier_name,
    pb.rack, pb.min_stock AS b_min, pb.max_stock AS b_max, pb.reorder_level AS b_reorder, pb.reorder_qty AS b_reorder_qty, pb.mrp_override,
    COALESCE((SELECT SUM(sb.qty) FROM stock_balances sb WHERE sb.branch_id = @branch AND sb.product_id = p.id), 0) AS on_hand
  FROM products p
  LEFT JOIN lookups fl ON fl.id = p.form_id
  LEFT JOIN lookups cl ON cl.id = p.category_id
  LEFT JOIN lookups ml ON ml.id = p.manufacturer_id
  LEFT JOIN lookups dl ON dl.id = p.drug_class_id
  LEFT JOIN lookups sl ON sl.id = p.storage_id
  LEFT JOIN suppliers s ON s.id = p.default_supplier_id
  LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = @branch`;

// Effective stock levels: the branch value when set, otherwise the product value.
function levels(r) {
  return {
    minStock: r.b_min ?? r.min_stock,
    maxStock: r.b_max ?? r.max_stock,
    reorderLevel: r.b_reorder ?? r.reorder_level,
    reorderQty: r.b_reorder_qty ?? r.reorder_qty,
  };
}

function stockStatus(onHand, lv) {
  if (onHand <= 0) return 'out';
  if (lv.reorderLevel > 0 && onHand <= lv.reorderLevel) return 'low';
  if (lv.minStock > 0 && onHand < lv.minStock) return 'low';
  if (lv.maxStock > 0 && onHand > lv.maxStock) return 'over';
  return 'ok';
}

function label(r) {
  return [r.brand_name, r.strength].filter(Boolean).join(' ');
}

function shapeRow(ctx, r) {
  const lv = levels(r);
  const out = {
    id: r.id, sku: r.sku, brandName: r.brand_name, genericName: r.generic_name, strength: r.strength, label: label(r),
    formId: r.form_id, formName: r.form_name, categoryId: r.category_id, categoryName: r.category_name,
    manufacturerId: r.manufacturer_id, manufacturerName: r.manufacturer_name, drugClassId: r.drug_class_id, drugClassName: r.drug_class_name,
    storageId: r.storage_id, storageName: r.storage_name,
    baseUnit: r.base_unit, packUnit: r.pack_unit, packSize: r.pack_size,
    rxRequired: r.rx_required === 1, controlled: r.controlled === 1, coldChain: r.cold_chain === 1, drapRegNo: r.drap_reg_no,
    taxRateBp: r.tax_rate_bp, defaultDiscountBp: r.default_discount_bp || 0, discountPercent: (r.default_discount_bp || 0) / 100, mrp: r.mrp, tradePrice: r.trade_price, branchMrp: r.mrp_override,
    productMinStock: r.min_stock, productMaxStock: r.max_stock, productReorderLevel: r.reorder_level, productReorderQty: r.reorder_qty,
    ...lv, rack: r.rack,
    defaultSupplierId: r.default_supplier_id, defaultSupplierName: r.supplier_name, notes: r.notes, active: r.active === 1,
    onHand: r.on_hand, onHandText: stock.qtyText(r.on_hand, r), stockStatus: stockStatus(r.on_hand, lv),
    updatedAt: r.updated_at,
  };
  if (r.stock_value !== undefined) out.stockValue = r.stock_value;
  if (r.nearest_expiry !== undefined) out.nearestExpiry = r.nearest_expiry;
  if (!canSeeCost(ctx)) for (const f of COST_FIELDS) if (f in out) out[f] = null;
  return out;
}

function loadRow(ctx, id) {
  const r = ctx.db.prepare(`${BASE_SELECT} WHERE p.id = @id`).get({ branch: ctx.branchId, id });
  if (!r) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
  return r;
}

function detail(ctx, id) {
  const r = loadRow(ctx, id);
  const out = shapeRow(ctx, r);
  out.image = r.image;
  out.units = ctx.db.prepare('SELECT * FROM product_units WHERE product_id = ? AND active = 1 ORDER BY factor, sort').all(id)
    .map((u) => ({ id: u.id, name: u.name, factor: u.factor, sellable: u.sellable === 1, fixedPrice: u.fixed_price }));
  out.barcodes = ctx.db.prepare('SELECT * FROM product_barcodes WHERE product_id = ? AND active = 1 ORDER BY created_at').all(id)
    .map((b) => ({ id: b.id, barcode: b.barcode, unitId: b.unit_id }));
  out.hasMovements = !!ctx.db.prepare('SELECT 1 FROM stock_ledger WHERE product_id = ? LIMIT 1').get(id);
  return out;
}

// Reads and checks the product form. `existing` is the current row on edit.
function readForm(ctx, params, existing) {
  const db = ctx.db;
  const f = {
    brand_name: v.text(params, 'brandName', 'Brand name', { required: true, max: 120 }),
    generic_name: v.text(params, 'genericName', 'Generic name (salt)', { max: 200 }),
    strength: v.text(params, 'strength', 'Strength', { max: 60 }),
    base_unit: v.text(params, 'baseUnit', 'Smallest unit', { required: true, max: 30 }),
    pack_unit: v.text(params, 'packUnit', 'Pack unit', { required: true, max: 30 }),
    pack_size: v.int(params, 'packSize', 'Units in one pack', { required: true, min: 1, max: 100000 }),
    rx_required: v.bool(params, 'rxRequired') ? 1 : 0,
    controlled: v.bool(params, 'controlled') ? 1 : 0,
    cold_chain: v.bool(params, 'coldChain') ? 1 : 0,
    drap_reg_no: v.text(params, 'drapRegNo', 'DRAP registration number', { max: 60 }),
    tax_rate_bp: v.percent(params, 'taxRate', 'Tax rate'),
    default_discount_bp: v.percent(params, 'discountPercent', 'Discount'),
    mrp: v.money(params, 'mrp', 'MRP (per pack)', { fallback: 0 }),
    trade_price: existing && !canSeeCost(ctx) ? existing.trade_price : v.money(params, 'tradePrice', 'Trade price (per pack)', { fallback: 0 }),
    min_stock: v.int(params, 'minStock', 'Minimum stock', { fallback: 0 }),
    max_stock: v.int(params, 'maxStock', 'Maximum stock', { fallback: 0 }),
    reorder_level: v.int(params, 'reorderLevel', 'Reorder level', { fallback: 0 }),
    reorder_qty: v.int(params, 'reorderQty', 'Reorder quantity', { fallback: 0 }),
    default_supplier_id: v.optionalId(params, 'defaultSupplierId', 'Supplier'),
    notes: v.text(params, 'notes', 'Notes', { max: 1000 }),
  };
  if (f.controlled && !f.rx_required) invalid('rxRequired', 'products.controlledNeedsRx');
  if (f.max_stock && f.max_stock < f.min_stock) invalid('maxStock', 'products.maxBelowMin');
  if (f.default_supplier_id && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(f.default_supplier_id)) invalid('defaultSupplierId', 'error.invalid', { field: 'Supplier' });
  // List fields accept an id, or a typed name that is added to the list.
  for (const [field, kind, col] of [['formId', 'form', 'form_id'], ['categoryId', 'category', 'category_id'], ['manufacturerId', 'manufacturer', 'manufacturer_id'], ['drugClassId', 'drug_class', 'drug_class_id'], ['storageId', 'storage', 'storage_id']]) {
    const raw = params[field];
    const newName = params[`${field}New`] ? String(params[`${field}New`]).trim() : '';
    if (raw && db.prepare('SELECT 1 FROM lookups WHERE id = ? AND kind = ?').get(raw, kind)) {
      f[col] = raw;
    } else if (raw && db.prepare('SELECT id FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, String(raw).trim())) {
      f[col] = db.prepare('SELECT id FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, String(raw).trim()).id;
    } else if (newName) {
      f[col] = { newName, kind };
    } else if (raw && (kind === 'manufacturer' || !/^[0-9a-zA-Z]{26}$/.test(String(raw)))) {
      f[col] = { newName: String(raw).trim(), kind };
    } else if (raw) {
      invalid(field, 'error.invalid', { field });
    } else {
      f[col] = null;
    }
  }
  if (params.image !== undefined) {
    const img = params.image ? String(params.image) : null;
    if (img && (!/^data:image\/(png|jpeg|webp);base64,/.test(img) || img.length > 300000)) invalid('image', 'error.invalid', { field: 'Picture' });
    f.image = img;
  }
  const sku = v.text(params, 'sku', 'SKU', { max: 40 });
  if (sku) {
    if (!/^[A-Za-z0-9._\-/]+$/.test(sku)) invalid('sku', 'error.invalid', { field: 'SKU' });
    if (db.prepare('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?').get(sku, existing ? existing.id : '')) invalid('sku', 'products.skuTaken');
  }
  f.sku = sku;

  // Extra selling units (base and pack units are kept automatically).
  const extra = [];
  for (const [i, u] of (Array.isArray(params.units) ? params.units : []).entries()) {
    const name = v.text(u, 'name', 'Unit name', { required: true, max: 30 });
    const factor = v.int(u, 'factor', 'Units inside', { required: true, min: 1, max: 1000000 });
    extra.push({ id: u.id || null, name, factor, sellable: u.sellable === false ? 0 : 1, fixed_price: v.money(u, 'fixedPrice', 'Fixed price'), sort: i + 2 });
  }
  const names = [f.base_unit, f.pack_size > 1 ? f.pack_unit : null, ...extra.map((u) => u.name)].filter(Boolean).map((n) => n.toLowerCase());
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) invalid('units', 'products.unitDuplicate', { name: dup });

  const barcodes = [];
  for (const b of Array.isArray(params.barcodes) ? params.barcodes : []) {
    const code = String(typeof b === 'string' ? b : b.barcode || '').trim();
    if (!code) continue;
    if (code.length < 3 || code.length > 64 || /\s/.test(code)) invalid('barcodes', 'error.invalid', { field: 'Barcode' });
    if (barcodes.some((x) => x.barcode === code)) invalid('barcodes', 'products.barcodeTwice', { barcode: code });
    const clash = db.prepare(`SELECT p.brand_name, p.strength FROM product_barcodes b JOIN products p ON p.id = b.product_id
      WHERE b.barcode = ? AND b.active = 1 AND b.product_id <> ?`).get(code, existing ? existing.id : '');
    if (clash) invalid('barcodes', 'products.barcodeTaken', { barcode: code, product: label(clash) });
    barcodes.push({ barcode: code, unitName: typeof b === 'object' ? b.unitName || null : null });
  }
  return { f, extra, barcodes };
}

function resolveLookups(ctx, f) {
  for (const col of ['form_id', 'category_id', 'manufacturer_id', 'drug_class_id', 'storage_id']) {
    if (f[col] && typeof f[col] === 'object') f[col] = lookups.ensure(ctx.db, ctx.actor, f[col].kind, f[col].newName);
  }
}

function syncUnits(ctx, productId, f, extra) {
  const db = ctx.db;
  const now = nowIso();
  const current = db.prepare('SELECT * FROM product_units WHERE product_id = ?').all(productId);
  const wanted = [
    { name: f.base_unit, factor: 1, sellable: 1, fixed_price: null, sort: 0 },
    ...(f.pack_size > 1 ? [{ name: f.pack_unit, factor: f.pack_size, sellable: 1, fixed_price: null, sort: 1 }] : []),
    ...extra,
  ];
  const keep = new Set();
  for (const w of wanted) {
    const match = current.find((c) => c.name.toLowerCase() === w.name.toLowerCase());
    if (match) {
      keep.add(match.id);
      if (match.factor !== w.factor || match.sellable !== w.sellable || match.fixed_price !== w.fixed_price || match.sort !== w.sort || !match.active || match.name !== w.name) {
        db.prepare('UPDATE product_units SET name = ?, factor = ?, sellable = ?, fixed_price = ?, sort = ?, active = 1, updated_at = ? WHERE id = ?')
          .run(w.name, w.factor, w.sellable, w.fixed_price, w.sort, now, match.id);
      }
    } else {
      const id = newId();
      keep.add(id);
      db.prepare('INSERT INTO product_units (id, product_id, name, factor, sellable, fixed_price, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
        .run(id, productId, w.name, w.factor, w.sellable, w.fixed_price, w.sort, now, now);
    }
  }
  for (const c of current) if (!keep.has(c.id) && c.active) db.prepare('UPDATE product_units SET active = 0, updated_at = ? WHERE id = ?').run(now, c.id);
}

function syncBarcodes(ctx, productId, barcodes) {
  const db = ctx.db;
  const now = nowIso();
  const current = db.prepare('SELECT * FROM product_barcodes WHERE product_id = ?').all(productId);
  const units = db.prepare('SELECT id, name FROM product_units WHERE product_id = ? AND active = 1').all(productId);
  const keep = new Set();
  for (const b of barcodes) {
    const unit = b.unitName ? units.find((u) => u.name.toLowerCase() === String(b.unitName).toLowerCase()) : null;
    const match = current.find((c) => c.barcode === b.barcode);
    if (match) {
      keep.add(match.id);
      if (!match.active || (unit && match.unit_id !== unit.id)) db.prepare('UPDATE product_barcodes SET active = 1, unit_id = ?, updated_at = ? WHERE id = ?').run(unit ? unit.id : match.unit_id, now, match.id);
    } else {
      const id = newId();
      keep.add(id);
      db.prepare('INSERT INTO product_barcodes (id, product_id, unit_id, barcode, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(id, productId, unit ? unit.id : null, b.barcode, now, now);
    }
  }
  for (const c of current) if (!keep.has(c.id) && c.active) db.prepare('UPDATE product_barcodes SET active = 0, updated_at = ? WHERE id = ?').run(now, c.id);
}

function recordPrice(ctx, productId, branchId, field, oldValue, newValue, source, reason) {
  if (oldValue === newValue) return;
  const at = nowIso();
  ctx.db.prepare(`INSERT INTO price_history (id, product_id, branch_id, field, old_value, new_value, source, reason, user_id, at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), productId, branchId, field, oldValue, newValue, source, reason || null, ctx.userId || null, at, at);
}

// Creates a product inside the caller's transaction. Shared with the importer.
function insertProduct(ctx, f, extra, barcodes) {
  resolveLookups(ctx, f);
  const id = newId();
  const now = nowIso();
  const sku = f.sku || nextNo(ctx, 'SKU');
  ctx.db.prepare(`INSERT INTO products (id, sku, brand_name, generic_name, strength, form_id, category_id, manufacturer_id, drug_class_id, storage_id,
      base_unit, pack_unit, pack_size, rx_required, controlled, cold_chain, drap_reg_no, tax_rate_bp, default_discount_bp, mrp, trade_price,
      min_stock, max_stock, reorder_level, reorder_qty, default_supplier_id, image, notes, active, created_by, created_at, updated_at)
    VALUES (@id, @sku, @brand_name, @generic_name, @strength, @form_id, @category_id, @manufacturer_id, @drug_class_id, @storage_id,
      @base_unit, @pack_unit, @pack_size, @rx_required, @controlled, @cold_chain, @drap_reg_no, @tax_rate_bp, @default_discount_bp, @mrp, @trade_price,
      @min_stock, @max_stock, @reorder_level, @reorder_qty, @default_supplier_id, @image, @notes, 1, @by, @now, @now)`)
    .run({ ...f, image: f.image || null, id, sku, by: ctx.userId || null, now });
  syncUnits(ctx, id, f, extra);
  syncBarcodes(ctx, id, barcodes);
  recordPrice(ctx, id, null, 'mrp', null, f.mrp, 'create');
  recordPrice(ctx, id, null, 'trade_price', null, f.trade_price, 'create');
  audit.write(ctx.db, ctx.actor, { module: 'products', action: 'create', recordType: 'product', recordId: id, branchId: null, summary: `Product ${label(f)} (${sku}) created`, new: { ...f, image: undefined } });
  return id;
}

const EDIT_FIELDS = ['sku', 'brand_name', 'generic_name', 'strength', 'form_id', 'category_id', 'manufacturer_id', 'drug_class_id', 'storage_id', 'base_unit', 'pack_unit', 'pack_size',
  'rx_required', 'controlled', 'cold_chain', 'drap_reg_no', 'tax_rate_bp', 'default_discount_bp', 'mrp', 'trade_price', 'min_stock', 'max_stock', 'reorder_level', 'reorder_qty', 'default_supplier_id', 'notes'];

function update(ctx, params) {
  const db = ctx.db;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(v.id(params, 'id'));
  if (!existing) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
  const { f, extra, barcodes } = readForm(ctx, params, existing);
  if (!f.sku) f.sku = existing.sku;
  if (f.pack_size !== existing.pack_size && db.prepare('SELECT 1 FROM stock_ledger WHERE product_id = ? LIMIT 1').get(existing.id)) invalid('packSize', 'products.packLocked');
  const reason = v.text(params, 'priceReason', 'Reason for the price change', { max: 300 });
  db.transaction(() => applyUpdate(ctx, existing, f, extra, barcodes, reason))();
  return detail(ctx, existing.id);
}

// Writes an edit inside the caller's transaction. Shared with the importer.
function applyUpdate(ctx, existing, f, extra, barcodes, reason) {
  const db = ctx.db;
  resolveLookups(ctx, f);
  const before = Object.fromEntries(EDIT_FIELDS.map((k) => [k, existing[k]]));
  const after = Object.fromEntries(EDIT_FIELDS.map((k) => [k, f[k]]));
  const change = audit.diff(before, after);
  const sets = EDIT_FIELDS.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE products SET ${sets}${f.image !== undefined ? ', image = @image' : ''}, updated_at = @now WHERE id = @id`).run({ ...f, image: f.image === undefined ? null : f.image, id: existing.id, now: nowIso() });
  syncUnits(ctx, existing.id, f, extra);
  syncBarcodes(ctx, existing.id, barcodes);
  recordPrice(ctx, existing.id, null, 'mrp', existing.mrp, f.mrp, 'edit', reason);
  recordPrice(ctx, existing.id, null, 'trade_price', existing.trade_price, f.trade_price, 'edit', reason);
  audit.write(db, ctx.actor, { module: 'products', action: 'update', recordType: 'product', recordId: existing.id, branchId: null, summary: `Product ${label(f)} changed${change.changed ? ` (${Object.keys(change.new).join(', ')})` : ''}`, old: change.old, new: change.new, reason });
}

// Search used by every product picker (POS, purchase, transfer, adjustment). Barcode matches come first.
function search(ctx, params) {
  const q = String(params.q || '').trim();
  const limit = Math.min(Number(params.limit) || 20, 100);
  const args = { branch: ctx.branchId, q: like(q), exact: q, limit };
  const activeSql = params.includeInactive ? '' : 'AND p.active = 1';
  let rows = [];
  if (q) {
    const byBarcode = ctx.db.prepare(`${BASE_SELECT} WHERE p.id IN (SELECT product_id FROM product_barcodes WHERE barcode = @exact AND active = 1) ${activeSql}`).all(args);
    const byText = ctx.db.prepare(`${BASE_SELECT}
      WHERE (p.brand_name LIKE @q ESCAPE '\\' OR p.generic_name LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\' OR p.strength LIKE @q ESCAPE '\\'
        OR ml.name LIKE @q ESCAPE '\\') ${activeSql}
      ORDER BY CASE WHEN p.brand_name LIKE @exact || '%' THEN 0 WHEN p.generic_name LIKE @exact || '%' THEN 1 ELSE 2 END, p.brand_name COLLATE NOCASE
      LIMIT @limit`).all(args);
    const seen = new Set();
    rows = [...byBarcode, ...byText].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  } else {
    rows = ctx.db.prepare(`${BASE_SELECT} WHERE 1 = 1 ${activeSql} ORDER BY p.brand_name COLLATE NOCASE LIMIT @limit`).all(args);
  }
  const today = stock.today();
  const nearest = ctx.db.prepare(`SELECT MIN(b.expiry_date) AS e FROM stock_balances s JOIN batches b ON b.id = s.batch_id
    WHERE s.branch_id = ? AND s.product_id = ? AND s.qty > 0 AND b.expiry_date >= ?`);
  return rows.map((r) => {
    const out = shapeRow(ctx, r);
    out.nearestExpiry = nearest.get(ctx.branchId, r.id, today).e;
    out.barcodeMatch = q && ctx.db.prepare('SELECT 1 FROM product_barcodes WHERE product_id = ? AND barcode = ? AND active = 1').get(r.id, q) ? true : false;
    return out;
  });
}

const LIST_SORT = {
  brandName: 'p.brand_name COLLATE NOCASE', genericName: 'p.generic_name COLLATE NOCASE', sku: 'p.sku', categoryName: 'cl.name',
  manufacturerName: 'ml.name', onHand: 'on_hand', mrp: 'p.mrp', updatedAt: 'p.updated_at',
};

function listWhere(ctx, params) {
  const where = [];
  const args = { branch: ctx.branchId };
  if (params.search) {
    where.push(`(p.brand_name LIKE @q ESCAPE '\\' OR p.generic_name LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\' OR p.strength LIKE @q ESCAPE '\\'
      OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode = @exact AND active = 1))`);
    args.q = like(params.search);
    args.exact = String(params.search).trim();
  }
  for (const [key, col] of [['categoryId', 'p.category_id'], ['manufacturerId', 'p.manufacturer_id'], ['formId', 'p.form_id'], ['supplierId', 'p.default_supplier_id']]) {
    if (params[key]) { where.push(`${col} = @${key}`); args[key] = params[key]; }
  }
  if (params.status === 'active') where.push('p.active = 1');
  if (params.status === 'inactive') where.push('p.active = 0');
  if (params.rx === 'rx') where.push('p.rx_required = 1');
  if (params.rx === 'controlled') where.push('p.controlled = 1');
  const reorder = 'COALESCE(pb.reorder_level, p.reorder_level)';
  const min = 'COALESCE(pb.min_stock, p.min_stock)';
  const max = 'COALESCE(pb.max_stock, p.max_stock)';
  if (params.stockStatus === 'out') where.push('on_hand <= 0');
  if (params.stockStatus === 'low') where.push(`on_hand > 0 AND ((${reorder} > 0 AND on_hand <= ${reorder}) OR (${min} > 0 AND on_hand < ${min}))`);
  if (params.stockStatus === 'over') where.push(`${max} > 0 AND on_hand > ${max}`);
  if (params.stockStatus === 'in') where.push('on_hand > 0');
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

function list(ctx, params) {
  const { sql, args } = listWhere(ctx, params);
  const pg = paging(params);
  const sort = LIST_SORT[params.sort] || 'p.brand_name COLLATE NOCASE';
  const dir = params.dir === 'desc' ? 'DESC' : 'ASC';
  // SQLite lets WHERE use the on_hand result alias, so stock status filters page correctly in SQL.
  const rows = ctx.db.prepare(`${BASE_SELECT} ${sql} ORDER BY ${sort} ${dir}, p.id LIMIT @limit OFFSET @offset`)
    .all({ ...args, limit: pg.limit, offset: pg.offset });
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${BASE_SELECT} ${sql})`).get(args).n;
  // Stock value per product at batch cost, only for people who may see cost.
  const valueStmt = ctx.db.prepare(`SELECT s.qty, b.cost, p.pack_size FROM stock_balances s JOIN batches b ON b.id = s.batch_id JOIN products p ON p.id = s.product_id
    WHERE s.branch_id = ? AND s.product_id = ? AND s.qty <> 0`);
  const nearest = ctx.db.prepare(`SELECT MIN(b.expiry_date) AS e FROM stock_balances s JOIN batches b ON b.id = s.batch_id WHERE s.branch_id = ? AND s.product_id = ? AND s.qty > 0`);
  return {
    rows: rows.map((r) => {
      if (canSeeCost(ctx)) r.stock_value = valueStmt.all(ctx.branchId, r.id).reduce((acc, x) => acc + stock.valueOf(x.cost, x.qty, x.pack_size), 0);
      r.nearest_expiry = nearest.get(ctx.branchId, r.id).e;
      return shapeRow(ctx, r);
    }),
    total, page: pg.page, pageSize: pg.pageSize,
  };
}

function register(define) {
  define('products.search', { perm: ['products.view', 'pos.view', 'purchases.view', 'transfers.view', 'stock.view'] }, search);
  define('products.list', { perm: 'products.view' }, list);
  define('products.get', { perm: ['products.view', 'pos.view', 'purchases.view', 'transfers.view', 'stock.view'] }, (ctx, params) => detail(ctx, v.id(params, 'id')));

  define('products.create', { perm: 'products.create' }, (ctx, params) => {
    const { f, extra, barcodes } = readForm(ctx, params, null);
    if (!canSeeCost(ctx)) f.trade_price = 0;
    let id;
    ctx.db.transaction(() => { id = insertProduct(ctx, f, extra, barcodes); })();
    return detail(ctx, id);
  });

  define('products.update', { perm: 'products.edit' }, update);

  define('products.setActive', { perm: 'products.delete' }, (ctx, params) => {
    const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(v.id(params, 'id'));
    if (!p) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
    const active = v.bool(params, 'active');
    const reason = v.text(params, 'reason', 'Reason', { required: !active, max: 300 });
    if ((p.active === 1) === active) return detail(ctx, p.id);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE products SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), p.id);
      audit.write(ctx.db, ctx.actor, { module: 'products', action: active ? 'activate' : 'deactivate', recordType: 'product', recordId: p.id, branchId: null, summary: `Product ${label(p)} ${active ? 're-activated' : 'deactivated'}`, reason });
    })();
    return detail(ctx, p.id);
  });

  // Branch values: shelf, stock levels and branch selling price (the price needs its own permission).
  define('products.setBranch', { perm: 'products.edit' }, (ctx, params) => {
    const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(v.id(params, 'id'));
    if (!p) fail('NOT_FOUND', 'error.notFound', { thing: 'product' });
    const current = ctx.db.prepare('SELECT * FROM product_branch WHERE product_id = ? AND branch_id = ?').get(p.id, ctx.branchId);
    const next = {
      rack: v.text(params, 'rack', 'Shelf or rack', { max: 40 }),
      min_stock: v.int(params, 'minStock', 'Minimum stock'),
      max_stock: v.int(params, 'maxStock', 'Maximum stock'),
      reorder_level: v.int(params, 'reorderLevel', 'Reorder level'),
      reorder_qty: v.int(params, 'reorderQty', 'Reorder quantity'),
      mrp_override: current ? current.mrp_override : null,
    };
    if (params.branchMrp !== undefined) {
      if (!ctx.can('prices.branch_override')) fail('FORBIDDEN', 'error.noPermission');
      next.mrp_override = v.money(params, 'branchMrp', 'Branch price');
    }
    if (next.max_stock !== null && next.min_stock !== null && next.max_stock && next.max_stock < next.min_stock) invalid('maxStock', 'products.maxBelowMin');
    const now = nowIso();
    ctx.db.transaction(() => {
      if (current) {
        ctx.db.prepare('UPDATE product_branch SET rack = @rack, min_stock = @min_stock, max_stock = @max_stock, reorder_level = @reorder_level, reorder_qty = @reorder_qty, mrp_override = @mrp_override, updated_by = @by, updated_at = @now WHERE id = @id')
          .run({ ...next, by: ctx.userId, now, id: current.id });
      } else {
        ctx.db.prepare('INSERT INTO product_branch (id, product_id, branch_id, rack, min_stock, max_stock, reorder_level, reorder_qty, mrp_override, updated_by, created_at, updated_at) VALUES (@id, @pid, @bid, @rack, @min_stock, @max_stock, @reorder_level, @reorder_qty, @mrp_override, @by, @now, @now)')
          .run({ ...next, id: newId(), pid: p.id, bid: ctx.branchId, by: ctx.userId, now });
      }
      recordPrice(ctx, p.id, ctx.branchId, 'branch_mrp', current ? current.mrp_override : null, next.mrp_override, 'branch', v.text(params, 'priceReason', 'Reason', { max: 300 }));
      const before = current ? { rack: current.rack, min_stock: current.min_stock, max_stock: current.max_stock, reorder_level: current.reorder_level, reorder_qty: current.reorder_qty, mrp_override: current.mrp_override } : {};
      const change = audit.diff(before, next);
      audit.write(ctx.db, ctx.actor, { module: 'products', action: 'branch_values', recordType: 'product', recordId: p.id, summary: `Branch values of ${label(p)} changed`, old: change.old, new: change.new });
    })();
    return detail(ctx, p.id);
  });

  define('products.priceHistory', { perm: 'products.view' }, (ctx, params) => {
    const id = v.id(params, 'id');
    const rows = ctx.db.prepare(`SELECT h.*, u.username FROM price_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.product_id = ? AND (h.branch_id IS NULL OR h.branch_id = ?) ORDER BY h.at DESC LIMIT 500`).all(id, ctx.branchId);
    return rows.filter((r) => canSeeCost(ctx) || r.field !== 'trade_price')
      .map((r) => ({ id: r.id, field: r.field, oldValue: r.old_value, newValue: r.new_value, source: r.source, reason: r.reason, username: r.username, at: r.at, branchId: r.branch_id }));
  });
}

module.exports = { register, readForm, insertProduct, applyUpdate, detail, label, stockStatus, levels, recordPrice };

'use strict';
// Data in and out: export of any list the user can see (same permissions and hidden fields as the screen),
// import of products, suppliers and opening stock with templates, column mapping, row-level preview and an
// all-or-nothing commit, and barcode labels.
const { newId } = require('../core/ids');
const { AppError, fail, invalid } = require('../core/errors');
const { t } = require('../core/messages');
const v = require('../core/validate');
const audit = require('../core/audit');
const stock = require('../core/stock');
const money = require('../core/money');
const exporter = require('../core/exporter');
const parsers = require('../core/parsers');
const barcode = require('../core/barcode');
const { canSeeCost } = require('../core/docs');
const products = require('./products');
const suppliers = require('./suppliers');
const customers = require('./customers');
const stockops = require('./stockops');

// ---- export ---------------------------------------------------------------------------------------------------------

// Which list can be exported, with which permission, and where its rows are in the result.
const EXPORTABLE = {
  'products.list': { perm: 'products.export', module: 'products' },
  'suppliers.list': { perm: 'suppliers.export', module: 'suppliers' },
  'suppliers.statement': { perm: 'suppliers.export', module: 'suppliers', rows: 'entries' },
  'stock.batches': { perm: 'batches.export', module: 'batches' },
  'stock.ledger': { perm: 'stock.export', module: 'stock' },
  'stock.valuation': { perm: 'stock.export', module: 'stock' },
  'stock.reorder': { perm: 'stock.export', module: 'stock' },
  'stock.movers': { perm: 'stock.export', module: 'stock' },
  'stock.expiry': { perm: 'batches.export', module: 'batches', rows: 'buckets' },
  'adjustments.list': { perm: 'stock.export', module: 'stock' },
  'stocktake.get': { perm: 'stock.export', module: 'stocktake', rows: 'lines' },
  'purchases.listPo': { perm: 'purchases.export', module: 'purchases' },
  'purchases.getPo': { perm: 'purchases.export', module: 'purchases', rows: 'lines' },
  'purchases.listGrn': { perm: 'purchases.export', module: 'purchases' },
  'purchases.getGrn': { perm: 'purchases.export', module: 'purchases', rows: 'lines' },
  'purchases.listReturns': { perm: 'purchases.export', module: 'purchases' },
  'payments.list': { perm: 'purchases.export', module: 'supplier_payments' },
  'transfers.list': { perm: 'transfers.export', module: 'transfers' },
  'transfers.get': { perm: 'transfers.export', module: 'transfers', rows: 'lines' },
  'sales.list': { perm: 'sales.export', module: 'pos' },
  'customers.list': { perm: 'customers.export', module: 'customers' },
  'customers.statement': { perm: 'customers.export', module: 'customers', rows: 'entries' },
  'controlled.register': { perm: 'controlled.export', module: 'controlled' },
  'prescriptions.list': { perm: 'controlled.export', module: 'controlled' },
  'shifts.list': { perm: 'sales.export', module: 'shifts' },
  'reports.run': { perm: 'reports.export', module: 'reports' },
  'finance.journal': { perm: 'finance.export', module: 'finance' },
  'expenses.list': { perm: 'expenses.export', module: 'expenses' },
  'pettycash.book': { perm: 'expenses.export', module: 'expenses', rows: 'entries' },
  'approvals.list': { perm: 'approvals.view', module: 'approvals' },
  'dashboard.allBranches': { perm: 'reports.export', module: 'dashboard' },
};
const COLUMN_TYPES = ['text', 'money', 'number', 'date', 'datetime', 'bool'];

// The rows of a list or report, exactly as the screen gets them, for export and print.
async function sourceRows(ctx, params) {
  const source = String(params.source || '');
  const def = EXPORTABLE[source];
  if (!def) fail('UNKNOWN_METHOD', 'error.unknownAction');
  if (!ctx.can(def.perm)) fail('FORBIDDEN', 'error.noPermission');
  const columns = (Array.isArray(params.columns) ? params.columns : []).slice(0, 60).map((c) => ({
    key: String(c.key || ''), label: String(c.label || c.key || '').slice(0, 80), type: COLUMN_TYPES.includes(c.type) ? c.type : 'text', total: !!c.total,
  })).filter((c) => /^[A-Za-z0-9_]+$/.test(c.key));
  if (!columns.length) invalid('columns', 'error.required', { field: 'Columns' });
  // The rows come from the same method the screen uses, so permissions, branch scope and hidden costs all apply.
  const rpc = require('../rpc');
  const res = await rpc.call(ctx.app, ctx.clientKey, source, { ...(params.params || {}), __all: true });
  if (!res.ok) throw new AppError(res.error.code, res.error.message, res.error.details);
  const data = res.data;
  const rows = def.rows ? data[def.rows] : Array.isArray(data) ? data : data.rows;
  // A column the user may not see (cost) arrives as null on every row; drop it rather than print empty money.
  const visible = columns.filter((c) => c.type !== 'money' || canSeeCost(ctx) || rows.some((r) => r[c.key] !== null && r[c.key] !== undefined));
  const title = v.text(params, 'title', 'Title', { required: true, max: 80 });
  return { def, title, columns: visible, rows: rows || [] };
}

async function runExport(ctx, params) {
  const x = await sourceRows(ctx, params);
  return exporter.exportRows(ctx, { title: x.title, format: params.format || 'csv', columns: x.columns, rows: x.rows, filters: params.params, module: x.def.module });
}

// Print on paper (A4) through the Windows print dialog, with the same header as exported files.
async function runPrint(ctx, params) {
  const x = await sourceRows(ctx, params);
  const html = exporter.renderHtml(exporter.header(ctx, x.title, params.params), x.columns, x.rows);
  ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: x.def.module, action: 'print', summary: `${x.title} printed (${x.rows.length} rows)` }))();
  return ctx.app.printHtml(html, { title: x.title });
}

// ---- import ---------------------------------------------------------------------------------------------------------

const MAX_ROWS = 20000;
const SESSION_MS = 30 * 60 * 1000;
const sessions = new Map();

const KINDS = {
  products: {
    title: 'Products',
    perms: ['products.create'],
    fields: [
      { key: 'brandName', label: 'Brand name', required: true, example: 'Panadol' },
      { key: 'genericName', label: 'Generic name (salt)', example: 'Paracetamol' },
      { key: 'strength', label: 'Strength', example: '500mg' },
      { key: 'form', label: 'Dosage form', example: 'Tablet' },
      { key: 'category', label: 'Category', example: 'Pain relief' },
      { key: 'manufacturer', label: 'Manufacturer', example: 'GSK' },
      { key: 'drugClass', label: 'Drug class', example: 'OTC (no prescription)' },
      { key: 'baseUnit', label: 'Smallest unit', example: 'Tablet' },
      { key: 'packUnit', label: 'Pack unit', example: 'Strip' },
      { key: 'packSize', label: 'Units in one pack', example: '10' },
      { key: 'mrp', label: 'MRP per pack', example: '30.00' },
      { key: 'tradePrice', label: 'Trade price per pack', example: '25.00' },
      { key: 'taxRate', label: 'Tax rate percent', example: '0' },
      { key: 'rxRequired', label: 'Prescription only (yes or no)', example: 'no' },
      { key: 'controlled', label: 'Controlled drug (yes or no)', example: 'no' },
      { key: 'coldChain', label: 'Keep cold (yes or no)', example: 'no' },
      { key: 'barcode', label: 'Barcode', example: '8964000111222' },
      { key: 'sku', label: 'SKU', example: '' },
      { key: 'drapRegNo', label: 'DRAP registration number', example: '' },
      { key: 'reorderLevel', label: 'Reorder level (smallest units)', example: '50' },
      { key: 'reorderQty', label: 'Reorder quantity (smallest units)', example: '200' },
      { key: 'minStock', label: 'Minimum stock (smallest units)', example: '' },
      { key: 'maxStock', label: 'Maximum stock (smallest units)', example: '' },
      { key: 'supplierCode', label: 'Default supplier code', example: '' },
    ],
  },
  suppliers: {
    title: 'Suppliers',
    perms: ['suppliers.create'],
    fields: [
      { key: 'name', label: 'Company name', required: true, example: 'Ali Distributors' },
      { key: 'code', label: 'Supplier code', example: 'ALI' },
      { key: 'contactPerson', label: 'Contact person', example: 'Ali Raza' },
      { key: 'phone', label: 'Phone', example: '042-1234567' },
      { key: 'email', label: 'Email', example: '' },
      { key: 'address', label: 'Address', example: '' },
      { key: 'city', label: 'City', example: 'Lahore' },
      { key: 'licenceNo', label: 'Licence number', example: '' },
      { key: 'ntn', label: 'NTN', example: '' },
      { key: 'strn', label: 'STRN', example: '' },
      { key: 'paymentTermsDays', label: 'Payment terms (days)', example: '30' },
      { key: 'creditLimit', label: 'Credit limit', example: '0' },
      { key: 'openingBalance', label: 'Opening balance owed', example: '0' },
    ],
  },
  customers: {
    title: 'Customers',
    perms: ['customers.create'],
    fields: [
      { key: 'name', label: 'Name', required: true, example: 'Hamid Ali' },
      { key: 'code', label: 'Customer code', example: 'C-001' },
      { key: 'phone', label: 'Phone', example: '0300-1234567' },
      { key: 'cnic', label: 'CNIC', example: '' },
      { key: 'address', label: 'Address', example: '' },
      { key: 'creditLimit', label: 'Credit limit', example: '5000' },
      { key: 'discount', label: 'Usual discount %', example: '0' },
      { key: 'notes', label: 'Notes', example: '' },
      { key: 'openingBalance', label: 'Opening balance owed to us', example: '0' },
    ],
  },
  opening_stock: {
    title: 'Opening stock',
    perms: ['stock.create'],
    needsCost: true,
    fields: [
      { key: 'product', label: 'Product (SKU, barcode or exact name)', required: true, example: 'Panadol 500mg' },
      { key: 'batchNo', label: 'Batch number', required: true, example: 'PN-2401' },
      { key: 'expiryDate', label: 'Expiry date', required: true, example: '2027-12-31' },
      { key: 'mfgDate', label: 'Manufacture date', example: '' },
      { key: 'packs', label: 'Quantity in packs', example: '12' },
      { key: 'loose', label: 'Extra loose units', example: '4' },
      { key: 'cost', label: 'Cost per pack', example: '25.00' },
      { key: 'mrp', label: 'MRP per pack', example: '30.00' },
    ],
  },
};

function kindDef(ctx, kind) {
  const def = KINDS[kind];
  if (!def) invalid('kind', 'error.invalid', { field: 'What to import' });
  if (!ctx.can('import.create') || !def.perms.every((p) => ctx.can(p))) fail('FORBIDDEN', 'error.noPermission');
  if (def.needsCost && !canSeeCost(ctx)) fail('FORBIDDEN', 'error.costHidden');
  return def;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Guess which column holds which field from the header names.
function suggestMapping(def, headers) {
  const mapping = {};
  for (const f of def.fields) {
    const candidates = [f.key, f.label, f.label.replace(/\(.*\)/, '')].map(norm);
    const hit = headers.find((h) => candidates.includes(norm(h))) || headers.find((h) => norm(h) && candidates.some((c) => c.startsWith(norm(h)) || norm(h).startsWith(c)));
    if (hit) mapping[f.key] = hit;
  }
  return mapping;
}

function loadFile(ctx, params) {
  const def = kindDef(ctx, params.kind);
  const fileName = v.text(params, 'fileName', 'File', { required: true, max: 260 });
  const ext = parsers.extOf(fileName);
  if (!parsers.SUPPORTED.includes(ext)) fail('VALIDATION', 'import.unsupported');
  const b64 = String(params.contentBase64 || '');
  if (b64.length > 28 * 1024 * 1024) fail('VALIDATION', 'error.tooLong', { field: 'File', max: '20 MB' });
  let table;
  try {
    table = parsers.parseFile(fileName, Buffer.from(b64, 'base64'));
  } catch (err) {
    if (err.unsupported) fail('VALIDATION', 'import.unsupported');
    fail('VALIDATION', 'import.unreadable', { type: ext.toUpperCase() });
  }
  if (!table.rows.length) fail('VALIDATION', 'import.empty');
  if (table.rows.length > MAX_ROWS) fail('VALIDATION', 'import.tooMany', { n: table.rows.length, max: MAX_ROWS });
  for (const [k, s] of sessions) if (Date.now() - s.at > SESSION_MS) sessions.delete(k);
  const id = newId();
  sessions.set(id, { id, kind: params.kind, userId: ctx.userId, fileName, headers: table.headers, rows: table.rows, at: Date.now() });
  return {
    sessionId: id, fileName, kind: params.kind, title: def.title, headers: table.headers, rowCount: table.rows.length, sample: table.rows.slice(0, 5),
    fields: def.fields.map(({ key, label, required }) => ({ key, label, required: !!required })), mapping: suggestMapping(def, table.headers),
  };
}

function session(ctx, params) {
  const s = sessions.get(params.sessionId || '');
  if (!s || s.userId !== ctx.userId || Date.now() - s.at > SESSION_MS) fail('EXPIRED', 'import.expired');
  return s;
}

function rowObject(def, s, mapping, row) {
  const out = {};
  for (const f of def.fields) {
    const header = mapping[f.key];
    const i = header ? s.headers.indexOf(header) : -1;
    out[f.key] = i >= 0 ? String(row[i] || '').trim() : '';
  }
  return out;
}

function yesNo(value, label) {
  const b = parsers.looseBool(value);
  if (b === null) throw new AppError('VALIDATION', `${label}: write yes or no.`);
  return b;
}

function lookupId(db, kind, name) {
  if (!name) return {};
  const row = db.prepare('SELECT id FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, name);
  return row ? { id: row.id } : { newName: name };
}

// ---- per-kind row handling: prepare() validates and returns an action; apply() writes it ----

function findProduct(db, r) {
  if (r.sku) { const p = db.prepare('SELECT * FROM products WHERE sku = ? COLLATE NOCASE').get(r.sku); if (p) return p; }
  if (r.barcode) { const p = db.prepare('SELECT p.* FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.barcode = ? AND b.active = 1').get(r.barcode); if (p) return p; }
  return db.prepare(`SELECT * FROM products WHERE brand_name = ? COLLATE NOCASE AND COALESCE(strength, '') = ? COLLATE NOCASE`).get(r.brandName, r.strength || '') || null;
}

function productParams(ctx, r, existing) {
  const db = ctx.db;
  const base = existing ? products.detail(ctx, existing.id) : null;
  const pick = (key, fallback) => (r[key] !== '' ? r[key] : fallback);
  const params = {
    brandName: pick('brandName', base && base.brandName), genericName: pick('genericName', base && base.genericName), strength: pick('strength', base && base.strength),
    baseUnit: pick('baseUnit', base ? base.baseUnit : 'Tablet'), packUnit: pick('packUnit', base ? base.packUnit : 'Strip'), packSize: pick('packSize', base ? base.packSize : 1),
    mrp: r.mrp !== '' ? r.mrp : base ? base.mrp / 100 : 0, tradePrice: r.tradePrice !== '' ? r.tradePrice : base && base.tradePrice !== null ? base.tradePrice / 100 : 0,
    taxRate: r.taxRate !== '' ? r.taxRate : base ? base.taxRateBp / 100 : 0,
    rxRequired: r.rxRequired !== '' ? yesNo(r.rxRequired, 'Prescription only') : base ? base.rxRequired : false,
    controlled: r.controlled !== '' ? yesNo(r.controlled, 'Controlled drug') : base ? base.controlled : false,
    coldChain: r.coldChain !== '' ? yesNo(r.coldChain, 'Keep cold') : base ? base.coldChain : false,
    drapRegNo: pick('drapRegNo', base && base.drapRegNo), sku: pick('sku', base && base.sku),
    reorderLevel: pick('reorderLevel', base ? base.productReorderLevel : 0), reorderQty: pick('reorderQty', base ? base.productReorderQty : 0),
    minStock: pick('minStock', base ? base.productMinStock : 0), maxStock: pick('maxStock', base ? base.productMaxStock : 0),
    notes: base ? base.notes : null,
    units: base ? base.units.filter((u) => u.factor !== 1 && u.factor !== base.packSize).map((u) => ({ name: u.name, factor: u.factor, sellable: u.sellable, fixedPrice: u.fixedPrice === null ? null : u.fixedPrice / 100 })) : [],
    barcodes: [...new Set([...(base ? base.barcodes.map((b) => b.barcode) : []), ...(r.barcode ? [r.barcode] : [])])],
  };
  // Controlled implies prescription-only.
  if (params.controlled) params.rxRequired = true;
  for (const [field, kind, key] of [['formId', 'form', 'form'], ['categoryId', 'category', 'category'], ['manufacturerId', 'manufacturer', 'manufacturer'], ['drugClassId', 'drug_class', 'drugClass']]) {
    const hit = lookupId(db, kind, r[key]);
    if (hit.id) params[field] = hit.id;
    else if (hit.newName) params[`${field}New`] = hit.newName;
    else if (base) params[field] = base[field];
  }
  if (r.supplierCode) {
    const s = db.prepare('SELECT id FROM suppliers WHERE code = ? COLLATE NOCASE').get(r.supplierCode);
    if (!s) throw new AppError('VALIDATION', `No supplier with code ${r.supplierCode}.`);
    params.defaultSupplierId = s.id;
  } else if (base) params.defaultSupplierId = base.defaultSupplierId;
  return params;
}

const HANDLERS = {
  products: {
    prepare(ctx, r, seen, duplicates) {
      if (!r.brandName) throw new AppError('VALIDATION', t('error.required', { field: 'Brand name' }));
      for (const key of ['sku', 'barcode']) {
        if (r[key]) {
          const k = `${key}:${r[key].toLowerCase()}`;
          if (seen.has(k)) throw new AppError('VALIDATION', `${key === 'sku' ? 'SKU' : 'Barcode'} ${r[key]} is also on row ${seen.get(k)}.`);
          seen.set(k, r.__row);
        }
      }
      const existing = findProduct(ctx.db, r);
      if (existing) {
        if (duplicates === 'skip') return { status: 'skip', label: products.label(existing) };
        if (duplicates === 'error') throw new AppError('VALIDATION', `${products.label(existing)} already exists.`);
      }
      const params = productParams(ctx, r, existing);
      const form = products.readForm(ctx, params, existing);
      if (existing && form.f.pack_size !== existing.pack_size && ctx.db.prepare('SELECT 1 FROM stock_ledger WHERE product_id = ? LIMIT 1').get(existing.id)) {
        throw new AppError('VALIDATION', t('products.packLocked'));
      }
      return { status: existing ? 'update' : 'new', existing, form, label: products.label(form.f) };
    },
    apply(ctx, action) {
      const { f, extra, barcodes } = action.form;
      if (action.existing) { if (!f.sku) f.sku = action.existing.sku; products.applyUpdate(ctx, action.existing, f, extra, barcodes, 'Import'); }
      else products.insertProduct(ctx, f, extra, barcodes);
    },
  },
  suppliers: {
    prepare(ctx, r, seen, duplicates) {
      const key = `n:${norm(r.name)}`;
      if (r.name && seen.has(key)) throw new AppError('VALIDATION', `${r.name} is also on row ${seen.get(key)}.`);
      seen.set(key, r.__row);
      const existing = (r.code && ctx.db.prepare('SELECT * FROM suppliers WHERE code = ? COLLATE NOCASE').get(r.code))
        || (r.name && ctx.db.prepare('SELECT * FROM suppliers WHERE name = ? COLLATE NOCASE').get(r.name)) || null;
      if (existing) {
        if (duplicates === 'skip') return { status: 'skip', label: existing.name };
        if (duplicates === 'error') throw new AppError('VALIDATION', `${existing.name} already exists.`);
      }
      // On update, empty cells keep the current value; filled cells replace it.
      const params = existing ? supplierParams(existing) : {};
      for (const [k, x] of Object.entries(r)) if (k !== '__row' && x !== '') params[k] = x;
      params.contacts = existing ? JSON.parse(existing.contacts) : [];
      const f = suppliers.readForm(ctx, params, existing);
      const opening = existing ? 0 : v.money(r, 'openingBalance', 'Opening balance', { fallback: 0 });
      return { status: existing ? 'update' : 'new', existing, f, opening, label: f.name };
    },
    apply(ctx, a) {
      if (a.existing) { a.f.code = a.f.code || a.existing.code; suppliers.applySupplierUpdate(ctx, a.existing, a.f); }
      else suppliers.insertSupplier(ctx, a.f, a.opening);
    },
  },
  customers: {
    prepare(ctx, r, seen, duplicates) {
      const key = r.phone ? `p:${norm(r.phone)}` : `n:${norm(r.name)}`;
      if (r.name && seen.has(key)) throw new AppError('VALIDATION', `${r.name} is also on row ${seen.get(key)}.`);
      seen.set(key, r.__row);
      const existing = (r.code && ctx.db.prepare('SELECT * FROM customers WHERE code = ? COLLATE NOCASE').get(r.code))
        || (r.phone && ctx.db.prepare('SELECT * FROM customers WHERE phone = ? AND active = 1').get(r.phone)) || null;
      if (existing) {
        if (duplicates === 'skip') return { status: 'skip', label: existing.name };
        if (duplicates === 'error') throw new AppError('VALIDATION', `${existing.name} already exists.`);
      }
      const params = {};
      for (const [k, x] of Object.entries(r)) if (k !== '__row' && x !== '') params[k] = x;
      if (existing) for (const k of ['code', 'name', 'phone', 'cnic', 'address', 'notes']) if (params[k] === undefined && existing[k]) params[k] = existing[k];
      const f = customers.readForm(ctx, params, existing);
      const opening = existing ? 0 : v.money(r, 'openingBalance', 'Opening balance', { fallback: 0 });
      return { status: existing ? 'update' : 'new', existing, f, opening, label: f.name };
    },
    apply(ctx, a) {
      if (a.existing) {
        a.f.code = a.f.code || a.existing.code;
        const now = new Date().toISOString();
        ctx.db.prepare('UPDATE customers SET code = @code, name = @name, phone = @phone, cnic = @cnic, address = @address, credit_limit = @credit_limit, discount_bp = @discount_bp, notes = @notes, updated_at = @now WHERE id = @id')
          .run({ ...a.f, id: a.existing.id, now });
        audit.write(ctx.db, ctx.actor, { module: 'customers', action: 'update', recordType: 'customer', recordId: a.existing.id, branchId: null, summary: `Customer ${a.f.name} updated by import` });
      } else customers.insertCustomer(ctx, a.f, a.opening);
    },
  },
  opening_stock: {
    prepare(ctx, r, seen, duplicates) {
      const db = ctx.db;
      if (!r.product) throw new AppError('VALIDATION', t('error.required', { field: 'Product' }));
      const p = db.prepare('SELECT * FROM products WHERE sku = ? COLLATE NOCASE').get(r.product)
        || db.prepare('SELECT p.* FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.barcode = ? AND b.active = 1').get(r.product)
        || db.prepare(`SELECT * FROM products WHERE (brand_name || CASE WHEN strength IS NULL OR strength = '' THEN '' ELSE ' ' || strength END) = ? COLLATE NOCASE`).get(r.product);
      if (!p) throw new AppError('VALIDATION', `No product found for "${r.product}". Use its SKU, barcode or exact name.`);
      if (!r.batchNo) throw new AppError('VALIDATION', t('error.required', { field: 'Batch number' }));
      const expiry = parsers.looseDate(r.expiryDate);
      if (!expiry) throw new AppError('VALIDATION', t('error.date', { field: 'Expiry date' }));
      const mfg = r.mfgDate ? parsers.looseDate(r.mfgDate, { endOfMonth: false }) : null;
      if (r.mfgDate && !mfg) throw new AppError('VALIDATION', t('error.date', { field: 'Manufacture date' }));
      if (mfg && mfg > expiry) throw new AppError('VALIDATION', t('stock.expiryBeforeMfg'));
      const packs = v.int(r, 'packs', 'Quantity in packs', { fallback: 0 });
      const loose = v.int(r, 'loose', 'Extra loose units', { fallback: 0 });
      const qty = packs * p.pack_size + loose;
      if (qty <= 0) throw new AppError('VALIDATION', 'Enter a quantity in packs or loose units.');
      const key = `${p.id}:${r.batchNo.toLowerCase()}`;
      if (seen.has(key)) throw new AppError('VALIDATION', `Batch ${r.batchNo} of ${products.label(p)} is also on row ${seen.get(key)}.`);
      seen.set(key, r.__row);
      const existing = db.prepare(`SELECT 1 FROM batches b JOIN stock_balances s ON s.batch_id = b.id AND s.branch_id = ? WHERE b.product_id = ? AND b.batch_no = ? COLLATE NOCASE AND s.qty > 0`).get(ctx.branchId, p.id, r.batchNo);
      if (existing) {
        if (duplicates === 'skip') return { status: 'skip', label: `${products.label(p)} ${r.batchNo}` };
        if (duplicates === 'error') throw new AppError('VALIDATION', `Batch ${r.batchNo} of ${products.label(p)} already has stock here.`);
      }
      return {
        status: 'new', label: `${products.label(p)} ${r.batchNo}`,
        line: { productId: p.id, batchNo: r.batchNo, expiryDate: expiry, mfgDate: mfg, qty, cost: r.cost !== '' ? r.cost : p.trade_price / 100, mrp: r.mrp !== '' ? r.mrp : p.mrp / 100 },
        qtyText: stock.qtyText(qty, p),
      };
    },
  },
};

function supplierParams(s) {
  return {
    name: s.name, code: s.code, contactPerson: s.contact_person, phone: s.phone, email: s.email, address: s.address, city: s.city, licenceNo: s.licence_no,
    ntn: s.ntn, strn: s.strn, paymentTermsDays: s.payment_terms_days, creditLimit: s.credit_limit / 100, notes: s.notes,
  };
}

function prepareAll(ctx, params) {
  const s = session(ctx, params);
  const def = kindDef(ctx, s.kind);
  const mapping = params.mapping || {};
  for (const [k, header] of Object.entries(mapping)) if (header && !s.headers.includes(header)) invalid('mapping', 'error.invalid', { field: k });
  for (const f of def.fields) if (f.required && !mapping[f.key]) invalid(`mapping.${f.key}`, 'import.mappingMissing', { field: f.label });
  const duplicates = v.oneOf(params, 'duplicates', 'Existing records', ['skip', 'update', 'error'], { required: false, fallback: 'skip' });
  const seen = new Map();
  const results = s.rows.map((row, i) => {
    const r = rowObject(def, s, mapping, row);
    r.__row = i + 2; // spreadsheet row number, with the header on row 1
    try {
      const action = HANDLERS[s.kind].prepare(ctx, r, seen, duplicates);
      return { row: r.__row, ...action };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return { row: r.__row, status: 'error', error: err.message, label: r.brandName || r.name || r.product || '' };
    }
  });
  const counts = { new: 0, update: 0, skip: 0, error: 0 };
  for (const r of results) counts[r.status] += 1;
  return { s, def, results, counts, duplicates };
}

function preview(ctx, params) {
  const { results, counts } = prepareAll(ctx, params);
  return {
    counts,
    rows: results.slice(0, 1000).map((r) => ({ row: r.row, status: r.status, label: r.label, error: r.error || null, detail: r.qtyText || null })),
    errors: results.filter((r) => r.status === 'error').slice(0, 1000).map((r) => ({ row: r.row, label: r.label, error: r.error })),
  };
}

// Imports everything or nothing: any row error stops the whole import before a single row is written.
function commit(ctx, params) {
  const { s, def, results, counts } = prepareAll(ctx, params);
  if (counts.error) fail('VALIDATION', 'import.hasErrors', { n: counts.error });
  const todo = results.filter((r) => r.status === 'new' || r.status === 'update');
  let adjustment = null;
  ctx.db.transaction(() => {
    if (s.kind === 'opening_stock') {
      if (todo.length) adjustment = stockops.createAdjustment(ctx, { kind: 'opening', reason: `Imported from ${s.fileName}`, lines: todo.map((r) => r.line) });
    } else {
      for (const r of todo) HANDLERS[s.kind].apply(ctx, r);
    }
    audit.write(ctx.db, ctx.actor, { module: 'import', action: s.kind, summary: `${def.title} imported from ${s.fileName}: ${counts.new} new, ${counts.update} updated, ${counts.skip} skipped`, new: { file: s.fileName, ...counts } });
  })();
  sessions.delete(s.id);
  return { counts, adjustment: adjustment ? { id: adjustment.id, docNo: adjustment.docNo, status: adjustment.status } : null };
}

async function template(ctx, params) {
  const def = kindDef(ctx, params.kind);
  const format = v.oneOf(params, 'format', 'File type', ['csv', 'xlsx'], { required: false, fallback: 'xlsx' });
  const XLSX = require('xlsx');
  const headers = def.fields.map((f) => f.label + (f.required ? ' *' : ''));
  const example = def.fields.map((f) => f.example || '');
  let content;
  if (format === 'csv') content = '﻿' + [headers, example].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
  else {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, def.title);
    content = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
  return ctx.app.saveFile({ defaultName: `Mediescare-${def.title.replace(/\s+/g, '-')}-template.${format}`, content, ext: format, label: format.toUpperCase() });
}

// ---- labels ---------------------------------------------------------------------------------------------------------

const LABEL_SIZES = {
  '38x25': { w: 38, h: 25 },
  '50x25': { w: 50, h: 25 },
  '50x30': { w: 50, h: 30 },
};

function labelData(ctx, params) {
  const items = Array.isArray(params.items) ? params.items.slice(0, 500) : [];
  if (!items.length) invalid('items', 'error.noLines');
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get();
  const out = [];
  for (const [i, it] of items.entries()) {
    const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId || '');
    if (!p) invalid(`items.${i}.productId`, 'error.required', { field: 'Product' });
    const batch = it.batchId ? ctx.db.prepare('SELECT * FROM batches WHERE id = ? AND product_id = ?').get(it.batchId, p.id) : null;
    if (it.batchId && !batch) invalid(`items.${i}.batchId`, 'stock.batchWrongProduct');
    const code = ctx.db.prepare('SELECT barcode FROM product_barcodes WHERE product_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(p.id);
    const value = code ? code.barcode : p.sku;
    const copies = v.int(it, 'copies', 'Copies', { min: 1, max: 500, fallback: 1 });
    const mrp = batch ? batch.mrp : p.mrp;
    for (let n = 0; n < copies; n++) {
      out.push({
        shop: org ? org.name : '', name: products.label(p), price: `MRP ${money.format(mrp, { symbol: 'Rs', decimals: 2 })} / ${p.pack_unit}`,
        batch: batch ? `Batch ${batch.batch_no}  Exp ${batch.expiry_date.slice(0, 7)}` : '', code: value, svg: barcode.svg(value, { module: 2, height: 40, fontSize: 11 }),
      });
    }
  }
  return out;
}

function labelsHtml(labels, sizeKey) {
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES['50x25'];
  const esc = exporter.htmlEscape;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
    body { margin: 0; font-family: Arial, sans-serif; }
    .label { width: ${size.w}mm; height: ${size.h}mm; box-sizing: border-box; padding: 1mm 1.5mm; overflow: hidden; page-break-after: always; display: flex; flex-direction: column; }
    .shop { font-size: 6pt; color: #333; white-space: nowrap; overflow: hidden; } .name { font-size: 7.5pt; font-weight: bold; white-space: nowrap; overflow: hidden; }
    .meta { font-size: 6pt; white-space: nowrap; } .code { flex: 1; min-height: 0; display: flex; } .code svg { width: 100%; height: 100%; }
  </style></head><body>${labels.map((l) => `<div class="label"><div class="shop">${esc(l.shop)}</div><div class="name">${esc(l.name)}</div>
    <div class="meta">${esc(l.price)}</div>${l.batch ? `<div class="meta">${esc(l.batch)}</div>` : ''}<div class="code">${l.svg}</div></div>`).join('')}</body></html>`;
}

function register(define) {
  define('export.run', {}, runExport);
  define('export.print', {}, runPrint);
  define('import.kinds', { perm: 'import.create' }, (ctx) => Object.entries(KINDS)
    .filter(([, d]) => d.perms.every((p) => ctx.can(p)) && (!d.needsCost || canSeeCost(ctx)))
    .map(([key, d]) => ({ key, title: d.title, fields: d.fields.map(({ key: k, label, required }) => ({ key: k, label, required: !!required })) })));
  define('import.template', { perm: 'import.create' }, template);
  define('import.load', { perm: 'import.create' }, loadFile);
  define('import.preview', { perm: 'import.create' }, preview);
  define('import.commit', { perm: 'import.create' }, commit);
  define('labels.preview', { perm: ['products.view', 'batches.view'] }, (ctx, params) => labelData(ctx, params).slice(0, 60).map((l) => ({ ...l })));
  define('labels.print', { perm: ['products.view', 'batches.view'] }, async (ctx, params) => {
    const labels = labelData(ctx, params);
    const html = labelsHtml(labels, params.size);
    if (params.output === 'pdf') {
      const size = LABEL_SIZES[params.size] || LABEL_SIZES['50x25'];
      // Electron takes custom page sizes in inches.
      const pdf = await ctx.app.renderPdf(html, { pageSize: { width: size.w / 25.4, height: size.h / 25.4 } });
      return ctx.app.saveFile({ defaultName: 'labels.pdf', content: pdf, ext: 'pdf', label: 'PDF' });
    }
    return ctx.app.printHtml(html, { title: 'Labels' });
  });
}

module.exports = { register, KINDS, EXPORTABLE, labelsHtml };

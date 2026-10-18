'use strict';
// Configurable lists: categories, dosage forms, manufacturers, drug classes, storage conditions, unit names.
// Items are renamed or deactivated, never removed, so old records keep their meaning.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');

const KINDS = ['category', 'form', 'manufacturer', 'drug_class', 'storage', 'unit'];

const DEFAULTS = {
  form: ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Drops', 'Cream', 'Ointment', 'Gel', 'Inhaler', 'Sachet', 'Suppository', 'Infusion', 'Lotion', 'Spray', 'Device'],
  unit: ['Tablet', 'Capsule', 'Strip', 'Box', 'Bottle', 'Vial', 'Ampoule', 'Tube', 'Sachet', 'ml', 'Piece', 'Pack'],
  category: ['Medicines', 'Antibiotics', 'Pain relief', 'Cardiac', 'Diabetes', 'Vitamins and supplements', 'Baby care', 'Personal care', 'Surgical and devices'],
  drug_class: ['OTC (no prescription)', 'Prescription only', 'Controlled (narcotic or psychotropic)'],
  storage: ['Room temperature (below 30 C)', 'Cool place (8 to 15 C)', 'Refrigerate (2 to 8 C)', 'Freeze'],
  manufacturer: [],
};

function shape(r) {
  return { id: r.id, kind: r.kind, name: r.name, active: r.active === 1, usage: r.usage || 0 };
}

// Filled once per organisation so the first product form is not empty.
function seedDefaults(db) {
  const now = nowIso();
  const insert = db.prepare('INSERT OR IGNORE INTO lookups (id, kind, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
  for (const [kind, names] of Object.entries(DEFAULTS)) for (const name of names) insert.run(newId(), kind, name, now, now);
}

function usageSql(kind) {
  const col = { category: 'category_id', form: 'form_id', manufacturer: 'manufacturer_id', drug_class: 'drug_class_id', storage: 'storage_id' }[kind];
  return col ? `(SELECT COUNT(*) FROM products p WHERE p.${col} = l.id)` : '0';
}

// Finds an item by name or adds it. Used by the product form ("type a new manufacturer") and by imports.
function ensure(db, actor, kind, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT * FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, clean);
  if (existing) return existing.id;
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO lookups (id, kind, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(id, kind, clean.slice(0, 80), now, now);
  audit.write(db, actor, { module: 'lookups', action: 'create', recordType: 'lookup', recordId: id, branchId: null, summary: `${kind} "${clean}" added` });
  return id;
}

function register(define) {
  define('lookups.list', {}, (ctx, params) => {
    const kind = v.oneOf(params, 'kind', 'List', KINDS);
    const rows = ctx.db.prepare(`SELECT l.*, ${usageSql(kind)} AS usage FROM lookups l WHERE l.kind = ? ORDER BY l.name COLLATE NOCASE`).all(kind);
    return rows.filter((r) => params.includeInactive || r.active).map(shape);
  });

  // Every list at once for product forms and filters.
  define('lookups.all', {}, (ctx) => {
    const rows = ctx.db.prepare('SELECT * FROM lookups WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
    const out = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const r of rows) out[r.kind].push(shape(r));
    return out;
  });

  define('lookups.create', { perm: ['products.create', 'products.edit'] }, (ctx, params) => {
    const kind = v.oneOf(params, 'kind', 'List', KINDS);
    const name = v.text(params, 'name', 'Name', { required: true, max: 80 });
    if (ctx.db.prepare('SELECT 1 FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, name)) invalid('name', 'lookups.nameTaken');
    let id;
    ctx.db.transaction(() => { id = ensure(ctx.db, ctx.actor, kind, name); })();
    return shape(ctx.db.prepare('SELECT * FROM lookups WHERE id = ?').get(id));
  });

  define('lookups.update', { perm: 'products.edit' }, (ctx, params) => {
    const row = ctx.db.prepare('SELECT * FROM lookups WHERE id = ?').get(v.id(params, 'id'));
    if (!row) fail('NOT_FOUND', 'error.notFound', { thing: 'list item' });
    const name = params.name !== undefined ? v.text(params, 'name', 'Name', { required: true, max: 80 }) : row.name;
    const active = params.active !== undefined ? (v.bool(params, 'active') ? 1 : 0) : row.active;
    if (name.toLowerCase() !== row.name.toLowerCase() && ctx.db.prepare('SELECT 1 FROM lookups WHERE kind = ? AND name = ? COLLATE NOCASE AND id <> ?').get(row.kind, name, row.id)) invalid('name', 'lookups.nameTaken');
    if (name === row.name && active === row.active) return shape(row);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE lookups SET name = ?, active = ?, updated_at = ? WHERE id = ?').run(name, active, nowIso(), row.id);
      audit.write(ctx.db, ctx.actor, { module: 'lookups', action: 'update', recordType: 'lookup', recordId: row.id, branchId: null, summary: `${row.kind} "${row.name}" changed`, old: { name: row.name, active: row.active === 1 }, new: { name, active: active === 1 } });
    })();
    return shape(ctx.db.prepare('SELECT * FROM lookups WHERE id = ?').get(row.id));
  });
}

module.exports = { register, ensure, seedDefaults, KINDS };

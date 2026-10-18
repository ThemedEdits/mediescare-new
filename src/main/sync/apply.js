'use strict';
// Applies operations received from another computer or the cloud. Rules:
//  - an operation is stored once (op_id); receiving it again changes nothing
//  - append tables: INSERT OR IGNORE, never overwritten
//  - editable (lww) tables: the newer updated_at wins; a tie is broken by the larger op_id
//  - unique clashes created offline on two computers are resolved the same way on every computer, so all copies
//    end up identical without talking to each other (the row with the larger id gives way)
// Triggers do not record anything while sync_ctx.applying = 1, so applied rows are not sent back as new operations.
const { SYNCED_TABLES } = require('../db/sync-registry');
const { nowIso } = require('../core/ids');
const log = require('../core/log');

const DEFS = new Map(SYNCED_TABLES.map((d) => [d.table, d]));

// How each unique constraint is settled. rename: the larger id gets a suffix; deactivate: the larger id is switched off;
// merge: both are the same logical row (newer values win, kept under the existing id); log: recorded for a person.
const UNIQUE_RULES = {
  users: [{ cols: ['username'], nocase: true, fix: 'rename', field: 'username', max: 32 }],
  branches: [{ cols: ['code'], nocase: true, fix: 'rename', field: 'code', max: 6, short: true }],
  roles: [{ cols: ['name'], nocase: true, fix: 'rename', field: 'name', max: 60 }],
  org: [{ cols: ['code'], nocase: true, fix: 'log' }],
  suppliers: [{ cols: ['code'], nocase: true, fix: 'rename', field: 'code', max: 20 }],
  products: [{ cols: ['sku'], nocase: true, fix: 'rename', field: 'sku', max: 40 }],
  customers: [{ cols: ['code'], nocase: true, fix: 'rename', field: 'code', max: 20 }],
  lookups: [{ cols: ['kind', 'name'], nocase: true, fix: 'rename', field: 'name', max: 80 }],
  expense_categories: [{ cols: ['name'], nocase: true, fix: 'rename', field: 'name', max: 80 }],
  product_barcodes: [{ cols: ['barcode'], where: 'active = 1', fix: 'deactivate' }],
  product_branch: [{ cols: ['product_id', 'branch_id'], fix: 'merge' }],
  settings: [{ cols: ['scope', 'key'], fix: 'merge' }],
  batch_status: [{ cols: ['branch_id', 'batch_id'], fix: 'merge' }],
  stock_take_lines: [{ cols: ['take_id', 'batch_id'], fix: 'merge' }],
  devices: [{ cols: ['branch_id', 'device_no'], fix: 'log' }],
};

const columnCache = new WeakMap();
function columns(db, table) {
  let byTable = columnCache.get(db);
  if (!byTable) { byTable = new Map(); columnCache.set(db, byTable); }
  if (!byTable.has(table)) byTable.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)));
  return byTable.get(table);
}

function renamed(value, id, rule) {
  const tail = id.slice(-4);
  if (rule.short) return `${String(value).slice(0, Math.max(rule.max - 4, 2))}${tail}`.slice(0, rule.max);
  return `${String(value).slice(0, rule.max - tail.length - 1)}-${tail}`;
}

function conflict(db, c) {
  db.prepare(`INSERT INTO sync_conflicts (at, kind, tbl, row_id, field, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nowIso(), c.kind, c.tbl || null, c.rowId || null, c.field || null, c.old === undefined ? null : String(c.old), c.new === undefined ? null : String(c.new), c.note || null);
}

function findClash(db, table, rule, row) {
  if (rule.cols.some((c) => row[c] === undefined || row[c] === null)) return null;
  if (rule.where && !(table === 'product_barcodes' && row.active === 1)) return null;
  const cond = rule.cols.map((c) => `${c} = ?${rule.nocase ? ' COLLATE NOCASE' : ''}`).join(' AND ');
  return db.prepare(`SELECT * FROM ${table} WHERE ${cond} AND id <> ?${rule.where ? ` AND ${rule.where}` : ''} LIMIT 1`).get(...rule.cols.map((c) => row[c]), row.id) || null;
}

// Settles unique clashes for `row` before it is written. Returns the row to write, or null to skip writing it.
function settleUnique(db, table, row) {
  for (const rule of UNIQUE_RULES[table] || []) {
    const other = findClash(db, table, rule, row);
    if (!other) continue;
    if (rule.fix === 'merge') {
      // Same logical row made on two computers: keep one id, newer values win.
      if (String(row.updated_at) > String(other.updated_at)) {
        const cols = Object.keys(row).filter((k) => k !== 'id');
        db.prepare(`UPDATE ${table} SET ${cols.map((c) => `"${c}" = @${c}`).join(', ')} WHERE id = @__id`).run({ ...row, __id: other.id });
      }
      return null;
    }
    if (rule.fix === 'deactivate') {
      if (row.id > other.id) row = { ...row, active: 0 };
      else db.prepare(`UPDATE ${table} SET active = 0 WHERE id = ?`).run(other.id);
      conflict(db, { kind: 'duplicate', tbl: table, rowId: row.id > other.id ? row.id : other.id, field: rule.cols.join(','), old: row[rule.cols[0]], note: 'Same value on two computers; the later one was switched off' });
      continue;
    }
    if (rule.fix === 'rename') {
      if (row.id > other.id) {
        const value = renamed(row[rule.field], row.id, rule);
        conflict(db, { kind: 'duplicate', tbl: table, rowId: row.id, field: rule.field, old: row[rule.field], new: value, note: 'Same value made on two computers; this one was renamed' });
        row = { ...row, [rule.field]: value };
      } else {
        const value = renamed(other[rule.field], other.id, rule);
        db.prepare(`UPDATE ${table} SET "${rule.field}" = ? WHERE id = ?`).run(value, other.id);
        conflict(db, { kind: 'duplicate', tbl: table, rowId: other.id, field: rule.field, old: other[rule.field], new: value, note: 'Same value made on two computers; this one was renamed' });
      }
      continue;
    }
    conflict(db, { kind: 'duplicate', tbl: table, rowId: row.id, field: rule.cols.join(','), old: rule.cols.map((c) => row[c]).join(' '), note: 'Needs a person to sort out; the incoming row was not written' });
    return null;
  }
  return row;
}

function writeRow(db, table, row, { append }) {
  const cols = Object.keys(row);
  const list = cols.map((c) => `"${c}"`).join(', ');
  const vals = cols.map((c) => `@${c}`).join(', ');
  if (append) {
    db.prepare(`INSERT OR IGNORE INTO ${table} (${list}) VALUES (${vals})`).run(row);
    return;
  }
  const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(row.id);
  if (existing) {
    const sets = cols.filter((c) => c !== 'id').map((c) => `"${c}" = @${c}`).join(', ');
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run(row);
  } else {
    db.prepare(`INSERT INTO ${table} (${list}) VALUES (${vals})`).run(row);
  }
}

// Is the incoming operation newer than what this computer has for the row?
function isNewer(db, table, op, row) {
  const current = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(op.row_id);
  if (!current) return true;
  if (String(row.updated_at) > String(current.updated_at)) return true;
  if (String(row.updated_at) < String(current.updated_at)) return false;
  const latest = db.prepare('SELECT op_id FROM sync_ops WHERE tbl = ? AND row_id = ? AND op_id <> ? ORDER BY updated_at DESC, op_id DESC LIMIT 1').get(table, op.row_id, op.op_id);
  return !latest || op.op_id > latest.op_id;
}

function applyOne(db, op) {
  const def = DEFS.get(op.tbl);
  if (!def) return 'unknown'; // a table from a newer version of the app: kept in sync_ops, applied after an update
  const cols = columns(db, op.tbl);
  let row;
  try { row = JSON.parse(op.data); } catch (_) { return 'bad'; }
  // Only columns this version knows about; anything newer waits in sync_ops.
  row = Object.fromEntries(Object.entries(row).filter(([k]) => cols.has(k)));
  if (!row.id) return 'bad';
  if (def.merge === 'append') {
    if (db.prepare(`SELECT 1 FROM ${op.tbl} WHERE id = ?`).get(row.id)) return 'same';
    const settled = settleUnique(db, op.tbl, row);
    if (settled) writeRow(db, op.tbl, settled, { append: true });
    return 'applied';
  }
  if (!isNewer(db, op.tbl, op, row)) return 'older';
  const settled = settleUnique(db, op.tbl, row);
  if (settled) writeRow(db, op.tbl, settled, { append: false });
  return 'applied';
}

const OP_COLUMNS = ['op_id', 'tbl', 'row_id', 'kind', 'branch_id', 'branch_id2', 'data', 'updated_at', 'origin_device', 'created_at'];

function validOp(op) {
  return op && typeof op.op_id === 'string' && op.op_id.length <= 64 && typeof op.tbl === 'string' && /^[a-z_]+$/.test(op.tbl)
    && typeof op.row_id === 'string' && typeof op.data === 'string' && typeof op.updated_at === 'string' && ['upsert', 'insert'].includes(op.kind);
}

// Stores and applies a batch in one transaction. `source` names the peer the ops came from (not sent back to it).
function applyOps(db, ops, { source = null } = {}) {
  const result = { received: ops.length, applied: 0, duplicates: 0, skipped: 0, invalid: 0, conflicts: 0 };
  const touchedBatches = new Set();
  const before = db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts').get().n;
  const insertOp = db.prepare(`INSERT OR IGNORE INTO sync_ops (${OP_COLUMNS.join(', ')}, source)
    VALUES (${OP_COLUMNS.map((c) => '@' + c).join(', ')}, @source)`);
  const run = () => {
    Object.assign(result, { applied: 0, duplicates: 0, skipped: 0, invalid: 0 });
    touchedBatches.clear();
    db.pragma('defer_foreign_keys = ON');
    db.prepare('UPDATE sync_ctx SET applying = 1 WHERE id = 1').run();
    try {
      for (const op of ops) {
        if (!validOp(op)) { result.invalid += 1; continue; }
        const stored = insertOp.run({ ...Object.fromEntries(OP_COLUMNS.map((c) => [c, op[c] === undefined ? null : op[c]])), source });
        if (!stored.changes) { result.duplicates += 1; continue; }
        const outcome = applyOne(db, op);
        if (outcome === 'applied') {
          result.applied += 1;
          if (op.tbl === 'stock_ledger') {
            try { const d = JSON.parse(op.data); touchedBatches.add(`${d.branch_id}|${d.batch_id}`); } catch (_) { /* ignore */ }
          }
        } else result.skipped += 1;
      }
      // Two computers selling the last units of a batch while apart can take it below zero. The ledger stays right;
      // the batch is flagged here so someone can count it and correct it.
      for (const key of touchedBatches) {
        const [branchId, batchId] = key.split('|');
        const bal = db.prepare('SELECT qty FROM stock_balances WHERE branch_id = ? AND batch_id = ?').get(branchId, batchId);
        if (bal && bal.qty < 0 && !db.prepare("SELECT 1 FROM sync_conflicts WHERE kind = 'negative_stock' AND row_id = ? AND resolved = 0").get(batchId)) {
          conflict(db, { kind: 'negative_stock', tbl: 'batches', rowId: batchId, new: bal.qty, note: `Stock of this batch is below zero at branch ${branchId} after merging sales from two computers` });
        }
      }
    } finally {
      db.prepare('UPDATE sync_ctx SET applying = 0 WHERE id = 1').run();
    }
  };
  try {
    db.transaction(run)();
  } catch (err) {
    if (!/FOREIGN KEY/i.test(String(err && err.message))) throw err;
    // A row arrived before something it points to (for example from another branch's scope). Keep the data and
    // let the reference resolve when the rest arrives, rather than blocking sync for ever.
    log.warn('Sync batch had a missing reference; applying without reference checks', err.message);
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => { run(); conflict(db, { kind: 'missing_reference', note: 'Some received rows point to records not received yet' }); })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  result.conflicts = db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts').get().n - before;
  return result;
}

module.exports = { applyOps, validOp, OP_COLUMNS, UNIQUE_RULES, renamed };

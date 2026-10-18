'use strict';
// Generates the sync and protection triggers from the table registry.
// Regenerated after every migration so new columns are always included in the operation payload.
const { SYNCED_TABLES, APPEND_ONLY_TABLES } = require('./sync-registry');

const NOT_APPLYING = '(SELECT applying FROM sync_ctx WHERE id = 1) = 0';
const DEVICE = '(SELECT device_id FROM sync_ctx WHERE id = 1)';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function rowJson(columns) {
  return `json_object(${columns.map((c) => `'${c}', NEW."${c}"`).join(', ')})`;
}

function dropGenerated(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'sync_%' OR name LIKE 'guard_%')").all();
  for (const r of rows) db.exec(`DROP TRIGGER IF EXISTS "${r.name}"`);
}

// Which branches receive an operation. Most rows belong to one branch (branch_id); documents that move
// between two branches (transfers) name both so each side receives them.
function branchExprs(def, columns) {
  if (def.scope !== 'branch') return ['NULL', 'NULL'];
  const cols = def.branchColumns || ['branch_id'];
  for (const c of cols) if (!columns.includes(c)) throw new Error(`Synced table ${def.table} has no ${c} column`);
  return [`NEW."${cols[0]}"`, cols[1] ? `NEW."${cols[1]}"` : 'NULL'];
}

function rebuildTriggers(db) {
  dropGenerated(db);
  const opColumns = columnsOf(db, 'sync_ops');
  const hasSecondBranch = opColumns.includes('branch_id2');
  for (const def of SYNCED_TABLES) {
    const columns = columnsOf(db, def.table);
    if (!columns.length) throw new Error(`Synced table ${def.table} does not exist`);
    if (!columns.includes('id') || !columns.includes('updated_at')) {
      throw new Error(`Synced table ${def.table} needs id and updated_at columns`);
    }
    if (columns.length > 60) throw new Error(`Synced table ${def.table} has too many columns for json_object`);
    const [b1, b2] = branchExprs(def, columns);
    if (b2 !== 'NULL' && !hasSecondBranch) throw new Error('sync_ops.branch_id2 is missing');
    const kind = def.merge === 'append' ? 'insert' : 'upsert';
    const insertOp = hasSecondBranch
      ? `INSERT INTO sync_ops (op_id, tbl, row_id, kind, branch_id, branch_id2, data, updated_at, origin_device, created_at)
          VALUES (lower(hex(randomblob(16))), '${def.table}', NEW.id, '${kind}', ${b1}, ${b2}, ${rowJson(columns)}, NEW.updated_at, ${DEVICE}, ${NOW});`
      : `INSERT INTO sync_ops (op_id, tbl, row_id, kind, branch_id, data, updated_at, origin_device, created_at)
          VALUES (lower(hex(randomblob(16))), '${def.table}', NEW.id, '${kind}', ${b1}, ${rowJson(columns)}, NEW.updated_at, ${DEVICE}, ${NOW});`;

    db.exec(`CREATE TRIGGER sync_${def.table}_ins AFTER INSERT ON ${def.table} WHEN ${NOT_APPLYING} BEGIN ${insertOp} END;`);
    if (def.merge === 'lww') {
      db.exec(`CREATE TRIGGER sync_${def.table}_upd AFTER UPDATE ON ${def.table} WHEN ${NOT_APPLYING} BEGIN ${insertOp} END;`);
    }
    // Records that travel between PCs are never hard-deleted; use deactivation or cancellation instead.
    db.exec(`CREATE TRIGGER guard_${def.table}_nodelete BEFORE DELETE ON ${def.table} WHEN ${NOT_APPLYING}
      BEGIN SELECT RAISE(ABORT, 'MEDI_NO_DELETE'); END;`);
  }
  for (const table of APPEND_ONLY_TABLES) {
    db.exec(`CREATE TRIGGER guard_${table}_noupdate BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'MEDI_APPEND_ONLY'); END;`);
    db.exec(`CREATE TRIGGER guard_${table}_nodelete_always BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'MEDI_APPEND_ONLY'); END;`);
  }
}

module.exports = { rebuildTriggers };

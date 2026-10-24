'use strict';
// Phase 3: bookkeeping for sync between computers (LAN) and with the cloud gateway. All local to this computer.

module.exports = {
  version: 4,
  name: 'sync',
  up(db) {
    db.exec(`
      -- Which peer an operation came from ('lan:<device>' or 'cloud'), so it is not sent straight back.
      ALTER TABLE sync_ops ADD COLUMN source TEXT;
      CREATE INDEX sync_ops_branch ON sync_ops (branch_id, seq);
      CREATE INDEX sync_ops_branch2 ON sync_ops (branch_id2, seq);

      -- Computers paired with this Primary over the shop network. Only a hash of each token is kept.
      CREATE TABLE lan_tokens (
        token_hash TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_name TEXT,
        branch_id TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT
      );

      -- Clashes found while merging (same username or code made on two computers, stock below zero after merging).
      CREATE TABLE sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        tbl TEXT,
        row_id TEXT,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        note TEXT,
        resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1))
      );

      CREATE TABLE backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('auto', 'manual', 'safety', 'migration')),
        file TEXT NOT NULL,
        size INTEGER,
        encrypted INTEGER NOT NULL DEFAULT 0,
        copied_to TEXT,
        status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
        message TEXT
      );
    `);
  },
};

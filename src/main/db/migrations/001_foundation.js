'use strict';
// Phase 0 foundation schema: organisation, branches, devices, roles, users, settings, audit log, sync bookkeeping.

module.exports = {
  version: 1,
  name: 'foundation',
  up(db) {
    db.exec(`
      -- Local to this PC (never synced) ---------------------------------------------------------------
      CREATE TABLE local_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE doc_sequences (
        key TEXT PRIMARY KEY,
        next INTEGER NOT NULL CHECK (next >= 1)
      );

      CREATE TABLE login_attempts (
        user_id TEXT PRIMARY KEY,
        failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
        locked_until TEXT
      );

      CREATE TABLE sync_ctx (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        applying INTEGER NOT NULL DEFAULT 0 CHECK (applying IN (0, 1)),
        device_id TEXT
      );
      INSERT INTO sync_ctx (id, applying) VALUES (1, 0);

      CREATE TABLE sync_ops (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('upsert', 'insert')),
        branch_id TEXT,
        data TEXT NOT NULL CHECK (json_valid(data)),
        updated_at TEXT NOT NULL,
        origin_device TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX sync_ops_row ON sync_ops (tbl, row_id);

      CREATE TABLE sync_cursors (
        peer TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('push', 'pull')),
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        PRIMARY KEY (peer, direction)
      );

      CREATE TABLE sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('lan', 'cloud')),
        direction TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'info')),
        pushed INTEGER NOT NULL DEFAULT 0,
        pulled INTEGER NOT NULL DEFAULT 0,
        message TEXT
      );

      -- Synced ----------------------------------------------------------------------------------------
      CREATE TABLE org (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(code) BETWEEN 3 AND 12),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        money_scale INTEGER NOT NULL DEFAULT 100 CHECK (money_scale = 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(code) BETWEEN 2 AND 6),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        is_head_office INTEGER NOT NULL DEFAULT 0 CHECK (is_head_office IN (0, 1)),
        address TEXT,
        phone TEXT,
        email TEXT,
        licence_no TEXT,
        ntn TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (is_head_office = 0 OR active = 1)
      );
      CREATE UNIQUE INDEX branches_one_head_office ON branches (is_head_office) WHERE is_head_office = 1;

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        device_no INTEGER NOT NULL CHECK (device_no BETWEEN 1 AND 99),
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('primary', 'client')),
        registered_by TEXT,
        revoked_at TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (branch_id, device_no)
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 60),
        description TEXT,
        permissions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions) AND json_type(permissions) = 'array'),
        is_super INTEGER NOT NULL DEFAULT 0 CHECK (is_super IN (0, 1)),
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
        full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        role_id TEXT NOT NULL REFERENCES roles (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
        phone TEXT,
        email TEXT,
        prefs TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(prefs)),
        last_login_at TEXT,
        password_changed_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX users_one_owner ON users (is_owner) WHERE is_owner = 1;
      CREATE INDEX users_branch ON users (branch_id);

      -- scope is 'global' or a branch id; branch_id mirrors it (NULL for global) so sync can route the row.
      CREATE TABLE settings (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL CHECK (json_valid(value)),
        branch_id TEXT REFERENCES branches (id),
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (scope, key),
        CHECK ((scope = 'global' AND branch_id IS NULL) OR (scope = branch_id))
      );

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        branch_id TEXT,
        device_id TEXT,
        module TEXT NOT NULL,
        action TEXT NOT NULL,
        record_type TEXT,
        record_id TEXT,
        summary TEXT,
        old_value TEXT CHECK (old_value IS NULL OR json_valid(old_value)),
        new_value TEXT CHECK (new_value IS NULL OR json_valid(new_value)),
        reason TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX audit_at ON audit_log (at);
      CREATE INDEX audit_record ON audit_log (record_type, record_id);
      CREATE INDEX audit_branch_at ON audit_log (branch_id, at);
      CREATE INDEX audit_user_at ON audit_log (user_id, at);
    `);
  },
};

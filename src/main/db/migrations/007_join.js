'use strict';
// Joining without a password check in the cloud (the cloud gateway's free plan allows very little work per request):
//   join_codes      one-time codes Head Office makes for a branch's new main computer (24 hours, used once)
//   org.recovery_hash  the organisation recovery key (only its hash), the way back when the Head Office computer is lost
// Only hashes are stored; both travel to the gateway with normal sync.

module.exports = {
  version: 7,
  name: 'join',
  up(db) {
    db.exec(`
      ALTER TABLE org ADD COLUMN recovery_hash TEXT;
      ALTER TABLE org ADD COLUMN recovery_set_at TEXT;

      CREATE TABLE join_codes (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        code_hash TEXT NOT NULL UNIQUE,
        hint TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        cancelled_at TEXT,
        cancelled_by TEXT,
        used_at TEXT,
        used_device_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX join_codes_branch ON join_codes (branch_id, created_at);
    `);
  },
};

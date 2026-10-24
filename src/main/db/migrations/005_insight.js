'use strict';
// Phase 4: expenses and the petty cash book, the approval queue, and which notifications each user has seen.

module.exports = {
  version: 5,
  name: 'insight',
  up(db) {
    db.exec(`
      -- Cash paid out of the drawer for an expense, or moved to the petty cash box, is a cash movement of the shift
      -- that names what it was for (ref_type 'expense' or 'petty'; NULL for plain cash in and out).
      ALTER TABLE cash_movements ADD COLUMN ref_type TEXT;
      ALTER TABLE cash_movements ADD COLUMN ref_id TEXT;

      CREATE TABLE expense_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 80),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- method: drawer (cash from this computer's drawer, counted in the shift), petty (petty cash box), bank, card, online
      CREATE TABLE expenses (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        expense_date TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES expense_categories (id),
        description TEXT NOT NULL,
        paid_to TEXT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        method TEXT NOT NULL CHECK (method IN ('drawer', 'petty', 'bank', 'card', 'online')),
        reference TEXT,
        shift_id TEXT REFERENCES shifts (id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'rejected', 'cancelled')),
        requested_by TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX expenses_branch_date ON expenses (branch_id, expense_date);

      -- Petty cash book. Append-only; balance = SUM(amount) (top-ups positive, expenses negative).
      CREATE TABLE petty_cash (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        entry_date TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('topup', 'expense', 'expense_cancel', 'withdraw')),
        amount INTEGER NOT NULL CHECK (amount <> 0),
        expense_id TEXT REFERENCES expenses (id),
        reason TEXT,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX petty_cash_branch ON petty_cash (branch_id, at);

      -- Requests waiting for someone allowed to decide (from the counter or other screens).
      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        kind TEXT NOT NULL,
        needs TEXT NOT NULL CHECK (json_valid(needs)),
        summary TEXT NOT NULL,
        amount INTEGER,
        payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'cancelled')),
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        device_id TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT,
        used_at TEXT,
        used_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX approval_requests_branch ON approval_requests (branch_id, status, requested_at);

      -- Local: what each person has already seen, so the bell counts only what is new.
      CREATE TABLE notification_reads (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        signature TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
    const now = new Date().toISOString();
    // Default expense categories; ids are fixed so every computer that runs this migration has the same rows.
    const ins = db.prepare('INSERT OR IGNORE INTO expense_categories (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    [['EXPCAT00000000000000000001', 'Rent'], ['EXPCAT00000000000000000002', 'Salaries'], ['EXPCAT00000000000000000003', 'Electricity and utilities'],
      ['EXPCAT00000000000000000004', 'Internet and phone'], ['EXPCAT00000000000000000005', 'Repairs and maintenance'], ['EXPCAT00000000000000000006', 'Transport and delivery'],
      ['EXPCAT00000000000000000007', 'Tea and refreshments'], ['EXPCAT00000000000000000008', 'Stationery and printing'], ['EXPCAT00000000000000000009', 'Fees and taxes'],
      ['EXPCAT00000000000000000010', 'Other']].forEach(([id, name]) => ins.run(id, name, now, now));
  },
};

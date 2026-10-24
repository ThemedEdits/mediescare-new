'use strict';
// Phase 2: point of sale. Customers and their accounts, cashier shifts and cash movements, sales with lines and
// payments, returns, customer receipts, prescriptions, and bills on hold (local to one computer).
// Money is integer paisa. Quantities are base units; each sale line also remembers the selling unit used.

module.exports = {
  version: 3,
  name: 'pos',
  up(db) {
    db.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        phone TEXT,
        cnic TEXT,
        address TEXT,
        credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
        discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX customers_name ON customers (name COLLATE NOCASE);
      CREATE INDEX customers_phone ON customers (phone);

      -- What each customer owes this branch. Append-only; balance = SUM(debit) - SUM(credit).
      CREATE TABLE customer_ledger (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        customer_id TEXT NOT NULL REFERENCES customers (id),
        entry_date TEXT NOT NULL,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('opening', 'sale', 'sale_payment', 'void', 'return', 'receipt', 'receipt_cancel', 'adjustment')),
        ref_type TEXT,
        ref_id TEXT,
        ref_no TEXT,
        debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
        credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
        description TEXT,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (debit = 0 OR credit = 0)
      );
      CREATE INDEX customer_ledger_customer ON customer_ledger (branch_id, customer_id, entry_date);

      -- One open shift per computer at a time; the person who opened it sells on it.
      CREATE TABLE shifts (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        device_id TEXT NOT NULL,
        doc_no TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users (id),
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        opened_at TEXT NOT NULL,
        opening_cash INTEGER NOT NULL CHECK (opening_cash >= 0),
        closed_at TEXT,
        closed_by TEXT,
        expected_cash INTEGER,
        counted_cash INTEGER CHECK (counted_cash IS NULL OR counted_cash >= 0),
        over_short INTEGER,
        close_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX shifts_branch ON shifts (branch_id, opened_at);
      CREATE UNIQUE INDEX shifts_one_open_per_device ON shifts (device_id) WHERE status = 'open';

      CREATE TABLE cash_movements (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        shift_id TEXT NOT NULL REFERENCES shifts (id),
        kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        reason TEXT NOT NULL,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX cash_movements_shift ON cash_movements (shift_id);

      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        device_id TEXT,
        shift_id TEXT REFERENCES shifts (id),
        customer_id TEXT REFERENCES customers (id),
        cashier_id TEXT NOT NULL REFERENCES users (id),
        status TEXT NOT NULL CHECK (status IN ('completed', 'voided')),
        sold_at TEXT NOT NULL,
        sale_date TEXT NOT NULL,
        gross INTEGER NOT NULL,
        line_discount INTEGER NOT NULL DEFAULT 0,
        bill_discount INTEGER NOT NULL DEFAULT 0,
        bill_discount_type TEXT CHECK (bill_discount_type IS NULL OR bill_discount_type IN ('percent', 'amount')),
        bill_discount_value INTEGER,
        tax INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL CHECK (total >= 0),
        paid INTEGER NOT NULL DEFAULT 0,
        tendered INTEGER,
        change_given INTEGER NOT NULL DEFAULT 0 CHECK (change_given >= 0),
        credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
        cost INTEGER NOT NULL DEFAULT 0,
        approved_by TEXT,
        approval_reason TEXT,
        prescription_id TEXT,
        notes TEXT,
        voided_by TEXT,
        voided_at TEXT,
        void_reason TEXT,
        fbr_invoice_no TEXT,
        fbr_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (paid + credit_amount = total)
      );
      CREATE INDEX sales_branch_date ON sales (branch_id, sale_date);
      CREATE INDEX sales_customer ON sales (customer_id, sale_date);
      CREATE INDEX sales_shift ON sales (shift_id);
      CREATE INDEX sales_cashier ON sales (cashier_id, sale_date);

      -- Written once. A line is one batch; a quantity split across batches gives several lines.
      CREATE TABLE sale_lines (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        line_no INTEGER NOT NULL,
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        unit_id TEXT REFERENCES product_units (id),
        unit_name TEXT NOT NULL,
        unit_factor INTEGER NOT NULL CHECK (unit_factor >= 1),
        qty INTEGER NOT NULL CHECK (qty > 0),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
        list_price INTEGER NOT NULL CHECK (list_price >= 0),
        gross INTEGER NOT NULL,
        discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
        discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
        bill_discount INTEGER NOT NULL DEFAULT 0 CHECK (bill_discount >= 0),
        tax_bp INTEGER NOT NULL DEFAULT 0,
        tax INTEGER NOT NULL DEFAULT 0,
        net INTEGER NOT NULL CHECK (net >= 0),
        cost INTEGER NOT NULL,
        instructions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (net = gross - discount - bill_discount)
      );
      CREATE INDEX sale_lines_sale ON sale_lines (sale_id);
      CREATE INDEX sale_lines_product ON sale_lines (product_id);
      CREATE INDEX sale_lines_batch ON sale_lines (batch_id);

      -- Money in and out at the counter. kind: sale (at the bill), receipt (customer pays later), refund (money back).
      CREATE TABLE sale_payments (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        sale_id TEXT REFERENCES sales (id),
        return_id TEXT,
        receipt_id TEXT,
        shift_id TEXT REFERENCES shifts (id),
        kind TEXT NOT NULL CHECK (kind IN ('sale', 'receipt', 'refund')),
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'easypaisa', 'jazzcash', 'bank')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        reference TEXT,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX sale_payments_sale ON sale_payments (sale_id);
      CREATE INDEX sale_payments_shift ON sale_payments (shift_id);
      CREATE INDEX sale_payments_branch_at ON sale_payments (branch_id, at);

      CREATE TABLE sale_returns (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        sale_id TEXT NOT NULL REFERENCES sales (id),
        customer_id TEXT REFERENCES customers (id),
        shift_id TEXT REFERENCES shifts (id),
        total INTEGER NOT NULL CHECK (total >= 0),
        refund_method TEXT NOT NULL CHECK (refund_method IN ('cash', 'card', 'easypaisa', 'jazzcash', 'bank', 'account')),
        refund_amount INTEGER NOT NULL CHECK (refund_amount >= 0),
        account_amount INTEGER NOT NULL DEFAULT 0 CHECK (account_amount >= 0),
        cost INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        approved_by TEXT,
        user_id TEXT,
        returned_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (refund_amount + account_amount = total)
      );
      CREATE INDEX sale_returns_sale ON sale_returns (sale_id);
      CREATE INDEX sale_returns_branch ON sale_returns (branch_id, returned_at);

      CREATE TABLE sale_return_lines (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL REFERENCES sale_returns (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        sale_line_id TEXT NOT NULL REFERENCES sale_lines (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        qty INTEGER NOT NULL CHECK (qty > 0),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        cost INTEGER NOT NULL,
        condition TEXT NOT NULL CHECK (condition IN ('restock', 'damaged', 'expired', 'quarantine')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX sale_return_lines_line ON sale_return_lines (sale_line_id);

      CREATE TABLE customer_receipts (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL REFERENCES customers (id),
        shift_id TEXT REFERENCES shifts (id),
        received_date TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'easypaisa', 'jazzcash', 'bank')),
        reference TEXT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('posted', 'cancelled')),
        user_id TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX customer_receipts_customer ON customer_receipts (customer_id, received_date);

      -- Which credit bills a receipt paid (oldest first).
      CREATE TABLE receipt_allocations (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        receipt_id TEXT NOT NULL REFERENCES customer_receipts (id),
        sale_id TEXT NOT NULL REFERENCES sales (id),
        amount INTEGER NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX receipt_allocations_sale ON receipt_allocations (sale_id);

      -- Prescriptions captured for prescription-only and controlled medicines. Never deleted (kept at least 5 years).
      CREATE TABLE prescriptions (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        sale_id TEXT REFERENCES sales (id),
        patient_name TEXT NOT NULL,
        patient_cnic TEXT,
        patient_phone TEXT,
        patient_address TEXT,
        doctor_name TEXT NOT NULL,
        doctor_pmdc TEXT,
        doctor_clinic TEXT,
        rx_number TEXT,
        rx_date TEXT,
        photo TEXT,
        notes TEXT,
        user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX prescriptions_branch ON prescriptions (branch_id, created_at);
      CREATE INDEX prescriptions_patient ON prescriptions (patient_name COLLATE NOCASE);

      -- Bills put on hold at this counter. Local to this computer, never synced.
      CREATE TABLE held_bills (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        label TEXT,
        cart TEXT NOT NULL CHECK (json_valid(cart)),
        item_count INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
  },
};

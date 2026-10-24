'use strict';
// Phase 1: drug master, batches, the stock ledger, suppliers, purchasing, stock operations and transfers.
// Quantities are INTEGER base units (tablet, capsule, ml, piece). Prices and costs are INTEGER paisa per pack,
// where a pack is the product's purchase unit (pack_size base units).

const MOVEMENTS = [
  'OPENING', 'PURCHASE', 'PURCHASE_CANCEL', 'PURCHASE_RETURN', 'PURCHASE_RETURN_CANCEL', 'SALE', 'SALE_RETURN',
  'ADJUST_IN', 'ADJUST_OUT', 'DAMAGED', 'LOST', 'EXPIRED', 'STOCKTAKE', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_BACK',
];

module.exports = {
  version: 2,
  name: 'inventory',
  MOVEMENTS,
  up(db) {
    const movementList = MOVEMENTS.map((m) => `'${m}'`).join(', ');
    db.exec(`
      ALTER TABLE sync_ops ADD COLUMN branch_id2 TEXT;

      -- Configurable lists (categories, dosage forms, manufacturers, drug classes, storage conditions, unit names)
      CREATE TABLE lookups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('category', 'form', 'manufacturer', 'drug_class', 'storage', 'unit')),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX lookups_kind_name ON lookups (kind, name COLLATE NOCASE);

      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        city TEXT,
        licence_no TEXT,
        ntn TEXT,
        strn TEXT,
        payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
        credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
        contacts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contacts)),
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX suppliers_name ON suppliers (name);

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
        brand_name TEXT NOT NULL CHECK (length(brand_name) BETWEEN 1 AND 120),
        generic_name TEXT,
        strength TEXT,
        form_id TEXT REFERENCES lookups (id),
        category_id TEXT REFERENCES lookups (id),
        manufacturer_id TEXT REFERENCES lookups (id),
        drug_class_id TEXT REFERENCES lookups (id),
        storage_id TEXT REFERENCES lookups (id),
        base_unit TEXT NOT NULL DEFAULT 'Tablet',
        pack_unit TEXT NOT NULL DEFAULT 'Strip',
        pack_size INTEGER NOT NULL DEFAULT 1 CHECK (pack_size BETWEEN 1 AND 100000),
        rx_required INTEGER NOT NULL DEFAULT 0 CHECK (rx_required IN (0, 1)),
        controlled INTEGER NOT NULL DEFAULT 0 CHECK (controlled IN (0, 1)),
        cold_chain INTEGER NOT NULL DEFAULT 0 CHECK (cold_chain IN (0, 1)),
        drap_reg_no TEXT,
        tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
        mrp INTEGER NOT NULL DEFAULT 0 CHECK (mrp >= 0),
        trade_price INTEGER NOT NULL DEFAULT 0 CHECK (trade_price >= 0),
        min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
        max_stock INTEGER NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
        reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
        reorder_qty INTEGER NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
        default_supplier_id TEXT REFERENCES suppliers (id),
        image TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (controlled = 0 OR rx_required = 1)
      );
      CREATE INDEX products_brand ON products (brand_name COLLATE NOCASE);
      CREATE INDEX products_generic ON products (generic_name COLLATE NOCASE);

      -- Selling units: every product has its base unit (factor 1) and its pack; more can be added (box of 10 strips).
      CREATE TABLE product_units (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products (id),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
        factor INTEGER NOT NULL CHECK (factor >= 1),
        sellable INTEGER NOT NULL DEFAULT 1 CHECK (sellable IN (0, 1)),
        fixed_price INTEGER CHECK (fixed_price IS NULL OR fixed_price >= 0),
        sort INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX product_units_product ON product_units (product_id);

      CREATE TABLE product_barcodes (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products (id),
        unit_id TEXT REFERENCES product_units (id),
        barcode TEXT NOT NULL CHECK (length(barcode) BETWEEN 3 AND 64),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX product_barcodes_active ON product_barcodes (barcode) WHERE active = 1;
      CREATE INDEX product_barcodes_product ON product_barcodes (product_id);

      -- Per-branch values: shelf location, stock levels and an optional branch selling price per pack.
      CREATE TABLE product_branch (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        rack TEXT,
        min_stock INTEGER CHECK (min_stock IS NULL OR min_stock >= 0),
        max_stock INTEGER CHECK (max_stock IS NULL OR max_stock >= 0),
        reorder_level INTEGER CHECK (reorder_level IS NULL OR reorder_level >= 0),
        reorder_qty INTEGER CHECK (reorder_qty IS NULL OR reorder_qty >= 0),
        mrp_override INTEGER CHECK (mrp_override IS NULL OR mrp_override >= 0),
        updated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (product_id, branch_id)
      );

      CREATE TABLE price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products (id),
        branch_id TEXT,
        field TEXT NOT NULL,
        old_value INTEGER,
        new_value INTEGER,
        source TEXT NOT NULL,
        reason TEXT,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX price_history_product ON price_history (product_id, at);

      -- A batch is created by each goods receipt line (or opening stock). It is shared: the same batch row travels
      -- to branches with transfers; how much each branch holds comes from the stock ledger.
      CREATE TABLE batches (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_no TEXT NOT NULL CHECK (length(batch_no) BETWEEN 1 AND 40),
        expiry_date TEXT NOT NULL CHECK (expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
        mfg_date TEXT CHECK (mfg_date IS NULL OR mfg_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
        mrp INTEGER NOT NULL CHECK (mrp >= 0),
        cost INTEGER NOT NULL CHECK (cost >= 0),
        trade_price INTEGER NOT NULL DEFAULT 0 CHECK (trade_price >= 0),
        supplier_id TEXT REFERENCES suppliers (id),
        received_at TEXT NOT NULL,
        origin_branch_id TEXT NOT NULL REFERENCES branches (id),
        source_type TEXT NOT NULL CHECK (source_type IN ('grn', 'opening', 'adjustment', 'import')),
        source_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (mfg_date IS NULL OR mfg_date <= expiry_date)
      );
      CREATE INDEX batches_product_expiry ON batches (product_id, expiry_date);
      CREATE INDEX batches_no ON batches (batch_no COLLATE NOCASE);

      CREATE TABLE batch_status (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        quarantined INTEGER NOT NULL DEFAULT 0 CHECK (quarantined IN (0, 1)),
        reason TEXT,
        updated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (branch_id, batch_id)
      );

      -- The stock ledger. Append-only: on-hand stock is always the sum of these rows.
      CREATE TABLE stock_ledger (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        qty INTEGER NOT NULL CHECK (qty <> 0),
        movement TEXT NOT NULL CHECK (movement IN (${movementList})),
        ref_type TEXT NOT NULL,
        ref_id TEXT,
        ref_no TEXT,
        cost INTEGER NOT NULL CHECK (cost >= 0),
        pack_size INTEGER NOT NULL CHECK (pack_size >= 1),
        value INTEGER NOT NULL,
        before_qty INTEGER NOT NULL,
        after_qty INTEGER NOT NULL,
        reason TEXT,
        user_id TEXT,
        device_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (after_qty = before_qty + qty)
      );
      CREATE INDEX ledger_branch_batch ON stock_ledger (branch_id, batch_id, at);
      CREATE INDEX ledger_branch_product ON stock_ledger (branch_id, product_id, at);
      CREATE INDEX ledger_ref ON stock_ledger (ref_type, ref_id);
      CREATE INDEX ledger_at ON stock_ledger (branch_id, at);

      -- Local cache of on-hand quantity per branch and batch, kept by a trigger on the ledger. Never synced and
      -- always rebuildable from the ledger (stock.rebuildBalances).
      CREATE TABLE stock_balances (
        branch_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (branch_id, batch_id)
      );
      CREATE INDEX stock_balances_product ON stock_balances (branch_id, product_id);
      CREATE TRIGGER stock_balance_apply AFTER INSERT ON stock_ledger BEGIN
        INSERT INTO stock_balances (branch_id, batch_id, product_id, qty) VALUES (NEW.branch_id, NEW.batch_id, NEW.product_id, NEW.qty)
        ON CONFLICT (branch_id, batch_id) DO UPDATE SET qty = qty + NEW.qty;
      END;

      -- Purchasing ---------------------------------------------------------------------------------------------------
      CREATE TABLE purchase_orders (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL REFERENCES suppliers (id),
        status TEXT NOT NULL CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
        order_date TEXT NOT NULL,
        expected_date TEXT,
        notes TEXT,
        total INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        ordered_by TEXT,
        ordered_at TEXT,
        closed_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX po_branch_date ON purchase_orders (branch_id, order_date);

      CREATE TABLE purchase_order_lines (
        id TEXT PRIMARY KEY,
        po_id TEXT NOT NULL REFERENCES purchase_orders (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        qty INTEGER NOT NULL CHECK (qty > 0),
        price INTEGER NOT NULL CHECK (price >= 0),
        line_total INTEGER NOT NULL,
        received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
        sort INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX po_lines_po ON purchase_order_lines (po_id);

      CREATE TABLE grns (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL REFERENCES suppliers (id),
        po_id TEXT REFERENCES purchase_orders (id),
        supplier_invoice_no TEXT,
        invoice_date TEXT,
        received_date TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
        subtotal INTEGER NOT NULL DEFAULT 0,
        line_discount INTEGER NOT NULL DEFAULT 0,
        doc_discount INTEGER NOT NULL DEFAULT 0 CHECK (doc_discount >= 0),
        tax INTEGER NOT NULL DEFAULT 0,
        freight INTEGER NOT NULL DEFAULT 0 CHECK (freight >= 0),
        total INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT,
        posted_by TEXT,
        posted_at TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX grns_branch_date ON grns (branch_id, received_date);
      CREATE INDEX grns_supplier ON grns (supplier_id, received_date);

      CREATE TABLE grn_lines (
        id TEXT PRIMARY KEY,
        grn_id TEXT NOT NULL REFERENCES grns (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        po_line_id TEXT REFERENCES purchase_order_lines (id),
        batch_id TEXT REFERENCES batches (id),
        batch_no TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        mfg_date TEXT,
        qty INTEGER NOT NULL CHECK (qty > 0),
        bonus_qty INTEGER NOT NULL DEFAULT 0 CHECK (bonus_qty >= 0),
        price INTEGER NOT NULL CHECK (price >= 0),
        discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
        discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
        tax_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),
        tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
        gross INTEGER NOT NULL,
        line_total INTEGER NOT NULL,
        mrp INTEGER NOT NULL CHECK (mrp >= 0),
        unit_cost INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX grn_lines_grn ON grn_lines (grn_id);
      CREATE INDEX grn_lines_product ON grn_lines (product_id);

      CREATE TABLE purchase_returns (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL REFERENCES suppliers (id),
        grn_id TEXT REFERENCES grns (id),
        reason_type TEXT NOT NULL CHECK (reason_type IN ('expired', 'near_expiry', 'damaged', 'wrong_item', 'other')),
        status TEXT NOT NULL CHECK (status IN ('posted', 'cancelled')),
        return_date TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE purchase_return_lines (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL REFERENCES purchase_returns (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        qty INTEGER NOT NULL CHECK (qty > 0),
        price INTEGER NOT NULL CHECK (price >= 0),
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX purchase_return_lines_return ON purchase_return_lines (return_id);

      -- What the branch owes each supplier. Append-only; balance = SUM(credit) - SUM(debit).
      CREATE TABLE supplier_ledger (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        supplier_id TEXT NOT NULL REFERENCES suppliers (id),
        entry_date TEXT NOT NULL,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('opening', 'purchase', 'purchase_cancel', 'return', 'return_cancel', 'payment', 'payment_cancel', 'adjustment')),
        ref_type TEXT,
        ref_id TEXT,
        ref_no TEXT,
        debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
        credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
        due_date TEXT,
        description TEXT,
        user_id TEXT,
        at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (debit = 0 OR credit = 0)
      );
      CREATE INDEX supplier_ledger_supplier ON supplier_ledger (branch_id, supplier_id, entry_date);

      CREATE TABLE supplier_payments (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL REFERENCES suppliers (id),
        paid_date TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'cheque', 'online')),
        reference TEXT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('posted', 'cancelled')),
        created_by TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE payment_allocations (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        payment_id TEXT NOT NULL REFERENCES supplier_payments (id),
        grn_id TEXT NOT NULL REFERENCES grns (id),
        amount INTEGER NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX payment_allocations_grn ON payment_allocations (grn_id);

      -- Stock operations ---------------------------------------------------------------------------------------------
      CREATE TABLE stock_adjustments (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('opening', 'increase', 'decrease', 'damaged', 'lost', 'expired')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'rejected')),
        reason TEXT NOT NULL,
        total_value INTEGER NOT NULL DEFAULT 0,
        requested_by TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX stock_adjustments_branch ON stock_adjustments (branch_id, created_at);

      CREATE TABLE stock_adjustment_lines (
        id TEXT PRIMARY KEY,
        adjustment_id TEXT NOT NULL REFERENCES stock_adjustments (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT REFERENCES batches (id),
        batch_no TEXT,
        expiry_date TEXT,
        mfg_date TEXT,
        mrp INTEGER,
        cost INTEGER,
        qty INTEGER NOT NULL CHECK (qty > 0),
        value INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (batch_id IS NOT NULL OR (batch_no IS NOT NULL AND expiry_date IS NOT NULL AND cost IS NOT NULL AND mrp IS NOT NULL))
      );
      CREATE INDEX stock_adjustment_lines_doc ON stock_adjustment_lines (adjustment_id);

      CREATE TABLE stock_takes (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id),
        doc_no TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('counting', 'posted', 'cancelled')),
        filter TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filter)),
        started_by TEXT,
        started_at TEXT NOT NULL,
        posted_by TEXT,
        posted_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE stock_take_lines (
        id TEXT PRIMARY KEY,
        take_id TEXT NOT NULL REFERENCES stock_takes (id),
        branch_id TEXT NOT NULL REFERENCES branches (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT NOT NULL REFERENCES batches (id),
        system_qty INTEGER NOT NULL,
        counted_qty INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
        variance INTEGER,
        value INTEGER,
        note TEXT,
        counted_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (take_id, batch_id)
      );

      -- Transfers between branches. Both branches receive these rows (sync uses from_branch_id and to_branch_id).
      CREATE TABLE transfers (
        id TEXT PRIMARY KEY,
        doc_no TEXT NOT NULL UNIQUE,
        from_branch_id TEXT NOT NULL REFERENCES branches (id),
        to_branch_id TEXT NOT NULL REFERENCES branches (id),
        status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'rejected', 'dispatched', 'received', 'cancelled')),
        notes TEXT,
        requested_by TEXT,
        requested_at TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT,
        dispatched_by TEXT,
        dispatched_at TEXT,
        received_by TEXT,
        received_at TEXT,
        has_discrepancy INTEGER NOT NULL DEFAULT 0 CHECK (has_discrepancy IN (0, 1)),
        discrepancy_open INTEGER NOT NULL DEFAULT 0 CHECK (discrepancy_open IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (from_branch_id <> to_branch_id)
      );
      CREATE INDEX transfers_from ON transfers (from_branch_id, status);
      CREATE INDEX transfers_to ON transfers (to_branch_id, status);

      -- Request lines have no batch. Dispatch lines name the batch (FEFO by default) and point to their request line.
      CREATE TABLE transfer_lines (
        id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL REFERENCES transfers (id),
        from_branch_id TEXT NOT NULL REFERENCES branches (id),
        to_branch_id TEXT NOT NULL REFERENCES branches (id),
        line_type TEXT NOT NULL CHECK (line_type IN ('request', 'dispatch')),
        parent_id TEXT REFERENCES transfer_lines (id),
        product_id TEXT NOT NULL REFERENCES products (id),
        batch_id TEXT REFERENCES batches (id),
        qty INTEGER NOT NULL CHECK (qty > 0),
        received_qty INTEGER CHECK (received_qty IS NULL OR received_qty >= 0),
        discrepancy_reason TEXT,
        resolution TEXT CHECK (resolution IS NULL OR resolution IN ('returned', 'written_off')),
        resolved_by TEXT,
        resolved_at TEXT,
        cost INTEGER,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (line_type = 'request' OR batch_id IS NOT NULL),
        CHECK (received_qty IS NULL OR received_qty <= qty)
      );
      CREATE INDEX transfer_lines_transfer ON transfer_lines (transfer_id);
    `);
  },
};

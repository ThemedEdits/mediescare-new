'use strict';
// Phase 5: indexes found by the performance test (500,000 stock movements). Both cover their queries, so SQLite reads
// only the index: the stock consistency check (balance per batch) and the inventory reconciliation (per product by time).

module.exports = {
  version: 6,
  name: 'performance',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS ledger_batch_qty ON stock_ledger (branch_id, batch_id, qty);
      CREATE INDEX IF NOT EXISTS ledger_product_time ON stock_ledger (branch_id, product_id, at, movement, qty);
      CREATE INDEX IF NOT EXISTS customer_receipts_branch ON customer_receipts (branch_id, received_date);
      CREATE INDEX IF NOT EXISTS supplier_payments_branch ON supplier_payments (branch_id, paid_date);
      CREATE INDEX IF NOT EXISTS cash_movements_branch ON cash_movements (branch_id, at);
    `);
  },
};

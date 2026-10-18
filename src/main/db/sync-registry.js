'use strict';
// Every table that travels between PCs and the cloud is listed here.
//   scope 'global' : shared master data, every PC of the organisation receives it (branch_id in the op is NULL)
//   scope 'branch' : the row's branch column(s) decide which branches receive it (NULL means shared)
//   merge 'lww'    : editable rows, last change wins by updated_at, tie broken by op_id
//   merge 'append' : written once, never overwritten (INSERT OR IGNORE)
// Tables not listed here are local to one PC (sessions, sequences, sync bookkeeping, login attempts, stock_balances).
// Every synced table must have a TEXT primary key `id` and an `updated_at` column.

const SYNCED_TABLES = [
  // Phase 0
  { table: 'org', scope: 'global', merge: 'lww' },
  { table: 'branches', scope: 'global', merge: 'lww' },
  { table: 'devices', scope: 'global', merge: 'lww' },
  { table: 'roles', scope: 'global', merge: 'lww' },
  { table: 'users', scope: 'global', merge: 'lww' },
  { table: 'settings', scope: 'branch', merge: 'lww' },
  { table: 'audit_log', scope: 'branch', merge: 'append' },
  // Phase 1: master data
  { table: 'lookups', scope: 'global', merge: 'lww' },
  { table: 'suppliers', scope: 'global', merge: 'lww' },
  { table: 'products', scope: 'global', merge: 'lww' },
  { table: 'product_units', scope: 'global', merge: 'lww' },
  { table: 'product_barcodes', scope: 'global', merge: 'lww' },
  { table: 'product_branch', scope: 'branch', merge: 'lww' },
  { table: 'price_history', scope: 'branch', merge: 'append' },
  { table: 'batches', scope: 'global', merge: 'lww' },
  { table: 'batch_status', scope: 'branch', merge: 'lww' },
  // Phase 1: stock and documents
  { table: 'stock_ledger', scope: 'branch', merge: 'append' },
  { table: 'purchase_orders', scope: 'branch', merge: 'lww' },
  { table: 'purchase_order_lines', scope: 'branch', merge: 'lww' },
  { table: 'grns', scope: 'branch', merge: 'lww' },
  { table: 'grn_lines', scope: 'branch', merge: 'lww' },
  { table: 'purchase_returns', scope: 'branch', merge: 'lww' },
  { table: 'purchase_return_lines', scope: 'branch', merge: 'append' },
  { table: 'supplier_ledger', scope: 'branch', merge: 'append' },
  { table: 'supplier_payments', scope: 'branch', merge: 'lww' },
  { table: 'payment_allocations', scope: 'branch', merge: 'append' },
  { table: 'stock_adjustments', scope: 'branch', merge: 'lww' },
  { table: 'stock_adjustment_lines', scope: 'branch', merge: 'lww' },
  { table: 'stock_takes', scope: 'branch', merge: 'lww' },
  { table: 'stock_take_lines', scope: 'branch', merge: 'lww' },
  { table: 'transfers', scope: 'branch', merge: 'lww', branchColumns: ['from_branch_id', 'to_branch_id'] },
  { table: 'transfer_lines', scope: 'branch', merge: 'lww', branchColumns: ['from_branch_id', 'to_branch_id'] },
  // Phase 2: point of sale
  { table: 'customers', scope: 'global', merge: 'lww' },
  { table: 'customer_ledger', scope: 'branch', merge: 'append' },
  { table: 'shifts', scope: 'branch', merge: 'lww' },
  { table: 'cash_movements', scope: 'branch', merge: 'append' },
  { table: 'sales', scope: 'branch', merge: 'lww' },
  { table: 'sale_lines', scope: 'branch', merge: 'append' },
  { table: 'sale_payments', scope: 'branch', merge: 'append' },
  { table: 'sale_returns', scope: 'branch', merge: 'append' },
  { table: 'sale_return_lines', scope: 'branch', merge: 'append' },
  { table: 'customer_receipts', scope: 'branch', merge: 'lww' },
  { table: 'receipt_allocations', scope: 'branch', merge: 'append' },
  { table: 'prescriptions', scope: 'branch', merge: 'lww' },
  // Phase 4: expenses and approvals
  { table: 'expense_categories', scope: 'global', merge: 'lww' },
  { table: 'expenses', scope: 'branch', merge: 'lww' },
  { table: 'petty_cash', scope: 'branch', merge: 'append' },
  { table: 'approval_requests', scope: 'branch', merge: 'lww' },
  // Phase 5: one-time join codes for a branch's new main computer
  { table: 'join_codes', scope: 'branch', merge: 'lww' },
];

// Append-only tables refuse UPDATE and DELETE at the database level, even for the app itself.
const APPEND_ONLY_TABLES = [
  'audit_log', 'stock_ledger', 'price_history', 'supplier_ledger', 'payment_allocations', 'purchase_return_lines',
  'customer_ledger', 'cash_movements', 'sale_lines', 'sale_payments', 'sale_returns', 'sale_return_lines', 'receipt_allocations',
  'petty_cash',
];

module.exports = { SYNCED_TABLES, APPEND_ONLY_TABLES };

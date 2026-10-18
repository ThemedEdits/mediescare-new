'use strict';
// The permission catalogue. Every key here is a string such as "products.edit".
// The role editor shows this list grouped by module; the RPC router checks these keys.
// Modules for later phases are listed now so roles can be prepared before those screens exist.

const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete or deactivate',
  approve: 'Approve',
  export: 'Export and print',
};

const MODULES = [
  { key: 'dashboard', label: 'Dashboard', actions: ['view'] },
  { key: 'pos', label: 'Point of sale (counter)', actions: ['view', 'create'] },
  { key: 'sales', label: 'Sales history and receipts', actions: ['view', 'export'] },
  { key: 'shifts', label: 'Cashier shifts and cash register', actions: ['view', 'create', 'approve'] },
  { key: 'customers', label: 'Customers and patients', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'controlled', label: 'Prescriptions and controlled drug register', actions: ['view', 'export'] },
  { key: 'products', label: 'Medicines and products', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'batches', label: 'Batches and expiry', actions: ['view', 'edit', 'export'] },
  { key: 'stock', label: 'Stock adjustments and write-offs', actions: ['view', 'create', 'approve', 'export'] },
  { key: 'stocktake', label: 'Stock take', actions: ['view', 'create', 'approve'] },
  { key: 'transfers', label: 'Transfers between branches', actions: ['view', 'create', 'approve', 'export'] },
  { key: 'purchases', label: 'Purchase orders and goods receipt', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  { key: 'suppliers', label: 'Suppliers', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'supplier_payments', label: 'Supplier payments', actions: ['view', 'create', 'approve'] },
  { key: 'expenses', label: 'Expenses and petty cash', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  { key: 'finance', label: 'Financial records', actions: ['view', 'export'] },
  { key: 'reports', label: 'Reports', actions: ['view', 'export'] },
  { key: 'approvals', label: 'Approvals', actions: ['view', 'approve'] },
  { key: 'import', label: 'Data import', actions: ['create'] },
  { key: 'branches', label: 'Branches', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users', label: 'Users', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'roles', label: 'Roles and permissions', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'devices', label: 'Computers (devices)', actions: ['view', 'edit'] },
  { key: 'settings', label: 'Settings', actions: ['view', 'edit'] },
  { key: 'audit', label: 'Audit log', actions: ['view', 'export'] },
  { key: 'sync', label: 'Sync status and log', actions: ['view'] },
  { key: 'backups', label: 'Backups', actions: ['view', 'create'] },
];

const SPECIAL = [
  { key: 'cost.view', label: 'See purchase cost and profit' },
  { key: 'discount.above_limit', label: 'Give discounts above the normal limit' },
  { key: 'price.override', label: 'Change the selling price at the counter' },
  { key: 'sales.credit', label: 'Sell on credit' },
  { key: 'sales.void', label: 'Cancel (void) a bill' },
  { key: 'sales.return', label: 'Take returns and give refunds' },
  { key: 'sales.reprint', label: 'Reprint receipts' },
  { key: 'payments.edit_date', label: 'Change the date of a received payment' },
  { key: 'transfers.dispatch', label: 'Dispatch transfers' },
  { key: 'transfers.receive', label: 'Receive transfers' },
  { key: 'purchases.direct_branch', label: 'Branch may buy directly from suppliers' },
  { key: 'prices.branch_override', label: 'Set branch-specific prices' },
  { key: 'branch.switch', label: 'Switch the active branch' },
  { key: 'branches.view_all', label: 'See data of all branches' },
  { key: 'reports.financial', label: 'See financial reports' },
  { key: 'sync.manual', label: 'Run sync manually' },
  { key: 'backups.restore', label: 'Restore a backup' },
  { key: 'shortcuts.others', label: 'Edit keyboard shortcuts of other users' },
];

const ALL = [
  ...MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`)),
  ...SPECIAL.map((s) => s.key),
];
const ALL_SET = new Set(ALL);

function catalogue() {
  return {
    actions: ACTION_LABELS,
    modules: MODULES.map((m) => ({ ...m, actions: m.actions.map((a) => ({ key: `${m.key}.${a}`, action: a, label: ACTION_LABELS[a] })) })),
    special: SPECIAL,
  };
}

function isKnown(key) {
  return ALL_SET.has(key);
}

const mod = (key, ...actions) => actions.map((a) => `${key}.${a}`);

// Default roles shipped with a new organisation. Admins can change all of them except Super Admin.
const DEFAULT_ROLES = [
  {
    name: 'Super Admin',
    description: 'Owner. Full access to every branch and every feature.',
    isSuper: true,
    permissions: [],
  },
  {
    name: 'Branch Admin',
    description: 'Branch manager. Runs one branch: staff, stock, sales, reports.',
    permissions: [
      ...mod('dashboard', 'view'), ...mod('pos', 'view', 'create'), ...mod('sales', 'view', 'export'),
      ...mod('shifts', 'view', 'create', 'approve'), ...mod('customers', 'view', 'create', 'edit', 'delete', 'export'),
      ...mod('controlled', 'view', 'export'), ...mod('products', 'view', 'create', 'edit', 'export'),
      ...mod('batches', 'view', 'edit', 'export'), ...mod('stock', 'view', 'create', 'approve', 'export'),
      ...mod('stocktake', 'view', 'create', 'approve'), ...mod('transfers', 'view', 'create', 'export'),
      ...mod('purchases', 'view', 'create', 'edit', 'approve', 'export'), ...mod('suppliers', 'view', 'export'),
      ...mod('supplier_payments', 'view'), ...mod('expenses', 'view', 'create', 'edit', 'approve', 'export'),
      ...mod('finance', 'view', 'export'), ...mod('reports', 'view', 'export'), ...mod('approvals', 'view', 'approve'),
      ...mod('import', 'create'), ...mod('branches', 'view'), ...mod('users', 'view', 'create', 'edit', 'delete'),
      ...mod('roles', 'view'), ...mod('devices', 'view', 'edit'), ...mod('settings', 'view', 'edit'),
      ...mod('audit', 'view', 'export'), ...mod('sync', 'view'), ...mod('backups', 'view', 'create'),
      'cost.view', 'discount.above_limit', 'price.override', 'sales.credit', 'sales.void', 'sales.return',
      'sales.reprint', 'payments.edit_date', 'transfers.dispatch', 'transfers.receive', 'reports.financial',
      'sync.manual', 'shortcuts.others',
    ],
  },
  {
    name: 'Pharmacist',
    description: 'Sells, checks prescriptions and controlled drugs, takes returns.',
    permissions: [
      ...mod('dashboard', 'view'), ...mod('pos', 'view', 'create'), ...mod('sales', 'view'), ...mod('shifts', 'view', 'create'),
      ...mod('customers', 'view', 'create', 'edit'), ...mod('controlled', 'view', 'export'), ...mod('products', 'view'),
      ...mod('batches', 'view'), ...mod('stock', 'view'), ...mod('approvals', 'view'),
      'sales.credit', 'sales.return', 'sales.reprint',
    ],
  },
  {
    name: 'Cashier',
    description: 'Sells at the counter and handles the cash drawer.',
    permissions: [
      ...mod('pos', 'view', 'create'), ...mod('sales', 'view'), ...mod('shifts', 'view', 'create'),
      ...mod('customers', 'view', 'create'), ...mod('products', 'view'),
    ],
  },
  {
    name: 'Store Keeper',
    description: 'Receives stock, keeps batches and expiry in order, handles transfers.',
    permissions: [
      ...mod('dashboard', 'view'), ...mod('products', 'view', 'create', 'edit', 'export'), ...mod('batches', 'view', 'edit', 'export'),
      ...mod('stock', 'view', 'create', 'export'), ...mod('stocktake', 'view', 'create'), ...mod('transfers', 'view', 'create', 'export'),
      ...mod('purchases', 'view', 'create', 'edit', 'export'), ...mod('suppliers', 'view'), ...mod('import', 'create'),
      ...mod('reports', 'view'), 'cost.view', 'transfers.dispatch', 'transfers.receive',
    ],
  },
  {
    name: 'Accountant',
    description: 'Money: sales, payments, expenses, ledgers and financial reports.',
    permissions: [
      ...mod('dashboard', 'view'), ...mod('sales', 'view', 'export'), ...mod('shifts', 'view'),
      ...mod('customers', 'view', 'export'), ...mod('suppliers', 'view', 'export'), ...mod('supplier_payments', 'view', 'create'),
      ...mod('expenses', 'view', 'create', 'edit', 'export'), ...mod('finance', 'view', 'export'), ...mod('reports', 'view', 'export'),
      ...mod('purchases', 'view', 'export'), ...mod('audit', 'view'), 'cost.view', 'reports.financial', 'payments.edit_date',
    ],
  },
];

for (const role of DEFAULT_ROLES) {
  for (const p of role.permissions) {
    if (!ALL_SET.has(p)) throw new Error(`Default role ${role.name} uses unknown permission ${p}`);
  }
}

module.exports = { MODULES, SPECIAL, ALL, catalogue, isKnown, DEFAULT_ROLES };

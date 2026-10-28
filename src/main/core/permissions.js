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

const PAGES = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'chart',
    pagePerm: 'dashboard.view',
    actions: [
      { key: 'dashboard.view', label: 'Access Dashboard (Whole Page)', isPage: true },
      { key: 'dashboard.stats_financial', label: 'Financial Overview Stats (Sales, Profit, Bills, Expenses)' },
      { key: 'dashboard.stats_payments', label: 'Payments & Cashflow Stats (Cash, Card, Collections, Returns)' },
      { key: 'dashboard.stats_inventory', label: 'Inventory Alert Stats (Low Stock, Near Expiry, Expired)' },
      { key: 'dashboard.stats_balances', label: 'Balances & Action Stats (Approvals, Receivables, Payables)' },
      { key: 'dashboard.charts', label: 'Analytics Charts (Trend, Top Products, Categories)' },
    ],
  },
  {
    key: 'pos',
    label: 'Point of Sale (Counter)',
    icon: 'cart',
    pagePerm: 'pos.view',
    actions: [
      { key: 'pos.view', label: 'Open POS Counter (Whole Page)', isPage: true },
      { key: 'pos.create', label: 'Process & Complete Sales' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales History & Receipts',
    icon: 'receipt',
    pagePerm: 'sales.view',
    actions: [
      { key: 'sales.view', label: 'View Sales History & Bills (Whole Page)', isPage: true },
      { key: 'sales.export', label: 'Export Sales History' },
      { key: 'sales.reprint', label: 'Reprint Receipts & Download PDF' },
      { key: 'sales.return', label: 'Process Returns & Refunds' },
      { key: 'sales.void', label: 'Void / Cancel Bills' },
      { key: 'sales.credit', label: 'Sell on Credit' },
    ],
  },
  {
    key: 'customers',
    label: 'Customers & Patients',
    icon: 'users',
    pagePerm: 'customers.view',
    actions: [
      { key: 'customers.view', label: 'View Customers Directory (Whole Page)', isPage: true },
      { key: 'customers.create', label: 'Add New Customers' },
      { key: 'customers.edit', label: 'Edit Customer Details & Limits' },
      { key: 'customers.delete', label: 'Deactivate Customers' },
      { key: 'customers.export', label: 'Export Customer Directory & Ledger' },
    ],
  },
  {
    key: 'shifts',
    label: 'Cashier Shifts & Register',
    icon: 'wallet',
    pagePerm: 'shifts.view',
    actions: [
      { key: 'shifts.view', label: 'View Shifts & Register History (Whole Page)', isPage: true },
      { key: 'shifts.create', label: 'Open & Close Register Shifts' },
      { key: 'shifts.approve', label: 'Approve Shift Variances' },
    ],
  },
  {
    key: 'controlled',
    label: 'Controlled Drugs & Prescriptions',
    icon: 'shield',
    pagePerm: 'controlled.view',
    actions: [
      { key: 'controlled.view', label: 'View Controlled Register (Whole Page)', isPage: true },
      { key: 'controlled.export', label: 'Export Controlled Drug Register' },
    ],
  },
  {
    key: 'products',
    label: 'Medicines & Products',
    icon: 'pill',
    pagePerm: 'products.view',
    actions: [
      { key: 'products.view', label: 'View Medicines & Products (Whole Page)', isPage: true },
      { key: 'products.create', label: 'Add New Medicines & Products' },
      { key: 'products.edit', label: 'Edit Product Details & Packaging' },
      { key: 'products.delete', label: 'Deactivate / Delete Products' },
      { key: 'products.export', label: 'Export Products Catalogue' },
      { key: 'import.create', label: 'Import Products & Stock from Files' },
    ],
  },
  {
    key: 'batches',
    label: 'Batches & Expiry',
    icon: 'layers',
    pagePerm: 'batches.view',
    actions: [
      { key: 'batches.view', label: 'View Batches & Expiry (Whole Page)', isPage: true },
      { key: 'batches.edit', label: 'Edit Batch Numbers & Expiry Dates' },
      { key: 'batches.export', label: 'Export Batches & Expiry Reports' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock Adjustments & Write-offs',
    icon: 'clipboard',
    pagePerm: 'stock.view',
    actions: [
      { key: 'stock.view', label: 'View Adjustments & Movements (Whole Page)', isPage: true },
      { key: 'stock.create', label: 'Create Stock Adjustments & Write-offs' },
      { key: 'stock.approve', label: 'Approve Stock Adjustments' },
      { key: 'stock.export', label: 'Export Adjustments & Movements' },
    ],
  },
  {
    key: 'stocktake',
    label: 'Stock Take (Physical Audit)',
    icon: 'list',
    pagePerm: 'stocktake.view',
    actions: [
      { key: 'stocktake.view', label: 'View Stock Take Sessions (Whole Page)', isPage: true },
      { key: 'stocktake.create', label: 'Create & Count Physical Inventory' },
      { key: 'stocktake.approve', label: 'Approve & Reconcile Counts' },
    ],
  },
  {
    key: 'transfers',
    label: 'Branch Transfers',
    icon: 'switch',
    pagePerm: 'transfers.view',
    actions: [
      { key: 'transfers.view', label: 'View Branch Transfers (Whole Page)', isPage: true },
      { key: 'transfers.create', label: 'Request Stock from Branches' },
      { key: 'transfers.dispatch', label: 'Dispatch Stock Transfers' },
      { key: 'transfers.receive', label: 'Receive Incoming Stock Transfers' },
      { key: 'transfers.approve', label: 'Approve Transfer Requests' },
      { key: 'transfers.export', label: 'Export Transfer Notes' },
    ],
  },
  {
    key: 'purchases',
    label: 'Purchase Orders & Goods Receipt',
    icon: 'download',
    pagePerm: 'purchases.view',
    actions: [
      { key: 'purchases.view', label: 'View POs & Goods Receipts (Whole Page)', isPage: true },
      { key: 'purchases.create', label: 'Create Purchase Orders & Receive Goods' },
      { key: 'purchases.edit', label: 'Edit Purchase Orders & Receipts' },
      { key: 'purchases.approve', label: 'Approve Purchase Orders & Receipts' },
      { key: 'purchases.export', label: 'Export Purchase Documents' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    icon: 'truck',
    pagePerm: 'suppliers.view',
    actions: [
      { key: 'suppliers.view', label: 'View Supplier Directory (Whole Page)', isPage: true },
      { key: 'suppliers.create', label: 'Add New Suppliers' },
      { key: 'suppliers.edit', label: 'Edit Supplier Details' },
      { key: 'suppliers.delete', label: 'Deactivate Suppliers' },
      { key: 'suppliers.export', label: 'Export Supplier Directory' },
    ],
  },
  {
    key: 'supplier_payments',
    label: 'Supplier Payments',
    icon: 'wallet',
    pagePerm: 'supplier_payments.view',
    actions: [
      { key: 'supplier_payments.view', label: 'View Supplier Payments (Whole Page)', isPage: true },
      { key: 'supplier_payments.create', label: 'Record Supplier Payments' },
      { key: 'supplier_payments.approve', label: 'Approve Supplier Payments' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses & Petty Cash',
    icon: 'wallet',
    pagePerm: 'expenses.view',
    actions: [
      { key: 'expenses.view', label: 'View Expenses & Petty Cash (Whole Page)', isPage: true },
      { key: 'expenses.create', label: 'Record Expenses & Petty Cash Vouchers' },
      { key: 'expenses.edit', label: 'Edit Expense Vouchers' },
      { key: 'expenses.approve', label: 'Approve Expense Claims' },
      { key: 'expenses.export', label: 'Export Expense Reports' },
    ],
  },
  {
    key: 'finance',
    label: 'Financial Records (Journal)',
    icon: 'clipboard',
    pagePerm: 'finance.view',
    actions: [
      { key: 'finance.view', label: 'View Financial Journal & Accounts (Whole Page)', isPage: true },
      { key: 'finance.export', label: 'Export Financial Records' },
      { key: 'payments.edit_date', label: 'Change Transaction / Voucher Date' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports & Analytics',
    icon: 'chart',
    pagePerm: 'reports.view',
    actions: [
      { key: 'reports.view', label: 'View Reports Catalogue (Whole Page)', isPage: true },
      { key: 'reports.financial', label: 'View Financial & Profitability Reports' },
      { key: 'reports.export', label: 'Export Report Data' },
    ],
  },
  {
    key: 'approvals',
    label: 'Approvals Queue',
    icon: 'check',
    pagePerm: 'approvals.view',
    actions: [
      { key: 'approvals.view', label: 'View Pending Approvals (Whole Page)', isPage: true },
      { key: 'approvals.approve', label: 'Approve or Reject Requests' },
    ],
  },
  {
    key: 'branches',
    label: 'Branches Management',
    icon: 'building',
    pagePerm: 'branches.view',
    actions: [
      { key: 'branches.view', label: 'View Branch Directory (Whole Page)', isPage: true },
      { key: 'branches.create', label: 'Add New Branches' },
      { key: 'branches.edit', label: 'Edit Branch Information' },
      { key: 'branches.delete', label: 'Deactivate Branches' },
      { key: 'branches.view_all', label: 'View All Branches Data' },
      { key: 'branch.switch', label: 'Switch Active Branch Context' },
    ],
  },
  {
    key: 'users',
    label: 'Users & Staff',
    icon: 'users',
    pagePerm: 'users.view',
    actions: [
      { key: 'users.view', label: 'View Staff Accounts (Whole Page)', isPage: true },
      { key: 'users.create', label: 'Create New Staff Accounts' },
      { key: 'users.edit', label: 'Edit Staff Accounts & Assign Roles' },
      { key: 'users.delete', label: 'Deactivate Staff Accounts' },
    ],
  },
  {
    key: 'roles',
    label: 'Roles & Permissions',
    icon: 'shield',
    pagePerm: 'roles.view',
    actions: [
      { key: 'roles.view', label: 'View Roles & Permissions (Whole Page)', isPage: true },
      { key: 'roles.create', label: 'Create New Custom Roles' },
      { key: 'roles.edit', label: 'Edit Role Permissions & Checkboxes' },
      { key: 'roles.delete', label: 'Deactivate Roles' },
    ],
  },
  {
    key: 'devices',
    label: 'Computers & Devices',
    icon: 'monitor',
    pagePerm: 'devices.view',
    actions: [
      { key: 'devices.view', label: 'View Registered Computers (Whole Page)', isPage: true },
      { key: 'devices.edit', label: 'Manage Device Pairing & Settings' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'settings',
    pagePerm: 'settings.view',
    actions: [
      { key: 'settings.view', label: 'View System Settings (Whole Page)', isPage: true },
      { key: 'settings.edit', label: 'Modify System & Branch Settings' },
      { key: 'shortcuts.others', label: 'Edit Keyboard Shortcuts for Other Users' },
    ],
  },
  {
    key: 'sync',
    label: 'Sync Status & Log',
    icon: 'cloud',
    pagePerm: 'sync.view',
    actions: [
      { key: 'sync.view', label: 'View Sync Status (Whole Page)', isPage: true },
      { key: 'sync.manual', label: 'Run Manual Sync Now' },
    ],
  },
  {
    key: 'backups',
    label: 'Backups',
    icon: 'database',
    pagePerm: 'backups.view',
    actions: [
      { key: 'backups.view', label: 'View Automated Backups (Whole Page)', isPage: true },
      { key: 'backups.create', label: 'Create Manual Backups' },
      { key: 'backups.restore', label: 'Restore Database from Backup' },
    ],
  },
  {
    key: 'audit',
    label: 'Audit Log & Change Trail',
    icon: 'history',
    pagePerm: 'audit.view',
    actions: [
      { key: 'audit.view', label: 'View Audit Trail (Whole Page)', isPage: true },
      { key: 'audit.export', label: 'Export Audit Trail Logs' },
    ],
  },
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
  ...PAGES.flatMap((p) => p.actions.map((a) => a.key)),
];
const ALL_SET = new Set(ALL);

function catalogue() {
  return {
    actions: ACTION_LABELS,
    modules: MODULES.map((m) => ({ ...m, actions: m.actions.map((a) => ({ key: `${m.key}.${a}`, action: a, label: ACTION_LABELS[a] })) })),
    pages: PAGES,
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
      ...mod('dashboard', 'view'),
      'dashboard.stats_financial', 'dashboard.stats_payments', 'dashboard.stats_inventory', 'dashboard.stats_balances', 'dashboard.charts',
      ...mod('pos', 'view', 'create'), ...mod('sales', 'view', 'export'),
      ...mod('shifts', 'view', 'create', 'approve'), ...mod('customers', 'view', 'create', 'edit', 'delete', 'export'),
      ...mod('controlled', 'view', 'export'), ...mod('products', 'view', 'create', 'edit', 'delete', 'export'),
      ...mod('batches', 'view', 'edit', 'export'), ...mod('stock', 'view', 'create', 'approve', 'export'),
      ...mod('stocktake', 'view', 'create', 'approve'), ...mod('transfers', 'view', 'create', 'approve', 'export'),
      ...mod('purchases', 'view', 'create', 'edit', 'approve', 'export'), ...mod('suppliers', 'view', 'create', 'edit', 'delete', 'export'),
      ...mod('supplier_payments', 'view', 'create', 'approve'), ...mod('expenses', 'view', 'create', 'edit', 'approve', 'export'),
      ...mod('finance', 'view', 'export'), ...mod('reports', 'view', 'export'), ...mod('approvals', 'view', 'approve'),
      ...mod('import', 'create'), ...mod('branches', 'view', 'edit'), ...mod('users', 'view', 'create', 'edit', 'delete'),
      ...mod('roles', 'view', 'create', 'edit', 'delete'), ...mod('devices', 'view', 'edit'), ...mod('settings', 'view', 'edit'),
      ...mod('audit', 'view', 'export'), ...mod('sync', 'view'), ...mod('backups', 'view', 'create'),
      'cost.view', 'discount.above_limit', 'price.override', 'sales.credit', 'sales.void', 'sales.return',
      'sales.reprint', 'payments.edit_date', 'transfers.dispatch', 'transfers.receive', 'prices.branch_override',
      'reports.financial', 'sync.manual', 'backups.restore', 'shortcuts.others',
    ],
  },
  {
    name: 'Pharmacist',
    description: 'Sells, checks prescriptions and controlled drugs, takes returns.',
    permissions: [
      ...mod('dashboard', 'view'), 'dashboard.stats_inventory', ...mod('pos', 'view', 'create'), ...mod('sales', 'view'), ...mod('shifts', 'view', 'create'),
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
      ...mod('dashboard', 'view'), 'dashboard.stats_inventory', ...mod('products', 'view', 'create', 'edit', 'export'), ...mod('batches', 'view', 'edit', 'export'),
      ...mod('stock', 'view', 'create', 'export'), ...mod('stocktake', 'view', 'create'), ...mod('transfers', 'view', 'create', 'export'),
      ...mod('purchases', 'view', 'create', 'edit', 'export'), ...mod('suppliers', 'view'), ...mod('import', 'create'),
      ...mod('reports', 'view'), 'cost.view', 'transfers.dispatch', 'transfers.receive',
    ],
  },
  {
    name: 'Accountant',
    description: 'Money: sales, payments, expenses, ledgers and financial reports.',
    permissions: [
      ...mod('dashboard', 'view'), 'dashboard.stats_financial', 'dashboard.stats_payments', 'dashboard.stats_balances', ...mod('sales', 'view', 'export'), ...mod('shifts', 'view'),
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

// Hash routes (#/users, #/audit?recordId=...) and the navigation menu. Only pages the role allows are listed.
import { t } from './strings/index.js';
import { canAny } from './state.js';

// A page module exports render(); some modules hold several pages, picked here by export name.
const pick = (loader, name) => () => loader().then((m) => ({ render: m[name] }));

export const ROUTES = [
  { path: 'home', title: () => t('nav.home'), icon: 'home', group: 'main', perms: null, load: () => import('./pages/home.js') },
  { path: 'dashboard', title: () => t('nav.dashboard'), icon: 'chart', group: 'main', perms: ['dashboard.view'], load: () => import('./pages/dashboard.js') },
  { path: 'all-branches', title: () => t('nav.allBranches'), icon: 'building', group: 'main', perms: ['branches.view_all'], load: pick(() => import('./pages/dashboard.js'), 'renderAllBranches') },

  // Selling
  { path: 'pos', title: () => t('nav.pos'), icon: 'cart', group: 'selling', perms: ['pos.view'], load: () => import('./pages/pos.js') },
  { path: 'sales', title: () => t('nav.sales'), icon: 'receipt', group: 'selling', perms: ['sales.view'], load: () => import('./pages/sales.js') },
  { path: 'sale', title: () => t('nav.sale'), group: null, perms: ['sales.view', 'pos.view'], load: pick(() => import('./pages/sales.js'), 'renderDetail') },
  { path: 'customers', title: () => t('nav.customers'), icon: 'users', group: 'selling', perms: ['customers.view'], load: () => import('./pages/customers.js') },
  { path: 'customer', title: () => t('nav.customer'), group: null, perms: ['customers.view'], load: pick(() => import('./pages/customers.js'), 'renderDetail') },
  { path: 'shifts', title: () => t('nav.shifts'), icon: 'wallet', group: 'selling', perms: ['shifts.view'], load: () => import('./pages/shifts.js') },
  { path: 'shift', title: () => t('nav.shift'), group: null, perms: ['shifts.view', 'pos.view'], load: pick(() => import('./pages/shifts.js'), 'renderDetail') },
  { path: 'controlled', title: () => t('nav.controlled'), icon: 'shield', group: 'selling', perms: ['controlled.view'], load: () => import('./pages/controlled.js') },

  // Inventory
  { path: 'products', title: () => t('nav.products'), icon: 'pill', group: 'inventory', perms: ['products.view'], load: () => import('./pages/products.js') },
  { path: 'product', title: () => t('nav.product'), group: null, perms: ['products.view'], load: () => import('./pages/product.js') },
  { path: 'batches', title: () => t('nav.batches'), icon: 'layers', group: 'inventory', perms: ['batches.view', 'stock.view'], load: () => import('./pages/batches.js') },
  { path: 'movements', title: () => t('nav.movements'), icon: 'history', group: 'inventory', perms: ['stock.view'], load: () => import('./pages/movements.js') },
  { path: 'adjustments', title: () => t('nav.adjustments'), icon: 'clipboard', group: 'inventory', perms: ['stock.view'], load: () => import('./pages/adjustments.js') },
  { path: 'adjustment', title: () => t('nav.adjustment'), group: null, perms: ['stock.view'], load: pick(() => import('./pages/adjustments.js'), 'renderDetail') },
  { path: 'stocktake', title: () => t('nav.stocktake'), icon: 'list', group: 'inventory', perms: ['stocktake.view'], load: () => import('./pages/stocktake.js') },
  { path: 'stocktake-count', title: () => t('nav.stocktake'), group: null, perms: ['stocktake.view'], load: pick(() => import('./pages/stocktake.js'), 'renderCount') },
  { path: 'transfers', title: () => t('nav.transfers'), icon: 'switch', group: 'inventory', perms: ['transfers.view'], load: () => import('./pages/transfers.js') },
  { path: 'transfer', title: () => t('nav.transfer'), group: null, perms: ['transfers.view'], load: pick(() => import('./pages/transfers.js'), 'renderDetail') },
  { path: 'reorder', title: () => t('nav.reorder'), icon: 'refresh', group: 'inventory', perms: ['stock.view', 'purchases.view'], load: pick(() => import('./pages/stockreports.js'), 'renderReorder') },
  { path: 'stock-reports', title: () => t('nav.stockReports'), icon: 'chart', group: 'inventory', perms: ['stock.view'], load: pick(() => import('./pages/stockreports.js'), 'renderStockReports') },
  { path: 'labels', title: () => t('nav.labels'), icon: 'printer', group: 'inventory', perms: ['products.view', 'batches.view'], load: () => import('./pages/labels.js') },
  { path: 'lists', title: () => t('nav.lists'), icon: 'columns', group: 'inventory', perms: ['products.create', 'products.edit'], load: () => import('./pages/lists.js') },
  { path: 'import', title: () => t('nav.import'), icon: 'upload', group: 'inventory', perms: ['import.create'], load: () => import('./pages/import.js') },

  // Purchasing
  { path: 'suppliers', title: () => t('nav.suppliers'), icon: 'truck', group: 'purchasing', perms: ['suppliers.view'], load: () => import('./pages/suppliers.js') },
  { path: 'supplier', title: () => t('nav.supplier'), group: null, perms: ['suppliers.view'], load: pick(() => import('./pages/suppliers.js'), 'renderDetail') },
  { path: 'purchase-orders', title: () => t('nav.purchaseOrders'), icon: 'clipboard', group: 'purchasing', perms: ['purchases.view'], load: pick(() => import('./pages/purchases.js'), 'renderPoList') },
  { path: 'po', title: () => t('nav.purchaseOrder'), group: null, perms: ['purchases.view'], load: pick(() => import('./pages/purchases.js'), 'renderPo') },
  { path: 'grns', title: () => t('nav.grns'), icon: 'download', group: 'purchasing', perms: ['purchases.view'], load: pick(() => import('./pages/purchases.js'), 'renderGrnList') },
  { path: 'grn', title: () => t('nav.grn'), group: null, perms: ['purchases.view'], load: pick(() => import('./pages/purchases.js'), 'renderGrn') },
  { path: 'purchase-returns', title: () => t('nav.purchaseReturns'), icon: 'upload', group: 'purchasing', perms: ['purchases.view'], load: pick(() => import('./pages/supplierdocs.js'), 'renderReturns') },
  { path: 'purchase-return', title: () => t('nav.purchaseReturn'), group: null, perms: ['purchases.view'], load: pick(() => import('./pages/supplierdocs.js'), 'renderReturn') },
  { path: 'payments', title: () => t('nav.payments'), icon: 'wallet', group: 'purchasing', perms: ['supplier_payments.view'], load: pick(() => import('./pages/supplierdocs.js'), 'renderPayments') },
  { path: 'payment', title: () => t('nav.payment'), group: null, perms: ['supplier_payments.view'], load: pick(() => import('./pages/supplierdocs.js'), 'renderPayment') },

  // Money and reports
  { path: 'reports', title: () => t('nav.reports'), icon: 'list', group: 'money', perms: ['reports.view'], load: () => import('./pages/reports.js') },
  { path: 'report', title: () => t('nav.report'), group: null, perms: ['reports.view'], load: pick(() => import('./pages/reports.js'), 'renderReport') },
  { path: 'finance', title: () => t('nav.finance'), icon: 'clipboard', group: 'money', perms: ['finance.view'], load: () => import('./pages/finance.js') },
  { path: 'expenses', title: () => t('nav.expenses'), icon: 'wallet', group: 'money', perms: ['expenses.view', 'expenses.create'], load: () => import('./pages/expenses.js') },
  { path: 'petty-cash', title: () => t('nav.pettyCash'), icon: 'box', group: 'money', perms: ['expenses.view'], load: pick(() => import('./pages/expenses.js'), 'renderPetty') },
  { path: 'approvals', title: () => t('nav.approvals'), icon: 'check', group: 'money', perms: ['approvals.view', 'approvals.approve'], load: () => import('./pages/approvals.js') },

  // Administration
  { path: 'branches', title: () => t('nav.branches'), icon: 'building', group: 'admin', perms: ['branches.view'], load: () => import('./pages/branches.js') },
  { path: 'users', title: () => t('nav.users'), icon: 'users', group: 'admin', perms: ['users.view'], load: () => import('./pages/users.js') },
  { path: 'roles', title: () => t('nav.roles'), icon: 'shield', group: 'admin', perms: ['roles.view'], load: () => import('./pages/roles.js') },
  { path: 'devices', title: () => t('nav.devices'), icon: 'monitor', group: 'admin', perms: ['devices.view'], load: () => import('./pages/devices.js') },
  { path: 'settings', title: () => t('nav.settings'), icon: 'settings', group: 'admin', perms: ['settings.view'], load: () => import('./pages/settings.js') },
  { path: 'sync', title: () => t('nav.sync'), icon: 'cloud', group: 'admin', perms: ['sync.view'], load: () => import('./pages/sync.js') },
  { path: 'backups', title: () => t('nav.backups'), icon: 'database', group: 'admin', perms: ['backups.view'], load: () => import('./pages/backups.js') },
  { path: 'printer', title: () => t('nav.printer'), icon: 'printer', group: 'admin', perms: ['pos.view', 'settings.view'], load: () => import('./pages/printer.js') },
  { path: 'audit', title: () => t('nav.audit'), icon: 'history', group: 'admin', perms: ['audit.view'], load: () => import('./pages/audit.js') },
  { path: 'profile', title: () => t('nav.profile'), icon: 'user', group: null, perms: null, load: () => import('./pages/profile.js') },
  { path: 'shortcuts', title: () => t('nav.shortcuts'), icon: 'keyboard', group: null, perms: null, load: () => import('./pages/shortcuts.js') },
  { path: 'help', title: () => t('nav.help'), icon: 'info', group: 'admin', perms: null, load: () => import('./pages/help.js') },
];

export const GROUPS = [
  { key: 'main', title: () => t('nav.groupMain') },
  { key: 'selling', title: () => t('nav.groupSelling') },
  { key: 'inventory', title: () => t('nav.groupInventory') },
  { key: 'purchasing', title: () => t('nav.groupPurchasing') },
  { key: 'money', title: () => t('nav.groupMoney') },
  { key: 'admin', title: () => t('nav.groupAdmin') },
];

export function allowed(route) {
  return !route.perms || canAny(route.perms);
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { path: path || 'home', params };
}

export function navigate(path, params) {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const target = `#/${path}${q ? '?' + q : ''}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export function findRoute(path) {
  return ROUTES.find((r) => r.path === path) || null;
}

// The menu item that should look active for a detail page (product -> products).
export const PARENT = {
  sale: 'sales', customer: 'customers', shift: 'shifts',
  product: 'products', adjustment: 'adjustments', 'stocktake-count': 'stocktake', transfer: 'transfers', supplier: 'suppliers',
  po: 'purchase-orders', grn: 'grns', 'purchase-return': 'purchase-returns', payment: 'payments', report: 'reports',
};

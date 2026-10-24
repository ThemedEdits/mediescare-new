'use strict';
// Organisation-wide settings with optional per-branch overrides.
const { newId, nowIso } = require('../core/ids');
const audit = require('../core/audit');
const { fail, invalid } = require('../core/errors');

// type: 'text' | 'int' | 'bool' | 'choice' | 'intList'. branch: true when a branch may override the global value.
const DEFINITIONS = {
  'currency.symbol': { type: 'text', default: 'Rs', max: 6, label: 'Currency symbol', group: 'Money' },
  'currency.decimals': { type: 'choice', default: 2, choices: [0, 1, 2], label: 'Decimals shown on screen and receipts', group: 'Money' },
  'date.format': { type: 'choice', default: 'DD/MM/YYYY', choices: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'], label: 'Date format', group: 'Money' },
  'tax.inclusive': { type: 'bool', default: true, label: 'Prices include tax', group: 'Tax', readOnly: true },
  'tax.label': { type: 'text', default: 'Sales tax', max: 30, label: 'Tax name on receipts', group: 'Tax' },
  'expiry.nearDays': { type: 'intList', default: [30, 60, 90], min: 1, max: 730, label: 'Near-expiry warning periods (days)', group: 'Stock', branch: true },
  'pos.requireShift': { type: 'bool', default: true, label: 'A cashier must open a shift before selling', group: 'Counter', branch: true },
  'pos.maxDiscountPercent': { type: 'int', default: 10, min: 0, max: 100, label: 'Highest discount (%) a cashier may give without a manager', group: 'Counter', branch: true },
  'pos.returnApprovalValue': { type: 'int', default: 5000, min: 0, max: 100000000, label: 'Returns worth more than this (Rs) need a manager (0 = never)', group: 'Counter', branch: true },
  'receipt.paper': { type: 'choice', default: '80', choices: ['58', '80', 'A4'], label: 'Receipt paper', group: 'Receipt', branch: true },
  'receipt.showBatch': { type: 'bool', default: true, label: 'Show batch and expiry on receipts', group: 'Receipt', branch: true },
  'receipt.autoPrint': { type: 'bool', default: true, label: 'Print the receipt when a sale is finished', group: 'Receipt', branch: true },
  'stock.adjustApprovalValue': { type: 'int', default: 5000, min: 0, max: 100000000, label: 'Stock adjustments worth more than this (Rs) need a manager to approve', group: 'Stock', branch: true },
  'transfers.requireApproval': { type: 'bool', default: true, label: 'Transfer requests need approval before dispatch', group: 'Stock' },
  'expenses.approvalValue': { type: 'int', default: 10000, min: 0, max: 100000000, label: 'Expenses worth more than this (Rs) need a manager to approve (0 = never)', group: 'Money', branch: true },
  'customers.creditDays': { type: 'int', default: 30, min: 1, max: 365, label: 'Customer bills on account are overdue after this many days', group: 'Counter', branch: true },
  'approvals.validMinutes': { type: 'int', default: 30, min: 5, max: 1440, label: 'Minutes an approved counter request stays usable', group: 'Counter', branch: true },
  'security.minPasswordLength': { type: 'int', default: 6, min: 6, max: 64, label: 'Minimum password length', group: 'Security' },
  'security.lockoutAttempts': { type: 'int', default: 5, min: 3, max: 20, label: 'Wrong passwords before the account locks', group: 'Security' },
  'security.lockoutMinutes': { type: 'int', default: 15, min: 1, max: 1440, label: 'Minutes an account stays locked', group: 'Security' },
  'security.autoLogoutMinutes': { type: 'int', default: 30, min: 0, max: 720, label: 'Sign out after this many idle minutes (0 = never)', group: 'Security', branch: true },
  'receipt.footer': { type: 'text', default: 'Thank you for your visit. Medicines once sold are returnable within 7 days with the receipt.', max: 300, label: 'Receipt footer message', group: 'Receipt', branch: true },
};

function coerce(key, value) {
  const def = DEFINITIONS[key];
  if (!def) invalid(key, 'error.unknownAction');
  const label = def.label;
  switch (def.type) {
    case 'text': {
      const v = value === null || value === undefined ? '' : String(value).trim();
      if (v.length > def.max) invalid(key, 'error.tooLong', { field: label, max: def.max });
      return v;
    }
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < def.min || n > def.max) invalid(key, 'error.invalid', { field: label });
      return n;
    }
    case 'bool':
      return value === true || value === 'true' || value === 1;
    case 'choice': {
      const match = def.choices.find((c) => String(c) === String(value));
      if (match === undefined) invalid(key, 'error.invalid', { field: label });
      return match;
    }
    case 'intList': {
      const list = (Array.isArray(value) ? value : String(value).split(',')).map((x) => Number(String(x).trim())).filter((x) => String(x) !== '');
      if (!list.length || list.some((n) => !Number.isInteger(n) || n < def.min || n > def.max)) invalid(key, 'error.invalid', { field: label });
      return [...new Set(list)].sort((a, b) => a - b);
    }
    default:
      return value;
  }
}

function readAll(db, branchId) {
  const rows = db.prepare("SELECT scope, key, value FROM settings WHERE scope = 'global' OR scope = ?").all(branchId || '');
  const values = {};
  const overridden = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) values[key] = def.default;
  for (const r of rows.filter((x) => x.scope === 'global')) if (DEFINITIONS[r.key]) values[r.key] = JSON.parse(r.value);
  for (const r of rows.filter((x) => x.scope !== 'global')) {
    if (DEFINITIONS[r.key] && DEFINITIONS[r.key].branch) {
      values[r.key] = JSON.parse(r.value);
      overridden[r.key] = true;
    }
  }
  return { values, overridden };
}

function get(db, key, branchId) {
  return readAll(db, branchId).values[key];
}

function writeValue(db, actor, scope, key, value) {
  const branchId = scope === 'global' ? null : scope;
  const existing = db.prepare('SELECT * FROM settings WHERE scope = ? AND key = ?').get(scope, key);
  const json = JSON.stringify(value);
  if (existing && existing.value === json) return false;
  const now = nowIso();
  if (existing) {
    db.prepare('UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(json, actor.userId || null, now, existing.id);
  } else {
    db.prepare('INSERT INTO settings (id, scope, key, value, branch_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), scope, key, json, branchId, actor.userId || null, now);
  }
  audit.write(db, actor, {
    module: 'settings', action: 'update', recordType: 'setting', recordId: `${scope}:${key}`, branchId,
    summary: `${DEFINITIONS[key].label} changed${branchId ? ' for this branch' : ''}`,
    old: { value: existing ? JSON.parse(existing.value) : DEFINITIONS[key].default }, new: { value },
  });
  return true;
}

function register(define) {
  define('settings.get', { perm: 'settings.view' }, (ctx) => {
    const { values, overridden } = readAll(ctx.db, ctx.branchId);
    const org = ctx.db.prepare('SELECT name, code FROM org LIMIT 1').get();
    return {
      values, overridden, org,
      definitions: Object.entries(DEFINITIONS).map(([key, d]) => ({ key, ...d })),
      canEditGlobal: ctx.can('settings.edit') && ctx.can('branches.view_all'),
      canEditBranch: ctx.can('settings.edit'),
    };
  });

  // params: { scope: 'global' | 'branch', values: { key: value }, orgName?, clear?: [keys] }
  define('settings.update', { perm: 'settings.edit' }, (ctx, params) => {
    const scope = params && params.scope === 'branch' ? ctx.branchId : 'global';
    if (scope === 'global' && !ctx.can('branches.view_all')) fail('FORBIDDEN', 'error.noPermission');
    const values = (params && params.values) || {};
    const clear = (params && params.clear) || [];
    const prepared = {};
    for (const [key, raw] of Object.entries(values)) {
      const def = DEFINITIONS[key];
      if (!def || def.readOnly) fail('FORBIDDEN', 'error.readOnly');
      if (scope !== 'global' && !def.branch) fail('FORBIDDEN', 'error.readOnly');
      prepared[key] = coerce(key, raw);
    }
    let orgName = null;
    if (params && params.orgName !== undefined) {
      if (scope !== 'global') fail('FORBIDDEN', 'error.readOnly');
      orgName = String(params.orgName || '').trim();
      if (!orgName) invalid('orgName', 'error.required', { field: 'Organisation name' });
      if (orgName.length > 120) invalid('orgName', 'error.tooLong', { field: 'Organisation name', max: 120 });
    }
    let changed = 0;
    ctx.db.transaction(() => {
      for (const [key, value] of Object.entries(prepared)) if (writeValue(ctx.db, ctx.actor, scope, key, value)) changed++;
      if (scope !== 'global') {
        for (const key of clear) {
          const row = ctx.db.prepare('SELECT * FROM settings WHERE scope = ? AND key = ?').get(scope, key);
          if (!row) continue;
          // Back to the organisation value: store the global value so the change syncs as an edit, not a delete.
          const globalValue = get(ctx.db, key, null);
          ctx.db.prepare('UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(globalValue), ctx.userId, nowIso(), row.id);
          audit.write(ctx.db, ctx.actor, { module: 'settings', action: 'update', recordType: 'setting', recordId: `${scope}:${key}`, summary: `${DEFINITIONS[key].label} set back to the organisation value`, old: { value: JSON.parse(row.value) }, new: { value: globalValue } });
          changed++;
        }
      }
      if (orgName) {
        const org = ctx.db.prepare('SELECT * FROM org LIMIT 1').get();
        if (org.name !== orgName) {
          ctx.db.prepare('UPDATE org SET name = ?, updated_at = ? WHERE id = ?').run(orgName, nowIso(), org.id);
          audit.write(ctx.db, ctx.actor, { module: 'settings', action: 'update', recordType: 'org', recordId: org.id, branchId: null, summary: 'Organisation name changed', old: { name: org.name }, new: { name: orgName } });
          changed++;
        }
      }
    })();
    return { changed };
  });
}

// Settings everyone may read (needed to format money and dates), returned with app state.
function publicSettings(db, branchId) {
  const { values } = readAll(db, branchId);
  return {
    currencySymbol: values['currency.symbol'],
    currencyDecimals: values['currency.decimals'],
    dateFormat: values['date.format'],
    autoLogoutMinutes: values['security.autoLogoutMinutes'],
    minPasswordLength: values['security.minPasswordLength'],
    nearExpiryDays: values['expiry.nearDays'],
  };
}

module.exports = { DEFINITIONS, readAll, get, register, publicSettings };

'use strict';
// Every keyboard shortcut of the app, with its default key. People can rebind them (Profile -> Keyboard shortcuts);
// what they change is stored in users.prefs.shortcuts as { action: key }. A key is written like "Ctrl+Shift+K", "Alt+P",
// "F2" or "Delete". The counter page also listens to the global shortcuts, so every key must be unique overall.

const ACTIONS = [
  { id: 'global.search', scope: 'global', label: 'Search everything', default: 'Ctrl+K' },
  { id: 'global.notifications', scope: 'global', label: 'Open notifications', default: 'Alt+N' },
  { id: 'global.shortcuts', scope: 'global', label: 'Show keyboard shortcuts', default: 'Ctrl+/' },
  { id: 'global.signOut', scope: 'global', label: 'Sign out', default: 'Ctrl+Shift+L' },
  { id: 'go.home', scope: 'global', label: 'Go to Home', default: 'Alt+H' },
  { id: 'go.dashboard', scope: 'global', label: 'Go to Dashboard', default: 'Alt+D' },
  { id: 'go.pos', scope: 'global', label: 'Go to the counter (POS)', default: 'Alt+P' },
  { id: 'go.sales', scope: 'global', label: 'Go to Sales history', default: 'Alt+S' },
  { id: 'go.products', scope: 'global', label: 'Go to Medicines', default: 'Alt+M' },
  { id: 'go.customers', scope: 'global', label: 'Go to Customers', default: 'Alt+C' },
  { id: 'go.reports', scope: 'global', label: 'Go to Reports', default: 'Alt+R' },
  { id: 'go.expenses', scope: 'global', label: 'Go to Expenses', default: 'Alt+E' },
  { id: 'go.approvals', scope: 'global', label: 'Go to Approvals', default: 'Alt+A' },
  { id: 'go.finance', scope: 'global', label: 'Go to Financial journal', default: 'Alt+J' },
  { id: 'pos.search', scope: 'pos', label: 'Counter: find a medicine', default: 'F2' },
  { id: 'pos.customer', scope: 'pos', label: 'Counter: choose the customer', default: 'F3' },
  { id: 'pos.qty', scope: 'pos', label: 'Counter: change the quantity', default: 'F4' },
  { id: 'pos.discount', scope: 'pos', label: 'Counter: bill discount', default: 'F6' },
  { id: 'pos.hold', scope: 'pos', label: 'Counter: put the bill on hold', default: 'F8' },
  { id: 'pos.holds', scope: 'pos', label: 'Counter: bills on hold', default: 'F9' },
  { id: 'pos.pay', scope: 'pos', label: 'Counter: take payment', default: 'F10' },
  { id: 'pos.remove', scope: 'pos', label: 'Counter: remove the selected line', default: 'Delete' },
  { id: 'pos.newBill', scope: 'pos', label: 'Counter: new bill', default: 'Ctrl+N' },
  { id: 'pos.reprint', scope: 'pos', label: 'Counter: reprint the last receipt', default: 'Ctrl+P' },
];

const NAMED = ['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
const KEY_RE = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(.+)$/;

// True when the key is something a person can press as a shortcut without breaking typing.
function validKey(combo) {
  const m = KEY_RE.exec(String(combo || ''));
  if (!m) return false;
  const [, ctrl, alt, shift, key] = m;
  const named = NAMED.includes(key);
  const single = key.length === 1 && key !== '+' && /[\x21-\x7e]/.test(key);
  if (!named && !single) return false;
  // A plain letter or digit would stop people typing; it needs Ctrl or Alt.
  if (single && !ctrl && !alt) return false;
  // Shift is only written for letters and named keys (for symbols the symbol already shows it).
  if (shift && single && !/^[A-Z]$/.test(key)) return false;
  if (single && /[a-z]/.test(key)) return false;
  return true;
}

function effective(overrides) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = (overrides && overrides[a.id]) || a.default;
  return out;
}

// Pairs of actions that share a key.
function conflicts(bindings) {
  const byKey = new Map();
  for (const a of ACTIONS) {
    const k = bindings[a.id];
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(a.id);
  }
  return [...byKey.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, actions: ids }));
}

module.exports = { ACTIONS, validKey, effective, conflicts };

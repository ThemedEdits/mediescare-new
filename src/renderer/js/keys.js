// Keyboard shortcuts on screen. The list of actions and each person's keys come from the main process
// (shortcuts.get); this module turns a key press into an action name.
import { call } from './api.js';

let catalog = [];
let bindings = {};

export async function loadShortcuts() {
  try {
    const res = await call('shortcuts.get', {});
    catalog = res.actions;
    bindings = res.bindings;
  } catch (_) {
    catalog = [];
    bindings = {};
  }
  return { catalog, bindings };
}

export function setBindings(next) {
  bindings = { ...next };
}

export function actions() {
  return catalog;
}

// "Ctrl+Shift+K", "Alt+P", "F2", "Delete". Shift is written for letters and named keys only.
export function comboOf(e) {
  const k = e.key;
  if (!k || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(k)) return null;
  const single = k.length === 1;
  const letter = /^[a-z]$/i.test(k);
  const name = single ? k.toUpperCase() : k;
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey && (!single || letter) ? 'Shift+' : ''}${name}`;
}

export function keyFor(actionId) {
  return bindings[actionId] || '';
}

// The action bound to this key press, limited to one scope ('global' or 'pos').
export function actionFor(e, scope) {
  const combo = comboOf(e);
  if (!combo) return null;
  const hit = catalog.find((a) => a.scope === scope && bindings[a.id] === combo);
  return hit ? hit.id : null;
}

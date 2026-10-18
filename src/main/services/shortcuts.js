'use strict';
// Keyboard shortcuts per person. Only changed keys are stored (users.prefs.shortcuts); "reset" removes them.
// Editing someone else's shortcuts needs shortcuts.others (and that person must be in a branch you can reach).
const { nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const audit = require('../core/audit');
const sc = require('../core/shortcuts');
const { assertBranchAccess } = require('./guards');

function target(ctx, params) {
  if (!params.userId || params.userId === ctx.userId) return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.userId);
  if (!ctx.can('shortcuts.others')) fail('FORBIDDEN', 'error.noPermission');
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(String(params.userId));
  if (!u) fail('NOT_FOUND', 'error.notFound', { thing: 'user' });
  assertBranchAccess(ctx, u.branch_id);
  return u;
}

function prefsOf(u) {
  try { return JSON.parse(u.prefs || '{}'); } catch (_) { return {}; }
}

function payload(u) {
  const overrides = prefsOf(u).shortcuts || {};
  const bindings = sc.effective(overrides);
  return { userId: u.id, userName: u.full_name, actions: sc.ACTIONS, overrides, bindings, conflicts: sc.conflicts(bindings) };
}

function save(ctx, params) {
  const u = target(ctx, params);
  const incoming = params.bindings && typeof params.bindings === 'object' ? params.bindings : {};
  const overrides = {};
  for (const a of sc.ACTIONS) {
    const k = incoming[a.id];
    if (k === undefined || k === null || k === '' || k === a.default) continue;
    if (!sc.validKey(k)) invalid(`bindings.${a.id}`, 'shortcuts.badKey', { action: a.label, key: String(k) });
    overrides[a.id] = String(k);
  }
  const clash = sc.conflicts(sc.effective(overrides));
  if (clash.length) {
    const label = (id) => sc.ACTIONS.find((a) => a.id === id).label;
    fail('VALIDATION', 'shortcuts.conflict', { key: clash[0].key, first: label(clash[0].actions[0]), second: label(clash[0].actions[1]) }, { conflicts: clash });
  }
  const prefs = prefsOf(u);
  const before = prefs.shortcuts || {};
  if (Object.keys(overrides).length) prefs.shortcuts = overrides; else delete prefs.shortcuts;
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(prefs), nowIso(), u.id);
    const d = audit.diff(before, overrides);
    if (d.changed) audit.write(ctx.db, ctx.actor, { module: 'users', action: 'shortcuts', recordType: 'user', recordId: u.id, summary: `Keyboard shortcuts of ${u.full_name} changed`, old: d.old, new: d.new });
  })();
  return payload(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
}

function register(define) {
  define('shortcuts.get', { allowMustChange: true }, (ctx, params) => payload(target(ctx, params)));
  define('shortcuts.save', {}, save);
  define('shortcuts.reset', {}, (ctx, params) => save(ctx, { userId: params.userId, bindings: {} }));
}

module.exports = { register };

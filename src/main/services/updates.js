'use strict';
// Software version and automatic updates (see updater.js). Anyone signed in sees the state; managing needs settings.edit.
function status(ctx) {
  const u = ctx.app.updater;
  return u ? u.status() : { state: 'not_set_up', version: ctx.app.version || 'development', available: null, progress: null, error: null, checkedAt: null };
}

// The guides in docs/ (shipped with the app), shown on the Help page.
const GUIDES = { admin: 'admin-guide.md', cashier: 'cashier-quick-start.md', user: 'USER-MANUAL.md', system: 'SYSTEM-MANUAL.md', migration: 'legacy-migration.md' };

function guide(ctx, params) {
  const fs = require('fs');
  const path = require('path');
  const file = GUIDES[params.name];
  if (!file) return { text: '' };
  return { text: fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', file), 'utf8') };
}

function register(define) {
  define('help.guide', { allowMustChange: true }, guide);
  define('update.status', {}, status);
  define('update.check', { perm: 'settings.edit' }, async (ctx) => (ctx.app.updater ? ctx.app.updater.check() : status(ctx)));
  define('update.install', { perm: 'settings.edit' }, async (ctx) => {
    const audit = require('../core/audit');
    const ok = ctx.app.updater ? await ctx.app.updater.install() : false;
    if (ok) ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'settings', action: 'update', summary: `Restarted to install version ${ctx.app.updater.status().available}` }))();
    return { started: ok, status: status(ctx) };
  });
}

module.exports = { register };

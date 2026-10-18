'use strict';
// Sync and backup screens: status for the top bar, Sync now, the full sync log, merge conflicts, pairing codes for
// new counter computers, finding the main computer, and backups (list, make, restore, settings).
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const backup = require('../backup');
const { discover } = require('../sync/lan-server');
const { paging } = require('../core/docs');

function engine(ctx) {
  return ctx.app.sync || null;
}

function backupSummary(app) {
  const last = app.db.prepare("SELECT at, status, message, kind FROM backups ORDER BY id DESC LIMIT 1").get() || null;
  const lastOk = app.db.prepare("SELECT at FROM backups WHERE status = 'ok' ORDER BY id DESC LIMIT 1").get();
  const s = backup.settings(app);
  return { lastAt: lastOk ? lastOk.at : null, lastStatus: last ? last.status : null, lastMessage: last ? last.message : null, external: s.external || null, encrypt: !!s.encrypt,
    stale: !lastOk || Date.now() - Date.parse(lastOk.at) > 2 * 24 * 3600 * 1000 };
}

function status(ctx) {
  const e = engine(ctx);
  const st = e ? e.status() : { role: ctx.app.device.kind, lan: { configured: false, state: 'not_set_up' }, cloud: { configured: false, state: 'not_set_up' }, clockWarning: false };
  const last = ctx.db.prepare('SELECT at, channel, status, message FROM sync_log ORDER BY id DESC LIMIT 1').get() || null;
  const conflicts = ctx.db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts WHERE resolved = 0').get().n;
  return { ...st, last, conflicts, backup: backupSummary(ctx.app) };
}

function register(define) {
  define('sync.status', {}, status);

  define('sync.now', { perm: 'sync.manual' }, async (ctx) => {
    const e = engine(ctx);
    if (!e) fail('SYNC_NOT_AVAILABLE', 'setup.joinNeedsSync');
    const results = {};
    for (const ch of ['lan', 'cloud']) {
      if ((ch === 'lan' && e.lanPeer()) || (ch === 'cloud' && e.cloudPeer())) results[ch] = await e.run(ch);
    }
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'sync', action: 'sync_now', summary: 'Sync started by hand' }))();
    return { results, status: status(ctx) };
  });

  define('sync.log', { perm: 'sync.view' }, (ctx, params) => {
    const where = [];
    const args = {};
    if (params.channel) { where.push('channel = @channel'); args.channel = params.channel; }
    if (params.status) { where.push('status = @status'); args.status = params.status; }
    const pg = paging(params, { def: 100 });
    const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM sync_log ${sql}`).get(args).n;
    const rows = ctx.db.prepare(`SELECT * FROM sync_log ${sql} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.limit, offset: pg.offset });
    return { rows, total, page: pg.page, pageSize: pg.pageSize };
  });

  define('sync.conflicts', { perm: 'sync.view' }, (ctx, params) => ctx.db.prepare(`SELECT * FROM sync_conflicts ${params.all ? '' : 'WHERE resolved = 0'} ORDER BY id DESC LIMIT 500`).all()
    .map((c) => ({ id: c.id, at: c.at, kind: c.kind, tbl: c.tbl, rowId: c.row_id, field: c.field, oldValue: c.old_value, newValue: c.new_value, note: c.note, resolved: c.resolved === 1 })));

  define('sync.resolveConflict', { perm: 'sync.manual' }, (ctx, params) => {
    const id = v.int(params, 'id', 'Conflict', { required: true, min: 1 });
    ctx.db.prepare('UPDATE sync_conflicts SET resolved = 1 WHERE id = ?').run(id);
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'sync', action: 'resolve_conflict', recordId: String(id), summary: 'Sync conflict marked as dealt with', reason: v.text(params, 'note', 'Note', { max: 300 }) }))();
    return { resolved: true };
  });

  // On the main computer: a 6-digit code to pair a new counter computer (valid 10 minutes).
  define('lan.pairingCode', { perm: 'devices.edit' }, (ctx) => {
    const e = engine(ctx);
    if (!e || !e.server) fail('SYNC_NOT_AVAILABLE', 'sync.lanOff');
    const code = e.server.newPairingCode(ctx.userId);
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'pairing_code', summary: 'Pairing code made for a new computer' }))();
    return { ...code, port: e.server.port, addresses: ctx.app.lanAddresses ? ctx.app.lanAddresses() : [] };
  });

  // Finds main computers on the shop network (used on the first-run screen, before sign-in).
  define('lan.discover', { auth: 'none', allowBeforeSetup: true }, async () => discover({ waitMs: 1500 }));

  // On a counter computer: the main computer moved to a new address.
  define('lan.setPrimary', { perm: 'devices.edit' }, (ctx, params) => {
    const url = v.text(params, 'url', 'Main computer address', { required: true, max: 200 });
    if (!/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(url)) fail('VALIDATION', 'error.invalid', { field: 'Main computer address' });
    const before = ctx.app.localGet('primary_url');
    ctx.app.localSet('primary_url', url.replace(/\/+$/, ''));
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'sync', action: 'primary_address', summary: 'Address of the main computer changed', old: { url: before }, new: { url } }))();
    return status(ctx);
  });

  define('cloud.connect', { perm: 'branches.view_all' }, async (ctx) => {
    const e = engine(ctx);
    if (!e || !e.cloudUrl) fail('SYNC_NOT_AVAILABLE', 'sync.cloudNotBuilt');
    if (!ctx.app.device.is_head_office || ctx.app.device.kind !== 'primary') fail('FORBIDDEN', 'sync.onlyHeadOffice');
    try { await e.registerOrg(); } catch (err) { fail('CLOUD', 'sync.cloudFailed', { reason: err.message }); }
    await e.run('cloud');
    return status(ctx);
  });

  // ---- backups ----
  define('backups.list', { perm: 'backups.view' }, (ctx) => ({ backups: backup.list(ctx.app), settings: backup.settings(ctx.app), summary: backupSummary(ctx.app), canEncrypt: ctx.app.canEncrypt() }));

  define('backups.create', { perm: 'backups.create' }, async (ctx) => {
    const res = await backup.create(ctx.app, 'manual');
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'backups', action: 'create', summary: `Backup made${res.copiedTo ? ' and copied to ' + res.copiedTo : ''}` }))();
    return res;
  });

  define('backups.settings', { perm: 'backups.create' }, async (ctx, params) => {
    const s = backup.settings(ctx.app);
    if (params.chooseFolder) {
      const folder = await ctx.app.chooseFolder();
      if (!folder) return s;
      s.external = folder;
    }
    if (params.clearFolder) s.external = '';
    if (params.encrypt !== undefined) {
      const on = v.bool(params, 'encrypt');
      if (on && !ctx.app.canEncrypt()) fail('VALIDATION', 'backup.noEncryption');
      s.encrypt = on;
    }
    backup.saveSettings(ctx.app, s);
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'backups', action: 'settings', summary: 'Backup settings changed', new: s }))();
    return s;
  });

  // Restore from a listed backup or a file the user picks (for example on a USB drive). The app restarts afterwards.
  define('backups.restore', { perm: 'backups.restore' }, async (ctx, params) => {
    let file = null;
    if (params.id) {
      const row = ctx.db.prepare("SELECT file FROM backups WHERE id = ? AND status = 'ok'").get(Number(params.id));
      if (!row) fail('NOT_FOUND', 'backup.missing');
      file = row.file;
    } else {
      file = await ctx.app.chooseFile();
      if (!file) return { restored: false };
    }
    const actor = { ...ctx.actor };
    const db = ctx.db;
    db.transaction(() => audit.write(db, actor, { module: 'backups', action: 'restore', summary: `Restoring backup ${require('path').basename(file)}` }))();
    const res = await backup.restore(ctx.app, file);
    ctx.app.db.transaction(() => audit.write(ctx.app.db, actor, { module: 'backups', action: 'restored', summary: `Backup restored; safety copy kept at ${res.safetyCopy}` }))();
    if (ctx.app.afterRestore) setTimeout(() => ctx.app.afterRestore(), 300);
    return { ...res, restart: true };
  });
}

module.exports = { register, status };

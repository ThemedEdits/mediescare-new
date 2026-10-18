'use strict';
// Settings that belong to this computer only (not synced): receipt printer, silent printing, paper size,
// customer display. Also the bridge to the optional customer-facing display window.
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');

const DEFAULTS = { printerName: '', silentPrint: false, paper: '', customerDisplay: false };

function read(app) {
  try { return { ...DEFAULTS, ...JSON.parse(app.localGet('device_settings') || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}

function register(define) {
  define('device.settings', { perm: ['pos.view', 'settings.view'] }, async (ctx) => {
    let printers = [];
    try { printers = await ctx.app.listPrinters(); } catch (_) { printers = []; }
    return { ...read(ctx.app), printers, canEdit: ctx.can('settings.edit') || ctx.can('shifts.approve') };
  });

  define('device.saveSettings', { perm: ['settings.edit', 'shifts.approve'] }, (ctx, params) => {
    const before = read(ctx.app);
    const next = {
      printerName: v.text(params, 'printerName', 'Receipt printer', { max: 200 }) || '',
      silentPrint: v.bool(params, 'silentPrint'),
      paper: v.oneOf(params, 'paper', 'Paper', ['', '58', '80', 'A4'], { required: false, fallback: '' }),
      customerDisplay: v.bool(params, 'customerDisplay'),
    };
    if (next.silentPrint && !next.printerName) fail('VALIDATION', 'device.silentNeedsPrinter');
    ctx.app.localSet('device_settings', JSON.stringify(next));
    const change = audit.diff(before, next);
    if (change.changed) ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'printer_settings', recordType: 'device', recordId: ctx.app.device.id, summary: 'Printer settings of this computer changed', old: change.old, new: change.new }))();
    return read(ctx.app);
  });

  // The customer display shows the running bill. The counter sends small updates; nothing is stored.
  define('display.update', { perm: 'pos.view' }, (ctx, params) => {
    if (!read(ctx.app).customerDisplay) return { shown: false };
    const lines = (Array.isArray(params.lines) ? params.lines : []).slice(-12).map((l) => ({ name: String(l.name || '').slice(0, 60), qty: String(l.qty || '').slice(0, 30), amount: Number(l.amount) || 0 }));
    ctx.app.showDisplay({ lines, total: Number(params.total) || 0, change: Number(params.change) || 0, message: String(params.message || '').slice(0, 120), org: ctx.db.prepare('SELECT name FROM org LIMIT 1').get().name });
    return { shown: true };
  });
}

module.exports = { register, read };

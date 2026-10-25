'use strict';
// Settings that belong to this computer only (not synced): receipt printer, silent printing, paper size,
// customer display. Also the bridge to the optional customer-facing display window.
const { fail } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const receipt = require('../core/receipt');

const DEFAULTS = {
  printerName: '',
  silentPrint: false,
  paper: '80',
  customerDisplay: false,
  showLogo: true,
  logoPlacement: 'center',
  logoSize: 'medium',
  headerText: '',
  headerAlignment: 'center',
  headerSize: 'normal',
  showBranchAddress: true,
  showBranchPhone: true,
  showBranchLicence: true,
  showBranchNtn: true,
  showBatchExpiry: true,
  showItemDiscount: true,
  showBarcode: true,
  footerText: 'Thank you for your visit. Medicines once sold are returnable within 7 days with the receipt.',
  footerAlignment: 'center',
  footerSize: 'normal',
  copies: 1,
  openDrawer: false,
};

function read(app) {
  try { return { ...DEFAULTS, ...JSON.parse(app.localGet('device_settings') || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}

function makeSampleSale() {
  return {
    docNo: 'REC-DEMO-001',
    soldAt: new Date().toISOString(),
    cashierName: 'Counter 1',
    customerName: 'Walk-in Customer',
    gross: 95000,
    discount: 5000,
    total: 90000,
    tax: 0,
    paid: 90000,
    tendered: 100000,
    change: 10000,
    credit: 0,
    returnedTotal: 0,
    status: 'completed',
    lines: [
      { lineNo: 1, productLabel: 'Augmentin 625mg Tablets', qtyText: '1 Box', unitPrice: 45000, unitName: 'Box', discount: 2500, net: 42500, batchNo: 'AG-9821', expiryDate: '2028-10-31' },
      { lineNo: 2, productLabel: 'Panadol Extra 500mg', qtyText: '2 Strips', unitPrice: 25000, unitName: 'Strip', discount: 2500, net: 47500, batchNo: 'PN-4412', expiryDate: '2029-05-31' },
    ],
    payments: [{ kind: 'sale', method: 'cash', amount: 90000, reference: '' }],
  };
}

function sampleHtml(ctx, params) {
  let branch = ctx.app.device ? ctx.db.prepare('SELECT * FROM branches WHERE id = ?').get(ctx.app.device.branch_id) : null;
  if (!branch) branch = ctx.db.prepare('SELECT * FROM branches LIMIT 1').get() || { name: 'Mediescare Branch', address: 'Plot 12, Commercial Area', phone: '042-35889900', licence_no: 'DL-LHR-2026-99', ntn: '1234567-8' };
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get() || { name: 'Mediescare Pharmacy' };
  return receipt.render({
    org,
    branch,
    sale: makeSampleSale(),
    format: params.paper || '80',
    showLogo: params.showLogo !== false,
    logoPlacement: params.logoPlacement || 'center',
    logoSize: params.logoSize || 'medium',
    headerText: params.headerText || '',
    headerAlignment: params.headerAlignment || 'center',
    headerSize: params.headerSize || 'normal',
    showBranchAddress: params.showBranchAddress !== false,
    showBranchPhone: params.showBranchPhone !== false,
    showBranchLicence: params.showBranchLicence !== false,
    showBranchNtn: params.showBranchNtn !== false,
    showBatch: params.showBatchExpiry !== false,
    showDiscount: params.showItemDiscount !== false,
    showBarcode: params.showBarcode !== false,
    footer: params.footerText !== undefined ? params.footerText : DEFAULTS.footerText,
    footerAlignment: params.footerAlignment || 'center',
    footerSize: params.footerSize || 'normal',
    copies: params.copies || 1,
    currency: { symbol: 'Rs', decimals: 2 },
    dateFormat: 'DD/MM/YYYY',
  });
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
      paper: v.oneOf(params, 'paper', 'Paper', ['', '52', '58', '80', 'A4'], { required: false, fallback: '80' }),
      customerDisplay: v.bool(params, 'customerDisplay'),
      showLogo: params.showLogo === undefined ? before.showLogo : v.bool(params, 'showLogo'),
      logoPlacement: v.oneOf(params, 'logoPlacement', 'Logo placement', ['center', 'left', 'right'], { required: false, fallback: 'center' }),
      logoSize: v.oneOf(params, 'logoSize', 'Logo size', ['small', 'medium', 'large', 'xlarge'], { required: false, fallback: 'medium' }),
      headerText: v.text(params, 'headerText', 'Header note', { max: 1000 }) || '',
      headerAlignment: v.oneOf(params, 'headerAlignment', 'Header alignment', ['center', 'left', 'right'], { required: false, fallback: 'center' }),
      headerSize: v.oneOf(params, 'headerSize', 'Header size', ['small', 'normal', 'large'], { required: false, fallback: 'normal' }),
      showBranchAddress: params.showBranchAddress === undefined ? before.showBranchAddress : v.bool(params, 'showBranchAddress'),
      showBranchPhone: params.showBranchPhone === undefined ? before.showBranchPhone : v.bool(params, 'showBranchPhone'),
      showBranchLicence: params.showBranchLicence === undefined ? before.showBranchLicence : v.bool(params, 'showBranchLicence'),
      showBranchNtn: params.showBranchNtn === undefined ? before.showBranchNtn : v.bool(params, 'showBranchNtn'),
      showBatchExpiry: params.showBatchExpiry === undefined ? before.showBatchExpiry : v.bool(params, 'showBatchExpiry'),
      showItemDiscount: params.showItemDiscount === undefined ? before.showItemDiscount : v.bool(params, 'showItemDiscount'),
      showBarcode: params.showBarcode === undefined ? before.showBarcode : v.bool(params, 'showBarcode'),
      footerText: v.text(params, 'footerText', 'Footer message', { max: 1000 }) || '',
      footerAlignment: v.oneOf(params, 'footerAlignment', 'Footer alignment', ['center', 'left', 'right'], { required: false, fallback: 'center' }),
      footerSize: v.oneOf(params, 'footerSize', 'Footer size', ['small', 'normal', 'large'], { required: false, fallback: 'normal' }),
      copies: v.int(params, 'copies', 'Number of copies', { min: 1, max: 2, fallback: 1 }),
      openDrawer: v.bool(params, 'openDrawer'),
    };
    if (next.silentPrint && !next.printerName) fail('VALIDATION', 'device.silentNeedsPrinter');
    ctx.app.localSet('device_settings', JSON.stringify(next));
    const change = audit.diff(before, next);
    if (change.changed) ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module: 'devices', action: 'printer_settings', recordType: 'device', recordId: ctx.app.device.id, summary: 'Printer settings of this computer changed', old: change.old, new: change.new }))();
    return read(ctx.app);
  });

  define('device.sampleReceipt', { perm: ['pos.view', 'settings.view'] }, (ctx, params) => {
    return { html: sampleHtml(ctx, params || read(ctx.app)) };
  });

  define('device.testPrint', { perm: ['settings.edit', 'shifts.approve', 'pos.view'] }, async (ctx, params) => {
    const settingsToUse = { ...read(ctx.app), ...(params || {}) };
    const html = sampleHtml(ctx, settingsToUse);
    const result = await ctx.app.printHtml(html, {
      title: 'Mediescare Test Receipt',
      silent: !!settingsToUse.silentPrint,
      deviceName: settingsToUse.printerName || undefined,
    });
    return { ok: true, printed: result.printed, reason: result.reason };
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

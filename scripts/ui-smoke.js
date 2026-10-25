'use strict';
// Headless UI test: starts the real app in a hidden window with a temporary data folder, drives the screens
// like a user would, checks the numbers shown against the database, and fails on any console warning or error.
// Run: npm run test:ui   (screenshots go to UI_SHOTS or a temp folder)
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediescare-ui-'));
const shotsDir = process.env.UI_SHOTS || path.join(dataDir, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });
process.env.MEDIESCARE_DATA_DIR = dataDir;
process.env.MEDIESCARE_HIDDEN = '1';
process.env.MEDIESCARE_LAN_PORT = '47891'; // not the normal port, so a running copy of the app is not disturbed
delete process.env.ELECTRON_RUN_AS_NODE;

const { app } = require('electron');
const main = require('../src/main/main.js');

const problems = [];
const passed = [];
let wc = null;

const PAGE_HELPERS = `
window.__t = {
  q: (s) => document.querySelector(s),
  qa: (s) => [...document.querySelectorAll(s)],
  text: (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; },
  fieldByLabel(label, scope) {
    const root = scope ? document.querySelector(scope) : document;
    const l = [...root.querySelectorAll('label')].find((x) => x.textContent.replace(/\\s*\\*$/, '').trim() === label);
    return l ? document.getElementById(l.htmlFor) : null;
  },
  fill(label, value, scope) {
    const el = this.fieldByLabel(label, scope);
    if (!el) throw new Error('No field labelled ' + label);
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  pick(label, optionText, scope) {
    const el = this.fieldByLabel(label, scope);
    if (!el) throw new Error('No combobox labelled ' + label);
    el.focus();
    el.value = optionText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const opt = [...el.parentElement.querySelectorAll('.combo-option')].find((o) => o.textContent.includes(optionText));
    if (!opt) throw new Error('No option ' + optionText);
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  },
  click(selector, text) {
    const els = [...document.querySelectorAll(selector)].filter((e) => !text || e.textContent.trim().includes(text));
    const el = els.find((e) => e.offsetParent !== null) || els[0];
    if (!el) throw new Error('Nothing to click: ' + selector + ' ' + (text || ''));
    el.click();
    return true;
  },
};
true;`;

const js = (code) => wc.executeJavaScript(code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(expr, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await js(`!!(${expr})`)) return; } catch (_) { /* page may be reloading */ }
    await sleep(60);
  }
  throw new Error(`Timed out waiting for ${label || expr}`);
}

async function shot(name) {
  // A hidden window paints lazily: ask for a repaint and wait two frames so the capture shows the current screen.
  try { wc.invalidate(); await js("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"); await sleep(150); } catch (_) { /* capture anyway */ }
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(shotsDir, `${name}.png`), img.toPNG());
}

async function step(name, fn) {
  try {
    await fn();
    passed.push(name);
  } catch (err) {
    problems.push(`${name}: ${err.message}`);
    try { await shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}`); } catch (_) { /* ignore */ }
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function goTo(hash, heading) {
  await js(`location.hash = '${hash}'; true`);
  await waitFor(`!__t.q('.main .loading') && __t.text('.page-head h1') === ${JSON.stringify(heading)}`, `page ${heading}`);
  await sleep(150);
}

async function closeModal() {
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await waitFor(`!__t.q('.backdrop')`, 'modal closed');
}

async function run() {
  const core = main.getCore();
  const db = () => core.db;

  await step('setup screen shows both choices', async () => {
    await waitFor(`document.querySelectorAll('.choice').length === 2`, 'setup choices');
    await shot('01-setup-choice');
  });

  await step('create head office wizard', async () => {
    await js(`__t.click('.choice', 'Create a new Head Office')`);
    await waitFor(`__t.fieldByLabel('Organisation name')`);
    // Next without the required field shows an inline message instead of moving on.
    await js(`__t.fill('Organisation name', ''); __t.click('button[type=submit]')`);
    await waitFor(`__t.q('.field.has-error')`, 'required error');
    await js(`__t.fill('Organisation name', 'Shifa Pharmacy'); __t.fill('Organisation code', 'shifa'); __t.click('button[type=submit]')`);
    await waitFor(`__t.fieldByLabel('Head Office name')`);
    await shot('02-setup-step2');
    await js(`__t.fill('Head Office name', 'Shifa Head Office'); __t.fill('Head Office code', 'HO'); __t.fill('Address', 'Main Boulevard, Lahore'); __t.fill('Drug sale licence number', 'DSL-123'); __t.click('button[type=submit]')`);
    await waitFor(`__t.fieldByLabel('Your full name')`);
    await js(`__t.fill('Your full name', 'Ayesha Khan'); __t.fill('Username', 'ayesha'); __t.fill('Password', 'Shifa#2026'); __t.fill('Type the password again', 'Shifa#2026'); __t.click('button[type=submit]')`);
    // The recovery key is shown once; Continue works only after confirming it was written down.
    await waitFor(`__t.q('#recovery-key') && /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(__t.text('#recovery-key'))`, 'recovery key shown', 15000);
    await shot('02b-recovery-key');
    expect(await js(`__t.q('.modal-foot .btn.primary').disabled`), 'continue waits for the confirmation');
    await js(`__t.q('.auth-card input[type=checkbox], .card input[type=checkbox]').click(); __t.click('.modal-foot .btn.primary')`);
    await waitFor(`__t.q('.shell')`, 'shell after setup', 15000);
    await waitFor(`__t.text('.page-head h1') === 'Hello, Ayesha'`, 'home greeting');
    await shot('03-home');
    const topbar = await js(`__t.text('.topbar')`);
    expect(topbar.includes('Shifa Head Office') && topbar.includes('Head Office') && topbar.includes('Super Admin') && topbar.includes('Sync'), 'top bar shows branch, role, sync state');
    expect(db().prepare('SELECT COUNT(*) AS n FROM roles').get().n === 6, 'six roles in database');
  });

  await step('every admin page opens without errors', async () => {
    for (const [hash, heading, file] of [['#/branches', 'Branches', '04-branches'], ['#/users', 'Users', '05-users'], ['#/roles', 'Roles and permissions', '06-roles'], ['#/devices', 'Computers', '07-devices'], ['#/settings', 'Settings', '08-settings'], ['#/audit', 'Audit log', '09-audit'], ['#/profile', 'My profile', '10-profile']]) {
      await goTo(hash, heading);
      await shot(file);
    }
  });

  let managerPassword = null;
  await step('add a branch with its manager', async () => {
    await goTo('#/branches', 'Branches');
    await js(`__t.click('.page-head .btn.primary')`);
    await waitFor(`__t.q('.modal') && __t.fieldByLabel('Branch name', '.modal')`);
    await shot('11-branch-form');
    await js(`__t.fill('Branch name', 'Shifa Gulberg', '.modal'); __t.fill('Code', 'gbg', '.modal'); __t.fill('Phone', '042-111', '.modal'); __t.fill('Manager full name', 'Bilal Ahmed', '.modal'); __t.fill('Manager username', 'bilal', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`__t.q('.temp-password')`, 'temporary password dialog');
    managerPassword = await js(`__t.text('.temp-password')`);
    expect(/^[a-z]+-\d{4}$/.test(managerPassword), 'temporary password format');
    await shot('12-temp-password');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop')`);
    await waitFor(`__t.qa('table.data tbody tr').length === 2`, 'two branches listed');
    const dbCount = db().prepare('SELECT COUNT(*) AS n FROM branches').get().n;
    expect(dbCount === 2, `database has ${dbCount} branches`);
    const gbgUsers = await js(`(() => { const col = __t.qa('table.data th').findIndex((th) => th.textContent === 'Staff'); return __t.qa('table.data tbody tr').find((r) => r.textContent.includes('GBG')).children[col].textContent; })()`);
    expect(gbgUsers === '1', `Gulberg staff count shown ${gbgUsers}`);
  });

  await step('duplicate branch code shows a plain message on the field', async () => {
    await js(`__t.click('.page-head .btn.primary')`);
    await waitFor(`__t.fieldByLabel('Branch name', '.modal')`);
    await js(`__t.fill('Branch name', 'Again', '.modal'); __t.fill('Code', 'GBG', '.modal'); __t.fill('Manager full name', 'X Y', '.modal'); __t.fill('Manager username', 'xy1', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`__t.q('.modal .field.has-error .error-text')`, 'field error');
    const msg = await js(`__t.text('.modal .field.has-error .error-text')`);
    expect(msg === 'Another branch already uses this code.', `message was: ${msg}`);
    await closeModal();
  });

  let cashierPassword = null;
  await step('add a cashier user', async () => {
    await goTo('#/users', 'Users');
    await js(`__t.click('.page-head .btn.primary')`);
    await waitFor(`__t.fieldByLabel('Full name', '.modal')`);
    await js(`__t.fill('Full name', 'Sara Malik', '.modal'); __t.fill('Username', 'sara', '.modal'); __t.pick('Role', 'Cashier', '.modal')`);
    await shot('13-user-form');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`__t.q('.temp-password')`, 'cashier temp password');
    cashierPassword = await js(`__t.text('.temp-password')`);
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop')`);
    await waitFor(`__t.text('table.data tbody') && __t.text('table.data tbody').includes('Sara Malik')`, 'new user listed');
    const shown = await js(`__t.qa('table.data tbody tr').length`);
    const inDb = db().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    expect(shown === inDb, `users shown ${shown} vs database ${inDb}`);
    await shot('14-users-list');
  });

  await step('role editor shows the permission checklist', async () => {
    await goTo('#/roles', 'Roles and permissions');
    await js(`__t.click('table.data tbody tr', 'Cashier')`);
    await waitFor(`__t.q('.perm-table')`, 'permission table');
    const ticked = await js(`__t.qa('.modal input[type=checkbox]:checked').length`);
    const inRole = JSON.parse(db().prepare("SELECT permissions FROM roles WHERE name = 'Cashier'").get().permissions).length;
    expect(ticked === inRole, `ticked ${ticked} vs role ${inRole}`);
    await shot('15-role-editor');
    await closeModal();
  });

  await step('settings save and show a confirmation', async () => {
    await goTo('#/settings', 'Settings');
    await js(`__t.fill('Currency symbol', 'PKR'); __t.click('.page .btn.primary', 'Save changes')`);
    await waitFor(`__t.q('.toast') && __t.text('.toast').includes('Saved')`, 'saved toast');
    const value = db().prepare("SELECT value FROM settings WHERE key = 'currency.symbol'").get();
    expect(value && JSON.parse(value.value) === 'PKR', 'setting stored');
  });

  await step('audit log lists entries and opens one with its record', async () => {
    await goTo('#/audit', 'Audit log');
    await waitFor(`__t.qa('table.data tbody tr.clickable').length > 0`, 'audit rows');
    const footer = await js(`__t.text('.table-foot span')`);
    const total = db().prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    expect(footer.endsWith(`of ${total}`), `footer "${footer}" vs ${total} entries`);
    await js(`__t.click('table.data tbody tr.clickable', 'Currency symbol')`);
    await waitFor(`__t.q('.diff')`, 'audit diff');
    const diffText = await js(`__t.text('.diff')`);
    expect(diffText.includes('Rs') && diffText.includes('PKR'), 'before and after shown');
    await shot('16-audit-entry');
    await closeModal();
  });

  await step('command palette opens with Ctrl+K and navigates', async () => {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); true`);
    await waitFor(`__t.q('.palette-results')`, 'palette');
    await js(`{ const i = __t.q('.palette .input'); i.value = 'comp'; i.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await shot('17-palette');
    await js(`__t.q('.palette .input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
    await waitFor(`__t.text('.page-head h1') === 'Computers'`, 'navigated to Computers');
  });

  await step('dark theme preference applies', async () => {
    await goTo('#/profile', 'My profile');
    await js(`{ const s = __t.fieldByLabel('Appearance'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); } true`);
    await waitFor(`document.documentElement.dataset.theme === 'dark'`, 'dark theme');
    await shot('18-dark-profile');
    await goTo('#/users', 'Users');
    await waitFor(`__t.qa('table.data tbody tr').length === 3`, 'users rows in dark theme');
    await sleep(400);
    await shot('19-dark-users');
    await goTo('#/profile', 'My profile');
    await js(`{ const s = __t.fieldByLabel('Appearance'); s.value = 'light'; s.dispatchEvent(new Event('change', { bubbles: true })); } true`);
    await waitFor(`document.documentElement.dataset.theme === 'light'`, 'light theme');
  });

  // ---- Phase 1: inventory and purchasing ---------------------------------------------------------------------------
  const future = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString('en-CA'); };
  // Types into a product search box and picks the first result.
  const pickProduct = async (scope, text) => {
    await js(`{ const i = __t.q('${scope} .combo .input-wrap input'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    // Only the product search box (other dropdowns on the page keep hidden options).
    const opt = `__t.q('${scope} .combo:has(.input-wrap) .combo-list:not([hidden]) .combo-option')`;
    await waitFor(opt, `product result for ${text}`);
    await js(`${opt}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true`);
  };
  const setField = (selector, value) => js(`{ const el = ${selector}; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } true`);

  await step('add a product with units, barcode and prices', async () => {
    await goTo('#/products', 'Medicines and products');
    await shot('30-products-empty');
    await js(`__t.click('.page-head .btn.primary', 'Add product')`);
    await waitFor(`__t.fieldByLabel('Brand name', '.modal')`);
    await js(`__t.fill('Brand name', 'Panadol', '.modal'); __t.fill('Generic name (salt)', 'Paracetamol', '.modal'); __t.fill('Strength', '500mg', '.modal');
      __t.fill('Smallest units in one pack', '10', '.modal'); __t.fill('MRP per pack', '30', '.modal'); __t.fill('Trade price per pack', '25', '.modal');
      __t.fill('Barcodes', '8964000111222', '.modal'); __t.fill('Reorder level', '50', '.modal'); __t.fill('Reorder quantity', '200', '.modal'); __t.pick('Dosage form', 'Tablet', '.modal'); true`);
    await shot('31-product-form');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`__t.text('.page-head h1') === 'Panadol 500mg'`, 'product page');
    const p = db().prepare("SELECT * FROM products WHERE brand_name = 'Panadol'").get();
    expect(p && p.mrp === 3000 && p.trade_price === 2500 && p.pack_size === 10, 'product stored with paisa prices');
    expect(db().prepare('SELECT COUNT(*) AS n FROM product_units WHERE product_id = ?').get(p.id).n === 2, 'base and pack units');
    await shot('32-product-page');
  });

  await step('add a supplier', async () => {
    await goTo('#/suppliers', 'Suppliers');
    await js(`__t.click('.page-head .btn.primary', 'Add supplier')`);
    await waitFor(`__t.fieldByLabel('Company name', '.modal')`);
    await js(`__t.fill('Company name', 'Ali Distributors', '.modal'); __t.fill('Payment terms (days)', '30', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`__t.text('.page-head h1') === 'Ali Distributors'`, 'supplier page');
  });

  await step('receive goods: batch, expiry, bonus, discount; posting adds stock and the bill', async () => {
    await goTo('#/grn?new=1', 'Receive goods');
    await js(`__t.pick('Supplier', 'Ali Distributors')`);
    await js(`__t.fill('Supplier invoice number', 'INV-778')`);
    await pickProduct('.page', 'Pan');
    await waitFor(`__t.q('.page table.data tbody tr')`, 'line added');
    await setField(`__t.q('.page tbody tr input[placeholder="Batch"]')`, 'PN-01');
    await setField(`__t.q('.page tbody tr input[type=date]')`, future(400));
    await setField(`__t.qa('.page tbody tr .qty-input')[0].querySelector('input')`, '50');
    await setField(`__t.qa('.page tbody tr .qty-input')[1].querySelector('input')`, '5');
    await setField(`__t.q('.page tbody tr input[placeholder="%"]')`, '10');
    await waitFor(`(__t.text('.page') || '').includes('1,125.00')`, 'line total estimate 1,125.00');
    await shot('33-grn-editor');
    await js(`__t.click('.page-head .btn.primary', 'Post')`);
    await waitFor(`__t.q('.modal') && (__t.text('.modal') || '').includes('Post this goods receipt')`, 'post confirm');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`__t.text('.page-head h1') && __t.text('.page-head h1').startsWith('Goods receipt GRN-')`, 'posted view', 10000);
    const text = await js(`__t.text('.page')`);
    expect(text.includes('Posted') && text.includes('1,125.00'), 'posted with the right total');
    const bal = db().prepare('SELECT SUM(credit - debit) AS b FROM supplier_ledger').get().b;
    expect(bal === 112500, `supplier owes ${bal}`);
    const onHand = db().prepare('SELECT SUM(qty) AS q FROM stock_balances').get().q;
    expect(onHand === 550, `on hand ${onHand} (50 strips + 5 bonus)`);
    await shot('34-grn-posted');
  });

  await step('batches and expiry page, product "why this stock" tab', async () => {
    await goTo('#/batches', 'Batches and expiry');
    await waitFor(`__t.qa('table.data tbody tr.clickable, table.data tbody tr').length >= 1 && __t.text('table.data tbody').includes('PN-01')`, 'batch row');
    await shot('35-batches');
    const p = db().prepare("SELECT id FROM products WHERE brand_name = 'Panadol'").get();
    await js(`location.hash = '#/product?id=${p.id}&tab=why'; true`);
    await waitFor(`__t.q('.diff') && (__t.text('.diff') || '').includes('Goods received')`, 'reconciliation');
    const why = await js(`__t.text('.card-head h2')`);
    expect(why.includes('55 Strips'), `why heading: ${why}`);
    await shot('36-product-why');
  });

  await step('stock adjustment: damaged strip posts at once (owner may approve)', async () => {
    await goTo('#/adjustments', 'Stock adjustments');
    await js(`__t.click('.page-head .btn.primary', 'New adjustment')`);
    await waitFor(`__t.q('.modal') && __t.fieldByLabel('Type', '.modal')`);
    await js(`{ const s = __t.fieldByLabel('Type', '.modal'); s.value = 'damaged'; s.dispatchEvent(new Event('change', { bubbles: true })); } __t.fill('Reason', 'Strip torn', '.modal'); true`);
    await pickProduct('.modal', 'Panadol');
    await waitFor(`__t.q('.modal .card select') && __t.q('.modal .card select').options.length > 1`, 'batch list');
    await js(`{ const s = __t.q('.modal .card select'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); } true`);
    await setField(`__t.q('.modal .card .qty-input input')`, '1');
    await shot('37-adjustment-form');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`__t.text('.page-head h1') && __t.text('.page-head h1').startsWith('Damaged ADJ-')`, 'adjustment detail');
    expect(db().prepare('SELECT SUM(qty) AS q FROM stock_balances').get().q === 540, 'one strip less');
  });

  await step('transfer to the branch and receive it there with a shortage', async () => {
    await goTo('#/transfers', 'Transfers');
    await js(`__t.click('.page-head .btn.primary', 'Send stock')`);
    await waitFor(`__t.q('.modal') && __t.fieldByLabel('To', '.modal')`);
    await pickProduct('.modal', 'Panadol');
    await waitFor(`__t.q('.modal .qty-input input')`);
    await setField(`__t.q('.modal .qty-input input')`, '10');
    await js(`__t.click('.modal .btn.primary', 'Send now')`);
    await waitFor(`__t.text('.page-head') && (__t.text('.page-head') || '').includes('On the way')`, 'dispatched transfer');
    await shot('38-transfer-dispatched');
    const gbg = db().prepare("SELECT id FROM branches WHERE code = 'GBG'").get().id;
    // Switch to the branch through the top bar menu.
    await js(`__t.click('.topbar .top-chip', 'Shifa Head Office')`);
    await waitFor(`__t.q('.popover .menu-item')`);
    await js(`__t.click('.popover .menu-item', 'Shifa Gulberg')`);
    await waitFor(`(__t.text('.topbar') || '').includes('Shifa Gulberg')`, 'switched branch');
    const tr = db().prepare('SELECT id FROM transfers LIMIT 1').get().id;
    await js(`location.hash = '#/transfer?id=${tr}'; true`);
    await waitFor(`__t.q('.page-head .btn.primary') && __t.text('.page-head .btn.primary').includes('Receive')`, 'receive button');
    await js(`__t.click('.page-head .btn.primary', 'Receive')`);
    await waitFor(`__t.q('.modal .qty-input')`);
    await setField(`__t.q('.modal .qty-input input')`, '9');
    await setField(`__t.q('.modal input[placeholder="Only if less arrived"]')`, 'One strip missing');
    await shot('39-transfer-receive');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`(__t.text('.page-head') || '').includes('Difference open')`, 'received with difference');
    const atBranch = db().prepare('SELECT SUM(qty) AS q FROM stock_balances WHERE branch_id = ?').get(gbg).q;
    expect(atBranch === 90, `branch has ${atBranch}`);
    await js(`__t.click('.topbar .top-chip', 'Shifa Gulberg')`);
    await waitFor(`__t.q('.popover .menu-item')`);
    await js(`__t.click('.popover .menu-item', 'Shifa Head Office')`);
    await waitFor(`(__t.text('.topbar') || '').includes('Shifa Head Office')`, 'back to head office');
  });

  await step('every Phase 1 page opens without errors', async () => {
    for (const [hash, heading, file] of [
      ['#/movements', 'Stock movements', '40-movements'], ['#/stocktake', 'Stock take', '41-stocktake'], ['#/reorder', 'Reorder list', '42-reorder'],
      ['#/stock-reports', 'Stock value and movers', '43-stock-value'], ['#/labels', 'Barcode labels', '44-labels'], ['#/lists', 'Lists and categories', '45-lists'],
      ['#/import', 'Import', '46-import'], ['#/purchase-orders', 'Purchase orders', '47-po-list'], ['#/po?new=1', 'New purchase order', '48-po-new'],
      ['#/grns', 'Goods received', '49-grns'], ['#/purchase-returns', 'Returns to suppliers', '50-returns'], ['#/purchase-returns?new=1', 'New return', '51-return-new'],
      ['#/payments', 'Supplier payments', '52-payments'], ['#/payments?new=1', 'Pay supplier', '53-pay-new'],
    ]) {
      await goTo(hash, heading);
      await shot(file);
    }
    // Reorder suggests Panadol (stock 440 is above 50? no: reorder level 50 < 440, so the list is empty and says so).
    const sup = db().prepare("SELECT id FROM suppliers LIMIT 1").get().id;
    await goTo(`#/supplier?id=${sup}&tab=bills`, 'Ali Distributors');
    await waitFor(`(__t.text('.page') || '').includes('INV-778')`, 'unpaid bill listed');
    await shot('54-supplier-bills');
  });

  await step('labels page shows a barcode preview', async () => {
    const p = db().prepare("SELECT id FROM products WHERE brand_name = 'Panadol'").get();
    await js(`location.hash = '#/labels?productId=${p.id}'; true`);
    await waitFor(`__t.q('.page svg rect')`, 'barcode preview');
    await shot('55-labels-preview');
  });

  // ---- Phase 2: point of sale -------------------------------------------------------------------------------------
  const keyDown = (key, extra = '') => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true ${extra} })); true`);

  await step('counter: open shift, scan a barcode, pay cash, change shown', async () => {
    // A hidden test window cannot answer the Windows print dialog, so automatic receipt printing is off here.
    await js(`window.mediescare.call('settings.update', { scope: 'branch', values: { 'receipt.autoPrint': false } })`);
    await js(`location.hash = '#/pos'; true`);
    await waitFor(`__t.q('.modal') && __t.fieldByLabel('Cash in the drawer now', '.modal')`, 'open shift dialog');
    await shot('60-pos-open-shift');
    await js(`__t.fill('Cash in the drawer now', '1000', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop') && (__t.text('.pos-shift') || '').includes('Shift SHF-')`, 'shift open');
    // Scanner: types the code and presses Enter.
    await js(`{ const i = __t.q('.pos-search input'); i.focus(); i.value = '8964000111222'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } true`);
    await waitFor(`__t.qa('.pos-table tbody tr input.pos-qty').length === 1`, 'line from barcode');
    await setField(`__t.q('.pos-table .pos-qty')`, '2');
    await waitFor(`(__t.text('.pos-grand') || '').includes('60.00')`, 'total 60.00');
    await shot('61-pos-cart');
    await keyDown('F10');
    await waitFor(`__t.q('.modal .pos-paystatus')`, 'payment dialog');
    await setField(`__t.qa('.modal input')[0]`, '100');
    await waitFor(`(__t.text('.modal .pos-paystatus') || '').includes('40.00')`, 'change 40.00');
    await shot('62-pos-pay');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop')`, 'payment modal closed', 10000);
    const sale = db().prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 1').get();
    expect(sale.total === 6000 && sale.change_given === 4000 && sale.paid === 6000, `sale stored total ${sale.total} change ${sale.change_given}`);
    await shot('63-pos-done');
  });

  await step('counter: hold a bill and resume it', async () => {
    await pickProduct('.pos-search', 'Pan');
    await waitFor(`__t.qa('.pos-table tbody tr input.pos-qty').length === 1`, 'line added');
    await keyDown('F8');
    await waitFor(`__t.fieldByLabel('Name to find it again', '.modal')`);
    await js(`__t.fill('Name to find it again', 'Man in grey', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop') && !__t.q('.pos-table tbody tr input.pos-qty')`, 'cart cleared after hold');
    await keyDown('F9');
    await waitFor(`(__t.text('.modal') || '').includes('Man in grey')`, 'held bill listed');
    await js(`__t.click('.modal .btn.primary', 'Resume')`);
    await waitFor(`__t.qa('.pos-table tbody tr input.pos-qty').length === 1`, 'resumed');
    await js(`__t.click('.pos-right .btn', 'New bill')`);
    await waitFor(`__t.q('.modal')`);
    await js(`__t.click('.modal .btn.danger')`);
    await waitFor(`!__t.q('.backdrop')`);
  });

  await step('sales history, bill and receipt preview', async () => {
    await goTo('#/sales', 'Sales and receipts');
    await waitFor(`(__t.text('table.data tbody') || '').includes('INV-HO1-0001')`, 'bill listed');
    await shot('64-sales');
    await js(`__t.click('table.data tbody tr', 'INV-HO1-0001')`);
    await waitFor(`(__t.text('.page-head h1') || '').startsWith('Bill INV-HO1-0001')`, 'bill page');
    await js(`__t.click('.page-head .btn', 'View receipt')`);
    await waitFor(`__t.q('.modal .modal-body > div') && __t.q('.modal .modal-body > div').shadowRoot && __t.q('.modal .modal-body > div').shadowRoot.textContent.includes('INV-HO1-0001')`, 'receipt preview');
    await sleep(500);
    await shot('65-receipt-preview');
    await closeModal();
  });

  await step('customers, shift report, controlled register, printer page', async () => {
    await goTo('#/customers', 'Customers');
    await js(`__t.click('.page-head .btn.primary', 'Add customer')`);
    await waitFor(`__t.fieldByLabel('Full name', '.modal')`);
    await js(`__t.fill('Full name', 'Hamid Ali', '.modal'); __t.fill('Phone', '0300-1234567', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`__t.text('.page-head h1') === 'Hamid Ali'`, 'customer page');
    await goTo('#/shifts', 'Cashier shifts');
    await js(`__t.click('table.data tbody tr', 'SHF-')`);
    await waitFor(`(__t.text('.page-head h1') || '').startsWith('X report')`, 'shift report');
    expect((await js(`__t.text('.page')`)).includes('60.00'), 'shift report shows the sale');
    await shot('66-shift-x');
    await goTo('#/controlled', 'Controlled drugs and prescriptions');
    await shot('67-controlled');
    await goTo('#/printer', 'Receipt printer');
    await shot('68-printer');
  });

  // ---- Phase 3: sync and backups ----------------------------------------------------------------------------------
  await step('sync screen: shop network service running, pairing code for a new computer, top bar state', async () => {
    await goTo('#/sync', 'Sync');
    await waitFor(`(__t.text('.page') || '').includes('Running on port 47891')`, 'LAN service running');
    await js(`__t.click('.page .btn', 'Add a computer')`);
    await waitFor(`__t.q('.modal .temp-password') && /^\\d{6}$/.test(__t.text('.modal .temp-password'))`, 'pairing code');
    await shot('70-sync-pair');
    await closeModal();
    // The top bar shows the sync state from the main process.
    await waitFor(`!(__t.text('#sync-chip') || '').includes('Loading')`, 'sync chip painted', 20000);
    await shot('71-sync');
  });

  await step('backups: make one now and see it listed', async () => {
    await goTo('#/backups', 'Backups');
    await js(`__t.click('.page-head .btn.primary', 'Make a backup now')`);
    await waitFor(`(__t.text('table.data tbody') || '').includes('Made by hand')`, 'manual backup listed', 15000);
    const row = db().prepare("SELECT * FROM backups WHERE kind = 'manual' AND status = 'ok'").get();
    expect(row && require('fs').existsSync(row.file), 'backup file exists');
    await shot('72-backups');
  });

  // ---- Phase 4: finance and insight -------------------------------------------------------------------------------
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const setSelect = (label, value, scope) => js(`{ const el = __t.fieldByLabel(${JSON.stringify(label)}, ${JSON.stringify(scope || null)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); } true`);

  await step('dashboard: today tiles and charts with hover, a figure opens its bills', async () => {
    await goTo('#/dashboard', 'Dashboard');
    await waitFor(`__t.qa('.stat-grid .stat').length >= 12 && __t.q('.chart svg path')`, 'tiles and charts');
    const net = db().prepare("SELECT COALESCE(SUM(total), 0) AS t FROM sales WHERE status = 'completed'").get().t;
    const tileText = await js(`__t.text('.stat-grid .stat')`);
    expect(tileText.includes((net / 100).toFixed(2)), `net sales tile: ${tileText}`);
    await js(`{ const r = __t.q('.chart svg rect[fill="transparent"]'); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: b.right - 4, clientY: b.top + 20 })); } true`);
    await waitFor(`__t.q('.chart-tip:not([hidden])')`, 'chart tooltip');
    await sleep(400);
    await waitFor(`!__t.q('.main .loading') && __t.q('.stat-grid')`, 'dashboard still shown');
    await shot('80-dashboard');
    await js(`__t.q('.main').scrollTop = 600; true`);
    await sleep(200);
    await shot('80b-dashboard-charts');
    await js(`__t.q('.main').scrollTop = 0; true`);
    await js(`__t.click('.stat-grid button.stat', 'Bills')`);
    await waitFor(`__t.text('.page-head h1') === 'Sales and receipts' && location.hash.includes('from=')`, 'bills of today');
  });

  await step('reports: daily sales with totals, reconciliation without differences, management summary', async () => {
    await goTo('#/reports', 'Reports');
    await shot('81-reports');
    await js(`__t.click('.choice', 'Daily sales')`);
    await waitFor(`__t.text('.page-head h1') === 'Daily sales' && __t.q('table.data tfoot')`, 'daily sales table');
    const net = db().prepare("SELECT COALESCE(SUM(total), 0) AS t FROM sales WHERE status = 'completed'").get().t;
    expect((await js(`__t.text('table.data tfoot')`)).includes((net / 100).toFixed(2)), 'daily total');
    await shot('82-report-daily');
    const recon = await js(`window.mediescare.call('reports.run', { report: 'reconciliation', from: '2000-01-01', to: '${today}' })`);
    expect(recon.ok && recon.data.rows.length > 0 && recon.data.rows.every((r) => r.difference === 0), 'reconciliation balances');
    await goTo('#/report?key=reconciliation', 'Inventory reconciliation and stock movement');
    await waitFor(`__t.q('table.data tbody tr')`, 'reconciliation rows');
    await shot('83-report-reconciliation');
    await goTo('#/report?key=management_summary', 'Management summary');
    await waitFor(`(__t.text('table.data tbody') || '').includes('Net sales')`, 'summary rows');
    await shot('84-report-summary');
  });

  await step('financial journal shows the bill and the money taken', async () => {
    await goTo('#/finance', 'Financial journal');
    await waitFor(`__t.qa('table.data tbody').map((x) => x.textContent).join(' ').includes('INV-HO1-0001')`, 'sale in journal');
    await shot('85-finance');
  });

  await step('petty cash top-up, an expense from the box, the book balance', async () => {
    await goTo('#/petty-cash', 'Petty cash book');
    await js(`__t.click('.page-head .btn.primary', 'Put money in')`);
    await waitFor(`__t.fieldByLabel('Amount', '.modal')`);
    await js(`__t.fill('Amount', '500', '.modal'); __t.fill('Reason', 'Weekly float', '.modal'); __t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop') && (__t.text('.stat-grid') || '').includes('500.00')`, 'balance 500');
    await goTo('#/expenses', 'Expenses');
    await js(`__t.click('.page-head .btn.primary', 'Add expense')`);
    await waitFor(`__t.fieldByLabel('Description', '.modal')`);
    const cat = db().prepare("SELECT id FROM expense_categories WHERE name = 'Tea and refreshments'").get().id;
    await setSelect('Category', cat, '.modal');
    await setSelect('Paid from', 'petty', '.modal');
    await js(`__t.fill('Description', 'Tea for staff', '.modal'); __t.fill('Amount', '120', '.modal'); true`);
    await shot('86-expense-add');
    await js(`__t.click('.modal .btn.primary')`);
    await waitFor(`!__t.q('.backdrop') && (__t.text('table.data tbody') || '').includes('Tea for staff')`, 'expense listed');
    const e = db().prepare("SELECT * FROM expenses WHERE description = 'Tea for staff'").get();
    expect(e && e.status === 'posted' && e.amount === 12000, 'expense stored');
    const bal = db().prepare('SELECT SUM(amount) AS b FROM petty_cash').get().b;
    expect(bal === 38000, `petty balance ${bal}`);
    await shot('87-expenses');
  });

  await step('approvals: a counter request from another person is approved here', async () => {
    const sara = db().prepare("SELECT id, branch_id FROM users WHERE username = 'sara'").get();
    const now = new Date().toISOString();
    db().prepare(`INSERT INTO approval_requests (id, branch_id, kind, needs, summary, amount, status, requested_by, requested_at, created_at, updated_at)
      VALUES ('UIAPPROVAL0000000000000001', ?, 'sale', '["discount.above_limit"]', '20% discount for a regular customer', NULL, 'pending', ?, ?, ?, ?)`).run(core.device.branch_id, sara.id, now, now, now);
    await goTo('#/approvals', 'Approvals');
    await waitFor(`(__t.text('table.data tbody') || '').includes('20% discount')`, 'request listed');
    await shot('88-approvals');
    await js(`__t.click('table.data tbody .btn.primary', 'Approve')`);
    await waitFor(`!(__t.text('table.data tbody') || '').includes('20% discount')`, 'request decided');
    expect(db().prepare("SELECT status FROM approval_requests WHERE id = 'UIAPPROVAL0000000000000001'").get().status === 'approved', 'approved in the database');
  });

  await step('notifications: the bell lists alerts and the count clears when seen', async () => {
    await js(`__t.click('#bell')`);
    await waitFor(`__t.qa('.popover .notif').length >= 1`, 'notifications listed');
    await shot('89-notifications');
    await waitFor(`!__t.q('#bell .bell-count')`, 'count cleared');
    await js(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true`);
  });

  await step('global search: a bill number or a barcode plus Enter opens the record', async () => {
    const typeAndEnter = async (text) => {
      await keyDown('k', ', ctrlKey: true');
      await waitFor(`__t.q('.modal.palette input')`, 'search box');
      await js(`{ const i = __t.q('.modal.palette input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } true`);
    };
    await typeAndEnter('INV-HO1-0001');
    await waitFor(`(__t.text('.page-head h1') || '').startsWith('Bill INV-HO1-0001')`, 'bill opened');
    await typeAndEnter('8964000111222');
    await waitFor(`location.hash.startsWith('#/product?') && !__t.q('.backdrop')`, 'product opened');
    await keyDown('k', ', ctrlKey: true');
    await waitFor(`__t.q('.modal.palette input')`);
    await js(`{ const i = __t.q('.modal.palette input'); i.value = 'Panadol'; i.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await waitFor(`(__t.text('.palette-results') || '').includes('Medicines and products')`, 'records in results');
    await shot('90-search');
    await closeModal();
  });

  await step('keyboard shortcuts: a clash is blocked, a new key is saved and works', async () => {
    await goTo('#/shortcuts', 'Keyboard shortcuts');
    const press = (key, mods = '') => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true ${mods} })); true`);
    await js(`{ const row = __t.qa('table.data tbody tr').find((r) => r.textContent.includes('Go to Dashboard')); row.querySelector('.shortcut-key').click(); } true`);
    await press('F2');
    await waitFor(`__t.q('.page .form-error') && __t.q('.card-head .btn.primary').disabled`, 'clash shown');
    await shot('91-shortcuts-clash');
    await js(`{ const row = __t.qa('table.data tbody tr').find((r) => r.textContent.includes('Go to Dashboard')); row.querySelector('.shortcut-key').click(); } true`);
    await press('q', ', altKey: true');
    await waitFor(`!__t.q('.page .form-error') && !__t.q('.card-head .btn.primary').disabled`, 'clash gone');
    await js(`__t.click('.card-head .btn.primary')`);
    await sleep(300);
    const prefs = JSON.parse(db().prepare("SELECT prefs FROM users WHERE username = 'ayesha'").get().prefs);
    expect(prefs.shortcuts && prefs.shortcuts['go.dashboard'] === 'Alt+Q', `saved ${JSON.stringify(prefs.shortcuts)}`);
    await press('q', ', altKey: true');
    await waitFor(`__t.text('.page-head h1') === 'Dashboard'`, 'new key works');
    await js(`window.mediescare.call('shortcuts.reset', {})`);
  });

  await step('all branches comparison opens a branch dashboard', async () => {
    await goTo('#/all-branches', 'All branches');
    await waitFor(`__t.qa('table.data tbody tr').length >= 1 && __t.q('table.data tfoot')`, 'branch rows');
    await shot('92-all-branches');
    await js(`__t.click('table.data tbody tr')`);
    await waitFor(`__t.text('.page-head h1') === 'Dashboard'`, 'branch dashboard');
  });

  await step('computers page: a join code for a branch is made, shown once and listed', async () => {
    await goTo('#/devices', 'Computers');
    await js(`__t.click('.card-head .btn.primary', 'New join code')`);
    await waitFor(`__t.q('.modal select')`, 'branch choice');
    await js(`__t.click('.modal .btn.primary', 'Make the code')`);
    await waitFor(`__t.q('#join-code') && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(__t.text('#join-code'))`, 'join code shown');
    await shot('97-join-code');
    await closeModal();
    await waitFor(`(__t.text('.page') || '').includes('Ready to use')`, 'code listed');
    const n = db().prepare('SELECT COUNT(*) AS n FROM join_codes').get().n;
    expect(n === 1, 'join code stored');
  });

  // ---- Phase 5: help and updates ---------------------------------------------------------------------------------
  await step('help page: version, update state and both guides', async () => {
    await goTo('#/help', 'Help and updates');
    await waitFor(`(__t.text('.page') || '').includes('Automatic updates not set up') && __t.q('.help-doc table.help-table')`, 'cashier guide and update state');
    await sleep(500);
    await shot('95-help-cashier');
    await js(`__t.click('.card-head .btn', 'Administrator guide')`);
    await waitFor(`(__t.text('.help-doc') || '').includes('Daily checks')`, 'admin guide');
    await js(`__t.click('.card-head .btn', 'User manual')`);
    await waitFor(`__t.q('#help-10-point-of-sale-the-counter') && __t.qa('.help-doc .help-link').length > 40`, 'user manual with contents links');
    await sleep(500);
    await shot('96-help-admin');
  });

  await step('cashier signs in, must change the temporary password, and sees only allowed pages', async () => {
    await js(`__t.click('.topbar button[aria-label="Sign out"]')`);
    await waitFor(`__t.fieldByLabel('Username')`, 'login screen');
    await shot('20-login');
    await js(`__t.fill('Username', 'sara'); __t.fill('Password', 'wrong-one'); __t.click('button[type=submit]')`);
    await waitFor(`__t.q('.form-error:not([hidden])')`, 'wrong password message');
    const msg = await js(`__t.text('.form-error')`);
    expect(msg === 'The username or password is not correct.', `message: ${msg}`);
    await js(`__t.fill('Username', 'sara'); __t.fill('Password', ${JSON.stringify(cashierPassword)}); __t.click('button[type=submit]')`);
    await waitFor(`__t.fieldByLabel('Temporary password')`, 'forced password change');
    await shot('21-forced-password');
    await js(`__t.fill('Temporary password', ${JSON.stringify(cashierPassword)}); __t.fill('New password', 'Sara#2026'); __t.fill('Type the new password again', 'Sara#2026'); __t.click('button[type=submit]')`);
    await waitFor(`__t.q('.shell')`, 'cashier shell');
    const nav = await js(`__t.qa('.nav-item span').map((s) => s.textContent)`);
    const forbidden = ['Users', 'Roles and permissions', 'Branches', 'Settings', 'Audit log', 'Suppliers', 'Goods received', 'Stock adjustments', 'Stock value and movers'];
    expect(nav.includes('Home') && nav.includes('Medicines and products') && !nav.some((n) => forbidden.includes(n)), `cashier menu: ${nav.join(', ')}`);
    // Typing an admin page address directly still does not open it.
    await js(`location.hash = '#/users'; true`);
    await waitFor(`__t.text('.page-head h1') === 'Hello, Sara'`, 'redirected home');
    await shot('22-cashier-home');
  });

  await step('branch manager cannot sign in on the Head Office computer', async () => {
    await js(`__t.click('.topbar button[aria-label="Sign out"]')`);
    await waitFor(`__t.fieldByLabel('Username')`);
    await js(`__t.fill('Username', 'bilal'); __t.fill('Password', ${JSON.stringify(managerPassword)}); __t.click('button[type=submit]')`);
    await waitFor(`__t.q('.form-error:not([hidden])')`);
    const msg = await js(`__t.text('.form-error')`);
    expect(msg.includes('not linked to a branch on this computer'), `message: ${msg}`);
  });
}

app.whenReady().then(async () => {
  const deadline = setTimeout(() => { problems.push('Overall timeout'); finish(); }, 240000);
  for (let i = 0; i < 100 && !main.getWindow(); i++) await sleep(50);
  const win = main.getWindow();
  wc = win.webContents;
  win.setSize(1366, 820);
  wc.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) problems.push(`console ${level === 2 ? 'warning' : 'error'}: ${message} (${source}:${line})`);
  });
  wc.on('render-process-gone', (_e, d) => problems.push(`renderer crashed: ${d.reason}`));
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  await js(PAGE_HELPERS);
  wc.on('did-finish-load', () => js(PAGE_HELPERS));
  try { await run(); } catch (err) { problems.push(`runner: ${err.stack}`); }
  clearTimeout(deadline);
  finish();
});

function finish() {
  for (const p of passed) console.log(`ok     ${p}`);
  for (const p of problems) console.log(`FAIL   ${p}`);
  console.log(`\n${passed.length} passed, ${problems.length} problems. Screenshots: ${shotsDir}`);
  app.exit(problems.length ? 1 : 0);
}

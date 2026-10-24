// Point of sale. Keyboard and barcode scanner first: the search box always has focus after an action.
// The cart lives here; prices, batches and totals shown are quotes from the main process, which checks everything
// again when the bill is finished.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, textarea, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, qtyText, moneyInput, rupees } from '../ui/stockui.js';
import { menu } from '../ui/popover.js';
import * as fmt from '../ui/format.js';
import { askApproval } from './posapproval.js';
import { keyFor, actionFor } from '../keys.js';

// Counter actions. The keys are each person's own (My profile -> Keyboard shortcuts); `key` is only the default.
export const POS_KEYS = [
  { action: 'search', key: 'F2', label: () => t('pos.keySearch') },
  { action: 'customer', key: 'F3', label: () => t('pos.keyCustomer') },
  { action: 'qty', key: 'F4', label: () => t('pos.keyQty') },
  { action: 'discount', key: 'F6', label: () => t('pos.keyDiscount') },
  { action: 'hold', key: 'F8', label: () => t('pos.keyHold') },
  { action: 'holds', key: 'F9', label: () => t('pos.keyHolds') },
  { action: 'pay', key: 'F10', label: () => t('pos.keyPay') },
  { action: 'remove', key: 'Delete', label: () => t('pos.keyRemove') },
  { action: 'newBill', key: 'Ctrl+N', label: () => t('pos.keyNew') },
  { action: 'reprint', key: 'Ctrl+P', label: () => t('pos.keyReprint') },
];

// The key this person uses for a counter action.
function kbd(action) {
  const k = keyFor(`pos.${action}`) || (POS_KEYS.find((x) => x.action === action) || {}).key || '';
  return h('span.kbd', k);
}

// Same integer rounding as the main process, for the on-screen estimate only.
function mulRound(minor, num, den) {
  const p = minor * num;
  const q = Math.floor(Math.abs(p) / den);
  const v = (Math.abs(p) % den) * 2 >= den ? q + 1 : q;
  return p < 0 ? -v : v;
}
function allocate(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!amount || !total) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((amount * w) / total));
  let left = amount - base.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, rem: (amount * w) % total })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base;
}
const paisa = (text) => { const n = Number(String(text || '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export async function render(page, { navigate }) {
  page.classList.add('pos-page');
  const ctxInfo = await call('pos.context');
  let device = { customerDisplay: false };
  try { device = await call('device.settings'); } catch (_) { /* printing settings are optional */ }

  // ---- state ----
  const cart = { lines: [], customer: null, billDiscountType: 'percent', billDiscount: '', notes: '', holdId: null, prescription: null };
  let selected = -1;
  let lastSaleId = null;
  let shift = null;

  // ---- layout ----
  const shiftBar = h('div.pos-shift');
  const picker = productPicker({ onPick: (p) => addProduct(p), placeholder: t('pos.searchPh'), autofocus: true });
  const linesBody = h('tbody');
  const customerBox = h('div.pos-customer');
  const totalsBox = h('div.pos-totals');
  const holdsBtn = h('button.btn', { type: 'button', onclick: () => showHolds() }, icon('history', 'sm'), t('pos.holds'), kbd('holds'));
  const payBtn = h('button.btn.primary.pos-pay', { type: 'button', onclick: () => pay() }, t('pos.pay'), kbd('pay'));
  const keysHelp = h('div.pos-keys', ...POS_KEYS.map((k) => h('span', kbd(k.action), ' ', k.label())));
  page.append(
    h('div.pos', h('div.pos-left',
      h('div.pos-top', shiftBar),
      h('div.pos-search', picker),
      h('div.card.pos-cart', h('div.table-scroll', h('table.data.pos-table',
        h('thead', h('tr', h('th', t('products.name')), h('th', t('stock.batch')), h('th', t('pos.unit')), h('th', t('docs.qty')), h('th.num', t('pos.price')), h('th.num', t('pos.discPct')), h('th.num', t('docs.amount')), h('th', ''))),
        linesBody))),
      keysHelp),
    h('div.pos-right', customerBox, h('div.card', h('div.card-body', totalsBox)),
      h('div.row.wrap', h('button.btn', { type: 'button', onclick: () => holdBill() }, t('pos.hold'), kbd('hold')), holdsBtn,
        h('button.btn', { type: 'button', onclick: () => newBill(true) }, t('pos.clear'))),
      payBtn,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => findBill() }, icon('receipt', 'sm'), t('pos.findBill')),
        can('customers.edit') || can('pos.create') ? h('button.btn.sm', { type: 'button', onclick: () => receiveFromCustomer() }, icon('wallet', 'sm'), t('pos.receivePayment')) : null))));

  // ---- shift ----
  async function loadShift() {
    const res = await call('shifts.current');
    shift = res.shift;
    const mine = shift && shift.userId === state.me.user.id;
    if (!shift) {
      mount(shiftBar, h('div.form-note', icon('alertCircle', 'sm'), h('div.grow', res.required ? t('pos.noShiftText') : t('pos.noShiftOptional')),
        can('shifts.create') ? h('button.btn.primary.sm', { type: 'button', onclick: () => openShift() }, t('pos.openShift')) : null));
      if (res.required && can('shifts.create')) openShift();
      return;
    }
    const btn = h('button.btn.sm', { type: 'button' }, icon('wallet', 'sm'), t('pos.shiftMenu'));
    btn.addEventListener('click', () => menu(btn, [
      { iconEl: icon('plus', 'sm'), label: t('pos.cashIn'), onClick: () => cashMove('in') },
      { iconEl: icon('upload', 'sm'), label: t('pos.cashOut'), onClick: () => cashMove('out') },
      { iconEl: icon('receipt', 'sm'), label: t('pos.xReport'), onClick: () => navigate('shift', { id: shift.id }) },
      { separator: true },
      { iconEl: icon('lock', 'sm'), label: t('pos.closeShift'), danger: true, onClick: () => closeShift() },
    ], { align: 'left' }));
    mount(shiftBar, h('div.row', h('span.dot', { class: mine ? 'success' : 'warning' }),
      h('span.small', t('pos.shiftInfo', { doc: shift.docNo, user: shift.userName, since: fmt.time(shift.openedAt) })),
      h('span.small.muted', t('pos.drawer', { amount: fmt.money(shift.summary.expectedCash) })), h('span.spacer'), btn));
  }

  function openShift() {
    const form = new Form();
    const amt = moneyInput({ autofocus: true, value: '' });
    const save = h('button.btn.primary', { type: 'button' }, t('pos.openShift'));
    const m = openModal({ title: t('pos.openShift'), size: 'narrow', body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('pos.openShiftText')), form.errorBox, form.add('openingCash', fieldText(amt, t('pos.openingCash'), { required: true }))], footer: [save] });
    const go = () => busy(save, null, async () => {
      try { await call('shifts.open', { openingCash: amt.value || '0' }); m.close(); await loadShift(); focusSearch(); } catch (err) { form.showError(err); }
    });
    save.onclick = go;
    amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function cashMove(kind) {
    const form = new Form();
    const amt = moneyInput({ autofocus: true });
    const reason = input({ maxlength: 300, placeholder: kind === 'out' ? t('pos.cashOutPh') : t('pos.cashInPh') });
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const m = openModal({ title: kind === 'in' ? t('pos.cashIn') : t('pos.cashOut'), size: 'narrow', body: [form.errorBox, form.add('amount', fieldText(amt, t('docs.amount'), { required: true })), form.add('reason', fieldText(reason, t('common.reason'), { required: true }))], footer: [save] });
    save.onclick = () => busy(save, null, async () => {
      try { await call('shifts.cashMove', { kind, amount: amt.value, reason: reason.value }); m.close(); toast(t('common.saved')); loadShift(); } catch (err) { form.showError(err); }
    });
  }

  async function closeShift() {
    if (cart.lines.length) { toast(t('pos.finishBillFirst'), { type: 'error' }); return; }
    const current = (await call('shifts.current')).shift;
    const form = new Form();
    const counted = moneyInput({ autofocus: true });
    const notes = input({ maxlength: 500, placeholder: t('pos.closeNotesPh') });
    const diff = h('div.small');
    counted.addEventListener('input', () => {
      const d = paisa(counted.value) - current.summary.expectedCash;
      diff.textContent = counted.value ? (d === 0 ? t('pos.exact') : d > 0 ? t('pos.over', { amount: fmt.money(d) }) : t('pos.short', { amount: fmt.money(-d) })) : '';
      diff.style.color = d === 0 ? 'var(--success)' : 'var(--danger)';
    });
    const save = h('button.btn.primary', { type: 'button' }, t('pos.closeShift'));
    const m = openModal({
      title: t('pos.closeShift'), size: 'narrow',
      body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('pos.closeText')), form.errorBox, form.add('countedCash', fieldText(counted, t('pos.countedCash'), { required: true })), diff, form.add('notes', fieldText(notes, t('products.notes')))],
      footer: [save],
    });
    save.onclick = () => busy(save, null, async () => {
      try {
        const closed = await call('shifts.close', { id: current.id, countedCash: counted.value, notes: notes.value });
        m.close();
        toast(t('pos.shiftClosed'));
        navigate('shift', { id: closed.id });
      } catch (err) { form.showError(err); }
    });
  }

  // ---- cart ----
  function reserved(except = -1) {
    return cart.lines.filter((_, i) => i !== except).map((l) => ({ batchId: l.batchId, qty: l.qty }));
  }

  function lineFromPiece(q, piece, base = {}) {
    const unit = q.units.find((u) => u.id === q.unitId);
    return {
      productId: q.product.id, label: q.product.label, product: q.product, units: q.units, unitId: q.unitId, unitName: unit.name, factor: unit.factor,
      batchId: piece.batchId, batchNo: piece.batchNo, expiryDate: piece.expiryDate, nearExpiry: piece.nearExpiry, daysLeft: piece.daysLeft,
      qty: piece.qty, unitPrice: piece.unitPrice, gross: piece.gross, discount: base.discount || (cart.customer && cart.customer.discountBp ? String(cart.customer.discountBp / 100) : ''),
      price: base.price || '', instructions: base.instructions || '',
    };
  }

  async function addProduct(p, qtyUnits = 1, unitId = null) {
    try {
      const q = await call('pos.quote', { productId: p.id, unitId, qty: qtyUnits, reserved: reserved() });
      if (!q.pieces.length) { outOfStock(q); return; }
      if (q.short > 0) toast(t('pos.partlyAvailable', { qty: q.availableText }), { type: 'error' });
      for (const piece of q.pieces) cart.lines.push(lineFromPiece(q, piece));
      selected = cart.lines.length - 1;
      redraw();
      if (q.pieces.some((x) => x.nearExpiry)) toast(t('pos.nearExpiryNote', { days: q.pieces[0].daysLeft }));
    } catch (err) { toastError(err); }
    focusSearch();
  }

  async function outOfStock(q) {
    let subs = [];
    try { subs = await call('pos.substitutes', { productId: q.product.id }); } catch (_) { subs = []; }
    const m = openModal({
      title: t('pos.outOfStock', { product: q.product.label }), size: 'narrow',
      body: subs.length
        ? [h('p.small.muted', { style: { marginBottom: '8px' } }, t('pos.substitutesText', { salt: q.product.genericName || '' })),
          ...subs.map((s) => h('button.menu-item', { type: 'button', onclick: () => { m.close(); addProduct({ id: s.id }); } }, icon('pill', 'sm'), h('span.grow', s.label), h('span.small.muted', `${s.onHandText} - ${fmt.money(s.mrp)}`)))]
        : [h('p.muted', q.product.genericName ? t('pos.noSubstitutes') : t('pos.noSalt'))],
    });
  }

  // Changing quantity or unit asks for a fresh quote; extra quantity may come from the next batch.
  async function changeLine(i, { units, unitId } = {}) {
    const l = cart.lines[i];
    const newUnit = unitId || l.unitId;
    const unit = l.units.find((u) => u.id === newUnit);
    const wantUnits = units !== undefined ? units : l.qty / unit.factor;
    try {
      const q = await call('pos.quote', { productId: l.productId, unitId: newUnit, qty: wantUnits, batchId: l.batchId, reserved: reserved(i) });
      if (!q.pieces.length || wantUnits <= 0) { cart.lines.splice(i, 1); selected = Math.min(selected, cart.lines.length - 1); redraw(); return; }
      cart.lines[i] = lineFromPiece(q, q.pieces[0], l);
      if (q.short > 0) {
        // Not enough in this batch: take the rest from the next ones (FEFO).
        const rest = await call('pos.quote', { productId: l.productId, unitId: newUnit, qty: q.short / unit.factor, reserved: reserved() });
        for (const piece of rest.pieces) cart.lines.splice(i + 1, 0, lineFromPiece(rest, piece, l));
        if (rest.short > 0) toast(t('pos.partlyAvailable', { qty: rest.availableText }), { type: 'error' });
      }
      redraw();
    } catch (err) { toastError(err); redraw(); }
  }

  async function chooseBatch(i) {
    const l = cart.lines[i];
    const q = await call('pos.quote', { productId: l.productId, unitId: l.unitId, qty: 0, reserved: reserved(i) });
    const m = openModal({
      title: t('pos.chooseBatch', { product: l.label }), size: 'narrow',
      body: q.batches.map((b) => h('button.menu-item', { type: 'button', class: b.batchId === l.batchId ? 'active' : '', onclick: async () => {
        m.close();
        const units = l.qty / l.factor;
        try {
          const nq = await call('pos.quote', { productId: l.productId, unitId: l.unitId, qty: units, batchId: b.batchId, reserved: reserved(i) });
          if (!nq.pieces.length) return;
          cart.lines[i] = lineFromPiece(nq, nq.pieces[0], l);
          if (nq.short > 0) toast(t('pos.batchHasOnly', { qty: nq.pieces[0].qtyText }), { type: 'error' });
          redraw();
        } catch (err) { toastError(err); }
      } }, h('span.grow', h('span.mono', b.batchNo), ' ', h('span.small.muted', `exp ${fmt.date(b.expiryDate)}`)), b.nearExpiry ? h('span.badge.warning', t('stock.daysLeft', { n: b.daysLeft })) : null, h('span.small', b.freeText), h('span.small.muted', fmt.money(b.mrp)))),
    });
  }

  function estimate() {
    const rows = cart.lines.map((l) => {
      const g = l.price !== '' && l.price !== undefined ? mulRound(paisa(l.price), l.qty, l.factor) : l.gross;
      const d = mulRound(g, Math.round(Number(l.discount || 0) * 100), 10000);
      return { g, d };
    });
    const base = rows.reduce((a, r) => a + r.g - r.d, 0);
    let bill = 0;
    if (cart.billDiscount !== '' && Number(cart.billDiscount) > 0) {
      bill = cart.billDiscountType === 'percent' ? mulRound(base, Math.round(Number(cart.billDiscount) * 100), 10000) : Math.min(paisa(cart.billDiscount), base);
    }
    const shares = allocate(bill, rows.map((r) => r.g - r.d));
    const nets = rows.map((r, i) => r.g - r.d - shares[i]);
    const gross = rows.reduce((a, r) => a + r.g, 0);
    const discount = rows.reduce((a, r) => a + r.d, 0) + bill;
    return { nets, gross, discount, total: nets.reduce((a, b) => a + b, 0), items: cart.lines.length };
  }

  function redraw() {
    const est = estimate();
    linesBody.replaceChildren();
    if (!cart.lines.length) {
      linesBody.append(h('tr', h('td', { colspan: 8 }, h('div.empty', icon('cart'), h('h3', t('pos.emptyCart')), h('p', t('pos.emptyCartText'))))));
    }
    cart.lines.forEach((l, i) => {
      const unitSel = h('select.input', { style: { width: '96px', height: '30px' }, 'aria-label': t('pos.unit') }, ...l.units.filter((u) => u.sellable).map((u) => h('option', { value: u.id, selected: u.id === l.unitId }, u.name)));
      unitSel.addEventListener('change', () => changeLine(i, { unitId: unitSel.value, units: Math.max(1, Math.round(l.qty / l.units.find((u) => u.id === unitSel.value).factor) || 1) }));
      const units = Math.round((l.qty / l.factor) * 1000) / 1000;
      const qty = h('input.input.pos-qty', { type: 'number', min: 0, step: 'any', value: units, style: { width: '72px', height: '30px' }, 'aria-label': t('docs.qty') });
      qty.addEventListener('change', () => changeLine(i, { units: Number(qty.value) || 0 }));
      qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qty.blur(); focusSearch(); } });
      const disc = h('input.input', { type: 'number', min: 0, max: 100, step: '0.01', value: l.discount, placeholder: '0', style: { width: '64px', height: '30px', textAlign: 'right' }, 'aria-label': t('pos.discPct') });
      disc.addEventListener('change', () => { l.discount = disc.value; redraw(); });
      // Anyone may open this to add dosage instructions; a changed price is checked by the main process (manager if needed).
      const priceCell = h('button.btn.ghost.sm', { type: 'button', title: t('pos.changePrice'), onclick: () => overridePrice(i) },
        l.price !== '' ? h('span', { style: { color: 'var(--warning)' } }, fmt.money(paisa(l.price))) : fmt.money(l.unitPrice));
      const tr = h('tr', { class: i === selected ? 'selected' : '', onclick: () => { selected = i; markSelected(); } },
        h('td', h('div.cell-main.row', l.label, l.product.rxRequired ? h('span.badge.warning', l.product.controlled ? t('products.controlledShort') : t('products.rxShort')) : null)),
        h('td', h('button.btn.ghost.sm', { type: 'button', onclick: () => chooseBatch(i), title: t('pos.changeBatch') }, h('span.mono', l.batchNo), l.nearExpiry ? h('span.badge.warning', { style: { marginLeft: '4px' } }, t('stock.daysLeft', { n: l.daysLeft })) : null)),
        h('td', unitSel), h('td', qty, h('div.cell-sub', qtyText(l.qty, l.product))), h('td.num', priceCell), h('td.num', disc),
        h('td.num', h('strong', fmt.money(est.nets[i]))),
        h('td', h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { cart.lines.splice(i, 1); selected = Math.min(selected, cart.lines.length - 1); redraw(); } }, icon('x', 'sm'))));
      linesBody.append(tr);
    });
    drawCustomer();
    drawTotals(est);
    payBtn.disabled = !cart.lines.length;
    pushDisplay(est);
  }

  function markSelected() {
    [...linesBody.children].forEach((tr, i) => tr.classList.toggle('selected', i === selected));
  }

  function drawTotals(est = estimate()) {
    const discInput = h('input.input', { type: 'number', min: 0, step: '0.01', value: cart.billDiscount, placeholder: '0', style: { width: '90px', textAlign: 'right' }, id: 'pos-bill-discount', 'aria-label': t('pos.billDiscount') });
    const typeSel = h('select.input', { style: { width: '70px' }, 'aria-label': t('pos.billDiscount') }, h('option', { value: 'percent', selected: cart.billDiscountType === 'percent' }, '%'), h('option', { value: 'amount', selected: cart.billDiscountType === 'amount' }, 'Rs'));
    discInput.addEventListener('change', () => { cart.billDiscount = discInput.value; drawTotals(); redrawNets(); });
    typeSel.addEventListener('change', () => { cart.billDiscountType = typeSel.value; drawTotals(); redrawNets(); });
    const row = (labelText, value, cls) => h('div.row.between', { class: cls || '' }, h('span', labelText), h('span.num', value));
    mount(totalsBox,
      row(t('pos.items'), String(est.items)),
      row(t('grn.gross'), fmt.money(est.gross)),
      h('div.row.between', h('span', t('pos.billDiscount'), h('span', { style: { marginLeft: '6px' } }, kbd('discount'))), h('div.row', discInput, typeSel)),
      row(t('pos.discountTotal'), fmt.money(-est.discount)),
      h('div.pos-grand', h('span', t('docs.total')), h('strong', fmt.money(est.total))),
      h('p.small.faint', t('pos.taxIncluded')));
  }

  function redrawNets() {
    const est = estimate();
    [...linesBody.children].forEach((tr, i) => { const cell = tr.children[6]; if (cell && est.nets[i] !== undefined) cell.replaceChildren(h('strong', fmt.money(est.nets[i]))); });
    pushDisplay(est);
  }

  function drawCustomer() {
    const c = cart.customer;
    mount(customerBox, h('div.card', h('div.card-body.stack.tight',
      h('div.row.between', h('span.small.muted', t('pos.customer'), ' ', kbd('customer')), c ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { cart.customer = null; redraw(); } }, t('pos.walkIn')) : null),
      c ? h('div', h('div.cell-main', c.name), h('div.small.muted', [c.phone, c.balance ? t('pos.owes', { amount: fmt.money(c.balance) }) : null, c.discountBp ? t('pos.usualDiscount', { pct: c.discountBp / 100 }) : null].filter(Boolean).join(' - ')))
        : h('button.btn', { type: 'button', onclick: () => pickCustomer(), style: { justifyContent: 'flex-start' } }, icon('user', 'sm'), t('pos.walkInChoose')))));
  }

  async function pickCustomer() {
    const searchEl = input({ placeholder: t('pos.customerSearchPh'), autofocus: true });
    const list = h('div.stack.tight', { style: { maxHeight: '50vh', overflow: 'auto', marginTop: '8px' } });
    const addBtn = can('customers.create') ? h('button.btn', { type: 'button', onclick: () => { m.close(); quickAddCustomer(searchEl.value); } }, icon('plus', 'sm'), t('pos.newCustomer')) : null;
    const m = openModal({ title: t('pos.chooseCustomer'), body: [searchEl, list], footer: addBtn ? [addBtn] : null });
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      const rows = await call('customers.search', { q: searchEl.value });
      if (mine !== seq) return;
      list.replaceChildren(...rows.map((c) => h('button.menu-item', { type: 'button', onclick: () => { m.close(); setCustomer(c); } }, icon('user', 'sm'), h('span.grow', c.name), h('span.small.muted', [c.phone, c.balance ? t('pos.owes', { amount: fmt.money(c.balance) }) : null].filter(Boolean).join(' - ')))));
      if (!rows.length) list.append(h('p.small.faint', t('pos.noCustomer')));
    };
    searchEl.addEventListener('input', load);
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = list.querySelector('.menu-item'); if (first) first.click(); } });
    load();
  }

  function setCustomer(c) {
    cart.customer = c;
    // The customer's usual discount applies to lines without their own discount.
    if (c.discountBp) for (const l of cart.lines) if (!l.discount) l.discount = String(c.discountBp / 100);
    redraw();
    focusSearch();
  }

  function quickAddCustomer(name) {
    const form = new Form();
    const save = h('button.btn.primary', { type: 'button' }, t('common.create'));
    const m = openModal({ title: t('pos.newCustomer'), size: 'narrow', body: [form.errorBox, form.add('name', fieldText(input({ value: /\d/.test(name) ? '' : name, maxlength: 120, autofocus: true }), t('users.fullName'), { required: true })),
      form.add('phone', fieldText(input({ value: /\d/.test(name) ? name : '', maxlength: 40 }), t('users.phone')))], footer: [save] });
    save.onclick = () => busy(save, null, async () => {
      try { const c = await call('customers.create', form.values()); m.close(); setCustomer(c); } catch (err) { form.showError(err); }
    });
  }

  function overridePrice(i) {
    const l = cart.lines[i];
    const form = new Form();
    const el = moneyInput({ value: l.price !== '' ? l.price : rupees(l.unitPrice), autofocus: true });
    const instructions = input({ value: l.instructions || '', maxlength: 200, placeholder: t('pos.instructionsPh') });
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const reset = h('button.btn', { type: 'button' }, t('pos.listPrice'));
    const m = openModal({ title: l.label, size: 'narrow', body: [form.errorBox, form.add('price', fieldText(el, t('pos.pricePer', { unit: l.unitName }), { hint: can('price.override') ? null : t('pos.priceNeedsManager') })), form.add('instructions', fieldText(instructions, t('pos.instructions')))], footer: [reset, save] });
    reset.onclick = () => { l.price = ''; l.instructions = instructions.value; m.close(); redraw(); };
    save.onclick = () => { l.price = paisa(el.value) === l.unitPrice ? '' : el.value; l.instructions = instructions.value; m.close(); redraw(); focusSearch(); };
  }

  // ---- hold ----
  async function holdBill() {
    if (!cart.lines.length) return;
    const labelEl = input({ maxlength: 60, placeholder: t('pos.holdLabelPh'), autofocus: true });
    const save = h('button.btn.primary', { type: 'button' }, t('pos.hold'));
    const m = openModal({ title: t('pos.hold'), size: 'narrow', body: [fieldText(labelEl, t('pos.holdLabel')).el], footer: [save] });
    const go = async () => {
      try { await call('pos.hold', { cart: snapshot(), label: labelEl.value, total: estimate().total }); m.close(); toast(t('pos.held')); newBill(false); refreshHolds(); } catch (err) { toastError(err); }
    };
    save.onclick = go;
    labelEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function snapshot() {
    return { lines: cart.lines, customer: cart.customer, billDiscountType: cart.billDiscountType, billDiscount: cart.billDiscount, notes: cart.notes };
  }

  async function refreshHolds() {
    try {
      const holds = await call('pos.holds');
      holdsBtn.replaceChildren(...[icon('history', 'sm'), t('pos.holds'), holds.length ? h('span.badge.accent', String(holds.length)) : null, kbd('holds')].filter(Boolean));
      return holds;
    } catch (_) { return []; }
  }

  async function showHolds() {
    const holds = await refreshHolds();
    const m = openModal({
      title: t('pos.holds'), size: 'narrow',
      body: holds.length ? holds.map((x) => h('div.row', { style: { padding: '6px 0', borderBottom: '1px solid var(--border)' } },
        h('div.grow', h('div', x.label || t('pos.noLabel')), h('div.small.muted', `${x.items} ${t('pos.items').toLowerCase()} - ${fmt.money(x.total)} - ${fmt.time(x.createdAt)} - ${x.by || ''}`)),
        h('button.btn.sm', { type: 'button', onclick: async () => { await call('pos.dropHold', { id: x.id }); m.close(); refreshHolds(); } }, t('common.remove')),
        h('button.btn.primary.sm', { type: 'button', onclick: async () => {
          if (cart.lines.length && !(await confirm({ title: t('pos.replaceBill'), text: t('pos.replaceBillText'), confirmLabel: t('pos.resume') }))) return;
          try {
            const res = await call('pos.resume', { id: x.id });
            Object.assign(cart, { lines: res.cart.lines || [], customer: res.cart.customer || null, billDiscountType: res.cart.billDiscountType || 'percent', billDiscount: res.cart.billDiscount || '', notes: res.cart.notes || '', holdId: null, prescription: null });
            m.close();
            refreshHolds();
            redraw();
            toast(t('pos.resumedNote'));
          } catch (err) { toastError(err); }
        } }, t('pos.resume')))) : [h('p.muted', t('pos.noHolds'))],
    });
  }

  // ---- paying ----
  function pay() {
    if (!cart.lines.length) return;
    const est = estimate();
    const fields = {
      cash: moneyInput({ value: rupees(est.total), autofocus: true }),
      card: moneyInput(), easypaisa: moneyInput(), jazzcash: moneyInput(), bank: moneyInput(),
    };
    const refs = { card: input({ maxlength: 80, placeholder: t('pos.slipNo') }), easypaisa: input({ maxlength: 80, placeholder: t('pos.trxId') }), jazzcash: input({ maxlength: 80, placeholder: t('pos.trxId') }), bank: input({ maxlength: 80, placeholder: t('pos.trxId') }) };
    const status = h('div.pos-paystatus');
    const update = () => {
      const other = ['card', 'easypaisa', 'jazzcash', 'bank'].reduce((a, k) => a + paisa(fields[k].value), 0);
      const cash = paisa(fields.cash.value);
      const remaining = est.total - other - cash;
      if (remaining > 0) status.replaceChildren(h('span', cart.customer ? t('pos.onAccount') : t('pos.remaining')), h('strong', { style: { color: cart.customer ? 'var(--warning)' : 'var(--danger)' } }, fmt.money(remaining)));
      else status.replaceChildren(h('span', t('pos.change')), h('strong', { style: { color: 'var(--success)' } }, fmt.money(Math.max(-remaining, 0))));
      return { remaining };
    };
    for (const el of Object.values(fields)) el.addEventListener('input', update);
    const row = (key, labelText) => h('div.row', { style: { marginBottom: '8px' } }, h('span', { style: { width: '110px' } }, labelText), fields[key], refs[key] || h('span'));
    const finish = h('button.btn.primary', { type: 'button', style: { height: '44px', fontSize: '16px' } }, t('pos.finish'), h('span.kbd', 'Enter'));
    const form = new Form();
    const m = openModal({
      title: t('pos.payTitle', { total: fmt.money(est.total) }),
      body: [form.errorBox, row('cash', t('payMethod.cash')), row('card', t('payMethod.card')), row('easypaisa', 'Easypaisa'), row('jazzcash', 'JazzCash'), row('bank', t('payMethod.bank')), status,
        cart.customer ? h('p.small.muted', t('pos.creditNote', { name: cart.customer.name })) : h('p.small.muted', t('pos.walkInNote'))],
      footer: [finish],
    });
    update();
    fields.cash.select();
    m.modal.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.matches('textarea')) { e.preventDefault(); finish.click(); } });
    finish.onclick = () => busy(finish, null, async () => {
      form.clearErrors();
      const payload = {
        lines: cart.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, batchId: l.batchId, qty: l.qty, discount: l.discount, price: l.price, instructions: l.instructions })),
        customerId: cart.customer ? cart.customer.id : undefined, billDiscountType: cart.billDiscount ? cart.billDiscountType : undefined, billDiscount: cart.billDiscount,
        cashTendered: fields.cash.value, notes: cart.notes, prescription: cart.prescription || undefined,
        payments: ['card', 'easypaisa', 'jazzcash', 'bank'].filter((k) => paisa(fields[k].value) > 0).map((k) => ({ method: k, amount: fields[k].value, reference: refs[k].value })),
      };
      const result = await submit(payload, form);
      if (result) { m.close(); done(result); }
    });
  }

  // Sends the bill; asks for a manager or prescription details when the main process says they are needed.
  async function submit(payload, form, approvalToken) {
    try {
      return await call('pos.complete', { ...payload, approvalToken });
    } catch (err) {
      if (err.code === 'NEEDS_APPROVAL') {
        const token = await askApproval(err.message, err.details.needs, { kind: 'sale' });
        return token ? submit(payload, form, token) : null;
      }
      if (err.code === 'RX_NEEDED') {
        const rx = await askPrescription(err.message, err.details && err.details.controlled);
        if (!rx) return null;
        cart.prescription = rx;
        return submit({ ...payload, prescription: rx }, form, approvalToken);
      }
      form.showError(err.field && /^lines\./.test(err.field) ? { message: err.message } : err);
      return null;
    }
  }

  function askPrescription(message, controlled) {
    return new Promise((resolve) => {
      const form = new Form();
      const v = cart.prescription || {};
      const f = (key, labelText, opts = {}) => form.add(key, fieldText(input({ value: v[key] || (key === 'patientName' && cart.customer ? cart.customer.name : '') || '', maxlength: 120, type: opts.type || 'text' }), labelText, { required: opts.required }));
      const photo = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
      let photoData = v.photo || null;
      photo.addEventListener('change', () => {
        const file = photo.files[0];
        if (!file) return;
        if (file.size > 1000000) { toast(t('pos.photoTooBig'), { type: 'error' }); photo.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => { photoData = reader.result; };
        reader.readAsDataURL(file);
      });
      const ok = h('button.btn.primary', { type: 'button' }, t('common.save'));
      let result = null;
      const m = openModal({
        title: t('pos.rxTitle'), size: 'wide', onClose: () => resolve(result),
        body: [h('div.form-note', { style: { marginBottom: '12px' } }, icon('info', 'sm'), h('div', message)), form.errorBox,
          h('div.section-title', t('pos.patient')),
          h('div.form-grid', f('patientName', t('pos.patientName'), { required: true }), f('patientCnic', t('pos.cnic'), { required: controlled }), f('patientPhone', t('users.phone')), f('patientAddress', t('branches.address'))),
          h('div.section-title', { style: { marginTop: '12px' } }, t('pos.doctor')),
          h('div.form-grid', f('doctorName', t('pos.doctorName'), { required: true }), f('doctorPmdc', t('pos.pmdc'), { required: controlled }), f('doctorClinic', t('pos.clinic')),
            f('rxNumber', t('pos.rxNumber'), { required: controlled }), f('rxDate', t('pos.rxDate'), { type: 'date' }), h('div.field', h('label', t('pos.rxPhoto')), photo))],
        footer: [ok],
      });
      ok.onclick = () => { result = { ...form.values(), photo: photoData }; m.close(); };
    });
  }

  async function done(res) {
    lastSaleId = res.id;
    newBill(false);
    pushDisplay({ nets: [], total: res.total }, res.change, t('pos.thanks'));
    let printed = false;
    if (res.autoPrint) {
      try { await call('sales.print', { id: res.id }); printed = true; } catch (err) { toastError(err); }
    }
    const next = h('button.btn.primary', { type: 'button', autofocus: true, style: { height: '42px' } }, t('pos.nextBill'), h('span.kbd', 'Enter'));
    const m = openModal({
      title: t('pos.saleDone', { doc: res.docNo }),
      body: [h('div.pos-done', h('div.small.muted', t('pos.change')), h('div.pos-change', fmt.money(res.change)),
        h('div.small', t('pos.paidTotal', { paid: fmt.money(res.paid), total: fmt.money(res.total) })), res.credit ? h('div.small', { style: { color: 'var(--warning)' } }, t('pos.onAccountAmount', { amount: fmt.money(res.credit) })) : null,
        printed ? h('div.small.muted', t('pos.receiptPrinted')) : null)],
      footer: [h('button.btn', { type: 'button', onclick: () => call('sales.print', { id: res.id }).catch(toastError) }, icon('printer', 'sm'), t('pos.printReceipt')),
        h('button.btn', { type: 'button', onclick: () => { m.close(); labelsFor(res.id); } }, t('pos.medicineLabels')), next],
    });
    next.onclick = () => m.close();
    loadShift();
  }

  async function labelsFor(saleId) {
    const s = await call('sales.get', { id: saleId });
    const rows = s.lines.map((l) => ({ l, box: h('input', { type: 'checkbox', checked: true }), how: input({ value: l.instructions || '', maxlength: 200, placeholder: t('pos.instructionsPh') }) }));
    const ok = h('button.btn.primary', { type: 'button' }, icon('printer', 'sm'), t('labels.printNow'));
    const m = openModal({ title: t('pos.medicineLabels'), size: 'wide', body: rows.map((r) => h('div.row', { style: { marginBottom: '8px' } }, r.box, h('span', { style: { width: '220px' } }, r.l.productLabel), r.how)), footer: [ok] });
    ok.onclick = () => busy(ok, null, async () => {
      try { await call('sales.labels', { id: saleId, lines: rows.filter((r) => r.box.checked).map((r) => ({ lineId: r.l.id, instructions: r.how.value })) }); m.close(); } catch (err) { toastError(err); }
    });
  }

  function newBill(ask) {
    const clear = () => {
      Object.assign(cart, { lines: [], customer: null, billDiscountType: 'percent', billDiscount: '', notes: '', holdId: null, prescription: null });
      selected = -1;
      redraw();
      focusSearch();
    };
    if (ask && cart.lines.length) confirm({ title: t('pos.clearTitle'), text: t('pos.clearText'), confirmLabel: t('pos.clear'), danger: true }).then((ok) => ok && clear());
    else clear();
  }

  async function findBill() {
    const el = input({ placeholder: 'INV-...', autofocus: true });
    const ok = h('button.btn.primary', { type: 'button' }, t('common.search'));
    const form = new Form();
    const m = openModal({ title: t('pos.findBill'), size: 'narrow', body: [form.errorBox, form.add('docNo', fieldText(el, t('pos.billNo')))], footer: [ok] });
    const go = async () => { try { const s = await call('sales.findByNo', { docNo: el.value }); m.close(); navigate('sale', { id: s.id }); } catch (err) { form.showError({ message: err.message }); } };
    ok.onclick = go;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  async function receiveFromCustomer() {
    if (!cart.customer) { await pickCustomer(); return; }
    const c = await call('customers.get', { id: cart.customer.id });
    receivePaymentDialog(c, () => call('customers.get', { id: c.id }).then((x) => { cart.customer = x; redraw(); }));
  }

  let lastDisplay = '';
  function pushDisplay(est, change = 0, message = '') {
    if (!device.customerDisplay) return;
    const payload = { lines: cart.lines.map((l, i) => ({ name: l.label, qty: qtyText(l.qty, l.product), amount: est.nets[i] || 0 })), total: est.total, change, message };
    const key = JSON.stringify(payload);
    if (key === lastDisplay) return;
    lastDisplay = key;
    call('display.update', payload).catch(() => {});
  }

  function focusSearch() {
    setTimeout(() => { if (!document.querySelector('.backdrop')) picker.focus(); }, 0);
  }

  // ---- keyboard ----
  const actions = {
    search: () => picker.focus(),
    customer: () => pickCustomer(),
    qty: () => { const el = linesBody.children[selected] && linesBody.children[selected].querySelector('.pos-qty'); if (el) { el.focus(); el.select(); } },
    discount: () => { const el = document.getElementById('pos-bill-discount'); if (el) { el.focus(); el.select(); } },
    hold: () => holdBill(),
    holds: () => showHolds(),
    pay: () => pay(),
    remove: () => { if (selected >= 0 && cart.lines[selected]) { cart.lines.splice(selected, 1); selected = Math.min(selected, cart.lines.length - 1); redraw(); focusSearch(); } },
    newBill: () => newBill(true),
    reprint: () => { if (lastSaleId) call('sales.print', { id: lastSaleId, reprint: true }).catch(toastError); },
  };
  function onKey(e) {
    if (document.querySelector('.backdrop')) return;
    const id = actionFor(e, 'pos');
    const binding = id ? POS_KEYS.find((k) => `pos.${k.action}` === id) : null;
    if (!binding) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.matches('.pos-qty, body')) {
        selected = Math.max(0, Math.min(cart.lines.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
        markSelected();
      }
      return;
    }
    // Delete inside a text box edits the text, not the bill.
    if (binding.action === 'remove' && e.target.matches('input, textarea')) return;
    e.preventDefault();
    actions[binding.action]();
  }
  document.addEventListener('keydown', onKey);

  await loadShift();
  refreshHolds();
  redraw();
  focusSearch();
  return () => document.removeEventListener('keydown', onKey);
}

// Shared with the customer page: take money a customer owes.
export function receivePaymentDialog(c, onDone) {
  const form = new Form();
  const amt = moneyInput({ value: rupees(c.balance), autofocus: true });
  const method = h('select.input', ...['cash', 'card', 'easypaisa', 'jazzcash', 'bank'].map((m) => h('option', { value: m }, t(`payMethod.${m}`))));
  const ref = input({ maxlength: 80 });
  const save = h('button.btn.primary', { type: 'button' }, t('pos.receive'));
  const m = openModal({
    title: t('pos.receiveFrom', { name: c.name }), size: 'narrow',
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('pos.owesNow', { amount: fmt.money(c.balance) })), form.errorBox,
      form.add('amount', fieldText(amt, t('docs.amount'), { required: true })), form.add('method', fieldText(method, t('payments.method'))),
      form.add('reference', fieldText(ref, t('payments.reference'), { hint: t('payments.referenceHint') })), form.add('notes', fieldText(textarea({ rows: 2, maxlength: 300 }), t('products.notes')))],
    footer: [save],
  });
  save.onclick = () => busy(save, null, async () => {
    try {
      const r = await call('customers.receive', { customerId: c.id, ...form.values() });
      m.close();
      toast(t('pos.received', { doc: r.docNo, amount: fmt.money(r.amount) }));
      if (onDone) onDone(r);
    } catch (err) { form.showError(err); }
  });
}

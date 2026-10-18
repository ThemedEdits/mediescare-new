// Purchase orders and goods receipts (GRN): lists, editors and read-only views.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { confirm } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, qtyInput, qtyText, moneyInput, rupees, statusBadge, docHeader, kv, filterSelect, dateFilter, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

// Integer helpers matching the main process (round half up), used only for the on-screen estimate.
function mulRound(minor, num, den) {
  const p = minor * num;
  const q = Math.floor(Math.abs(p) / den);
  const r = Math.abs(p) % den;
  const v = r * 2 >= den ? q + 1 : q;
  return p < 0 ? -v : v;
}
function paisa(text) {
  const n = Number(String(text || '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

async function supplierOptions() {
  return (await call('suppliers.list', {})).map((s) => ({ value: s.id, label: s.name, sub: s.code }));
}

function docListPage({ page, navigate, method, source, title, sub, newHref, rowPath, columns, exportColumns, statuses, dateLabel }) {
  const f = { status: '', supplierId: '', from: '', to: '' };
  const add = can('purchases.create') && can('cost.view') && newHref ? h('a.btn.primary', { href: newHref }, icon('plus', 'sm'), t('common.create')) : null;
  page.append(h('div.page-head', h('div', h('h1', title), h('p.sub', sub)), h('div.row',
    exportButton({ source, title, perm: 'purchases.export', getParams: () => ({ ...f }), columns: exportColumns }), add)));
  const statusSel = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, ...statuses.map((s) => ({ value: s, label: t(`status.${s}`) }))], (v) => { f.status = v; reload(); });
  const supBox = combobox({ options: [], emptyLabel: `${t('suppliers.one')}: ${t('common.all')}`, onChange: (v) => { f.supplierId = v; reload(); } });
  supBox.style.width = '200px';
  supplierOptions().then((o) => supBox.setOptions(o)).catch(() => {});
  const from = dateFilter((v) => { f.from = v; reload(); }, t('common.from'));
  const to = dateFilter((v) => { f.to = v; reload(); }, t('common.to'));
  const table = dataTable({
    id: method, tools: [statusSel, supBox, h('span.small.muted', dateLabel), from, h('span.small.muted', t('common.to')), to], searchPlaceholder: t('purchases.searchPh'),
    columns, fetch: async (opts) => { try { return await call(method, { ...f, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (r) => navigate(rowPath, { id: r.id }),
    empty: { icon: 'truck', title: t('purchases.empty') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
}

// ---- purchase orders -----------------------------------------------------------------------------------------------

export async function renderPoList(page, { navigate }) {
  docListPage({
    page, navigate, method: 'purchases.listPo', source: 'purchases.listPo', title: t('po.title'), sub: t('po.sub'), newHref: '#/po?new=1', rowPath: 'po',
    statuses: ['draft', 'ordered', 'partial', 'received', 'cancelled'], dateLabel: t('po.orderDate'),
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (r) => h('span.mono', r.docNo) },
      { key: 'orderDate', label: t('po.orderDate'), sortable: false, render: (r) => fmt.date(r.orderDate) },
      { key: 'supplierName', label: t('suppliers.one'), sortable: false },
      { key: 'expectedDate', label: t('po.expected'), sortable: false, render: (r) => fmt.date(r.expectedDate) },
      { key: 'total', label: t('docs.total'), align: 'num', sortable: false, render: (r) => fmt.money(r.total) },
      { key: 'status', label: t('common.status'), sortable: false, render: (r) => statusBadge(r.status) },
    ],
    exportColumns: [{ key: 'docNo', label: 'Number' }, { key: 'orderDate', label: 'Order date' }, { key: 'supplierName', label: 'Supplier' }, { key: 'expectedDate', label: 'Expected' }, { key: 'status', label: 'Status' }, { key: 'total', label: 'Total', type: 'money', total: true }],
  });
}

export async function renderPo(page, { params, navigate }) {
  let po = null;
  if (params.id) { try { po = await call('purchases.getPo', { id: params.id }); } catch (err) { toastError(err); navigate('purchase-orders'); return; } }
  const editable = (!po || po.status === 'draft') && can('purchases.create') && can('cost.view');
  if (!editable) return poView(page, po, navigate);

  const form = new Form();
  const sup = combobox({ options: await supplierOptions(), value: po ? po.supplierId : params.supplierId || '' });
  const lines = [];
  const body = h('tbody');
  const total = h('strong');
  function recalc() {
    let sum = 0;
    for (const l of lines) { l.total = mulRound(paisa(l.price.value), l.q.getValue(), l.product.packSize); l.totalEl.textContent = fmt.money(l.total); sum += l.total; }
    total.textContent = fmt.money(sum);
  }
  function addLine(p, qty = 0, price = null) {
    const l = { product: p, q: qtyInput(p, { value: qty, onChange: recalc }), price: moneyInput({ value: rupees(price === null ? p.tradePrice : price), style: { width: '100px', textAlign: 'right' } }), totalEl: h('span') };
    l.price.addEventListener('input', recalc);
    l.row = h('tr', h('td', p.label, h('div.small.faint', t('po.onHand', { qty: p.onHandText || qtyText(p.onHand || 0, p) }))), h('td', l.q), h('td', l.price), h('td.num', l.totalEl),
      h('td', h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { lines.splice(lines.indexOf(l), 1); l.row.remove(); recalc(); } }, icon('x', 'sm'))));
    lines.push(l);
    body.append(l.row);
    recalc();
    l.q.focus();
  }
  if (po) for (const l of po.lines) addLine({ id: l.productId, label: l.productLabel, packSize: l.packSize, packUnit: l.packUnit, baseUnit: l.baseUnit, tradePrice: l.price, onHand: 0 }, l.qty, l.price);
  if (params.reorder) {
    try {
      const sugg = JSON.parse(sessionStorage.getItem('reorderLines') || '[]');
      sessionStorage.removeItem('reorderLines');
      for (const s of sugg) addLine({ id: s.productId, label: s.productLabel, packSize: s.packSize, packUnit: s.packUnit, baseUnit: s.baseUnit, tradePrice: s.lastPrice, onHandText: s.onHandText }, s.suggestedQty, s.lastPrice);
    } catch (_) { /* nothing to prefill */ }
  }
  const picker = productPicker({ onPick: (p) => addLine(p) });
  const save = (order) => async () => {
    form.clearErrors();
    try {
      const saved = await call('purchases.savePo', { id: po ? po.id : undefined, supplierId: sup.getValue(), orderDate: form.value('orderDate'), expectedDate: form.value('expectedDate'), notes: form.value('notes'),
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.q.getValue(), price: l.price.value })) });
      if (order) await call('purchases.setPoStatus', { id: saved.id, action: 'order' });
      toast(order ? t('po.ordered', { doc: saved.docNo }) : t('po.saved', { doc: saved.docNo }));
      navigate('po', { id: saved.id });
    } catch (err) { form.showError(err); }
  };
  const draftBtn = h('button.btn', { type: 'button' }, t('po.saveDraft'));
  const orderBtn = h('button.btn.primary', { type: 'button' }, t('po.markOrdered'));
  draftBtn.onclick = () => busy(draftBtn, null, save(false));
  orderBtn.onclick = () => busy(orderBtn, null, save(true));
  page.append(docHeader({ title: po ? `${t('po.one')} ${po.docNo}` : t('po.new'), status: po ? statusBadge(po.status) : null, back: { href: '#/purchase-orders', label: t('po.title') }, actions: [draftBtn, orderBtn] }));
  page.append(h('div.card', h('div.card-body.stack', form.errorBox, h('div.form-grid', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } },
    form.add('supplierId', fieldText(sup, t('suppliers.one'), { required: true })),
    form.add('orderDate', fieldText(input({ type: 'date', value: po ? po.orderDate : new Date().toLocaleDateString('en-CA') }), t('po.orderDate'))),
    form.add('expectedDate', fieldText(input({ type: 'date', value: po ? po.expectedDate || '' : '' }), t('po.expected'))),
    form.add('notes', fieldText(input({ value: po ? po.notes || '' : '', maxlength: 1000 }), t('products.notes')))))));
  page.append(h('div.card', h('div.card-body.stack',
    h('div.field', h('label', t('adjustments.addItem')), picker),
    h('table.data', h('thead', h('tr', h('th', t('products.name')), h('th', t('docs.qty')), h('th', t('po.pricePerPack')), h('th.num', t('docs.lineTotal')), h('th', ''))), body),
    h('div.row', h('span.spacer'), h('span', t('docs.total')), total))));
}

function poView(page, po, navigate) {
  const act = (action, needReason) => async () => {
    let reason = '';
    if (needReason) { reason = await confirm({ title: t(`po.${action}Title`), text: t(`po.${action}Text`), confirmLabel: t(`po.${action}`), danger: true, requireReason: true }); if (reason === false) return; }
    try { await call('purchases.setPoStatus', { id: po.id, action, reason }); navigate('po', { id: po.id }); } catch (err) { toastError(err); }
  };
  const open = ['ordered', 'partial'].includes(po.status);
  const actions = [
    can('purchases.edit') && ['draft', 'ordered'].includes(po.status) ? h('button.btn.danger', { type: 'button', onclick: act('cancel', true) }, t('po.cancel')) : null,
    can('purchases.edit') && po.status === 'partial' ? h('button.btn', { type: 'button', onclick: act('close', true) }, t('po.close')) : null,
    can('purchases.create') && can('cost.view') && open ? h('a.btn.primary', { href: `#/grn?new=1&poId=${po.id}` }, icon('download', 'sm'), t('po.receive')) : null,
  ];
  page.append(docHeader({ title: `${t('po.one')} ${po.docNo}`, status: statusBadge(po.status), back: { href: '#/purchase-orders', label: t('po.title') }, actions }));
  page.append(h('div.card', h('div.card-body', kv([[t('suppliers.one'), h('a', { href: `#/supplier?id=${po.supplierId}` }, po.supplierName)], [t('po.orderDate'), fmt.date(po.orderDate)], [t('po.expected'), fmt.date(po.expectedDate)],
    [t('docs.total'), fmt.money(po.total)], [t('products.notes'), po.notes], po.closedReason ? [t('common.reason'), po.closedReason] : null]))));
  page.append(h('div', { style: { marginTop: '16px' } }, dataTable({
    id: 'po-lines', searchable: false, rows: po.lines,
    columns: [
      { key: 'productLabel', label: t('products.name') }, { key: 'qtyText', label: t('po.ordered_'), align: 'num' },
      { key: 'receivedQty', label: t('po.received'), align: 'num', render: (l) => qtyText(l.receivedQty, l) }, { key: 'openQty', label: t('po.open'), align: 'num', render: (l) => qtyText(l.openQty, l) },
      { key: 'price', label: t('po.pricePerPack'), align: 'num', render: (l) => fmt.money(l.price) }, { key: 'lineTotal', label: t('docs.lineTotal'), align: 'num', render: (l) => fmt.money(l.lineTotal) },
    ],
  }).el));
}

// ---- goods receipts ------------------------------------------------------------------------------------------------

export async function renderGrnList(page, { navigate }) {
  docListPage({
    page, navigate, method: 'purchases.listGrn', source: 'purchases.listGrn', title: t('grn.title'), sub: t('grn.sub'), newHref: '#/grn?new=1', rowPath: 'grn',
    statuses: ['draft', 'posted', 'cancelled'], dateLabel: t('grn.receivedDate'),
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (r) => h('span.mono', r.docNo) },
      { key: 'receivedDate', label: t('grn.receivedDate'), sortable: false, render: (r) => fmt.date(r.receivedDate) },
      { key: 'supplierName', label: t('suppliers.one'), sortable: false },
      { key: 'invoiceNo', label: t('grn.invoiceNo'), sortable: false },
      { key: 'total', label: t('docs.total'), align: 'num', sortable: false, render: (r) => fmt.money(r.total) },
      { key: 'due', label: t('payments.due'), align: 'num', sortable: false, render: (r) => (r.due ? fmt.money(r.due) : '') },
      { key: 'status', label: t('common.status'), sortable: false, render: (r) => statusBadge(r.status) },
    ],
    exportColumns: [{ key: 'docNo', label: 'Number' }, { key: 'receivedDate', label: 'Received' }, { key: 'supplierName', label: 'Supplier' }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Gross', type: 'money', total: true }, { key: 'lineDiscount', label: 'Line discounts', type: 'money', total: true }, { key: 'docDiscount', label: 'Bill discount', type: 'money', total: true },
      { key: 'tax', label: 'Tax', type: 'money', total: true }, { key: 'freight', label: 'Freight', type: 'money', total: true }, { key: 'total', label: 'Total', type: 'money', total: true }, { key: 'due', label: 'Unpaid', type: 'money', total: true }],
  });
}

export async function renderGrn(page, { params, navigate }) {
  let grn = null;
  if (params.id) { try { grn = await call('purchases.getGrn', { id: params.id }); } catch (err) { toastError(err); navigate('grns'); return; } }
  const editable = (!grn || grn.status === 'draft') && can('purchases.create') && can('cost.view');
  if (!editable) return grnView(page, grn, navigate);

  let po = null;
  const poId = grn ? grn.poId : params.poId;
  if (poId) { try { po = await call('purchases.getPo', { id: poId }); } catch (err) { toastError(err); } }
  const form = new Form();
  const sup = combobox({ options: await supplierOptions(), value: grn ? grn.supplierId : po ? po.supplierId : '' });
  const lines = [];
  const body = h('tbody');
  const totalsEl = h('div.stack.tight', { style: { minWidth: '260px' } });
  const docDiscount = moneyInput({ value: grn ? rupees(grn.docDiscount) : '' });
  const freight = moneyInput({ value: grn ? rupees(grn.freight) : '' });

  function recalc() {
    let gross = 0; let disc = 0; let tax = 0; let net = 0;
    for (const l of lines) {
      const g = mulRound(paisa(l.price.value), l.q.getValue(), l.product.packSize);
      const d = mulRound(g, Math.round(Number(l.disc.value || 0) * 100), 10000);
      const tx = mulRound(g - d, Math.round(Number(l.tax.value || 0) * 100), 10000);
      l.totalEl.textContent = fmt.money(g - d + tx);
      gross += g; disc += d; tax += tx; net += g - d + tx;
    }
    const dd = Math.min(paisa(docDiscount.value), net);
    const fr = paisa(freight.value);
    const row = (label, v, strong) => h('div.row.between', h('span', label), strong ? h('strong', fmt.money(v)) : h('span', fmt.money(v)));
    totalsEl.replaceChildren(row(t('grn.gross'), gross), row(t('grn.lineDiscounts'), -disc), row(t('grn.tax'), tax), row(t('grn.billDiscount'), -dd), row(t('grn.freight'), fr), row(t('grn.payable'), net - dd + fr, true),
      h('p.small.faint', t('grn.estimateNote')));
  }
  for (const el of [docDiscount, freight]) el.addEventListener('input', recalc);

  function addLine(p, v = {}) {
    const small = { style: { width: '90px' } };
    const l = {
      product: p, poLineId: v.poLineId || null,
      batchNo: input({ value: v.batchNo || '', maxlength: 40, ...small, placeholder: t('stock.batch') }),
      expiry: input({ type: 'date', value: v.expiryDate || '', style: { width: '140px' } }),
      mfg: input({ type: 'date', value: v.mfgDate || '', style: { width: '140px' } }),
      q: qtyInput(p, { value: v.qty || 0, onChange: recalc }),
      bonus: qtyInput(p, { value: v.bonusQty || 0 }),
      price: moneyInput({ value: rupees(v.price !== undefined ? v.price : p.tradePrice), style: { width: '90px', textAlign: 'right' } }),
      disc: input({ type: 'number', min: 0, max: 100, step: '0.01', value: v.discountBp ? v.discountBp / 100 : '', style: { width: '64px' }, placeholder: '%' }),
      tax: input({ type: 'number', min: 0, max: 100, step: '0.01', value: v.taxBp ? v.taxBp / 100 : '', style: { width: '64px' }, placeholder: '%' }),
      mrp: moneyInput({ value: rupees(v.mrp !== undefined ? v.mrp : p.mrp), style: { width: '90px', textAlign: 'right' } }),
      totalEl: h('span'),
    };
    for (const el of [l.price, l.disc, l.tax]) el.addEventListener('input', recalc);
    l.row = h('tr',
      h('td', h('div.cell-main', p.label), l.poLineId ? h('div.small.faint', t('grn.fromOrder', { qty: v.openText || '' })) : null),
      h('td', l.batchNo), h('td', l.expiry, h('details', h('summary.small.faint', t('stock.mfg')), l.mfg)), h('td', l.q), h('td', l.bonus), h('td', l.price), h('td', l.disc), h('td', l.tax), h('td', l.mrp), h('td.num', l.totalEl),
      h('td', h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { lines.splice(lines.indexOf(l), 1); l.row.remove(); recalc(); } }, icon('x', 'sm'))));
    lines.push(l);
    body.append(l.row);
    recalc();
    if (!v.batchNo) l.batchNo.focus();
  }
  if (grn) for (const l of grn.lines) addLine({ id: l.productId, label: l.productLabel, packSize: l.packSize, packUnit: l.packUnit, baseUnit: l.baseUnit, tradePrice: l.price, mrp: l.mrp }, l);
  else if (po) {
    for (const l of po.lines.filter((x) => x.openQty > 0)) {
      const prod = await call('products.get', { id: l.productId });
      addLine({ ...prod }, { poLineId: l.id, qty: l.openQty, price: l.price, mrp: prod.mrp, openText: qtyText(l.openQty, l) });
    }
  }
  const picker = productPicker({ onPick: async (p) => addLine(p) });

  const save = (post) => async () => {
    form.clearErrors();
    const payload = {
      id: grn ? grn.id : undefined, supplierId: sup.getValue(), poId: poId || undefined, invoiceNo: form.value('invoiceNo'), invoiceDate: form.value('invoiceDate'),
      receivedDate: form.value('receivedDate'), dueDate: form.value('dueDate'), docDiscount: docDiscount.value, freight: freight.value, notes: form.value('notes'), post,
      lines: lines.map((l) => ({ productId: l.product.id, poLineId: l.poLineId, batchNo: l.batchNo.value, expiryDate: l.expiry.value, mfgDate: l.mfg.value, qty: l.q.getValue(), bonusQty: l.bonus.getValue(), price: l.price.value, discount: l.disc.value, tax: l.tax.value, mrp: l.mrp.value })),
    };
    if (post) {
      const ok = await confirm({ title: t('grn.postTitle'), text: t('grn.postText', { n: lines.length }), confirmLabel: t('grn.post') });
      if (!ok) return;
    }
    try {
      const saved = await call('purchases.saveGrn', payload);
      toast(post ? t('grn.posted', { doc: saved.docNo }) : t('po.saved', { doc: saved.docNo }));
      navigate('grn', { id: saved.id });
    } catch (err) {
      const m = /^lines\.(\d+)\./.exec(err.field || '');
      if (m && lines[Number(m[1])]) lines[Number(m[1])].row.style.outline = '2px solid var(--danger)';
      form.showError({ message: err.message });
    }
  };
  const draftBtn = h('button.btn', { type: 'button' }, t('po.saveDraft'));
  const postBtn = h('button.btn.primary', { type: 'button' }, icon('check', 'sm'), t('grn.post'));
  draftBtn.onclick = () => busy(draftBtn, null, save(false));
  postBtn.onclick = () => busy(postBtn, null, save(true));
  page.append(docHeader({ title: grn ? `${t('grn.one')} ${grn.docNo}` : t('grn.new'), status: grn ? statusBadge(grn.status) : null, sub: po ? t('grn.againstOrder', { doc: po.docNo }) : null, back: { href: '#/grns', label: t('grn.title') }, actions: [draftBtn, postBtn] }));
  page.append(h('div.card', h('div.card-body.stack', form.errorBox, h('div.form-grid', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } },
    form.add('supplierId', fieldText(sup, t('suppliers.one'), { required: true })),
    form.add('invoiceNo', fieldText(input({ value: grn ? grn.invoiceNo || '' : '', maxlength: 60 }), t('grn.invoiceNo'))),
    form.add('invoiceDate', fieldText(input({ type: 'date', value: grn ? grn.invoiceDate || '' : '' }), t('grn.invoiceDate'))),
    form.add('receivedDate', fieldText(input({ type: 'date', value: grn ? grn.receivedDate : new Date().toLocaleDateString('en-CA') }), t('grn.receivedDate'))),
    form.add('dueDate', fieldText(input({ type: 'date', value: grn ? grn.dueDate || '' : '' }), t('grn.dueDate'), { hint: t('grn.dueHint') })),
    form.add('notes', fieldText(input({ value: grn ? grn.notes || '' : '', maxlength: 1000 }), t('products.notes'), { span2: true }))))));
  page.append(h('div.card', h('div.card-body.stack',
    h('div.field', h('label', t('adjustments.addItem')), picker),
    h('div.table-scroll', h('table.data', h('thead', h('tr', ...[t('products.name'), t('stock.batch'), t('stock.expiry'), t('docs.qty'), t('grn.bonus'), t('grn.tradePrice'), t('grn.discPct'), t('grn.taxPct'), t('products.mrp'), t('docs.lineTotal'), ''].map((x) => h('th', x)))), body)),
    h('div.row', { style: { alignItems: 'flex-start' } }, h('div.form-grid', { style: { flex: 1 } },
      fieldText(docDiscount, t('grn.billDiscount')).el, fieldText(freight, t('grn.freight')).el), totalsEl))));
  recalc();
}

function grnView(page, g, navigate) {
  const actions = [];
  if (g.status === 'posted' && can('purchases.approve')) {
    actions.push(h('button.btn.danger', { type: 'button', onclick: async () => {
      const reason = await confirm({ title: t('grn.cancelTitle', { doc: g.docNo }), text: t('grn.cancelText'), confirmLabel: t('grn.cancel'), danger: true, requireReason: true });
      if (reason === false) return;
      try { await call('purchases.cancelGrn', { id: g.id, reason }); navigate('grn', { id: g.id }); } catch (err) { toastError(err); }
    } }, t('grn.cancel')));
  }
  if (g.status === 'posted' && can('purchases.create') && can('cost.view')) actions.push(h('a.btn', { href: `#/purchase-returns?new=1&grnId=${g.id}&supplierId=${g.supplierId}` }, t('grn.returnItems')));
  if (g.status === 'posted' && g.due > 0 && can('supplier_payments.create')) actions.push(h('a.btn.primary', { href: `#/payments?new=1&supplierId=${g.supplierId}&grnId=${g.id}` }, icon('wallet', 'sm'), t('payments.add')));
  page.append(docHeader({ title: `${t('grn.one')} ${g.docNo}`, status: statusBadge(g.status), back: { href: '#/grns', label: t('grn.title') }, actions }));
  page.append(h('div.grid-2', { style: { alignItems: 'start' } },
    h('div.card', h('div.card-body', kv([
      [t('suppliers.one'), h('a', { href: `#/supplier?id=${g.supplierId}` }, g.supplierName)], g.poNo ? [t('po.one'), h('a', { href: `#/po?id=${g.poId}` }, g.poNo)] : null,
      [t('grn.invoiceNo'), g.invoiceNo], [t('grn.invoiceDate'), fmt.date(g.invoiceDate)], [t('grn.receivedDate'), fmt.date(g.receivedDate)], [t('grn.dueDate'), fmt.date(g.dueDate)],
      [t('products.notes'), g.notes], g.cancelReason ? [t('common.reason'), g.cancelReason] : null,
    ]))),
    h('div.card', h('div.card-body', kv([
      [t('grn.gross'), fmt.money(g.subtotal)], [t('grn.lineDiscounts'), fmt.money(g.lineDiscount)], [t('grn.tax'), fmt.money(g.tax)], [t('grn.billDiscount'), fmt.money(g.docDiscount)],
      [t('grn.freight'), fmt.money(g.freight)], [t('grn.payable'), h('strong', fmt.money(g.total))],
      g.paid !== undefined ? [t('payments.paid'), fmt.money(g.paid)] : null, g.due !== undefined ? [t('payments.due'), h('strong', fmt.money(g.due))] : null,
    ])))));
  page.append(h('div', { style: { marginTop: '16px' } }, dataTable({
    id: 'grn-lines', searchable: false, rows: g.lines,
    columns: [
      { key: 'productLabel', label: t('products.name') }, { key: 'batchNo', label: t('stock.batch'), render: (l) => (l.batchId ? h('a.mono', { href: `#/movements?batchId=${l.batchId}&label=${encodeURIComponent(l.productLabel + ' ' + l.batchNo)}` }, l.batchNo) : h('span.mono', l.batchNo)) },
      { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) }, { key: 'qtyText', label: t('docs.qty'), align: 'num' }, { key: 'bonusText', label: t('grn.bonus'), align: 'num' },
      { key: 'price', label: t('grn.tradePrice'), align: 'num', render: (l) => fmt.money(l.price) }, { key: 'discount', label: t('grn.discount'), align: 'num', render: (l) => fmt.money(l.discount) },
      { key: 'tax', label: t('grn.tax'), align: 'num', render: (l) => fmt.money(l.tax) }, { key: 'mrp', label: t('products.mrp'), align: 'num', render: (l) => fmt.money(l.mrp) },
      { key: 'lineTotal', label: t('docs.lineTotal'), align: 'num', render: (l) => fmt.money(l.lineTotal) }, { key: 'unitCost', label: t('grn.netCost'), align: 'num', render: (l) => fmt.money(l.unitCost) },
    ],
  }).el));
}

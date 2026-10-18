// Returns to suppliers and supplier payments.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, batchSelect, qtyInput, moneyInput, rupees, statusBadge, docHeader, kv, filterSelect, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

async function supplierBox(value, onChange) {
  const opts = (await call('suppliers.list', { includeInactive: true })).map((s) => ({ value: s.id, label: s.name, sub: s.code }));
  return combobox({ options: opts, value: value || '', onChange });
}

function simpleList(page, navigate, { method, source, title, sub, columns, exportColumns, rowPath, addButton, statuses }) {
  const f = { status: '' };
  page.append(h('div.page-head', h('div', h('h1', title), h('p.sub', sub)), h('div.row', exportButton({ source, title, perm: 'purchases.export', getParams: () => ({ ...f }), columns: exportColumns }), addButton)));
  const statusSel = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, ...statuses.map((s) => ({ value: s, label: t(`status.${s}`) }))], (v) => { f.status = v; table.resetPage(); table.refresh(); });
  const table = dataTable({
    id: method, tools: [statusSel], columns, searchPlaceholder: t('purchases.searchPh'),
    fetch: async (opts) => { try { return await call(method, { ...f, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (r) => navigate(rowPath, { id: r.id }),
    empty: { icon: 'truck', title: t('purchases.empty') },
  });
  page.append(table.el);
}

// ---- purchase returns ----------------------------------------------------------------------------------------------

export async function renderReturns(page, { params, navigate }) {
  if (params.new) return returnForm(page, params, navigate);
  simpleList(page, navigate, {
    method: 'purchases.listReturns', source: 'purchases.listReturns', title: t('returns.title'), sub: t('returns.sub'), rowPath: 'purchase-return', statuses: ['posted', 'cancelled'],
    addButton: can('purchases.create') && can('cost.view') ? h('a.btn.primary', { href: '#/purchase-returns?new=1' }, icon('plus', 'sm'), t('returns.add')) : null,
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (r) => h('span.mono', r.docNo) },
      { key: 'returnDate', label: t('docs.date'), sortable: false, render: (r) => fmt.date(r.returnDate) },
      { key: 'supplierName', label: t('suppliers.one'), sortable: false },
      { key: 'reasonType', label: t('common.reason'), sortable: false, render: (r) => t(`returnReason.${r.reasonType}`) },
      { key: 'total', label: t('docs.total'), align: 'num', sortable: false, render: (r) => fmt.money(r.total) },
      { key: 'status', label: t('common.status'), sortable: false, render: (r) => statusBadge(r.status) },
    ],
    exportColumns: [{ key: 'docNo', label: 'Number' }, { key: 'returnDate', label: 'Date' }, { key: 'supplierName', label: 'Supplier' }, { key: 'reasonType', label: 'Reason' }, { key: 'status', label: 'Status' }, { key: 'total', label: 'Total', type: 'money', total: true }],
  });
  return undefined;
}

async function returnForm(page, params, navigate) {
  const form = new Form();
  let supplierId = params.supplierId || '';
  const lines = [];
  const body = h('tbody');
  const totalEl = h('strong');
  const recalc = () => {
    let sum = 0;
    for (const l of lines) {
      const p = Math.round(Number(String(l.price.value).replace(/,/g, '')) * 100) || 0;
      const q = l.q.getValue();
      const v = Math.round((p * q) / (l.product.packSize || 1));
      l.amountEl.textContent = fmt.money(v);
      sum += v;
    }
    totalEl.textContent = fmt.money(sum);
  };
  async function addLine(p, presetBatchId) {
    const sel = await batchSelect(p.id, { includeExpired: true, status: 'in_stock', value: presetBatchId || '' });
    const l = { product: p, sel, q: qtyInput(p, { onChange: recalc }), price: moneyInput({ style: { width: '100px', textAlign: 'right' } }), amountEl: h('span') };
    const setPrice = () => { const b = sel.batches.find((x) => x.batchId === sel.value); if (b) { l.price.value = rupees(b.cost); if (!l.q.getValue()) l.q.setValue(b.onHand); } recalc(); };
    sel.addEventListener('change', setPrice);
    l.price.addEventListener('input', recalc);
    l.row = h('tr', h('td', p.label), h('td', sel), h('td', l.q), h('td', l.price), h('td.num', l.amountEl),
      h('td', h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { lines.splice(lines.indexOf(l), 1); l.row.remove(); recalc(); } }, icon('x', 'sm'))));
    lines.push(l);
    body.append(l.row);
    if (presetBatchId) setPrice();
  }
  const sup = await supplierBox(supplierId, (v) => { supplierId = v; });
  const reason = select(['expired', 'near_expiry', 'damaged', 'wrong_item', 'other'].map((r) => ({ value: r, label: t(`returnReason.${r}`) })));
  const picker = productPicker({ onPick: (p) => addLine(p) });
  const save = h('button.btn.primary', { type: 'button' }, t('returns.save'));
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    const ok = await confirm({ title: t('returns.confirmTitle'), text: t('returns.confirmText'), confirmLabel: t('returns.save') });
    if (!ok) return;
    try {
      const r = await call('purchases.createReturn', {
        supplierId: sup.getValue(), grnId: params.grnId || undefined, reasonType: reason.value, returnDate: form.value('returnDate'), notes: form.value('notes'),
        lines: lines.map((l) => ({ batchId: l.sel.value, qty: l.q.getValue(), price: l.price.value })),
      });
      toast(t('returns.saved', { doc: r.docNo }));
      navigate('purchase-return', { id: r.id });
    } catch (err) { form.showError({ message: err.message, field: err.field && !err.field.startsWith('lines') ? err.field : null }); }
  });
  page.append(docHeader({ title: t('returns.add'), back: { href: '#/purchase-returns', label: t('returns.title') }, actions: [save] }));
  page.append(h('div.card', h('div.card-body.stack', form.errorBox, h('div.form-grid', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } },
    form.add('supplierId', fieldText(sup, t('suppliers.one'), { required: true })), form.add('reasonType', fieldText(reason, t('common.reason'), { required: true })),
    form.add('returnDate', fieldText(input({ type: 'date', value: new Date().toLocaleDateString('en-CA') }), t('docs.date'))),
    form.add('notes', fieldText(input({ maxlength: 1000 }), t('products.notes')))))));
  page.append(h('div.card', h('div.card-body.stack', h('div.field', h('label', t('adjustments.addItem')), picker),
    h('table.data', h('thead', h('tr', ...[t('products.name'), t('stock.batch'), t('docs.qty'), t('returns.pricePerPack'), t('docs.amount'), ''].map((x) => h('th', x)))), body),
    h('div.row', h('span.spacer'), h('span', t('docs.total')), totalEl), h('p.small.muted', t('returns.note')))));
  // Pre-fill from a goods receipt or a batch.
  if (params.grnId) {
    try {
      const g = await call('purchases.getGrn', { id: params.grnId });
      for (const l of g.lines) if (l.batchId) await addLine({ id: l.productId, label: l.productLabel, packSize: l.packSize, packUnit: l.packUnit, baseUnit: l.baseUnit }, l.batchId);
    } catch (err) { toastError(err); }
  }
  if (params.batchId) {
    try {
      const b = (await call('stock.batches', { status: 'all', pageSize: 1000 })).rows.find((x) => x.batchId === params.batchId);
      if (b) await addLine({ id: b.productId, label: b.productLabel, packSize: b.packSize, packUnit: b.packUnit, baseUnit: b.baseUnit }, b.batchId);
    } catch (err) { toastError(err); }
  }
  recalc();
  return undefined;
}

export async function renderReturn(page, { params, navigate }) {
  let r;
  try { r = await call('purchases.getReturn', { id: params.id }); } catch (err) { toastError(err); navigate('purchase-returns'); return; }
  const actions = r.status === 'posted' && can('purchases.approve') ? [h('button.btn.danger', { type: 'button', onclick: async () => {
    const reason = await confirm({ title: t('returns.cancelTitle'), text: t('returns.cancelText'), confirmLabel: t('returns.cancel'), danger: true, requireReason: true });
    if (reason === false) return;
    try { await call('purchases.cancelReturn', { id: r.id, reason }); navigate('purchase-return', { id: r.id }); } catch (err) { toastError(err); }
  } }, t('returns.cancel'))] : [];
  page.append(docHeader({ title: `${t('returns.one')} ${r.docNo}`, status: statusBadge(r.status), back: { href: '#/purchase-returns', label: t('returns.title') }, actions }));
  page.append(h('div.card', h('div.card-body', kv([[t('suppliers.one'), h('a', { href: `#/supplier?id=${r.supplierId}` }, r.supplierName)], r.grnNo ? [t('grn.one'), h('a', { href: `#/grn?id=${r.grnId}` }, r.grnNo)] : null,
    [t('docs.date'), fmt.date(r.returnDate)], [t('common.reason'), t(`returnReason.${r.reasonType}`)], [t('products.notes'), r.notes], [t('docs.total'), fmt.money(r.total)], r.cancelReason ? [t('returns.cancelReason'), r.cancelReason] : null]))));
  page.append(h('div', { style: { marginTop: '16px' } }, dataTable({
    id: 'return-lines', searchable: false, rows: r.lines,
    columns: [{ key: 'productLabel', label: t('products.name') }, { key: 'batchNo', label: t('stock.batch') }, { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) },
      { key: 'qtyText', label: t('docs.qty'), align: 'num' }, { key: 'price', label: t('returns.pricePerPack'), align: 'num', render: (l) => fmt.money(l.price) }, { key: 'amount', label: t('docs.amount'), align: 'num', render: (l) => fmt.money(l.amount) }],
  }).el));
}

// ---- supplier payments ---------------------------------------------------------------------------------------------

export async function renderPayments(page, { params, navigate }) {
  if (params.new) return paymentForm(page, params, navigate);
  simpleList(page, navigate, {
    method: 'payments.list', source: 'payments.list', title: t('payments.title'), sub: t('payments.sub'), rowPath: 'payment', statuses: ['posted', 'cancelled'],
    addButton: can('supplier_payments.create') && can('cost.view') ? h('a.btn.primary', { href: '#/payments?new=1' }, icon('plus', 'sm'), t('payments.add')) : null,
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (r) => h('span.mono', r.docNo) },
      { key: 'paidDate', label: t('docs.date'), sortable: false, render: (r) => fmt.date(r.paidDate) },
      { key: 'supplierName', label: t('suppliers.one'), sortable: false },
      { key: 'method', label: t('payments.method'), sortable: false, render: (r) => t(`payMethod.${r.method}`) },
      { key: 'reference', label: t('payments.reference'), sortable: false },
      { key: 'amount', label: t('docs.amount'), align: 'num', sortable: false, render: (r) => fmt.money(r.amount) },
      { key: 'status', label: t('common.status'), sortable: false, render: (r) => statusBadge(r.status) },
    ],
    exportColumns: [{ key: 'docNo', label: 'Number' }, { key: 'paidDate', label: 'Date' }, { key: 'supplierName', label: 'Supplier' }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', type: 'money', total: true }],
  });
  return undefined;
}

async function paymentForm(page, params, navigate) {
  const form = new Form();
  const billsBox = h('div');
  let bills = [];
  const allocInputs = new Map();
  const amount = moneyInput({ autofocus: true });
  const allocatedEl = h('strong');
  const recalc = () => {
    let sum = 0;
    for (const el of allocInputs.values()) sum += Math.round(Number(String(el.value || '0').replace(/,/g, '')) * 100) || 0;
    allocatedEl.textContent = fmt.money(sum);
  };
  async function loadBills(id) {
    allocInputs.clear();
    if (!id) { mount(billsBox, h('p.small.faint', t('payments.chooseSupplier'))); return; }
    bills = await call('suppliers.openBills', { id });
    if (!bills.length) { mount(billsBox, h('p.small.muted', t('payments.noOpenBills'))); return; }
    const rows = bills.map((b) => {
      const el = moneyInput({ value: params.grnId === b.id ? rupees(b.due) : '', style: { width: '120px', textAlign: 'right' } });
      el.addEventListener('input', recalc);
      allocInputs.set(b.id, el);
      return h('tr', h('td.mono', b.docNo), h('td', b.invoiceNo || ''), h('td', fmt.date(b.dueDate)), h('td.num', fmt.money(b.due)), h('td', el));
    });
    const fillOldest = h('button.btn.sm', { type: 'button', onclick: () => {
      let left = Math.round(Number(String(amount.value || '0').replace(/,/g, '')) * 100) || 0;
      for (const b of bills) { const take = Math.min(left, b.due); allocInputs.get(b.id).value = take ? rupees(take) : ''; left -= take; }
      recalc();
    } }, t('payments.fillOldest'));
    mount(billsBox, h('div.stack.tight', h('div.row.between', h('h3', t('payments.allocate')), fillOldest),
      h('table.data', h('thead', h('tr', h('th', t('grn.one')), h('th', t('grn.invoiceNo')), h('th', t('grn.dueDate')), h('th.num', t('payments.due')), h('th', t('payments.payNow')))), h('tbody', ...rows)),
      h('div.row', h('span.spacer'), h('span', t('payments.allocated')), allocatedEl), h('p.small.muted', t('payments.allocateNote'))));
    recalc();
  }
  const sup = await supplierBox(params.supplierId, (v) => loadBills(v).catch(toastError));
  const method = select(['cash', 'bank', 'cheque', 'online'].map((m) => ({ value: m, label: t(`payMethod.${m}`) })));
  const save = h('button.btn.primary', { type: 'button' }, t('payments.save'));
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      const p = await call('payments.create', {
        supplierId: sup.getValue(), amount: amount.value, method: method.value, reference: form.value('reference'), paidDate: form.value('paidDate'), notes: form.value('notes'),
        allocations: [...allocInputs.entries()].filter(([, el]) => el.value.trim()).map(([grnId, el]) => ({ grnId, amount: el.value })),
      });
      toast(t('payments.saved', { doc: p.docNo }));
      navigate('payment', { id: p.id });
    } catch (err) { form.showError(err.field && err.field.startsWith('allocations') ? { message: err.message } : err); }
  });
  page.append(docHeader({ title: t('payments.add'), back: { href: '#/payments', label: t('payments.title') }, actions: [save] }));
  page.append(h('div.card', h('div.card-body.stack', form.errorBox, h('div.form-grid', { style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
    form.add('supplierId', fieldText(sup, t('suppliers.one'), { required: true })), form.add('amount', fieldText(amount, t('docs.amount'), { required: true })),
    form.add('method', fieldText(method, t('payments.method'), { required: true })), form.add('reference', fieldText(input({ maxlength: 80 }), t('payments.reference'), { hint: t('payments.referenceHint') })),
    form.add('paidDate', fieldText(input({ type: 'date', value: new Date().toLocaleDateString('en-CA'), readonly: !can('payments.edit_date') }), t('docs.date'), { hint: can('payments.edit_date') ? null : t('payments.dateLocked') })),
    form.add('notes', fieldText(input({ maxlength: 500 }), t('products.notes')))), billsBox)));
  await loadBills(params.supplierId);
  return undefined;
}

export async function renderPayment(page, { params, navigate }) {
  let p;
  try { p = await call('payments.get', { id: params.id }); } catch (err) { toastError(err); navigate('payments'); return; }
  const actions = p.status === 'posted' && can('supplier_payments.approve') ? [h('button.btn.danger', { type: 'button', onclick: async () => {
    const reason = await confirm({ title: t('payments.cancelTitle'), text: t('payments.cancelText'), confirmLabel: t('payments.cancel'), danger: true, requireReason: true });
    if (reason === false) return;
    try { await call('payments.cancel', { id: p.id, reason }); navigate('payment', { id: p.id }); } catch (err) { toastError(err); }
  } }, t('payments.cancel'))] : [];
  page.append(docHeader({ title: `${t('payments.one')} ${p.docNo}`, status: statusBadge(p.status), back: { href: '#/payments', label: t('payments.title') }, actions }));
  page.append(h('div.card', h('div.card-body', kv([[t('suppliers.one'), h('a', { href: `#/supplier?id=${p.supplierId}&tab=account` }, p.supplierName)], [t('docs.date'), fmt.date(p.paidDate)],
    [t('docs.amount'), h('strong', fmt.money(p.amount))], [t('payments.method'), t(`payMethod.${p.method}`)], [t('payments.reference'), p.reference], [t('products.notes'), p.notes],
    [t('payments.allocatedTo'), p.allocations.length ? h('div', ...p.allocations.map((a) => h('div', h('a.mono', { href: `#/grn?id=${a.grnId}` }, a.docNo), ` ${fmt.money(a.amount)}`))) : t('payments.unallocated')],
    p.cancelReason ? [t('returns.cancelReason'), p.cancelReason] : null]))));
}

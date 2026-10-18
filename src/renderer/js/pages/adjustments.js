// Stock adjustments: opening stock, increases, decreases, damaged, lost, expired write-off; approval above the limit.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, batchSelect, qtyInput, moneyInput, rupees, statusBadge, docHeader, kv, filterSelect, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

const KINDS = ['opening', 'increase', 'decrease', 'damaged', 'lost', 'expired'];
const ADDS = ['opening', 'increase'];

export async function render(page, { params, navigate }) {
  const filter = { status: params.status || '', kind: '' };
  const add = can('stock.create') ? h('button.btn.primary', { type: 'button', onclick: () => openAdjustment({ onDone: (a) => navigate('adjustment', { id: a.id }) }) }, icon('plus', 'sm'), t('adjustments.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('adjustments.title')), h('p.sub', t('adjustments.sub'))), h('div.row',
    exportButton({ source: 'adjustments.list', title: t('adjustments.title'), perm: 'stock.export', getParams: () => ({ ...filter }), columns: [
      { key: 'docNo', label: 'Number' }, { key: 'createdAt', label: 'Date', type: 'datetime' }, { key: 'kindLabel', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' }, { key: 'totalValue', label: 'Value', type: 'money', total: true }, { key: 'requestedBy', label: 'Requested by' }, { key: 'decidedBy', label: 'Approved by' },
    ] }), add)));
  const statusSel = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, { value: 'pending', label: t('status.pending') }, { value: 'posted', label: t('status.posted') }, { value: 'rejected', label: t('status.rejected') }], (v) => { filter.status = v; reload(); }, { value: filter.status });
  const kindSel = filterSelect([{ value: '', label: `${t('adjustments.kind')}: ${t('common.all')}` }, ...KINDS.map((k) => ({ value: k, label: t(`adjKind.${k}`) }))], (v) => { filter.kind = v; reload(); });
  const table = dataTable({
    id: 'adjustments', tools: [statusSel, kindSel], searchPlaceholder: t('adjustments.searchPh'),
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (a) => h('span.mono', a.docNo) },
      { key: 'createdAt', label: t('docs.date'), sortable: false, render: (a) => fmt.dateTime(a.createdAt) },
      { key: 'kindLabel', label: t('adjustments.kind'), sortable: false },
      { key: 'reason', label: t('common.reason'), sortable: false },
      { key: 'totalValue', label: t('stock.value'), align: 'num', sortable: false, hidden: !can('cost.view'), render: (a) => fmt.money(a.totalValue) },
      { key: 'requestedBy', label: t('adjustments.by'), sortable: false },
      { key: 'status', label: t('common.status'), sortable: false, render: (a) => statusBadge(a.status) },
    ],
    fetch: async (opts) => { try { return await call('adjustments.list', { ...filter, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (a) => navigate('adjustment', { id: a.id }),
    empty: { icon: 'clipboard', title: t('adjustments.empty') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
}

export async function renderDetail(page, { params, navigate }) {
  let a;
  try { a = await call('adjustments.get', { id: params.id }); } catch (err) { toastError(err); navigate('adjustments'); return; }
  const mine = a.requestedById === state.me.user.id;
  const decide = (approve) => async () => {
    const reason = await confirm({ title: approve ? t('adjustments.approveTitle', { doc: a.docNo }) : t('adjustments.rejectTitle', { doc: a.docNo }), text: approve ? t('adjustments.approveText') : t('adjustments.rejectText'), confirmLabel: approve ? t('approvals.approve') : t('approvals.reject'), danger: !approve, requireReason: true, reasonOptional: approve });
    if (reason === false) return;
    try { await call('adjustments.decide', { id: a.id, approve, reason }); toast(t('common.saved')); navigate('adjustment', { id: a.id }); } catch (err) { toastError(err); }
  };
  const actions = a.status === 'pending' && can('stock.approve') && !mine
    ? [h('button.btn.danger', { type: 'button', onclick: decide(false) }, t('approvals.reject')), h('button.btn.primary', { type: 'button', onclick: decide(true) }, icon('check', 'sm'), t('approvals.approve'))]
    : [];
  page.append(docHeader({ title: `${a.kindLabel} ${a.docNo}`, status: statusBadge(a.status), back: { href: '#/adjustments', label: t('adjustments.title') }, actions }));
  if (a.status === 'pending') page.append(h('div.form-note', { style: { marginBottom: '16px' } }, icon('info', 'sm'), h('div', mine ? t('adjustments.waitingYou') : t('adjustments.waiting'))));
  page.append(h('div.card', h('div.card-body', kv([
    [t('docs.date'), fmt.dateTime(a.createdAt)], [t('common.reason'), a.reason], [t('adjustments.by'), a.requestedBy],
    a.decidedBy ? [t('adjustments.decidedBy'), `${a.decidedBy}, ${fmt.dateTime(a.decidedAt)}`] : null, a.decisionReason ? [t('adjustments.decisionReason'), a.decisionReason] : null,
    can('cost.view') ? [t('stock.value'), fmt.money(a.totalValue)] : null,
  ]))));
  page.append(h('div', { style: { marginTop: '16px' } }, dataTable({
    id: 'adjustment-lines', searchable: false, rows: a.lines,
    columns: [
      { key: 'productLabel', label: t('products.name') }, { key: 'batchNo', label: t('stock.batch'), render: (l) => h('span.mono', l.batchNo) },
      { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) }, { key: 'qtyText', label: t('docs.qty'), align: 'num' },
      { key: 'value', label: t('stock.value'), align: 'num', hidden: !can('cost.view'), render: (l) => fmt.money(l.value) },
    ],
  }).el));
}

// Create dialog. `batch` pre-fills one existing batch (from the batch screen).
export function openAdjustment({ kind = 'decrease', batch = null, onDone } = {}) {
  const form = new Form();
  const lines = [];
  const linesBox = h('div.stack.tight');
  const kindSel = select(KINDS.map((k) => ({ value: k, label: t(`adjKind.${k}`) })), { value: kind });
  const hint = h('p.small.muted');
  const setHint = () => { hint.textContent = t(`adjHint.${kindSel.value}`); };
  setHint();
  kindSel.addEventListener('change', () => { setHint(); redraw(); });

  function redraw() {
    linesBox.replaceChildren(...lines.map((l) => l.row));
    if (!lines.length) linesBox.append(h('p.small.faint', t('adjustments.noLines')));
  }

  async function addLine(product, presetBatch) {
    const line = { product };
    const adds = ADDS.includes(kindSel.value);
    const qty = qtyInput(product, { value: presetBatch && !adds ? presetBatch.onHand : 0 });
    line.qty = qty;
    const batchHolder = h('div', { style: { minWidth: '280px' } });
    line.row = h('div.card', { style: { padding: '10px 12px' } },
      h('div.row.between', h('strong', product.label), h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { lines.splice(lines.indexOf(line), 1); redraw(); } }, icon('x', 'sm'))),
      h('div.row.wrap', { style: { marginTop: '8px', alignItems: 'flex-end', gap: '12px' } }, batchHolder, h('div.field', h('label', t('docs.qty')), qty)));
    lines.push(line);
    redraw();
    const sel = await batchSelect(product.id, { includeExpired: kindSel.value === 'expired' || adds, value: presetBatch ? presetBatch.batchId : '', status: kindSel.value === 'expired' ? 'expired' : 'in_stock' });
    if (adds) sel.options[0].textContent = t('adjustments.newBatch');
    line.batchSel = sel;
    const newBatch = h('div.form-grid', { style: { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', marginTop: '8px' } });
    line.nb = {
      batchNo: input({ maxlength: 40 }), expiryDate: input({ type: 'date' }), mfgDate: input({ type: 'date' }),
      cost: moneyInput({ value: rupees(product.tradePrice) }), mrp: moneyInput({ value: rupees(product.mrp) }),
    };
    newBatch.append(
      fieldText(line.nb.batchNo, t('stock.batch'), { required: true }).el, fieldText(line.nb.expiryDate, t('stock.expiry'), { required: true }).el,
      fieldText(line.nb.mfgDate, t('stock.mfg')).el, fieldText(line.nb.cost, t('stock.costPerPack'), { required: true }).el, fieldText(line.nb.mrp, t('products.mrpPerPack')).el);
    const toggleNew = () => { newBatch.hidden = !(adds && !sel.value); };
    sel.addEventListener('change', toggleNew);
    mount(batchHolder, h('div.field', h('label', t('stock.batch')), sel));
    line.row.append(newBatch);
    toggleNew();
  }

  const picker = productPicker({ onPick: (p) => addLine(p) });
  const reason = input({ maxlength: 500, placeholder: t('adjustments.reasonPh') });
  const save = h('button.btn.primary', { type: 'button' }, t('adjustments.save'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: t('adjustments.add'), size: 'wide',
    body: [form.errorBox, h('div.form-grid',
      form.add('kind', fieldText(kindSel, t('adjustments.kind'), { required: true })),
      form.add('reason', fieldText(reason, t('common.reason'), { required: true }))), hint,
      h('div.field', { style: { marginTop: '12px' } }, h('label', t('adjustments.addItem')), picker), h('div', { style: { marginTop: '12px' } }, linesBox),
      h('p.small.muted', { style: { marginTop: '8px' } }, t('adjustments.limitNote'))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  redraw();
  if (batch) addLine({ id: batch.productId, label: batch.productLabel, packSize: batch.packSize, packUnit: batch.packUnit, baseUnit: batch.baseUnit, mrp: batch.mrp, tradePrice: batch.cost }, batch);
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    const payload = {
      kind: kindSel.value, reason: reason.value,
      lines: lines.map((l) => (l.batchSel && l.batchSel.value
        ? { batchId: l.batchSel.value, productId: l.product.id, qty: l.qty.getValue() }
        : { productId: l.product.id, qty: l.qty.getValue(), batchNo: l.nb.batchNo.value, expiryDate: l.nb.expiryDate.value, mfgDate: l.nb.mfgDate.value, cost: l.nb.cost.value, mrp: l.nb.mrp.value })),
    };
    try {
      const res = await call('adjustments.create', payload);
      m.close();
      toast(res.needsApproval ? t('adjustments.sentForApproval', { doc: res.docNo }) : t('adjustments.posted', { doc: res.docNo }), { timeout: 5000 });
      if (onDone) onDone(res);
    } catch (err) { form.showError(err); }
  });
}

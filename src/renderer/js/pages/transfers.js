// Transfers between branches: request, approve, dispatch by batch, receive with differences, resolve.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, qtyInput, statusBadge, docHeader, kv, filterSelect, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const filter = { direction: params.direction || 'all', status: params.status || '' };
  const actions = can('transfers.create') ? [
    h('button.btn', { type: 'button', onclick: () => createDialog('request', navigate) }, icon('download', 'sm'), t('transfers.request')),
    h('button.btn.primary', { type: 'button', onclick: () => createDialog('send', navigate) }, icon('truck', 'sm'), t('transfers.send')),
  ] : [];
  page.append(h('div.page-head', h('div', h('h1', t('transfers.title')), h('p.sub', t('transfers.sub'))), h('div.row',
    exportButton({ source: 'transfers.list', title: t('transfers.title'), perm: 'transfers.export', getParams: () => ({ ...filter }), columns: [
      { key: 'docNo', label: 'Number' }, { key: 'createdAt', label: 'Date', type: 'datetime' }, { key: 'fromName', label: 'From' }, { key: 'toName', label: 'To' },
      { key: 'status', label: 'Status' }, { key: 'dispatchedAt', label: 'Dispatched', type: 'datetime' }, { key: 'receivedAt', label: 'Received', type: 'datetime' }, { key: 'hasDiscrepancy', label: 'Differences', type: 'bool' },
    ] }), ...actions)));
  const dirSel = filterSelect([{ value: 'all', label: t('transfers.dirAll') }, { value: 'in', label: t('transfers.dirIn') }, { value: 'out', label: t('transfers.dirOut') }], (v) => { filter.direction = v; reload(); }, { value: filter.direction });
  const statusSel = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, { value: 'open', label: t('transfers.open') }, { value: 'discrepancy', label: t('transfers.withDifferences') },
    ...['requested', 'approved', 'dispatched', 'received', 'rejected', 'cancelled'].map((s) => ({ value: s, label: t(`status.${s}`) }))], (v) => { filter.status = v; reload(); }, { value: filter.status });
  const table = dataTable({
    id: 'transfers', tools: [dirSel, statusSel], searchPlaceholder: t('transfers.searchPh'),
    columns: [
      { key: 'docNo', label: t('docs.number'), sortable: false, render: (x) => h('span.mono', x.docNo) },
      { key: 'createdAt', label: t('docs.date'), sortable: false, render: (x) => fmt.dateTime(x.createdAt) },
      { key: 'direction', label: '', sortable: false, render: (x) => h('span.badge', { class: x.direction === 'in' ? 'accent' : 'outline' }, x.direction === 'in' ? t('transfers.incoming') : x.direction === 'out' ? t('transfers.outgoing') : '-') },
      { key: 'fromName', label: t('transfers.from'), sortable: false },
      { key: 'toName', label: t('transfers.to'), sortable: false },
      { key: 'status', label: t('common.status'), sortable: false, render: (x) => h('div.row', statusBadge(x.status), x.discrepancyOpen ? h('span.badge.danger', t('transfers.differenceOpen')) : null) },
    ],
    fetch: async (opts) => { try { return await call('transfers.list', { ...filter, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (x) => navigate('transfer', { id: x.id }),
    empty: { icon: 'truck', title: t('transfers.empty') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
}

async function createDialog(mode, navigate) {
  const branches = (await call('branches.list', {})).filter((b) => b.id !== state.me.branch.id);
  if (!branches.length) { toast(t('transfers.noOtherBranch'), { type: 'error' }); return; }
  const form = new Form();
  const ho = branches.find((b) => b.isHeadOffice);
  const branchSel = select(branches.map((b) => ({ value: b.id, label: b.name + (b.isHeadOffice ? ` (${t('common.headOffice')})` : '') })), { value: ho ? ho.id : branches[0].id });
  const lines = [];
  const box = h('div.stack.tight');
  const redraw = () => { box.replaceChildren(...lines.map((l) => l.row)); if (!lines.length) box.append(h('p.small.faint', t('adjustments.noLines'))); };
  const picker = productPicker({ onPick: (p) => {
    if (lines.some((l) => l.product.id === p.id)) { toast(t('transfers.alreadyAdded', { product: p.label })); return; }
    const q = qtyInput(p, { autofocus: true });
    const l = { product: p, q };
    l.row = h('div.row.between', { style: { padding: '6px 0', borderBottom: '1px solid var(--border)' } }, h('div', h('div', p.label), h('div.small.faint', t('transfers.haveHere', { qty: p.onHandText }))), h('div.row', q,
      h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { lines.splice(lines.indexOf(l), 1); redraw(); } }, icon('x', 'sm'))));
    lines.push(l);
    redraw();
    q.focus();
  } });
  const notes = input({ maxlength: 500 });
  const save = h('button.btn.primary', { type: 'button' }, mode === 'send' ? t('transfers.sendNow') : t('transfers.sendRequest'));
  const saveOnly = mode === 'send' ? h('button.btn', { type: 'button' }, t('transfers.saveForLater')) : null;
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: mode === 'send' ? t('transfers.send') : t('transfers.request'), size: 'wide',
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, mode === 'send' ? t('transfers.sendText') : t('transfers.requestText')), form.errorBox,
      h('div.form-grid', form.add('otherBranchId', fieldText(branchSel, mode === 'send' ? t('transfers.to') : t('transfers.from'), { required: true })), form.add('notes', fieldText(notes, t('products.notes')))),
      h('div.field', { style: { marginTop: '12px' } }, h('label', t('adjustments.addItem')), picker), h('div', { style: { marginTop: '8px' } }, box)],
    footer: [cancel, saveOnly, save].filter(Boolean),
  });
  redraw();
  cancel.onclick = () => m.close();
  const submit = (dispatch, btn) => busy(btn, null, async () => {
    form.clearErrors();
    try {
      const res = await call('transfers.create', { mode, otherBranchId: branchSel.value, notes: notes.value, dispatch, lines: lines.map((l) => ({ productId: l.product.id, qty: l.q.getValue() })) });
      m.close();
      toast(t('transfers.saved', { doc: res.docNo }));
      navigate('transfer', { id: res.id });
    } catch (err) { form.showError(err); }
  });
  save.onclick = () => submit(mode === 'send', save);
  if (saveOnly) saveOnly.onclick = () => submit(false, saveOnly);
}

export async function renderDetail(page, { params, navigate }) {
  let x;
  try { x = await call('transfers.get', { id: params.id }); } catch (err) { toastError(err); navigate('transfers'); return; }
  const here = state.me.branch.id;
  const atFrom = here === x.fromBranchId;
  const atTo = here === x.toBranchId;
  const reload = () => navigate('transfer', { id: x.id });
  const act = (method, args, msg) => async () => { try { await call(method, { id: x.id, ...args }); toast(msg || t('common.saved')); reload(); } catch (err) { toastError(err); } };

  const actions = [];
  if (atFrom && x.status === 'requested' && can('transfers.approve')) {
    actions.push(h('button.btn.danger', { type: 'button', onclick: async () => {
      const reason = await confirm({ title: t('transfers.rejectTitle'), text: t('transfers.rejectText'), confirmLabel: t('approvals.reject'), danger: true, requireReason: true });
      if (reason !== false) act('transfers.decide', { approve: false, reason })();
    } }, t('approvals.reject')));
    actions.push(h('button.btn.primary', { type: 'button', onclick: act('transfers.decide', { approve: true }) }, icon('check', 'sm'), t('approvals.approve')));
  }
  if (atFrom && x.status === 'approved' && can('transfers.dispatch')) actions.push(h('button.btn.primary', { type: 'button', onclick: () => dispatchDialog(x, reload) }, icon('truck', 'sm'), t('transfers.dispatch')));
  if (atTo && x.status === 'dispatched' && can('transfers.receive')) actions.push(h('button.btn.primary', { type: 'button', onclick: () => receiveDialog(x, reload) }, icon('check', 'sm'), t('transfers.receive')));
  if (atFrom && x.discrepancyOpen && can('transfers.approve')) actions.push(h('button.btn', { type: 'button', onclick: () => resolveDialog(x, reload) }, t('transfers.resolve')));
  if (['requested', 'approved'].includes(x.status) && can('transfers.create')) {
    actions.unshift(h('button.btn', { type: 'button', onclick: async () => {
      const reason = await confirm({ title: t('transfers.cancelTitle'), text: t('transfers.cancelText'), confirmLabel: t('transfers.cancelIt'), danger: true, requireReason: true });
      if (reason !== false) act('transfers.cancel', { reason })();
    } }, t('transfers.cancelIt')));
  }
  page.append(docHeader({ title: `${t('transfers.one')} ${x.docNo}`, status: h('span.row', statusBadge(x.status), x.discrepancyOpen ? h('span.badge.danger', t('transfers.differenceOpen')) : null), back: { href: '#/transfers', label: t('transfers.title') }, actions }));
  if (!atFrom && !atTo) page.append(h('div.form-note', { style: { marginBottom: '12px' } }, icon('info', 'sm'), h('div', t('transfers.otherBranchNote'))));
  else if ((x.status === 'approved' || x.status === 'requested') && atTo) page.append(h('div.form-note', { style: { marginBottom: '12px' } }, icon('info', 'sm'), h('div', t('transfers.waitingSender', { branch: x.fromName }))));
  else if (x.status === 'dispatched' && atFrom) page.append(h('div.form-note', { style: { marginBottom: '12px' } }, icon('info', 'sm'), h('div', t('transfers.inTransit', { branch: x.toName }))));

  // Progress steps
  const steps = [['requested', x.createdAt], ['approved', x.decidedAt], ['dispatched', x.dispatchedAt], ['received', x.receivedAt]];
  page.append(h('div.card', h('div.card-body', h('div.grid-2',
    kv([[t('transfers.from'), x.fromName], [t('transfers.to'), x.toName], [t('products.notes'), x.notes], x.decisionReason ? [t('adjustments.decisionReason'), x.decisionReason] : null]),
    h('div.stack.tight', ...steps.map(([s, at]) => h('div.row', h('span.dot', { class: at ? 'success' : '' }), h('span', t(`status.${s}`)), h('span.small.muted', at ? fmt.dateTime(at) : '-'))))))));

  page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('transfers.requested')), dataTable({
    id: 'transfer-req', searchable: false, rows: x.requests,
    columns: [{ key: 'productLabel', label: t('products.name') }, { key: 'qtyText', label: t('transfers.asked'), align: 'num' }, { key: 'sentText', label: t('transfers.sent'), align: 'num' }],
  }).el);
  if (x.lines.length) {
    page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('transfers.batchesSent')), dataTable({
      id: 'transfer-lines', searchable: false, rows: x.lines,
      columns: [
        { key: 'productLabel', label: t('products.name') }, { key: 'batchNo', label: t('stock.batch'), render: (l) => h('span.mono', l.batchNo) },
        { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) }, { key: 'qtyText', label: t('transfers.sent'), align: 'num' },
        { key: 'receivedText', label: t('transfers.receivedQty'), align: 'num' },
        { key: 'discrepancyReason', label: t('transfers.difference'), render: (l) => (l.shortQty ? h('div', h('span.badge.danger', t('transfers.short', { qty: l.shortQty })), h('div.small.muted', l.discrepancyReason || ''), l.resolution ? h('div.small', t(`transfers.res_${l.resolution}`)) : null) : '') },
        { key: 'value', label: t('stock.value'), align: 'num', hidden: !can('cost.view'), render: (l) => fmt.money(l.value) },
      ],
    }).el);
  }
}

function dispatchDialog(x, done) {
  const go = h('button.btn.primary', { type: 'button' }, t('transfers.dispatchFefo'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({ title: t('transfers.dispatch'), size: 'narrow', body: [h('p.muted', t('transfers.dispatchText'))], footer: [cancel, go] });
  cancel.onclick = () => m.close();
  go.onclick = () => busy(go, null, async () => {
    try { await call('transfers.dispatch', { id: x.id }); m.close(); toast(t('transfers.dispatched')); done(); } catch (err) { m.close(); toastError(err); }
  });
}

function receiveDialog(x, done) {
  const rows = x.lines.map((l) => {
    const q = qtyInput(l, { value: l.qty });
    const reason = input({ maxlength: 300, placeholder: t('transfers.differenceReasonPh') });
    return { l, q, reason, row: h('tr', h('td', l.productLabel, h('div.small.faint', `${l.batchNo} - ${fmt.date(l.expiryDate)}`)), h('td.num', l.qtyText), h('td', q), h('td', reason)) };
  });
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, t('transfers.confirmReceive'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: t('transfers.receive'), size: 'wide',
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('transfers.receiveText')), form.errorBox,
      h('table.diff', h('thead', h('tr', h('th', t('products.name')), h('th', t('transfers.sent')), h('th', t('transfers.receivedQty')), h('th', t('transfers.differenceReason')))), h('tbody', ...rows.map((r) => r.row)))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      await call('transfers.receive', { id: x.id, lines: rows.map((r) => ({ lineId: r.l.id, receivedQty: r.q.getValue(), reason: r.reason.value })) });
      m.close();
      toast(t('transfers.receivedOk'));
      done();
    } catch (err) { form.showError({ message: err.message }); }
  });
}

function resolveDialog(x, done) {
  const form = new Form();
  const res = select([{ value: 'returned', label: t('transfers.res_returned') }, { value: 'written_off', label: t('transfers.res_written_off') }]);
  const reason = input({ maxlength: 300 });
  const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: t('transfers.resolve'), size: 'narrow',
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('transfers.resolveText')), form.errorBox,
      form.add('resolution', fieldText(res, t('transfers.decision'), { required: true })), form.add('reason', fieldText(reason, t('common.reason'), { required: true }))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    try { await call('transfers.resolve', { id: x.id, resolution: res.value, reason: reason.value }); m.close(); toast(t('common.saved')); done(); } catch (err) { form.showError(err); }
  });
}

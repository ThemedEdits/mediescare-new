// Stock take: start a count, enter what is on the shelf, see the differences, post the corrections.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { toast, toastError } from '../ui/toast.js';
import { qtyInput, statusBadge, docHeader, exportButton, productPicker, batchSelect } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { navigate }) {
  const start = can('stocktake.create') ? h('button.btn.primary', { type: 'button', onclick: () => startDialog(navigate) }, icon('plus', 'sm'), t('stocktake.start')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('stocktake.title')), h('p.sub', t('stocktake.sub'))), start));
  let rows = [];
  try { rows = await call('stocktake.list'); } catch (err) { toastError(err); }
  page.append(dataTable({
    id: 'stocktakes', rows,
    columns: [
      { key: 'docNo', label: t('docs.number'), render: (s) => h('span.mono', s.docNo) },
      { key: 'name', label: t('stocktake.name') },
      { key: 'startedAt', label: t('stocktake.startedAt'), render: (s) => fmt.dateTime(s.startedAt) },
      { key: 'startedBy', label: t('adjustments.by') },
      { key: 'progress', label: t('stocktake.progress'), sortable: false, render: (s) => `${s.summary.counted} / ${s.summary.lines}` },
      { key: 'varianceLines', label: t('stocktake.differences'), align: 'num', sortable: false, render: (s) => String(s.summary.varianceLines) },
      { key: 'status', label: t('common.status'), render: (s) => statusBadge(s.status) },
    ],
    onRowClick: (s) => navigate('stocktake-count', { id: s.id }),
    empty: { icon: 'clipboard', title: t('stocktake.empty'), text: t('stocktake.emptyText') },
  }).el);
}

async function startDialog(navigate) {
  const lists = await call('lookups.all');
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, t('stocktake.start'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: t('stocktake.start'),
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('stocktake.startText')), form.errorBox, h('div.form-grid',
      form.add('name', fieldText(input({ maxlength: 120, placeholder: t('stocktake.namePh') }), t('stocktake.name'), { span2: true })),
      form.add('categoryId', fieldText(combobox({ options: lists.category.map((c) => ({ value: c.id, label: c.name })), emptyLabel: t('common.all') }), t('products.category'))),
      form.add('rack', fieldText(input({ maxlength: 40, placeholder: t('stocktake.rackPh') }), t('product.rack'))))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    try { const s = await call('stocktake.start', form.values()); m.close(); navigate('stocktake-count', { id: s.id }); } catch (err) { form.showError(err); }
  });
}

export async function renderCount(page, { params, navigate }) {
  let take;
  try { take = await call('stocktake.get', { id: params.id }); } catch (err) { toastError(err); navigate('stocktake'); return; }
  const open = take.status === 'counting';
  const dirty = new Map();
  const summary = h('div');
  const save = open ? h('button.btn', { type: 'button' }, icon('check', 'sm'), t('stocktake.saveCounts')) : null;
  const post = open && can('stocktake.approve') ? h('button.btn.primary', { type: 'button' }, t('stocktake.post')) : null;
  const cancelBtn = open && can('stocktake.approve') ? h('button.btn.danger', { type: 'button' }, t('stocktake.cancel')) : null;
  const exportBtn = exportButton({ source: 'stocktake.get', title: `${t('stocktake.title')} ${take.docNo}`, perm: 'stock.export', getParams: () => ({ id: take.id }), columns: [
    { key: 'rack', label: 'Rack' }, { key: 'productLabel', label: 'Product' }, { key: 'batchNo', label: 'Batch' }, { key: 'expiryDate', label: 'Expiry' },
    { key: 'systemQty', label: 'System (smallest units)', type: 'number' }, { key: 'countedQty', label: 'Counted (smallest units)', type: 'number' },
    { key: 'variance', label: 'Difference', type: 'number', total: true }, { key: 'varianceText', label: 'Difference (packs)' }, { key: 'value', label: 'Value', type: 'money', total: true }, { key: 'note', label: 'Note' },
  ] });
  page.append(docHeader({ title: `${take.name} (${take.docNo})`, status: statusBadge(take.status), back: { href: '#/stocktake', label: t('stocktake.title') }, actions: [exportBtn, cancelBtn, save, post] }));
  page.append(summary);
  const drawSummary = () => mount(summary, h('div.form-note', { style: { marginBottom: '12px' } }, icon('info', 'sm'), h('div',
    t('stocktake.summary', { counted: take.summary.counted, lines: take.summary.lines, diff: take.summary.varianceLines }),
    take.summary.varianceValue !== null ? ` ${t('stocktake.summaryValue', { value: fmt.money(take.summary.varianceValue) })}` : '',
    open ? ` ${t('stocktake.howTo')}` : '')));
  drawSummary();

  let onlyDiff = false;
  const diffToggle = h('label.check', h('input', { type: 'checkbox', onchange: (e) => { onlyDiff = e.target.checked; table.setRows(visibleRows()); } }), h('span', t('stocktake.onlyDifferences')));
  const visibleRows = () => (onlyDiff ? take.lines.filter((l) => l.variance !== null && l.variance !== 0) : take.lines);
  const table = dataTable({
    id: 'stocktake-lines', rows: visibleRows(), pageSize: 100, tools: [diffToggle], searchPlaceholder: t('stocktake.searchPh'),
    columns: [
      { key: 'rack', label: t('product.rack') },
      { key: 'productLabel', label: t('products.name') },
      { key: 'batchNo', label: t('stock.batch'), render: (l) => h('span.mono', l.batchNo) },
      { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) },
      { key: 'systemQty', label: t('stocktake.system'), align: 'num', render: (l) => l.systemText },
      { key: 'countedQty', label: t('stocktake.counted'), sortable: false, render: (l) => {
        if (!open) return l.countedText;
        // Typed but unsaved counts survive sorting and paging.
        const current = dirty.has(l.id) ? dirty.get(l.id).countedQty : l.countedQty;
        const q = qtyInput(l, { value: current === null ? 0 : current, onChange: (v) => { dirty.set(l.id, { lineId: l.id, countedQty: v }); } });
        if (current === null) { q.querySelectorAll('input').forEach((i) => { i.value = ''; }); }
        return q;
      } },
      { key: 'variance', label: t('stocktake.difference'), align: 'num', render: (l) => (l.variance === null ? h('span.faint', t('stocktake.notCounted')) : h('span', { style: { color: l.variance < 0 ? 'var(--danger)' : l.variance > 0 ? 'var(--success)' : '' } }, l.variance === 0 ? t('stocktake.match') : l.varianceText)) },
      { key: 'value', label: t('stock.value'), align: 'num', hidden: !can('cost.view'), render: (l) => fmt.money(l.value) },
    ],
  });
  page.append(table.el);

  if (open) {
    const picker = productPicker({ placeholder: t('stocktake.foundPh'), onPick: async (p) => {
      const sel = await batchSelect(p.id, { includeExpired: true, status: 'all' });
      const q = qtyInput(p);
      const ok = h('button.btn.primary', { type: 'button' }, t('common.save'));
      const mm = openModal({ title: t('stocktake.addFound', { product: p.label }), body: [h('div.field', h('label', t('stock.batch')), sel), h('div.field', { style: { marginTop: '12px' } }, h('label', t('stocktake.counted')), q)], footer: [ok], size: 'narrow' });
      ok.onclick = async () => {
        if (!sel.value) return;
        try { take = await call('stocktake.saveCounts', { id: take.id, add: [{ batchId: sel.value, countedQty: q.getValue() }] }); mm.close(); table.setRows(visibleRows()); drawSummary(); } catch (err) { toastError(err); }
      };
    } });
    page.append(h('div.field', { style: { marginTop: '16px', maxWidth: '520px' } }, h('label', t('stocktake.found')), picker, h('div.hint', t('stocktake.foundHint'))));

    const saveCounts = async () => {
      if (!dirty.size) return true;
      try {
        take = await call('stocktake.saveCounts', { id: take.id, counts: [...dirty.values()] });
        dirty.clear();
        table.setRows(visibleRows());
        drawSummary();
        return true;
      } catch (err) { toastError(err); return false; }
    };
    save.onclick = () => busy(save, null, async () => { if (await saveCounts()) toast(t('common.saved')); });
    if (post) {
      post.onclick = () => busy(post, null, async () => {
        if (!(await saveCounts())) return;
        const ok = await confirm({ title: t('stocktake.postTitle'), text: t('stocktake.postText', { diff: take.summary.varianceLines, counted: take.summary.counted, lines: take.summary.lines }), confirmLabel: t('stocktake.post') });
        if (!ok) return;
        try { await call('stocktake.post', { id: take.id }); toast(t('stocktake.posted')); navigate('stocktake-count', { id: take.id }); } catch (err) { toastError(err); }
      });
    }
    if (cancelBtn) {
      cancelBtn.onclick = async () => {
        const reason = await confirm({ title: t('stocktake.cancelTitle'), text: t('stocktake.cancelText'), confirmLabel: t('stocktake.cancel'), danger: true, requireReason: true });
        if (reason === false) return;
        try { await call('stocktake.cancel', { id: take.id, reason }); navigate('stocktake'); } catch (err) { toastError(err); }
      };
    }
    // Leaving the page with unsaved counts saves them first.
    return () => { if (dirty.size) call('stocktake.saveCounts', { id: take.id, counts: [...dirty.values()] }).catch(() => {}); };
  }
  return undefined;
}

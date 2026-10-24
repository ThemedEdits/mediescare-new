// Batches and expiry: what is on the shelf by batch, what is near expiry or expired, quarantine, batch corrections.
// Also exports the batch action menu and the stock movement table used on other screens.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import { expiryBadge, exportButton, moneyInput, rupees, filterSelect } from '../ui/stockui.js';
import { openAdjustment } from './adjustments.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const filter = { status: params.status || 'in_stock', days: '' };
  page.append(h('div.page-head', h('div', h('h1', t('batches.title')), h('p.sub', t('batches.sub'))),
    exportButton({
      source: 'stock.batches', title: t('batches.title'), perm: 'batches.export', getParams: () => ({ ...filter }),
      columns: [
        { key: 'productLabel', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'batchNo', label: 'Batch' }, { key: 'expiryDate', label: 'Expiry' },
        { key: 'daysLeft', label: 'Days left', type: 'number' }, { key: 'onHand', label: 'On hand (smallest units)', type: 'number' }, { key: 'onHandText', label: 'On hand' },
        { key: 'mrp', label: 'MRP per pack', type: 'money' }, { key: 'mrpValue', label: 'Value at MRP', type: 'money', total: true },
        { key: 'cost', label: 'Cost per pack', type: 'money' }, { key: 'value', label: 'Value at cost', type: 'money', total: true },
        { key: 'supplierName', label: 'Supplier' }, { key: 'quarantined', label: 'Quarantined', type: 'bool' },
      ],
    })));

  // Expiry summary: each card opens the matching list.
  const cards = h('div.grid-3', { style: { marginBottom: '16px', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } });
  page.append(cards);
  try {
    const ex = await call('stock.expiry', {});
    cards.replaceChildren(...ex.buckets.map((b) => h('button.choice', { type: 'button', onclick: () => {
      filter.status = b.key === 'expired' ? 'expired' : 'near';
      filter.days = b.maxDays > 0 ? b.maxDays : '';
      statusSel.value = filter.status;
      reload();
    } },
      h('div.small.muted', b.label), h('div', { style: { fontSize: '20px', fontWeight: 600, color: b.key === 'expired' && b.batches ? 'var(--danger)' : '' } }, String(b.batches)),
      h('div.small', t('batches.atMrp', { value: fmt.money(b.mrpValue) })), b.value !== null ? h('div.small.faint', t('batches.atCost', { value: fmt.money(b.value) })) : null)));
  } catch (err) { toastError(err); }

  const statusSel = filterSelect([
    { value: 'in_stock', label: t('batches.inStock') }, { value: 'near', label: t('batches.near') }, { value: 'expired', label: t('batches.expired') },
    { value: 'quarantine', label: t('batches.quarantine') }, { value: 'negative', label: t('batches.negative') }, { value: 'all', label: t('batches.allBatches') },
  ], (v) => { filter.status = v; filter.days = ''; reload(); }, { value: filter.status, width: '200px' });

  const totals = h('span.small.muted');
  const table = dataTable({
    id: 'batches', tools: [statusSel, totals], searchPlaceholder: t('batches.searchPh'), pageSize: 50, defaultSort: { key: 'expiryDate', dir: 'asc' },
    columns: [
      { key: 'productLabel', label: t('products.name'), render: (b) => h('div', h('a.cell-main', { href: `#/product?id=${b.productId}&tab=batches` }, b.productLabel), h('div.cell-sub', b.genericName || '')) },
      { key: 'batchNo', label: t('stock.batch'), render: (b) => h('div.row', h('span.mono', b.batchNo), b.quarantined ? h('span.badge.danger', t('stock.quarantined')) : null) },
      { key: 'expiryDate', label: t('stock.expiry'), render: (b) => h('div.row', fmt.date(b.expiryDate), expiryBadge(b)) },
      { key: 'onHand', label: t('products.onHand'), align: 'num', render: (b) => h('span', { class: b.onHand < 0 ? 'badge danger' : '' }, b.onHandText) },
      { key: 'mrp', label: t('products.mrp'), align: 'num', sortable: false, render: (b) => fmt.money(b.mrp) },
      { key: 'value', label: t('stock.value'), align: 'num', sortable: false, hidden: !can('cost.view'), render: (b) => fmt.money(b.value) },
      { key: 'supplierName', label: t('products.supplier'), sortable: false, hidden: true },
      { key: 'rack', label: t('product.rack'), sortable: false, hidden: true },
      { key: 'actions', label: '', render: (b) => batchActions(b, () => table.refresh(), navigate) },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('stock.batches', { ...filter, ...opts });
        totals.textContent = res.totals.value !== null ? t('batches.totals', { mrp: fmt.money(res.totals.mrpValue), cost: fmt.money(res.totals.value) }) : t('batches.totalsMrp', { mrp: fmt.money(res.totals.mrpValue) });
        return res;
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    empty: { icon: 'layers', title: t('batches.empty') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
}

// Action menu for one batch row.
export function batchActions(b, onDone, navigate) {
  const go = navigate || ((path, q) => { location.hash = `#/${path}?${new URLSearchParams(q)}`; });
  const items = [
    { iconEl: icon('history', 'sm'), label: t('batches.history'), onClick: () => go('movements', { batchId: b.batchId, label: `${b.productLabel} ${b.batchNo}` }) },
    can('batches.edit') && { iconEl: icon('edit', 'sm'), label: t('batches.edit'), onClick: () => editBatch(b, onDone) },
    can('batches.edit') && (b.quarantined
      ? { iconEl: icon('unlock', 'sm'), label: t('batches.release'), onClick: () => quarantine(b, false, onDone) }
      : { iconEl: icon('lock', 'sm'), label: t('batches.putQuarantine'), onClick: () => quarantine(b, true, onDone) }),
    can('stock.create') && b.onHand > 0 && { iconEl: icon('trash', 'sm'), label: b.expiryState === 'expired' ? t('batches.writeOffExpired') : t('batches.writeOffDamaged'), danger: true,
      onClick: () => openAdjustment({ kind: b.expiryState === 'expired' ? 'expired' : 'damaged', batch: b, onDone }) },
    can('purchases.create') && can('cost.view') && b.onHand > 0 && { iconEl: icon('truck', 'sm'), label: t('batches.returnSupplier'), onClick: () => go('purchase-returns', { new: '1', batchId: b.batchId }) },
    { iconEl: icon('printer', 'sm'), label: t('labels.print'), onClick: () => go('labels', { productId: b.productId, batchId: b.batchId }) },
  ].filter(Boolean);
  const btn = h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.actions') }, icon('more', 'sm'));
  btn.addEventListener('click', () => menu(btn, items, { align: 'right' }));
  return btn;
}

function editBatch(b, onDone) {
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, t('common.saveChanges'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: t('batches.editTitle', { batch: b.batchNo }),
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, t('batches.editNote')), form.errorBox, h('div.form-grid',
      form.add('batchNo', fieldText(input({ value: b.batchNo, maxlength: 40 }), t('stock.batch'), { required: true })),
      form.add('expiryDate', fieldText(input({ type: 'date', value: b.expiryDate }), t('stock.expiry'), { required: true })),
      form.add('mfgDate', fieldText(input({ type: 'date', value: b.mfgDate || '' }), t('stock.mfg'))),
      form.add('mrp', fieldText(moneyInput({ value: rupees(b.mrp) }), t('products.mrpPerPack'), { required: true })),
      form.add('reason', fieldText(input({ maxlength: 300 }), t('common.reason'), { required: true, span2: true })))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try { await call('batches.update', { id: b.batchId, ...form.values() }); m.close(); toast(t('common.saved')); onDone && onDone(); } catch (err) { form.showError(err); }
  });
}

async function quarantine(b, on, onDone) {
  const reason = await confirm({ title: on ? t('batches.quarantineTitle', { batch: b.batchNo }) : t('batches.releaseTitle', { batch: b.batchNo }), text: on ? t('batches.quarantineText') : t('batches.releaseText'), confirmLabel: on ? t('batches.putQuarantine') : t('batches.release'), danger: on, requireReason: true });
  if (reason === false) return;
  try { await call('batches.setQuarantine', { batchId: b.batchId, quarantined: on, reason }); toast(t('common.saved')); onDone && onDone(); } catch (err) { toastError(err); }
}

// Stock movements (the ledger) for a product, a batch, or everything, with before and after quantities.
const REF_PAGES = { grn: 'grn', purchase_return: 'purchase-return', adjustment: 'adjustment', stock_take: 'stocktake-count', transfer: 'transfer' };

export function ledgerTable({ productId, batchId, id = 'ledger', tools = [], extra = () => ({}) }) {
  const totals = h('span.small.muted');
  const table = dataTable({
    id, tools: [...tools, totals], pageSize: 50, searchable: !productId && !batchId, searchPlaceholder: t('movements.searchPh'), defaultSort: { key: 'at', dir: 'desc' },
    columns: [
      { key: 'at', label: t('audit.at'), sortable: false, render: (r) => h('span.nowrap', fmt.dateTime(r.at)) },
      { key: 'productLabel', label: t('products.name'), sortable: false, hidden: !!productId, render: (r) => h('a', { href: `#/product?id=${r.productId}&tab=why` }, r.productLabel) },
      { key: 'batchNo', label: t('stock.batch'), sortable: false, render: (r) => h('span.mono', r.batchNo) },
      { key: 'movementLabel', label: t('movements.type'), sortable: false, render: (r) => h('span.badge', { class: r.qty > 0 ? 'success' : 'warning' }, r.movementLabel) },
      { key: 'refNo', label: t('movements.document'), sortable: false, render: (r) => (r.refId && REF_PAGES[r.refType] ? h('a.mono', { href: `#/${REF_PAGES[r.refType]}?id=${r.refId}` }, r.refNo) : h('span.mono', r.refNo || '')) },
      { key: 'qty', label: t('movements.change'), align: 'num', sortable: false, render: (r) => h('span', { style: { color: r.qty > 0 ? 'var(--success)' : 'var(--danger)' } }, (r.qty > 0 ? '+' : '') + r.qtyText) },
      { key: 'before', label: t('movements.before'), align: 'num', sortable: false, render: (r) => r.beforeText },
      { key: 'after', label: t('movements.after'), align: 'num', sortable: false, render: (r) => r.afterText },
      { key: 'value', label: t('stock.value'), align: 'num', sortable: false, hidden: !can('cost.view'), render: (r) => fmt.money(r.value) },
      { key: 'reason', label: t('audit.reason'), sortable: false },
      { key: 'username', label: t('audit.user'), sortable: false },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('stock.ledger', { productId, batchId, ...extra(), ...opts });
        totals.textContent = t('movements.totals', { inQty: res.totals.qtyIn, outQty: res.totals.qtyOut });
        return res;
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    empty: { icon: 'history', title: t('movements.empty') },
  });
  table.el.refreshTable = () => { table.resetPage(); table.refresh(); };
  return table.el;
}

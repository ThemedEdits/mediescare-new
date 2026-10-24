// Reorder suggestions (turn them into a purchase order), stock value, and fast, slow and dead movers.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { toast, toastError } from '../ui/toast.js';
import { statusBadge, exportButton, filterSelect } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function renderReorder(page, { navigate }) {
  let rows = [];
  try { rows = await call('stock.reorder', {}); } catch (err) { toastError(err); }
  const picked = new Set(rows.map((r) => r.productId));
  const makePo = can('purchases.create') && can('cost.view') ? h('button.btn.primary', { type: 'button', onclick: () => {
    const chosen = rows.filter((r) => picked.has(r.productId));
    if (!chosen.length) { toast(t('reorder.pickSome')); return; }
    // The order screen picks these up once. Supplier is chosen there (most items share a default supplier).
    try { sessionStorage.setItem('reorderLines', JSON.stringify(chosen)); } catch (_) { /* fall back to an empty order */ }
    const suppliers = [...new Set(chosen.map((r) => r.supplierId).filter(Boolean))];
    navigate('po', { new: '1', reorder: '1', supplierId: suppliers.length === 1 ? suppliers[0] : '' });
  } }, icon('plus', 'sm'), t('reorder.createPo')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('reorder.title')), h('p.sub', t('reorder.sub'))), h('div.row',
    exportButton({ source: 'stock.reorder', title: t('reorder.title'), perm: 'stock.export', columns: [
      { key: 'productLabel', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'onHandText', label: 'On hand' }, { key: 'status', label: 'Status' },
      { key: 'reorderLevel', label: 'Reorder level (smallest units)', type: 'number' }, { key: 'suggestedText', label: 'Suggested order' }, { key: 'supplierName', label: 'Supplier' }, { key: 'lastPrice', label: 'Last price', type: 'money' },
    ] }), makePo)));
  page.append(dataTable({
    id: 'reorder', rows,
    columns: [
      { key: 'pick', label: '', sortable: false, hideable: false, render: (r) => h('input', { type: 'checkbox', checked: picked.has(r.productId), 'aria-label': r.productLabel, onchange: (e) => { if (e.target.checked) picked.add(r.productId); else picked.delete(r.productId); } }) },
      { key: 'productLabel', label: t('products.name'), render: (r) => h('a', { href: `#/product?id=${r.productId}` }, r.productLabel) },
      { key: 'onHand', label: t('products.onHand'), align: 'num', render: (r) => r.onHandText },
      { key: 'status', label: t('products.stockStatus'), render: (r) => statusBadge(r.status, t(`stockStatus.${r.status}`)) },
      { key: 'suggestedQty', label: t('reorder.suggested'), align: 'num', render: (r) => h('strong', r.suggestedText) },
      { key: 'supplierName', label: t('products.supplier') },
      { key: 'lastPrice', label: t('reorder.lastPrice'), align: 'num', hidden: !can('cost.view'), render: (r) => fmt.money(r.lastPrice) },
    ],
    empty: { icon: 'check', title: t('reorder.empty'), text: t('reorder.emptyText') },
  }).el);
}

export async function renderStockReports(page, { params }) {
  let tab = params.tab || (can('cost.view') ? 'value' : 'fast');
  page.append(h('div.page-head', h('div', h('h1', t('stockReports.title')), h('p.sub', t('stockReports.sub')))));
  const bar = h('div.row', { style: { marginBottom: '16px' } });
  const body = h('div');
  page.append(bar, body);
  const tabs = [can('cost.view') && ['value', t('stockReports.value')], ['fast', t('stockReports.fast')], ['slow', t('stockReports.slow')], ['dead', t('stockReports.dead')]].filter(Boolean);
  const drawBar = () => bar.replaceChildren(...tabs.map(([k, l]) => h('button.btn', { type: 'button', class: k === tab ? 'primary' : '', onclick: () => { tab = k; drawBar(); show(); } }, l)));

  async function show() {
    try {
      if (tab === 'value') {
        let groupBy = 'category';
        const holder = h('div');
        const load = async () => {
          const res = await call('stock.valuation', { groupBy });
          mount(holder, h('div.stack',
            h('div.row', h('span', t('stockReports.totalCost')), h('strong', fmt.money(res.total.value)), h('span.spacer'), h('span', t('stockReports.totalMrp')), h('strong', fmt.money(res.total.mrpValue))),
            dataTable({
              id: 'valuation', rows: res.rows, defaultSort: { key: 'value', dir: 'desc' },
              columns: [
                { key: 'name', label: t(`stockReports.by_${groupBy}`) }, { key: 'batches', label: t('stockReports.batches'), align: 'num' },
                { key: 'value', label: t('stockReports.atCost'), align: 'num', render: (r) => fmt.money(r.value) },
                { key: 'mrpValue', label: t('stockReports.atMrp'), align: 'num', render: (r) => fmt.money(r.mrpValue) },
                { key: 'margin', label: t('stockReports.margin'), align: 'num', sortValue: (r) => r.mrpValue - r.value, render: (r) => fmt.money(r.mrpValue - r.value) },
              ],
              empty: { icon: 'chart', title: t('stockReports.noStock') },
            }).el, h('p.small.muted', t('stockReports.method'))));
        };
        const sel = filterSelect(['category', 'product', 'batch', can('branches.view_all') ? 'branch' : null].filter(Boolean).map((g) => ({ value: g, label: t(`stockReports.by_${g}`) })), (v) => { groupBy = v; load(); });
        mount(body, h('div.stack', h('div.row', h('span.small.muted', t('stockReports.groupBy')), sel, h('span.spacer'),
          exportButton({ source: 'stock.valuation', title: t('stockReports.value'), perm: 'stock.export', getParams: () => ({ groupBy }), columns: [
            { key: 'name', label: 'Group' }, { key: 'batches', label: 'Batches', type: 'number', total: true }, { key: 'value', label: 'Value at cost', type: 'money', total: true }, { key: 'mrpValue', label: 'Value at MRP', type: 'money', total: true },
          ] })), holder));
        await load();
      } else {
        let days = 90;
        const holder = h('div');
        const load = async () => {
          const res = await call('stock.movers', { kind: tab, days });
          mount(holder, dataTable({
            id: `movers-${tab}`, rows: res.rows,
            columns: [
              { key: 'productLabel', label: t('products.name'), render: (r) => h('a', { href: `#/product?id=${r.productId}` }, r.productLabel) },
              { key: 'sold', label: t('stockReports.sold', { days }), align: 'num', render: (r) => r.soldText },
              { key: 'perDay', label: t('stockReports.perDay'), align: 'num' },
              { key: 'onHand', label: t('products.onHand'), align: 'num', render: (r) => r.onHandText },
            ],
            empty: { icon: 'chart', title: t('stockReports.noSales'), text: t('stockReports.noSalesText') },
          }).el);
        };
        const sel = filterSelect([30, 60, 90, 180, 365].map((d) => ({ value: d, label: t('stockReports.lastDays', { n: d }) })), (v) => { days = Number(v); load(); }, { value: 90 });
        mount(body, h('div.stack', h('div.row', sel, h('span.spacer'), exportButton({ source: 'stock.movers', title: t(`stockReports.${tab}`), perm: 'stock.export', getParams: () => ({ kind: tab, days }), columns: [
          { key: 'productLabel', label: 'Product' }, { key: 'sold', label: 'Sold (smallest units)', type: 'number' }, { key: 'perDay', label: 'Per day', type: 'number' }, { key: 'onHandText', label: 'On hand' },
        ] })), holder));
        await load();
      }
    } catch (err) { mount(body, h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message))); }
  }
  drawBar();
  await show();
}

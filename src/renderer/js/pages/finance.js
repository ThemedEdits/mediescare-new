// Financial journal: every money event of the branch for a period (sales, returns, receipts, purchases, supplier
// payments, expenses, cash in and out, write-offs, adjustments) with a summary by type. Rows open the document.
import { h, mount } from '../ui/dom.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { toastError } from '../ui/toast.js';
import { dataTable } from '../ui/table.js';
import { exportButton, printButton, filterSelect } from '../ui/stockui.js';
import { rangeControls, datePresets } from './reports.js';
import * as fmt from '../ui/format.js';

const ROUTE = {
  sale: (id) => ['sale', { id }], customer: (id) => ['customer', { id }], grn: (id) => ['grn', { id }], purchase_return: (id) => ['purchase-return', { id }],
  payment: (id) => ['payment', { id }], expense: (id) => ['expenses', { id }], shift: (id) => ['shift', { id }], adjustment: (id) => ['adjustment', { id }],
  stock_take: (id) => ['stocktake-count', { id }], transfer: (id) => ['transfer', { id }],
};

export function journalLink(r) {
  const fn = ROUTE[r.refType];
  return fn && r.refId ? fn(r.refId) : null;
}

const COLUMNS = [
  { key: 'day', label: 'Date', type: 'date' }, { key: 'at', label: 'Time', type: 'datetime' }, { key: 'branchName', label: 'Branch' }, { key: 'kindLabel', label: 'Type' },
  { key: 'docNo', label: 'Document' }, { key: 'party', label: 'Customer, supplier or person' }, { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', type: 'money', total: true },
  { key: 'discount', label: 'Discount', type: 'money', total: true }, { key: 'tax', label: 'Tax', type: 'money', total: true }, { key: 'moneyIn', label: 'Money in', type: 'money', total: true },
  { key: 'moneyOut', label: 'Money out', type: 'money', total: true }, { key: 'receivable', label: 'Customers owe (+/-)', type: 'money', total: true },
  { key: 'payable', label: 'We owe suppliers (+/-)', type: 'money', total: true }, { key: 'stockValue', label: 'Stock value (+/-)', type: 'money', total: true }, { key: 'notes', label: 'Notes' },
];

export async function render(page, { params, navigate }) {
  const today = datePresets()[0];
  const f = { from: params.from || today.from, to: params.to || today.to, kind: params.kind || '', method: '', branchId: '', q: '' };
  const kinds = await call('finance.kinds').catch(() => []);
  const query = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  page.append(h('div.page-head', h('div', h('h1', t('finance.title')), h('p.sub', t('finance.sub'))),
    h('div.row', printButton({ source: 'finance.journal', title: t('finance.title'), perm: 'finance.export', getParams: query, columns: COLUMNS }),
      exportButton({ source: 'finance.journal', title: t('finance.title'), perm: 'finance.export', getParams: query, columns: COLUMNS }))));
  const controls = rangeControls(f, reload);
  if (can('branches.view_all')) {
    const branches = await call('branches.list', {}).catch(() => []);
    controls.push(filterSelect([{ value: '', label: state.me.branch.name }, ...branches.filter((b) => b.id !== state.me.branch.id).map((b) => ({ value: b.id, label: b.name })), { value: 'all', label: t('reports.allBranches') }],
      (v) => { f.branchId = v; reload(); }, { width: '180px', label: t('shell.branch') }));
  }
  controls.push(filterSelect([{ value: '', label: t('finance.allTypes') }, ...kinds.map((k) => ({ value: k.key, label: k.label }))], (v) => { f.kind = v; reload(); }, { value: f.kind, width: '220px', label: t('finance.type') }));
  controls.push(filterSelect([{ value: '', label: t('finance.anyMethod') }, ...['cash', 'card', 'easypaisa', 'jazzcash', 'bank', 'cheque', 'online', 'drawer', 'petty'].map((m) => ({ value: m, label: fmt.humanize(m) }))],
    (v) => { f.method = v; reload(); }, { width: '160px', label: t('finance.method') }));
  page.append(h('div.filter-bar', ...controls));
  const summaryEl = h('div');
  page.append(summaryEl);

  const table = dataTable({
    id: 'finance-journal', searchPlaceholder: t('finance.searchPh'), pageSize: 50,
    columns: [
      { key: 'at', label: t('finance.when'), sortable: false, nowrap: true, render: (r) => h('div', h('div', fmt.date(r.day)), h('div.cell-sub', fmt.time(r.at))) },
      { key: 'branchName', label: t('shell.branch'), sortable: false, hidden: !can('branches.view_all') },
      { key: 'kindLabel', label: t('finance.type'), sortable: false },
      { key: 'docNo', label: t('finance.document'), sortable: false, render: (r) => (r.docNo ? h('span.mono', r.docNo) : '') },
      { key: 'party', label: t('finance.party'), sortable: false },
      { key: 'method', label: t('finance.method'), sortable: false, render: (r) => (r.method ? r.method.split(',').map(fmt.humanize).join(', ') : '') },
      { key: 'amount', label: t('finance.amount'), align: 'num', sortable: false, render: (r) => fmt.money(r.amount) },
      { key: 'moneyIn', label: t('finance.moneyIn'), align: 'num', sortable: false, render: (r) => (r.moneyIn ? fmt.money(r.moneyIn) : '') },
      { key: 'moneyOut', label: t('finance.moneyOut'), align: 'num', sortable: false, render: (r) => (r.moneyOut ? fmt.money(r.moneyOut) : '') },
      { key: 'receivable', label: t('finance.receivable'), align: 'num', sortable: false, hidden: true, render: (r) => (r.receivable ? fmt.money(r.receivable) : '') },
      { key: 'payable', label: t('finance.payable'), align: 'num', sortable: false, hidden: true, render: (r) => (r.payable ? fmt.money(r.payable) : '') },
      { key: 'stockValue', label: t('finance.stockValue'), align: 'num', sortable: false, hidden: true, render: (r) => (r.stockValue ? fmt.money(r.stockValue) : '') },
      { key: 'notes', label: t('finance.notes'), sortable: false, render: (r) => h('span.small.muted', r.notes || '') },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('finance.journal', { ...query(), q: opts.search, page: opts.page, pageSize: opts.pageSize });
        paintSummary(res);
        return res;
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    onRowClick: (r) => { const l = journalLink(r); if (l) navigate(...l); },
    empty: { icon: 'clipboard', title: t('finance.empty') },
  });
  page.append(h('div', { style: { marginTop: '16px' } }, table.el));

  function paintSummary(res) {
    const tot = res.totals;
    const s = (label, v, sub) => h('div.stat', h('span.stat-label', label), h('span.stat-value', fmt.money(v || 0)), sub ? h('span.stat-sub', sub) : null);
    mount(summaryEl,
      h('div.stat-grid', s(t('finance.moneyIn'), tot.moneyIn), s(t('finance.moneyOut'), tot.moneyOut), s(t('finance.net'), tot.net, t('finance.netSub')),
        s(t('finance.receivable'), tot.receivable, t('finance.changeSub')), s(t('finance.payable'), tot.payable, t('finance.changeSub')),
        tot.stockValue !== null && tot.stockValue !== undefined ? s(t('finance.stockValue'), tot.stockValue, t('finance.stockSub')) : null),
      res.summary.length ? h('div.card', h('div.card-head', h('h2', t('finance.byType'))), h('div.table-scroll', h('table.data',
        h('thead', h('tr', h('th', t('finance.type')), h('th.num', t('finance.count')), h('th.num', t('finance.amount')), h('th.num', t('finance.moneyIn')), h('th.num', t('finance.moneyOut')),
          h('th.num', t('finance.receivable')), h('th.num', t('finance.payable')))),
        h('tbody', ...res.summary.map((x) => {
          const tr = h('tr.clickable', h('td', x.kindLabel), h('td.num', String(x.count)), h('td.num', fmt.money(x.amount)), h('td.num', fmt.money(x.moneyIn)), h('td.num', fmt.money(x.moneyOut)),
            h('td.num', fmt.money(x.receivable)), h('td.num', fmt.money(x.payable)));
          tr.addEventListener('click', () => navigate('finance', { from: f.from, to: f.to, kind: x.kind }));
          return tr;
        }))))) : null);
  }

  function reload() { table.resetPage(); table.refresh(); }
}

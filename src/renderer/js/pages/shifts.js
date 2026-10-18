// Cashier shifts: list, and one shift's X report (still open) or Z report (closed).
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { dataTable } from '../ui/table.js';
import { toast, toastError } from '../ui/toast.js';
import { docHeader, filterSelect, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { navigate }) {
  const f = { status: '' };
  page.append(h('div.page-head', h('div', h('h1', t('shifts.title')), h('p.sub', t('shifts.sub'))),
    exportButton({ source: 'shifts.list', title: t('shifts.title'), perm: 'sales.export', getParams: () => ({ ...f }), columns: [
      { key: 'docNo', label: 'Shift' }, { key: 'userName', label: 'Cashier' }, { key: 'openedAt', label: 'Opened', type: 'datetime' }, { key: 'closedAt', label: 'Closed', type: 'datetime' },
      { key: 'openingCash', label: 'Opening cash', type: 'money' }, { key: 'salesTotal', label: 'Sales', type: 'money', total: true }, { key: 'expectedCash', label: 'Expected cash', type: 'money' },
      { key: 'countedCash', label: 'Counted', type: 'money' }, { key: 'overShort', label: 'Over (+) or short (-)', type: 'money', total: true },
    ] })));
  const statusSel = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, { value: 'open', label: t('shifts.open') }, { value: 'closed', label: t('shifts.closed') }], (v) => { f.status = v; table.resetPage(); table.refresh(); });
  const table = dataTable({
    id: 'shifts', tools: [statusSel], searchable: false,
    columns: [
      { key: 'docNo', label: t('shifts.shift'), sortable: false, render: (s) => h('span.mono', s.docNo) },
      { key: 'userName', label: t('sales.cashier'), sortable: false },
      { key: 'openedAt', label: t('shifts.opened'), sortable: false, render: (s) => fmt.dateTime(s.openedAt) },
      { key: 'closedAt', label: t('shifts.closedAt'), sortable: false, render: (s) => (s.closedAt ? fmt.dateTime(s.closedAt) : '') },
      { key: 'salesTotal', label: t('shifts.sales'), align: 'num', sortable: false, render: (s) => fmt.money(s.salesTotal) },
      { key: 'overShort', label: t('shifts.overShort'), align: 'num', sortable: false, render: (s) => (s.overShort === null ? '' : h('span', { style: { color: s.overShort === 0 ? 'var(--success)' : 'var(--danger)' } }, s.overShort === 0 ? t('pos.exact') : fmt.money(s.overShort))) },
      { key: 'status', label: t('common.status'), sortable: false, render: (s) => h('span.badge', { class: s.status === 'open' ? 'warning' : 'success' }, s.status === 'open' ? t('shifts.open') : t('shifts.closed')) },
    ],
    fetch: async (opts) => { try { return await call('shifts.list', { ...f, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (s) => navigate('shift', { id: s.id }),
    empty: { icon: 'wallet', title: t('shifts.empty') },
  });
  page.append(table.el);
}

export async function renderDetail(page, { params, navigate }) {
  let s;
  try { s = await call('shifts.get', { id: params.id }); } catch (err) { toastError(err); navigate('shifts'); return; }
  const sum = s.summary;
  const print = h('button.btn', { type: 'button', onclick: async () => { try { await call('shifts.print', { id: s.id }); toast(t('labels.sent')); } catch (err) { toastError(err); } } }, icon('printer', 'sm'), t('common.print'));
  const bills = h('a.btn', { href: `#/sales?shiftId=${s.id}` }, icon('receipt', 'sm'), t('shifts.bills'));
  page.append(docHeader({ title: `${s.status === 'open' ? t('shifts.xReport') : t('shifts.zReport')} ${s.docNo}`, back: { href: '#/shifts', label: t('shifts.title') }, actions: [bills, print],
    status: h('span.badge', { class: s.status === 'open' ? 'warning' : 'success' }, s.status === 'open' ? t('shifts.open') : t('shifts.closed')) }));
  const row = (k, v, strong) => h('tr', h('td', k), h('td.num', strong ? h('strong', v) : v));
  page.append(h('div.grid-2', { style: { alignItems: 'start' } },
    h('div.report-sheet', h('table',
      row(t('sales.cashier'), s.userName), row(t('shifts.opened'), fmt.dateTime(s.openedAt)), s.closedAt ? row(t('shifts.closedAt'), fmt.dateTime(s.closedAt)) : null,
      row(t('shifts.bills'), String(sum.bills)), row(t('shifts.sales'), fmt.money(sum.salesTotal), true), row(t('pos.discountTotal'), fmt.money(sum.discount)), row(t('sales.taxIncl'), fmt.money(sum.tax)),
      row(t('shifts.creditSales'), fmt.money(sum.creditSales)), row(t('shifts.voided'), `${sum.voided.count} / ${fmt.money(sum.voided.total)}`), row(t('sales.returns'), `${sum.returns.count} / ${fmt.money(sum.returns.total)}`),
      row(t('shifts.receipts'), fmt.money(sum.receipts)), row(t('shifts.refunds'), fmt.money(sum.refunds)))),
    h('div.stack',
      h('div.report-sheet', h('table', ...sum.methods.filter((m) => m.sales || m.receipts || m.refunds).map((m) => row(t(`payMethod.${m.method}`), fmt.money(m.net))))),
      h('div.report-sheet', h('table',
        row(t('pos.openingCash'), fmt.money(sum.openingCash)), row(t('pos.cashIn'), fmt.money(sum.cashIn)), row(t('pos.cashOut'), fmt.money(sum.cashOut)),
        row(t('shifts.expected'), fmt.money(s.status === 'closed' ? s.expectedCash : sum.expectedCash), true),
        s.status === 'closed' ? row(t('pos.countedCash'), fmt.money(s.countedCash)) : null,
        s.status === 'closed' ? row(t('shifts.overShort'), s.overShort === 0 ? t('pos.exact') : fmt.money(s.overShort), true) : null)),
      s.closeNotes ? h('div.form-note', icon('info', 'sm'), h('div', s.closeNotes)) : null)));
  if (s.movements.length) {
    page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('shifts.cashMoves')), dataTable({
      id: 'shift-moves', searchable: false, rows: s.movements,
      columns: [{ key: 'at', label: t('audit.at'), render: (m) => fmt.dateTime(m.at) }, { key: 'kind', label: t('movements.type'), render: (m) => (m.kind === 'in' ? t('pos.cashIn') : t('pos.cashOut')) },
        { key: 'amount', label: t('docs.amount'), align: 'num', render: (m) => fmt.money(m.amount) }, { key: 'reason', label: t('common.reason') }, { key: 'username', label: t('audit.user') }],
    }).el);
  }
}

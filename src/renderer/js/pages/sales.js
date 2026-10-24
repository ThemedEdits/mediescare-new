// Sales history (every bill, searchable with many filters) and one bill: receipt, reprint, return, cancel, labels.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { toast, toastError } from '../ui/toast.js';
import { docHeader, kv, filterSelect, dateFilter, exportButton, moneyInput, qtyInput, qtyText } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';
import { askApproval } from './posapproval.js';

const METHOD_LABEL = (m) => (m === 'credit' ? t('sales.credit') : t(`payMethod.${m}`));

export async function render(page, { params, navigate }) {
  const f = { from: params.from || '', to: params.to || '', status: params.status || '', method: params.method || '', cashierId: params.cashierId || '', customerId: params.customerId || '', shiftId: params.shiftId || '', productId: '', returned: '', minTotal: '', maxTotal: '', branchId: '' };
  const query = () => ({ ...f });
  page.append(h('div.page-head', h('div', h('h1', t('sales.title')), h('p.sub', t('sales.sub'))), h('div.row',
    exportButton({ source: 'sales.list', title: t('sales.title'), perm: 'sales.export', getParams: query, columns: [
      { key: 'docNo', label: 'Bill' }, { key: 'soldAt', label: 'Date and time', type: 'datetime' }, { key: 'branchName', label: 'Branch' }, { key: 'customerName', label: 'Customer' },
      { key: 'cashierName', label: 'Cashier' }, { key: 'status', label: 'Status' }, { key: 'lines', label: 'Lines', type: 'number' }, { key: 'discount', label: 'Discount', type: 'money', total: true },
      { key: 'total', label: 'Total', type: 'money', total: true }, { key: 'credit', label: 'On account', type: 'money', total: true }, { key: 'returned', label: 'Returned', type: 'money', total: true },
      { key: 'profit', label: 'Gross profit', type: 'money', total: true },
    ] }),
    can('pos.view') ? h('a.btn.primary', { href: '#/pos' }, icon('cart', 'sm'), t('nav.pos')) : null)));

  const users = await call('users.list', {}).catch(() => []);
  const from = dateFilter((v) => { f.from = v; reload(); }, t('common.from'));
  const to = dateFilter((v) => { f.to = v; reload(); }, t('common.to'));
  if (f.from) from.value = f.from;
  if (f.to) to.value = f.to;
  const status = filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, { value: 'completed', label: t('sales.completed') }, { value: 'voided', label: t('sales.voided') }], (v) => { f.status = v; reload(); }, { width: '150px', value: f.status });
  const method = filterSelect([{ value: '', label: `${t('payments.method')}: ${t('common.all')}` }, ...['cash', 'card', 'easypaisa', 'jazzcash', 'bank', 'credit'].map((m) => ({ value: m, label: METHOD_LABEL(m) }))], (v) => { f.method = v; reload(); }, { width: '170px', value: f.method });
  const cashier = combobox({ options: users.map((u) => ({ value: u.id, label: u.fullName, sub: u.username })), value: f.cashierId, emptyLabel: `${t('sales.cashier')}: ${t('common.all')}`, onChange: (v) => { f.cashierId = v; reload(); } });
  cashier.style.width = '180px';
  const returned = filterSelect([{ value: '', label: `${t('sales.returns')}: ${t('common.all')}` }, { value: 'yes', label: t('sales.withReturns') }, { value: 'no', label: t('sales.withoutReturns') }], (v) => { f.returned = v; reload(); }, { width: '160px' });
  const minT = moneyInput({ placeholder: t('sales.minAmount'), style: { width: '110px', textAlign: 'right' } });
  const maxT = moneyInput({ placeholder: t('sales.maxAmount'), style: { width: '110px', textAlign: 'right' } });
  minT.addEventListener('change', () => { f.minTotal = minT.value; reload(); });
  maxT.addEventListener('change', () => { f.maxTotal = maxT.value; reload(); });
  const productBox = h('input.input', { placeholder: t('sales.productFilter'), style: { width: '180px' }, list: 'sales-products' });
  const productList = h('datalist', { id: 'sales-products' });
  let productMap = new Map();
  productBox.addEventListener('input', async () => {
    const res = await call('products.search', { q: productBox.value, limit: 10, includeInactive: true }).catch(() => []);
    productMap = new Map(res.map((p) => [p.label, p.id]));
    productList.replaceChildren(...res.map((p) => h('option', { value: p.label })));
  });
  productBox.addEventListener('change', () => { f.productId = productMap.get(productBox.value) || ''; reload(); });
  const branch = can('branches.view_all') ? filterSelect([{ value: '', label: t('sales.thisBranch') }, { value: 'all', label: t('sales.allBranches') }], (v) => { f.branchId = v; reload(); }, { width: '150px' }) : null;

  const totalsEl = h('div.row.wrap.small', { style: { gap: '16px' } });
  const table = dataTable({
    id: 'sales', searchPlaceholder: t('sales.searchPh'), pageSize: 50, defaultSort: { key: 'soldAt', dir: 'desc' },
    tools: [from, h('span.small.muted', t('common.to')), to, status, method, cashier, returned, productBox, productList, minT, maxT, branch].filter(Boolean),
    columns: [
      { key: 'docNo', label: t('sales.bill'), render: (s) => h('span.mono', s.docNo) },
      { key: 'soldAt', label: t('audit.at'), render: (s) => h('span.nowrap', fmt.dateTime(s.soldAt)) },
      { key: 'branchName', label: t('shell.branch'), hidden: !can('branches.view_all') },
      { key: 'customerName', label: t('pos.customer'), render: (s) => s.customerName || h('span.faint', t('pos.walkIn')) },
      { key: 'cashierName', label: t('sales.cashier') },
      { key: 'methods', label: t('payments.method'), sortable: false, render: (s) => h('div.row.wrap', ...s.methods.map((m) => h('span.badge.outline', METHOD_LABEL(m)))) },
      { key: 'total', label: t('docs.total'), align: 'num', render: (s) => h('span', { style: { textDecoration: s.status === 'voided' ? 'line-through' : '' } }, fmt.money(s.total)) },
      { key: 'returned', label: t('sales.returned'), align: 'num', sortable: false, render: (s) => (s.returned ? fmt.money(s.returned) : '') },
      { key: 'profit', label: t('sales.profit'), align: 'num', sortable: false, hidden: !can('cost.view'), render: (s) => fmt.money(s.profit) },
      { key: 'status', label: t('common.status'), sortable: false, render: (s) => (s.status === 'voided' ? h('span.badge.danger', t('sales.voided')) : s.credit ? h('span.badge.warning', t('sales.credit')) : h('span.badge.success', t('sales.paid'))) },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('sales.list', { ...query(), ...opts });
        const tt = res.totals;
        totalsEl.replaceChildren(h('span', t('sales.totBills', { n: tt.bills })), h('span', t('sales.totSales', { v: fmt.money(tt.total) })), h('span', t('sales.totDiscount', { v: fmt.money(tt.discount) })),
          h('span', t('sales.totReturns', { v: fmt.money(tt.returned) })), h('span', t('sales.totCredit', { v: fmt.money(tt.credit) })), tt.profit !== null ? h('span', t('sales.totProfit', { v: fmt.money(tt.profit) })) : null);
        return res;
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    onRowClick: (s) => navigate('sale', { id: s.id }),
    empty: { icon: 'receipt', title: t('sales.empty') },
  });
  page.append(h('div.card', { style: { marginBottom: '12px' } }, h('div.card-body', totalsEl)), table.el);
  function reload() { table.resetPage(); table.refresh(); }
}

export async function renderDetail(page, { params, navigate }) {
  let s;
  try { s = await call('sales.get', { id: params.id }); } catch (err) { toastError(err); navigate('sales'); return; }
  const reload = () => navigate('sale', { id: s.id });
  const returnable = s.status === 'completed' && s.lines.some((l) => l.returnableQty > 0);
  const actions = [
    h('button.btn', { type: 'button', onclick: () => preview(s) }, icon('eye', 'sm'), t('sales.viewReceipt')),
    can('sales.reprint') ? h('button.btn', { type: 'button', onclick: async () => { try { await call('sales.print', { id: s.id, reprint: true }); toast(t('labels.sent')); } catch (err) { toastError(err); } } }, icon('printer', 'sm'), t('sales.reprint')) : null,
    can('sales.reprint') ? h('button.btn', { type: 'button', onclick: async () => { try { const r = await call('sales.print', { id: s.id, reprint: true, output: 'pdf' }); if (r.saved) toast(t('audit.exported', { rows: '', path: r.path })); } catch (err) { toastError(err); } } }, icon('download', 'sm'), 'PDF') : null,
    h('button.btn', { type: 'button', onclick: () => labelsDialog(s) }, t('pos.medicineLabels')),
    can('sales.return') && returnable ? h('button.btn', { type: 'button', onclick: () => returnDialog(s, reload) }, icon('upload', 'sm'), t('sales.return')) : null,
    (can('sales.void') || can('pos.create')) && s.status === 'completed' && !s.returns.length ? h('button.btn.danger', { type: 'button', onclick: async () => {
      const reason = await confirm({ title: t('sales.voidTitle', { doc: s.docNo }), text: t('sales.voidText'), confirmLabel: t('sales.void'), danger: true, requireReason: true });
      if (reason === false) return;
      const attempt = async (approvalToken) => {
        try { await call('sales.void', { id: s.id, reason, approvalToken }); toast(t('sales.voidedOk')); reload(); } catch (err) {
          if (err.code === 'NEEDS_APPROVAL') {
            const token = await askApproval(err.message, err.details.needs, { kind: 'void', summary: `${t('sales.void')} ${s.docNo}: ${reason}`, amount: s.total });
            if (token) attempt(token);
          } else toastError(err);
        }
      };
      attempt(null);
    } }, t('sales.void')) : null,
  ];
  page.append(docHeader({ title: `${t('sales.bill')} ${s.docNo}`, back: { href: '#/sales', label: t('sales.title') }, actions,
    status: s.status === 'voided' ? h('span.badge.danger', t('sales.voided')) : s.due ? h('span.badge.warning', t('sales.dueBadge', { v: fmt.money(s.due) })) : h('span.badge.success', t('sales.paid')) }));
  if (s.status === 'voided') page.append(h('div.form-error', { style: { marginBottom: '12px' } }, icon('alertCircle', 'sm'), h('div', t('sales.voidedNote', { at: fmt.dateTime(s.voidedAt), reason: s.voidReason }))));
  page.append(h('div.grid-2', { style: { alignItems: 'start' } },
    h('div.card', h('div.card-body', kv([
      [t('audit.at'), fmt.dateTime(s.soldAt)], [t('shell.branch'), s.branchName], [t('sales.cashier'), s.cashierName],
      [t('pos.customer'), s.customerId ? h('a', { href: `#/customer?id=${s.customerId}` }, s.customerName) : t('pos.walkIn')],
      s.prescription ? [t('pos.patient'), `${s.prescription.patientName}${s.prescription.patientCnic ? ' (' + s.prescription.patientCnic + ')' : ''}`] : null,
      s.prescription ? [t('pos.doctor'), `${s.prescription.doctorName}${s.prescription.doctorPmdc ? ', PMDC ' + s.prescription.doctorPmdc : ''}${s.prescription.rxNumber ? ', Rx ' + s.prescription.rxNumber : ''}`] : null,
      [t('products.notes'), s.notes],
    ]))),
    h('div.card', h('div.card-body', kv([
      [t('grn.gross'), fmt.money(s.gross)], [t('pos.discountTotal'), fmt.money(s.discount)], [t('docs.total'), h('strong', fmt.money(s.total))], [t('sales.taxIncl'), fmt.money(s.tax)],
      ...s.payments.filter((p) => p.kind === 'sale').map((p) => [METHOD_LABEL(p.method), `${fmt.money(p.amount)}${p.reference ? ' (' + p.reference + ')' : ''}`]),
      s.change ? [t('pos.change'), fmt.money(s.change)] : null, s.credit ? [t('sales.onAccount'), fmt.money(s.credit)] : null, s.credit ? [t('sales.stillDue'), fmt.money(s.due)] : null,
      s.returnedTotal ? [t('sales.returned'), fmt.money(s.returnedTotal)] : null, can('cost.view') ? [t('sales.profit'), fmt.money(s.profit)] : null,
    ])))));
  page.append(h('div', { style: { marginTop: '16px' } }, dataTable({
    id: 'sale-lines', searchable: false, rows: s.lines,
    columns: [
      { key: 'lineNo', label: '#', align: 'num' }, { key: 'productLabel', label: t('products.name'), render: (l) => h('a', { href: `#/product?id=${l.productId}` }, l.productLabel) },
      { key: 'batchNo', label: t('stock.batch'), render: (l) => h('span.mono', l.batchNo) }, { key: 'expiryDate', label: t('stock.expiry'), render: (l) => fmt.date(l.expiryDate) },
      { key: 'qtyText', label: t('docs.qty') }, { key: 'unitPrice', label: t('pos.price'), align: 'num', render: (l) => `${fmt.money(l.unitPrice)} / ${l.unitName}` },
      { key: 'discount', label: t('grn.discount'), align: 'num', render: (l) => (l.discount ? fmt.money(l.discount) : '') }, { key: 'net', label: t('docs.amount'), align: 'num', render: (l) => fmt.money(l.net) },
      { key: 'returnedQty', label: t('sales.returned'), align: 'num', render: (l) => (l.returnedQty ? qtyText(l.returnedQty, l) : '') },
    ],
  }).el));
  if (s.returns.length) {
    page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('sales.returns')), dataTable({
      id: 'sale-returns', searchable: false, rows: s.returns,
      columns: [{ key: 'docNo', label: t('docs.number'), render: (r) => h('span.mono', r.docNo) }, { key: 'at', label: t('audit.at'), render: (r) => fmt.dateTime(r.at) },
        { key: 'total', label: t('docs.total'), align: 'num', render: (r) => fmt.money(r.total) }, { key: 'refundMethod', label: t('sales.refundBy'), render: (r) => (r.refundMethod === 'account' ? t('sales.toAccount') : t(`payMethod.${r.refundMethod}`)) },
        { key: 'accountAmount', label: t('sales.offAccount'), align: 'num', render: (r) => (r.accountAmount ? fmt.money(r.accountAmount) : '') }, { key: 'reason', label: t('common.reason') }, { key: 'by', label: t('audit.user') }],
    }).el);
  }
}

async function preview(s) {
  const { html } = await call('sales.receiptHtml', { id: s.id });
  // The receipt is built by the main process with every text escaped. DOMParser never runs scripts, and a shadow root
  // keeps the receipt styles from leaking into the app.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const host = h('div', { style: { background: '#fff', color: '#000', padding: '12px', border: '1px solid var(--border)', maxHeight: '70vh', overflow: 'auto' } });
  const root = host.attachShadow({ mode: 'open' });
  for (const st of doc.querySelectorAll('style')) root.append(st.cloneNode(true));
  root.append(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  openModal({ title: `${t('sales.bill')} ${s.docNo}`, body: [host] });
}

function labelsDialog(s) {
  const rows = s.lines.map((l) => ({ l, box: h('input', { type: 'checkbox', checked: true }), how: input({ value: l.instructions || '', maxlength: 200, placeholder: t('pos.instructionsPh') }) }));
  const ok = h('button.btn.primary', { type: 'button' }, icon('printer', 'sm'), t('labels.printNow'));
  const m = openModal({ title: t('pos.medicineLabels'), size: 'wide', body: rows.map((r) => h('div.row', { style: { marginBottom: '8px' } }, r.box, h('span', { style: { width: '220px' } }, r.l.productLabel), r.how)), footer: [ok] });
  ok.onclick = () => busy(ok, null, async () => {
    try { await call('sales.labels', { id: s.id, lines: rows.filter((r) => r.box.checked).map((r) => ({ lineId: r.l.id, instructions: r.how.value })) }); m.close(); } catch (err) { toastError(err); }
  });
}

function returnDialog(s, done) {
  const form = new Form();
  const rows = s.lines.filter((l) => l.returnableQty > 0).map((l) => {
    const q = qtyInput(l, { value: 0 });
    const cond = select(['restock', 'damaged', 'expired', 'quarantine'].map((c) => ({ value: c, label: t(`returnCondition.${c}`) })), { style: { width: '170px' } });
    return { l, q, cond, row: h('tr', h('td', l.productLabel, h('div.small.faint', `${l.batchNo} - ${t('sales.canReturn', { qty: l.returnableText })}`)), h('td', q), h('td', cond)) };
  });
  const method = select([
    { value: 'cash', label: t('payMethod.cash') }, { value: 'card', label: t('payMethod.card') }, { value: 'easypaisa', label: 'Easypaisa' }, { value: 'jazzcash', label: 'JazzCash' }, { value: 'bank', label: t('payMethod.bank') },
    ...(s.customerId ? [{ value: 'account', label: t('sales.toAccount') }] : []),
  ]);
  const reason = input({ maxlength: 300 });
  const save = h('button.btn.primary', { type: 'button' }, t('sales.confirmReturn'));
  const m = openModal({
    title: t('sales.returnTitle', { doc: s.docNo }), size: 'wide',
    body: [h('p.small.muted', { style: { marginBottom: '12px' } }, s.due ? t('sales.returnDueNote', { v: fmt.money(s.due) }) : t('sales.returnNote')), form.errorBox,
      h('table.diff', h('thead', h('tr', h('th', t('products.name')), h('th', t('sales.returnQty')), h('th', t('sales.condition')))), h('tbody', ...rows.map((r) => r.row))),
      h('div.form-grid', { style: { marginTop: '12px' } }, form.add('refundMethod', fieldText(method, t('sales.refundBy'))), form.add('reason', fieldText(reason, t('common.reason'), { required: true })))],
    footer: [save],
  });
  const send = async (approvalToken) => {
    try {
      const res = await call('sales.return', { saleId: s.id, refundMethod: method.value, reason: reason.value, approvalToken, lines: rows.map((r) => ({ lineId: r.l.id, qty: r.q.getValue(), condition: r.cond.value })).filter((x) => x.qty > 0) });
      m.close();
      toast(res.refundAmount ? t('sales.refundGive', { v: fmt.money(res.refundAmount) }) : t('sales.returnAccountOk', { v: fmt.money(res.accountAmount) }), { timeout: 7000 });
      done();
    } catch (err) {
      if (err.code === 'NEEDS_APPROVAL') {
        const token = await askApproval(err.message, err.details.needs, { kind: 'return' });
        if (token) await send(token);
        return;
      }
      form.showError({ message: err.message, field: err.field === 'reason' || err.field === 'refundMethod' ? err.field : null });
    }
  };
  save.onclick = () => busy(save, null, () => send());
}

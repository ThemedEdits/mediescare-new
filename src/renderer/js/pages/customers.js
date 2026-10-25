// Customers and patients: list, profile, account statement, unpaid bills, payments received, bill history.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, textarea, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { docHeader, kv, moneyInput, rupees, filterSelect, dateFilter, exportButton } from '../ui/stockui.js';
import { receivePaymentDialog } from './pos.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const f = { status: 'active', owing: '' };
  const add = can('customers.create') ? h('button.btn.primary', { type: 'button', onclick: () => customerForm(null, (c) => navigate('customer', { id: c.id })) }, icon('plus', 'sm'), t('customers.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('customers.title')), h('p.sub', t('customers.sub'))), h('div.row',
    exportButton({ source: 'customers.list', title: t('customers.title'), perm: 'customers.export', getParams: () => ({ ...f }), columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'cnic', label: 'CNIC' }, { key: 'creditLimit', label: 'Credit limit', type: 'money' },
      { key: 'balance', label: 'Owes', type: 'money', total: true },
    ] }), add)));
  const statusSel = filterSelect([{ value: 'active', label: t('common.active') }, { value: 'inactive', label: t('common.inactive') }, { value: 'all', label: t('common.all') }], (v) => { f.status = v; reload(); }, { width: '130px' });
  const owing = h('label.check', h('input', { type: 'checkbox', onchange: (e) => { f.owing = e.target.checked ? '1' : ''; reload(); } }), h('span', t('customers.onlyOwing')));
  const table = dataTable({
    id: 'customers', tools: [statusSel, owing], searchPlaceholder: t('customers.searchPh'),
    columns: [
      { key: 'name', label: t('users.fullName'), render: (c) => h('div', h('div.cell-main.row', c.name, !c.active ? h('span.badge', t('common.inactive')) : null), h('div.cell-sub', c.code)) },
      { key: 'phone', label: t('users.phone'), sortable: false },
      { key: 'creditLimit', label: t('suppliers.creditLimit'), align: 'num', sortable: false, render: (c) => (c.creditLimit ? fmt.money(c.creditLimit) : '') },
      { key: 'discountBp', label: t('customers.usualDiscount'), align: 'num', sortable: false, render: (c) => (c.discountBp ? `${c.discountBp / 100}%` : '') },
      { key: 'balance', label: t('customers.owes'), align: 'num', render: (c) => (c.balance ? h('strong', { style: { color: c.creditLimit && c.balance > c.creditLimit ? 'var(--danger)' : '' } }, fmt.money(c.balance)) : '') },
    ],
    fetch: async (opts) => { try { return await call('customers.list', { ...f, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (c) => navigate('customer', { id: c.id }),
    empty: { icon: 'users', title: t('customers.empty') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
  if (params.new && add) { history.replaceState(null, '', '#/customers'); add.click(); }
}

export function customerForm(c, onSaved) {
  const isNew = !c;
  const v = c || {};
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: isNew ? t('customers.add') : t('customers.edit'), size: 'wide',
    body: [form.errorBox, h('div.form-grid',
      form.add('name', fieldText(input({ value: v.name || '', maxlength: 120, autofocus: true }), t('users.fullName'), { required: true })),
      form.add('phone', fieldText(input({ value: v.phone || '', maxlength: 40 }), t('users.phone'))),
      form.add('cnic', fieldText(input({ value: v.cnic || '', maxlength: 20, placeholder: '35202-1234567-1' }), t('pos.cnic'))),
      form.add('code', fieldText(input({ value: v.code || '', maxlength: 20, placeholder: isNew ? t('products.skuAuto') : '' }), t('suppliers.code'))),
      form.add('address', fieldText(input({ value: v.address || '', maxlength: 300 }), t('branches.address'), { span2: true })),
      form.add('creditLimit', fieldText(moneyInput({ value: rupees(v.creditLimit || 0), readonly: !can('sales.credit') }), t('suppliers.creditLimit'), { hint: can('sales.credit') ? t('customers.creditHint') : t('customers.needsCreditRight') })),
      form.add('discount', fieldText(input({ type: 'number', min: 0, max: 100, step: '0.01', value: v.discountBp ? v.discountBp / 100 : '', readonly: !can('discount.above_limit') }), t('customers.usualDiscountPct'), { hint: t('customers.discountHint') })),
      form.add('notes', fieldText(textarea({ value: v.notes || '', maxlength: 1000 }), t('products.notes'), { span2: true })))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      const res = await call(isNew ? 'customers.create' : 'customers.update', isNew ? form.values() : { id: c.id, ...form.values() });
      m.close();
      toast(isNew ? t('customers.createdSuccess', { name: form.value('name') }) : t('customers.updatedSuccess', { name: form.value('name') }), {
        type: 'success',
        title: isNew ? t('customers.addedTitle') : t('customers.updatedTitle'),
      });
      if (onSaved) onSaved(res);
    } catch (err) { form.showError(err); }
  });
}

export async function renderDetail(page, { params, navigate }) {
  let c;
  try { c = await call('customers.get', { id: params.id }); } catch (err) { toastError(err); navigate('customers'); return; }
  const reload = () => navigate('customer', { id: c.id, tab: current });
  const actions = [
    c.balance > 0 && (can('pos.create') || can('customers.edit')) ? h('button.btn.primary', { type: 'button', onclick: () => receivePaymentDialog(c, reload) }, icon('wallet', 'sm'), t('pos.receivePayment')) : null,
    can('customers.edit') ? h('button.btn', { type: 'button', onclick: () => customerForm(c, reload) }, icon('edit', 'sm'), t('common.edit')) : null,
    can('customers.delete') ? h('button.btn', { type: 'button', class: c.active ? 'danger' : '', onclick: async () => {
      let reason = '';
      if (c.active) { reason = await confirm({ title: t('customers.deactivateTitle', { name: c.name }), text: t('customers.deactivateText'), confirmLabel: t('products.deactivate'), danger: true, requireReason: true }); if (reason === false) return; }
      try { await call('customers.setActive', { id: c.id, active: !c.active, reason }); reload(); } catch (err) { toastError(err); }
    } }, c.active ? t('products.deactivate') : t('products.activate')) : null,
  ];
  page.append(docHeader({ title: c.name, sub: [c.code, c.phone, c.cnic].filter(Boolean).join(' - '), back: { href: '#/customers', label: t('customers.title') }, actions,
    status: c.balance ? h('span.badge.warning', t('customers.owesBadge', { v: fmt.money(c.balance) })) : null }));
  const tabs = [['details', t('suppliers.tabDetails')], ['bills', t('customers.tabBills')], ['account', t('suppliers.tabAccount')], ['receipts', t('customers.tabReceipts')]];
  let current = params.tab || 'details';
  const bar = h('div.row', { style: { marginBottom: '16px' } });
  const body = h('div');
  page.append(bar, body);
  const drawBar = () => bar.replaceChildren(...tabs.map(([k, l]) => h('button.btn', { type: 'button', class: k === current ? 'primary' : '', onclick: () => { current = k; drawBar(); show(); } }, l)));

  async function show() {
    try {
      if (current === 'details') {
        mount(body, h('div.grid-2', { style: { alignItems: 'start' } },
          h('div.card', h('div.card-body', kv([[t('users.phone'), c.phone], [t('pos.cnic'), c.cnic], [t('branches.address'), c.address], [t('products.notes'), c.notes]]))),
          h('div.card', h('div.card-body', kv([[t('customers.owes'), h('strong', fmt.money(c.balance))], [t('suppliers.creditLimit'), c.creditLimit ? fmt.money(c.creditLimit) : t('customers.noCredit')],
            [t('customers.usualDiscount'), c.discountBp ? `${c.discountBp / 100}%` : t('common.none')], [t('customers.unpaidBills'), String(c.openBills.length)]])))));
      } else if (current === 'bills') {
        const res = await call('sales.list', { customerId: c.id, pageSize: 500 });
        mount(body, h('div.stack',
          c.openBills.length ? h('div.form-note', icon('info', 'sm'), h('div', t('customers.unpaidNote', { n: c.openBills.length, v: fmt.money(c.openBills.reduce((a, b) => a + b.due, 0)) }))) : null,
          dataTable({
            id: 'customer-bills', rows: res.rows, searchable: false,
            columns: [
              { key: 'docNo', label: t('sales.bill'), render: (s) => h('a.mono', { href: `#/sale?id=${s.id}` }, s.docNo) }, { key: 'soldAt', label: t('audit.at'), render: (s) => fmt.dateTime(s.soldAt) },
              { key: 'total', label: t('docs.total'), align: 'num', render: (s) => fmt.money(s.total) }, { key: 'credit', label: t('sales.onAccount'), align: 'num', render: (s) => (s.credit ? fmt.money(s.credit) : '') },
              { key: 'due', label: t('sales.stillDue'), align: 'num', sortable: false, render: (s) => { const b = c.openBills.find((x) => x.id === s.id); return b ? h('strong', fmt.money(b.due)) : ''; } },
              { key: 'status', label: t('common.status'), render: (s) => (s.status === 'voided' ? h('span.badge.danger', t('sales.voided')) : '') },
            ],
            empty: { icon: 'receipt', title: t('sales.empty') },
          }).el));
      } else if (current === 'account') {
        const f = { from: '', to: '' };
        const box = h('div');
        const load = async () => {
          const st = await call('customers.statement', { id: c.id, from: f.from || undefined, to: f.to || undefined });
          mount(box, h('div.stack', h('div.row', h('span', t('suppliers.opening')), h('strong', fmt.money(st.opening)), h('span.spacer'), h('span', t('suppliers.closing')), h('strong', fmt.money(st.closing))),
            dataTable({
              id: 'customer-statement', searchable: false, rows: st.entries, pageSize: 100,
              columns: [
                { key: 'date', label: t('docs.date'), render: (e) => fmt.date(e.date) }, { key: 'type', label: t('suppliers.entryType'), render: (e) => t(`custLedger.${e.type}`) },
                { key: 'refNo', label: t('movements.document'), render: (e) => (e.refType === 'sale' ? h('a.mono', { href: `#/sale?id=${e.refId}` }, e.refNo) : h('span.mono', e.refNo || '')) },
                { key: 'description', label: t('suppliers.description') },
                { key: 'debit', label: t('customers.charged'), align: 'num', render: (e) => (e.debit ? fmt.money(e.debit) : '') },
                { key: 'credit', label: t('customers.paidReturned'), align: 'num', render: (e) => (e.credit ? fmt.money(e.credit) : '') },
                { key: 'balance', label: t('customers.owes'), align: 'num', render: (e) => fmt.money(e.balance) },
              ],
              empty: { icon: 'list', title: t('suppliers.noEntries') },
            }).el));
        };
        mount(body, h('div.stack', h('div.row', h('span.small.muted', t('common.from')), dateFilter((v) => { f.from = v; load(); }, t('common.from')), h('span.small.muted', t('common.to')), dateFilter((v) => { f.to = v; load(); }, t('common.to'))), box));
        await load();
      } else {
        const rows = await call('customers.receipts', { customerId: c.id });
        mount(body, dataTable({
          id: 'customer-receipts', rows, searchable: false,
          columns: [
            { key: 'docNo', label: t('docs.number'), render: (r) => h('span.mono', r.docNo) }, { key: 'date', label: t('docs.date'), render: (r) => fmt.date(r.date) },
            { key: 'method', label: t('payments.method'), render: (r) => t(`payMethod.${r.method}`) }, { key: 'reference', label: t('payments.reference') },
            { key: 'amount', label: t('docs.amount'), align: 'num', render: (r) => fmt.money(r.amount) },
            { key: 'allocations', label: t('customers.paidBills'), sortable: false, render: (r) => r.allocations.map((a) => a.docNo).join(', ') },
            { key: 'status', label: t('common.status'), render: (r) => (r.status === 'cancelled' ? h('span.badge.danger', t('status.cancelled')) : '') },
            { key: 'actions', label: '', render: (r) => (r.status !== 'posted' ? null : h('div.row',
              can('payments.edit_date') ? h('button.btn.sm', { type: 'button', onclick: () => changeDate(r, show) }, t('customers.changeDate')) : null,
              can('sales.void') ? h('button.btn.sm.danger', { type: 'button', onclick: async () => {
                const reason = await confirm({ title: t('customers.cancelReceiptTitle', { doc: r.docNo }), text: t('customers.cancelReceiptText'), confirmLabel: t('payments.cancel'), danger: true, requireReason: true });
                if (reason === false) return;
                try { await call('customers.cancelReceipt', { id: r.id, reason }); reload(); } catch (err) { toastError(err); }
              } }, t('payments.cancel')) : null)) },
          ],
          empty: { icon: 'wallet', title: t('customers.noReceipts') },
        }).el);
      }
    } catch (err) { mount(body, h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message))); }
  }
  drawBar();
  await show();
}

function changeDate(r, done) {
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
  const m = openModal({ title: t('customers.changeDate'), size: 'narrow', body: [form.errorBox, form.add('receivedDate', fieldText(input({ type: 'date', value: r.date }), t('docs.date'), { required: true })), form.add('reason', fieldText(input({ maxlength: 300 }), t('common.reason'), { required: true }))], footer: [save] });
  save.onclick = () => busy(save, null, async () => {
    try { await call('customers.changeReceiptDate', { id: r.id, ...form.values() }); m.close(); toast(t('common.saved')); done(); } catch (err) { form.showError(err); }
  });
}


// Suppliers: list, profile, account statement, open bills with ageing, purchase history.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, textarea, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { docHeader, kv, moneyInput, rupees, exportButton, statusBadge, dateFilter } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const add = can('suppliers.create') ? h('button.btn.primary', { type: 'button', onclick: () => supplierForm(null, (s) => navigate('supplier', { id: s.id })) }, icon('plus', 'sm'), t('suppliers.add')) : null;
  const importBtn = can('import.create') && can('suppliers.create') ? h('a.btn', { href: '#/import?kind=suppliers' }, icon('upload', 'sm'), t('import.title')) : null;
  const filter = { includeInactive: false };
  page.append(h('div.page-head', h('div', h('h1', t('suppliers.title')), h('p.sub', t('suppliers.sub'))), h('div.row', importBtn,
    exportButton({ source: 'suppliers.list', title: t('suppliers.title'), perm: 'suppliers.export', getParams: () => ({ ...filter }), columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Company' }, { key: 'contactPerson', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' },
      { key: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number' }, { key: 'creditLimit', label: 'Credit limit', type: 'money' }, { key: 'balance', label: 'Balance owed', type: 'money', total: true },
    ] }), add)));
  const inactive = h('label.check', h('input', { type: 'checkbox', onchange: (e) => { filter.includeInactive = e.target.checked; load(); } }), h('span', t('suppliers.showInactive')));
  const table = dataTable({
    id: 'suppliers', tools: [inactive], searchPlaceholder: t('suppliers.searchPh'),
    columns: [
      { key: 'code', label: t('suppliers.code'), render: (s) => h('span.mono', s.code) },
      { key: 'name', label: t('suppliers.name'), render: (s) => h('div', h('div.cell-main.row', s.name, !s.active ? h('span.badge', t('common.inactive')) : null), h('div.cell-sub', s.contactPerson || '')) },
      { key: 'phone', label: t('users.phone') },
      { key: 'city', label: t('suppliers.city') },
      { key: 'paymentTermsDays', label: t('suppliers.terms'), align: 'num', render: (s) => (s.paymentTermsDays ? t('suppliers.days', { n: s.paymentTermsDays }) : t('suppliers.cash')) },
      { key: 'balance', label: t('suppliers.balance'), align: 'num', hidden: !can('cost.view'), render: (s) => h('span', { style: { color: s.creditLimit && s.balance > s.creditLimit ? 'var(--danger)' : '' } }, fmt.money(s.balance)) },
    ],
    onRowClick: (s) => navigate('supplier', { id: s.id }),
    empty: { icon: 'truck', title: t('suppliers.empty'), action: add ? h('button.btn.primary', { type: 'button', onclick: () => add.click() }, t('suppliers.add')) : null },
  });
  page.append(table.el);
  async function load() { try { table.setRows(await call('suppliers.list', filter)); } catch (err) { toastError(err); } }
  await load();
  if (params.new && add) { history.replaceState(null, '', '#/suppliers'); add.click(); }
}

export function supplierForm(s, onSaved) {
  const isNew = !s;
  const v = s || { paymentTermsDays: 30, creditLimit: 0, contacts: [] };
  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({
    title: isNew ? t('suppliers.add') : t('suppliers.edit'), size: 'wide',
    body: [form.errorBox, h('div.form-grid',
      form.add('name', fieldText(input({ value: v.name || '', maxlength: 120, autofocus: true }), t('suppliers.name'), { required: true })),
      form.add('code', fieldText(input({ value: v.code || '', maxlength: 20, placeholder: isNew ? t('products.skuAuto') : '', style: { textTransform: 'uppercase' } }), t('suppliers.code'))),
      form.add('contactPerson', fieldText(input({ value: v.contactPerson || '', maxlength: 120 }), t('suppliers.contact'))),
      form.add('phone', fieldText(input({ value: v.phone || '', maxlength: 40 }), t('users.phone'))),
      form.add('email', fieldText(input({ value: v.email || '', maxlength: 120, type: 'email' }), t('users.email'))),
      form.add('city', fieldText(input({ value: v.city || '', maxlength: 60 }), t('suppliers.city'))),
      form.add('address', fieldText(input({ value: v.address || '', maxlength: 300 }), t('branches.address'), { span2: true })),
      form.add('licenceNo', fieldText(input({ value: v.licenceNo || '', maxlength: 60 }), t('suppliers.licence'))),
      form.add('ntn', fieldText(input({ value: v.ntn || '', maxlength: 40 }), t('branches.ntn'))),
      form.add('strn', fieldText(input({ value: v.strn || '', maxlength: 40 }), t('suppliers.strn'))),
      form.add('paymentTermsDays', fieldText(input({ type: 'number', min: 0, max: 365, value: v.paymentTermsDays }), t('suppliers.termsDays'), { hint: t('suppliers.termsHint') })),
      can('cost.view') ? form.add('creditLimit', fieldText(moneyInput({ value: rupees(v.creditLimit) }), t('suppliers.creditLimit'))) : h('span'),
      isNew && can('cost.view') ? form.add('openingBalance', fieldText(moneyInput({ value: '' }), t('suppliers.openingBalance'), { hint: t('suppliers.openingHint') })) : h('span'),
      form.add('notes', fieldText(textarea({ value: v.notes || '', maxlength: 1000 }), t('products.notes'), { span2: true })))],
    footer: [cancel, save],
  });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      const values = { ...form.values(), contacts: v.contacts };
      if (!can('cost.view')) values.creditLimit = rupees(v.creditLimit);
      const res = await call(isNew ? 'suppliers.create' : 'suppliers.update', isNew ? values : { id: s.id, ...values });
      m.close();
      toast(isNew ? t('suppliers.createdSuccess', { name: values.name }) : t('suppliers.updatedSuccess', { name: values.name }), {
        type: 'success',
        title: isNew ? t('suppliers.addedTitle') : t('suppliers.updatedTitle'),
      });
      if (onSaved) onSaved(res);
    } catch (err) { form.showError(err); }
  });
}

export async function renderDetail(page, { params, navigate }) {
  let s;
  try { s = await call('suppliers.get', { id: params.id }); } catch (err) { toastError(err); navigate('suppliers'); return; }
  const reload = () => navigate('supplier', { id: s.id, tab: current });
  const actions = [
    can('purchases.create') && can('cost.view') ? h('a.btn', { href: `#/po?new=1&supplierId=${s.id}` }, icon('plus', 'sm'), t('po.new')) : null,
    can('supplier_payments.create') && can('cost.view') ? h('a.btn', { href: `#/payments?new=1&supplierId=${s.id}` }, icon('wallet', 'sm'), t('payments.add')) : null,
    can('suppliers.edit') ? h('button.btn', { type: 'button', onclick: () => supplierForm(s, reload) }, icon('edit', 'sm'), t('common.edit')) : null,
    can('suppliers.delete') ? h('button.btn', { type: 'button', class: s.active ? 'danger' : '', onclick: async () => {
      let reason = '';
      if (s.active) { reason = await confirm({ title: t('suppliers.deactivateTitle', { name: s.name }), text: t('suppliers.deactivateText'), confirmLabel: t('products.deactivate'), danger: true, requireReason: true }); if (reason === false) return; }
      try {
        await call('suppliers.setActive', { id: s.id, active: !s.active, reason });
        toast(!s.active ? t('suppliers.activatedSuccess', { name: s.name }) : t('suppliers.deactivatedSuccess', { name: s.name }), {
          type: 'success',
          title: !s.active ? t('suppliers.activatedTitle') : t('suppliers.deactivatedTitle'),
        });
        reload();
      } catch (err) { toastError(err); }
    } }, s.active ? t('products.deactivate') : t('products.activate')) : null,
  ];
  page.append(docHeader({ title: s.name, sub: [s.code, s.city, s.phone].filter(Boolean).join(' - '), status: !s.active ? h('span.badge', t('common.inactive')) : null, back: { href: '#/suppliers', label: t('suppliers.title') }, actions }));

  const tabs = [['details', t('suppliers.tabDetails')], can('cost.view') && ['account', t('suppliers.tabAccount')], can('cost.view') && ['bills', t('suppliers.tabBills')], ['purchases', t('suppliers.tabPurchases')]].filter(Boolean);
  let current = params.tab || 'details';
  const bar = h('div.row', { style: { marginBottom: '16px' } });
  const body = h('div');
  page.append(bar, body);
  const drawBar = () => bar.replaceChildren(...tabs.map(([k, l]) => h('button.btn', { type: 'button', class: k === current ? 'primary' : '', onclick: () => { current = k; drawBar(); show(); } }, l)));

  async function show() {
    try {
      if (current === 'details') {
        mount(body, h('div.grid-2', { style: { alignItems: 'start' } },
          h('div.card', h('div.card-head', h('h2', t('suppliers.profile'))), h('div.card-body', kv([
            [t('suppliers.code'), s.code], [t('suppliers.contact'), s.contactPerson], [t('users.phone'), s.phone], [t('users.email'), s.email],
            [t('branches.address'), [s.address, s.city].filter(Boolean).join(', ')], [t('suppliers.licence'), s.licenceNo], [t('branches.ntn'), s.ntn], [t('suppliers.strn'), s.strn], [t('products.notes'), s.notes],
          ]))),
          can('cost.view') ? h('div.card', h('div.card-head', h('h2', t('suppliers.accountSummary'))), h('div.card-body', kv([
            [t('suppliers.balance'), h('strong', fmt.money(s.balance))], [t('suppliers.creditLimit'), s.creditLimit ? fmt.money(s.creditLimit) : t('common.none')],
            [t('suppliers.terms'), s.paymentTermsDays ? t('suppliers.days', { n: s.paymentTermsDays }) : t('suppliers.cash')],
            [t('suppliers.overdue'), fmt.money(s.ageing.buckets.d1_30 + s.ageing.buckets.d31_60 + s.ageing.buckets.d61_90 + s.ageing.buckets.d90plus)],
          ]))) : h('span')));
      } else if (current === 'account') {
        const f = { from: '', to: '' };
        const box = h('div');
        const load = async () => {
          const st = await call('suppliers.statement', { id: s.id, from: f.from || undefined, to: f.to || undefined });
          mount(box, h('div.stack',
            h('div.row', h('span', t('suppliers.opening')), h('strong', fmt.money(st.opening)), h('span.spacer'), h('span', t('suppliers.closing')), h('strong', fmt.money(st.closing))),
            dataTable({
              id: 'supplier-statement', searchable: false, rows: st.entries, pageSize: 100,
              columns: [
                { key: 'date', label: t('docs.date'), render: (e) => fmt.date(e.date) },
                { key: 'type', label: t('suppliers.entryType'), render: (e) => t(`ledgerType.${e.type}`) },
                { key: 'refNo', label: t('movements.document'), render: (e) => (e.refType === 'grn' ? h('a.mono', { href: `#/grn?id=${e.refId}` }, e.refNo) : e.refType === 'purchase_return' ? h('a.mono', { href: `#/purchase-return?id=${e.refId}` }, e.refNo) : e.refType === 'supplier_payment' ? h('a.mono', { href: `#/payment?id=${e.refId}` }, e.refNo) : h('span.mono', e.refNo || '')) },
                { key: 'description', label: t('suppliers.description') },
                { key: 'credit', label: t('suppliers.billed'), align: 'num', render: (e) => (e.credit ? fmt.money(e.credit) : '') },
                { key: 'debit', label: t('suppliers.paidReturned'), align: 'num', render: (e) => (e.debit ? fmt.money(e.debit) : '') },
                { key: 'balance', label: t('suppliers.balance'), align: 'num', render: (e) => fmt.money(e.balance) },
              ],
              empty: { icon: 'list', title: t('suppliers.noEntries') },
            }).el));
        };
        const from = dateFilter((v) => { f.from = v; load(); }, t('common.from'));
        const to = dateFilter((v) => { f.to = v; load(); }, t('common.to'));
        mount(body, h('div.stack', h('div.row', h('span.small.muted', t('common.from')), from, h('span.small.muted', t('common.to')), to, h('span.spacer'),
          exportButton({ source: 'suppliers.statement', title: `${t('suppliers.statement')} ${s.name}`, perm: 'suppliers.export', getParams: () => ({ id: s.id, from: f.from || undefined, to: f.to || undefined }), columns: [
            { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'refNo', label: 'Document' }, { key: 'description', label: 'Description' },
            { key: 'credit', label: 'Billed', type: 'money', total: true }, { key: 'debit', label: 'Paid or returned', type: 'money', total: true }, { key: 'balance', label: 'Balance', type: 'money' },
          ] })), box));
        await load();
      } else if (current === 'bills') {
        const a = s.ageing;
        const bucket = (label, v) => h('div.card', h('div.card-body', h('div.small.muted', label), h('div', { style: { fontSize: '18px', fontWeight: 600 } }, fmt.money(v))));
        mount(body, h('div.stack',
          h('div.grid-3', { style: { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' } }, bucket(t('ageing.current'), a.buckets.current), bucket(t('ageing.d1_30'), a.buckets.d1_30), bucket(t('ageing.d31_60'), a.buckets.d31_60), bucket(t('ageing.d61_90'), a.buckets.d61_90), bucket(t('ageing.d90plus'), a.buckets.d90plus)),
          a.unallocatedCredit ? h('div.form-note', icon('info', 'sm'), h('div', t('ageing.unallocated', { value: fmt.money(a.unallocatedCredit), balance: fmt.money(a.balance) }))) : null,
          dataTable({
            id: 'supplier-bills', searchable: false, rows: a.bills,
            columns: [
              { key: 'docNo', label: t('docs.number'), render: (b) => h('a.mono', { href: `#/grn?id=${b.id}` }, b.docNo) },
              { key: 'invoiceNo', label: t('grn.invoiceNo') }, { key: 'date', label: t('docs.date'), render: (b) => fmt.date(b.date) },
              { key: 'dueDate', label: t('grn.dueDate'), render: (b) => fmt.date(b.dueDate) },
              { key: 'daysOverdue', label: t('ageing.daysOverdue'), align: 'num', render: (b) => (b.daysOverdue ? h('span.badge.danger', String(b.daysOverdue)) : '') },
              { key: 'total', label: t('docs.total'), align: 'num', render: (b) => fmt.money(b.total) }, { key: 'paid', label: t('payments.paid'), align: 'num', render: (b) => fmt.money(b.paid) },
              { key: 'due', label: t('payments.due'), align: 'num', render: (b) => h('strong', fmt.money(b.due)) },
            ],
            empty: { icon: 'check', title: t('suppliers.noBills') },
          }).el));
      } else {
        const rows = await call('suppliers.history', { id: s.id });
        mount(body, dataTable({
          id: 'supplier-history', rows, searchable: false,
          columns: [
            { key: 'docNo', label: t('docs.number'), render: (r) => h('a.mono', { href: `#/grn?id=${r.grnId}` }, r.docNo) }, { key: 'date', label: t('docs.date'), render: (r) => fmt.date(r.date) },
            { key: 'invoiceNo', label: t('grn.invoiceNo') }, { key: 'status', label: t('common.status'), render: (r) => statusBadge(r.status) },
            { key: 'total', label: t('docs.total'), align: 'num', hidden: !can('cost.view'), render: (r) => fmt.money(r.total) },
          ],
          empty: { icon: 'truck', title: t('suppliers.noPurchases') },
        }).el);
      }
    } catch (err) { mount(body, h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message))); }
  }
  drawBar();
  await show();
}

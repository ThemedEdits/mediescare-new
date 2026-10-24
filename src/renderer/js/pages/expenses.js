// Expenses (rent, salaries, bills, tea) and the petty cash book.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { toast, toastError } from '../ui/toast.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, checkbox, busy } from '../ui/form.js';
import { exportButton, printButton, filterSelect, moneyInput, kv } from '../ui/stockui.js';
import { rangeControls, datePresets } from './reports.js';
import { askApproval } from './posapproval.js';
import * as fmt from '../ui/format.js';

const METHODS = ['drawer', 'petty', 'bank', 'card', 'online'];
const STATUS_TONE = { posted: 'success', pending: 'warning', rejected: 'danger', cancelled: 'outline' };

function statusBadge(s) {
  return h('span.badge', { class: STATUS_TONE[s] || 'outline' }, t(`expenses.status.${s}`));
}

const COLUMNS = [
  { key: 'date', label: 'Date', type: 'date' }, { key: 'docNo', label: 'Expense' }, { key: 'categoryName', label: 'Category' }, { key: 'description', label: 'Description' },
  { key: 'paidTo', label: 'Paid to' }, { key: 'method', label: 'Paid from' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', type: 'money', total: true },
  { key: 'status', label: 'Status' }, { key: 'requestedBy', label: 'Entered by' }, { key: 'decidedBy', label: 'Approved by' },
];

export async function render(page, { params, navigate }) {
  const month = datePresets().find((p) => p.key === 'month');
  const f = { from: params.from || month.from, to: params.to || month.to, categoryId: '', method: '', status: '' };
  let cats = await call('expenses.categories', {}).catch(() => []);
  const query = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const totalsEl = h('div.stat-grid');
  page.append(h('div.page-head', h('div', h('h1', t('expenses.title')), h('p.sub', t('expenses.sub'))),
    h('div.row', can('expenses.edit') ? h('button.btn', { type: 'button', onclick: () => manageCategories() }, icon('list', 'sm'), t('expenses.categories')) : null,
      can('expenses.view') ? h('a.btn', { href: '#/petty-cash' }, icon('box', 'sm'), t('nav.pettyCash')) : null,
      printButton({ source: 'expenses.list', title: t('expenses.title'), perm: 'expenses.export', getParams: query, columns: COLUMNS }),
      exportButton({ source: 'expenses.list', title: t('expenses.title'), perm: 'expenses.export', getParams: query, columns: COLUMNS }),
      can('expenses.create') ? h('button.btn.primary', { type: 'button', onclick: () => addExpense() }, icon('plus', 'sm'), t('expenses.add')) : null)));
  const catSel = () => filterSelect([{ value: '', label: t('expenses.anyCategory') }, ...cats.map((c) => ({ value: c.id, label: c.name }))], (v) => { f.categoryId = v; reload(); }, { width: '190px' });
  page.append(h('div.filter-bar', ...rangeControls(f, reload), catSel(),
    filterSelect([{ value: '', label: t('expenses.anyMethod') }, ...METHODS.map((m) => ({ value: m, label: t(`expenses.method.${m}`) }))], (v) => { f.method = v; reload(); }, { width: '170px' }),
    filterSelect([{ value: '', label: t('expenses.anyStatus') }, ...Object.keys(STATUS_TONE).map((s) => ({ value: s, label: t(`expenses.status.${s}`) }))], (v) => { f.status = v; reload(); }, { width: '170px' })), totalsEl);

  const table = dataTable({
    id: 'expenses', searchPlaceholder: t('expenses.searchPh'), pageSize: 50,
    columns: [
      { key: 'date', label: t('common.date'), sortable: false, render: (e) => fmt.date(e.date) },
      { key: 'docNo', label: t('expenses.doc'), sortable: false, render: (e) => h('span.mono', e.docNo) },
      { key: 'categoryName', label: t('expenses.category'), sortable: false },
      { key: 'description', label: t('expenses.description'), sortable: false, render: (e) => h('div', h('div.cell-main', e.description), e.paidTo ? h('div.cell-sub', e.paidTo) : null) },
      { key: 'method', label: t('expenses.paidFrom'), sortable: false, render: (e) => t(`expenses.method.${e.method}`) },
      { key: 'amount', label: t('expenses.amount'), align: 'num', sortable: false, render: (e) => fmt.money(e.amount) },
      { key: 'status', label: t('common.status'), sortable: false, render: (e) => statusBadge(e.status) },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('expenses.list', { ...query(), q: opts.search, page: opts.page, pageSize: opts.pageSize });
        mount(totalsEl, h('div.stat', h('span.stat-label', t('expenses.totalPosted')), h('span.stat-value', fmt.money(res.totals.posted))),
          h('div.stat', { class: res.totals.pending ? 'warn' : '' }, h('span.stat-label', t('expenses.totalPending')), h('span.stat-value', fmt.money(res.totals.pending))));
        return res;
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    onRowClick: (e) => showExpense(e.id),
    empty: { icon: 'wallet', title: t('expenses.empty') },
  });
  page.append(table.el);

  function reload() { table.resetPage(); table.refresh(); }

  async function showExpense(id) {
    let e;
    try { e = await call('expenses.get', { id }); } catch (err) { toastError(err); return; }
    const actions = [];
    if (e.status === 'pending' && can('expenses.approve')) {
      actions.push(h('button.btn', { type: 'button', onclick: () => decide(false) }, t('approvals.reject')), h('button.btn.primary', { type: 'button', onclick: () => decide(true) }, t('approvals.approve')));
    }
    if ((e.status === 'posted' && can('expenses.edit')) || e.status === 'pending') {
      actions.unshift(h('button.btn.danger', { type: 'button', onclick: async () => {
        const reason = await confirm({ title: t('expenses.cancelTitle', { doc: e.docNo }), text: e.method === 'drawer' && e.status === 'posted' ? t('expenses.cancelDrawer') : t('expenses.cancelText'), confirmLabel: t('expenses.cancel'), danger: true, requireReason: true });
        if (!reason) return;
        try { await call('expenses.cancel', { id: e.id, reason }); toast(t('expenses.cancelled')); m.close(); reload(); } catch (err) { toastError(err); }
      } }, t('expenses.cancel')));
    }
    const m = openModal({ title: `${e.docNo}`, body: [h('div.row', { style: { marginBottom: '12px' } }, statusBadge(e.status)), kv([
      [t('common.date'), fmt.date(e.date)], [t('expenses.category'), e.categoryName], [t('expenses.description'), e.description], [t('expenses.paidTo'), e.paidTo],
      [t('expenses.amount'), fmt.money(e.amount)], [t('expenses.paidFrom'), t(`expenses.method.${e.method}`)], [t('expenses.reference'), e.reference],
      [t('expenses.enteredBy'), `${e.requestedBy || ''} - ${fmt.dateTime(e.createdAt)}`], e.decidedBy ? [t('expenses.decidedBy'), `${e.decidedBy} - ${fmt.dateTime(e.decidedAt)}`] : null,
      e.decisionReason ? [t('common.reason'), e.decisionReason] : null, e.cancelledBy ? [t('expenses.cancelledBy'), `${e.cancelledBy} - ${fmt.dateTime(e.cancelledAt)}: ${e.cancelReason}`] : null,
    ])], footer: actions.length ? actions : null });
    async function decide(approve) {
      const reason = approve ? '' : await confirm({ title: t('approvals.rejectTitle'), text: e.description, confirmLabel: t('approvals.reject'), danger: true, requireReason: true });
      if (!approve && !reason) return;
      try { await call('expenses.decide', { id: e.id, approve, reason }); toast(approve ? t('approvals.approvedOk') : t('approvals.rejectedOk')); m.close(); reload(); } catch (err) { toastError(err); }
    }
  }

  function addExpense() {
    const form = new Form();
    const today = datePresets()[0].from;
    const dateEl = input({ type: 'date', value: today, max: today });
    const catEl = select([{ value: '', label: t('common.selectPlaceholder') }, ...cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]);
    const desc = input({ maxlength: 200 });
    const paidTo = input({ maxlength: 120 });
    const amount = moneyInput({});
    const method = select(METHODS.map((x) => ({ value: x, label: t(`expenses.method.${x}`) })), { value: 'drawer' });
    const ref = input({ maxlength: 60 });
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const m = openModal({ title: t('expenses.add'), body: [form.errorBox, h('div.form-grid',
      form.add('date', fieldText(dateEl, t('common.date'), { required: true })), form.add('categoryId', fieldText(catEl, t('expenses.category'), { required: true })),
      form.add('description', fieldText(desc, t('expenses.description'), { required: true, span2: true })), form.add('paidTo', fieldText(paidTo, t('expenses.paidTo'))),
      form.add('amount', fieldText(amount, t('expenses.amount'), { required: true })), form.add('method', fieldText(method, t('expenses.paidFrom'), { required: true, hint: t('expenses.methodHint') })),
      form.add('reference', fieldText(ref, t('expenses.reference'), { hint: t('expenses.referenceHint') })))], footer: [save] });
    async function submit(token) {
      const v = form.values();
      try {
        const e = await call('expenses.create', { ...v, approvalToken: token });
        toast(e.status === 'pending' ? t('expenses.savedPending', { doc: e.docNo }) : t('expenses.saved', { doc: e.docNo }));
        m.close();
        reload();
      } catch (err) {
        if (err.code === 'NEEDS_APPROVAL') {
          const tok = await askApproval(err.message, err.details.needs, { kind: 'expense', summary: `${v.description} (${v.amount})` });
          if (tok) return submit(tok);
          return;
        }
        form.showError(err);
      }
    }
    save.onclick = () => busy(save, null, () => submit(null));
  }

  async function manageCategories() {
    const list = h('div.stack.tight');
    const name = input({ maxlength: 80, placeholder: t('expenses.newCategory') });
    const add = h('button.btn', { type: 'button' }, icon('plus', 'sm'), t('common.create'));
    const paint = () => mount(list, ...cats.map((c) => {
      const box = h('input', { type: 'checkbox', checked: c.active });
      const nm = input({ value: c.name, maxlength: 80 });
      const save = async () => {
        try { cats = await call('expenses.saveCategory', { id: c.id, name: nm.value, active: box.checked }); toast(t('common.saved')); } catch (err) { toastError(err); nm.value = c.name; box.checked = c.active; }
      };
      nm.addEventListener('change', save);
      box.addEventListener('change', save);
      return h('div.row', h('label.check', box, h('span.sr-only', t('common.active'))), nm);
    }));
    add.onclick = async () => {
      try { cats = await call('expenses.saveCategory', { name: name.value }); name.value = ''; paint(); } catch (err) { toastError(err); }
    };
    paint();
    openModal({ title: t('expenses.categories'), body: [h('p.small.muted', { style: { marginBottom: '10px' } }, t('expenses.categoriesHint')), list, h('div.row', { style: { marginTop: '12px' } }, name, add)] });
  }

  if (params.new && can('expenses.create')) addExpense();
  if (params.id) showExpense(params.id);
}

// The petty cash book: top-ups and expenses with a running balance.
export async function renderPetty(page) {
  const month = datePresets().find((p) => p.key === 'month');
  const f = { from: month.from, to: month.to };
  const balEl = h('div.stat-grid');
  const body = h('div');
  const COLS = [
    { key: 'date', label: 'Date', type: 'date' }, { key: 'kind', label: 'Entry' }, { key: 'docNo', label: 'Expense' }, { key: 'description', label: 'Description' },
    { key: 'moneyIn', label: 'In', type: 'money', total: true }, { key: 'moneyOut', label: 'Out', type: 'money', total: true }, { key: 'balance', label: 'Balance', type: 'money' }, { key: 'user', label: 'By' },
  ];
  page.append(h('div.page-head', h('div', h('a.small', { href: '#/expenses' }, t('nav.expenses')), h('h1', t('petty.title')), h('p.sub', t('petty.sub'))),
    h('div.row', printButton({ source: 'pettycash.book', title: t('petty.title'), perm: 'expenses.export', getParams: () => ({ ...f }), columns: COLS }),
      exportButton({ source: 'pettycash.book', title: t('petty.title'), perm: 'expenses.export', getParams: () => ({ ...f }), columns: COLS }),
      can('expenses.create') ? h('button.btn', { type: 'button', onclick: () => move('withdraw') }, t('petty.withdraw')) : null,
      can('expenses.create') ? h('button.btn.primary', { type: 'button', onclick: () => move('topup') }, icon('plus', 'sm'), t('petty.topup')) : null)),
  h('div.filter-bar', ...rangeControls(f, load)), balEl, body);

  async function load() {
    body.classList.add('refetching');
    let b;
    try { b = await call('pettycash.book', { ...f }); } catch (err) { toastError(err); body.classList.remove('refetching'); return; }
    body.classList.remove('refetching');
    mount(balEl, h('div.stat', h('span.stat-label', t('petty.balance')), h('span.stat-value', fmt.money(b.balance))),
      h('div.stat', h('span.stat-label', t('petty.opening')), h('span.stat-value', fmt.money(b.opening))), h('div.stat', h('span.stat-label', t('petty.closing')), h('span.stat-value', fmt.money(b.closing))));
    const table = dataTable({
      id: 'petty', searchable: false, pageSize: 100, rows: b.entries,
      columns: [
        { key: 'date', label: t('common.date'), render: (e) => fmt.date(e.date) },
        { key: 'kind', label: t('petty.entry'), render: (e) => t(`petty.kind.${e.kind}`) },
        { key: 'description', label: t('expenses.description'), render: (e) => h('div', h('div', e.description || ''), e.docNo ? h('div.cell-sub', `${e.docNo}${e.category ? ` - ${e.category}` : ''}`) : null) },
        { key: 'moneyIn', label: t('petty.in'), align: 'num', render: (e) => (e.moneyIn ? fmt.money(e.moneyIn) : '') },
        { key: 'moneyOut', label: t('petty.out'), align: 'num', render: (e) => (e.moneyOut ? fmt.money(e.moneyOut) : '') },
        { key: 'balance', label: t('petty.runningBalance'), align: 'num', render: (e) => fmt.money(e.balance) },
        { key: 'user', label: t('petty.by') },
      ],
      empty: { icon: 'box', title: t('petty.empty') },
    });
    mount(body, table.el);
  }

  function move(kind) {
    const form = new Form();
    const amount = moneyInput({ autofocus: true });
    const reason = input({ maxlength: 200 });
    const drawer = checkbox(kind === 'topup' ? t('petty.fromDrawer') : t('petty.toDrawer'));
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const m = openModal({ title: kind === 'topup' ? t('petty.topup') : t('petty.withdraw'), size: 'narrow', body: [form.errorBox,
      form.add('amount', fieldText(amount, t('expenses.amount'), { required: true })), form.add('reason', fieldText(reason, t('common.reason'), { required: true })),
      form.add('viaDrawer', { el: drawer, input: drawer.control, setError() {}, clearError() {} }), h('p.small.muted', t('petty.drawerHint'))], footer: [save] });
    save.onclick = () => busy(save, null, async () => {
      try { await call('pettycash.move', { kind, ...form.values() }); toast(t('common.saved')); m.close(); load(); } catch (err) { form.showError(err); }
    });
  }
  await load();
}

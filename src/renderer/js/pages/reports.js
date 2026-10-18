// Reports: the list of reports this person may run, and one report with its filters, an optional chart, the table
// with totals, print, PDF and Excel/CSV export. Rows open the record behind them.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { toastError } from '../ui/toast.js';
import { combobox } from '../ui/combobox.js';
import { exportButton, printButton, filterSelect, productPicker } from '../ui/stockui.js';
import { lineChart, barChart, chartCard } from '../ui/charts.js';
import * as fmt from '../ui/format.js';

const GROUPS = ['sales', 'money', 'purchases', 'stock'];

export async function render(page, { navigate }) {
  let catalog = [];
  try { catalog = await call('reports.catalog'); } catch (err) { toastError(err); }
  page.append(h('div.page-head', h('div', h('h1', t('reports.title')), h('p.sub', t('reports.sub')))));
  for (const g of GROUPS) {
    const items = catalog.filter((r) => r.group === g);
    const extra = [];
    if (g === 'sales' && can('controlled.view')) extra.push({ title: t('nav.controlled'), go: () => navigate('controlled') });
    if (g === 'stock' && can('stock.view')) extra.push({ title: t('nav.movements'), go: () => navigate('movements') }, { title: t('nav.stockReports'), go: () => navigate('stock-reports') });
    if (g === 'money' && can('finance.view')) extra.push({ title: t('nav.finance'), go: () => navigate('finance') });
    if (g === 'money' && can('expenses.view')) extra.push({ title: t('nav.pettyCash'), go: () => navigate('petty-cash') });
    if (!items.length && !extra.length) continue;
    page.append(h('div.card', h('div.card-head', h('h2', t(`reports.group.${g}`))), h('div.card-body', h('div.report-list',
      ...items.map((r) => h('button.choice', { type: 'button', onclick: () => navigate('report', { key: r.key }) }, h('div.row', icon('chart', 'sm'), h('h3', r.title)), h('p.small.muted', t(`reports.about.${r.key}`)))),
      ...extra.map((x) => h('button.choice', { type: 'button', onclick: x.go }, h('div.row', icon('arrowRight', 'sm'), h('h3', x.title)), h('p.small.muted', t('reports.openPage'))))))));
  }
  if (!catalog.length) page.append(h('div.card', h('div.empty', icon('chart'), h('h3', t('reports.none')))));
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Date range presets first, then the two dates for anything else.
export function datePresets() {
  const now = new Date();
  const day = (offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); return iso(d); };
  return [
    { key: 'today', label: t('range.today'), from: day(0), to: day(0) },
    { key: 'yesterday', label: t('range.yesterday'), from: day(-1), to: day(-1) },
    { key: '7', label: t('range.last7'), from: day(-6), to: day(0) },
    { key: '30', label: t('range.last30'), from: day(-29), to: day(0) },
    { key: 'month', label: t('range.thisMonth'), from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(0) },
    { key: 'lastMonth', label: t('range.lastMonth'), from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { key: 'year', label: t('range.thisYear'), from: iso(new Date(now.getFullYear(), 0, 1)), to: day(0) },
  ];
}

// A row of date controls: preset select plus from/to dates. Calls onChange({ from, to }).
export function rangeControls(f, onChange) {
  const presets = datePresets();
  const fromEl = h('input.input', { type: 'date', value: f.from, style: { width: '150px' }, 'aria-label': t('common.from') });
  const toEl = h('input.input', { type: 'date', value: f.to, style: { width: '150px' }, 'aria-label': t('common.to') });
  const match = presets.find((p) => p.from === f.from && p.to === f.to);
  const sel = filterSelect([...presets.map((p) => ({ value: p.key, label: p.label })), { value: 'custom', label: t('range.custom') }], (v) => {
    const p = presets.find((x) => x.key === v);
    if (!p) return;
    f.from = p.from; f.to = p.to; fromEl.value = p.from; toEl.value = p.to;
    onChange();
  }, { value: match ? match.key : 'custom', width: '150px', label: t('range.period') });
  const changed = () => { if (!fromEl.value || !toEl.value) return; f.from = fromEl.value; f.to = toEl.value; sel.value = 'custom'; onChange(); };
  fromEl.addEventListener('change', changed);
  toEl.addEventListener('change', changed);
  return [sel, fromEl, toEl];
}

function cellText(c, v) {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return fmt.money(v);
  if (c.type === 'date') return fmt.date(v);
  if (c.type === 'datetime') return fmt.dateTime(v);
  if (c.type === 'number') return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
  return String(v);
}

export async function renderReport(page, { params, navigate }) {
  const catalog = await call('reports.catalog').catch(() => []);
  const def = catalog.find((r) => r.key === params.key);
  if (!def) { navigate('reports'); return; }
  const thirty = datePresets().find((p) => p.key === (def.key === 'monthly_sales' ? 'year' : 'today'));
  const f = {
    report: def.key, from: params.from || thirty.from, to: params.to || thirty.to, branchId: params.branchId || '', productId: params.productId || '', categoryId: params.categoryId || '',
    supplierId: params.supplierId || '', customerId: params.customerId || '', userId: params.userId || '', method: params.method || '', days: params.days || '90',
  };
  const has = (k) => def.filters.includes(k);
  const head = h('div.page-head');
  const filters = h('div.filter-bar');
  const out = h('div');
  page.append(head, filters, out);
  let last = null;
  const query = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== null));
  const exportCols = () => (last ? last.columns : []);
  mount(head, h('div', h('a.small', { href: '#/reports' }, icon('chevronLeft', 'sm'), t('reports.title')), h('h1', def.title), h('p.sub', t(`reports.about.${def.key}`))),
    h('div.row', printButton({ source: 'reports.run', title: def.title, perm: 'reports.export', getParams: query, columns: exportCols }),
      exportButton({ source: 'reports.run', title: def.title, perm: 'reports.export', getParams: query, columns: exportCols })));

  const controls = [];
  if (has('dates')) controls.push(...rangeControls(f, run));
  if (has('branch') && can('branches.view_all')) {
    const branches = await call('branches.list', {}).catch(() => []);
    controls.push(filterSelect([{ value: '', label: state.me.branch.name }, ...branches.filter((b) => b.id !== state.me.branch.id).map((b) => ({ value: b.id, label: b.name })), { value: 'all', label: t('reports.allBranches') }],
      (v) => { f.branchId = v; run(); }, { value: f.branchId, width: '180px', label: t('shell.branch') }));
  }
  if (has('product')) {
    const chosen = h('span.row');
    const clear = () => { f.productId = ''; chosen.replaceChildren(); run(); };
    const picker = productPicker({ placeholder: t('reports.anyProduct'), includeInactive: true, onPick: (p) => {
      f.productId = p.id;
      chosen.replaceChildren(h('span.badge.outline', p.label), h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('reports.anyProduct'), onclick: clear }, icon('x', 'sm')));
      run();
    } });
    controls.push(h('div', { style: { width: '240px' } }, picker), chosen);
  }
  if (has('category')) {
    const cats = await call('lookups.list', { kind: 'category' }).catch(() => []);
    const c = combobox({ options: cats.map((x) => ({ value: x.id, label: x.name })), value: f.categoryId, emptyLabel: t('reports.anyCategory'), onChange: (v) => { f.categoryId = v; run(); } });
    c.style.width = '190px';
    controls.push(c);
  }
  if (has('supplier')) {
    const res = await call('suppliers.list', { pageSize: 500 }).catch(() => []);
    const list = Array.isArray(res) ? res : res.rows || [];
    const c = combobox({ options: list.map((x) => ({ value: x.id, label: x.name, sub: x.code })), value: f.supplierId, emptyLabel: t('reports.anySupplier'), onChange: (v) => { f.supplierId = v; run(); } });
    c.style.width = '200px';
    controls.push(c);
  }
  if (has('customer')) {
    const res = await call('customers.list', { pageSize: 500 }).catch(() => ({ rows: [] }));
    const list = Array.isArray(res) ? res : res.rows || [];
    const c = combobox({ options: list.map((x) => ({ value: x.id, label: x.name, sub: x.phone })), value: f.customerId, emptyLabel: t('reports.anyCustomer'), onChange: (v) => { f.customerId = v; run(); } });
    c.style.width = '200px';
    controls.push(c);
  }
  if (has('user')) {
    const users = await call('users.list', {}).catch(() => []);
    const c = combobox({ options: users.map((u) => ({ value: u.id, label: u.fullName, sub: u.username })), value: f.userId, emptyLabel: t('reports.anyUser'), onChange: (v) => { f.userId = v; run(); } });
    c.style.width = '190px';
    controls.push(c);
  }
  if (has('method')) {
    controls.push(filterSelect([{ value: '', label: t('reports.anyMethod') }, ...['drawer', 'petty', 'bank', 'card', 'online'].map((m) => ({ value: m, label: t(`expenses.method.${m}`) }))],
      (v) => { f.method = v; run(); }, { value: f.method, width: '170px' }));
  }
  if (has('days')) {
    const daysEl = h('input.input', { type: 'number', min: 0, max: 3650, value: f.days, style: { width: '100px' }, 'aria-label': t('reports.days') });
    daysEl.addEventListener('change', () => { f.days = daysEl.value || '90'; run(); });
    controls.push(h('label.row.small.muted', t('reports.days'), daysEl));
  }
  mount(filters, ...controls);

  async function run() {
    out.classList.add('refetching');
    let res;
    try { res = await call('reports.run', query()); } catch (err) { toastError(err); out.classList.remove('refetching'); return; }
    last = res;
    out.classList.remove('refetching');
    const cols = res.columns;
    const num = (c) => c.type === 'money' || c.type === 'number';
    const table = h('div.card', h('div.card-head', h('div', h('h2', res.title), h('p.small.muted', [res.branchName, res.from ? `${fmt.date(res.from)} - ${fmt.date(res.to)}` : null, t('reports.rows', { n: res.rows.length })].filter(Boolean).join('  |  ')))),
      h('div.table-scroll', h('table.data',
        h('thead', h('tr', ...cols.map((c) => h('th', { class: num(c) ? 'num' : '', scope: 'col' }, c.label)))),
        h('tbody', ...(res.rows.length ? res.rows.map((r) => {
          const tr = h('tr', { class: [r.link ? 'clickable' : '', r.flag ? 'flag' : ''].join(' ') }, ...cols.map((c) => h('td', { class: num(c) ? 'num' : '' }, cellText(c, r[c.key]))));
          if (r.link) {
            tr.tabIndex = 0;
            tr.addEventListener('click', () => navigate(r.link.path, r.link.params));
            tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(r.link.path, r.link.params); });
          }
          return tr;
        }) : [h('tr', h('td', { colspan: cols.length }, h('div.empty', icon('chart'), h('h3', t('reports.noRows')))))])),
        Object.keys(res.totals).length && res.rows.length ? h('tfoot', h('tr', ...cols.map((c, i) => h('td', { class: num(c) ? 'num' : '' }, i === 0 ? t('common.total') : c.total ? cellText(c, res.totals[c.key]) : '')))) : null)));
    const parts = [];
    if (res.chart && res.rows.length > 1) {
      const ch = res.chart;
      const ycol = cols.find((c) => c.key === ch.y);
      const format = (v) => cellText(ycol || { type: 'money' }, v);
      if (ch.type === 'line') {
        parts.push(chartCard({ title: ch.label, chart: lineChart({ points: res.rows.map((r) => ({ label: r[ch.x].slice(5).split('-').reverse().join('/'), title: fmt.date(r[ch.x]), values: [r[ch.y] || 0] })), series: [{ label: ch.label }], format }) }));
      } else {
        const rows = [...res.rows].filter((r) => (r[ch.y] || 0) > 0).sort((a, b) => b[ch.y] - a[ch.y]).slice(0, ch.top || 12);
        const labelOf = (r) => (ch.x === 'period' ? r.period : String(r[ch.x]));
        if (rows.length) parts.push(chartCard({ title: ch.label, sub: ch.top ? t('reports.topN', { n: ch.top }) : null, chart: barChart({ items: rows.map((r) => ({ label: labelOf(r), value: r[ch.y], onClick: r.link ? () => navigate(r.link.path, r.link.params) : null })), format, label: ch.label }) }));
      }
    }
    parts.push(table);
    if (res.notes.length) parts.push(h('div.report-notes', ...res.notes.map((n) => h('p', n))));
    mount(out, ...parts.map((p, i) => (i ? h('div', { style: { marginTop: '16px' } }, p) : p)));
  }
  await run();
}

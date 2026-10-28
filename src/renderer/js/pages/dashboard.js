// Dashboards. Branch: today's money, what needs attention, and four charts. Every figure opens the records behind it.
// All branches (Head Office): one row per branch with drill-down into that branch's dashboard.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { statIcon } from '../ui/stat-icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { toastError } from '../ui/toast.js';
import { filterSelect, exportButton } from '../ui/stockui.js';
import { lineChart, barChart, columnPairs, chartCard, miniTable, legend } from '../ui/charts.js';
import * as fmt from '../ui/format.js';

const go = (navigate, path, params) => () => navigate(path, params);

function tile({ label, value, sub, onClick, tone, iconName, trendIcon, customIcon }) {
  const tag = onClick ? 'button.stat' : 'div.stat';
  return h(tag, { type: onClick ? 'button' : null, class: tone || '', onclick: onClick || null },
    h('div.stat-header',
      customIcon || (iconName ? h('span.stat-icon', icon(iconName, 'sm')) : null)
    ),
    h('span.stat-label', label),
    h('span.stat-value', value),
    sub ? h('span.stat-sub', trendIcon ? icon(trendIcon, 'sm') : null, h('span', sub)) : null,
    h('div.stat-bars', { 'aria-hidden': 'true' },
      h('span.stat-bar', { style: { height: '66%' } }),
      h('span.stat-bar', { style: { height: '82%' } }),
      h('span.stat-bar', { style: { height: '54%' } }),
      h('span.stat-bar', { style: { height: '38%' } }),
      h('span.stat-bar', { style: { height: '50%' } })
    )
  );
}

function shortDay(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

export async function render(page, { params, navigate }) {
  const branches = can('branches.view_all') ? await call('branches.list', {}).catch(() => []) : [];
  let branchId = params.branchId || state.me.branch.id;
  const head = h('div.page-head');
  const body = h('div');
  page.append(head, body);

  async function load() {
    body.classList.add('refetching');
    let d;
    try { d = await call('dashboard.branch', { branchId }); } catch (err) { toastError(err); body.classList.remove('refetching'); return; }
    body.classList.remove('refetching');
    const branchSel = branches.length > 1 ? filterSelect(branches.map((b) => ({ value: b.id, label: b.name })), (v) => { branchId = v; load(); }, { value: branchId, width: '200px', label: t('shell.branch') }) : null;
    mount(head, h('div', h('h1', t('dash.title')), h('p.sub', t('dash.sub', { branch: d.branch.name, date: fmt.date(d.today) }))),
      h('div.row', branchSel, can('branches.view_all') ? h('a.btn', { href: '#/all-branches' }, icon('building', 'sm'), t('nav.allBranches')) : null,
        h('button.btn', { type: 'button', onclick: load }, icon('refresh', 'sm'), t('dash.refresh'))));
    const own = branchId === state.me.branch.id;
    const today = d.todayFigures;
    const day = { from: d.today, to: d.today };
    const sales = (extra) => (own && can('sales.view') ? go(navigate, 'sales', { ...day, ...extra }) : null);
    const journal = (kind) => (own && can('finance.view') ? go(navigate, 'finance', { ...day, kind }) : null);
    const diff = today.net - d.yesterday.net;
    const profitDiff = (today.profit !== null && d.yesterday && d.yesterday.profit !== null)
      ? (today.profit - d.yesterday.profit)
      : null;
    const hasSpecificCats = can('dashboard.stats_financial') || can('dashboard.stats_payments') || can('dashboard.stats_inventory') || can('dashboard.stats_balances') || can('dashboard.charts');
    const showFinancial = can('dashboard.stats_financial') || !hasSpecificCats;
    const showPayments = can('dashboard.stats_payments') || !hasSpecificCats;
    const showInventory = can('dashboard.stats_inventory') || !hasSpecificCats;
    const showBalances = can('dashboard.stats_balances') || !hasSpecificCats;
    const showCharts = can('dashboard.charts') || !hasSpecificCats;

    // Category 1: Today's Financial Overview (highlighted Net Sales in bluish, Net Profit in greenish)
    const financialTiles = showFinancial ? [
      tile({
        label: t('dash.salesToday'),
        value: fmt.money(today.net),
        sub: t('dash.vsYesterday', { v: `${diff >= 0 ? '+' : ''}${fmt.money(diff)}` }),
        trendIcon: diff >= 0 ? 'trendingUp' : 'trendingDown',
        onClick: sales({}),
        customIcon: statIcon('netSalesToday'),
        tone: 'blue',
      }),
      today.profit !== null ? tile({
        label: t('dash.profit'),
        value: fmt.money(today.profit),
        sub: profitDiff !== null ? t('dash.vsYesterday', { v: `${profitDiff >= 0 ? '+' : ''}${fmt.money(profitDiff)}` }) : null,
        trendIcon: profitDiff !== null ? (profitDiff >= 0 ? 'trendingUp' : 'trendingDown') : null,
        onClick: can('reports.financial') ? go(navigate, 'report', { key: 'gross_profit', ...day }) : null,
        customIcon: statIcon('grossProfit'),
        tone: 'green',
      }) : null,
      tile({ label: t('dash.bills'), value: String(today.bills), sub: t('dash.average', { v: fmt.money(today.average) }), onClick: sales({}), customIcon: statIcon('bills'), tone: 'indigo' }),
      tile({ label: t('dash.expenses'), value: fmt.money(today.expenses.total), sub: t('dash.count', { n: today.expenses.count }), onClick: own && can('expenses.view') ? go(navigate, 'expenses', day) : null, customIcon: statIcon('expenses'), tone: 'purple' }),
    ].filter(Boolean) : [];

    // Category 2: Payments & Cashflow
    const paymentTiles = showPayments ? [
      tile({ label: t('dash.cashSales'), value: fmt.money(today.cash), onClick: sales({ method: 'cash' }), customIcon: statIcon('cashSales'), tone: 'emerald' }),
      tile({ label: t('dash.cardOnline'), value: fmt.money(today.card + today.online), sub: t('dash.onlineSub'), onClick: sales({}), customIcon: statIcon('cardOnline'), tone: 'cyan' }),
      tile({ label: t('dash.collections'), value: fmt.money(today.collections.total), sub: t('dash.count', { n: today.collections.count }), onClick: journal('receipt'), iconName: 'users', tone: 'teal' }),
      tile({ label: t('dash.returns'), value: fmt.money(today.returns.total), sub: t('dash.count', { n: today.returns.count }), onClick: journal('sale_return'), tone: today.returns.total ? 'warn' : 'slate', iconName: 'refresh' }),
    ].filter(Boolean) : [];

    // Category 3: Inventory Alerts
    const inventoryTiles = showInventory ? [
      tile({ label: t('dash.lowStock'), value: String(d.stock.low + d.stock.out), sub: t('dash.outOfStock', { n: d.stock.out }), tone: d.stock.out ? 'bad' : d.stock.low ? 'warn' : 'amber', onClick: own ? go(navigate, 'reorder') : null, customIcon: statIcon('lowStock') }),
      tile({ label: t('dash.nearExpiry'), value: String(d.expiry.near), sub: t('dash.withinDays', { n: d.expiry.nearDays }), tone: d.expiry.near ? 'warn' : 'amber', onClick: own ? go(navigate, 'batches', { status: 'near' }) : null, customIcon: statIcon('expiringSoon') }),
      tile({ label: t('dash.expired'), value: String(d.expiry.expired), sub: t('dash.expiredSub'), tone: d.expiry.expired ? 'bad' : 'slate', onClick: own ? go(navigate, 'batches', { status: 'expired' }) : null, iconName: 'trash' }),
    ].filter(Boolean) : [];

    // Category 4: Balances & Approvals
    const actionTiles = showBalances ? [
      tile({ label: t('dash.approvals'), value: String(d.pendingApprovals), sub: t('dash.approvalsSub'), tone: d.pendingApprovals ? 'warn' : 'blue', onClick: own && (can('approvals.view') || can('approvals.approve')) ? go(navigate, 'approvals') : null, customIcon: statIcon('waitingApproval') }),
      d.balances ? tile({
        label: t('dash.receivable'), value: fmt.money(d.balances.receivable), sub: d.overdueCustomers.n ? t('dash.overdueBills', { n: d.overdueCustomers.n }) : t('dash.noneOverdue'),
        tone: d.overdueCustomers.n ? 'warn' : 'indigo', onClick: go(navigate, 'report', { key: 'receivables', branchId }), iconName: 'users'
      }) : null,
      d.balances ? tile({
        label: t('dash.payable'), value: fmt.money(d.balances.payable), sub: d.overdueSuppliers.n ? t('dash.overdueBills', { n: d.overdueSuppliers.n }) : t('dash.noneOverdue'),
        tone: d.overdueSuppliers.n ? 'warn' : 'purple', onClick: own && can('supplier_payments.view') ? go(navigate, 'payments') : null, customIcon: statIcon('weOweSuppliers')
      }) : null,
    ].filter(Boolean) : [];

    const trendPoints = d.trend.map((p) => ({ label: shortDay(p.day), title: fmt.date(p.day), values: [p.net], day: p.day }));
    const trend = chartCard({
      title: t('dash.trend'), sub: t('dash.trendSub'),
      chart: lineChart({ points: trendPoints, series: [{ label: t('dash.netSales') }], format: (v) => fmt.money(v), onPick: own && can('sales.view') ? (p) => navigate('sales', { from: p.day, to: p.day }) : null }),
      table: () => miniTable([{ label: t('common.date'), value: (r) => fmt.date(r.day) }, { label: t('dash.bills'), num: true, value: (r) => String(r.bills) }, { label: t('dash.netSales'), num: true, value: (r) => fmt.money(r.net) }], [...d.trend].reverse()),
    });
    const top = chartCard({
      title: t('dash.topProducts'), sub: t('dash.last30'),
      chart: d.topProducts.length ? barChart({ items: d.topProducts.map((p) => ({ label: p.name, value: p.net, onClick: can('products.view') ? () => navigate('product', { id: p.id }) : null })), format: (v) => fmt.money(v), label: t('dash.topProducts') })
        : h('p.muted.small', t('dash.noSales')),
      table: () => miniTable([{ label: t('products.name'), value: (r) => r.name }, { label: t('dash.netSales'), num: true, value: (r) => fmt.money(r.net) }], d.topProducts),
    });
    const cats = chartCard({
      title: t('dash.categories'), sub: t('dash.last30'),
      chart: d.categories.length ? barChart({
        items: d.categories.map((c) => ({
          label: c.name, value: c.net, valueText: `${c.share}%`, sub: fmt.money(c.net),
          onClick: own && can('reports.view') && c.id && c.id !== 'other' ? () => navigate('report', { key: 'sales_by_product', categoryId: c.id, from: d.from30, to: d.today }) : null
        })), format: (v) => fmt.money(v), label: t('dash.categories')
      })
        : h('p.muted.small', t('dash.noSales')),
      table: () => miniTable([{ label: t('products.category'), value: (r) => r.name }, { label: t('dash.share'), num: true, value: (r) => `${r.share}%` }, { label: t('dash.netSales'), num: true, value: (r) => fmt.money(r.net) }], d.categories),
    });
    const charts = [trend, top, cats];
    if (d.salesVsPurchases) {
      const series = [{ label: t('dash.netSales') }, { label: t('dash.purchases') }];
      const month = (k) => { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', { month: 'short' }); };
      charts.push(chartCard({
        title: t('dash.salesVsPurchases'), sub: t('dash.last6Months'),
        chart: h('div', legend(series), columnPairs({ groups: d.salesVsPurchases.map((g) => ({ label: month(g.month), title: g.month, values: [g.sales, g.purchases] })), series, format: (v) => fmt.money(v) })),
        table: () => miniTable([{ label: t('dash.month'), value: (r) => r.month }, { label: t('dash.netSales'), num: true, value: (r) => fmt.money(r.sales) }, { label: t('dash.purchases'), num: true, value: (r) => fmt.money(r.purchases) }], d.salesVsPurchases),
      }));
    }
    mount(body,
      financialTiles.length ? h('div.dash-section', h('h2.section-title', icon('chart', 'sm'), t('dash.financialOverview')), h('div.stat-grid', ...financialTiles)) : null,
      paymentTiles.length ? h('div.dash-section', h('h2.section-title', icon('wallet', 'sm'), t('dash.paymentsCashflow')), h('div.stat-grid', ...paymentTiles)) : null,
      inventoryTiles.length ? h('div.dash-section', h('h2.section-title', icon('box', 'sm'), t('dash.inventoryAlerts')), h('div.stat-grid', ...inventoryTiles)) : null,
      actionTiles.length ? h('div.dash-section', h('h2.section-title', icon('check', 'sm'), t('dash.accountsApprovals')), h('div.stat-grid', ...actionTiles)) : null,
      showCharts && charts.length ? h('div.dash-section', h('h2.section-title', icon('chart', 'sm'), t('dash.trend')), h('div.grid-2', ...charts)) : null);
  }
  await load();
}

export async function renderAllBranches(page, { navigate }) {
  const f = { from: '', to: '' };
  const head = h('div.page-head');
  const body = h('div');
  page.append(head, body);
  const presets = [['7', 7], ['30', 30], ['90', 90]];
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const range = (days) => { const a = new Date(today); a.setDate(a.getDate() - (days - 1)); f.from = iso(a); f.to = iso(today); };
  range(30);
  const presetSel = filterSelect([...presets.map(([k, n]) => ({ value: k, label: t('dash.lastDays', { n }) })), { value: 'month', label: t('dash.thisMonth') }], (v) => {
    if (v === 'month') { f.from = iso(new Date(today.getFullYear(), today.getMonth(), 1)); f.to = iso(today); } else range(Number(v));
    load();
  }, { value: '30', width: '170px', label: t('dash.period') });
  const cols = (c) => [
    { key: 'name', label: 'Branch' }, { key: 'bills', label: 'Bills', type: 'number', total: true }, { key: 'net', label: 'Net sales', type: 'money', total: true },
    { key: 'average', label: 'Average bill', type: 'money' }, ...(c.profit !== null ? [{ key: 'profit', label: 'Gross profit', type: 'money', total: true }, { key: 'margin', label: 'Margin %', type: 'number' }] : []),
    ...(c.expenses !== null ? [{ key: 'expenses', label: 'Expenses', type: 'money', total: true }, { key: 'receivable', label: 'Customers owe', type: 'money', total: true }, { key: 'payable', label: 'We owe suppliers', type: 'money', total: true }] : []),
    ...(c.stockValue !== null ? [{ key: 'stockValue', label: 'Stock value', type: 'money', total: true }] : []),
    { key: 'lowStock', label: 'Low stock', type: 'number' }, { key: 'nearExpiry', label: 'Near expiry', type: 'number' }, { key: 'expired', label: 'Expired', type: 'number' },
  ];
  let last = null;
  mount(head, h('div', h('h1', t('nav.allBranches')), h('p.sub', t('dash.allSub'))), h('div.row', presetSel,
    exportButton({ source: 'dashboard.allBranches', title: t('nav.allBranches'), perm: 'reports.export', getParams: () => ({ ...f }), columns: () => (last ? cols(last.rows[0] || {}) : []) })));

  async function load() {
    body.classList.add('refetching');
    let d;
    try { d = await call('dashboard.allBranches', { ...f }); } catch (err) { toastError(err); body.classList.remove('refetching'); return; }
    last = d;
    body.classList.remove('refetching');
    const first = d.rows[0] || {};
    const columns = cols(first);
    const cell = (c, r) => (r[c.key] === null || r[c.key] === undefined ? '' : c.type === 'money' ? fmt.money(r[c.key]) : c.key === 'margin' ? `${r[c.key]}%` : String(r[c.key]));
    const table = h('div.card', h('div.table-scroll', h('table.data',
      h('thead', h('tr', ...columns.map((c) => h('th', { class: c.type && c.type !== 'text' ? 'num' : '' }, c.label)))),
      h('tbody', ...d.rows.map((r) => {
        const tr = h('tr.clickable', { tabindex: 0 }, ...columns.map((c) => h('td', { class: c.type && c.type !== 'text' ? 'num' : '' }, c.key === 'name' ? h('span.row', r.name, r.isHeadOffice ? h('span.badge.accent', t('common.headOffice')) : null) : cell(c, r))));
        tr.addEventListener('click', () => navigate('dashboard', { branchId: r.id }));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate('dashboard', { branchId: r.id }); });
        return tr;
      })),
      h('tfoot', h('tr', ...columns.map((c, i) => h('td', { class: c.type && c.type !== 'text' ? 'num' : '' }, i === 0 ? t('common.total') : c.total && d.totals[c.key] !== undefined && d.totals[c.key] !== null ? (c.type === 'money' ? fmt.money(d.totals[c.key]) : String(d.totals[c.key])) : '')))))));
    const chart = chartCard({
      title: t('dash.netSalesByBranch'), sub: `${fmt.date(d.from)} - ${fmt.date(d.to)}`,
      chart: barChart({ items: [...d.rows].sort((a, b) => b.net - a.net).map((r) => ({ label: r.name, value: r.net, onClick: () => navigate('dashboard', { branchId: r.id }) })), format: (v) => fmt.money(v), label: t('dash.netSalesByBranch') }),
    });
    mount(body, table, h('div', { style: { marginTop: '16px' } }, chart), h('p.report-notes', t('dash.allNote')));
  }
  await load();
}

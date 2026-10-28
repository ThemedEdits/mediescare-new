// Audit log: filters, paging from the main process, entry detail with before/after, export.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal } from '../ui/modal.js';
import { input } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import * as fmt from '../ui/format.js';

// Where a record type can be opened. More record types join as modules arrive.
const RECORD_PAGES = { user: 'users', role: 'roles', branch: 'branches', device: 'devices', setting: 'settings', org: 'settings' };

function dayStart(value) { return value ? new Date(`${value}T00:00:00`).toISOString() : ''; }
function dayAfter(value) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export async function render(page, { params, navigate }) {
  const filters = await call('audit.filters');
  const f = { module: '', action: '', userId: '', from: '', to: '', recordId: params.recordId || '', recordType: params.recordType || '' };

  const exportBtn = can('audit.export') ? h('button.btn', { type: 'button' }, icon('upload', 'sm'), t('common.export')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('audit.title')), h('p.sub', t('audit.sub'))), exportBtn));

  const moduleBox = combobox({ options: filters.modules.map((m) => ({ value: m, label: fmt.humanize(m) })), emptyLabel: `${t('audit.module')}: ${t('common.all')}`, onChange: (v) => { f.module = v; reload(); } });
  const actionBox = combobox({ options: filters.actions.map((a) => ({ value: a, label: fmt.humanize(a) })), emptyLabel: `${t('audit.action')}: ${t('common.all')}`, onChange: (v) => { f.action = v; reload(); } });
  const userBox = combobox({ options: filters.users.map((u) => ({ value: u.id, label: u.username })), emptyLabel: `${t('audit.user')}: ${t('common.all')}`, onChange: (v) => { f.userId = v; reload(); } });
  for (const b of [moduleBox, actionBox, userBox]) b.style.width = '170px';
  const fromInput = input({ type: 'date', 'aria-label': t('common.from'), style: { width: '150px' } });
  const toInput = input({ type: 'date', 'aria-label': t('common.to'), style: { width: '150px' } });
  fromInput.addEventListener('change', () => { f.from = fromInput.value; reload(); });
  toInput.addEventListener('change', () => { f.to = toInput.value; reload(); });
  const recordChip = f.recordId ? h('span.badge.accent', `${t('audit.record')}: ${f.recordId}`, h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.clearFilters'), onclick: () => navigate('audit') }, icon('x', 'sm'))) : null;

  const query = () => ({ module: f.module, action: f.action, userId: f.userId, from: dayStart(f.from), to: dayAfter(f.to), recordId: f.recordId, recordType: f.recordType });

  const table = dataTable({
    id: 'audit',
    tools: [moduleBox, actionBox, userBox, h('span.small.muted', t('common.from')), fromInput, h('span.small.muted', t('common.to')), toInput, recordChip].filter(Boolean),
    pageSize: 50,
    defaultSort: { key: 'at', dir: 'desc' },
    columns: [
      { key: 'at', label: t('audit.at'), render: (r) => h('span.nowrap', fmt.dateTime(r.at)) },
      { key: 'username', label: t('audit.user'), render: (r) => r.username || '-' },
      { key: 'branchName', label: t('audit.branch') },
      { key: 'module', label: t('audit.module'), render: (r) => fmt.humanize(r.module) },
      { key: 'action', label: t('audit.action'), render: (r) => h('span.badge', { class: /fail|lock|disable|deactivate|revoke/.test(r.action) ? 'warning' : '' }, fmt.humanize(r.action)) },
      { key: 'summary', label: t('audit.summary'), sortable: false },
      { key: 'reason', label: t('audit.reason'), sortable: false, hidden: true },
    ],
    fetch: async (opts) => {
      try { return await call('audit.list', { ...query(), ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    onRowClick: (r) => openEntry(r.id),
    empty: { icon: 'history', title: t('audit.empty') },
  });
  page.append(table.el);

  function reload() { table.resetPage(); table.refresh(); }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => menu(exportBtn, ['csv', 'txt', 'json', 'xml'].map((format) => ({
      iconEl: icon('upload', 'sm'), label: `${t('audit.exportAs')} ${format.toUpperCase()}`,
      onClick: async () => {
        try {
          const res = await call('audit.export', { ...query(), format });
          if (res.saved) toast(t('audit.exported', { rows: res.rows, path: res.path }));
        } catch (err) { toastError(err); }
      },
    })), { align: 'right' }));
  }

  async function openEntry(id) {
    let e;
    try { e = await call('audit.get', { id }); } catch (err) { toastError(err); return; }
    const keys = [...new Set([...Object.keys(e.oldValue || {}), ...Object.keys(e.newValue || {})])];
    const show = (v) => (v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const target = e.recordType && RECORD_PAGES[e.recordType];
    const footer = [];
    if (e.recordId) footer.push(h('button.btn', { type: 'button', onclick: () => { m.close(); navigate('audit', { recordId: e.recordId, recordType: e.recordType }); } }, icon('history', 'sm'), t('audit.historyOfRecord')));
    if (target) footer.push(h('button.btn.primary', { type: 'button', onclick: () => { m.close(); navigate(target, { open: e.recordId }); } }, t('audit.openRecord'), icon('arrowRight', 'sm')));
    const m = openModal({
      title: t('audit.entry'),
      size: 'wide',
      body: [
        h('dl.kv',
          h('dt', t('audit.at')), h('dd', fmt.dateTime(e.at)),
          h('dt', t('audit.user')), h('dd', e.username || '-'),
          h('dt', t('audit.branch')), h('dd', e.branchName || '-'),
          h('dt', t('audit.module')), h('dd', fmt.humanize(e.module)),
          h('dt', t('audit.action')), h('dd', fmt.humanize(e.action)),
          h('dt', t('audit.summary')), h('dd', e.summary || '-'),
          h('dt', t('audit.reason')), h('dd', e.reason || '-'),
          h('dt', t('audit.record')), h('dd', e.recordType ? `${fmt.humanize(e.recordType)} ${e.recordId || ''}` : '-'),
          h('dt', t('audit.device')), h('dd', h('span.mono', e.deviceId || '-'))),
        keys.length ? h('div', { style: { marginTop: '16px' } }, h('h3', { style: { marginBottom: '8px' } }, t('audit.changes')),
          h('table.diff', h('thead', h('tr', h('th', t('audit.field')), h('th', t('audit.before')), h('th', t('audit.after')))),
            h('tbody', ...keys.map((k) => h('tr', h('td', fmt.humanize(k)), h('td.old', show(e.oldValue && e.oldValue[k])), h('td.new', show(e.newValue && e.newValue[k]))))))) : null,
      ],
      footer,
    });
  }

  if (params.open) openEntry(params.open);
}

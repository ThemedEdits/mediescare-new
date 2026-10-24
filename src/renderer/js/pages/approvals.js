// The approval queue: everything in this branch that waits for a manager (counter requests, expenses, stock
// adjustments and expired write-offs, transfer requests), and the history of decisions with who, when and why.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { toast, toastError } from '../ui/toast.js';
import { dataTable } from '../ui/table.js';
import { confirm } from '../ui/modal.js';
import { filterSelect, exportButton } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

const KINDS = ['counter', 'expense', 'adjustment', 'write_off', 'transfer'];
const DECIDE = { counter: 'approvals.decide', expense: 'expenses.decide', adjustment: 'adjustments.decide', write_off: 'adjustments.decide', transfer: 'transfers.decide' };
const TONE = { pending: 'warning', approved: 'success', used: 'success', rejected: 'danger', cancelled: 'outline' };

export async function render(page, { navigate }) {
  const f = { status: 'pending', kind: '' };
  page.append(h('div.page-head', h('div', h('h1', t('approvals.title')), h('p.sub', t('approvals.sub'))),
    exportButton({ source: 'approvals.list', title: t('approvals.title'), perm: 'approvals.view', getParams: () => ({ ...f }), columns: [
      { key: 'kind', label: 'Type' }, { key: 'docNo', label: 'Document' }, { key: 'summary', label: 'What' }, { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'requestedBy', label: 'Asked by' }, { key: 'requestedAt', label: 'Asked at', type: 'datetime' }, { key: 'status', label: 'Status' },
      { key: 'decidedBy', label: 'Decided by' }, { key: 'decidedAt', label: 'Decided at', type: 'datetime' }, { key: 'reason', label: 'Reason' },
    ] })));
  const statusSel = filterSelect([{ value: 'pending', label: t('approvals.waitingTab') }, { value: 'decided', label: t('approvals.decidedTab') }], (v) => { f.status = v; reload(); }, { value: 'pending', width: '170px' });
  const kindSel = filterSelect([{ value: '', label: t('approvals.anyKind') }, ...KINDS.map((k) => ({ value: k, label: t(`approvals.kind.${k}`) }))], (v) => { f.kind = v; reload(); }, { width: '190px' });

  async function decide(row, approve) {
    let reason = '';
    if (!approve) {
      reason = await confirm({ title: t('approvals.rejectTitle'), text: row.summary, confirmLabel: t('approvals.reject'), danger: true, requireReason: true });
      if (!reason) return;
    }
    try {
      await call(DECIDE[row.kind], { id: row.id, approve, reason });
      toast(approve ? t('approvals.approvedOk') : t('approvals.rejectedOk'));
      reload();
    } catch (err) { toastError(err); }
  }

  const table = dataTable({
    id: 'approvals', tools: [statusSel, kindSel], searchPlaceholder: t('approvals.searchPh'), pageSize: 50,
    columns: [
      { key: 'kind', label: t('approvals.type'), render: (r) => h('span.badge.outline', t(`approvals.kind.${r.kind}`)) },
      { key: 'summary', label: t('approvals.what'), render: (r) => h('div', h('div.cell-main', r.summary), h('div.cell-sub', [r.docNo, r.needs ? r.needs.map((n) => t(`approvals.need.${n}`)).join(', ') : null].filter(Boolean).join(' - '))) },
      { key: 'amount', label: t('expenses.amount'), align: 'num', render: (r) => (r.amount === null || r.amount === undefined ? '' : fmt.money(r.amount)) },
      { key: 'requestedBy', label: t('approvals.askedBy'), render: (r) => h('div', h('div', r.requestedBy || ''), h('div.cell-sub', fmt.relative(r.requestedAt))) },
      { key: 'status', label: t('common.status'), render: (r) => h('div', h('span.badge', { class: TONE[r.status] || 'outline' }, t(`approvals.status.${r.status}`)),
        r.decidedBy ? h('div.cell-sub', `${r.decidedBy} - ${fmt.dateTime(r.decidedAt)}`) : null, r.reason ? h('div.cell-sub', r.reason) : null) },
      { key: 'actions', label: '', render: (r) => h('div.row', { style: { justifyContent: 'flex-end' } },
        r.link ? h('button.btn.sm', { type: 'button', onclick: () => navigate(r.link.path, r.link.params) }, t('approvals.open')) : null,
        r.canDecide ? h('button.btn.sm', { type: 'button', onclick: () => decide(r, false) }, t('approvals.reject')) : null,
        r.canDecide ? h('button.btn.sm.primary', { type: 'button', onclick: () => decide(r, true) }, icon('check', 'sm'), t('approvals.approve')) : null) },
    ],
    fetch: async (opts) => {
      try {
        const res = await call('approvals.list', { ...f });
        const q = (opts.search || '').toLowerCase();
        const rows = q ? res.rows.filter((r) => `${r.summary} ${r.docNo || ''} ${r.requestedBy || ''}`.toLowerCase().includes(q)) : res.rows;
        const start = (opts.page - 1) * opts.pageSize;
        return { rows: rows.slice(start, start + opts.pageSize), total: rows.length };
      } catch (err) { toastError(err); return { rows: [], total: 0 }; }
    },
    empty: { icon: 'check', title: t('approvals.empty'), text: t('approvals.emptyText') },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
  // New requests from counters show up without reloading the page.
  const timer = setInterval(() => { if (f.status === 'pending' && document.body.contains(table.el)) table.refresh(); }, 10000);
  return () => clearInterval(timer);
}

// Stock movements: every change to stock, filterable, with before and after quantities and a link to its document.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { exportButton, filterSelect, dateFilter } from '../ui/stockui.js';
import { ledgerTable } from './batches.js';

function dayStart(v) { return v ? new Date(`${v}T00:00:00`).toISOString() : ''; }
function dayAfter(v) { if (!v) return ''; const d = new Date(`${v}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString(); }

export async function render(page, { params, navigate }) {
  const movements = await call('stock.movements');
  const f = { movement: '', from: '', to: '' };
  const query = () => ({ movement: f.movement, from: dayStart(f.from), to: dayAfter(f.to), batchId: params.batchId, productId: params.productId });
  page.append(h('div.page-head', h('div', h('h1', t('movements.title')), h('p.sub', params.label ? t('movements.for', { what: params.label }) : t('movements.sub'))),
    h('div.row', params.batchId || params.productId ? h('button.btn', { type: 'button', onclick: () => navigate('movements') }, icon('x', 'sm'), t('common.clearFilters')) : null,
      exportButton({
        source: 'stock.ledger', title: t('movements.title'), perm: 'stock.export', getParams: query,
        columns: [
          { key: 'at', label: 'Date and time', type: 'datetime' }, { key: 'productLabel', label: 'Product' }, { key: 'batchNo', label: 'Batch' }, { key: 'movementLabel', label: 'Type' },
          { key: 'refNo', label: 'Document' }, { key: 'qty', label: 'Change (smallest units)', type: 'number', total: true }, { key: 'qtyText', label: 'Change' },
          { key: 'before', label: 'Before', type: 'number' }, { key: 'after', label: 'After', type: 'number' }, { key: 'value', label: 'Value', type: 'money', total: true },
          { key: 'reason', label: 'Reason' }, { key: 'username', label: 'User' },
        ],
      }))));
  let el;
  const reload = () => el.refreshTable();
  const typeSel = filterSelect([{ value: '', label: `${t('movements.type')}: ${t('common.all')}` }, ...movements.map((m) => ({ value: m.key, label: m.label }))], (v) => { f.movement = v; reload(); }, { width: '220px' });
  const from = dateFilter((v) => { f.from = v; reload(); }, t('common.from'));
  const to = dateFilter((v) => { f.to = v; reload(); }, t('common.to'));
  el = ledgerTable({ id: 'movements', batchId: params.batchId, productId: params.productId, tools: [typeSel, h('span.small.muted', t('common.from')), from, h('span.small.muted', t('common.to')), to], extra: query });
  page.append(el);
}

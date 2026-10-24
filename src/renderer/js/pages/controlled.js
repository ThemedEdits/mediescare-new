// Controlled drug register (running balance per drug, with patient and doctor for each sale) and prescriptions.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { dataTable } from '../ui/table.js';
import { openModal } from '../ui/modal.js';
import { toastError } from '../ui/toast.js';
import { exportButton, dateFilter } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params }) {
  let tab = params.tab === 'rx' ? 'rx' : 'register';
  const f = { from: '', to: '' };
  page.append(h('div.page-head', h('div', h('h1', t('controlled.title')), h('p.sub', t('controlled.sub')))));
  const bar = h('div.row', { style: { marginBottom: '16px' } });
  const body = h('div');
  page.append(bar, body);
  const drawBar = () => bar.replaceChildren(
    ...[['register', t('controlled.register')], ['rx', t('controlled.prescriptions')]].map(([k, l]) => h('button.btn', { type: 'button', class: k === tab ? 'primary' : '', onclick: () => { tab = k; drawBar(); show(); } }, l)),
    h('span.spacer'), h('span.small.muted', t('common.from')), dateFilter((v) => { f.from = v; show(); }, t('common.from')), h('span.small.muted', t('common.to')), dateFilter((v) => { f.to = v; show(); }, t('common.to')));

  async function show() {
    try {
      if (tab === 'register') {
        const res = await call('controlled.register', { from: f.from || undefined, to: f.to || undefined });
        mount(body, h('div.stack',
          h('div.row', h('p.small.muted.grow', t('controlled.registerNote')), exportButton({ source: 'controlled.register', title: t('controlled.register'), perm: 'controlled.export', getParams: () => ({ from: f.from || undefined, to: f.to || undefined }), columns: [
            { key: 'at', label: 'Date and time', type: 'datetime' }, { key: 'productLabel', label: 'Medicine' }, { key: 'drapRegNo', label: 'DRAP number' }, { key: 'batchNo', label: 'Batch' },
            { key: 'movement', label: 'Movement' }, { key: 'refNo', label: 'Document' }, { key: 'qtyIn', label: 'In', type: 'number', total: true }, { key: 'qtyOut', label: 'Out', type: 'number', total: true },
            { key: 'balance', label: 'Balance', type: 'number' }, { key: 'patientName', label: 'Patient' }, { key: 'patientCnic', label: 'Patient CNIC' }, { key: 'doctorName', label: 'Doctor' },
            { key: 'doctorPmdc', label: 'PMDC' }, { key: 'rxNumber', label: 'Prescription' }, { key: 'username', label: 'User' },
          ] })),
          dataTable({
            id: 'controlled', rows: res.rows, pageSize: 100,
            columns: [
              { key: 'at', label: t('audit.at'), render: (r) => h('span.nowrap', fmt.dateTime(r.at)) },
              { key: 'productLabel', label: t('products.name') }, { key: 'batchNo', label: t('stock.batch'), render: (r) => h('span.mono', r.batchNo) },
              { key: 'movement', label: t('movements.type') }, { key: 'refNo', label: t('movements.document'), render: (r) => h('span.mono', r.refNo || '') },
              { key: 'qtyIn', label: t('controlled.in'), align: 'num', render: (r) => (r.qtyIn || '') }, { key: 'qtyOut', label: t('controlled.out'), align: 'num', render: (r) => (r.qtyOut || '') },
              { key: 'balance', label: t('controlled.balance'), align: 'num', render: (r) => h('strong', r.balanceText) },
              { key: 'patientName', label: t('pos.patient'), render: (r) => (r.patientName ? h('div', r.patientName, h('div.cell-sub', r.patientCnic || '')) : '') },
              { key: 'doctorName', label: t('pos.doctor'), render: (r) => (r.doctorName ? h('div', r.doctorName, h('div.cell-sub', [r.doctorPmdc, r.rxNumber].filter(Boolean).join(' - '))) : '') },
            ],
            empty: { icon: 'shield', title: t('controlled.empty') },
          }).el));
      } else {
        const table = dataTable({
          id: 'prescriptions', searchPlaceholder: t('controlled.searchPh'),
          columns: [
            { key: 'createdAt', label: t('audit.at'), sortable: false, render: (r) => fmt.dateTime(r.createdAt) },
            { key: 'saleNo', label: t('sales.bill'), sortable: false, render: (r) => (r.saleId ? h('a.mono', { href: `#/sale?id=${r.saleId}` }, r.saleNo) : '') },
            { key: 'patientName', label: t('pos.patient'), sortable: false, render: (r) => h('div', r.patientName, h('div.cell-sub', [r.patientCnic, r.patientPhone].filter(Boolean).join(' - '))) },
            { key: 'doctorName', label: t('pos.doctor'), sortable: false, render: (r) => h('div', r.doctorName, h('div.cell-sub', [r.doctorPmdc, r.doctorClinic].filter(Boolean).join(' - '))) },
            { key: 'rxNumber', label: t('pos.rxNumber'), sortable: false },
            { key: 'hasPhoto', label: t('pos.rxPhoto'), sortable: false, render: (r) => (r.hasPhoto ? h('button.btn.sm', { type: 'button', onclick: () => showPhoto(r) }, icon('eye', 'sm'), t('controlled.view')) : '') },
          ],
          fetch: async (opts) => { try { return await call('prescriptions.list', { from: f.from || undefined, to: f.to || undefined, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
          empty: { icon: 'clipboard', title: t('controlled.noRx') },
        });
        mount(body, h('div.stack', h('div.row', h('p.small.muted.grow', t('controlled.rxNote')), exportButton({ source: 'prescriptions.list', title: t('controlled.prescriptions'), perm: 'controlled.export', getParams: () => ({ from: f.from || undefined, to: f.to || undefined }), columns: [
          { key: 'createdAt', label: 'Date', type: 'datetime' }, { key: 'saleNo', label: 'Bill' }, { key: 'patientName', label: 'Patient' }, { key: 'patientCnic', label: 'CNIC' }, { key: 'patientPhone', label: 'Phone' },
          { key: 'doctorName', label: 'Doctor' }, { key: 'doctorPmdc', label: 'PMDC' }, { key: 'doctorClinic', label: 'Clinic' }, { key: 'rxNumber', label: 'Prescription' }, { key: 'rxDate', label: 'Prescription date' },
        ] })), table.el));
      }
    } catch (err) { mount(body, h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message))); }
  }
  drawBar();
  await show();
}

async function showPhoto(r) {
  try {
    const { photo } = await call('prescriptions.photo', { id: r.id });
    if (!photo) return;
    openModal({ title: t('controlled.photoOf', { name: r.patientName }), size: 'wide', body: [h('img', { src: photo, alt: t('pos.rxPhoto'), style: { maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' } })] });
  } catch (err) { toastError(err); }
}

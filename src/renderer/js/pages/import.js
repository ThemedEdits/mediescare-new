// Import wizard: choose what to import, download a template, pick a file, match columns, check every row, import all or nothing.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { dataTable } from '../ui/table.js';
import { toast, toastError } from '../ui/toast.js';
import { busy } from '../ui/form.js';
import { filterSelect } from '../ui/stockui.js';

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function render(page, { params, navigate }) {
  const kinds = await call('import.kinds');
  let kind = kinds.find((k) => k.key === params.kind) ? params.kind : (kinds[0] && kinds[0].key);
  page.append(h('div.page-head', h('div', h('h1', t('import.title')), h('p.sub', t('import.sub')))));
  if (!kinds.length) { page.append(h('div.form-note', icon('lock', 'sm'), h('div', t('import.nothingAllowed')))); return; }
  const body = h('div.stack');
  page.append(body);
  let session = null;

  function stepChoose() {
    const kindSel = filterSelect(kinds.map((k) => ({ value: k.key, label: k.title })), (v) => { kind = v; stepChoose(); }, { value: kind, width: '220px' });
    const file = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xls,.json,.xml', hidden: true });
    const pick = h('button.btn.primary', { type: 'button', onclick: () => file.click() }, icon('upload', 'sm'), t('import.chooseFile'));
    file.addEventListener('change', () => busy(pick, t('common.loading'), async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        session = await call('import.load', { kind, fileName: f.name, contentBase64: toBase64(buf) });
        stepMap();
      } catch (err) { toastError(err); }
      file.value = '';
    }));
    const k = kinds.find((x) => x.key === kind);
    mount(body,
      h('div.card', h('div.card-body.stack',
        h('div.row', h('strong', t('import.step1')), kindSel),
        h('p.small.muted', t('import.formats')),
        h('div.row', h('span.small', t('import.templateText')), h('button.btn.sm', { type: 'button', onclick: () => template('xlsx') }, 'Excel'), h('button.btn.sm', { type: 'button', onclick: () => template('csv') }, 'CSV')),
        h('div.small', h('strong', t('import.columns')), ' ', k.fields.map((f) => f.label + (f.required ? ' *' : '')).join(', ')),
        h('div.row', pick, file))));
  }
  async function template(format) {
    try { const r = await call('import.template', { kind, format }); if (r && r.saved) toast(t('import.templateSaved', { path: r.path })); } catch (err) { toastError(err); }
  }

  function stepMap() {
    const selects = {};
    const rows = session.fields.map((f) => {
      const sel = h('select.input', { style: { width: '260px' } }, h('option', { value: '' }, t('import.notInFile')), ...session.headers.map((hd) => h('option', { value: hd, selected: session.mapping[f.key] === hd }, hd)));
      selects[f.key] = sel;
      return h('tr', h('td', f.label, f.required ? h('span', { style: { color: 'var(--danger)' } }, ' *') : null), h('td', sel));
    });
    const dup = filterSelect([{ value: 'skip', label: t('import.dupSkip') }, { value: 'update', label: t('import.dupUpdate') }, { value: 'error', label: t('import.dupError') }], () => {}, { width: '260px' });
    const check = h('button.btn.primary', { type: 'button' }, t('import.check'));
    const mapping = () => Object.fromEntries(Object.entries(selects).filter(([, s]) => s.value).map(([k, s]) => [k, s.value]));
    check.onclick = () => busy(check, t('import.checking'), async () => {
      try { const prev = await call('import.preview', { sessionId: session.sessionId, mapping: mapping(), duplicates: dup.value }); stepPreview(prev, mapping(), dup.value); } catch (err) { toastError(err); }
    });
    mount(body, h('div.card', h('div.card-body.stack',
      h('div.row.between', h('strong', t('import.step2', { file: session.fileName, n: session.rowCount })), h('button.btn.sm', { type: 'button', onclick: stepChoose }, t('import.otherFile'))),
      h('table.diff', h('thead', h('tr', h('th', t('import.field')), h('th', t('import.column')))), h('tbody', ...rows)),
      h('div.row', h('span', t('import.duplicates')), dup),
      h('details', h('summary.small', t('import.sample')), h('div.table-scroll', h('table.data', h('thead', h('tr', ...session.headers.map((hd) => h('th', hd)))), h('tbody', ...session.sample.map((r) => h('tr', ...r.map((c) => h('td', c)))))))),
      h('div.row', h('span.spacer'), check))));
  }

  function stepPreview(prev, mapping, duplicates) {
    const c = prev.counts;
    const go = h('button.btn.primary', { type: 'button', disabled: c.error > 0 || c.new + c.update === 0 }, t('import.importNow', { n: c.new + c.update }));
    go.onclick = () => busy(go, t('import.importing'), async () => {
      try {
        const res = await call('import.commit', { sessionId: session.sessionId, mapping, duplicates });
        toast(t('import.done', { added: res.counts.new, updated: res.counts.update, skipped: res.counts.skip }), { timeout: 6000 });
        if (res.adjustment) navigate('adjustment', { id: res.adjustment.id }); else stepChoose();
      } catch (err) { toastError(err); }
    });
    const badge = (n, cls, label) => h('span.badge', { class: cls }, `${label}: ${n}`);
    mount(body, h('div.card', h('div.card-body.stack',
      h('div.row.wrap', h('strong', t('import.step3')), badge(c.new, 'success', t('import.new')), badge(c.update, 'accent', t('import.update')), badge(c.skip, '', t('import.skip')), badge(c.error, c.error ? 'danger' : '', t('import.errors'))),
      c.error ? h('div.form-error', icon('alertCircle', 'sm'), h('div', t('import.fixFirst', { n: c.error }))) : h('div.form-note', icon('check', 'sm'), h('div', t('import.allGood'))),
      dataTable({
        id: 'import-preview', rows: prev.rows, pageSize: 50,
        columns: [
          { key: 'row', label: t('import.row'), align: 'num' },
          { key: 'status', label: t('common.status'), render: (r) => h('span.badge', { class: { new: 'success', update: 'accent', error: 'danger' }[r.status] || '' }, t(`import.${r.status === 'new' ? 'new' : r.status === 'update' ? 'update' : r.status === 'skip' ? 'skip' : 'error'}`)) },
          { key: 'label', label: t('import.record') },
          { key: 'detail', label: t('docs.qty') },
          { key: 'error', label: t('import.problem'), render: (r) => (r.error ? h('span', { style: { color: 'var(--danger)' } }, r.error) : '') },
        ],
      }).el,
      h('div.row', h('button.btn', { type: 'button', onclick: stepMap }, icon('chevronLeft', 'sm'), t('import.changeMapping')), h('span.spacer'), go))));
  }

  stepChoose();
}

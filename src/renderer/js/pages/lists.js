// Configurable lists: categories, dosage forms, manufacturers, drug classes, storage conditions, unit names.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';

const KINDS = ['category', 'form', 'manufacturer', 'drug_class', 'storage', 'unit'];

export async function render(page, { params }) {
  let kind = KINDS.includes(params.kind) ? params.kind : 'category';
  let showInactive = false;
  const add = can('products.create') || can('products.edit') ? h('button.btn.primary', { type: 'button', onclick: () => edit(null) }, icon('plus', 'sm'), t('lists.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('lists.title')), h('p.sub', t('lists.sub'))), add));
  const bar = h('div.row.wrap', { style: { marginBottom: '16px' } });
  page.append(bar);
  const drawBar = () => bar.replaceChildren(...KINDS.map((k) => h('button.btn', { type: 'button', class: k === kind ? 'primary' : '', onclick: () => { kind = k; drawBar(); load(); } }, t(`lists.${k}`))));
  const inactive = h('label.check', h('input', { type: 'checkbox', onchange: (e) => { showInactive = e.target.checked; load(); } }), h('span', t('lists.showInactive')));
  const table = dataTable({
    id: 'lookups', tools: [inactive],
    columns: [
      { key: 'name', label: t('lists.name'), render: (r) => h('div.row', r.name, !r.active ? h('span.badge', t('common.inactive')) : null) },
      { key: 'usage', label: t('lists.usage'), align: 'num' },
    ],
    onRowClick: can('products.edit') ? (r) => edit(r) : null,
    empty: { icon: 'list', title: t('lists.empty') },
  });
  page.append(table.el);
  async function load() { try { table.setRows(await call('lookups.list', { kind, includeInactive: showInactive })); } catch (err) { toastError(err); } }

  function edit(row) {
    const form = new Form();
    const active = h('label.check', h('input', { type: 'checkbox', checked: row ? row.active : true }), h('span', t('common.active')));
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
    const m = openModal({
      title: row ? t('lists.edit') : t('lists.add'), size: 'narrow',
      body: [form.errorBox, form.add('name', fieldText(input({ value: row ? row.name : '', maxlength: 80 }), t('lists.name'), { required: true })), row ? h('div', { style: { marginTop: '12px' } }, active, h('p.small.muted', t('lists.inactiveNote'))) : null],
      footer: [cancel, save],
    });
    cancel.onclick = () => m.close();
    save.onclick = () => busy(save, null, async () => {
      try {
        if (row) await call('lookups.update', { id: row.id, name: form.value('name'), active: active.control.checked });
        else await call('lookups.create', { kind, name: form.value('name') });
        m.close();
        toast(t('common.saved'));
        load();
      } catch (err) { form.showError(err); }
    });
  }
  drawBar();
  await load();
}

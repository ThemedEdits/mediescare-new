// Settings: organisation-wide values, and per-branch overrides where allowed.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state } from '../state.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';

function control(def, value, readonly) {
  switch (def.type) {
    case 'bool':
      return select([{ value: 'true', label: t('settings.yes') }, { value: 'false', label: t('settings.no') }], { value: String(value), disabled: readonly });
    case 'choice':
      return select(def.choices.map((c) => ({ value: c, label: String(c) })), { value: value, disabled: readonly });
    case 'int':
      return input({ type: 'number', min: def.min, max: def.max, step: 1, value, readonly });
    case 'intList':
      return input({ value: (value || []).join(', '), readonly });
    default:
      return input({ value: value || '', maxlength: def.max, readonly });
  }
}

export async function render(page) {
  let scope = 'global';
  page.append(h('div.page-head', h('div', h('h1', t('settings.title')), h('p.sub', t('settings.sub')))));
  const tabs = h('div.row', { style: { marginBottom: '16px' }, role: 'tablist' });
  const holder = h('div');
  page.append(tabs, holder);

  async function draw() {
    let data;
    try { data = await call('settings.get'); } catch (err) { toastError(err); return; }
    const tabBtn = (key, label) => h('button.btn', { type: 'button', role: 'tab', 'aria-selected': String(scope === key), class: scope === key ? 'primary' : '', onclick: () => { scope = key; draw(); } }, label);
    tabs.replaceChildren(tabBtn('global', t('settings.scopeGlobal')), tabBtn('branch', t('settings.scopeBranch', { branch: state.me.branch.name })));

    const editable = scope === 'global' ? data.canEditGlobal : data.canEditBranch;
    const defs = data.definitions.filter((d) => scope === 'global' || d.branch);
    const form = new Form();
    const clear = new Set();
    const cards = [];

    if (scope === 'global') {
      cards.push(h('div.card', h('div.card-head', h('h2', t('settings.org'))), h('div.card-body', h('div.form-grid',
        form.add('orgName', fieldText(input({ value: data.org.name, maxlength: 120, readonly: !editable }), t('settings.orgName'), { required: true })),
        fieldText(input({ value: data.org.code, readonly: true }), t('settings.orgCode')).el))));
    }

    const groups = [...new Set(defs.map((d) => d.group))];
    for (const g of groups) {
      const fields = defs.filter((d) => d.group === g).map((d) => {
        const readonly = !editable || d.readOnly;
        const overridden = scope === 'branch' && data.overridden[d.key];
        const f = fieldText(control(d, data.values[d.key], readonly), d.label, { hint: d.readOnly ? t('settings.taxInclusiveNote') : null });
        if (scope === 'branch') {
          const extra = h('div.row', overridden ? h('span.badge.accent', t('settings.overridden')) : null,
            overridden && editable ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { clear.add(d.key); save.click(); } }, t('settings.useOrgValue')) : null);
          f.el.append(extra);
        }
        return form.add(d.key, f);
      });
      cards.push(h('div.card', h('div.card-head', h('h2', g)), h('div.card-body', h('div.form-grid', ...fields))));
    }

    const save = h('button.btn.primary', { type: 'button' }, t('common.saveChanges'));
    save.onclick = () => busy(save, null, async () => {
      form.clearErrors();
      const values = {};
      for (const d of defs) {
        if (d.readOnly || clear.has(d.key)) continue;
        const raw = form.value(d.key);
        const before = data.values[d.key];
        const normalized = d.type === 'intList' ? raw : d.type === 'int' ? Number(raw) : d.type === 'bool' ? raw === 'true' : d.type === 'choice' ? (typeof d.default === 'number' ? Number(raw) : raw) : raw;
        // Only changed values are sent, so untouched branch settings keep following the organisation.
        if (JSON.stringify(normalized) !== JSON.stringify(before)) values[d.key] = normalized;
      }
      const payload = { scope, values, clear: [...clear] };
      if (scope === 'global') payload.orgName = form.value('orgName');
      try {
        const res = await call('settings.update', payload);
        clear.clear();
        toast(res.changed ? t('common.saved') : t('common.noChanges'));
        state.app = await call('app.state');
        draw();
      } catch (err) { clear.clear(); form.showError(err); }
    });

    const items = [
      !editable ? h('div.form-note', { style: { marginBottom: '16px' } }, icon('lock', 'sm'), h('div', scope === 'global' ? t('settings.readOnlyGlobal') : t('settings.readOnlyBranch'))) : null,
      form.errorBox, ...cards,
      editable ? h('div.row', { style: { marginTop: '16px' } }, h('div.spacer'), save) : null,
    ].filter(Boolean);
    holder.replaceChildren(...items);
  }
  await draw();
}

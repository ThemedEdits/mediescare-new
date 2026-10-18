// Keyboard shortcuts: every action with its key. Click a key, press the new combination, save. Keys used twice are
// marked before saving. People with "Edit keyboard shortcuts of other users" can pick another user.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { toast, toastError } from '../ui/toast.js';
import { combobox } from '../ui/combobox.js';
import { comboOf, setBindings } from '../keys.js';

export async function render(page) {
  let userId = state.me.user.id;
  const body = h('div');
  const head = h('div.page-head', h('div', h('h1', t('shortcuts.title')), h('p.sub', t('shortcuts.sub'))));
  page.append(head, body);
  if (can('shortcuts.others')) {
    const users = await call('users.list', {}).catch(() => []);
    const pick = combobox({ options: users.map((u) => ({ value: u.id, label: u.fullName, sub: u.username })), value: userId, onChange: (v) => { userId = v || state.me.user.id; load(); } });
    pick.style.width = '240px';
    head.append(h('div.row', h('span.small.muted', t('shortcuts.forUser')), pick));
  }

  let data = null;
  let draft = {};
  async function load() {
    try { data = await call('shortcuts.get', { userId }); } catch (err) { toastError(err); return; }
    draft = { ...data.bindings };
    paint();
  }

  function conflicts() {
    const seen = new Map();
    for (const a of data.actions) {
      const k = draft[a.id];
      if (!k) continue;
      seen.set(k, [...(seen.get(k) || []), a.id]);
    }
    return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
  }

  function paint() {
    const clash = conflicts();
    const save = h('button.btn.primary', { type: 'button', disabled: clash.size > 0, onclick: async () => {
      try {
        const res = await call('shortcuts.save', { userId, bindings: draft });
        if (userId === state.me.user.id) setBindings(res.bindings);
        data = res;
        draft = { ...res.bindings };
        toast(t('shortcuts.saved'));
        paint();
      } catch (err) { toastError(err); }
    } }, t('common.saveChanges'));
    const reset = h('button.btn', { type: 'button', onclick: async () => {
      try {
        const res = await call('shortcuts.reset', { userId });
        if (userId === state.me.user.id) setBindings(res.bindings);
        data = res;
        draft = { ...res.bindings };
        toast(t('shortcuts.resetDone'));
        paint();
      } catch (err) { toastError(err); }
    } }, t('shortcuts.resetAll'));
    const row = (a) => {
      const keyBtn = h('button.btn.sm.shortcut-key', { type: 'button', class: clash.has(a.id) ? 'conflict' : '', 'aria-label': t('shortcuts.change', { action: a.label }) }, h('span.kbd', draft[a.id] || t('shortcuts.none')));
      keyBtn.addEventListener('click', () => {
        keyBtn.replaceChildren(t('shortcuts.pressKey'));
        const onKey = (e) => {
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener('keydown', onKey, true);
          if (e.key !== 'Escape') draft[a.id] = comboOf(e);
          paint();
        };
        document.addEventListener('keydown', onKey, true);
      });
      return h('tr', { class: clash.has(a.id) ? 'flag' : '' },
        h('td', a.label), h('td', h('span.badge.outline', a.scope === 'pos' ? t('shortcuts.scopePos') : t('shortcuts.scopeGlobal'))),
        h('td', keyBtn), h('td.small.muted', a.default),
        h('td.actions', draft[a.id] !== a.default ? h('button.btn.sm.ghost', { type: 'button', onclick: () => { draft[a.id] = a.default; paint(); } }, t('shortcuts.useDefault')) : null));
    };
    mount(body,
      clash.size ? h('div.form-error', { style: { marginBottom: '12px' } }, icon('alertCircle', 'sm'), h('div', t('shortcuts.conflictNote'))) : null,
      h('div.card', h('div.card-head', h('div', h('h2', data.userName), h('p.small.muted', t('shortcuts.hint'))), h('div.row', reset, save)),
        h('div.table-scroll', h('table.data', h('thead', h('tr', h('th', t('shortcuts.action')), h('th', t('shortcuts.where')), h('th', t('shortcuts.key')), h('th', t('shortcuts.default')), h('th', ''))),
          h('tbody', ...data.actions.map(row))))));
  }
  await load();
}

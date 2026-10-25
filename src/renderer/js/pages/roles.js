// Roles: permission checklist grouped by module with View / Create / Edit / Delete / Approve / Export, plus special permissions.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, checkbox, busy } from '../ui/form.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'];

export async function render(page, { params }) {
  const catalog = await call('roles.catalog');
  let showInactive = false;

  const addBtn = can('roles.create') ? h('button.btn.primary', { type: 'button', onclick: () => editRole(null) }, icon('plus', 'sm'), t('roles.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('roles.title')), h('p.sub', t('roles.sub'))), addBtn));

  const inactiveToggle = checkbox(t('roles.showInactive'));
  inactiveToggle.control.addEventListener('change', () => { showInactive = inactiveToggle.control.checked; load(); });

  const table = dataTable({
    id: 'roles',
    tools: [inactiveToggle],
    columns: [
      { key: 'name', label: t('roles.name'), render: (r) => h('div', h('div.cell-main.row', r.name, r.isSuper ? h('span.badge.accent', t('roles.allAccess')) : null), r.description ? h('div.cell-sub', r.description) : null), searchValue: (r) => `${r.name} ${r.description || ''}` },
      { key: 'permissions', label: t('roles.permissions'), align: 'num', render: (r) => (r.isSuper ? t('common.all') : String(r.permissions.length)), sortValue: (r) => (r.isSuper ? 9999 : r.permissions.length) },
      { key: 'userCount', label: t('roles.users'), align: 'num' },
      { key: 'active', label: t('common.status'), render: (r) => h('span.badge', { class: r.active ? 'success' : '' }, r.active ? t('common.active') : t('common.inactive')) },
      { key: 'actions', label: '', render: (r) => rowMenu(r) },
    ],
    onRowClick: (r) => editRole(r),
    empty: { icon: 'shield', title: t('roles.empty') },
  });
  page.append(table.el);

  let rows = [];
  async function load() {
    try { rows = await call('roles.list', { includeInactive: showInactive }); table.setRows(rows); } catch (err) { toastError(err); }
  }

  function rowMenu(r) {
    if (r.isSuper || !r.canManage || !can('roles.delete')) return null;
    const btn = h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.actions') }, icon('more', 'sm'));
    btn.addEventListener('click', () => menu(btn, [
      r.active
        ? { iconEl: icon('power', 'sm'), label: t('roles.deactivate'), danger: true, onClick: () => setActive(r, false) }
        : { iconEl: icon('power', 'sm'), label: t('roles.activate'), onClick: () => setActive(r, true) },
    ], { align: 'right' }));
    return btn;
  }

  async function setActive(r, active) {
    let reason = '';
    if (!active) {
      reason = await confirm({ title: `${t('roles.deactivate')}: ${r.name}`, text: t('roles.sub'), confirmLabel: t('roles.deactivate'), danger: true, requireReason: true, reasonOptional: true });
      if (reason === false) return;
    }
    try { await call('roles.setActive', { id: r.id, active, reason }); toast(t('common.saved')); load(); } catch (err) { toastError(err); }
  }

  function editRole(r) {
    const isNew = !r;
    const editable = isNew ? can('roles.create') : (!r.isSuper && r.canManage && can('roles.edit'));
    const form = new Form();
    const chosen = new Set(r ? r.permissions : []);
    const boxes = new Map();

    function box(key) {
      const b = h('input', { type: 'checkbox', checked: r && r.isSuper ? true : chosen.has(key), 'aria-label': key });
      // People can only hand out permissions they have themselves.
      b.disabled = !editable || !can(key);
      if (!can(key) && editable) b.title = t('roles.notOwned');
      b.addEventListener('change', () => { if (b.checked) chosen.add(key); else chosen.delete(key); });
      boxes.set(key, b);
      return b;
    }

    const head = h('tr', h('th', t('roles.module')), ...ACTIONS.map((a) => h('th', catalog.actions[a])), editable ? h('th', '') : null);
    const bodyRows = catalog.modules.map((m) => {
      const cells = ACTIONS.map((a) => {
        const p = m.actions.find((x) => x.action === a);
        return p ? h('td', box(p.key)) : h('td.na', '-');
      });
      let allBtn = null;
      if (editable) {
        allBtn = h('td', h('button.btn.ghost.sm', { type: 'button', onclick: () => {
          const keys = m.actions.map((x) => x.key).filter((k) => !boxes.get(k).disabled);
          const allOn = keys.every((k) => chosen.has(k));
          for (const k of keys) { boxes.get(k).checked = !allOn; if (allOn) chosen.delete(k); else chosen.add(k); }
        } }, t('common.all')));
      }
      return h('tr', h('td', m.label), ...cells, allBtn);
    });
    const special = h('div.perm-special', ...catalog.special.map((s) => h('label.check', box(s.key), h('span', s.label))));

    const bulk = editable ? h('div.row',
      h('button.btn.sm', { type: 'button', onclick: () => { for (const [k, b] of boxes) if (!b.disabled) { b.checked = true; chosen.add(k); } } }, t('roles.selectAll')),
      h('button.btn.sm', { type: 'button', onclick: () => { for (const [k, b] of boxes) if (!b.disabled) { b.checked = false; chosen.delete(k); } } }, t('roles.selectNone'))) : null;

    const body = [
      form.errorBox,
      r && r.isSuper ? h('div.form-note', icon('lock', 'sm'), h('div', t('roles.superLocked'))) : null,
      r && !r.isSuper && !r.canManage ? h('div.form-note', icon('lock', 'sm'), h('div', t('roles.cannotManage'))) : null,
      h('div.form-grid',
        form.add('name', fieldText(input({ value: r ? r.name : '', maxlength: 60, readonly: !editable }), t('roles.name'), { required: true })),
        form.add('description', fieldText(input({ value: r ? r.description || '' : '', maxlength: 300, readonly: !editable }), t('roles.description')))),
      h('div.row.between', { style: { marginTop: '16px', marginBottom: '8px' } }, h('h3', t('roles.permissions')), bulk),
      h('div.perm-scroll', h('table.perm-table', h('thead', head), h('tbody', ...bodyRows)),
        h('div', { style: { padding: '10px 10px 0' } }, h('h3', t('roles.special'))), special),
    ];

    const footer = [];
    const cancel = h('button.btn', { type: 'button' }, editable ? t('common.cancel') : t('common.close'));
    footer.push(cancel);
    let save = null;
    if (editable) { save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges')); footer.push(save); }
    const m = openModal({ title: isNew ? t('roles.add') : (editable ? t('roles.edit') : t('roles.view')), body, footer, size: 'wide' });
    cancel.onclick = () => m.close();
    if (save) {
      save.onclick = () => busy(save, null, async () => {
        form.clearErrors();
        const values = { ...form.values(), permissions: [...chosen] };
        try {
          if (isNew) await call('roles.create', values);
          else await call('roles.update', { id: r.id, ...values });
          m.close();
          toast(isNew ? t('roles.createdSuccess', { name: values.name }) : t('roles.updatedSuccess', { name: values.name }), {
            type: 'success',
            title: isNew ? t('roles.addedTitle') : t('roles.updatedTitle'),
          });
          load();
        } catch (err) { form.showError(err); }
      });
    }
  }

  await load();
  if (params.new && can('roles.create')) { history.replaceState(null, '', '#/roles'); editRole(null); }
  if (params.open) {
    history.replaceState(null, '', '#/roles');
    if (!rows.some((x) => x.id === params.open)) { showInactive = true; inactiveToggle.control.checked = true; await load(); }
    const r = rows.find((x) => x.id === params.open);
    if (r) editRole(r);
  }
}

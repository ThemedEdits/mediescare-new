// Users: add, edit, disable or enable, set a temporary password, unlock.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm, showSecret } from '../ui/modal.js';
import { Form, fieldText, input, passwordInput, select, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params }) {
  const allBranches = can('branches.view_all');
  const [roles, branches] = await Promise.all([
    call('roles.list', {}),
    call('branches.list', {}).catch(() => []),
  ]);
  const grantable = roles.filter((r) => r.canManage);
  const filter = { roleId: '', branchId: '', status: '' };

  const addBtn = can('users.create') ? h('button.btn.primary', { type: 'button', onclick: () => editUser(null) }, icon('plus', 'sm'), t('users.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('users.title')), h('p.sub', t('users.sub'))), addBtn));

  const roleFilter = combobox({ options: roles.map((r) => ({ value: r.id, label: r.name })), emptyLabel: `${t('users.filterRole')}: ${t('common.all')}`, onChange: (v) => { filter.roleId = v; load(); } });
  roleFilter.style.width = '200px';
  const branchFilter = allBranches ? combobox({ options: branches.map((b) => ({ value: b.id, label: b.name, sub: b.code })), emptyLabel: `${t('users.filterBranch')}: ${t('common.all')}`, onChange: (v) => { filter.branchId = v; load(); } }) : null;
  if (branchFilter) branchFilter.style.width = '200px';
  const statusFilter = select([
    { value: '', label: `${t('users.filterStatus')}: ${t('common.all')}` },
    { value: 'active', label: t('common.active') },
    { value: 'disabled', label: t('common.disabled') },
  ], { style: { width: '160px' } });
  statusFilter.addEventListener('change', () => { filter.status = statusFilter.value; load(); });

  const table = dataTable({
    id: 'users',
    tools: [roleFilter, branchFilter, statusFilter].filter(Boolean),
    columns: [
      { key: 'fullName', label: t('users.fullName'), render: (u) => h('div', h('div.cell-main.row', u.fullName, u.isOwner ? h('span.badge.accent', t('users.owner')) : null, u.id === state.me.user.id ? h('span.faint.small', `(${t('common.you')})`) : null), h('div.cell-sub', u.username)), searchValue: (u) => `${u.fullName} ${u.username} ${u.phone || ''}` },
      { key: 'roleName', label: t('users.role'), render: (u) => h('span.badge', { class: u.isSuper ? 'accent' : 'outline' }, u.roleName) },
      { key: 'branchName', label: t('users.branch'), hidden: !allBranches },
      { key: 'phone', label: t('users.phone') },
      { key: 'email', label: t('users.email'), hidden: true },
      { key: 'lastLoginAt', label: t('users.lastLogin'), render: (u) => h('span.nowrap', fmt.relative(u.lastLoginAt)) },
      { key: 'status', label: t('common.status'), render: (u) => h('div.row.wrap',
        h('span.badge', { class: u.status === 'active' ? 'success' : '' }, u.status === 'active' ? t('common.active') : t('common.disabled')),
        u.locked ? h('span.badge.danger', icon('lock', 'sm'), t('users.locked')) : null,
        u.mustChangePassword && u.status === 'active' ? h('span.badge.warning', t('users.mustChange')) : null) },
      { key: 'actions', label: '', render: (u) => rowMenu(u) },
    ],
    onRowClick: can('users.edit') ? (u) => (u.canManage ? editUser(u) : toast(t('users.ownerLocked'))) : null,
    empty: { icon: 'users', title: t('users.empty') },
    defaultSort: null,
  });
  page.append(table.el);

  let rows = [];
  async function load() {
    try { rows = await call('users.list', filter); table.setRows(rows); } catch (err) { toastError(err); }
  }

  function rowMenu(u) {
    if (!u.canManage) return null;
    const self = u.id === state.me.user.id;
    const items = [
      can('users.edit') && { iconEl: icon('edit', 'sm'), label: t('common.edit'), onClick: () => editUser(u) },
      can('users.edit') && !self && { iconEl: icon('key', 'sm'), label: t('users.resetPassword'), onClick: () => resetPassword(u) },
      can('users.edit') && u.locked && { iconEl: icon('unlock', 'sm'), label: t('users.unlock'), onClick: () => act('users.unlock', { id: u.id }) },
      can('users.delete') && !self && !u.isOwner && (u.status === 'active'
        ? { iconEl: icon('power', 'sm'), label: t('users.disable'), danger: true, onClick: () => disable(u) }
        : { iconEl: icon('power', 'sm'), label: t('users.enable'), onClick: () => act('users.setStatus', { id: u.id, status: 'active' }) }),
    ].filter(Boolean);
    if (!items.length) return null;
    const btn = h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.actions') }, icon('more', 'sm'));
    btn.addEventListener('click', () => menu(btn, items, { align: 'right' }));
    return btn;
  }

  async function act(method, args) {
    try { await call(method, args); toast(t('common.saved')); load(); } catch (err) { toastError(err); }
  }

  async function disable(u) {
    const reason = await confirm({ title: t('users.disableTitle', { username: u.username }), text: t('users.disableText'), confirmLabel: t('users.disable'), danger: true, requireReason: true });
    if (reason === false) return;
    act('users.setStatus', { id: u.id, status: 'disabled', reason });
  }

  async function resetPassword(u) {
    const ok = await confirm({ title: t('users.resetTitle', { username: u.username }), text: t('users.resetText'), confirmLabel: t('users.resetPassword') });
    if (!ok) return;
    try {
      const res = await call('users.resetPassword', { id: u.id });
      load();
      await showSecret({ title: t('users.tempPasswordTitle'), text: t('users.tempPasswordText', { username: u.username }), secret: res.temporaryPassword });
    } catch (err) { toastError(err); }
  }

  function editUser(u) {
    const isNew = !u;
    const form = new Form();
    const v = u || { branchId: state.me.branch.id };
    const roleOptions = grantable.map((r) => ({ value: r.id, label: r.name, sub: r.description || '' }));
    if (u && !grantable.some((r) => r.id === u.roleId)) roleOptions.unshift({ value: u.roleId, label: u.roleName });
    const roleBox = combobox({ options: roleOptions, value: v.roleId || '' });
    const lockRole = u && (u.isOwner || u.id === state.me.user.id);
    if (lockRole) roleBox.control.disabled = true;
    const branchBox = combobox({ options: branches.map((b) => ({ value: b.id, label: b.name, sub: b.code })), value: v.branchId, disabled: !allBranches || (u && u.isOwner) });

    const fields = [
      form.add('fullName', fieldText(input({ value: v.fullName || '', maxlength: 120 }), t('users.fullName'), { required: true })),
      form.add('username', fieldText(input({ value: v.username || '', maxlength: 32 }), t('users.username'), { required: true, hint: t('setup.usernameHint') })),
      form.add('roleId', fieldText(roleBox, t('users.role'), { required: true })),
      form.add('branchId', fieldText(branchBox, t('users.branch'), { required: true })),
      form.add('phone', fieldText(input({ value: v.phone || '', maxlength: 40 }), t('users.phone'))),
      form.add('email', fieldText(input({ value: v.email || '', maxlength: 120, type: 'email' }), t('users.email'))),
    ];
    if (isNew) fields.push(form.add('password', fieldText(passwordInput(), `${t('users.password')} (${t('common.optional')})`, { hint: t('users.passwordHint'), span2: true })));

    const save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges'));
    const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
    const m = openModal({ title: isNew ? t('users.add') : t('users.edit'), body: [form.errorBox, h('div.form-grid', ...fields)], footer: [cancel, save], size: 'wide' });
    cancel.onclick = () => m.close();
    save.onclick = () => busy(save, null, async () => {
      form.clearErrors();
      const values = form.values();
      try {
        if (isNew) {
          const res = await call('users.create', values);
          m.close();
          load();
          toast(t('users.created', { username: res.user.username }));
          await showSecret({ title: t('users.tempPasswordTitle'), text: t('users.tempPasswordText', { username: res.user.username }), secret: res.temporaryPassword });
        } else {
          await call('users.update', { id: u.id, ...values });
          m.close();
          toast(t('common.saved'));
          load();
        }
      } catch (err) { form.showError(err); }
    });
  }

  await load();
  if (params.new && can('users.create')) { history.replaceState(null, '', '#/users'); editUser(null); }
  if (params.open) {
    history.replaceState(null, '', '#/users');
    const u = rows.find((x) => x.id === params.open);
    if (u && u.canManage && can('users.edit')) editUser(u);
  }
}

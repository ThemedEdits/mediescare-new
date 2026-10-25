// Branches: list, add (with manager account), edit, deactivate, switch.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm, showSecret } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';

export async function render(page, { params, navigate }) {
  const addBtn = can('branches.create') ? h('button.btn.primary', { type: 'button', onclick: () => editBranch(null) }, icon('plus', 'sm'), t('branches.add')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('branches.title')), h('p.sub', t('branches.sub'))), addBtn));

  const table = dataTable({
    id: 'branches',
    columns: [
      { key: 'code', label: t('branches.code'), width: '90px', render: (b) => h('span.mono', b.code) },
      { key: 'name', label: t('branches.name'), render: (b) => h('div', h('div.cell-main.row', b.name, b.isHeadOffice ? h('span.badge.accent', t('common.headOffice')) : null), b.address ? h('div.cell-sub', b.address) : null), searchValue: (b) => `${b.name} ${b.address || ''}` },
      { key: 'phone', label: t('branches.phone') },
      { key: 'licenceNo', label: t('branches.licence'), hidden: true },
      { key: 'userCount', label: t('branches.users'), align: 'num' },
      { key: 'deviceCount', label: t('branches.devices'), align: 'num' },
      { key: 'active', label: t('common.status'), render: (b) => h('span.badge', { class: b.active ? 'success' : '' }, b.active ? t('common.active') : t('common.inactive')), sortValue: (b) => (b.active ? 0 : 1) },
      { key: 'actions', label: '', render: (b) => rowMenu(b) },
    ],
    onRowClick: can('branches.edit') ? (b) => editBranch(b) : null,
    empty: { icon: 'building', title: t('branches.empty') },
  });
  page.append(table.el);

  let rows = [];
  async function load() {
    try { rows = await call('branches.list', { includeInactive: true }); table.setRows(rows); } catch (err) { toastError(err); }
  }

  function rowMenu(b) {
    const items = [
      can('branches.edit') && { iconEl: icon('edit', 'sm'), label: t('common.edit'), onClick: () => editBranch(b) },
      can('branch.switch') && b.active && b.id !== state.me.branch.id && { iconEl: icon('switch', 'sm'), label: t('branches.switchTo'), onClick: () => switchTo(b) },
      can('branches.delete') && !b.isHeadOffice && (b.active
        ? { iconEl: icon('power', 'sm'), label: t('branches.deactivate'), danger: true, onClick: () => setActive(b, false) }
        : { iconEl: icon('power', 'sm'), label: t('branches.activate'), onClick: () => setActive(b, true) }),
    ].filter(Boolean);
    if (!items.length) return null;
    const btn = h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.actions') }, icon('more', 'sm'));
    btn.addEventListener('click', () => menu(btn, items, { align: 'right' }));
    return btn;
  }

  async function switchTo(b) {
    try {
      const me = await call('branches.switch', { branchId: b.id });
      toast(t('shell.switchedTo', { branch: b.name }));
      window.dispatchEvent(new CustomEvent('mediescare:me', { detail: me }));
    } catch (err) { toastError(err); }
  }

  async function setActive(b, active) {
    let reason = '';
    if (!active) {
      reason = await confirm({ title: t('branches.deactivateTitle', { name: b.name }), text: t('branches.deactivateText'), confirmLabel: t('branches.deactivate'), danger: true, requireReason: true });
      if (reason === false) return;
    }
    try {
      await call('branches.setActive', { id: b.id, active, reason });
      toast(t('common.saved'));
      load();
    } catch (err) { toastError(err); }
  }

  function editBranch(b) {
    const isNew = !b;
    const form = new Form();
    const v = b || {};
    const fields = [
      form.add('name', fieldText(input({ value: v.name || '', maxlength: 120, placeholder: t('branches.namePh') }), t('branches.name'), { required: true })),
      isNew
        ? form.add('code', fieldText(input({ maxlength: 6, placeholder: t('branches.codePh'), style: { textTransform: 'uppercase' } }), t('branches.code'), { required: true, hint: t('branches.codeHint') }))
        : fieldText(input({ value: v.code, readonly: true }), t('branches.code'), { hint: t('branches.codeHint') }).el,
      form.add('address', fieldText(input({ value: v.address || '', maxlength: 300 }), t('branches.address'), { span2: true })),
      form.add('phone', fieldText(input({ value: v.phone || '', maxlength: 40 }), t('branches.phone'))),
      form.add('email', fieldText(input({ value: v.email || '', maxlength: 120, type: 'email' }), t('branches.email'))),
      form.add('licenceNo', fieldText(input({ value: v.licenceNo || '', maxlength: 60 }), t('branches.licence'))),
      form.add('ntn', fieldText(input({ value: v.ntn || '', maxlength: 40 }), t('branches.ntn'))),
    ];
    const body = [form.errorBox, h('div.form-grid', ...fields)];
    if (isNew) {
      body.push(h('div.stack', { style: { marginTop: '18px' } },
        h('div', h('div.section-title', t('branches.managerSection')), h('p.small.muted', t('branches.managerText'))),
        h('div.form-grid',
          form.add('adminFullName', fieldText(input({ maxlength: 120 }), t('branches.managerName'), { required: true })),
          form.add('adminUsername', fieldText(input({ maxlength: 32 }), t('branches.managerUsername'), { required: true, hint: t('setup.usernameHint') })))));
    }
    const save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges'));
    const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
    const m = openModal({ title: isNew ? t('branches.add') : t('branches.edit'), body, footer: [cancel, save], size: 'wide' });
    cancel.onclick = () => m.close();
    save.onclick = () => busy(save, null, async () => {
      form.clearErrors();
      const values = form.values();
      try {
        if (isNew) {
          const res = await call('branches.create', { ...values, admin: { fullName: values.adminFullName, username: values.adminUsername } });
          m.close();
          load();
          toast(t('branches.created', { name: res.branch.name }), { type: 'success', title: t('branches.addedTitle') });
          await showSecret({ title: t('users.tempPasswordTitle'), text: t('branches.createdManager', { username: res.admin.username }), secret: res.admin.temporaryPassword });
        } else {
          await call('branches.update', { id: b.id, ...values });
          m.close();
          toast(t('common.saved'), { type: 'success', title: t('branches.updatedTitle') });
          load();
        }
      } catch (err) {
        const mapped = err.field && err.field.startsWith('admin.') ? Object.assign(err, { field: 'admin' + err.field.slice(6, 7).toUpperCase() + err.field.slice(7) }) : err;
        form.showError(mapped);
      }
    });
  }

  await load();
  if (params.new && can('branches.create')) { history.replaceState(null, '', '#/branches'); editBranch(null); }
  if (params.open) {
    history.replaceState(null, '', '#/branches');
    const b = rows.find((x) => x.id === params.open);
    if (b && can('branches.edit')) editBranch(b);
  }
}

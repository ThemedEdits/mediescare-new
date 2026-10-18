// Computers registered to the organisation, one-time join codes for a branch's new main computer, and the
// organisation recovery key (owner only).
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { menu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import * as fmt from '../ui/format.js';

export async function render(page) {
  page.append(h('div.page-head', h('div', h('h1', t('devices.title')), h('p.sub', t('devices.sub')))));
  page.append(h('div.form-note', { style: { marginBottom: '16px' } }, icon('info', 'sm'), h('div', t('devices.pairNote'))));

  const table = dataTable({
    id: 'devices',
    columns: [
      { key: 'name', label: t('devices.name'), render: (d) => h('div.row', h('span.cell-main', d.name), d.isThisComputer ? h('span.badge.accent', t('common.thisComputer')) : null) },
      { key: 'branchName', label: t('shell.branch') },
      { key: 'deviceNo', label: t('devices.number'), align: 'num', render: (d) => h('span.mono', `${d.branchCode}${d.deviceNo}`) },
      { key: 'kind', label: t('devices.kind'), render: (d) => (d.kind === 'primary' ? t('devices.primary') : t('devices.client')) },
      { key: 'createdAt', label: t('devices.registered'), render: (d) => fmt.date(d.createdAt) },
      { key: 'revoked', label: t('common.status'), render: (d) => h('span.badge', { class: d.revoked ? 'danger' : 'success' }, d.revoked ? t('devices.revoked') : t('common.active')) },
      { key: 'actions', label: '', render: (d) => rowMenu(d) },
    ],
    empty: { icon: 'monitor', title: t('devices.title') },
  });
  page.append(table.el);

  async function load() {
    try { table.setRows(await call('devices.list')); } catch (err) { toastError(err); }
  }

  function rowMenu(d) {
    if (!can('devices.edit')) return null;
    const items = [
      { iconEl: icon('edit', 'sm'), label: t('devices.rename'), onClick: () => rename(d) },
      !d.isThisComputer && !d.revoked && { iconEl: icon('lock', 'sm'), label: t('devices.revoke'), danger: true, onClick: () => revoke(d) },
    ].filter(Boolean);
    const btn = h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.actions') }, icon('more', 'sm'));
    btn.addEventListener('click', () => menu(btn, items, { align: 'right' }));
    return btn;
  }

  function rename(d) {
    const form = new Form();
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
    const m = openModal({ title: t('devices.rename'), size: 'narrow', body: [form.errorBox, form.add('name', fieldText(input({ value: d.name, maxlength: 60 }), t('devices.name'), { required: true }))], footer: [cancel, save] });
    cancel.onclick = () => m.close();
    save.onclick = () => busy(save, null, async () => {
      try { await call('devices.rename', { id: d.id, name: form.value('name') }); m.close(); toast(t('common.saved')); load(); } catch (err) { form.showError(err); }
    });
  }

  async function revoke(d) {
    const reason = await confirm({ title: t('devices.revokeTitle', { name: d.name }), text: t('devices.revokeText'), confirmLabel: t('devices.revoke'), danger: true, requireReason: true });
    if (reason === false) return;
    try { await call('devices.revoke', { id: d.id, reason }); toast(t('common.saved')); load(); } catch (err) { toastError(err); }
  }

  // ---- join codes ----
  if (can('devices.edit')) {
    const codesBody = h('div');
    const newBtn = h('button.btn.primary', { type: 'button', onclick: () => newCode() }, icon('key', 'sm'), t('devices.newJoinCode'));
    page.append(h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('div', h('h2', t('devices.joinCodes')), h('p.small.muted', t('devices.joinCodesSub'))), newBtn), codesBody));
    const TONE = { active: 'success', used: 'outline', expired: 'outline', cancelled: 'danger' };
    const loadCodes = async () => {
      let rows;
      try { rows = await call('devices.joinCodes'); } catch (err) { toastError(err); return; }
      mount(codesBody, rows.length ? h('div.table-scroll', h('table.data',
        h('thead', h('tr', h('th', t('shell.branch')), h('th', t('devices.code')), h('th', t('common.status')), h('th', t('devices.madeBy')), h('th', t('devices.validUntil')), h('th', ''))),
        h('tbody', ...rows.map((c) => h('tr',
          h('td', c.branchName), h('td.mono', c.hint),
          h('td', h('span.badge', { class: TONE[c.status] }, t(`devices.codeStatus.${c.status}`)), c.usedBy ? h('div.cell-sub', c.usedBy) : null),
          h('td', h('div', c.createdBy || ''), h('div.cell-sub', fmt.dateTime(c.createdAt))),
          h('td', fmt.dateTime(c.expiresAt)),
          h('td.actions', c.status === 'active' ? h('button.btn.sm.danger', { type: 'button', onclick: async () => {
            if (!(await confirm({ title: t('devices.cancelCodeTitle'), text: t('devices.cancelCodeText'), confirmLabel: t('devices.cancelCode'), danger: true }))) return;
            try { await call('devices.cancelJoinCode', { id: c.id }); toast(t('devices.codeCancelled')); loadCodes(); } catch (err) { toastError(err); }
          } }, t('devices.cancelCode')) : null)))))) : h('p.small.muted', { style: { padding: '14px 16px' } }, t('devices.noCodes')));
    };
    const newCode = async () => {
      let branches = [];
      try { branches = await call('branches.list', {}); } catch (_) { branches = [state.me.branch]; }
      const form = new Form();
      const branchSel = select(branches.filter((b) => b.active !== false).map((b) => ({ value: b.id, label: b.name })), { value: state.me.branch.id });
      const make = h('button.btn.primary', { type: 'button' }, t('devices.makeCode'));
      const m = openModal({ title: t('devices.newJoinCode'), size: 'narrow', body: [form.errorBox, h('p.small.muted', { style: { marginBottom: '10px' } }, t('devices.newJoinCodeText')),
        form.add('branchId', fieldText(branchSel, t('shell.branch'), { required: true }))], footer: [make] });
      make.onclick = () => busy(make, null, async () => {
        try {
          const res = await call('devices.createJoinCode', { branchId: form.value('branchId') });
          m.close();
          showCode(res);
          loadCodes();
        } catch (err) { form.showError(err); }
      });
    };
    const showCode = (res) => {
      const copyBtn = h('button.btn', { type: 'button' }, icon('copy', 'sm'), t('common.copy'));
      copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(res.code); copyBtn.lastChild.textContent = t('common.copied'); } catch (_) { /* blocked */ } };
      openModal({ title: t('devices.codeFor', { branch: res.branchName }), size: 'narrow', body: [
        h('p.small.muted', { style: { marginBottom: '8px' } }, t('devices.codeGive')),
        h('dl.kv', h('dt', t('setup.joinOrgCode')), h('dd.mono', res.orgCode), h('dt', t('setup.joinCode')), h('dd', h('div.temp-password', { 'data-secret': '1', id: 'join-code' }, res.code))),
        h('div.row', { style: { marginTop: '8px' } }, copyBtn),
        h('div.form-note', { style: { marginTop: '12px' } }, icon('info', 'sm'), h('div', t('devices.codeRules', { when: fmt.dateTime(res.expiresAt) }))),
        res.cloudConnected ? null : h('div.form-error', { style: { marginTop: '10px' } }, icon('alertCircle', 'sm'), h('div', t('devices.codeNoCloud'))),
      ] });
    };
    await loadCodes();

    // ---- recovery key ----
    try {
      const info = await call('org.recoveryInfo');
      const keyBody = h('div.card-body');
      const paint = (i) => mount(keyBody, h('p.small.muted', t('devices.recoveryText')),
        h('p', { style: { marginTop: '8px' } }, i.set ? t('devices.recoverySetAt', { when: fmt.dateTime(i.setAt) }) : t('devices.recoveryNotSet')),
        i.canChange ? h('button.btn', { type: 'button', style: { marginTop: '10px' }, onclick: async () => {
          if (!(await confirm({ title: t('devices.recoveryNewTitle'), text: t('devices.recoveryNewText'), confirmLabel: t('devices.recoveryNew'), danger: true }))) return;
          try {
            const r = await call('org.newRecoveryKey');
            openModal({ title: t('setup.recoveryTitle'), size: 'narrow', body: [h('p.small.muted', { style: { marginBottom: '8px' } }, t('setup.recoveryText')), h('div.temp-password', { 'data-secret': '1' }, r.recoveryKey), h('div.form-note', { style: { marginTop: '12px' } }, icon('info', 'sm'), h('div', t('setup.recoveryNote')))] });
            paint({ ...i, set: true, setAt: r.setAt });
          } catch (err) { toastError(err); }
        } }, icon('key', 'sm'), t('devices.recoveryNew')) : null);
      paint(info);
      page.append(h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('h2', t('devices.recoveryTitle'))), keyBody));
    } catch (_) { /* not available */ }
  }

  await load();
}

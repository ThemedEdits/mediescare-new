// Backups: make one now, a second copy on a USB or external drive, optional encryption, restore (safety copy first).
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { confirm } from '../ui/modal.js';
import { busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { kv } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

function size(bytes) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export async function render(page) {
  const make = can('backups.create') ? h('button.btn.primary', { type: 'button' }, icon('database', 'sm'), t('backup.makeNow')) : null;
  const fromFile = can('backups.restore') ? h('button.btn', { type: 'button' }, icon('upload', 'sm'), t('backup.restoreFile')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('backup.title')), h('p.sub', t('backup.sub'))), h('div.row', fromFile, make)));
  const settingsBox = h('div');
  page.append(settingsBox);
  const table = dataTable({
    id: 'backups', rows: [], searchable: false, defaultSort: { key: 'at', dir: 'desc' },
    columns: [
      { key: 'at', label: t('audit.at'), render: (b) => fmt.dateTime(b.at) },
      { key: 'kind', label: t('movements.type'), render: (b) => t(`backupKind.${b.kind}`) },
      { key: 'size', label: t('backup.size'), align: 'num', render: (b) => size(b.size) },
      { key: 'encrypted', label: t('backup.encrypted'), render: (b) => (b.encrypted ? h('span.badge', icon('lock', 'sm'), t('common.yes')) : '') },
      { key: 'copiedTo', label: t('backup.secondCopy'), render: (b) => b.copiedTo || '' },
      { key: 'status', label: t('common.status'), render: (b) => (b.status === 'ok' ? (b.exists ? h('span.badge.success', t('sync.ok')) : h('span.badge', t('backup.fileGone'))) : h('span.badge.danger', b.message || t('sync.errorLabel'))) },
      { key: 'actions', label: '', render: (b) => (can('backups.restore') && b.status === 'ok' && b.exists ? h('button.btn.sm', { type: 'button', onclick: () => restore({ id: b.id }, b) }, t('backup.restore')) : null) },
    ],
    empty: { icon: 'database', title: t('backup.none') },
  });
  page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('backup.list')), table.el);

  async function load() {
    try {
      const res = await call('backups.list');
      table.setRows(res.backups);
      const s = res.settings;
      const editable = can('backups.create');
      mount(settingsBox, h('div.card', h('div.card-body.stack',
        res.summary.stale ? h('div.form-error', icon('alertCircle', 'sm'), h('div', t('backup.staleWarning'))) : null,
        kv([
          [t('backup.last'), res.summary.lastAt ? fmt.dateTime(res.summary.lastAt) : t('common.never')],
          [t('backup.automatic'), t('backup.automaticText')],
          [t('backup.secondCopy'), h('div.row', h('span', s.external || t('backup.noExternal')),
            editable ? h('button.btn.sm', { type: 'button', onclick: () => change({ chooseFolder: true }) }, t('backup.chooseFolder')) : null,
            editable && s.external ? h('button.btn.sm', { type: 'button', onclick: () => change({ clearFolder: true }) }, t('common.remove')) : null)],
          [t('backup.encryption'), h('div.row', h('span', s.encrypt ? t('backup.encryptOn') : t('backup.encryptOff')),
            editable && res.canEncrypt ? h('button.btn.sm', { type: 'button', onclick: () => change({ encrypt: !s.encrypt }) }, s.encrypt ? t('backup.turnOff') : t('backup.turnOn')) : null)],
        ]),
        h('p.small.muted', t('backup.encryptNote')),
        h('p.small.muted', t('backup.whereNote')))));
    } catch (err) { toastError(err); }
  }

  async function change(params) {
    try { await call('backups.settings', params); toast(t('common.saved')); load(); } catch (err) { toastError(err); }
  }

  async function restore(params, b) {
    const ok = await confirm({ title: t('backup.restoreTitle'), text: b ? t('backup.restoreText', { when: fmt.dateTime(b.at) }) : t('backup.restoreFileText'), confirmLabel: t('backup.restore'), danger: true });
    if (!ok) return;
    try {
      const res = await call('backups.restore', params);
      if (res.restored) toast(t('backup.restored'), { timeout: 10000 });
    } catch (err) { toastError(err); }
  }

  if (make) make.onclick = () => busy(make, t('backup.making'), async () => {
    try { const r = await call('backups.create'); toast(r.message || t('backup.made')); load(); } catch (err) { toastError(err); }
  });
  if (fromFile) fromFile.onclick = () => restore({}, null);
  await load();
}

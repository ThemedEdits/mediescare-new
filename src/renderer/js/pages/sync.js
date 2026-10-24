// Sync screen: shop network and cloud shown separately, Sync now, adding a counter computer, conflicts, full log.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal, confirm } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { filterSelect, kv } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

const STATE_CLASS = { synced: 'success', syncing: 'accent', offline: 'warning', error: 'danger', not_set_up: '' };

export async function render(page) {
  const top = h('div');
  const syncBtn = can('sync.manual') ? h('button.btn.primary', { type: 'button' }, icon('refresh', 'sm'), t('sync.now')) : null;
  page.append(h('div.page-head', h('div', h('h1', t('sync.title')), h('p.sub', t('sync.sub'))), syncBtn), top);
  if (syncBtn) syncBtn.onclick = () => busy(syncBtn, t('sync.syncing'), async () => {
    try { const res = await call('sync.now'); draw(res.status); toast(t('sync.done')); logTable.refresh(); } catch (err) { toastError(err); }
  });

  function channelCard(title, ch, extra) {
    return h('div.card', h('div.card-head', h('h2', title), h('span.badge', { class: STATE_CLASS[ch.state] || '' }, t(`syncState.${ch.state}`))),
      h('div.card-body.stack', kv([
        [t('sync.lastOk'), ch.lastOk ? fmt.dateTime(ch.lastOk) : t('common.never')],
        [t('sync.pending'), String(ch.pending || 0)],
        ch.lastError ? [t('sync.lastError'), h('span', { style: { color: 'var(--danger)' } }, ch.lastError)] : null,
        ch.clockSkewMs !== null && ch.clockSkewMs !== undefined ? [t('sync.clock'), Math.abs(ch.clockSkewMs) > 120000 ? h('span', { style: { color: 'var(--danger)' } }, t('sync.clockOff', { min: Math.round(Math.abs(ch.clockSkewMs) / 60000) })) : t('sync.clockOk')] : null,
        ...(extra || []),
      ])));
  }

  function draw(s) {
    const isPrimary = s.role === 'primary';
    const lanExtra = isPrimary
      ? [[t('sync.thisIs'), t('sync.primaryRole')], [t('sync.service'), s.lan.serving ? t('sync.servingOn', { port: s.lan.port }) : t('sync.notServing')]]
      : [[t('sync.thisIs'), t('sync.clientRole')], [t('sync.mainAt'), s.lan.primaryUrl || '-']];
    const lanActions = h('div.row.wrap',
      isPrimary && can('devices.edit') && s.lan.serving ? h('button.btn', { type: 'button', onclick: () => pairDialog() }, icon('plus', 'sm'), t('sync.addComputer')) : null,
      !isPrimary && can('devices.edit') ? h('button.btn', { type: 'button', onclick: () => changePrimary(s.lan.primaryUrl) }, icon('edit', 'sm'), t('sync.changeMain')) : null);
    const cloudExtra = [[t('sync.cloudAddress'), s.cloud.url || t('sync.noCloud')]];
    const cloudActions = h('div.row.wrap',
      isPrimary && state.me.branch.isHeadOffice && !s.cloud.configured && s.cloud.url && can('branches.view_all') ? h('button.btn.primary', { type: 'button', onclick: connectCloud }, icon('cloud', 'sm'), t('sync.connectCloud')) : null);
    const lanCard = channelCard(t('sync.lan'), s.lan, lanExtra);
    lanCard.querySelector('.card-body').append(lanActions);
    const cloudCard = channelCard(t('sync.cloud'), s.cloud, cloudExtra);
    cloudCard.querySelector('.card-body').append(cloudActions);
    if (!isPrimary) cloudCard.querySelector('.card-body').append(h('p.small.muted', t('sync.clientCloudNote')));
    mount(top, h('div.stack',
      s.clockWarning ? h('div.form-error', icon('alertCircle', 'sm'), h('div', t('sync.clockWarning'))) : null,
      h('div.grid-2', { style: { alignItems: 'start' } }, lanCard, cloudCard),
      s.conflicts ? conflictsCard() : null));
  }

  async function connectCloud() {
    try { draw(await call('cloud.connect')); toast(t('sync.cloudConnected')); } catch (err) { toastError(err); }
  }

  async function pairDialog() {
    try {
      const res = await call('lan.pairingCode');
      openModal({
        title: t('sync.addComputer'), size: 'narrow',
        body: [h('p.small.muted', t('sync.pairSteps')), h('div.temp-password', { style: { fontSize: '30px', margin: '12px 0' } }, res.code),
          kv([[t('sync.mainAddress'), res.addresses.length ? res.addresses.map((a) => `${a}:${res.port}`).join(', ') : `port ${res.port}`], [t('sync.codeValid'), fmt.time(res.expiresAt)]]),
          h('p.small.muted', { style: { marginTop: '8px' } }, t('sync.pairNote'))],
      });
    } catch (err) { toastError(err); }
  }

  function changePrimary(current) {
    const form = new Form();
    const el = input({ value: current || '', placeholder: 'http://192.168.1.10:47800' });
    const save = h('button.btn.primary', { type: 'button' }, t('common.save'));
    const m = openModal({ title: t('sync.changeMain'), size: 'narrow', body: [form.errorBox, form.add('url', fieldText(el, t('sync.mainAddress'), { hint: t('sync.mainAddressHint') }))], footer: [save] });
    save.onclick = () => busy(save, null, async () => {
      try { draw(await call('lan.setPrimary', { url: el.value })); m.close(); toast(t('common.saved')); } catch (err) { form.showError(err); }
    });
  }

  function conflictsCard() {
    const card = h('div.card', h('div.card-head', h('div', h('h2', t('sync.conflicts')), h('p.small.muted', t('sync.conflictsSub')))));
    call('sync.conflicts', {}).then((rows) => {
      card.append(dataTable({
        id: 'sync-conflicts', rows, searchable: false,
        columns: [
          { key: 'at', label: t('audit.at'), render: (c) => fmt.dateTime(c.at) },
          { key: 'kind', label: t('movements.type'), render: (c) => t(`conflictKind.${c.kind}`) },
          { key: 'note', label: t('suppliers.description'), render: (c) => h('div', c.note, c.oldValue ? h('div.cell-sub', `${c.field || ''}: ${c.oldValue}${c.newValue ? ' -> ' + c.newValue : ''}`) : null) },
          { key: 'actions', label: '', render: (c) => (can('sync.manual') ? h('button.btn.sm', { type: 'button', onclick: async () => {
            const note = await confirm({ title: t('sync.resolveTitle'), text: t('sync.resolveText'), confirmLabel: t('sync.resolve'), requireReason: true, reasonOptional: true });
            if (note === false) return;
            try { await call('sync.resolveConflict', { id: c.id, note }); toast(t('common.saved')); load(); } catch (err) { toastError(err); }
          } }, t('sync.resolve')) : null) },
        ],
      }).el);
    }).catch(toastError);
    return card;
  }

  const f = { channel: '', status: '' };
  const logTable = dataTable({
    id: 'sync-log', searchable: false, pageSize: 50,
    tools: [
      filterSelect([{ value: '', label: `${t('sync.channel')}: ${t('common.all')}` }, { value: 'lan', label: t('sync.lan') }, { value: 'cloud', label: t('sync.cloud') }], (v) => { f.channel = v; logTable.resetPage(); logTable.refresh(); }),
      filterSelect([{ value: '', label: `${t('common.status')}: ${t('common.all')}` }, { value: 'ok', label: t('sync.ok') }, { value: 'error', label: t('sync.errorLabel') }, { value: 'info', label: t('sync.info') }], (v) => { f.status = v; logTable.resetPage(); logTable.refresh(); }),
    ],
    columns: [
      { key: 'at', label: t('audit.at'), sortable: false, render: (r) => h('span.nowrap', fmt.dateTime(r.at)) },
      { key: 'channel', label: t('sync.channel'), sortable: false, render: (r) => (r.channel === 'lan' ? t('sync.lan') : t('sync.cloud')) },
      { key: 'status', label: t('common.status'), sortable: false, render: (r) => h('span.badge', { class: r.status === 'ok' ? 'success' : r.status === 'error' ? 'danger' : '' }, r.status === 'ok' ? t('sync.ok') : r.status === 'error' ? t('sync.errorLabel') : t('sync.info')) },
      { key: 'pushed', label: t('sync.sent'), align: 'num', sortable: false },
      { key: 'pulled', label: t('sync.received'), align: 'num', sortable: false },
      { key: 'message', label: t('suppliers.description'), sortable: false },
    ],
    fetch: async (opts) => { try { return await call('sync.log', { ...f, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    empty: { icon: 'history', title: t('sync.noLog') },
  });
  page.append(h('h2', { style: { margin: '16px 0 8px' } }, t('sync.log')), logTable.el);

  async function load() {
    try { draw(await call('sync.status')); } catch (err) { toastError(err); }
  }
  await load();
  const timer = setInterval(load, 10000);
  return () => clearInterval(timer);
}

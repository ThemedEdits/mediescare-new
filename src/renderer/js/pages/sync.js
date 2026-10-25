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
    try {
      const res = await call('sync.now');
      draw(res.status);
      logTable.refresh();
      if (!res.anyRan) {
        toast(t('sync.notConfiguredWarning'), { type: 'warning' });
        return;
      }
      const cloudResult = res.results && res.results.cloud;
      const lanResult = res.results && res.results.lan;
      if (cloudResult && cloudResult.ok === false) {
        toast(cloudResult.error || t('sync.syncFailed'), { type: 'error' });
      } else if (lanResult && lanResult.ok === false) {
        toast(lanResult.error || t('sync.syncFailed'), { type: 'error' });
      } else {
        toast(t('sync.done'));
      }
    } catch (err) { toastError(err); }
  });

  function channelCard({ title, badgeState, iconName, descTitle, descText, items, actions, note }) {
    const descBox = h('div.form-note', { style: { marginBottom: '14px', alignItems: 'flex-start' } },
      icon(iconName, 'sm'),
      h('div', h('strong', descTitle), h('div.small.muted', { style: { marginTop: '2px', lineHeight: '1.4' } }, descText)));
    const actionsBox = actions ? h('div.sync-card-foot', actions) : null;
    const noteEl = note ? h('p.small.muted', { style: { marginTop: '8px' } }, note) : null;

    const cardBody = h('div.card-body.stack',
      descBox,
      kv(items.filter(Boolean)),
      actionsBox,
      noteEl);

    return h('div.card.sync-card',
      h('div.card-head',
        h('h2', title),
        h('span.badge', { class: STATE_CLASS[badgeState] || '' }, t(`syncState.${badgeState}`))),
      cardBody);
  }

  function draw(s) {
    const isPrimary = s.role === 'primary';
    const lanActions = h('div.row.wrap',
      isPrimary && can('devices.edit') && s.lan.serving ? h('button.btn', { type: 'button', onclick: () => pairDialog() }, icon('plus', 'sm'), t('sync.addComputer')) : null,
      !isPrimary && can('devices.edit') ? h('button.btn', { type: 'button', onclick: () => changePrimary(s.lan.primaryUrl) }, icon('edit', 'sm'), t('sync.changeMain')) : null);

    const canManageCloud = isPrimary && (can('branches.view_all') || can('settings.edit'));
    const configCloudBtn = canManageCloud ? h('button.btn', { type: 'button', onclick: () => configureCloudDialog(s.cloud.url) }, icon('settings', 'sm'), t('sync.configureCloud')) : null;
    const connectBtn = isPrimary && state.me.branch.isHeadOffice && !s.cloud.configured && s.cloud.url && canManageCloud ? h('button.btn.primary', { type: 'button', onclick: connectCloud }, icon('cloud', 'sm'), t('sync.connectCloud')) : null;
    const cloudActions = (configCloudBtn || connectBtn) ? h('div.row.wrap', configCloudBtn, connectBtn) : null;

    const lanItems = [
      [t('sync.scope'), t('sync.scopeLan')],
      [t('sync.thisIs'), isPrimary ? t('sync.primaryRole') : t('sync.clientRole')],
      [t('sync.service'), isPrimary ? (s.lan.serving ? t('sync.servingOn', { port: s.lan.port }) : t('sync.notServing')) : (s.lan.primaryUrl || '-')],
      [t('sync.lastOk'), s.lan.lastOk ? fmt.dateTime(s.lan.lastOk) : (isPrimary ? t('sync.lanNeverOk') : t('common.never'))],
      [t('sync.pending'), String(s.lan.pending || 0)],
      s.lan.lastError ? [t('sync.lastError'), h('span', { style: { color: 'var(--danger)' } }, s.lan.lastError)] : null,
    ];

    const cloudItems = [
      [t('sync.scope'), t('sync.scopeCloud')],
      [t('sync.cloudAddress'), s.cloud.url ? h('span.mono.small', { style: { wordBreak: 'break-all' } }, s.cloud.url) : t('sync.noCloud')],
      s.cloud.url ? [t('sync.autoSync'), t('sync.autoSyncInterval')] : null,
      [t('sync.lastOk'), s.cloud.lastOk ? fmt.dateTime(s.cloud.lastOk) : t('common.never')],
      [t('sync.pending'), String(s.cloud.pending || 0)],
      s.cloud.lastError ? [t('sync.lastError'), h('span', { style: { color: 'var(--danger)' } }, s.cloud.lastError)] : null,
      s.cloud.clockSkewMs !== null && s.cloud.clockSkewMs !== undefined ? [t('sync.clock'), Math.abs(s.cloud.clockSkewMs) > 120000 ? h('span', { style: { color: 'var(--danger)' } }, t('sync.clockOff', { min: Math.round(Math.abs(s.cloud.clockSkewMs) / 60000) })) : t('sync.clockOk')] : null,
    ];

    const lanCard = channelCard({
      title: t('sync.lan'),
      badgeState: s.lan.state,
      iconName: 'monitor',
      descTitle: t('sync.lanDescTitle'),
      descText: t('sync.lanDesc'),
      items: lanItems,
      actions: lanActions,
    });

    const cloudCard = channelCard({
      title: t('sync.cloud'),
      badgeState: s.cloud.state,
      iconName: 'cloud',
      descTitle: t('sync.cloudDescTitle'),
      descText: t('sync.cloudDesc'),
      items: cloudItems,
      actions: cloudActions,
      note: !isPrimary ? t('sync.clientCloudNote') : null,
    });

    mount(top, h('div.stack',
      s.clockWarning ? h('div.form-error', icon('alertCircle', 'sm'), h('div', t('sync.clockWarning'))) : null,
      h('div.grid-2.sync-cards-grid', { style: { alignItems: 'stretch' } }, lanCard, cloudCard),
      s.conflicts ? conflictsCard() : null));
  }

  async function connectCloud() {
    try { draw(await call('cloud.connect')); toast(t('sync.cloudConnected')); } catch (err) { toastError(err); }
  }

  function configureCloudDialog(currentUrl) {
    const defaultUrl = 'https://mediescare-gateway.mediescare.workers.dev';
    const form = new Form();
    const urlInput = input({ value: currentUrl || defaultUrl, placeholder: t('sync.cloudAddressPh'), maxlength: 300 });
    const keyInput = input({ type: 'password', placeholder: t('sync.cloudSetupKeyPh'), maxlength: 200 });
    const saveBtn = h('button.btn.primary', { type: 'button' }, icon('cloud', 'sm'), t('sync.saveAndConnect'));
    const m = openModal({
      title: t('sync.configureCloud'),
      size: 'wide',
      body: [
        h('div.form-note', { style: { marginBottom: '14px' } }, icon('info', 'sm'),
          h('div', h('strong', t('sync.cloudHelpTitle')), h('div.small.muted', t('sync.cloudHelpText')))),
        form.errorBox,
        form.add('url', fieldText(urlInput, t('sync.cloudAddress'), { required: true, hint: t('sync.cloudAddressHint') })),
        form.add('setupKey', fieldText(keyInput, t('sync.cloudSetupKey'), { hint: t('sync.cloudSetupKeyHint') })),
      ],
      footer: [saveBtn],
    });
    saveBtn.onclick = () => busy(saveBtn, t('sync.connectingCloud'), async () => {
      form.clearErrors();
      try {
        const nextStatus = await call('cloud.configure', { url: urlInput.value.trim(), setupKey: keyInput.value.trim() });
        m.close();
        draw(nextStatus);
        toast(t('sync.cloudConnected'));
        logTable.refresh();
      } catch (err) {
        form.showError(err);
      }
    });
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

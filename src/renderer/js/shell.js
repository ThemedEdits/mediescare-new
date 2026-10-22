// The signed-in frame: top bar (branch, user and role, sync, backup, notifications, search, sign out) and side menu.
import { h, mount, initials, highlight, debounce } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { t } from './strings/index.js';
import { state, can } from './state.js';
import { call } from './api.js';
import { ROUTES, GROUPS, PARENT, allowed, parseHash, navigate, findRoute } from './router.js';
import { popover, menu, closePopover } from './ui/popover.js';
import { relative, money } from './ui/format.js';
import { openModal } from './ui/modal.js';
import { toast, toastError } from './ui/toast.js';
import { keyFor } from './keys.js';

let mainEl = null;
let navEl = null;
let shellEl = null;
let cleanup = null;
let syncChip = null;
let statusTimer = null;
const SYNC_DOT = { synced: 'success', syncing: 'success', offline: 'warning', error: 'danger', not_set_up: '' };
let renderToken = 0;
let bellEl = null;
let updateChip = null;
let bellTimer = null;
let notes = { items: [], unread: 0 };

const NOTE_ICON = { critical: 'alertCircle', warning: 'alert', info: 'info' };

// The bell shows how many notifications are new for this person. Opening the list marks them as seen.
async function refreshBell() {
  if (!bellEl) return;
  try { notes = await call('notifications.list'); } catch (_) { return; }
  paintBell();
}

function paintBell() {
  if (!bellEl) return;
  const old = bellEl.querySelector('.bell-count');
  if (old) old.remove();
  if (notes.unread) bellEl.append(h('span.bell-count', String(notes.unread > 99 ? '99+' : notes.unread)));
  bellEl.setAttribute('aria-label', notes.unread ? t('shell.notificationsNew', { n: notes.unread }) : t('shell.notifications'));
}

async function showNotifications(anchor) {
  await refreshBell();
  const list = notes.items.length
    ? h('div.notif-list', ...notes.items.map((n) => h('a.notif', {
      class: n.severity, href: `#/${n.route.path}${n.route.params ? '?' + new URLSearchParams(n.route.params).toString() : ''}`, onclick: () => closePopover(),
    }, icon(NOTE_ICON[n.severity] || 'info', 'sm'), h('div.grow', h('div', h('strong', n.title)), h('div.small.muted', n.text)), n.unread ? h('span.notif-new', { title: t('shell.new') }) : null)))
    : h('p.small.muted', { style: { padding: '6px 10px 10px' } }, t('shell.noNotifications'));
  popover(anchor, h('div', h('div.row.between', { style: { padding: '8px 10px' } }, h('strong', t('shell.notifications')), h('span.small.faint', t('shell.notificationsHint'))), list), { align: 'right', width: 380 });
  if (notes.unread) {
    try { notes = await call('notifications.markSeen', {}); paintBell(); } catch (_) { /* the count stays */ }
  }
}

// The update chip appears in the top bar while a new version downloads or is ready to install. Managers can restart
// into it at once; everyone else gets it the next time Mediescare is closed and opened.
async function refreshUpdate() {
  if (!updateChip) return;
  let st;
  try { st = await call('update.status'); } catch (_) { return; }
  if (st.state !== 'ready' && st.state !== 'downloading') { updateChip.hidden = true; return; }
  updateChip.hidden = false;
  updateChip.classList.toggle('update-ready', st.state === 'ready');
  updateChip.replaceChildren(icon('download', 'sm'), h('span.two-line', h('span.label', t('update.chipLabel')),
    h('span.value', st.state === 'ready' ? t('update.chipReady', { v: st.available }) : t('update.chipDownloading', { p: st.progress || 0 }))));
  updateChip.onclick = () => {
    const install = can('settings.edit') && st.state === 'ready' ? h('button.btn.primary.sm', { type: 'button', onclick: async () => {
      closePopover();
      try { await call('update.install'); toast(t('help.installing')); } catch (err) { toastError(err); }
    } }, t('help.install')) : null;
    popover(updateChip, h('div.stack.tight', { style: { padding: '8px 10px' } },
      h('strong', st.state === 'ready' ? t('update.readyTitle', { v: st.available }) : t('update.downloadingTitle', { v: st.available || '' })),
      h('p.small.muted', st.state === 'ready' ? (install ? t('update.readyManager') : t('update.readyStaff')) : t('update.downloadingText')),
      h('div.row', install, h('a.btn.sm', { href: '#/help', onclick: () => closePopover() }, t('nav.help')))), { width: 340, align: 'right' });
  };
}

export function openNotifications() {
  if (bellEl) showNotifications(bellEl);
}

function navCollapsed() {
  try { return localStorage.getItem('navCollapsed') === '1'; } catch (_) { return false; }
}

export function renderShell(root, { onSignOut, onSessionChange }) {
  const me = state.me;
  const branch = me.branch;

  // Branch chip: switchable for people allowed to work across branches.
  const branchChip = h('button.top-chip', { type: 'button', 'aria-label': t('shell.branch') },
    icon('building', 'sm'),
    h('span.two-line', h('span.label', t('shell.branch')), h('span.value', branch.name)),
    branch.isHeadOffice ? h('span.badge.accent', t('common.headOffice')) : null,
    can('branch.switch') ? icon('chevronDown', 'sm') : null);
  branchChip.addEventListener('click', async () => {
    if (!can('branch.switch')) return;
    try {
      const branches = await call('branches.list', {});
      menu(branchChip, [
        { node: h('div.menu-head.small.muted', t('shell.switchBranch')) },
        ...branches.map((b) => ({
          iconEl: b.id === branch.id ? icon('check', 'sm') : h('span', { style: { width: '15px' } }),
          label: h('span.row', b.name, b.isHeadOffice ? h('span.badge.accent', t('common.headOffice')) : null),
          onClick: async () => {
            if (b.id === branch.id) return;
            try {
              state.me = await call('branches.switch', { branchId: b.id });
              toast(t('shell.switchedTo', { branch: b.name }));
              onSessionChange();
            } catch (err) { toastError(err); }
          },
        })),
      ]);
    } catch (err) { toastError(err); }
  });

  syncChip = h('button.top-chip', { type: 'button', 'aria-label': t('shell.syncTitle'), id: 'sync-chip' });
  const backupChip = h('button.top-chip', { type: 'button', 'aria-label': t('shell.backupTitle'), id: 'backup-chip' });
  let lastStatus = null;
  syncChip.addEventListener('click', () => {
    const s = lastStatus;
    const line = (name, ch) => h('div.row', h('span.dot', { class: SYNC_DOT[ch.state] || '' }), h('strong', name), h('span.small.muted', t(`syncState.${ch.state}`)),
      h('span.spacer'), ch.pending ? h('span.small', t('shell.syncPending', { n: ch.pending })) : null);
    popover(syncChip, h('div.stack.tight', { style: { padding: '8px 10px' } },
      s ? line(t('sync.lan'), s.lan) : null, s ? line(t('sync.cloud'), s.cloud) : null,
      s && s.conflicts ? h('p.small', { style: { color: 'var(--warning)' } }, t('sync.conflictsWaiting', { n: s.conflicts })) : null,
      s && s.clockWarning ? h('p.small', { style: { color: 'var(--danger)' } }, t('sync.clockWarning')) : null,
      can('sync.view') ? h('a.btn.sm', { href: '#/sync', onclick: () => closePopover() }, t('sync.open')) : null), { width: 360 });
  });
  backupChip.addEventListener('click', () => {
    const b = lastStatus && lastStatus.backup;
    popover(backupChip, h('div.stack.tight', { style: { padding: '8px 10px' } },
      h('strong', b && b.lastAt ? t('backup.lastAt', { when: relative(b.lastAt) }) : t('shell.backupNone')),
      b && b.external ? h('p.small.muted', t('backup.copiesTo', { folder: b.external })) : h('p.small.muted', t('backup.noExternal')),
      b && b.stale ? h('p.small', { style: { color: 'var(--danger)' } }, t('backup.staleWarning')) : null,
      can('backups.view') ? h('a.btn.sm', { href: '#/backups', onclick: () => closePopover() }, t('backup.open')) : null), { width: 340 });
  });
  // The top bar shows the live sync and backup state, refreshed every 15 seconds.
  const paintStatus = (s) => {
    lastStatus = s;
    const worst = ['error', 'offline', 'syncing', 'synced', 'not_set_up'].find((st) => [s.lan.state, s.cloud.state].includes(st)) || 'not_set_up';
    const pendingTotal = (s.lan.pending || 0) + (s.cloud.pending || 0);
    syncChip.replaceChildren(icon(worst === 'synced' || worst === 'syncing' ? 'cloud' : 'cloudOff', 'sm'),
      h('span.two-line', h('span.label', t('shell.syncTitle')), h('span.value', { style: { color: worst === 'error' ? 'var(--danger)' : '' } }, t(`syncState.${worst}`) + (pendingTotal ? ` (${pendingTotal})` : ''))));
    const b = s.backup;
    backupChip.replaceChildren(icon('database', 'sm'), h('span.two-line', h('span.label', t('shell.backupTitle')),
      h('span.value', { style: { color: b.stale ? 'var(--danger)' : '' } }, b.lastAt ? relative(b.lastAt) : t('shell.backupNone'))));
  };
  for (const [chip, ic, label] of [[syncChip, 'cloud', t('shell.syncTitle')], [backupChip, 'database', t('shell.backupTitle')]]) {
    chip.replaceChildren(icon(ic, 'sm'), h('span.two-line', h('span.label', label), h('span.value.faint', t('common.loading'))));
  }
  const refreshStatus = () => call('sync.status').then(paintStatus).catch(() => {});
  refreshStatus();
  clearInterval(statusTimer);
  statusTimer = setInterval(() => { if (document.body.contains(syncChip)) refreshStatus(); else clearInterval(statusTimer); }, 15000);

  const bell = h('button.btn.ghost.icon-only', { type: 'button', 'aria-label': t('shell.notifications'), id: 'bell', style: { position: 'relative' } }, icon('bell'));
  bellEl = bell;
  bell.addEventListener('click', () => showNotifications(bell));
  updateChip = h('button.top-chip', { type: 'button', id: 'update-chip', hidden: true, 'aria-label': t('update.chipLabel') });
  refreshBell();
  refreshUpdate();
  clearInterval(bellTimer);
  bellTimer = setInterval(() => { if (document.body.contains(bell)) { refreshBell(); refreshUpdate(); } else clearInterval(bellTimer); }, 60000);

  const userChip = h('button.top-chip', { type: 'button', 'aria-label': t('shell.profile') },
    h('span.avatar', initials(me.user.fullName)),
    h('span.two-line', h('span.value', me.user.fullName), h('span.label', me.user.username)),
    h('span.badge', { class: me.user.isSuper ? 'accent' : 'outline' }, me.user.roleName));
  userChip.addEventListener('click', () => menu(userChip, [
    { iconEl: icon('user', 'sm'), label: t('shell.profile'), onClick: () => navigate('profile') },
    { iconEl: icon('keyboard', 'sm'), label: t('shell.shortcuts'), onClick: () => navigate('shortcuts') },
    { separator: true },
    { iconEl: icon('logout', 'sm'), label: t('shell.signOut'), danger: true, onClick: onSignOut },
  ], { align: 'right' }));

  const signOutBtn = h('button.btn.ghost.icon-only', { type: 'button', 'aria-label': t('shell.signOut'), title: t('shell.signOut'), onclick: onSignOut }, icon('logout'));

  const searchBtn = h('button.search-trigger', { type: 'button', onclick: openPalette }, icon('search', 'sm'), h('span', t('shell.searchPlaceholder')), h('span.kbd', keyFor('global.search') || 'Ctrl+K'));
  const toggleNav = h('button.btn.ghost.icon-only', { type: 'button', 'aria-label': t('shell.collapse') }, icon('sidebar'));

  const topbar = h('header.topbar',
    h('div.brand', h('img', { src: 'assets/mediescare-icon.svg', alt: '' }), h('span.brand-name', t('app.name')), h('span.spacer'), toggleNav),
    searchBtn, h('div.spacer'),
    branchChip, h('span.top-divider'), syncChip, backupChip, updateChip, h('span.top-divider'), bell, userChip, signOutBtn);

  navEl = h('nav.sidebar', { 'aria-label': 'Main menu' });
  mainEl = h('main.main', { id: 'main', tabindex: '-1' });
  shellEl = h('div.shell', { class: navCollapsed() ? 'nav-collapsed' : '' }, topbar, navEl, mainEl);
  toggleNav.addEventListener('click', () => {
    shellEl.classList.toggle('nav-collapsed');
    try { localStorage.setItem('navCollapsed', shellEl.classList.contains('nav-collapsed') ? '1' : '0'); } catch (_) { /* not important */ }
  });
  mount(root, shellEl);
  renderNav();
  return { route };
}

function renderNav() {
  const { path: raw } = parseHash();
  const path = PARENT[raw] || raw;
  const groups = GROUPS.map((g) => {
    const items = ROUTES.filter((r) => r.group === g.key && allowed(r));
    if (!items.length) return null;
    return h('div.nav-group', h('div.nav-group-title', g.title()),
      ...items.map((r) => h('a.nav-item', { href: `#/${r.path}`, class: r.path === path ? 'active' : '', title: r.title(), 'aria-current': r.path === path ? 'page' : null }, icon(r.icon), h('span', r.title()))));
  });
  mount(navEl, ...groups);
}

export async function route() {
  if (!mainEl) return;
  closePopover();
  const { path, params } = parseHash();
  let r = findRoute(path);
  if (!r || !allowed(r)) r = findRoute('home');
  renderNav();
  refreshBell();
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } cleanup = null; }
  const token = ++renderToken;
  mount(mainEl, h('div.loading', h('span.spinner'), t('common.loading')));
  document.title = `${r.title()} - ${t('app.name')}`;
  try {
    const mod = await r.load();
    if (token !== renderToken || !mainEl) return;
    const page = h('div.page');
    mount(mainEl, page);
    mainEl.scrollTop = 0;
    const result = await mod.render(page, { params, navigate });
    if (typeof result === 'function') cleanup = result;
  } catch (err) {
    if (token !== renderToken || !mainEl) return;
    mount(mainEl, h('div.page', h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message || t('error.generic')))));
  }
}

// Ctrl+K: search everything this person may open - pages, actions, reports, and records (medicines, batches, bills,
// customers, suppliers, purchases, transfers, payments, users, branches). A scanned barcode or an exact document
// number followed by Enter opens that record directly.
let reportCatalog = null;
export function openPalette() {
  if (!state.me) return;
  const entries = [
    ...ROUTES.filter((r) => allowed(r) && (r.group || r.path === 'profile' || r.path === 'shortcuts')).map((r) => ({ group: t('shell.groupPages'), label: r.title(), icon: r.icon || 'arrowRight', run: () => navigate(r.path) })),
    can('users.create') && { group: t('shell.groupActions'), label: t('users.add'), icon: 'plus', run: () => navigate('users', { new: '1' }) },
    can('branches.create') && { group: t('shell.groupActions'), label: t('branches.add'), icon: 'plus', run: () => navigate('branches', { new: '1' }) },
    can('roles.create') && { group: t('shell.groupActions'), label: t('roles.add'), icon: 'plus', run: () => navigate('roles', { new: '1' }) },
    can('products.create') && { group: t('shell.groupActions'), label: t('products.add'), icon: 'plus', run: () => navigate('products', { new: '1' }) },
    can('purchases.create') && can('cost.view') && { group: t('shell.groupActions'), label: t('grn.new'), icon: 'download', run: () => navigate('grn', { new: '1' }) },
    can('purchases.create') && can('cost.view') && { group: t('shell.groupActions'), label: t('po.new'), icon: 'clipboard', run: () => navigate('po', { new: '1' }) },
    can('stock.create') && { group: t('shell.groupActions'), label: t('adjustments.add'), icon: 'clipboard', run: () => navigate('adjustments') },
    can('transfers.create') && { group: t('shell.groupActions'), label: t('transfers.send'), icon: 'truck', run: () => navigate('transfers') },
    can('expenses.create') && { group: t('shell.groupActions'), label: t('expenses.add'), icon: 'wallet', run: () => navigate('expenses', { new: '1' }) },
    { group: t('shell.groupActions'), label: t('pw.title'), icon: 'key', run: () => navigate('profile', { password: '1' }) },
    ...(reportCatalog || []).map((r) => ({ group: t('shell.groupReports'), label: r.title, icon: 'chart', run: () => navigate('report', { key: r.key }) })),
  ].filter(Boolean);
  if (!reportCatalog && can('reports.view')) call('reports.catalog').then((c) => { reportCatalog = c; }).catch(() => {});

  const inputEl = h('input.input', { type: 'text', placeholder: t('shell.searchEverything'), 'aria-label': t('common.search'), autofocus: true });
  const results = h('div.palette-results', { role: 'listbox' });
  let active = 0;
  let shown = [];
  let found = { q: '', groups: [], exact: null };
  const m = openModal({ title: t('common.search'), body: [h('div.input-wrap', icon('search'), inputEl), results], size: 'palette' });
  m.modal.querySelector('.modal-head').remove();
  m.body.style.padding = '0';

  function render() {
    const raw = inputEl.value.trim();
    const q = raw.toLowerCase();
    shown = (q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries).slice(0, q ? 12 : 60);
    if (q && found.q === raw) {
      for (const g of found.groups) {
        for (const it of g.items) shown.push({ group: g.title, label: it.title, sub: it.sub, amount: it.amount, icon: GROUP_ICON[g.key] || 'arrowRight', run: () => navigate(it.route.path, it.route.params) });
      }
    }
    if (active >= shown.length) active = Math.max(shown.length - 1, 0);
    results.replaceChildren();
    if (!shown.length) {
      results.append(h('div.combo-empty', q.length >= 2 && found.q !== raw ? t('common.loading') : t('shell.paletteEmpty', { q: raw })));
      return;
    }
    let group = null;
    shown.forEach((e, i) => {
      if (e.group !== group) { group = e.group; results.append(h('div.palette-group', group)); }
      const btn = h('button.menu-item', { type: 'button', class: i === active ? 'active' : '', onclick: () => { m.close(); e.run(); } },
        icon(e.icon, 'sm'), h('span.grow', h('div', highlight(e.label, raw)), e.sub ? h('div.palette-sub', e.sub) : null),
        e.amount !== undefined && e.amount !== null ? h('span.small.faint', money(e.amount)) : null);
      results.append(btn);
      if (i === active) btn.scrollIntoView({ block: 'nearest' });
    });
    if (!q) results.append(h('div.small.faint', { style: { padding: '8px 10px' } }, t('shell.paletteHint')));
  }
  let seq = 0;
  const lookUp = debounce(async () => {
    const raw = inputEl.value.trim();
    if (raw.length < 2) return;
    const mine = ++seq;
    try {
      const res = await call('search.global', { q: raw });
      if (mine !== seq || inputEl.value.trim() !== raw) return;
      found = res;
      render();
    } catch (_) { /* pages still work */ }
  }, 180);
  inputEl.addEventListener('input', () => { active = 0; render(); lookUp(); });
  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const raw = inputEl.value.trim();
      // A barcode scanner types fast and presses Enter: ask once more so the exact match is not missed.
      if (raw.length >= 2 && found.q !== raw) {
        try { found = await call('search.global', { q: raw }); } catch (_) { /* fall through */ }
      }
      if (found.exact && found.q === raw) { m.close(); navigate(found.exact.path, found.exact.params); return; }
      render();
      if (shown[active]) { m.close(); shown[active].run(); }
    }
  });
  render();
}

const GROUP_ICON = {
  products: 'pill', batches: 'layers', sales: 'receipt', customers: 'users', suppliers: 'truck', purchases: 'download', transfers: 'switch',
  payments: 'wallet', adjustments: 'clipboard', users: 'user', branches: 'building',
};


export function destroyShell() {
  renderToken++;
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } cleanup = null; }
  mainEl = null;
  navEl = null;
  shellEl = null;
  syncChip = null;
}

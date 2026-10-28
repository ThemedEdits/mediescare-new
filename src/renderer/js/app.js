// Screen entry point: decides between first-run setup, sign-in, forced password change and the main shell.
import { call, onSignedOut } from './api.js';
import { state, applyPrefs } from './state.js';
import { renderShell, route, openPalette, openNotifications, destroyShell } from './shell.js';
import { loadShortcuts, actionFor } from './keys.js';
import { navigate, findRoute, allowed } from './router.js';
import { toast } from './ui/toast.js';
import { t } from './strings/index.js';
import { initNavHistory } from './nav-history.js';

const root = document.getElementById('root');
let shellActive = false;
let lastPing = 0;

async function loadState() {
  state.app = await call('app.state');
  state.me = state.app.session;
  applyPrefs();
}

async function start(message) {
  try {
    await loadState();
  } catch (err) {
    root.textContent = err.message;
    return;
  }
  destroyShell();
  shellActive = false;
  if (!state.app.setUp) {
    const { renderSetup } = await import('./pages/setup.js');
    return renderSetup(root, { onDone: (me) => afterSignIn(me) });
  }
  if (!state.me) return showLogin(message);
  if (state.me.user.mustChangePassword) return showForcedPassword();
  showShell();
}

async function showLogin(message) {
  const { renderLogin } = await import('./pages/login.js');
  renderLogin(root, { message, onDone: afterSignIn });
}

async function showForcedPassword() {
  const { renderForcedPassword } = await import('./pages/password.js');
  renderForcedPassword(root, { onDone: () => start(), onSignOut: signOut });
}

function afterSignIn(me) {
  state.me = me;
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  start();
}

async function showShell() {
  await loadShortcuts();
  shellActive = true;
  renderShell(root, { onSignOut: signOut, onSessionChange: () => { applyPrefs(); showShell(); } });
  route();
}

async function signOut() {
  try { await call('auth.logout'); } catch (_) { /* already signed out */ }
  state.me = null;
  location.hash = '#/home';
  start(t('login.signedOut'));
}

onSignedOut((err) => {
  if (!shellActive) return;
  shellActive = false;
  start(err.message);
});

window.addEventListener('hashchange', () => { if (shellActive) route(); });

// Profile changes (theme, name) refresh the frame without signing out.
window.addEventListener('mediescare:me', (e) => {
  state.me = e.detail;
  applyPrefs();
  if (shellActive) showShell();
});

// System color scheme change (when user selects Same as Windows)
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const prefs = (state.me && state.me.user.prefs) || {};
    if (!prefs.theme || prefs.theme === 'system') {
      applyPrefs();
    }
  });
}

// Activity keeps the session alive; the main process signs out idle sessions.
function activity() {
  if (!shellActive || Date.now() - lastPing < 60000) return;
  lastPing = Date.now();
  call('auth.ping').catch(() => {});
}
window.addEventListener('keydown', activity, true);
window.addEventListener('mousedown', activity, true);

// Notice idle sign-out even when nobody touches the screen.
setInterval(async () => {
  if (!shellActive) return;
  try {
    const s = await call('app.state');
    if (!s.session) { shellActive = false; start(s.messages.sessionExpired); }
  } catch (_) { /* ignore */ }
}, 30000);

// Global shortcuts (each person can change the keys: My profile -> Keyboard shortcuts). Not while a dialog is open.
const GO = { 'go.home': 'home', 'go.dashboard': 'dashboard', 'go.pos': 'pos', 'go.sales': 'sales', 'go.products': 'products', 'go.customers': 'customers',
  'go.reports': 'reports', 'go.expenses': 'expenses', 'go.approvals': 'approvals', 'go.finance': 'finance' };
window.addEventListener('keydown', (e) => {
  if (!shellActive || document.querySelector('.backdrop')) return;
  const action = actionFor(e, 'global');
  if (!action) return;
  e.preventDefault();
  if (action === 'global.search') openPalette();
  else if (action === 'global.notifications') openNotifications();
  else if (action === 'global.shortcuts') navigate('shortcuts');
  else if (action === 'global.signOut') signOut();
  else if (GO[action]) { const r = findRoute(GO[action]); if (r && allowed(r)) navigate(GO[action]); }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled', e.reason);
  toast(t('error.generic'), { type: 'error' });
});

initNavHistory();
start();

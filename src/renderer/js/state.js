// Screen-side copy of who is signed in and the public settings. Only used to show or hide things;
// the main process checks every permission again on its own.
export const state = {
  app: null, // result of app.state
  me: null,  // signed-in user payload
};

export function can(perm) {
  if (!state.me) return false;
  const p = state.me.permissions;
  return p.includes('*') || p.includes(perm);
}

export function canAny(perms) {
  return perms.some(can);
}

export function settings() {
  return (state.app && state.app.settings) || { currencySymbol: 'Rs', currencyDecimals: 2, dateFormat: 'DD/MM/YYYY' };
}

export function applyPrefs() {
  const prefs = (state.me && state.me.user.prefs) || {};
  const root = document.documentElement;
  if (prefs.theme === 'dark' || prefs.theme === 'light') root.dataset.theme = prefs.theme;
  else delete root.dataset.theme;
  if (prefs.density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;

  if (window.mediescare && typeof window.mediescare.setTheme === 'function') {
    let effectiveTheme = prefs.theme || 'system';
    if (effectiveTheme === 'system') {
      const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = isSystemDark ? 'dark' : 'light';
    }
    window.mediescare.setTheme(effectiveTheme);
  }
}

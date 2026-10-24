// My profile: own name, username, password and preferences.
import { h } from '../ui/dom.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state } from '../state.js';
import { Form, fieldText, input, select, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { passwordForm } from './password.js';

function announce(me) {
  window.dispatchEvent(new CustomEvent('mediescare:me', { detail: me }));
}

export async function render(page, { params }) {
  const me = state.me;
  page.append(h('div.page-head', h('div', h('h1', t('profile.title')), h('p.sub', t('profile.sub')))));

  const form = new Form();
  const save = h('button.btn.primary', { type: 'button' }, t('common.saveChanges'));
  const details = h('div.card', h('div.card-head', h('h2', t('profile.details'))), h('div.card-body.stack',
    form.errorBox,
    h('div.form-grid',
      form.add('fullName', fieldText(input({ value: me.user.fullName, maxlength: 120 }), t('users.fullName'), { required: true })),
      form.add('username', fieldText(input({ value: me.user.username, maxlength: 32 }), t('users.username'), { required: true, hint: t('setup.usernameHint') })),
      form.add('phone', fieldText(input({ value: me.user.phone || '', maxlength: 40 }), t('users.phone'))),
      form.add('email', fieldText(input({ value: me.user.email || '', maxlength: 120, type: 'email' }), t('users.email'))),
      fieldText(input({ value: me.user.roleName, readonly: true }), t('profile.role')).el,
      fieldText(input({ value: me.branch.name, readonly: true }), t('profile.branch')).el),
    h('div.row', h('div.spacer'), save)));
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      const next = await call('profile.update', form.values());
      toast(t('common.saved'));
      announce(next);
    } catch (err) { form.showError(err); }
  });

  const pw = passwordForm({ forced: false, onDone: () => { toast(t('pw.changed')); pwCard.querySelectorAll('input').forEach((i) => { i.value = ''; }); } });
  const pwCard = h('div.card', h('div.card-head', h('div', h('h2', t('profile.password')), h('p.small.muted', t('profile.passwordText')))), h('div.card-body', pw.el));

  const prefs = me.user.prefs || {};
  const theme = select([
    { value: 'light', label: t('profile.themeLight') }, { value: 'dark', label: t('profile.themeDark') }, { value: 'system', label: t('profile.themeSystem') },
  ], { value: prefs.theme || 'light' });
  const density = select([
    { value: 'comfortable', label: t('profile.densityComfortable') }, { value: 'compact', label: t('profile.densityCompact') },
  ], { value: prefs.density || 'comfortable' });
  const language = select([{ value: 'en', label: t('profile.languageEn') }], { value: 'en' });
  async function savePrefs() {
    try { announce(await call('profile.setPrefs', { theme: theme.value, density: density.value, language: language.value })); } catch (err) { toastError(err); }
  }
  for (const s of [theme, density, language]) s.addEventListener('change', savePrefs);
  const prefsCard = h('div.card', h('div.card-head', h('h2', t('profile.preferences'))), h('div.card-body', h('div.form-grid',
    fieldText(theme, t('profile.theme')).el, fieldText(density, t('profile.density')).el, fieldText(language, t('profile.language')).el)));

  page.append(h('div.grid-2', { style: { alignItems: 'start' } }, h('div', details, prefsCard), pwCard));
  if (params.password) { history.replaceState(null, '', '#/profile'); pw.focus(); }
}

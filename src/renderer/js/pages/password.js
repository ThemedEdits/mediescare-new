// Password change: forced after a temporary password, or voluntary from the profile page.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { settings } from '../state.js';
import { Form, fieldText, passwordInput, busy } from '../ui/form.js';

export function passwordForm({ forced, onDone, extraButtons = [] }) {
  const form = new Form();
  const submit = h('button.btn.primary', { type: 'submit' }, t('pw.button'));
  const min = settings().minPasswordLength || 6;
  const el = h('form.stack', { novalidate: true },
    form.errorBox,
    form.add('currentPassword', fieldText(passwordInput({ autocomplete: 'current-password' }), forced ? t('pw.currentTemp') : t('pw.current'), { required: true })),
    form.add('newPassword', fieldText(passwordInput(), t('pw.new'), { required: true, hint: t('pw.newHint', { min }) })),
    form.add('confirmPassword', fieldText(passwordInput(), t('pw.confirm'), { required: true })),
    h('div.row', ...extraButtons, h('div.spacer'), submit));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.clearErrors();
    const v = form.values();
    if (v.newPassword !== v.confirmPassword) { form.fields.confirmPassword.setError(t('pw.mismatch')); return; }
    await busy(submit, null, async () => {
      try {
        await call('auth.changePassword', v);
        onDone();
      } catch (err) { form.showError(err); }
    });
  });
  return { el, focus: () => form.fields.currentPassword.input.focus() };
}

export function renderForcedPassword(root, { onDone, onSignOut }) {
  const signOut = h('button.btn', { type: 'button', onclick: onSignOut }, icon('logout', 'sm'), t('shell.signOut'));
  const f = passwordForm({ forced: true, onDone, extraButtons: [signOut] });
  mount(root, h('div.auth-wrap', h('div.auth-card',
    h('div.auth-logo', h('img', { src: 'assets/mediescare-logo.svg', alt: t('app.name') })),
    h('h1.auth-title', t('pw.title')),
    h('p.auth-sub', t('pw.subForced')),
    h('div.card', h('div.card-body', f.el)))));
  f.focus();
}

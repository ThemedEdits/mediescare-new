// Sign-in screen for this computer's branch.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state } from '../state.js';
import { Form, fieldText, input, passwordInput, busy } from '../ui/form.js';

export function renderLogin(root, { message, onDone }) {
  const form = new Form();
  const submit = h('button.btn.primary', { type: 'submit', style: { width: '100%', height: '38px' } }, t('login.button'));
  const branch = state.app.device.branch;
  const formEl = h('form.card', { novalidate: true },
    h('div.card-body.stack',
      message ? h('div.form-note', icon('info', 'sm'), h('div', message)) : null,
      form.errorBox,
      form.add('username', fieldText(input({ autocomplete: 'username', maxlength: 40, name: 'username' }), t('login.username'))),
      form.add('password', fieldText(passwordInput({ autocomplete: 'current-password', name: 'password' }), t('login.password'))),
      submit,
      h('p.small.faint', { style: { textAlign: 'center' } }, t('login.forgot'))));

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.clearErrors();
    await busy(submit, t('login.signingIn'), async () => {
      try {
        const me = await call('auth.login', form.values());
        onDone(me);
      } catch (err) {
        form.showError(err.field ? err : { message: err.message });
        form.fields.password.input.value = '';
        form.fields.password.input.focus();
      }
    });
  });

  mount(root, h('div.auth-wrap', h('div.auth-card',
    h('div.auth-logo', h('img', { src: 'assets/mediescare-logo.svg', alt: t('app.name') })),
    h('h1.auth-title', t('login.title')),
    h('p.auth-sub', `${state.app.org.name} - ${branch.name}`),
    formEl,
    h('p.small.faint', { style: { textAlign: 'center', marginTop: '16px' } }, `${state.app.device.name}${state.app.version ? ' - v' + state.app.version : ''}`))));
  form.fields.username.input.focus();
}

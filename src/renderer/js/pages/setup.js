// First start: create a Head Office (three short steps) or join an existing organisation.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { Form, fieldText, input, passwordInput, busy } from '../ui/form.js';

function frame(root, wide, ...content) {
  mount(root, h('div.auth-wrap', h('div.auth-card', { class: wide ? 'wide' : '' },
    h('div.auth-logo', h('img', { src: 'assets/mediescare-logo.svg', alt: t('app.name') })), ...content)));
}

export async function renderSetup(root, { onDone }) {
  let defaults = { deviceName: '', minPassword: 8 };
  try { defaults = await call('setup.defaults'); } catch (_) { /* use fallbacks */ }

  function choose() {
    const create = h('button.choice', { type: 'button', onclick: () => createWizard() }, icon('building'), h('h3', t('setup.createTitle')), h('p.small.muted', t('setup.createText')));
    const join = h('button.choice', { type: 'button', onclick: () => joinForm() }, icon('link'), h('h3', t('setup.joinTitle')), h('p.small.muted', t('setup.joinText')));
    frame(root, true, h('h1.auth-title', t('setup.welcome')), h('p.auth-sub', t('setup.welcomeSub')), h('div.choice-grid', create, join));
    create.focus();
  }

  function createWizard() {
    const form = new Form();
    const values = {
      orgName: 'Mediescare Pharmacy',
      orgCode: 'MEDIESCARE',
      branchName: 'Mediescare Head Office',
      branchCode: 'HO',
      address: 'Main Commercial Market, Lahore, Pakistan',
      phone: '+92 42 35880000',
      licenceNo: 'DL-LHR-2026-MED',
      fullName: 'Mediescare Admin',
      username: 'admin',
      setupKey: '',
    };
    let step = 0;
    const steps = [
      {
        title: t('setup.step1'),
        fields: () => [
          form.add('orgName', fieldText(input({ placeholder: t('setup.orgNamePh'), maxlength: 120, value: values.orgName || '' }), t('setup.orgName'), { required: true, span2: true })),
          form.add('orgCode', fieldText(input({ placeholder: t('setup.orgCodePh'), maxlength: 12, value: values.orgCode || '', style: { textTransform: 'uppercase' } }), t('setup.orgCode'), { required: true, hint: t('setup.orgCodeHint'), span2: true })),
          ...(defaults.hasCloud ? [
            form.add('setupKey', fieldText(passwordInput({ placeholder: t('setup.setupKeyPh'), maxlength: 200, value: values.setupKey || '' }), t('setup.setupKey'), { required: true, hint: t('setup.setupKeyHint'), span2: true })),
          ] : []),
        ],
        names: ['orgName', 'orgCode', ...(defaults.hasCloud ? ['setupKey'] : [])],
      },
      {
        title: t('setup.step2'),
        fields: () => [
          form.add('branchName', fieldText(input({ placeholder: t('setup.branchNamePh'), maxlength: 120, value: values.branchName || '' }), t('setup.branchName'), { required: true })),
          form.add('branchCode', fieldText(input({ placeholder: t('setup.branchCodePh'), maxlength: 6, value: values.branchCode || 'HO', style: { textTransform: 'uppercase' } }), t('setup.branchCode'), { required: true, hint: t('setup.branchCodeHint') })),
          form.add('address', fieldText(input({ maxlength: 300, value: values.address || '' }), t('setup.address'), { span2: true })),
          form.add('phone', fieldText(input({ maxlength: 40, value: values.phone || '' }), t('setup.phone'))),
          form.add('licenceNo', fieldText(input({ maxlength: 60, value: values.licenceNo || '' }), t('setup.licence'), { hint: t('setup.licenceHint') })),
        ],
        names: ['branchName', 'branchCode', 'address', 'phone', 'licenceNo'],
      },
      {
        title: t('setup.step3'),
        fields: () => [
          form.add('fullName', fieldText(input({ maxlength: 120, value: values.fullName || '', autocomplete: 'name' }), t('setup.fullName'), { required: true })),
          form.add('username', fieldText(input({ maxlength: 32, value: values.username || '' }), t('setup.username'), { required: true, hint: t('setup.usernameHint') })),
          form.add('password', fieldText(passwordInput(), t('setup.password'), { required: true, hint: t('setup.passwordHint', { min: defaults.minPassword }) })),
          form.add('confirmPassword', fieldText(passwordInput(), t('setup.confirmPassword'), { required: true })),
          form.add('deviceName', fieldText(input({ maxlength: 60, value: values.deviceName || defaults.deviceName }), t('setup.deviceName'), { hint: t('setup.deviceNameHint'), span2: true })),
        ],
        names: ['fullName', 'username', 'password', 'confirmPassword', 'deviceName'],
      },
    ];
    // Which step owns a field, so a server error jumps back to the right step.
    const stepOf = (name) => steps.findIndex((s) => s.names.includes(name));

    function show() {
      form.fields = {};
      const s = steps[step];
      const back = h('button.btn', { type: 'button', onclick: () => { Object.assign(values, form.values()); if (step === 0) choose(); else { step--; show(); } } }, icon('chevronLeft', 'sm'), t('common.back'));
      const nextBtn = h('button.btn.primary', { type: 'submit' }, step === steps.length - 1 ? t('setup.finish') : t('common.next'), step === steps.length - 1 ? null : icon('chevronRight', 'sm'));
      const formEl = h('form.card', { novalidate: true },
        h('div.card-body.stack',
          h('div.steps', ...steps.map((_, i) => h('span', { class: i <= step ? 'done' : '' }))),
          h('div', h('div.section-title', `${step + 1} / ${steps.length}`), h('h2', s.title)),
          form.errorBox,
          h('div.form-grid', ...s.fields())),
        h('div.modal-foot', back, nextBtn));
      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        Object.assign(values, form.values());
        form.clearErrors();
        const missing = s.names.find((n) => form.fields[n].el.querySelector('label.req') && !String(values[n] || '').trim());
        if (missing) {
          form.fields[missing].setError(t('form.required', { field: form.fields[missing].el.querySelector('label').textContent }));
          form.fields[missing].input.focus();
          return;
        }
        if (step < steps.length - 1) { step++; show(); return; }
        await busy(nextBtn, t('setup.creating'), async () => {
          try {
            const me = await call('setup.createHeadOffice', values);
            showRecoveryKey(me);
          } catch (err) {
            const target = err.field ? stepOf(err.field) : -1;
            if (target >= 0 && target !== step) { step = target; show(); }
            form.showError(err);
          }
        });
      });
      frame(root, true, h('h1.auth-title', t('setup.createTitle')), h('p.auth-sub', t('setup.createText')), formEl);
      const first = formEl.querySelector('input');
      if (first) first.focus();
    }
    show();
  }

  // The organisation recovery key is shown once. Without it, a lost Head Office computer can only come back through
  // another Head Office computer.
  function showRecoveryKey(me) {
    const copyBtn = h('button.btn', { type: 'button' }, icon('copy', 'sm'), t('common.copy'));
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(me.recoveryKey); copyBtn.lastChild.textContent = t('common.copied'); } catch (_) { /* clipboard may be blocked */ } };
    const done = h('input', { type: 'checkbox' });
    const go = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => onDone(me) }, t('setup.recoveryContinue'));
    done.addEventListener('change', () => { go.disabled = !done.checked; });
    frame(root, false, h('h1.auth-title', t('setup.recoveryTitle')), h('p.auth-sub', t('setup.recoveryText')),
      h('div.card', h('div.card-body.stack',
        h('div.temp-password', { 'data-secret': '1', id: 'recovery-key' }, me.recoveryKey),
        h('div.row', copyBtn),
        h('div.form-note', icon('info', 'sm'), h('div', t('setup.recoveryNote'))),
        h('label.check', done, h('span', t('setup.recoveryConfirm')))),
      h('div.modal-foot', go)));
  }

  function joinForm() {
    const form = new Form();
    const modeName = 'joinmode';
    const primary = h('input', { type: 'radio', name: modeName, value: 'primary', checked: true });
    const client = h('input', { type: 'radio', name: modeName, value: 'client' });
    const pairing = fieldText(input({ inputmode: 'numeric', maxlength: 6, placeholder: '000000' }), t('setup.pairingCode'), { hint: t('setup.pairingCodeHint'), required: true });
    const address = fieldText(input({ maxlength: 200, placeholder: '192.168.1.10' }), t('setup.mainAddress'), { hint: t('setup.mainAddressHint'), required: true });
    const cloudUrl = fieldText(input({ maxlength: 300, placeholder: 'https://gateway.example.com', value: defaults.cloudUrl || '' }), t('setup.cloudUrl'), { hint: t('setup.cloudUrlHint') });
    const orgCode = fieldText(input({ maxlength: 12, value: 'MEDIESCARE', style: { textTransform: 'uppercase' } }), t('setup.joinOrgCode'), { required: true });
    const joinCode = fieldText(input({ maxlength: 20, placeholder: 'XXXX-XXXX-XXXX', style: { textTransform: 'uppercase' } }), t('setup.joinCode'), { required: true, hint: t('setup.joinCodeHint') });
    const recoveryKey = fieldText(input({ maxlength: 30, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', style: { textTransform: 'uppercase' } }), t('setup.recoveryKey'), { required: true, hint: t('setup.recoveryKeyHint') });
    const useRecovery = h('input', { type: 'checkbox' });
    const recoveryToggle = h('label.check', useRecovery, h('span', t('setup.useRecovery')));
    const found = h('div.stack.tight');
    const findBtn = h('button.btn.sm', { type: 'button' }, icon('search', 'sm'), t('setup.findMain'));
    findBtn.onclick = () => busy(findBtn, t('setup.searching'), async () => {
      try {
        const list = await call('lan.discover');
        found.replaceChildren(...(list.length ? list.map((x) => h('button.menu-item', { type: 'button', onclick: () => { address.input.value = x.url; found.replaceChildren(); } },
          icon('monitor', 'sm'), h('span.grow', `${x.branchName} - ${x.deviceName}`), h('span.small.muted', x.url))) : [h('p.small.muted', t('setup.noneFound'))]));
      } catch (err) { found.replaceChildren(h('p.small.muted', err.message)); }
    });
    const showMode = () => {
      pairing.el.hidden = !client.checked;
      address.el.hidden = !client.checked;
      findBtn.hidden = !client.checked;
      orgCode.el.hidden = client.checked;
      cloudUrl.el.hidden = client.checked || defaults.hasCloud;
      recoveryToggle.hidden = client.checked;
      joinCode.el.hidden = client.checked || useRecovery.checked;
      recoveryKey.el.hidden = client.checked || !useRecovery.checked;
    };
    useRecovery.addEventListener('change', showMode);
    for (const r of [primary, client]) r.addEventListener('change', showMode);
    const submit = h('button.btn.primary', { type: 'submit' }, t('setup.joinButton'));
    const formEl = h('form.card', { novalidate: true },
      h('div.card-body.stack', form.errorBox,
        h('div.field', h('label', t('setup.joinMode')),
          h('label.check', primary, h('span', h('strong', t('setup.joinPrimary')), h('div.small.muted', t('setup.joinPrimaryHint')))),
          h('label.check', client, h('span', h('strong', t('setup.joinClient')), h('div.small.muted', t('setup.joinClientHint'))))),
        form.add('orgCode', orgCode),
        form.add('cloudUrl', cloudUrl),
        form.add('joinCode', joinCode), form.add('recoveryKey', recoveryKey), recoveryToggle,
        form.add('primaryUrl', address), findBtn, found,
        form.add('pairingCode', pairing),
        form.add('username', fieldText(input({ maxlength: 32 }), t('setup.joinUsername'), { required: true, hint: t('setup.joinUserHint') })),
        form.add('password', fieldText(passwordInput({ autocomplete: 'current-password' }), t('setup.joinPassword'), { required: true })),
        form.add('deviceName', fieldText(input({ maxlength: 60, value: defaults.deviceName }), t('setup.deviceName'), { hint: t('setup.deviceNameHint') }))),
      h('div.modal-foot', h('button.btn', { type: 'button', onclick: choose }, icon('chevronLeft', 'sm'), t('common.back')), submit));
    showMode();
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.clearErrors();
      await busy(submit, t('setup.joining'), async () => {
        try {
          const me = await call('setup.joinExisting', { ...form.values(), useRecovery: useRecovery.checked, mode: client.checked ? 'client' : 'primary' });
          onDone(me);
        } catch (err) {
          // Joined, but the login was not right: the data is here, so the sign-in screen comes next.
          if (err.code === 'JOINED_SIGN_IN') { alertThenRestart(err.message); return; }
          form.showError(err);
        }
      });
    });
    frame(root, false, h('h1.auth-title', t('setup.joinTitle')), h('p.auth-sub', t('setup.joinText')), formEl);
    formEl.querySelector('input').focus();
  }

  function alertThenRestart(message) {
    frame(root, false, h('h1.auth-title', t('setup.joinedTitle')), h('p.auth-sub', message),
      h('div.modal-foot', h('button.btn.primary', { type: 'button', onclick: () => location.reload() }, t('setup.goToSignIn'))));
  }

  choose();
}

// Manager approval. Two ways: a manager types their own login here (short-lived token from pos.approve), or the
// request is sent to the Approvals screen and a manager decides on another computer (token "req:<id>").
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { openModal } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';

const POLL_MS = 3000;

// Resolves the approval token, or null when the dialog is closed. opts: { kind, summary, amount } for a remote request.
export function askApproval(message, needs, opts = {}) {
  return new Promise((resolve) => {
    const form = new Form();
    const user = input({ autocomplete: 'off', autofocus: true });
    const pass = input({ type: 'password', autocomplete: 'off' });
    const reason = input({ maxlength: 300 });
    const ok = h('button.btn.primary', { type: 'button' }, t('approvals.approve'));
    const remote = h('button.btn', { type: 'button' }, icon('monitor', 'sm'), t('approvals.askRemote'));
    const waitBox = h('div');
    let token = null;
    let requestId = null;
    let timer = null;
    const local = can('pos.view');
    const m = openModal({
      title: t('pos.managerTitle'), size: 'narrow',
      onClose: () => {
        clearTimeout(timer);
        if (requestId && !token) call('approvals.cancelRequest', { id: requestId }).catch(() => {});
        resolve(token);
      },
      body: [h('div.form-note', { style: { marginBottom: '12px' } }, icon('lock', 'sm'), h('div', message)), form.errorBox,
        local ? form.add('username', fieldText(user, t('pos.managerUser'), { required: true })) : null,
        local ? form.add('password', fieldText(pass, t('login.password'), { required: true })) : null,
        local ? form.add('reason', fieldText(reason, t('common.reason'))) : null,
        h('div', { style: { marginTop: '12px' } }, h('p.small.muted', { style: { marginBottom: '6px' } }, t('approvals.remoteHint')), remote), waitBox],
      footer: local ? [ok] : null,
    });
    const go = () => busy(ok, null, async () => {
      try {
        const res = await call('pos.approve', { username: user.value, password: pass.value, needs, reason: reason.value });
        token = res.token;
        toast(t('pos.approvedBy', { name: res.approverName }));
        m.close();
      } catch (err) {
        form.showError(err.field ? err : { message: err.message });
        pass.value = '';
      }
    });
    ok.onclick = go;
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

    async function poll() {
      try {
        const st = await call('approvals.status', { id: requestId });
        if (st.status === 'approved' && st.token) {
          token = st.token;
          toast(t('pos.approvedBy', { name: st.decidedBy }));
          m.close();
          return;
        }
        if (st.status === 'rejected' || st.status === 'expired' || st.status === 'cancelled') {
          requestId = null;
          remote.disabled = false;
          mount(waitBox, h('div.form-error', { style: { marginTop: '10px' } }, icon('alertCircle', 'sm'),
            h('div', st.status === 'rejected' ? t('approvals.rejectedBy', { name: st.decidedBy || '', reason: st.reason || '' }) : t('approvals.notUsable'))));
          return;
        }
      } catch (_) { /* keep waiting */ }
      timer = setTimeout(poll, POLL_MS);
    }
    remote.onclick = async () => {
      remote.disabled = true;
      try {
        const res = await call('approvals.request', { needs, summary: opts.summary || message, kind: opts.kind, amount: opts.amount });
        requestId = res.id;
        mount(waitBox, h('div.form-note', { style: { marginTop: '10px' } }, h('span.spinner', { style: { width: '14px', height: '14px', borderWidth: '2px' } }), h('div', t('approvals.waiting'))));
        timer = setTimeout(poll, POLL_MS);
      } catch (err) { remote.disabled = false; toastError(err); }
    };
  });
}

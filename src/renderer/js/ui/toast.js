import { h } from './dom.js';
import { icon } from './icons.js';

let host = null;

export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  if (!host) {
    host = h('div.toasts', { role: 'status' });
    document.body.append(host);
  }
  const el = h('div.toast', { class: type === 'error' ? 'error' : '' }, icon(type === 'error' ? 'alertCircle' : 'check', 'sm'), h('div', message));
  host.append(el);
  setTimeout(() => el.remove(), type === 'error' ? Math.max(timeout, 6000) : timeout);
}

export function toastError(err) {
  toast(err && err.message ? err.message : String(err), { type: 'error' });
}

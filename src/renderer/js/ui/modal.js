// Dialogs. Escape closes, focus moves into the dialog and returns to where it was.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';
import { fieldText, textarea } from './form.js';

export function openModal({ title, body, footer, size = '', onClose, dismissible = true }) {
  const previous = document.activeElement;
  const titleId = 'm' + Math.random().toString(36).slice(2);
  const bodyEl = h('div.modal-body');
  const footEl = h('div.modal-foot');
  const closeBtn = h('button.btn.ghost.icon-only.sm', { type: 'button', 'aria-label': t('common.close'), onclick: () => close() }, icon('x', 'sm'));
  const modal = h('div.modal', { class: size, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div.modal-head', h('h2', { id: titleId }, title), dismissible ? closeBtn : null), bodyEl, footEl);
  const backdrop = h('div.backdrop', modal);
  let closed = false;

  function close(result) {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (previous && previous.focus) previous.focus();
    if (onClose) onClose(result);
  }
  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(); });
  document.addEventListener('keydown', onKey, true);
  mount(bodyEl, body);
  if (footer) mount(footEl, footer); else footEl.remove();
  document.getElementById('overlays').append(backdrop);
  const target = modal.querySelector('[autofocus]') || modal.querySelector('input, select, textarea') || modal.querySelector('.modal-foot .btn.primary') || closeBtn;
  setTimeout(() => target && target.focus(), 0);
  return { close, modal, body: bodyEl, foot: footEl };
}

// Yes/no question. Resolves true when confirmed. With requireReason it resolves the reason text instead.
export function confirm({ title, text, confirmLabel, danger = false, requireReason = false, reasonOptional = false }) {
  return new Promise((resolve) => {
    let reasonField = null;
    const body = [h('p.muted', text)];
    if (requireReason) {
      reasonField = fieldText(textarea({ name: 'reason', placeholder: t('common.reasonPlaceholder') }), t('common.reason'), { required: !reasonOptional });
      body.push(h('div', { style: { marginTop: '14px' } }, reasonField.el));
    }
    const ok = h('button.btn', { type: 'button', class: danger ? 'danger solid' : 'primary' }, confirmLabel || t('common.yes'));
    const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
    const m = openModal({ title, body, footer: [cancel, ok], size: 'narrow', onClose: (r) => resolve(r === undefined ? false : r) });
    cancel.onclick = () => m.close(false);
    ok.onclick = () => {
      if (requireReason) {
        const reason = reasonField.input.value.trim();
        if (!reason && !reasonOptional) { reasonField.setError(t('common.reasonPlaceholder')); reasonField.input.focus(); return; }
        m.close(reason || '');
      } else m.close(true);
    };
  });
}

// Shows a secret (temporary password) once with a copy button.
export function showSecret({ title, text, secret }) {
  return new Promise((resolve) => {
    const copyBtn = h('button.btn', { type: 'button' }, icon('copy', 'sm'), t('common.copy'));
    const done = h('button.btn.primary', { type: 'button' }, t('common.close'));
    const m = openModal({ title, body: [h('p.muted', { style: { marginBottom: '12px' } }, text), h('div.temp-password', { 'data-secret': '1' }, secret)], footer: [copyBtn, done], size: 'narrow', onClose: () => resolve() });
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(secret); copyBtn.lastChild.textContent = t('common.copied'); } catch (_) { /* clipboard may be blocked */ }
    };
    done.onclick = () => m.close();
  });
}

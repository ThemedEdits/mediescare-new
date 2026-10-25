// Elaborated precision toast notifications for actions, confirmations, warnings and errors.
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';

let host = null;
const MAX_VISIBLE = 5;

const TOAST_ICONS = {
  success: 'check',
  error: 'alertCircle',
  warning: 'alert',
  info: 'info',
};

const DEFAULT_TITLES = {
  success: () => t('toast.success'),
  error: () => t('toast.error'),
  warning: () => t('toast.warning'),
  info: () => t('toast.info'),
};

export function toast(message, { type = 'success', title = null, timeout = 4000 } = {}) {
  if (typeof document === 'undefined') return;

  if (!host) {
    host = h('div.toasts', { role: 'region', 'aria-label': 'Notifications' });
    document.body.append(host);
  }

  // Normalize type
  const normType = ['success', 'error', 'warning', 'info'].includes(type) ? type : (type === 'danger' ? 'error' : 'success');

  // Derive title if not passed
  let resolvedTitle = title;
  if (!resolvedTitle) {
    resolvedTitle = DEFAULT_TITLES[normType]();
  }

  const iconName = TOAST_ICONS[normType] || 'info';

  const iconWrap = h('div.toast-icon-wrap', icon(iconName, 'sm'));
  const titleEl = h('div.toast-title', resolvedTitle);
  const msgEl = h('div.toast-message', message || '');
  const contentEl = h('div.toast-content', titleEl, msgEl);

  const closeBtn = h('button.toast-close', {
    type: 'button',
    'aria-label': t('common.close') || 'Dismiss',
    onclick: (e) => {
      e.stopPropagation();
      dismiss();
    },
  }, icon('x', 'sm'));

  const progressBar = h('div.toast-progress');
  const progressFill = h('div.toast-progress-fill');
  progressBar.append(progressFill);

  const el = h('div.toast', {
    class: `toast-${normType}`,
    role: normType === 'error' ? 'alert' : 'status',
  }, iconWrap, contentEl, closeBtn, progressBar);

  let timer = null;
  let startTime = Date.now();
  let remaining = normType === 'error' ? Math.max(timeout, 6000) : timeout;
  let isDismissed = false;

  function dismiss() {
    if (isDismissed) return;
    isDismissed = true;
    if (timer) clearTimeout(timer);
    el.classList.add('toast-leaving');
    setTimeout(() => {
      el.remove();
    }, 250);
  }

  function startTimer() {
    if (timer) clearTimeout(timer);
    startTime = Date.now();
    progressFill.style.transition = `width ${remaining}ms linear`;
    requestAnimationFrame(() => {
      progressFill.style.width = '0%';
    });
    timer = setTimeout(dismiss, remaining);
  }

  function pauseTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const elapsed = Date.now() - startTime;
      remaining = Math.max(500, remaining - elapsed);
      const computedWidth = window.getComputedStyle(progressFill).width;
      progressFill.style.transition = 'none';
      progressFill.style.width = computedWidth;
    }
  }

  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', () => {
    if (!isDismissed) startTimer();
  });

  // Limit stack size: if too many visible toasts, dismiss oldest
  if (host.children.length >= MAX_VISIBLE) {
    const oldest = host.children[0];
    if (oldest && oldest.dismiss) oldest.dismiss();
    else if (oldest) oldest.remove();
  }

  el.dismiss = dismiss;
  host.append(el);

  // Animate progress bar fill from 100% to 0%
  progressFill.style.width = '100%';
  setTimeout(startTimer, 20);
}

export function toastError(err, title) {
  const msg = err && err.message ? err.message : String(err);
  toast(msg, { type: 'error', title: title || t('toast.error'), timeout: 6500 });
}

toast.success = (msg, title, opts) => toast(msg, { ...opts, type: 'success', title });
toast.error = (msg, title, opts) => toast(msg, { ...opts, type: 'error', title });
toast.warning = (msg, title, opts) => toast(msg, { ...opts, type: 'warning', title });
toast.info = (msg, title, opts) => toast(msg, { ...opts, type: 'info', title });

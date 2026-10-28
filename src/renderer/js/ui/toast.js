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

function createAnimatedIcon(type) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'toast-animated-icon');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('class', 'toast-icon-circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  svg.append(circle);

  if (type === 'success') {
    const check = document.createElementNS(svgNS, 'path');
    check.setAttribute('class', 'toast-icon-symbol toast-icon-check');
    check.setAttribute('d', 'M7.5 12.2l3 3 6-6.4');
    svg.append(check);
  } else if (type === 'error') {
    const line1 = document.createElementNS(svgNS, 'line');
    line1.setAttribute('class', 'toast-icon-symbol toast-icon-cross1');
    line1.setAttribute('x1', '8.5');
    line1.setAttribute('y1', '8.5');
    line1.setAttribute('x2', '15.5');
    line1.setAttribute('y2', '15.5');

    const line2 = document.createElementNS(svgNS, 'line');
    line2.setAttribute('class', 'toast-icon-symbol toast-icon-cross2');
    line2.setAttribute('x1', '15.5');
    line2.setAttribute('y1', '8.5');
    line2.setAttribute('x2', '8.5');
    line2.setAttribute('y2', '15.5');
    svg.append(line1, line2);
  } else if (type === 'warning') {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('class', 'toast-icon-symbol toast-icon-warn-line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '7.5');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '12.5');

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('class', 'toast-icon-symbol toast-icon-warn-dot');
    dot.setAttribute('cx', '12');
    dot.setAttribute('cy', '15.8');
    dot.setAttribute('r', '0.9');
    svg.append(line, dot);
  } else {
    // info
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('class', 'toast-icon-symbol toast-icon-warn-line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '11.5');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '16.5');

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('class', 'toast-icon-symbol toast-icon-warn-dot');
    dot.setAttribute('cx', '12');
    dot.setAttribute('cy', '8.2');
    dot.setAttribute('r', '0.9');
    svg.append(line, dot);
  }

  return svg;
}

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

  const iconWrap = h('div.toast-icon-wrap', createAnimatedIcon(normType));
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

  // Innovative dual-direction perimeter border animation:
  // Starts at the middle of the right edge, dividing into two opposite paths (one down, one up)
  // that travel along the perimeter and meet at the middle of the left edge when the duration completes.
  const svgNS = 'http://www.w3.org/2000/svg';
  const borderSvg = document.createElementNS(svgNS, 'svg');
  borderSvg.setAttribute('class', 'toast-border-svg');
  borderSvg.setAttribute('aria-hidden', 'true');
  borderSvg.setAttribute('preserveAspectRatio', 'none');

  const pathA = document.createElementNS(svgNS, 'path');
  pathA.setAttribute('class', 'toast-border-path');
  const pathB = document.createElementNS(svgNS, 'path');
  pathB.setAttribute('class', 'toast-border-path');
  borderSvg.append(pathA, pathB);

  const el = h('div.toast', {
    class: `toast-${normType}`,
    role: normType === 'error' ? 'alert' : 'status',
  }, iconWrap, contentEl, closeBtn, borderSvg);

  let timer = null;
  let startTime = Date.now();
  let remaining = normType === 'error' ? Math.max(timeout, 6000) : timeout;
  let isDismissed = false;
  let timerStarted = false;
  let pathLength = 0;
  let ro = null;

  function updateBorderPaths() {
    const w = el.offsetWidth || 360;
    const h = el.offsetHeight || 60;
    const strokeWidth = 2;
    const pad = strokeWidth / 2;
    const xLeft = pad;
    const xRight = w - pad;
    const yTop = pad;
    const yBottom = h - pad;
    const midY = h / 2;
    const r = Math.min(10 - pad, Math.floor(h / 2) - pad, Math.floor(w / 2) - pad);

    // Path A: starts from right-middle (xRight, midY), moves down right side, along bottom, and up to left-middle (xLeft, midY)
    const dA = `M ${xRight} ${midY} L ${xRight} ${yBottom - r} A ${r} ${r} 0 0 1 ${xRight - r} ${yBottom} L ${xLeft + r} ${yBottom} A ${r} ${r} 0 0 1 ${xLeft} ${yBottom - r} L ${xLeft} ${midY}`;
    // Path B: starts from right-middle (xRight, midY), moves up right side, along top, and down to left-middle (xLeft, midY)
    const dB = `M ${xRight} ${midY} L ${xRight} ${yTop + r} A ${r} ${r} 0 0 0 ${xRight - r} ${yTop} L ${xLeft + r} ${yTop} A ${r} ${r} 0 0 0 ${xLeft} ${yTop + r} L ${xLeft} ${midY}`;

    pathA.setAttribute('d', dA);
    pathB.setAttribute('d', dB);
    borderSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    try {
      pathLength = pathA.getTotalLength() || (w + h);
    } catch (_) {
      pathLength = w + h;
    }

    if (!timerStarted) {
      pathA.style.strokeDasharray = `${pathLength} ${pathLength}`;
      pathB.style.strokeDasharray = `${pathLength} ${pathLength}`;
      pathA.style.strokeDashoffset = '0';
      pathB.style.strokeDashoffset = '0';
    }
  }

  function dismiss() {
    if (isDismissed) return;
    isDismissed = true;
    if (ro) ro.disconnect();
    if (timer) clearTimeout(timer);
    el.classList.add('toast-leaving');
    setTimeout(() => {
      el.remove();
    }, 250);
  }

  function startTimer() {
    if (timer) clearTimeout(timer);
    timerStarted = true;
    startTime = Date.now();
    pathA.style.transition = `stroke-dashoffset ${remaining}ms linear`;
    pathB.style.transition = `stroke-dashoffset ${remaining}ms linear`;
    requestAnimationFrame(() => {
      pathA.style.strokeDashoffset = `${pathLength}`;
      pathB.style.strokeDashoffset = `${pathLength}`;
    });
    timer = setTimeout(dismiss, remaining);
  }

  function pauseTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const elapsed = Date.now() - startTime;
      remaining = Math.max(500, remaining - elapsed);
      const computedA = window.getComputedStyle(pathA).strokeDashoffset;
      const computedB = window.getComputedStyle(pathB).strokeDashoffset;
      pathA.style.transition = 'none';
      pathB.style.transition = 'none';
      pathA.style.strokeDashoffset = computedA;
      pathB.style.strokeDashoffset = computedB;
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

  // Initialize border paths after element is mounted and dimensioned
  requestAnimationFrame(() => {
    updateBorderPaths();
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!isDismissed) updateBorderPaths();
      });
      ro.observe(el);
    }
    setTimeout(startTimer, 20);
  });
}

export function toastError(err, title) {
  const msg = err && err.message ? err.message : String(err);
  toast(msg, { type: 'error', title: title || t('toast.error'), timeout: 6500 });
}

toast.success = (msg, title, opts) => toast(msg, { ...opts, type: 'success', title });
toast.error = (msg, title, opts) => toast(msg, { ...opts, type: 'error', title });
toast.warning = (msg, title, opts) => toast(msg, { ...opts, type: 'warning', title });
toast.info = (msg, title, opts) => toast(msg, { ...opts, type: 'info', title });

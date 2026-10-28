// Small floating panel anchored to a button (menus, column picker, status details). Click outside or Escape closes.
import { h } from './dom.js';

let current = null;

export function isPopoverOpen(anchor) {
  return !!(current && current.anchor === anchor && !current.isClosing);
}

export function closePopover(immediate = false) {
  if (current) {
    const c = current;
    current = null;
    c.close(immediate);
  }
}

export function popover(anchor, content, { align = 'left', width } = {}) {
  if (current) {
    if (current.anchor === anchor && !current.isClosing) {
      closePopover();
      return null;
    }
    current.destroyNow();
    current = null;
  }

  const el = h('div.popover', { role: 'dialog', style: width ? { width: `${width}px`, maxWidth: `${width}px` } : null }, content);
  document.getElementById('overlays').append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  el.style.left = `${left}px`;
  const below = r.bottom + 6;
  const isAbove = below + el.offsetHeight > window.innerHeight - 8;
  el.style.top = `${isAbove ? Math.max(8, r.top - el.offsetHeight - 6) : below}px`;
  if (isAbove) el.classList.add('popover-above');

  function onDown(e) {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
      anchor.focus();
    }
  }

  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);

  let closing = false;
  const handle = {
    anchor,
    el,
    get isClosing() { return closing; },
    close(immediate = false) {
      if (closing) return;
      closing = true;
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (immediate || !el.isConnected) {
        el.remove();
        return;
      }
      el.classList.add('popover-closing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => { if (el.isConnected) el.remove(); }, 180);
    },
    destroyNow() {
      closing = true;
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      el.remove();
    },
  };
  current = handle;
  const first = el.querySelector('button, input, [tabindex]');
  if (first) first.focus();
  return handle;
}

// A list of clickable menu items: [{ label, icon, onClick, danger, separator }]
export function menu(anchor, items, opts) {
  const { icon } = opts && opts.iconFn ? { icon: opts.iconFn } : { icon: null };
  const nodes = items.filter(Boolean).map((it) => {
    if (it.separator) return h('div.menu-sep');
    if (it.node) return it.node;
    return h('button.menu-item', { type: 'button', class: it.danger ? 'danger' : '', onclick: () => { closePopover(); it.onClick(); } }, it.iconEl || (icon && it.icon ? icon(it.icon, 'sm') : null), it.label);
  });
  return popover(anchor, nodes, opts);
}

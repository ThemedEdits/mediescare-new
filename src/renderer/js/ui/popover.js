// Small floating panel anchored to a button (menus, column picker, status details). Click outside or Escape closes.
import { h } from './dom.js';

let current = null;

export function closePopover() {
  if (current) { current.close(); current = null; }
}

export function popover(anchor, content, { align = 'left', width } = {}) {
  closePopover();
  const el = h('div.popover', { role: 'dialog', style: width ? { width: `${width}px`, maxWidth: `${width}px` } : null }, content);
  document.getElementById('overlays').append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  el.style.left = `${left}px`;
  const below = r.bottom + 6;
  el.style.top = `${below + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - el.offsetHeight - 6) : below}px`;

  function onDown(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); anchor.focus(); } }
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  const handle = {
    el,
    close() {
      el.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
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

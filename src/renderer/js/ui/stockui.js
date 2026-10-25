// Shared pieces for inventory and purchasing screens: product search, quantity in packs and loose units,
// export menu, status badges and small document helpers.
import { h, debounce, highlight } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { menu } from './popover.js';
import { toast, toastError } from './toast.js';
import * as fmt from './format.js';
import { select } from './form.js';

// ---- quantities ----------------------------------------------------------------------------------------------------

function plural(word, n) {
  const w = word || 'unit';
  if (n === 1) return w;
  if (/(s|x|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

// Same wording as the main process: "3 Strips + 4 Tablets".
export function qtyText(qty, p) {
  if (qty === null || qty === undefined) return '';
  const pack = p.packSize || 1;
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(qty);
  if (pack <= 1) return `${sign}${abs} ${plural(p.baseUnit, abs)}`;
  const packs = Math.floor(abs / pack);
  const loose = abs % pack;
  const parts = [];
  if (packs) parts.push(`${packs} ${plural(p.packUnit, packs)}`);
  if (loose || !packs) parts.push(`${loose} ${plural(p.baseUnit, loose)}`);
  return sign + parts.join(' + ');
}

// Two small inputs: packs and loose units. getValue() returns base units.
export function qtyInput(product, { value = 0, onChange, autofocus = false } = {}) {
  const pack = product.packSize || 1;
  const packs = h('input.input', { type: 'number', min: 0, step: 1, value: pack > 1 ? Math.floor(value / pack) || '' : value || '', style: { width: '76px' }, 'aria-label': product.packUnit || 'Packs', autofocus });
  const loose = h('input.input', { type: 'number', min: 0, step: 1, value: pack > 1 ? value % pack || '' : '', style: { width: '64px' }, 'aria-label': product.baseUnit || 'Loose' });
  const wrap = h('div.row.qty-input', packs, h('span.small.muted', pack > 1 ? product.packUnit : product.baseUnit));
  if (pack > 1) wrap.append(loose, h('span.small.muted', product.baseUnit));
  const get = () => (Number(packs.value) || 0) * (pack > 1 ? pack : 1) + (pack > 1 ? Number(loose.value) || 0 : 0);
  for (const el of [packs, loose]) el.addEventListener('input', () => onChange && onChange(get()));
  wrap.getValue = get;
  wrap.setValue = (v) => { packs.value = pack > 1 ? Math.floor(v / pack) || '' : v || ''; loose.value = pack > 1 ? v % pack || '' : ''; };
  wrap.focus = () => packs.focus();
  wrap.control = packs;
  packs.getValue = get;
  return wrap;
}

export function rupees(minor) {
  return minor === null || minor === undefined ? '' : (minor / 100).toFixed(2);
}

export function moneyInput(props = {}) {
  return h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', style: { textAlign: 'right' }, ...props });
}

// ---- product search ------------------------------------------------------------------------------------------------

// Type part of a name, generic name, SKU, or scan a barcode (Enter picks the barcode match at once).
export function productPicker({ onPick, placeholder, autofocus = false, includeInactive = false } = {}) {
  const input = h('input.input', { type: 'text', placeholder: placeholder || t('stock.searchProduct'), autocomplete: 'off', spellcheck: 'false', autofocus, 'aria-label': t('stock.searchProduct') });
  const list = h('div.combo-list', { hidden: true, role: 'listbox', style: { minWidth: '520px' } });
  const wrap = h('div.combo', h('div.input-wrap', icon('search', 'sm'), input), list);
  let results = [];
  let active = 0;
  let seq = 0;

  function render() {
    list.replaceChildren();
    if (!results.length) { list.append(h('div.combo-empty', input.value.trim() ? t('common.noMatches', { q: input.value }) : t('stock.typeToSearch'))); return; }
    results.forEach((p, i) => {
      list.append(h('div.combo-option', { class: i === active ? 'active' : '', onmousedown: (e) => { e.preventDefault(); pick(p); } },
        h('div', h('div', highlight(p.label, input.value), p.rxRequired ? h('span.badge.warning', { style: { marginLeft: '6px' } }, p.controlled ? t('products.controlledShort') : t('products.rxShort')) : null),
          h('div.small.faint', [p.genericName, p.manufacturerName, p.sku].filter(Boolean).join(' - '))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: p.onHand > 0 ? '' : 'muted' }, p.onHandText), h('div.small.faint', fmt.money(p.mrp)))));
    });
  }
  async function search() {
    const mine = ++seq;
    try {
      const res = await call('products.search', { q: input.value, limit: 25, includeInactive });
      if (mine !== seq) return;
      results = res;
      active = 0;
      render();
      list.hidden = false;
    } catch (err) { toastError(err); }
  }
  const later = debounce(search, 120);
  function pick(p) {
    list.hidden = true;
    input.value = '';
    results = [];
    if (onPick) onPick(p);
  }
  input.addEventListener('input', later);
  input.addEventListener('focus', () => { if (input.value) search(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // A scanner types the code and presses Enter faster than the search delay: search now.
      if (!results.length || seq === 0) await search();
      const exact = results.find((r) => r.barcodeMatch);
      if (exact) pick(exact);
      else if (results[active]) pick(results[active]);
    } else if (e.key === 'Escape') { list.hidden = true; }
  });
  wrap.focus = () => input.focus();
  return wrap;
}

// Batches of one product at this branch, nearest expiry first. Returns a <select>.
export async function batchSelect(productId, { includeExpired = false, value = '', status = 'in_stock' } = {}) {
  const res = await call('stock.batches', { productId, status, pageSize: 200, sort: 'expiryDate' });
  const options = [{ value: '', label: t('stock.chooseBatch') }];
  for (const b of res.rows) {
    if (!includeExpired && b.expiryState === 'expired') continue;
    options.push({
      value: b.batchId,
      label: `${b.batchNo} - exp ${fmt.date(b.expiryDate)} - ${b.onHandText}${b.quarantined ? ` (${t('stock.quarantined')})` : ''}`,
      disabled: b.quarantined && !includeExpired,
    });
  }
  const sel = select(options, { value, 'aria-label': t('stock.batch') });
  sel.batches = res.rows;
  return sel;
}

// ---- badges --------------------------------------------------------------------------------------------------------

const STATUS_CLASS = {
  draft: '', ordered: 'accent', partial: 'warning', received: 'success', cancelled: '', posted: 'success', pending: 'warning', rejected: 'danger',
  requested: 'warning', approved: 'accent', dispatched: 'accent', counting: 'warning', out: 'danger', low: 'warning', over: 'accent', ok: 'success',
  expired: 'danger', near: 'warning',
};

export function statusBadge(status, text) {
  return h('span.badge', { class: STATUS_CLASS[status] || '' }, text || t(`status.${status}`));
}

export function expiryBadge(b) {
  if (b.expiryState === 'expired') return h('span.badge.danger', t('stock.expired'));
  if (b.expiryState === 'near') return h('span.badge.warning', t('stock.daysLeft', { n: b.daysLeft }));
  return h('span.small.muted', t('stock.daysLeft', { n: b.daysLeft }));
}

// ---- export --------------------------------------------------------------------------------------------------------

const EXPORT_FORMATS = ['xlsx', 'csv', 'pdf', 'xls', 'txt', 'json', 'xml'];

// A button that exports what a list shows. getParams returns the current filters.
export function exportButton({ source, title, columns, getParams, perm }) {
  if (perm && !can(perm)) return null;
  const btn = h('button.btn', { type: 'button' }, icon('download', 'sm'), t('common.export'));
  btn.addEventListener('click', () => menu(btn, EXPORT_FORMATS.map((format) => ({
    iconEl: icon('download', 'sm'), label: `${t('audit.exportAs')} ${format.toUpperCase()}`,
    onClick: async () => {
      try {
        const res = await call('export.run', { source, title: typeof title === 'function' ? title() : title, format, columns: typeof columns === 'function' ? columns() : columns, params: getParams ? getParams() : {} });
        if (res.saved) toast(t('audit.exported', { rows: res.rows, path: res.path }));
      } catch (err) { toastError(err); }
    },
  })), { align: 'right' }));
  return btn;
}

// Prints what a list shows on A4, with the organisation, filters, time and user at the top.
export function printButton({ source, title, columns, getParams, perm }) {
  if (perm && !can(perm)) return null;
  const btn = h('button.btn', { type: 'button' }, icon('printer', 'sm'), t('common.print'));
  btn.addEventListener('click', async () => {
    try {
      await call('export.print', { source, title: typeof title === 'function' ? title() : title, columns: typeof columns === 'function' ? columns() : columns, params: getParams ? getParams() : {} });
    } catch (err) { toastError(err); }
  });
  return btn;
}

// ---- document helpers ----------------------------------------------------------------------------------------------

export function docHeader({ title, sub, status, actions = [], back }) {
  return h('div.page-head',
    h('div', back ? h('a.small.back-link', { href: back.href }, icon('chevronLeft', 'sm'), h('span', back.label)) : null,
      h('div.row', h('h1', title), status || null), sub ? h('p.sub', sub) : null),
    h('div.row.wrap', ...actions.filter(Boolean)));
}

export function kv(pairs) {
  return h('dl.kv', ...pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', k), h('dd', v === null || v === undefined || v === '' ? '-' : v)]));
}

export function filterSelect(options, onChange, { value = '', width = '170px', label } = {}) {
  const sel = select(options, { value, style: { width }, 'aria-label': label || '' });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function dateFilter(onChange, label) {
  const el = h('input.input', { type: 'date', style: { width: '150px' }, 'aria-label': label });
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function emptyNote(text) {
  return h('div.empty', icon('info'), h('p', text));
}

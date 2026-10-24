// Small SVG charts for dashboards and reports: line (trend), horizontal bars (ranking, share) and paired columns
// (two measures per month). Colours come from CSS tokens (--chart-1, --chart-2) checked for contrast and colour
// blindness in light and dark mode. Text always uses text colours, never the series colour. Every chart has a hover
// tooltip and a table view, so nothing depends on colour alone.
import { h } from './dom.js';
import { t } from '../strings/index.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 640;

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

function text(x, y, value, attrs = {}) {
  const el = s('text', { x, y, fill: 'var(--text-2)', 'font-size': 11, ...attrs });
  el.textContent = value;
  return el;
}

// A round number at or above the largest value, so gridlines fall on readable amounts.
function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

// Rs 12.5k style labels for axes (minor units in, short text out).
export function compactMoney(minor) {
  const v = Math.abs(minor) / 100;
  const sign = minor < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}${(v / 1e7).toFixed(1).replace(/\.0$/, '')} cr`;
  if (v >= 1e5) return `${sign}${(v / 1e5).toFixed(1).replace(/\.0$/, '')} lac`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${Math.round(v)}`;
}

function frame(svg, height) {
  const tip = h('div.chart-tip', { role: 'status', hidden: true });
  const wrap = h('div.chart', { style: { aspectRatio: `${W} / ${height}` } }, svg, tip);
  const show = (evt, lines) => {
    tip.replaceChildren(...lines.map((l, i) => h(i === 0 ? 'div.chart-tip-head' : 'div.chart-tip-row', l.swatch ? h('span.chart-swatch', { style: { background: l.swatch } }) : null, h('span', l.text))));
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const x = evt.clientX - box.left;
    const y = evt.clientY - box.top;
    tip.style.left = `${Math.min(Math.max(x + 14, 4), box.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 4)}px`;
  };
  const hide = () => { tip.hidden = true; };
  return { wrap, show, hide };
}

function yAxis(svg, { left, right, top, bottom, height, max, format }) {
  const plotH = height - top - bottom;
  for (let i = 0; i <= 4; i += 1) {
    const v = (max * i) / 4;
    const y = top + plotH - (plotH * i) / 4;
    svg.append(s('line', { x1: left, x2: W - right, y1: y, y2: y, stroke: 'var(--chart-grid)', 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
    svg.append(text(left - 6, y + 4, format(v), { 'text-anchor': 'end' }));
  }
}

// Line chart over time. points: [{ label, values: [n, ...] }], series: [{ label }] (one or two).
export function lineChart({ points, series, format, axisFormat = compactMoney, height = 220, onPick }) {
  const m = { left: 56, right: 14, top: 12, bottom: 26 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': series.map((x) => x.label).join(', ') });
  const max = niceMax(Math.max(0, ...points.flatMap((p) => p.values)));
  yAxis(svg, { ...m, height, max, format: axisFormat });
  const plotW = W - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const x = (i) => m.left + (points.length <= 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const y = (v) => m.top + plotH - (plotH * Math.max(v, 0)) / max;
  const step = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) svg.append(text(x(i), height - 8, p.label, { 'text-anchor': 'middle' })); });
  series.forEach((sr, si) => {
    const color = `var(--chart-${si + 1})`;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.values[si]).toFixed(1)}`).join(' ');
    if (series.length === 1 && points.length > 1) {
      svg.append(s('path', { d: `${d} L${x(points.length - 1)},${m.top + plotH} L${x(0)},${m.top + plotH} Z`, fill: color, 'fill-opacity': 0.1, stroke: 'none' }));
    }
    svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = points.length - 1;
    if (last >= 0) svg.append(s('circle', { cx: x(last), cy: y(points[last].values[si]), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
  });
  const cross = s('line', { y1: m.top, y2: m.top + plotH, stroke: 'var(--text-3)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = series.map((_, si) => s('circle', { r: 4, fill: `var(--chart-${si + 1})`, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const hit = s('rect', { x: m.left - 8, y: m.top, width: plotW + 16, height: plotH, fill: 'transparent', style: onPick ? 'cursor:pointer' : null });
  svg.append(hit);
  const f = frame(svg, height);
  const indexAt = (evt) => {
    const box = svg.getBoundingClientRect();
    const vx = ((evt.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(points.length - 1, Math.round(((vx - m.left) / plotW) * (points.length - 1))));
  };
  hit.addEventListener('mousemove', (evt) => {
    if (!points.length) return;
    const i = indexAt(evt);
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((dt, si) => { dt.setAttribute('cx', x(i)); dt.setAttribute('cy', y(points[i].values[si])); dt.setAttribute('visibility', 'visible'); });
    f.show(evt, [{ text: points[i].title || points[i].label }, ...series.map((sr, si) => ({ text: `${format(points[i].values[si])}  ${sr.label}`, swatch: `var(--chart-${si + 1})` }))]);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((dt) => dt.setAttribute('visibility', 'hidden')); f.hide(); });
  if (onPick) hit.addEventListener('click', (evt) => onPick(points[indexAt(evt)]));
  return f.wrap;
}

// Horizontal bars, largest first. items: [{ label, value, sub, onClick }].
export function barChart({ items, format, label, rowH = 30 }) {
  const height = Math.max(items.length * rowH + 8, 40);
  const left = 150;
  const right = 90;
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label || '' });
  const max = Math.max(0, ...items.map((i) => i.value)) || 1;
  const f = frame(svg, height);
  items.forEach((it, i) => {
    const y = 4 + i * rowH;
    const barH = 16;
    const by = y + (rowH - barH) / 2;
    const len = Math.max(((W - left - right) * Math.max(it.value, 0)) / max, it.value > 0 ? 2 : 0);
    const x0 = left;
    const x1 = left + len;
    const r = Math.min(4, len / 2, barH / 2);
    const name = it.label.length > 24 ? `${it.label.slice(0, 23)}...` : it.label;
    svg.append(text(left - 8, by + barH / 2 + 4, name, { 'text-anchor': 'end', fill: 'var(--text)' }));
    if (len > 0) svg.append(s('path', { d: `M${x0},${by} L${x1 - r},${by} Q${x1},${by} ${x1},${by + r} L${x1},${by + barH - r} Q${x1},${by + barH} ${x1 - r},${by + barH} L${x0},${by + barH} Z`, fill: 'var(--chart-1)' }));
    svg.append(text(x1 + 6, by + barH / 2 + 4, it.valueText || format(it.value)));
    const hit = s('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent', style: it.onClick ? 'cursor:pointer' : null });
    hit.addEventListener('mousemove', (evt) => f.show(evt, [{ text: it.label }, { text: it.valueText || format(it.value), swatch: 'var(--chart-1)' }, ...(it.sub ? [{ text: it.sub }] : [])]));
    hit.addEventListener('mouseleave', f.hide);
    if (it.onClick) hit.addEventListener('click', it.onClick);
    svg.append(hit);
  });
  return f.wrap;
}

// Two measures side by side per period. groups: [{ label, values: [a, b] }], series: [{ label }, { label }].
export function columnPairs({ groups, series, format, axisFormat = compactMoney, height = 220 }) {
  const m = { left: 56, right: 14, top: 12, bottom: 26 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': series.map((x) => x.label).join(', ') });
  const max = niceMax(Math.max(0, ...groups.flatMap((g) => g.values)));
  yAxis(svg, { ...m, height, max, format: axisFormat });
  const plotW = W - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const slot = plotW / Math.max(groups.length, 1);
  const barW = Math.min(24, (slot - 16) / 2);
  const base = m.top + plotH;
  const f = frame(svg, height);
  groups.forEach((g, gi) => {
    const cx = m.left + slot * gi + slot / 2;
    g.values.forEach((v, si) => {
      const hgt = (plotH * Math.max(v, 0)) / max;
      const x = si === 0 ? cx - 1 - barW : cx + 1;
      const top = base - hgt;
      const r = Math.min(4, barW / 2, hgt);
      if (hgt > 0) svg.append(s('path', { d: `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${base} Z`, fill: `var(--chart-${si + 1})` }));
    });
    svg.append(text(cx, height - 8, g.label, { 'text-anchor': 'middle' }));
    const hit = s('rect', { x: cx - slot / 2, y: m.top, width: slot, height: plotH, fill: 'transparent' });
    hit.addEventListener('mousemove', (evt) => f.show(evt, [{ text: g.title || g.label }, ...series.map((sr, si) => ({ text: `${format(g.values[si])}  ${sr.label}`, swatch: `var(--chart-${si + 1})` }))]));
    hit.addEventListener('mouseleave', f.hide);
    svg.append(hit);
  });
  return f.wrap;
}

export function legend(series) {
  return h('div.chart-legend', ...series.map((sr, i) => h('span.row', h('span.chart-swatch', { style: { background: `var(--chart-${i + 1})` } }), h('span.small.muted', sr.label))));
}

// A card holding a chart with a "Table" switch, so the same numbers can be read without the picture.
export function chartCard({ title, sub, chart, table, extra }) {
  const body = h('div.card-body', chart);
  let showingTable = false;
  const toggle = table ? h('button.btn.sm', { type: 'button', 'aria-pressed': 'false' }, t('charts.table')) : null;
  if (toggle) {
    toggle.addEventListener('click', () => {
      showingTable = !showingTable;
      toggle.setAttribute('aria-pressed', String(showingTable));
      toggle.textContent = showingTable ? t('charts.chart') : t('charts.table');
      body.replaceChildren(showingTable ? table() : chart);
    });
  }
  return h('div.card.chart-card', h('div.card-head', h('div', h('h2', title), sub ? h('p.small.muted', sub) : null), h('div.row', extra || null, toggle)), body);
}

export function miniTable(columns, rows) {
  return h('div.table-scroll', h('table.data',
    h('thead', h('tr', ...columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', ...rows.map((r) => h('tr', ...columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.value(r))))))));
}

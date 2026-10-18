'use strict';
// Turns a list of rows into a file and asks the user where to save it.
// Formats: CSV, TXT (tab separated), JSON, XML, XLSX, XLS and PDF. Every file carries the organisation, report name,
// branch, filters used, when it was made and by whom.
const XLSX = require('xlsx');
const audit = require('./audit');
const { invalid } = require('./errors');

const FORMATS = {
  csv: { ext: 'csv', label: 'CSV (Excel can open it)' },
  xlsx: { ext: 'xlsx', label: 'Excel workbook (XLSX)' },
  xls: { ext: 'xls', label: 'Excel 97-2003 (XLS)' },
  pdf: { ext: 'pdf', label: 'PDF' },
  txt: { ext: 'txt', label: 'Text, tab separated' },
  json: { ext: 'json', label: 'JSON' },
  xml: { ext: 'xml', label: 'XML' },
};

// Column types: text (default), money (integer paisa), number, date, datetime, bool.
function cellValue(col, row, { forSheet = false } = {}) {
  const v = typeof col.value === 'function' ? col.value(row) : row[col.key];
  if (v === null || v === undefined || v === '') return forSheet ? null : '';
  switch (col.type) {
    case 'money': return forSheet ? v / 100 : (v / 100).toFixed(2);
    case 'number': return forSheet ? Number(v) : String(v);
    case 'bool': return v ? 'Yes' : 'No';
    case 'datetime': return String(v).replace('T', ' ').slice(0, 19);
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Stop spreadsheet programs from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlEscape(text) {
  return String(text === null || text === undefined ? '' : text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));
}

function describeFilters(filters) {
  const skip = new Set(['format', 'page', 'pageSize', 'sort', 'dir', '__all']);
  return Object.entries(filters || {})
    .filter(([k, v]) => !skip.has(k) && v !== '' && v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${v}`).join('; ') || 'none';
}

function header(ctx, title, filters) {
  const org = ctx.db.prepare('SELECT name FROM org LIMIT 1').get();
  const branch = ctx.db.prepare('SELECT name FROM branches WHERE id = ?').get(ctx.branchId);
  return {
    organisation: org ? org.name : '', branch: branch ? branch.name : '', report: title,
    filters: describeFilters(filters), generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    generatedBy: ctx.user ? `${ctx.user.full_name} (${ctx.user.username})` : '',
  };
}

function metaLines(meta) {
  return [`${meta.organisation} - ${meta.report}`, `Branch: ${meta.branch}`, `Filters: ${meta.filters}`, `Generated: ${meta.generatedAt} by ${meta.generatedBy}`];
}

function renderSheet(format, meta, columns, rows) {
  const aoa = [...metaLines(meta).map((l) => [l]), [], columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => cellValue(c, r, { forSheet: true })))];
  if (totalsRow(columns, rows)) aoa.push(totalsRow(columns, rows).map((v, i) => (i === 0 ? v : v === '' ? null : Number(v))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map((c) => ({ wch: Math.min(Math.max(c.label.length, ...rows.slice(0, 200).map((r) => String(cellValue(c, r)).length)) + 2, 60) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, meta.report.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  return XLSX.write(wb, { type: 'buffer', bookType: format === 'xls' ? 'biff8' : 'xlsx' });
}

// Sum of columns marked total: true, as display text (first cell says "Total").
function totalsRow(columns, rows) {
  if (!columns.some((c) => c.total)) return null;
  return columns.map((c, i) => {
    if (!c.total) return i === 0 ? 'Total' : '';
    const sum = rows.reduce((a, r) => a + (Number(typeof c.value === 'function' ? c.value(r) : r[c.key]) || 0), 0);
    return c.type === 'money' ? (sum / 100).toFixed(2) : String(sum);
  });
}

function renderHtml(meta, columns, rows) {
  const totals = totalsRow(columns, rows);
  const num = (c) => c.type === 'money' || c.type === 'number';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(meta.report)}</title><style>
    body { font: 10px/1.35 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 15px; margin: 0 0 2px; } .meta { color: #555; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
    th { background: #f0f2f4; font-weight: 600; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 600; border-top: 2px solid #999; } tr { page-break-inside: avoid; }
  </style></head><body>
    <h1>${htmlEscape(meta.organisation)} - ${htmlEscape(meta.report)}</h1>
    <div class="meta">Branch: ${htmlEscape(meta.branch)} &nbsp;|&nbsp; Filters: ${htmlEscape(meta.filters)}<br>Generated ${htmlEscape(meta.generatedAt)} by ${htmlEscape(meta.generatedBy)} &nbsp;|&nbsp; ${rows.length} row(s)</div>
    <table><thead><tr>${columns.map((c) => `<th class="${num(c) ? 'n' : ''}">${htmlEscape(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${num(c) ? 'n' : ''}">${htmlEscape(cellValue(c, r))}</td>`).join('')}</tr>`).join('')}</tbody>
    ${totals ? `<tfoot><tr>${totals.map((v, i) => `<td class="${num(columns[i]) ? 'n' : ''}">${htmlEscape(v)}</td>`).join('')}</tr></tfoot>` : ''}
    </table></body></html>`;
}

async function render(ctx, format, meta, columns, rows) {
  if (format === 'xlsx' || format === 'xls') return renderSheet(format, meta, columns, rows);
  if (format === 'pdf') return ctx.app.renderPdf(renderHtml(meta, columns, rows), { landscape: columns.length > 7 });
  if (format === 'json') {
    return JSON.stringify({ ...meta, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, cellValue(c, r)]))) }, null, 2);
  }
  if (format === 'xml') {
    const tag = (label) => label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^(\d)/, '_$1');
    const esc = (t) => htmlEscape(t).replace(/&#39;/g, '&apos;');
    const metaXml = Object.entries(meta).map(([k, v]) => `  <${k}>${esc(v)}</${k}>`).join('\n');
    const body = rows.map((r) => `    <row>\n${columns.map((c) => `      <${tag(c.label)}>${esc(cellValue(c, r))}</${tag(c.label)}>`).join('\n')}\n    </row>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<export>\n${metaXml}\n  <rows>\n${body}\n  </rows>\n</export>\n`;
  }
  const sep = format === 'txt' ? '\t' : ',';
  const cell = format === 'txt' ? (v) => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ') : csvCell;
  const lines = [...metaLines(meta).map((l) => [l]), [], columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => cellValue(c, r)))];
  const totals = totalsRow(columns, rows);
  if (totals) lines.push(totals);
  // BOM so Excel opens UTF-8 correctly.
  return (format === 'csv' ? '﻿' : '') + lines.map((l) => l.map(cell).join(sep)).join('\r\n') + '\r\n';
}

async function exportRows(ctx, { title, format, columns, rows, filters, module }) {
  const fmt = FORMATS[format];
  if (!fmt) invalid('format', 'error.invalid', { field: 'File type' });
  const meta = header(ctx, title, filters);
  const content = await render(ctx, format, meta, columns, rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await ctx.app.saveFile({ defaultName: `${title.replace(/[^A-Za-z0-9]+/g, '-')}-${stamp}.${fmt.ext}`, content, ext: fmt.ext, label: fmt.label });
  if (result && result.saved) {
    ctx.db.transaction(() => audit.write(ctx.db, ctx.actor, { module, action: 'export', summary: `${title} exported as ${format.toUpperCase()} (${rows.length} rows)`, new: { filters: meta.filters, rows: rows.length } }))();
  }
  return { saved: !!(result && result.saved), path: result ? result.path : null, rows: rows.length };
}

module.exports = { exportRows, render, renderHtml, header, htmlEscape, FORMATS };

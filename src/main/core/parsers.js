'use strict';
// Reads import files into { headers, rows } where rows are arrays of cell text.
// Supported: CSV, TXT (tab, comma or semicolon separated), XLSX, XLS, JSON, XML.
const XLSX = require('xlsx');

function detectDelimiter(firstLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

// RFC 4180 style: quoted fields, doubled quotes, line breaks inside quotes.
function parseDelimited(text, delimiter) {
  const src = text.replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(src.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function parseSpreadsheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false });
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
}

function objectsToTable(list) {
  const headers = [];
  for (const o of list) for (const k of Object.keys(o || {})) if (!headers.includes(k)) headers.push(k);
  return [headers, ...list.map((o) => headers.map((h) => (o[h] === null || o[h] === undefined ? '' : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h]))))];
}

function parseJson(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  const list = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : Array.isArray(data.data) ? data.data : null;
  if (!list) throw new Error('JSON must be a list of records');
  return objectsToTable(list);
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

// Flat records: the most repeated element whose children are simple fields, e.g. <rows><row><Name>..</Name></row></rows>.
function parseXml(text) {
  const src = text.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const counts = {};
  for (const m of src.matchAll(/<([A-Za-z_][\w.-]*)[\s>]/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const candidates = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  for (const tag of candidates) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    const records = [];
    for (const m of src.matchAll(re)) {
      const inner = m[1];
      const fields = {};
      let found = false;
      for (const f of inner.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)?)<\/\1>/g)) {
        fields[f[1]] = decodeXml(f[2]).trim();
        found = true;
      }
      if (found) records.push(fields);
    }
    if (records.length >= 1 && records.every((r) => Object.keys(r).length > 0) && records.length === (counts[tag] || 0)) return objectsToTable(records);
  }
  throw new Error('No records found in the XML file');
}

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || '');
  return m ? m[1].toLowerCase() : '';
}

const SUPPORTED = ['csv', 'txt', 'xlsx', 'xls', 'json', 'xml'];

// Returns { headers, rows } with headers trimmed and empty rows dropped.
function parseFile(fileName, buffer) {
  const ext = extOf(fileName);
  let table;
  switch (ext) {
    case 'csv': table = parseDelimited(buffer.toString('utf8')); break;
    case 'txt': table = parseDelimited(buffer.toString('utf8')); break;
    case 'xlsx': case 'xls': table = parseSpreadsheet(buffer); break;
    case 'json': table = parseJson(buffer.toString('utf8')); break;
    case 'xml': table = parseXml(buffer.toString('utf8')); break;
    default: { const e = new Error('unsupported'); e.unsupported = true; throw e; }
  }
  // Exports from this app start with title lines; find the first row that looks like a header (most filled cells).
  let headerIndex = 0;
  const width = Math.max(...table.slice(0, 10).map((r) => r.filter((c) => String(c).trim()).length), 0);
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    if (table[i].filter((c) => String(c).trim()).length === width) { headerIndex = i; break; }
  }
  const headers = (table[headerIndex] || []).map((h) => String(h).trim());
  const rows = table.slice(headerIndex + 1).map((r) => headers.map((_, i) => (r[i] === undefined ? '' : String(r[i]).trim())));
  return { headers, rows: rows.filter((r) => r.some((c) => c !== '')) };
}

// Loose date reading for imports: 2027-03-31, 31/03/2027, 31-03-2027, 31.03.2027, 03/2027 (end of month), Mar-2027, Excel serial.
function looseDate(text, { endOfMonth = true } = {}) {
  const s = String(text || '').trim();
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const build = (y, m, d) => {
    if (y < 100) y += 2000;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  const lastDay = (y, m) => new Date(y < 100 ? y + 2000 : y, m, 0).getDate();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) return build(Number(m[3]), Number(m[2]), Number(m[1]));
  if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) { const y = Number(m[2]); const mo = Number(m[1]); return build(y, mo, endOfMonth ? lastDay(y, mo) : 1); }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  if ((m = /^([A-Za-z]{3})[a-z]*[\s/.-]+(\d{2,4})$/.exec(s))) {
    const mo = months.indexOf(m[1].toLowerCase()) + 1;
    if (mo) { const y = Number(m[2]); return build(y < 100 ? y + 2000 : y, mo, endOfMonth ? lastDay(y, mo) : 1); }
  }
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

function looseBool(text) {
  const s = String(text || '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'x'].includes(s)) return true;
  if (['', 'no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

module.exports = { parseFile, parseDelimited, parseXml, looseDate, looseBool, extOf, SUPPORTED };

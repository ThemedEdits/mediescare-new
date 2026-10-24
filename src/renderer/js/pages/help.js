// Help and updates: the version and automatic update state, and the guides (cashier quick-start, administrator guide).
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can } from '../state.js';
import { toast, toastError } from '../ui/toast.js';
import { confirm } from '../ui/modal.js';
import * as fmt from '../ui/format.js';

// A small Markdown reader for our own guides: headings, paragraphs, lists, tables, code and **bold**. Text only, no HTML.
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const x = m[0];
    if (x.startsWith('**')) out.push(h('strong', x.slice(2, -2)));
    else if (x.startsWith('`')) out.push(h('code', x.slice(1, -1)));
    else if (x.startsWith('[')) {
      // Links inside a guide jump to that heading on the same page.
      const m2 = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(x);
      const target = m2[2].startsWith('#') ? m2[2].slice(1) : null;
      out.push(target ? h('a.help-link', { href: '#', onclick: (e) => { e.preventDefault(); const el = document.getElementById(`help-${target}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, m2[1]) : h('span', m2[1]));
    }
    else out.push(h('em', x.slice(1, -1)));
    last = m.index + x.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// The same anchor names GitHub uses for headings, so the guides' contents links work here too.
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s/g, '-');
}

export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i += 1; }
      out.push(h('pre.help-code', code.join('\n')));
      i += 1;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) { out.push(h('hr.help-hr')); i += 1; continue; }
    const hm = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hm) { out.push(h(`h${hm[1].length + 1}.help-h`, { id: `help-${slug(hm[2])}` }, ...inline(hm[2]))); i += 1; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => k !== 1 || !/^\|[\s:-|]+\|$/.test(r));
      out.push(h('div.table-scroll', h('table.data.help-table', h('thead', h('tr', ...cells(body[0]).map((c) => h('th', ...inline(c))))),
        h('tbody', ...body.slice(1).map((r) => h('tr', ...cells(r).map((c) => h('td', ...inline(c)))))))));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
        items.push(h('li', ...inline(text)));
      }
      out.push(h(ordered ? 'ol.help-list' : 'ul.help-list', ...items));
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|\s*([-*]|\d+\.)\s)/.test(lines[i])) { para.push(lines[i].trim()); i += 1; }
    out.push(h('p.help-p', ...inline(para.join(' '))));
  }
  return h('div.help-doc', ...out);
}

const STATE_TONE = { up_to_date: 'success', ready: 'accent', downloading: 'warning', checking: 'outline', error: 'danger', not_set_up: 'outline', idle: 'outline' };

export async function render(page, { params }) {
  const updateBox = h('div.card-body');
  const docBox = h('div.card-body');
  let guide = params.guide || 'cashier';
  const tabs = h('div.row');
  page.append(h('div.page-head', h('div', h('h1', t('help.title')), h('p.sub', t('help.sub')))),
    h('div.card', h('div.card-head', h('h2', t('help.updates'))), updateBox),
    h('div.card', h('div.card-head', h('h2', t('help.guides')), tabs), docBox));

  async function paintUpdate(st) {
    let s = st;
    if (!s) { try { s = await call('update.status'); } catch (err) { toastError(err); return; } }
    const check = can('settings.edit') && s.state !== 'not_set_up' ? h('button.btn', { type: 'button', onclick: async () => {
      try { paintUpdate(await call('update.check')); } catch (err) { toastError(err); }
    } }, icon('refresh', 'sm'), t('help.checkNow')) : null;
    const install = can('settings.edit') && s.state === 'ready' ? h('button.btn.primary', { type: 'button', onclick: async () => {
      if (!(await confirm({ title: t('help.installTitle', { v: s.available }), text: t('help.installText'), confirmLabel: t('help.install') }))) return;
      try { await call('update.install'); toast(t('help.installing')); } catch (err) { toastError(err); }
    } }, t('help.install')) : null;
    mount(updateBox, h('dl.kv',
      h('dt', t('help.version')), h('dd', s.version),
      h('dt', t('common.status')), h('dd', h('span.badge', { class: STATE_TONE[s.state] || 'outline' }, t(`help.state.${s.state}`, { v: s.available || '', p: s.progress || 0 }))),
      s.checkedAt ? h('dt', t('help.lastChecked')) : null, s.checkedAt ? h('dd', fmt.dateTime(s.checkedAt)) : null),
    s.error ? h('p.small', { style: { color: 'var(--danger)', marginTop: '8px' } }, s.error) : null,
    s.state === 'not_set_up' ? h('p.small.muted', { style: { marginTop: '8px' } }, t('help.notSetUpText')) : null,
    h('div.row', { style: { marginTop: '12px' } }, check, install));
  }

  async function paintGuide() {
    mount(tabs, ...[['cashier', t('help.cashierGuide')], ['user', t('help.userManual')], ['admin', t('help.adminGuide')]].map(([k, label]) =>
      h('button.btn.sm', { type: 'button', class: k === guide ? 'primary' : '', onclick: () => { guide = k; paintGuide(); } }, label)));
    try {
      const res = await call('help.guide', { name: guide });
      mount(docBox, markdown(res.text));
    } catch (err) { toastError(err); }
  }

  await Promise.all([paintUpdate(), paintGuide()]);
  const timer = setInterval(() => { if (document.body.contains(updateBox)) paintUpdate(); }, 5000);
  return () => clearInterval(timer);
}

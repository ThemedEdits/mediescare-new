// Data table with search, sorting, pagination and column visibility.
// Client mode: pass rows. Server mode: pass fetch({ search, sort, dir, page, pageSize }) returning { rows, total }.
import { h, debounce } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';
import { popover } from './popover.js';
import { select } from './form.js';

function storedColumns(id) {
  try { return JSON.parse(localStorage.getItem(`cols:${id}`) || 'null'); } catch (_) { return null; }
}
function storeColumns(id, hidden) {
  try { localStorage.setItem(`cols:${id}`, JSON.stringify(hidden)); } catch (_) { /* not important */ }
}

export function dataTable({
  id, columns, rows = null, fetch = null, tools = [], onRowClick = null, searchPlaceholder, pageSize = 25,
  empty = { icon: 'list', title: t('table.noRows'), text: '' }, defaultSort = null, rowClass = null, searchable = true,
}) {
  const st = {
    search: '', sort: defaultSort ? defaultSort.key : null, dir: defaultSort ? defaultSort.dir : 'asc', page: 1, pageSize,
    hidden: new Set(storedColumns(id) || columns.filter((c) => c.hidden).map((c) => c.key)), rows: rows || [], total: 0, loading: false,
  };

  const searchInput = h('input.input', { type: 'search', placeholder: searchPlaceholder || t('common.searchPlaceholder'), 'aria-label': t('common.search') });
  const colsBtn = h('button.btn.sm', { type: 'button', title: t('table.columns') }, icon('columns', 'sm'), t('table.columns'));
  const toolsEl = h('div.table-tools',
    searchable ? h('div.input-wrap', icon('search', 'sm'), searchInput) : null,
    ...tools, h('div.spacer'), colsBtn);
  const thead = h('thead');
  const tbody = h('tbody');
  const table = h('table.data', thead, tbody);
  const scroll = h('div.table-scroll', table);
  const info = h('span');
  const prev = h('button.btn.sm.icon-only', { type: 'button', 'aria-label': t('table.prev') }, icon('chevronLeft', 'sm'));
  const next = h('button.btn.sm.icon-only', { type: 'button', 'aria-label': t('table.next') }, icon('chevronRight', 'sm'));
  const sizeSel = select([10, 25, 50, 100].map((n) => ({ value: n, label: String(n) })), {
    value: pageSize,
    style: { width: '80px', height: '28px' },
    'aria-label': t('table.perPage'),
  });
  const foot = h('div.table-foot', info, h('div.row', h('span.small.muted', t('table.perPage')), sizeSel, prev, next));
  const el = h('div.card', toolsEl, scroll, foot);

  const visible = () => columns.filter((c) => !st.hidden.has(c.key));

  function renderHead() {
    const tr = h('tr');
    for (const c of visible()) {
      const sortable = c.sortable !== false && c.key !== 'actions';
      const th = h('th', { class: [sortable ? 'sortable' : '', c.align === 'num' ? 'num' : ''].join(' '), style: c.width ? { width: c.width } : null, scope: 'col' }, c.label);
      if (sortable) {
        if (st.sort === c.key) th.append(h('span.sort-ind', icon(st.dir === 'asc' ? 'chevronUp' : 'chevronDown', 'sm')));
        th.setAttribute('aria-sort', st.sort === c.key ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.tabIndex = 0;
        const toggle = () => {
          if (st.sort === c.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
          else { st.sort = c.key; st.dir = 'asc'; }
          st.page = 1;
          refresh();
        };
        th.addEventListener('click', toggle);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      }
      tr.append(th);
    }
    thead.replaceChildren(tr);
  }

  function cellValue(c, row) {
    if (c.sortValue) return c.sortValue(row);
    const v = row[c.key];
    return v === null || v === undefined ? '' : v;
  }

  function clientView() {
    let list = st.rows;
    const q = st.search.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => columns.some((c) => {
        const v = c.searchValue ? c.searchValue(row) : row[c.key];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      }));
    }
    if (st.sort) {
      const c = columns.find((x) => x.key === st.sort);
      if (c) {
        const factor = st.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const x = cellValue(c, a);
          const y = cellValue(c, b);
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * factor;
          return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * factor;
        });
      }
    }
    const total = list.length;
    const start = (st.page - 1) * st.pageSize;
    return { rows: list.slice(start, start + st.pageSize), total };
  }

  function renderBody(view) {
    tbody.replaceChildren();
    const cols = visible();
    if (!view.rows.length) {
      const filtered = !!st.search.trim();
      tbody.append(h('tr', h('td', { colspan: cols.length },
        h('div.empty', icon(filtered ? 'search' : empty.icon || 'list'), h('h3', filtered ? t('table.noMatch') : empty.title), !filtered && empty.text ? h('p', empty.text) : null, !filtered && empty.action ? h('div', { style: { marginTop: '12px' } }, empty.action) : null))));
    }
    for (const row of view.rows) {
      const tr = h('tr', { class: [onRowClick ? 'clickable' : '', rowClass ? rowClass(row) || '' : ''].join(' ') });
      for (const c of cols) {
        const content = c.render ? c.render(row) : row[c.key];
        tr.append(h('td', { class: [c.align === 'num' ? 'num' : '', c.key === 'actions' ? 'actions' : '', c.nowrap ? 'nowrap' : ''].join(' ') }, content === null || content === undefined ? '' : content));
      }
      if (onRowClick) {
        tr.tabIndex = 0;
        tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select')) onRowClick(row); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) onRowClick(row); });
      }
      tbody.append(tr);
    }
    const from = view.total ? (st.page - 1) * st.pageSize + 1 : 0;
    const to = Math.min(st.page * st.pageSize, view.total);
    info.textContent = t('table.rows', { from, to, total: view.total });
    prev.disabled = st.page <= 1;
    next.disabled = to >= view.total;
  }

  let requestNo = 0;
  async function refresh() {
    renderHead();
    if (fetch) {
      const mine = ++requestNo;
      const res = await fetch({ search: st.search, sort: st.sort, dir: st.dir, page: st.page, pageSize: st.pageSize });
      if (mine !== requestNo) return; // a newer request already answered
      renderBody({ rows: res.rows, total: res.total });
    } else {
      const view = clientView();
      if (!view.rows.length && st.page > 1) { st.page = 1; return refresh(); }
      renderBody(view);
    }
  }

  searchInput.addEventListener('input', debounce(() => { st.search = searchInput.value; st.page = 1; refresh(); }, fetch ? 250 : 80));
  prev.addEventListener('click', () => { st.page = Math.max(1, st.page - 1); refresh(); });
  next.addEventListener('click', () => { st.page += 1; refresh(); });
  sizeSel.addEventListener('change', () => { st.pageSize = Number(sizeSel.value); st.page = 1; refresh(); });
  colsBtn.addEventListener('click', () => {
    const items = columns.filter((c) => c.hideable !== false && c.key !== 'actions').map((c) => {
      const box = h('input', { type: 'checkbox', checked: !st.hidden.has(c.key) });
      box.addEventListener('change', () => {
        if (box.checked) st.hidden.delete(c.key); else st.hidden.add(c.key);
        if (visible().length === 0) { st.hidden.delete(c.key); box.checked = true; }
        storeColumns(id, [...st.hidden]);
        refresh();
      });
      return h('label.menu-item', box, c.label);
    });
    popover(colsBtn, items);
  });

  refresh();
  return {
    el,
    refresh,
    setRows(next) { st.rows = next; refresh(); },
    resetPage() { st.page = 1; },
    focusSearch() { searchInput.focus(); },
  };
}

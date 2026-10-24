// Searchable dropdown. Typing any part of the text filters the list; arrow keys and Enter pick.
import { h, highlight } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';

// options: [{ value, label, sub }]
export function combobox({ options = [], value = '', placeholder, emptyLabel, onChange, disabled = false } = {}) {
  let items = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  let selected = items.find((o) => String(o.value) === String(value)) || null;
  let open = false;
  let activeIndex = 0;
  let filtered = items;

  const inputEl = h('input.input.combo-input', {
    type: 'text', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
    placeholder: placeholder || t('common.selectPlaceholder'), disabled,
  });
  const listEl = h('div.combo-list', { role: 'listbox', hidden: true });
  const wrap = h('div.combo', inputEl, h('span.combo-caret', icon('chevronDown', 'sm')), listEl);

  function showSelected() {
    inputEl.value = selected ? selected.label : '';
  }

  function render(query) {
    const q = (query || '').trim().toLowerCase();
    filtered = q ? items.filter((o) => `${o.label} ${o.sub || ''}`.toLowerCase().includes(q)) : items;
    activeIndex = Math.max(0, filtered.findIndex((o) => selected && o.value === selected.value));
    listEl.replaceChildren();
    if (!filtered.length) {
      listEl.append(h('div.combo-empty', t('common.noMatches', { q: query })));
      return;
    }
    filtered.forEach((o, i) => {
      const opt = h('div.combo-option', {
        role: 'option', 'aria-selected': String(i === activeIndex), class: i === activeIndex ? 'active' : '',
        onmousedown: (e) => { e.preventDefault(); choose(o); },
      }, h('span', highlight(o.label, query)), o.sub ? h('span.faint', highlight(o.sub, query)) : null);
      listEl.append(opt);
    });
  }

  function setOpen(next) {
    open = next;
    listEl.hidden = !open;
    inputEl.setAttribute('aria-expanded', String(open));
  }

  function moveActive(delta) {
    if (!filtered.length) return;
    activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
    [...listEl.children].forEach((c, i) => c.classList.toggle('active', i === activeIndex));
    const el = listEl.children[activeIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(o) {
    const changed = !selected || selected.value !== o.value;
    selected = o;
    showSelected();
    setOpen(false);
    if (changed) {
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (onChange) onChange(o.value, o);
    }
  }

  inputEl.addEventListener('focus', () => { inputEl.select(); render(''); setOpen(true); });
  inputEl.addEventListener('click', () => { if (!open) { render(''); setOpen(true); } });
  inputEl.addEventListener('input', () => { render(inputEl.value); setOpen(true); });
  inputEl.addEventListener('blur', () => { setOpen(false); showSelected(); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { render(''); setOpen(true); } else moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); showSelected(); }
  });

  inputEl.getValue = () => (selected ? selected.value : '');
  wrap.control = inputEl;
  wrap.getValue = inputEl.getValue;
  wrap.setValue = (v) => { selected = items.find((o) => String(o.value) === String(v)) || null; showSelected(); };
  wrap.setOptions = (next) => {
    items = emptyLabel ? [{ value: '', label: emptyLabel }, ...next] : next;
    if (selected) selected = items.find((o) => o.value === selected.value) || null;
    showSelected();
  };
  showSelected();
  return wrap;
}

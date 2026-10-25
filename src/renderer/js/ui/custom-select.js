// Custom Dropdown Component: Beautiful, smoothly animated, accessible custom select.
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';

let activeMenu = null;

export function closeActiveCustomSelect() {
  if (activeMenu) {
    activeMenu.close();
    activeMenu = null;
  }
}

// Global dismiss listeners
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => {
    if (activeMenu && !activeMenu.menuEl.contains(e.target) && !activeMenu.wrap.contains(e.target)) {
      closeActiveCustomSelect();
    }
  }, true);

  window.addEventListener('resize', () => {
    if (activeMenu) closeActiveCustomSelect();
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (activeMenu) activeMenu.updatePosition();
  }, { capture: true, passive: true });
}

export function customSelect(rawOptions = [], props = {}) {
  let items = normalizeOptions(rawOptions);
  let currentValue = props.value !== undefined && props.value !== null ? String(props.value) : (items[0] ? String(items[0].value) : '');
  let isDisabled = !!props.disabled;
  let isOpen = false;
  let activeIndex = -1;

  // Root wrapper
  const wrap = h('div.custom-select', {
    role: 'combobox',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-disabled': String(isDisabled),
    tabindex: isDisabled ? '-1' : '0',
  });

  if (props.id) wrap.id = props.id;
  if (props.class) {
    props.class.split(' ').forEach((c) => { if (c) wrap.classList.add(c); });
  }
  if (props.style && typeof props.style === 'object') {
    Object.assign(wrap.style, props.style);
  }
  if (isDisabled) wrap.classList.add('disabled');

  // Hidden native select to preserve standard form behaviors, serialization, and test automation
  const nativeSelect = h('select.custom-select-native', {
    tabindex: '-1',
    'aria-hidden': 'true',
    name: props.name || undefined,
    id: props.id || undefined,
    disabled: isDisabled,
  });
  populateNativeOptions();

  // Visible custom trigger
  const labelEl = h('span.custom-select-label');
  const chevronEl = h('span.custom-select-chevron', icon('chevronDown', 'sm'));
  const trigger = h('div.custom-select-trigger', labelEl, chevronEl);
  wrap.append(nativeSelect, trigger);

  // Floating dropdown menu
  const menuEl = h('div.custom-select-menu', { role: 'listbox' });

  function normalizeOptions(opts) {
    if (!Array.isArray(opts)) return [];
    return opts.map((opt) => {
      if (typeof opt === 'object' && opt !== null) {
        return {
          value: String(opt.value !== undefined ? opt.value : ''),
          label: opt.label !== undefined ? String(opt.label) : String(opt.value || ''),
          disabled: !!opt.disabled,
          sub: opt.sub || null,
        };
      }
      return { value: String(opt), label: String(opt), disabled: false, sub: null };
    });
  }

  function populateNativeOptions() {
    nativeSelect.replaceChildren();
    for (const it of items) {
      nativeSelect.append(h('option', { value: it.value, selected: String(it.value) === String(currentValue) }, it.label));
    }
    nativeSelect.value = currentValue;
  }

  function updateLabel() {
    const val = nativeSelect.value !== undefined ? nativeSelect.value : currentValue;
    const found = items.find((it) => String(it.value) === String(val));
    if (found) {
      labelEl.textContent = found.label;
      labelEl.classList.remove('placeholder');
    } else if (props.placeholder) {
      labelEl.textContent = props.placeholder;
      labelEl.classList.add('placeholder');
    } else {
      labelEl.textContent = items[0] ? items[0].label : '';
      labelEl.classList.remove('placeholder');
    }
  }

  // Intercept native select value assignment so test suites and code setting .value update the custom UI
  const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(nativeSelect, 'value', {
    get() {
      return protoDescriptor ? protoDescriptor.get.call(nativeSelect) : currentValue;
    },
    set(v) {
      if (protoDescriptor) protoDescriptor.set.call(nativeSelect, v);
      currentValue = String(v);
      updateLabel();
    },
    configurable: true,
  });

  // Native select change event synchronizes custom select
  nativeSelect.addEventListener('change', () => {
    currentValue = nativeSelect.value;
    updateLabel();
    wrap.dispatchEvent(new Event('change', { bubbles: true }));
  });

  function updatePosition() {
    if (!isOpen || !menuEl.parentElement) return;
    const r = trigger.getBoundingClientRect();
    const w = Math.max(r.width, 130);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;

    menuEl.style.position = 'fixed';
    menuEl.style.width = `${w}px`;
    menuEl.style.zIndex = '100000';
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    menuEl.style.left = `${left}px`;

    if (openUp) {
      menuEl.style.bottom = `${window.innerHeight - r.top + 4}px`;
      menuEl.style.top = 'auto';
      menuEl.style.transformOrigin = 'bottom left';
      menuEl.classList.add('open-up');
    } else {
      menuEl.style.top = `${r.bottom + 4}px`;
      menuEl.style.bottom = 'auto';
      menuEl.style.transformOrigin = 'top left';
      menuEl.classList.remove('open-up');
    }
  }

  function renderMenu() {
    menuEl.replaceChildren();
    if (!items.length) {
      menuEl.append(h('div.custom-select-empty', t('common.none') || 'No options'));
      return;
    }

    const val = nativeSelect.value !== undefined ? nativeSelect.value : currentValue;
    items.forEach((it, i) => {
      const isSelected = String(it.value) === String(val);
      const isAct = i === activeIndex;
      const opt = h('div.custom-select-option', {
        role: 'option',
        'aria-selected': String(isSelected),
        class: `${isSelected ? 'selected' : ''} ${isAct ? 'active' : ''} ${it.disabled ? 'disabled' : ''}`.trim(),
        onmousedown: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (it.disabled) return;
          choose(it.value);
        },
      },
      h('span.custom-select-opt-text', it.label),
      isSelected ? icon('check', 'sm') : null);

      menuEl.append(opt);
    });
  }

  function openMenu() {
    if (isDisabled || isOpen) return;
    if (activeMenu && activeMenu.wrap !== wrap) closeActiveCustomSelect();

    isOpen = true;
    wrap.classList.add('open');
    wrap.setAttribute('aria-expanded', 'true');
    const val = nativeSelect.value !== undefined ? nativeSelect.value : currentValue;
    activeIndex = items.findIndex((it) => String(it.value) === String(val));
    if (activeIndex < 0) activeIndex = 0;

    renderMenu();
    const overlay = document.getElementById('overlays') || document.body;
    overlay.append(menuEl);
    updatePosition();

    const activeEl = menuEl.children[activeIndex];
    if (activeEl) {
      requestAnimationFrame(() => activeEl.scrollIntoView({ block: 'nearest' }));
    }

    activeMenu = {
      wrap,
      menuEl,
      updatePosition,
      close: () => closeMenu(),
    };
  }

  function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove('open');
    wrap.setAttribute('aria-expanded', 'false');
    menuEl.remove();
    if (activeMenu && activeMenu.wrap === wrap) activeMenu = null;
  }

  function choose(val) {
    const changed = String(nativeSelect.value) !== String(val);
    currentValue = String(val);
    nativeSelect.value = currentValue;
    updateLabel();
    closeMenu();

    if (changed) {
      nativeSelect.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      wrap.dispatchEvent(new Event('input', { bubbles: true }));
      wrap.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof props.onChange === 'function') props.onChange(currentValue, items.find((o) => o.value === currentValue));
      if (typeof props.onchange === 'function') props.onchange(currentValue, items.find((o) => o.value === currentValue));
    }
  }

  function moveActive(delta) {
    if (!items.length) return;
    let next = activeIndex + delta;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    activeIndex = next;
    renderMenu();
    const activeEl = menuEl.children[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (isOpen) closeMenu();
    else openMenu();
  });

  wrap.addEventListener('keydown', (e) => {
    if (isDisabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) openMenu();
      else moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) openMenu();
      else moveActive(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) {
        if (items[activeIndex] && !items[activeIndex].disabled) {
          choose(items[activeIndex].value);
        }
      } else {
        openMenu();
      }
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'Tab' && isOpen) {
      closeMenu();
    }
  });

  // Expose element properties & methods
  Object.defineProperty(wrap, 'value', {
    get() { return nativeSelect.value !== undefined ? nativeSelect.value : currentValue; },
    set(v) {
      currentValue = String(v);
      nativeSelect.value = currentValue;
      updateLabel();
    },
    configurable: true,
  });

  Object.defineProperty(wrap, 'disabled', {
    get() { return isDisabled; },
    set(v) {
      isDisabled = !!v;
      wrap.classList.toggle('disabled', isDisabled);
      wrap.setAttribute('aria-disabled', String(isDisabled));
      wrap.tabIndex = isDisabled ? -1 : 0;
      nativeSelect.disabled = isDisabled;
      if (isDisabled && isOpen) closeMenu();
    },
    configurable: true,
  });

  Object.defineProperty(wrap, 'options', {
    get() { return nativeSelect.options; },
    configurable: true,
  });

  Object.defineProperty(wrap, 'selectedIndex', {
    get() { return nativeSelect.selectedIndex; },
    set(idx) {
      if (items[idx]) choose(items[idx].value);
    },
    configurable: true,
  });

  // Point control to nativeSelect so fieldText associates <label for> with the select id
  wrap.control = nativeSelect;
  nativeSelect.control = nativeSelect;

  wrap.getValue = () => (nativeSelect.value !== undefined ? nativeSelect.value : currentValue);
  wrap.setValue = (v) => {
    currentValue = String(v);
    nativeSelect.value = currentValue;
    updateLabel();
  };
  wrap.setOptions = (newOpts) => {
    items = normalizeOptions(newOpts);
    populateNativeOptions();
    updateLabel();
    if (isOpen) renderMenu();
  };

  updateLabel();
  return wrap;
}

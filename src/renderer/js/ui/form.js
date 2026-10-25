// Form building blocks: labelled fields, inline errors, and a small Form helper that maps server errors to fields.
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from '../strings/index.js';
import { customSelect } from './custom-select.js';

export function input(props = {}) {
  return h('input.input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
}

export function textarea(props = {}) {
  return h('textarea.input', { rows: 3, ...props });
}

export function select(options, props = {}) {
  return customSelect(options, props);
}

export function passwordInput(props = {}) {
  const el = input({ type: 'password', autocomplete: 'new-password', ...props });
  const toggle = h('button.btn.ghost.sm.icon-only', {
    type: 'button', tabindex: '-1', 'aria-label': t('common.showPassword'),
    style: { position: 'absolute', right: '3px', top: '3px' },
    onclick: () => {
      el.type = el.type === 'password' ? 'text' : 'password';
      toggle.replaceChildren(icon(el.type === 'password' ? 'eye' : 'eyeOff', 'sm'));
    },
  }, icon('eye', 'sm'));
  el.style.paddingRight = '36px';
  const wrap = h('div', { style: { position: 'relative' } }, el, toggle);
  wrap.control = el;
  return wrap;
}

export function checkbox(label, props = {}) {
  const box = h('input', { type: 'checkbox', ...props });
  // A <label> already exposes its input as the built-in .control property.
  return h('label.check', box, h('span', label));
}

// A labelled field. `control` may be an input, a wrapper with .control, or a combobox.
export function fieldText(control, label, { hint, required = false, span2 = false } = {}) {
  const inner = control.control || control;
  const id = inner.id || (inner.id = 'f' + Math.random().toString(36).slice(2));
  const errorEl = h('div.error-text', { role: 'alert', hidden: true });
  const el = h('div.field', { class: span2 ? 'span-2' : '' },
    label ? h('label', { for: id, class: required ? 'req' : '' }, label) : null,
    control,
    hint ? h('div.hint', hint) : null,
    errorEl);
  return {
    el,
    input: inner,
    setError(message) {
      el.classList.add('has-error');
      errorEl.hidden = false;
      errorEl.textContent = message;
      inner.setAttribute('aria-invalid', 'true');
    },
    clearError() {
      el.classList.remove('has-error');
      errorEl.hidden = true;
      inner.removeAttribute('aria-invalid');
    },
  };
}

// Groups fields by name, reads values, and shows a server error under the right field.
export class Form {
  constructor() {
    this.fields = {};
    this.errorBox = h('div.form-error', { role: 'alert', hidden: true });
  }

  add(name, field) {
    this.fields[name] = field;
    const ctl = field.input;
    const clear = () => { field.clearError(); this.errorBox.hidden = true; };
    ctl.addEventListener('input', clear);
    ctl.addEventListener('change', clear);
    return field.el;
  }

  value(name) {
    const f = this.fields[name];
    if (!f) return undefined;
    const ctl = f.input;
    if (ctl.type === 'checkbox') return ctl.checked;
    if (typeof ctl.getValue === 'function') return ctl.getValue();
    return ctl.value;
  }

  values() {
    const out = {};
    for (const name of Object.keys(this.fields)) out[name] = this.value(name);
    return out;
  }

  clearErrors() {
    for (const f of Object.values(this.fields)) f.clearError();
    this.errorBox.hidden = true;
  }

  // Server errors name the field (for example "username" or "admin.username"); fall back to the box at the top.
  showError(err) {
    const field = err && err.field ? (this.fields[err.field] || this.fields[String(err.field).split('.').pop()]) : null;
    if (field) {
      field.setError(err.message);
      field.input.focus();
    } else {
      this.errorBox.replaceChildren(icon('alertCircle', 'sm'), h('div', err && err.message ? err.message : t('error.generic')));
      this.errorBox.hidden = false;
    }
  }
}

// Runs an async action while a button shows a busy label, so double clicks do nothing.
export async function busy(button, busyLabel, fn) {
  const original = [...button.childNodes];
  button.disabled = true;
  if (busyLabel) button.replaceChildren(h('span.spinner', { style: { width: '14px', height: '14px', borderWidth: '2px', borderTopColor: 'currentColor' } }), busyLabel);
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.replaceChildren(...original);
  }
}

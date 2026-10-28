// Custom Number Stepper Component: Modern ergonomic stepper with Left (-) and Right (+) buttons.
import { h } from './dom.js';
import { icon } from './icons.js';

function stepValue(valStr, delta, stepAttr, minAttr, maxAttr) {
  let step = 1;
  let decimals = 0;
  if (stepAttr && stepAttr !== 'any') {
    step = parseFloat(stepAttr) || 1;
    const parts = String(stepAttr).split('.');
    if (parts[1]) decimals = parts[1].length;
  } else {
    const parts = String(valStr).split('.');
    if (parts[1]) decimals = parts[1].length;
  }
  const min = minAttr !== undefined && minAttr !== '' && minAttr !== null ? parseFloat(minAttr) : -Infinity;
  const max = maxAttr !== undefined && maxAttr !== '' && maxAttr !== null ? parseFloat(maxAttr) : Infinity;

  let current = parseFloat(valStr);
  if (isNaN(current)) {
    current = delta > 0 ? (min > -Infinity ? min : 0) : (max < Infinity ? max : 0);
  } else {
    current = current + delta * step;
  }
  if (current < min) current = min;
  if (current > max) current = max;

  if (decimals > 0) {
    return current.toFixed(decimals);
  }
  return String(Math.round(current * 1e8) / 1e8);
}

export function customStepper(props = {}) {
  const {
    style = {},
    class: className = '',
    id,
    onchange,
    oninput,
    ...rest
  } = props;

  const wrap = h('div.custom-stepper');

  if (className) {
    className.split(' ').forEach((c) => { if (c) wrap.classList.add(c); });
  }

  if (typeof style === 'object' && style !== null) {
    Object.assign(wrap.style, style);
  } else if (typeof style === 'string') {
    wrap.style.cssText = style;
  }

  const inputEl = h('input.input.custom-stepper-input', {
    type: 'number',
    autocomplete: 'off',
    spellcheck: 'false',
    id: id || undefined,
    ...rest,
  });

  if (className) {
    className.split(' ').forEach((c) => { if (c) inputEl.classList.add(c); });
  }

  if (onchange) inputEl.addEventListener('change', onchange);
  if (oninput) inputEl.addEventListener('input', oninput);

  // Left button: Decrement (-)
  const downBtn = h('button.custom-stepper-btn.custom-stepper-down', {
    type: 'button',
    tabindex: '-1',
    'aria-label': 'Decrease',
  }, icon('minus', 'sm'));

  // Right button: Increment (+)
  const upBtn = h('button.custom-stepper-btn.custom-stepper-up', {
    type: 'button',
    tabindex: '-1',
    'aria-label': 'Increase',
  }, icon('plus', 'sm'));

  // Order: [-] [ input ] [+]
  wrap.append(downBtn, inputEl, upBtn);

  function stepOnce(delta) {
    if (inputEl.disabled || inputEl.readOnly) return;
    const oldVal = inputEl.value;
    const next = stepValue(inputEl.value, delta, inputEl.step, inputEl.min, inputEl.max);
    if (next === oldVal) return;
    inputEl.value = next;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setupButton(btn, delta) {
    let timer = null;
    let interval = null;

    const stop = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (interval) { clearInterval(interval); interval = null; }
      window.removeEventListener('mouseup', stop, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
    };

    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      stop();
      inputEl.focus();
      stepOnce(delta);

      window.addEventListener('mouseup', stop, { capture: true });
      window.addEventListener('pointerup', stop, { capture: true });
      window.addEventListener('pointercancel', stop, { capture: true });

      timer = setTimeout(() => {
        if (!wrap.isConnected || !inputEl.isConnected) {
          stop();
          return;
        }
        interval = setInterval(() => {
          if (!wrap.isConnected || !inputEl.isConnected) {
            stop();
            return;
          }
          stepOnce(delta);
        }, 120);
      }, 400);
    });

    btn.addEventListener('mouseleave', stop);
  }

  setupButton(downBtn, -1);
  setupButton(upBtn, 1);

  inputEl.addEventListener('focus', () => wrap.classList.add('focused'));
  inputEl.addEventListener('blur', () => wrap.classList.remove('focused'));

  wrap.control = inputEl;
  wrap.input = inputEl;

  // Polymorphic delegation so wrap acts transparently as inputEl in forms and direct code
  const origAdd = wrap.addEventListener.bind(wrap);
  wrap.addEventListener = (type, listener, options) => {
    inputEl.addEventListener(type, listener, options);
    origAdd(type, listener, options);
  };
  const origRemove = wrap.removeEventListener.bind(wrap);
  wrap.removeEventListener = (type, listener, options) => {
    inputEl.removeEventListener(type, listener, options);
    origRemove(type, listener, options);
  };

  Object.defineProperty(wrap, 'value', {
    get() { return inputEl.value; },
    set(v) { inputEl.value = v; },
    configurable: true,
  });

  Object.defineProperty(wrap, 'disabled', {
    get() { return inputEl.disabled; },
    set(v) {
      inputEl.disabled = v;
      wrap.classList.toggle('disabled', !!v);
    },
    configurable: true,
  });

  Object.defineProperty(wrap, 'readOnly', {
    get() { return inputEl.readOnly; },
    set(v) {
      inputEl.readOnly = v;
      wrap.classList.toggle('readonly', !!v);
    },
    configurable: true,
  });

  wrap.focus = (opts) => inputEl.focus(opts);
  wrap.blur = () => inputEl.blur();
  wrap.select = () => inputEl.select();
  wrap.checkValidity = () => inputEl.checkValidity();
  wrap.reportValidity = () => inputEl.reportValidity();
  wrap.setCustomValidity = (msg) => inputEl.setCustomValidity(msg);
  wrap.getValue = () => inputEl.value;
  wrap.setValue = (v) => { inputEl.value = v; };

  return wrap;
}

export const numberInput = customStepper;

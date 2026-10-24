// Display formatting that follows the organisation settings.
import { settings } from '../state.js';
import { t } from '../strings/index.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function date(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  switch (settings().dateFormat) {
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD-MMM-YYYY': return `${day}-${MONTHS[d.getMonth()]}-${year}`;
    default: return `${day}/${month}/${year}`;
  }
}

export function time(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let hours = d.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${pad(d.getMinutes())} ${suffix}`;
}

export function dateTime(iso) {
  return iso ? `${date(iso)} ${time(iso)}` : t('common.never');
}

// Money arrives from the main process as integer minor units (paisa).
export function money(minor, { symbol = true } = {}) {
  if (minor === null || minor === undefined) return '';
  const s = settings();
  const decimals = s.currencyDecimals;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  let whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let fracText = '';
  if (decimals === 2) fracText = '.' + pad(frac);
  else if (decimals === 1) {
    let tenth = Math.floor(frac / 10) + (frac % 10 >= 5 ? 1 : 0);
    if (tenth === 10) { whole += 1; tenth = 0; }
    fracText = '.' + tenth;
  } else if (frac >= 50) whole += 1;
  return `${negative ? '-' : ''}${symbol ? s.currencySymbol + ' ' : ''}${whole.toLocaleString('en-US')}${fracText}`;
}

// Turns "login_failed" or "users" into "Login failed" / "Users" for display.
export function humanize(word) {
  if (!word) return '';
  const text = String(word).replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function relative(iso) {
  if (!iso) return t('common.never');
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return dateTime(iso);
}

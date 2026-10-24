'use strict';
// Small input validators. Each throws a VALIDATION AppError naming the form field.
const { invalid } = require('./errors');

function text(params, field, label, { required = false, max = 200, min = 0 } = {}) {
  const raw = params ? params[field] : undefined;
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!value) {
    if (required) invalid(field, 'error.required', { field: label });
    return null;
  }
  if (value.length > max) invalid(field, 'error.tooLong', { field: label, max });
  if (value.length < min) invalid(field, 'error.invalid', { field: label });
  return value;
}

function code(params, field, label, { min = 2, max = 6, messageKey = 'setup.codeFormat' } = {}) {
  const value = text(params, field, label, { required: true, max: 40 });
  const upper = value.toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${min},${max}}$`).test(upper)) invalid(field, messageKey);
  return upper;
}

function username(params, field = 'username') {
  const value = text(params, field, 'Username', { required: true, max: 40 });
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(value)) invalid(field, 'auth.usernameFormat');
  return value;
}

function password(params, field, minLength) {
  const value = params && params[field] !== undefined && params[field] !== null ? String(params[field]) : '';
  if (!value) invalid(field, 'error.required', { field: 'Password' });
  if (value.length < minLength) invalid(field, 'auth.passwordShort', { min: minLength });
  if (value.length > 200) invalid(field, 'error.tooLong', { field: 'Password', max: 200 });
  return value;
}

function bool(params, field) {
  const v = params ? params[field] : undefined;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function email(params, field, label = 'Email') {
  const value = text(params, field, label, { max: 120 });
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid(field, 'error.invalid', { field: label });
  return value;
}

function id(params, field, label = 'Record') {
  const value = params ? params[field] : undefined;
  if (typeof value !== 'string' || !/^[0-9A-Za-z]{1,40}$/.test(value)) invalid(field, 'error.required', { field: label });
  return value;
}

// ---- Phase 1 additions --------------------------------------------------------------------------------------------
const { parseMoney } = require('./money');

function blank(raw) {
  return raw === undefined || raw === null || String(raw).trim() === '';
}

// Whole number (quantities, days). Accepts numeric strings from forms.
function int(params, field, label, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const raw = params ? params[field] : undefined;
  if (blank(raw)) {
    if (required) invalid(field, 'error.required', { field: label });
    return fallback;
  }
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isInteger(n)) invalid(field, 'error.wholeNumber', { field: label });
  if (n < min || n > max) invalid(field, 'error.range', { field: label, min, max });
  return n;
}

// Money typed in rupees ("1,250.50") or sent as a number of rupees; returns paisa.
function money(params, field, label, { required = false, min = 0, fallback = null } = {}) {
  const raw = params ? params[field] : undefined;
  if (blank(raw)) {
    if (required) invalid(field, 'error.required', { field: label });
    return fallback;
  }
  const v = parseMoney(raw);
  if (v === null || Number.isNaN(v)) invalid(field, 'error.money', { field: label });
  if (v < min) invalid(field, 'error.notNegative', { field: label });
  if (v > 1e13) invalid(field, 'error.invalid', { field: label });
  return v;
}

// Percent typed as "12.5"; returns basis points (1250).
function percent(params, field, label, { required = false, max = 100 } = {}) {
  const raw = params ? params[field] : undefined;
  if (blank(raw)) {
    if (required) invalid(field, 'error.required', { field: label });
    return 0;
  }
  const v = parseMoney(raw);
  if (v === null || Number.isNaN(v) || v < 0 || v > max * 100) invalid(field, 'error.percent', { field: label, max });
  return v;
}

// Calendar date YYYY-MM-DD.
function date(params, field, label, { required = false } = {}) {
  const raw = params ? params[field] : undefined;
  if (blank(raw)) {
    if (required) invalid(field, 'error.required', { field: label });
    return null;
  }
  const value = String(raw).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) invalid(field, 'error.date', { field: label });
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) invalid(field, 'error.date', { field: label });
  if (Number(m[1]) < 1990 || Number(m[1]) > 2100) invalid(field, 'error.date', { field: label });
  return value;
}

function optionalId(params, field, label = 'Record') {
  const value = params ? params[field] : undefined;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9A-Za-z]{1,40}$/.test(value)) invalid(field, 'error.invalid', { field: label });
  return value;
}

function oneOf(params, field, label, allowed, { required = true, fallback = null } = {}) {
  const value = params ? params[field] : undefined;
  if (value === undefined || value === null || value === '') {
    if (required) invalid(field, 'error.required', { field: label });
    return fallback;
  }
  if (!allowed.includes(value)) invalid(field, 'error.invalid', { field: label });
  return value;
}

module.exports = { text, code, username, password, bool, email, id, int, money, percent, date, optionalId, oneOf };

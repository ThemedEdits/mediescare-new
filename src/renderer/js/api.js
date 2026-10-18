// Calls into the main process. Errors arrive as plain-language messages and are thrown as ApiError.
import { t } from './strings/index.js';

export class ApiError extends Error {
  constructor(payload) {
    super(payload.message || t('error.generic'));
    this.code = payload.code;
    this.details = payload.details || null;
    this.field = payload.details ? payload.details.field : null;
  }
}

const listeners = { signedOut: [] };

export function onSignedOut(fn) {
  listeners.signedOut.push(fn);
}

export async function call(method, params) {
  let res;
  try {
    res = await window.mediescare.call(method, params);
  } catch (_) {
    throw new ApiError({ code: 'BRIDGE', message: t('error.offlineMain') });
  }
  if (res && res.ok) return res.data;
  const err = new ApiError((res && res.error) || {});
  if (err.code === 'NOT_SIGNED_IN' || err.code === 'SESSION_EXPIRED') {
    for (const fn of listeners.signedOut) fn(err);
  }
  throw err;
}

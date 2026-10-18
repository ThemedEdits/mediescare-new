'use strict';
const { t } = require('./messages');
const log = require('./log');

// An error whose message is safe and meant for the person at the counter.
class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
  }
}

function fail(code, key, params, details) {
  throw new AppError(code, t(key, params), details);
}

// Field validation error. `field` is the form field name so the screen can highlight it.
function invalid(field, key, params) {
  throw new AppError('VALIDATION', t(key, params), { field });
}

// Convert anything thrown inside a service into a payload the renderer may show.
// Technical errors are logged in full and replaced by a plain message.
function toPayload(err, context) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  log.error('Unhandled error', context || '', err && err.stack ? err.stack : String(err));
  return { code: 'UNEXPECTED', message: t('error.unexpected') };
}

module.exports = { AppError, fail, invalid, toPayload };

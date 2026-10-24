'use strict';
// Join codes and the organisation recovery key. Letters and digits that cannot be confused (no O/0, I/1), shown in
// groups of four. Only the SHA-256 of the normalised code is stored or sent. gateway/src/handler.js has the same
// normalise + hash; test/join.test.js checks that both agree.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generate(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out.match(/.{1,4}/g).join('-');
}

function normalise(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hash(code) {
  return crypto.createHash('sha256').update(normalise(code)).digest('hex');
}

module.exports = { generate, normalise, hash, JOIN_LENGTH: 12, RECOVERY_LENGTH: 20 };

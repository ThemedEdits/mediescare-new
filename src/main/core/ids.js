'use strict';
// Time-ordered random ids (ULID style, Crockford base32, 26 chars).
// Rows created offline on different PCs never collide, and ids sort roughly by creation time.
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRandom = null;

function encodeTime(ms) {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomChars() {
  const bytes = crypto.randomBytes(16);
  const chars = [];
  for (let i = 0; i < 16; i++) chars.push(bytes[i] % 32);
  return chars;
}

// Monotonic within one process: same millisecond increments the random part.
function newId() {
  const now = Date.now();
  if (now === lastTime && lastRandom) {
    for (let i = lastRandom.length - 1; i >= 0; i--) {
      if (lastRandom[i] < 31) { lastRandom[i]++; break; }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = now;
    lastRandom = randomChars();
  }
  return encodeTime(now) + lastRandom.map((c) => ALPHABET[c]).join('');
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { newId, nowIso };

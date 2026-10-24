'use strict';
// Salted scrypt password hashes. Format: scrypt$N$r$p$saltBase64$hashBase64
const crypto = require('crypto');

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(String(password), Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used when the username does not exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;

// Readable temporary password for admins to hand over, for example "kite-4821".
function temporaryPassword() {
  const words = ['amber', 'cedar', 'delta', 'ember', 'falcon', 'harbor', 'island', 'jasmine', 'kite', 'lotus', 'maple', 'nectar', 'orbit', 'pearl', 'river', 'saffron', 'tulip', 'violet'];
  const word = words[crypto.randomInt(words.length)];
  return `${word}-${crypto.randomInt(1000, 10000)}`;
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, temporaryPassword };

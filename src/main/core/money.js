'use strict';
// Money is stored as INTEGER minor units (paisa, scale 100). Never use floats for stored amounts.
const SCALE = 100;

function assertInt(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label || 'amount'} must be an integer number of minor units`);
  return value;
}

// Parse user input such as "1,250.5" into minor units. Returns null for empty input.
function parseMoney(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return NaN;
    input = input.toFixed(6); // decimal text avoids binary float error such as 1.005 * 100
  }
  const text = String(input).replace(/,/g, '').trim();
  if (text === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return NaN;
  const negative = text.startsWith('-');
  const [whole, frac = ''] = text.replace('-', '').split('.');
  const fracPadded = (frac + '000').slice(0, 3);
  let minor = Number(whole) * SCALE + Number(fracPadded.slice(0, 2));
  if (Number(fracPadded[2]) >= 5) minor += 1; // round half up on the third decimal
  return negative ? -minor : minor;
}

// Multiply minor units by a quantity ratio with round-half-up (away from zero for negatives).
function mulRound(minor, numerator, denominator = 1) {
  assertInt(minor, 'amount');
  const product = BigInt(minor) * BigInt(numerator);
  const den = BigInt(denominator);
  const negative = (product < 0n) !== (den < 0n);
  const absP = product < 0n ? -product : product;
  const absD = den < 0n ? -den : den;
  let q = absP / absD;
  if ((absP % absD) * 2n >= absD) q += 1n;
  return Number(negative ? -q : q);
}

// Percentage of an amount; percent given in basis points (1250 = 12.50%).
function percentOf(minor, basisPoints) {
  return mulRound(minor, basisPoints, 10000);
}

// Tax contained in a tax-inclusive amount: amount * rate / (1 + rate), rate in basis points.
function inclusiveTax(minorGross, basisPoints) {
  return mulRound(minorGross, basisPoints, 10000 + basisPoints);
}

function sum(values) {
  return values.reduce((acc, v) => acc + assertInt(v, 'amount'), 0);
}

function format(minor, { symbol = 'Rs', decimals = 2 } = {}) {
  if (minor === null || minor === undefined) return '';
  const negative = minor < 0;
  const abs = Math.abs(minor);
  let whole = Math.floor(abs / SCALE);
  let frac = abs % SCALE;
  let fracText = '';
  if (decimals === 2) fracText = '.' + String(frac).padStart(2, '0');
  else if (decimals === 1) {
    let tenth = Math.floor(frac / 10) + (frac % 10 >= 5 ? 1 : 0);
    if (tenth === 10) { whole += 1; tenth = 0; }
    fracText = '.' + tenth;
  } else if (frac >= 50) whole += 1;
  const wholeText = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}${symbol ? symbol + ' ' : ''}${wholeText}${fracText}`;
}

module.exports = { SCALE, parseMoney, mulRound, percentOf, inclusiveTax, sum, format };

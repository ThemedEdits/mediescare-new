'use strict';
// Code 128 (set B, with set C for long digit runs) drawn as SVG, for product and batch labels.
// Each pattern lists bar and space widths in modules, starting with a bar.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

// Returns the list of symbol values including start, checksum and stop.
function encode(text) {
  const value = String(text);
  if (!value.length) throw new Error('Nothing to encode');
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error('Barcode text can only use plain letters, numbers and symbols');
  }
  const codes = [];
  let i = 0;
  const digitRun = (from) => { let n = 0; while (from + n < value.length && /\d/.test(value[from + n])) n++; return n; };
  // Start in set C when the text begins with 4 or more digits.
  let set = digitRun(0) >= 4 ? 'C' : 'B';
  codes.push(set === 'C' ? START_C : START_B);
  while (i < value.length) {
    if (set === 'C') {
      if (digitRun(i) >= 2) { codes.push(Number(value.slice(i, i + 2))); i += 2; continue; }
      codes.push(CODE_B); set = 'B'; continue;
    }
    const run = digitRun(i);
    if (run >= 6 || (run >= 4 && i + run === value.length)) {
      // Switch to C for an even number of digits; a leading odd digit stays in B.
      if (run % 2 === 1) { codes.push(value.charCodeAt(i) - 32); i += 1; }
      codes.push(CODE_C); set = 'C'; continue;
    }
    codes.push(value.charCodeAt(i) - 32);
    i += 1;
  }
  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103);
  codes.push(STOP);
  return codes;
}

function modules(text) {
  return encode(text).map((c) => PATTERNS[c]).join('');
}

// SVG with a quiet zone on both sides. height in modules; the text is printed underneath.
function svg(text, { module = 2, height = 50, showText = true, fontSize = 12 } = {}) {
  const widths = modules(text);
  const quiet = 10;
  let x = quiet * module;
  const bars = [];
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]) * module;
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  }
  const total = x + quiet * module;
  const textH = showText ? fontSize + 4 : 0;
  const escaped = String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height + textH}" width="${total}" height="${height + textH}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g>`
    + (showText ? `<text x="${total / 2}" y="${height + fontSize + 1}" font-family="monospace" font-size="${fontSize}" text-anchor="middle">${escaped}</text>` : '')
    + '</svg>';
}

module.exports = { encode, modules, svg, PATTERNS };

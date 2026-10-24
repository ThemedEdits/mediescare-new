'use strict';
// Document helpers shared by purchasing, stock and transfer services.
const docnum = require('./docnum');

// Numbers use this computer's own branch code and number, so two computers never produce the same number,
// even when an administrator creates a document for another branch.
function nextNo(ctx, prefix) {
  const d = ctx.app.device;
  return docnum.next(ctx.db, prefix, d.branch_code, d.device_no);
}

function canSeeCost(ctx) {
  return ctx.can('cost.view');
}

// Blanks cost and profit fields for people without the cost permission.
function redact(ctx, obj, fields) {
  if (canSeeCost(ctx) || !obj) return obj;
  const out = { ...obj };
  for (const f of fields) if (f in out) out[f] = null;
  return out;
}

// { page, pageSize } -> { page, pageSize, limit, offset }
function paging(params, { def = 50, max = 500 } = {}) {
  // __all is set by the exporter so a file contains every row, not one page.
  const pageSize = params.__all ? 1000000 : Math.min(Math.max(Number(params.pageSize) || def, 1), max);
  const page = Math.max(Number(params.page) || 1, 1);
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

// LIKE pattern matching the text anywhere, with wildcards in the text escaped (use ESCAPE '\').
function like(text) {
  return `%${String(text).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

module.exports = { nextNo, canSeeCost, redact, paging, like };

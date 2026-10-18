'use strict';
// Selling prices at the counter. One place, so the screen quote and the saved sale always agree.
//   pack price  = branch price for the product if set, otherwise the batch MRP (both per pack)
//   unit price  = the unit's fixed price if set, otherwise pack price * unit factor / pack size
//   line gross  = for qty base units: fixed price * qty / factor, or pack price * qty / pack size (rounded once)
const { mulRound } = require('./money');

function branchPackPrice(db, branchId, productId) {
  const row = db.prepare('SELECT mrp_override FROM product_branch WHERE product_id = ? AND branch_id = ?').get(productId, branchId);
  return row && row.mrp_override !== null ? row.mrp_override : null;
}

function packPrice(db, branchId, batch) {
  const override = branchPackPrice(db, branchId, batch.product_id);
  return override !== null ? override : batch.mrp;
}

function unitPrice(unit, pack, packSize) {
  if (unit.fixed_price !== null && unit.fixed_price !== undefined) return unit.fixed_price;
  return mulRound(pack, unit.factor, packSize);
}

// Gross for `qty` base units. `overridePrice` is a price per selling unit typed by the cashier (needs permission).
function gross(unit, pack, packSize, qty, overridePrice = null) {
  if (overridePrice !== null && overridePrice !== undefined) return mulRound(overridePrice, qty, unit.factor);
  if (unit.fixed_price !== null && unit.fixed_price !== undefined) return mulRound(unit.fixed_price, qty, unit.factor);
  return mulRound(pack, qty, packSize);
}

module.exports = { branchPackPrice, packPrice, unitPrice, gross };

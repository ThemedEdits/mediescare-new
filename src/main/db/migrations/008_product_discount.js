'use strict';
// Add default_discount_bp to products so each product can have an independent default discount.

module.exports = {
  version: 8,
  name: 'product_discount',
  up(db) {
    db.exec(`
      ALTER TABLE products ADD COLUMN default_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (default_discount_bp BETWEEN 0 AND 10000);
    `);
  },
};

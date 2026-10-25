'use strict';
// Ordered list of schema migrations. Add new files at the end; never edit an applied migration.
module.exports = [
  require('./001_foundation'),
  require('./002_inventory'),
  require('./003_pos'),
  require('./004_sync'),
  require('./005_insight'),
  require('./006_performance'),
  require('./007_join'),
  require('./008_product_discount'),
];

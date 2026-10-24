'use strict';
// Registers every RPC method. Order does not matter; each name may only be defined once.
const { define } = require('../rpc');

let registered = false;

function registerAll() {
  if (registered) return;
  registered = true;
  for (const mod of [
    require('./auth'),
    require('./setup'),
    require('./settings'),
    require('./users'),
    require('./roles'),
    require('./branches'),
    require('./auditlog'),
    require('./devices'),
    require('./sync'),
    require('./lookups'),
    require('./products'),
    require('./suppliers'),
    require('./purchasing'),
    require('./inventory'),
    require('./stockops'),
    require('./transfers'),
    require('./dataio'),
    require('./shifts'),
    require('./customers'),
    require('./pos'),
    require('./sales'),
    require('./device'),
    require('./expenses'),
    require('./finance'),
    require('./reports'),
    require('./dashboard'),
    require('./approvals'),
    require('./notifications'),
    require('./search'),
    require('./shortcuts'),
    require('./updates'),
  ]) mod.register(define);
}

module.exports = { registerAll };

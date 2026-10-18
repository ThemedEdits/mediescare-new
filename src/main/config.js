'use strict';
// Build-time settings. The cloud gateway address is built into the app (scripts/release.js writes build-config.json),
// so administrators never see database settings. MEDIESCARE_CLOUD_URL overrides it for testing. Empty means cloud sync
// is not set up in this build.
let built = {};
try { built = require('./build-config.json'); } catch (_) { built = {}; }

module.exports = {
  cloudUrl: process.env.MEDIESCARE_CLOUD_URL || built.cloudUrl || '',
  // Optional key the gateway asks for when a new organisation registers (set the same value on the gateway).
  cloudSetupKey: process.env.MEDIESCARE_CLOUD_SETUP_KEY || built.cloudSetupKey || '',
  lanPort: Number(process.env.MEDIESCARE_LAN_PORT) || 47800,
};

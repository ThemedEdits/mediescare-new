// Cloudflare Worker entry. Secrets (set with `wrangler secret put`): TURSO_URL, TURSO_TOKEN, optional SETUP_KEY.
// Needs the nodejs_compat flag (node:crypto for SHA-256 hashes and random device tokens). Every request does very
// little work (no password checks), so it fits the Workers free plan limit of about 10 ms CPU per request.
import gateway from './src/handler.js';
import adapters from './src/adapters.js';

let db = null;

export default {
  async fetch(request, env) {
    if (!db) db = adapters.tursoAdapter({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
    return gateway.handle(request, { db, SETUP_KEY: env.SETUP_KEY });
  },
};

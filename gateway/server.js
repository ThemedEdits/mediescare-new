'use strict';
// Runs the gateway as a plain Node server (any VPS or hosting that runs Node 20+).
//   TURSO_URL + TURSO_TOKEN -> Turso;  or  GATEWAY_SQLITE=path -> a local SQLite file (self-hosted, or for testing)
//   PORT (default 8787), SETUP_KEY (optional)
const http = require('http');
const { handle } = require('./src/handler');
const { tursoAdapter, sqliteAdapter } = require('./src/adapters');

function makeDb() {
  if (process.env.GATEWAY_SQLITE) return sqliteAdapter(process.env.GATEWAY_SQLITE);
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) throw new Error('Set TURSO_URL and TURSO_TOKEN, or GATEWAY_SQLITE');
  return tursoAdapter({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
}

// Converts Node's request into a web Request, calls the shared handler, writes the web Response back.
function createServer({ db, setupKey } = {}) {
  const env = { db: db || makeDb(), SETUP_KEY: setupKey !== undefined ? setupKey : process.env.SETUP_KEY };
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createServer().listen(port, () => console.log(`Mediescare gateway listening on ${port}`));
}

module.exports = { createServer };

# Mediescare cloud gateway

A small service in front of Turso. The desktop app talks only to this gateway; the Turso token stays here and never
ships inside the installer. Each computer gets its own token when it is registered, and the gateway lets it push and
pull only the operations of its own branch plus shared data (Head Office computers see every branch).

## Endpoints

| Method and path | Used by | What it does |
|---|---|---|
| `POST /v1/org/register` | Head Office main computer, once | Registers the organisation, returns a device token |
| `POST /v1/join` | A new main computer of a branch, or a replacement Head Office computer | Checks a one-time join code (made at Head Office, 24 hours, used once) or the organisation recovery key by SHA-256 hash, returns a device token. 20 wrong tries per organisation per hour, then refused for an hour. |
| `POST /v1/push` | Main computers | Stores operations (duplicates ignored) |
| `GET /v1/pull?after=N` | Main computers | Operations after N, limited to the device's branch |
| `GET /v1/hello`, `GET /v1/health` | Checks | |

The gateway keeps the full operation log (table `ops`), which is also the off-site copy of every branch.

Every request is deliberately light (no password checks; at most 300 operations per push or pull), so the gateway fits
the Cloudflare Workers **free plan** (about 10 ms CPU per request, 100,000 requests a day). Measured locally: a push of
200 operations takes about 1 ms of CPU.

## 1. Check the Turso database

```
TURSO_URL=libsql://<your-db>.turso.io TURSO_TOKEN=<token> node gateway/check.js
```

## 2a. Deploy on Cloudflare Workers

```
cd gateway
npx wrangler login
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN
npx wrangler secret put SETUP_KEY      # optional, see below
npx wrangler deploy
```

## 2b. Or run on any server with Node 20+

```
TURSO_URL=... TURSO_TOKEN=... SETUP_KEY=... PORT=8787 node gateway/server.js
```

Put it behind HTTPS (for example a reverse proxy). `GATEWAY_SQLITE=/path/file.db` uses a local SQLite file instead of
Turso (self-hosting or testing).

## 3. Build the app with the gateway address

The address is built into the app (`src/main/config.js`), so administrators never see database settings:
`MEDIESCARE_CLOUD_URL=https://<your-gateway>` (and `MEDIESCARE_CLOUD_SETUP_KEY` if `SETUP_KEY` is set).

## Security notes

- Device tokens are random 256-bit values; only their SHA-256 is stored.
- Blocking a computer in the app (Computers page) blocks its token here as soon as that change is synced.
- `SETUP_KEY` stops strangers from registering new organisations on your gateway. Without it anyone with the app
  could register an organisation, but never read or change another organisation's data.
- An organisation code can only be registered again from a computer already registered to it.
- Password hashes of users travel inside the operation log (they are needed to sign in offline on every computer).
  They are salted scrypt hashes, never plain passwords. The gateway never checks passwords: the manager's login is
  checked on the joining computer itself.
- Join codes and the recovery key are stored only as SHA-256 hashes (in the synced join_codes and org rows); used
  codes are recorded in join_uses so a code works once.

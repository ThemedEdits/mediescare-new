# Mediescare System Manual

For developers and technical administrators who build, deploy, maintain or extend Mediescare. It describes what the
system is made of, where it runs, how data is stored and shared, how it is secured, built, tested and operated.
`CLAUDE.md` holds the decision log; `PHARMACY-SOFTWARE-PROMPT.md` is the original requirements brief.

---

## Contents

1. [Overview](#1-overview)
2. [Technology stack](#2-technology-stack)
3. [Hosting and where things run](#3-hosting-and-where-things-run)
4. [Repository layout](#4-repository-layout)
5. [Desktop application architecture](#5-desktop-application-architecture)
6. [Local database](#6-local-database)
7. [Data model (tables)](#7-data-model-tables)
8. [Business rules that shape the data](#8-business-rules-that-shape-the-data)
9. [Sync: shop network and cloud](#9-sync-shop-network-and-cloud)
10. [Cloud gateway and Turso](#10-cloud-gateway-and-turso)
11. [Joining computers](#11-joining-computers)
12. [Security](#12-security)
13. [Backups and restore](#13-backups-and-restore)
14. [Configuration and environment variables](#14-configuration-and-environment-variables)
15. [Building, installer and auto-update](#15-building-installer-and-auto-update)
16. [Testing](#16-testing)
17. [Performance](#17-performance)
18. [Deployment runbook](#18-deployment-runbook)
19. [Operations and maintenance](#19-operations-and-maintenance)
20. [Extending the system](#20-extending-the-system)
21. [Limits, known risks and open items](#21-limits-known-risks-and-open-items)

---

## 1. Overview

Mediescare is an **offline-first desktop application** for a multi-branch pharmacy chain (one Head Office, many
branches).

- Each Windows computer runs the app with a **full local SQLite database** of the data it may see, and works with no
  network at all.
- Computers of a branch share changes over the **shop network (LAN)** with the branch's **main computer**.
- Main computers share changes with each other through a small **cloud gateway** in front of a **Turso** database.

```
 [Extra PC] --LAN HTTP, device token--> [Main PC of branch] --HTTPS, device token--> [Gateway] --> [Turso (libSQL)]
 [Extra PC] -------------------------------^                                             ^
 [Main PC of another branch / Head Office] -----------------------------------------------'
```

| Fact | Value |
|---|---|
| Product | Mediescare (pharmacy POS and management) |
| Platform | Windows 10/11 x64 desktop (Electron) |
| Local database | SQLite (better-sqlite3), one file per computer |
| Cloud database | Turso (libSQL, SQLite compatible), one database for all branches |
| Cloud hosting | Cloudflare Workers (free plan) or any Node 20+ server |
| Language | JavaScript (Node.js in the main process, plain ES modules in the screens), no framework |
| UI language | English; all strings in one file per process so Urdu can be added |
| Currency | PKR by default (integer paisa), configurable symbol and decimals |

---

## 2. Technology stack

| Part | Technology | Version | Why |
|---|---|---|---|
| Desktop shell | Electron | 33.4.11 | Windows app with Chromium screens and Node.js in the main process |
| Local database | SQLite via better-sqlite3 | 12.11.1 | Fast, synchronous, transactional, single file; prebuilt binary for Electron (no C++ tools needed) |
| Spreadsheets | SheetJS (xlsx) | 0.20.3 (from cdn.sheetjs.com) | XLSX/XLS import and export (the npm "xlsx" package is outdated) |
| Installer | electron-builder, NSIS | 26.15.3 | Windows installer, per-user or per-machine |
| Auto-update | electron-updater | 6.6.2 | Updates from GitHub Releases |
| Screens | Plain JavaScript ES modules, HTML, CSS | - | No framework; small own UI kit; served from `app://mediescare/` |
| Charts | Own inline SVG (`src/renderer/js/ui/charts.js`) | - | No chart library; validated colour tokens |
| Barcodes | Own Code 128 SVG (`src/main/core/barcode.js`) | - | Labels and receipts |
| PDF | Chromium print-to-PDF in a hidden window | - | Exports and receipts |
| Cloud gateway | JavaScript, Web `Request`/`Response` API | - | Runs unchanged on Cloudflare Workers and on Node (`gateway/server.js`) |
| Cloud database | Turso (libSQL) over its HTTP pipeline API | - | SQLite-compatible SQL, no driver needed |
| Tests | node:test inside Electron-as-Node; headless Electron UI driver | - | Same native module build as the app |

Runtime dependencies are only `better-sqlite3`, `electron-updater` and `xlsx`. No telemetry, no third-party services
other than Turso, Cloudflare (or your Node host) and GitHub Releases.

---

## 3. Hosting and where things run

| Component | Runs on | Hosted by | Cost |
|---|---|---|---|
| Mediescare app | Each pharmacy computer (Windows) | The pharmacy | - |
| Local database | `%APPDATA%\Mediescare\mediescare.db` on each computer | The pharmacy | - |
| Shop network service | The main computer of each branch, TCP 47800 (+ UDP 47801 discovery) | The pharmacy | - |
| Cloud gateway | Cloudflare Workers (`mediescare-gateway.<account>.workers.dev`) or a Node 20+ server | Cloudflare (free plan) or own server | Free plan targeted |
| Cloud database | Turso | Turso | Free plan to start; storage grows with use (see 21) |
| Installers and updates | GitHub Releases of the project repository | GitHub | Free |

**Cloudflare free plan fit:**
- Workers free plan: about 10 ms CPU per request and 100,000 requests a day.
- Every gateway request was designed to be light: join checks only a SHA-256 hash; pushes and pulls are capped at
  300 operations.
- Measured locally: a push of 200 operations takes about 1 ms CPU and 1,000 operations about 4.6 ms. The old
  password-based join took 59 ms and was removed.
- A branch's main computer syncs every 30 seconds, about 5,800 requests a day, so about 10 to 15 branches fit in
  the daily limit.
- Not yet measured on Cloudflare itself (see 21).

---

## 4. Repository layout

```
src/main/                 Electron main process (Node). Owns the database, sessions and every permission check.
  main.js                 Bootstrap: single-instance lock, app:// protocol, window, IPC, printing, PDF, dialogs, updater.
  rpc.js                  The one RPC router: auth, permission, idle sign-out, error mapping.
  config.js               Build-time settings (cloud URL, setup key, LAN port); reads build-config.json.
  build-config.json       Written by scripts/release.js at build time; blank in the source.
  backup.js               Backups and restore; backup-copy.js + backup-worker.js do the copy off the main thread.
  updater.js              Auto-update (electron-updater).
  db/                     Connection, migrations/NNN_*.js, sync-registry.js (synced tables), triggers.js.
  core/                   ids, money, errors, messages (all main-process text), permissions, audit, docs and
                          document numbers, stock ledger engine, pricing, receipt and label HTML, exporter, parsers,
                          password hashing, shortcuts catalogue, join codes, validation, log.
  services/               One file per module; each registers its RPC methods (see services/index.js).
  sync/                   apply.js (merge rules), ops.js (log and cursors), peer.js (HTTP client), lan-server.js
                          (main computer's service + UDP discovery), engine.js (background loops), join.js (first join).
src/preload/preload.js    contextBridge: exposes only window.mediescare.call(method, params) and display events.
src/renderer/             Screens: index.html, display.html (customer display), css/app.css, js/ (app, router, shell,
                          state, api, keys, strings/en.js, ui/ kit, pages/ one module per screen).
gateway/                  Cloud gateway: src/handler.js (logic), src/adapters.js (Turso HTTP or SQLite), worker.mjs
                          (Cloudflare entry), server.js (Node entry), wrangler.toml, check.js (Turso check), README.md.
scripts/                  start, test runners, UI smoke driver, performance test, icon maker, release/build,
                          legacy migration, native binary fetch.
test/                     Backend tests (node:test).
build/                    Installer resources: icon.png, icon.ico, installer.nsh (firewall rules).
docs/                     Admin guide, cashier quick-start, user manual, system manual, legacy migration guide and sample.
mediescare-icons/         Logo and icon (SVG).
```

---

## 5. Desktop application architecture

**Processes:**
- **Main process** (Node): database, sessions, permissions, business logic, sync, backups, printing, updates.
- **Renderer** (Chromium): screens only. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a
  strict Content Security Policy (no remote scripts, no `eval`, no frames).
- **Preload:** exposes one function, `window.mediescare.call(method, params)`, over one IPC channel (`rpc`). Calls
  from any page not served from `app://mediescare/` are refused.

**RPC (`src/main/rpc.js`):**
- Every method is registered with `define(name, { auth, perm, allowMustChange, allowBeforeSetup }, handler)`.
- `perm` is a permission key or a list (any one is enough).
- The router builds `ctx` on every call:
  - the user, re-read each time, so a disabled user or changed role takes effect at once
  - the branch, the device, and `ctx.can(perm)`
  - idle sign-out is enforced
  - the permission is checked before the handler runs
- Services enforce branch scope (`ctx.branchId`, or all branches with `branches.view_all`) and remove cost and profit
  fields when `!ctx.can('cost.view')`.
- About 200 methods are permission-protected. `rpc.list()` returns them all; `test/roles.test.js` calls every one
  with every default role.

**Errors:**
- Services throw `AppError(code, message, details)` with business-language messages (`core/messages.js`). A
  validation error names the field (`details.field`).
- Any other exception is logged to `userData/logs/main.log`, and the user sees "nothing was saved, please try again".
- Database guard trigger errors (`MEDI_NO_DELETE`, `MEDI_APPEND_ONLY`) become "This record cannot be changed".

**Sessions:**
- Held in the main process only, one signed-in user per window; nothing is stored in the browser.
- Idle sign-out after `security.autoLogoutMinutes`.

**Screens:**
- Hash routes (`#/sales?from=...`), defined in `js/router.js` with the permissions that show them.
- Menu items appear only when allowed. The main process checks again on every call.
- All text comes from `js/strings/en.js`; `test/renderer-static.test.js` checks that every key exists, that every
  icon exists, and that there are no emojis.

---

## 6. Local database

- **File:** `%APPDATA%\Mediescare\mediescare.db`, or `MEDIESCARE_DATA_DIR`.
- **Settings:** WAL journal, `synchronous = FULL`, foreign keys on.
- **Migrations:**
  - Files are `src/main/db/migrations/NNN_name.js` (currently 001 to 007), applied in order inside a transaction and
    recorded in `schema_migrations`.
  - Before any pending migration runs, a `VACUUM INTO` safety copy is taken in `userData/backups/`.
  - Migrations are additive (new tables, columns and indexes).
  - `test/inventory.test.js` upgrades a version-1 database to the current schema.
- **Triggers:** generated after migrations from `db/sync-registry.js`:
  - `sync_<table>_ins/_upd` write every insert and update of a synced table into `sync_ops`.
  - `guard_<table>_nodelete` refuses hard deletes on synced tables.
  - Append-only guards refuse UPDATE and DELETE on ledger-type tables.
- **IDs:** 26-character, time-ordered random ids (ULID style), generated in JavaScript, so rows made offline on
  different computers never collide.
- **Money:** INTEGER minor units (paisa). Rounding is round-half-up at line level; document totals are the sum of the
  lines. No floating-point money.
- **Quantities:** INTEGER in the product's base unit (tablet, ml, piece). Packs and boxes are conversions.
- **Timestamps:** ISO-8601 UTC with milliseconds. Business dates (sale date, received date) are local calendar dates
  (`YYYY-MM-DD`).
- **Document numbers:** `PREFIX-<BRANCHCODE><DEVICENO>-<seq>` (for example `INV-LHR2-0001`), from a per-device
  sequence (`doc_sequences`, never synced), so offline computers never produce the same number.

---

## 7. Data model (tables)

Synced tables carry `id` (text primary key) and `updated_at`. "Branch" tables also carry `branch_id`; transfers carry
`from_branch_id` and `to_branch_id` and are sent to both branches. Merge "lww" means last change wins; "append" means
written once and never changed.

| Area | Table | Synced | Merge | Notes |
|---|---|---|---|---|
| Organisation | `org` | global | lww | name, code, recovery key hash |
| | `branches`, `devices`, `roles`, `users` | global | lww | roles hold permissions as JSON; users hold scrypt hashes and prefs |
| | `settings` | branch (or global) | lww | organisation values and branch overrides |
| | `audit_log` | branch | append | who, what, old/new JSON, reason |
| | `join_codes` | branch | lww | hashes of one-time join codes |
| Master data | `lookups` | global | lww | categories, forms, manufacturers, drug classes, storage, unit names |
| | `suppliers`, `products`, `product_units`, `product_barcodes`, `customers` | global | lww | |
| | `product_branch` | branch | lww | shelf, levels, branch price |
| | `price_history` | branch | append | |
| Stock | `batches` | global | lww | batch number, expiry, cost, MRP; shared by branches |
| | `batch_status` | branch | lww | quarantine per branch |
| | `stock_ledger` | branch | append | the only place stock changes |
| | `stock_balances` | local | - | cache of ledger sums, rebuildable |
| Purchasing | `purchase_orders`, `purchase_order_lines`, `grns`, `grn_lines`, `purchase_returns`, `supplier_payments` | branch | lww | |
| | `purchase_return_lines`, `supplier_ledger`, `payment_allocations` | branch | append | |
| Stock operations | `stock_adjustments`, `stock_adjustment_lines`, `stock_takes`, `stock_take_lines` | branch | lww | |
| | `transfers`, `transfer_lines` | both branches | lww | |
| Point of sale | `sales`, `shifts`, `customer_receipts`, `prescriptions` | branch | lww | sales carry `fbr_invoice_no` / `fbr_status` for a future FBR link |
| | `sale_lines`, `sale_payments`, `sale_returns`, `sale_return_lines`, `customer_ledger`, `cash_movements`, `receipt_allocations` | branch | append | |
| | `held_bills` | local | - | bills on hold stay on one computer |
| Money | `expense_categories` | global | lww | |
| | `expenses`, `approval_requests` | branch | lww | |
| | `petty_cash` | branch | append | |
| Local only | `local_state`, `doc_sequences`, `login_attempts`, `sync_ctx`, `sync_ops`, `sync_cursors`, `sync_log`, `sync_conflicts`, `lan_tokens`, `backups`, `notification_reads`, `schema_migrations` | - | - | per-computer bookkeeping |

**The gateway's own tables in Turso:**

| Table | Contents |
|---|---|
| `orgs` | organisation id, code, name |
| `devices` | device id, organisation, branch, all-branches flag, SHA-256 of the device token, revoked time, last seen |
| `ops` | the operation log: one row per change, with columns for table, row id, kind, branch(es), `updated_at`, origin device, and the changed row as JSON text in `data` |
| `join_uses` | join code hashes already used |
| `join_fails` | wrong join attempts (rate limit) |

---

## 8. Business rules that shape the data

- **Never delete documents:** financial and stock documents are cancelled or reversed with a linked record. Master
  data is deactivated.
- **Stock:**
  - Only `core/stock.post()` writes `stock_ledger`.
  - The balance is the sum of the ledger; `stock.checkBalances()` must always return nothing.
  - **FEFO** picks batches; expired and quarantined batches are never sold or sent.
- **Costing:** batch cost (landed cost per pack, including the share of bill discount and freight), used for stock
  value and cost of goods sold. Cost is never edited afterwards.
- **Prices:** per batch MRP, optional branch price; tax-inclusive, rate per product; line tax = net x rate / (100 +
  rate).
- **Approvals:** discounts above the limit, typed prices, credit, voids, large returns, large adjustments and large
  expenses need a right or an approval token. Nobody approves their own request.
- **Overselling** across offline computers is allowed (the counter never stops). The batch goes below zero and is
  flagged.
- **Regulation:** prescription fields for prescription-only and controlled medicines. The controlled drug register is
  derived from the ledger. Prescriptions are never deleted.

---

## 9. Sync: shop network and cloud

**Operation log:**
- Every insert and update of a synced table writes a row to `sync_ops`: `seq` (local), `op_id` (global random),
  table, row id, kind, `branch_id` (and `branch_id2`), full row JSON, `updated_at`, origin device, and source peer.
- Triggers are silent while `sync_ctx.applying = 1`, which is how received operations are applied without echoing.

**Protocol (the same for LAN and cloud), bearer device token:**
- `POST /v1/push { ops }` and `GET /v1/pull?after=N&limit=M`.
- **Push** first, then **pull**, in batches (push 250, pull 300). The receiver inserts by `op_id` (duplicates are
  ignored) and applies the new ones in one transaction.
- The sender moves its push cursor only past `handled` (how many the receiver looked at), so a smaller server limit
  or a crash simply resends.
- Pull cursors use the peer's own `seq`. Every operation is idempotent.

**Merge rules (`sync/apply.js`):**
- **append** tables: `INSERT OR IGNORE`.
- **lww** tables: the newer `updated_at` wins; ties go to the larger `op_id`.
- Columns unknown to this version are dropped (the op is kept); unknown tables are kept for after an update.
- Foreign keys are deferred per batch. A batch with a missing reference is applied without checks and recorded as a
  conflict, rather than blocking sync.
- **Unique clashes** made offline (same username, code or barcode on two computers) are settled the same way on every
  computer: the larger id is renamed or switched off, or merged for logical duplicates. Each case is logged to
  `sync_conflicts`.

**Scope:**
- A branch device receives its branch's rows (`branch_id` or `branch_id2`) plus global rows. Head Office devices
  receive everything.
- Only the main computer talks to the cloud; extra computers talk to the main computer.

**Timing and discovery:**
- Extra computers sync every 4 seconds. The main computer syncs with the cloud every 30 seconds, and about 0.5 s after
  a counter sends sales.
- LAN discovery: UDP broadcast `MEDIESCARE?` on port 47801.

**Clocks:** every answer carries `serverTime`; more than 2 minutes difference shows a warning.

---

## 10. Cloud gateway and Turso

**Why a gateway:**
- The Turso token is all-powerful for its database. It lives **only** on the gateway (Cloudflare secret or server
  environment), never in the app.
- Each computer gets its own random device token (only its SHA-256 is stored). A device may push and pull only its
  branch's operations plus shared ones. A blocked device is refused as soon as the block syncs.

**Endpoints (`gateway/src/handler.js`):**

| Method and path | Purpose |
|---|---|
| `GET /v1/health`, `/v1/hello` | Checks |
| `POST /v1/org/register` | The Head Office main computer registers the organisation (optional `SETUP_KEY`) |
| `POST /v1/join` | A branch main computer joins with a one-time join code, or a replacement Head Office computer with the recovery key |
| `POST /v1/push`, `GET /v1/pull` | Sync (max 300 operations per request) |

**Turso:**
- SQL, not NoSQL: libSQL, a fork of SQLite, accessed over its HTTP pipeline API (`/v2/pipeline`) by
  `gateway/src/adapters.js`. Batches run as one transaction.
- Data is relational tables (see section 7). Each change is a row of `ops`, with the changed record as JSON text.
- The gateway keeps the whole operation log per organisation. It is the off-site copy of every branch and how a new
  computer is rebuilt.
- Reports never read Turso; each computer reports from its own SQLite.

**Running the gateway:**
- **Cloudflare:** `gateway/wrangler.toml` (flag `nodejs_compat`), entry `worker.mjs`. Secrets: `TURSO_URL`,
  `TURSO_TOKEN`, `SETUP_KEY`.
- **Node:** `node gateway/server.js` with the same variables (or `GATEWAY_SQLITE=<file>` for a local SQLite instead
  of Turso), behind HTTPS.
- `npm run gateway:check` verifies a Turso database: creates the tables, writes, reads, and confirms that a failed
  batch rolls back.

---

## 11. Joining computers

| Case | Proof | Where the check runs |
|---|---|---|
| First Head Office computer | Creates the organisation; registers with the gateway (optional `SETUP_KEY`) | App, gateway |
| A branch's main computer | Organisation code + one-time **join code** made at Head Office for that branch (24 hours, used once, can be cancelled) | Gateway compares SHA-256 hashes; then the manager's login is checked **on the new computer** against downloaded users |
| Replacement Head Office computer | Organisation code + **organisation recovery key** (20 characters, shown once at setup; only the owner can replace it) | Gateway compares SHA-256 hashes |
| Extra computer in a branch | 6-digit **pairing code** on the main computer (10 minutes, one use, 5 wrong tries block for 10 minutes) + a manager's login | Main computer (scrypt check locally) |

**Code format** (`core/joincodes.js`):
- The alphabet has no O/0 or I/1. Codes are shown in groups of four.
- Codes are normalised (case, spaces and dashes ignored) before SHA-256. The gateway has the same normalisation;
  `test/join.test.js` checks that both agree.

**Gateway join safeguards:**
- 20 wrong attempts per organisation per hour, then refused for an hour.
- The code is claimed with a primary-key insert before the device token is issued, so two computers using one code
  at the same moment cannot both join.
- Join codes and the recovery hash reach the gateway through normal sync (`join_codes` and `org` rows).

---

## 12. Security

- **Passwords:** scrypt (N=16384, r=8, p=1, 16-byte salt, 64-byte key), stored as `scrypt$N$r$p$salt$hash`.
  - Lock after 5 wrong tries for 15 minutes (settings).
  - Temporary passwords force a change.
  - Password hashes travel inside the synced `users` rows (needed to sign in offline on every computer); they are
    never plain.
- **Permissions:** checked in the main process on every call. Cost and profit are stripped for roles without
  `cost.view`, including in exports. Branch scope is enforced in services.
- **Device tokens:** 256-bit random, only SHA-256 stored (gateway `devices`, LAN `lan_tokens`), revocable.
- **Secrets:**
  - The Turso token exists only on the gateway.
  - `SETUP_KEY` stops strangers registering organisations on your gateway.
  - Join codes and the recovery key are stored only as hashes.
- **Renderer isolation:** sandbox, context isolation, CSP, one IPC channel, origin check on IPC.
- **Audit:** `audit_log` is append-only (database triggers) and written in the same transaction as the change.
- **Backups:** gzip, optionally AES-256-GCM with a key protected by Windows (Electron `safeStorage`).
- **Not yet:** the installer is not code-signed (SmartScreen warns).

---

## 13. Backups and restore

- **Automatic:** daily (checked every 30 minutes), the last 14 kept, plus manual backups and safety copies before
  restore, update and migrations. Files are in `userData/backups/`, with an optional second copy to a chosen folder.
- **How they are made:** `VACUUM INTO` a consistent copy, then a gzip stream (and an AES-256-GCM stream when
  encryption is on), in a **worker thread** (`backup-worker.js` -> `backup-copy.js`; the main thread is used if a
  worker cannot start). Nothing large is held in memory.
- **Formats:**
  - `.db.gz` (plain gzip)
  - `.db.gz.enc` = `MEDIBK2` + 12-byte IV + AES-256-GCM(gzip(db)) + 16-byte tag
  - Restore also reads plain `.db` files and the older `MEDIBK1` encrypted format.
- **Restore:** checks the file is a Mediescare backup of the same organisation, takes a safety copy, swaps the file,
  and restarts the app.
- **Measured:** a 1.76 GB database became a 266 MB backup in 35 s, while the counter answered in 32 ms.
- **Rebuilding a lost computer:** the cloud copy (rejoin), not the local backups (encrypted ones open only on the
  same computer and Windows user).

---

## 14. Configuration and environment variables

**App, built in at build time** (`scripts/release.js` writes `src/main/build-config.json`; `config.js` reads it):

| Variable | Meaning |
|---|---|
| `MEDIESCARE_CLOUD_URL` | Gateway address, for example `https://mediescare-gateway.<account>.workers.dev`. Empty = cloud sync "not set up". |
| `MEDIESCARE_CLOUD_SETUP_KEY` | Must equal the gateway's `SETUP_KEY` (if set) for Head Office registration. |
| `MEDIESCARE_GH_OWNER`, `MEDIESCARE_GH_REPO`, `GH_TOKEN` | GitHub repository for releases and auto-update (release builds). |

**App, at run time:**

| Variable | Meaning |
|---|---|
| `MEDIESCARE_DATA_DIR` | Data folder instead of `%APPDATA%\Mediescare` |
| `MEDIESCARE_LAN_PORT` | Shop network port (default 47800) |
| `MEDIESCARE_CLOUD_URL` | Overrides the built-in gateway address (testing) |
| `MEDIESCARE_HIDDEN` | Start without showing the window (tests) |
| `MEDIESCARE_LOG_STDOUT` | Also print the log to the console |

**Gateway:**

| Variable | Meaning |
|---|---|
| `TURSO_URL`, `TURSO_TOKEN` | The Turso database (Cloudflare secrets or server environment) |
| `SETUP_KEY` | Optional key needed to register a new organisation |
| `PORT` | Node server port (default 8787) |
| `GATEWAY_SQLITE` | Use a local SQLite file instead of Turso (Node only) |

**Developer machine:** the VS Code shell sets `ELECTRON_RUN_AS_NODE=1`. `npm start` and the UI test unset it; the
backend tests use it on purpose (Electron's Node with the same native module build).

**Business settings** live in the `settings` table, with organisation values and branch overrides (see the
definitions in `src/main/services/settings.js`).

---

## 15. Building, installer and auto-update

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies and fetches the prebuilt better-sqlite3 binary for Electron 33 |
| `npm start` | Runs the app from source |
| `npm run icon` | Draws `build/icon.png` and `build/icon.ico` from the SVG logo |
| `npm run dist` | Builds `dist/Mediescare-Setup-<version>.exe` (nothing uploaded) |
| `npm run release` | Builds and publishes a GitHub Release (published, not draft, so installed copies see it); refuses without the cloud settings |
| `npm run ship` | Backend tests, version bump (patch/minor/major), commit, tag `vX.Y.Z`, push; the tag starts `.github/workflows/release.yml`, which builds and publishes the release on GitHub Actions (needs the repository secrets `MEDIESCARE_CLOUD_URL` and `MEDIESCARE_CLOUD_SETUP_KEY`) |

**Installer (electron-builder, `package.json` "build"):**
- NSIS, x64, assisted installer: "just me" or "all users", choose the folder, desktop and Start menu shortcuts.
- Data is kept on uninstall.
- `build/installer.nsh` adds Windows Firewall rules for TCP 47800 and UDP 47801 (private and domain networks) for an
  all-users install, and removes them on uninstall.
- `asarUnpack` keeps `better-sqlite3` outside the asar; `npmRebuild` is off.
- The packaged app was started and checked: it opened its database, ran all migrations, and ran the backup worker.

**Auto-update (`src/main/updater.js`):**
- Active only when the build has a GitHub repository (`app-update.yml` is present). Otherwise the Help page says
  "not set up".
- Checks 30 s after start and every hour, and downloads in the background. While downloading or ready, an **Update**
  chip shows in the top bar for everyone.
- Installs silently (no installer wizard) on **Restart and update** (top bar chip or Help and updates page, needs
  `settings.edit`; a safety backup first) and reopens, or installs when the app closes.
- On the next start, pending migrations run, each after its own safety copy.

**Releases:** the repository is https://github.com/ThemedEdits/mediescare-new (public; electron-updater reads its
releases without a token). See `docs/RELEASING.md`.

**Versioning:** bump `version` in `package.json` before a release (`npm run ship` does it). Migrations must stay additive; never edit an
applied migration.

---

## 16. Testing

| Command | What it covers |
|---|---|
| `npm test` | 81 backend tests (node:test in Electron-as-Node): money, ids, documents, auth, roles and every permission per role, audit, settings, inventory, purchasing, transfers, POS, returns, shifts, credit, prescriptions, sync merge rules, LAN and cloud end to end, crash safety, gateway scoping, Turso adapter, backups old and new formats, join codes and recovery key, expenses, journal, reports, dashboards, approvals, notifications, search, shortcuts, legacy migration, and the definition-of-done scenario |
| `npm run test:ui` | 38-step headless UI test: drives the real screens in a hidden window, checks numbers against the database, fails on any console warning or error, saves screenshots (`UI_SHOTS`) |
| `npm run test:perf` | Performance with 50,000 products, 100,000 batches, 500,000 movements and 100,000 bills (about 10 minutes); fails if any call exceeds its limit |

Rules for contributors:
- Business rules get backend tests.
- Screens get a step in the UI test.
- Never claim something works because it compiles.

---

## 17. Performance

Limits: counter actions 150 ms, screens 1 s, reports 4 s. Last run (all within limits):

| Call | Time |
|---|---|
| Search medicine by name / barcode | 33 ms / 22 ms |
| FEFO price quote / finish a sale | 1 ms / 7 ms |
| Batches page / financial journal (1 day) | 542 ms / 131 ms |
| Dashboard / notifications | 375 ms / 246 ms |
| Management summary / stock valuation / reconciliation | 1,220 / 1,027 / 566 ms |
| Stock consistency check | 268 ms |

Indexes that made this possible are in migration 006 (covering indexes for the ledger, branch and date indexes).

---

## 18. Deployment runbook

1. **Turso:** create a database (dashboard at turso.tech), note the `libsql://...` URL, and create a non-expiring
   read-write token. Optionally run `TURSO_URL=... TURSO_TOKEN=... npm run gateway:check`.
2. **Cloudflare:** create a free account and choose the workers.dev subdomain. Then:
   ```
   cd gateway
   npx wrangler login
   npx wrangler secret put TURSO_URL
   npx wrangler secret put TURSO_TOKEN
   npx wrangler secret put SETUP_KEY
   npx wrangler deploy
   ```
   Note the gateway address. (Alternative: run `gateway/server.js` on a Node 20+ server behind HTTPS.)
3. **Build the app with the address:**
   ```
   set MEDIESCARE_CLOUD_URL=https://mediescare-gateway.<account>.workers.dev
   set MEDIESCARE_CLOUD_SETUP_KEY=<the same SETUP_KEY>
   npm run dist
   ```
   For auto-update, also set `MEDIESCARE_GH_OWNER` / `MEDIESCARE_GH_REPO` (and `GH_TOKEN` for `npm run release`).
4. **Install at Head Office**, create the organisation, and store the recovery key safely. Head Office registers with
   the gateway automatically.
5. **For each branch:** add the branch, make a join code (Computers), set up the branch's main computer with it, then
   pair extra computers over the shop network.

---

## 19. Operations and maintenance

- **Logs:** `%APPDATA%\Mediescare\logs\main.log` (app). Cloudflare dashboard, Workers, mediescare-gateway, then Logs
  and Metrics (gateway CPU time and requests).
- **Health:** `GET <gateway>/v1/health`. In the app: Sync page (state, pending, log, conflicts), bell notifications,
  the Backups page.
- **Rotate the Turso token:** create a new token in Turso, `npx wrangler secret put TURSO_TOKEN`, then revoke the old
  one. No app change is needed.
- **Block a lost computer:** Computers page, then Block. The gateway and the main computer refuse it after sync.
- **Lost Head Office computer:** new install, then join with the organisation code and the recovery key.
- **Lost branch main computer:** Head Office makes a join code; the new computer joins and downloads the branch data
  from the cloud.
- **Data repair:** stock balances can be rebuilt from the ledger (`stock.rebuildBalances`); `stock.check` must return
  nothing. Below-zero batches are corrected with adjustments.
- **Turso storage:** watch the database size in the Turso dashboard (see 21).

---

## 20. Extending the system

- **New table:**
  1. Add a migration (`NNN_name.js`, additive).
  2. If it must travel between computers, add it to `db/sync-registry.js` (scope, merge, branch columns) and give it
     `id` and `updated_at`.
  3. For write-once tables, add it to `APPEND_ONLY_TABLES`.
  4. Add unique-clash rules in `sync/apply.js` if it has unique columns.
- **New RPC method:** add it to a service with `define(name, { perm }, handler)`. Check branch scope and redact cost.
  The role test covers the permission automatically.
- **New permission:** add it to `core/permissions.js` (module action or special right) and to the default roles as
  needed.
- **New screen:** add a module in `src/renderer/js/pages/`, a route in `js/router.js` (with perms), its strings in
  `js/strings/en.js`, and a UI test step.
- **New report:** add an entry to `REPORTS` in `services/reports.js` returning `{ columns, rows, notes, chart }`.
  Print and export work automatically.
- **Urdu:** add `js/strings/ur.js` with the same keys and a language switch, plus a matching table in
  `core/messages.js`.
- **FBR POS:** sales already carry `fbr_invoice_no` and `fbr_status`.

---

## 21. Limits, known risks and open items

- **Sync log growth:**
  - `sync_ops` (and the gateway's `ops`) keep every change. That is about 1.7 GB a year per computer for a busy branch
    (300 bills a day), and roughly 0.5 to 1 GB a year per branch in Turso.
  - It is not trimmed, because a computer joining over the shop network replays it.
  - Trimming needs a snapshot-based join first.
  - The Turso free plan's storage limit will be reached after some time with several branches.
- **Not tested live:**
  - Cloudflare Workers (the free-plan CPU fit is from local measurement) and Turso itself (the adapter is tested
    against a stand-in that follows Turso's HTTP API)
  - several physical computers on a real shop network, the installer's firewall rules, UDP broadcast on networks
    that block it
  - auto-update end to end (needs a repository and two releases)
  - real printers, cash drawer, barcode scanners and customer display
- **Cloudflare free plan:** 100,000 requests a day, about 10 to 15 branches at a 30-second sync interval. The
  interval can be raised if needed.
- **Code signing:** the installer is unsigned until a certificate is bought.
- **Not built (by decision):** FBR POS, WhatsApp, SMS, e-commerce (the data model does not block them).

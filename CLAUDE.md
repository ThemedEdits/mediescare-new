# Mediescare - project memory

Offline-first pharmacy POS and management desktop software for a multi-branch pharmacy chain (one Head Office, many
branches). The full original brief is `PHARMACY-SOFTWARE-PROMPT.md` - it is the requirements source and nothing in it
may be skipped. This file records the decisions taken on top of it, the architecture, and the phase status.
Keep this file up to date whenever a decision or phase status changes.

## Working rules

- Work in phases (below). Finish, test and report each phase before starting the next.
- Test business rules with backend tests (`npm test`) and drive real screens headless (`npm run test:ui`).
  Never claim something works because it compiles. Report what was NOT tested.
- Correctness over speed: money, stock and expiry.
- No emojis anywhere (UI, messages, code comments). Outline icons only (`src/renderer/js/ui/icons.js`).
- Never show raw technical/database errors to users. Use `AppError` with a business-language message.
- Do not commit, push or release unless the user asks.
- The shell this project is developed in has `ELECTRON_RUN_AS_NODE=1` set (VS Code). `npm start` and the UI tests
  unset it; backend tests use it on purpose (they run Electron's Node so the native module ABI matches).

## Decisions (answers from the owner, 2026-10-15)

| Topic | Decision |
|---|---|
| Product name | **Mediescare**. Logo files in `mediescare-icons/` (blue `#3da6dd`, green `#8fc33e`). |
| Currency/locale | Pakistan, PKR default. Symbol, display decimals, date format, tax all configurable. English UI, all strings in one place per process so Urdu can be added. |
| Cloud | Turso (libSQL), **one database for all branches**, `branch_id` on every business row. |
| Cloud token | **Thin API gateway** (Cloudflare Worker style) in front of Turso. Must stay on the **free** Cloudflare plan (owner, 2026-10-18), so every gateway request is light. The real Turso token lives only on the gateway. Each registered device gets its own device token; the gateway only lets it push/pull its own branch's operations plus shared data (Head Office super admin devices may pull all branches). A stolen app copy without a device token can do nothing; a stolen device token can be revoked. |
| LAN | **Primary PC + Client PCs.** A one-PC branch is just a Primary with the LAN service off. |
| Joining a PC | (Changed 2026-10-18 so the gateway fits the Cloudflare free plan.) A branch's main computer: organisation code + a one-time **join code** made at Head Office (24 h, used once); the manager's login is then checked on the new computer. A lost Head Office computer: organisation code + the **organisation recovery key** shown once at setup. LAN clients: 6-digit pairing code on the Primary + manager login. Admin can revoke a device. |
| Pricing | **Per batch MRP + trade price.** Product holds default prices; each batch has its own purchase price and MRP. **Branch price override** is optional (permission-controlled). |
| Costing | **Batch cost** - the cost of a sold unit is the purchase cost of the batch it came from (FEFO picks batches). Used for both stock value and COGS. |
| Tax | **Tax-inclusive** prices, **rate per product** (most medicines 0%). Receipt shows tax breakup. No FBR integration now, but the sale document model must not block it later. |
| Branch purchasing | Branches may buy from suppliers only with the permission `purchases.direct_branch`. Head Office to branch transfers: request (optional) -> approve -> dispatch -> in transit -> receive, with discrepancy handling. |
| Scale | Small: 2-10 branches, 1-4 PCs per branch, ~10k products, ~300 bills/day. Performance tests still use the brief's 50k products / 500k movements. |
| Existing data | Fresh start. A generic CSV/JSON legacy migration script is still built (Phase 5). |
| Hardware | Generic: Windows-installed thermal printers 58/80 mm (ESC/POS via the printer driver), A4, keyboard-wedge USB barcode scanners, cash drawer kicked through the receipt printer. Customer display optional. |
| Roles shipped | Super Admin, Branch Admin, Pharmacist, Cashier, Store Keeper, Accountant (defaults in `src/main/core/permissions.js`). |
| Regulation fields | Patient name, CNIC, phone, address; doctor name, PMDC number, clinic; prescription number/date and optional photo; controlled drug register with running balance per drug and branch. DRAP registration number on the product. Prescription records kept at least 5 years (never auto-deleted). |
| Later (do not block) | WhatsApp bill sharing, SMS reminders, e-commerce orders, FBR POS. |

## Architecture

```
src/main/            Electron main process. Owns the database, sessions and every permission check.
  main.js            Bootstrap: single instance lock, app:// protocol, window, IPC.
  rpc.js             The single RPC router. Every method declares auth + permission; checked here.
  db/                Connection (WAL, foreign keys), migrations, sync trigger generator.
  core/              ids, money, errors (AppError + friendly mapping), messages (all main-process strings),
                     permissions catalogue + default roles, audit, document numbers, session.
  services/          One file per module (setup, auth, users, roles, branches, settings, audit, ...).
src/preload/         contextBridge: exposes only window.mediescare.call(method, params) and a few events.
src/renderer/        Plain JS ES modules served from app://, no framework.
  js/strings/en.js   All UI strings.
  js/ui/             UI kit: icons, dom helpers, table, modal, combobox, toast, forms.
  js/pages/          One module per screen.
test/                Backend tests (node:test, run inside Electron-as-Node).
scripts/             Test runner, UI smoke driver, native module fetch.
```

- **Renderer has no Node and no DB.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP.
  One IPC channel (`rpc`). Unknown methods are rejected.
- **Every RPC method** is registered with `{ auth: 'none' | 'session', perm: 'x.y' | [..] | null, branchScoped }`.
  The router checks the session and permission before calling the service. Services also receive `ctx` (user,
  role, active branch, `ctx.can(perm)`) and must use `ctx.branchId` for branch scoping and strip cost/profit fields
  when `!ctx.can('cost.view')`.
- **Sessions** live in the main process only (one signed-in user per app window). Inactivity auto-logout is enforced
  in main (last-activity timestamp updated by any RPC or by `auth.ping` from user input).
- **Passwords:** scrypt (N=16384, r=8, p=1, 16-byte salt, 64-byte key), stored as `scrypt$N$r$p$salt$hash`.
  Lockout after N failures (setting, default 5) for M minutes (default 15). Temporary passwords force a change.
- **IDs:** every synced row uses a 26-character time-ordered random id (ULID style) generated in JS, so rows created
  offline on different PCs never collide.
- **Money:** stored as INTEGER minor units (paisa, scale 100, fixed at organisation creation). Display decimals are a
  setting. Rounding happens at line level with round-half-up on integers; document totals are the sum of rounded
  lines, so lines always add up to the document total. No floating-point money arithmetic.
- **Quantities:** stored as INTEGER in the product's base unit (tablet / capsule / ml / piece). Box and strip are
  conversions defined per product.
- **Timestamps:** ISO-8601 UTC with milliseconds (`2026-10-15T09:12:33.120Z`). Display uses the date format setting.
- **Never delete documents.** Financial and stock documents are cancelled/reversed with a linked record. Synced
  tables have a BEFORE DELETE trigger that refuses hard deletes; master data uses `deleted_at` / `active`.
- **Append-only tables** (`audit_log`, and from Phase 1 `stock_ledger`, sale lines, payments, price history) have
  triggers that refuse UPDATE and DELETE.
- **Audit log** row: at, user, branch, device, module, action, record type, record id, old value, new value (JSON),
  reason. Written in the same transaction as the change it describes.
- **Friendly errors:** services throw `AppError(code, message, details)`. Anything else is logged to
  `userData/logs/main.log` and the user sees a generic "nothing was saved, please try again" message.
- **Migrations:** `src/main/db/migrations/NNN_name.js`, applied in order inside a transaction, recorded in
  `schema_migrations`. A `VACUUM INTO` safety copy is taken in `userData/backups/` before any pending migration
  runs. After migrations, sync triggers are regenerated from the table registry.
- **Document numbers:** `PREFIX-<BRANCHCODE><DEVICENO>-<seq>` e.g. `INV-LHR2-0001`. Sequence is local per device
  (table `doc_sequences`, never synced), so offline PCs never collide.

## Sync design (designed in Phase 0, implemented in Phase 3)

### Topology
```
 [Client PC] --LAN (HTTP+WS, device token)--> [Primary PC] --HTTPS (device token)--> [Gateway] --> [Turso]
 [Client PC] ----------------------------------^                                            ^
 [Other branch Primary] -------------------------------------------------------------------'
```
- Each PC holds a full local replica of the data it is allowed to see and works with no network at all.
- The **Primary PC** runs an embedded LAN service (HTTP + WebSocket on a fixed port, discoverable via mDNS,
  or the IP is typed manually). Clients pair once with a 6-digit code + admin login; the Primary issues a device token.
- Only the Primary talks to the cloud gateway. If the Primary is off, clients keep working locally and catch up when
  it returns. (Considered: any PC relays to the cloud. Rejected for now: more moving parts and duplicate-push races
  for very little gain at 1-4 PCs per branch. The protocol does not prevent adding it later because every operation
  is idempotent.)

### Operation log
- Table registry (`src/main/db/sync-registry.js`) lists every synced table with: scope (`global` shared master data
  or `branch` data carrying `branch_id`), and merge mode (`lww` editable rows, or `append` write-once rows).
- Triggers generated from the registry write every INSERT/UPDATE into `sync_ops`
  (`seq` local autoincrement, `op_id` globally unique, table, row id, kind, branch_id, full row JSON, `updated_at`,
  origin device). Triggers are silent while `sync_ctx.applying = 1` (that is how remote ops are applied without
  echoing). Hard deletes are refused; deletion is a soft-delete update.
- `sync_ops` holds the union of local and received operations, so the Primary relays client ops to the cloud and
  cloud ops to clients with the same code path.
- **Push** to a peer: ops with `seq > cursor(peer, push)`, in order, in batches; the receiver does
  `INSERT OR IGNORE` by `op_id`, applies the new ones in the same transaction, then acknowledges; only then the
  sender advances its cursor. A crash anywhere means the batch is resent and ignored as duplicates.
- **Pull** from a peer: ops after `cursor(peer, pull)` (the peer's own seq), applied the same way.
- **Merge:** `append` tables -> `INSERT OR IGNORE` (never overwritten). `lww` tables -> apply if the incoming
  `updated_at` is newer than the local row's, ties broken by the larger `op_id`. Applying the same op twice changes
  nothing. Soft deletes are ordinary updates.
- **Branch scoping:** the gateway and the Primary only hand a device ops whose `branch_id` is its branch or null
  (global). Devices of users with `branches.view_all` (Head Office) may pull all branches.
- **Overselling the last unit on two PCs:** allowed (the counter must never stop). When ops merge and a batch goes
  negative, the batch is flagged and a notification is raised; the ledger stays correct because every sale is a
  ledger row, and the fix is a normal stock adjustment or batch correction.
- **Clocks:** LWW uses wall-clock `updated_at`. A PC whose clock differs from the Primary by more than 2 minutes gets
  a warning on the sync screen (Phase 3).
- **Sync screen:** LAN and cloud shown separately - state (offline/syncing/synced/error), last success, pending
  count, Sync now, and a full log (`sync_log`: time, channel, direction, counts, errors).

### Backups (Phase 3)
Automatic local backups (`VACUUM INTO`, rotated) to `userData/backups`, optional second copy to a chosen
USB/external folder, one-click restore that first takes a safety copy. Backup files are protected by OS file
permissions of the user profile; optional encryption with a key held in `safeStorage` is planned in Phase 3.

## Phases and status

| Phase | Scope | Status |
|---|---|---|
| 0 Foundation | CLAUDE.md, schema, migrations, auth, roles/permissions, RPC, audit, settings, first-run wizard, branches, top bar, profile, UI kit | done 2026-10-15 (24 backend tests, 13-step UI test) |
| 1 Core pharmacy | drug master, batches, stock ledger, expiry, suppliers, PO/GRN, stock ops, import/export, transfers | done 2026-10-15 (44 backend tests, 21-step UI test) |
| 2 POS | FEFO, units, holds, returns, shifts, receipts/labels, sales history, customers/credit, Rx + controlled register | done 2026-10-16 (57 backend tests, 25-step UI test) |
| 3 Sync | LAN + cloud gateway + Turso, scoping, conflict rules, sync screen/log, backups/restore, join existing branch | done 2026-10-16 except a live Turso / gateway deployment (66 backend tests, 27-step UI test) |
| 4 Finance & insight | financial pages, reports, dashboards, all-branch view, approvals, notifications, global search, shortcuts | done 2026-10-16 (70 backend tests, 36-step UI test) |
| 5 Hardening | regression, role tests, performance, installer, auto-update, docs, legacy migration script | done 2026-10-16 (76 backend tests, 37-step UI test, perf 35/35 within limits, installer built and the packaged app started) |


## Phase 1 decisions (inventory and purchasing)

- **Units and prices:** quantities are integer base units (tablet, ml). Each product has a pack (pack_size base units).
  Prices and costs are integer paisa **per pack**; the price of N base units is round_half_up(price * N / pack_size).
  pack_size is locked once a product has stock movements.
- **Batches** are created per goods receipt line (or opening stock) and are shared rows: transfers move the same
  batch row between branches; each branch's quantity comes from the stock ledger. Batch cost = landed cost per pack =
  (line net - share of bill discount + share of freight) spread over paid + bonus units. Shares use largest-remainder
  allocation so they add up exactly. Batch cost is stored in whole paisa per pack, so stock value can differ from the
  bill by a few paisa (for example 1,124.75 vs 1,125.00). Accepted and documented; cost is never edited afterwards.
- **Stock ledger** (stock_ledger, append-only) is the only place stock changes, via core/stock.post(), which refuses to
  go below zero (Phase 2 sales may allow it by policy). stock_balances is a local cache maintained by a trigger and
  rebuildable (stock.rebuildBalances); stock.checkBalances must always return nothing.
- **Business dates** (received on, returned on) are local calendar dates; ledger timestamps use stock.atOnDate().
- **Document numbers** use this computer's own branch code and number (PO-HO1-0001), even when an administrator
  creates a document for another branch, so two computers never produce the same number.
- **GRN** may be saved as draft, then posted. Posting checks: not expired, no duplicate supplier invoice, not more than
  is open on the purchase order. The latest purchase becomes the product's default MRP and trade price (price
  history kept). Cancelling a posted GRN is only allowed while all its stock is untouched and nothing is paid on it.
- **Supplier account** = supplier_ledger (append-only, per branch): credit = we owe, debit = paid or returned.
  Ageing uses open bills (GRN total minus allocated payments); unallocated credits shown separately so
  buckets - credits = balance.
- **Adjustments** above the branch setting stock.adjustApprovalValue (Rs) wait for someone with stock.approve; nobody
  approves their own. Expired write-off only for expired batches.
- **Stock take** posts counted - system (system = quantity when the count started); sales and receipts during the
  count stay. Uncounted lines are not changed.
- **Transfers:** request (needs approval when transfers.requireApproval) -> approve (sender) -> dispatch (sender,
  FEFO by default, never expired or quarantined) -> receive (receiver, shortage needs a reason) -> resolve shortage
  (sender: returned to stock, or written off). In transit belongs to no branch. Rows sync to both branches
  (sync_ops.branch_id2).
- **Branch purchasing:** only Head Office, or roles with purchases.direct_branch.
- **Cost visibility:** without cost.view, cost/trade/value fields are null in every response and export; screens that
  need cost (GRN, PO, returns, payments, valuation) are refused.
- **Export:** export.run re-uses the list method the screen calls (same permission, branch scope and hidden fields)
  and writes CSV, XLSX, XLS, PDF, TXT, JSON or XML with organisation, report, branch, filters, time and user.
  PDF is rendered by a hidden Electron window (main.js renderPdf).
- **Import:** products, suppliers, opening stock from CSV, TXT, XLSX, XLS, JSON or XML; template download; column
  mapping with suggestions; preview with row-level errors; duplicates skip / update / error; commit is one transaction
  and refuses if any row has an error. XLSX/XLS uses SheetJS 0.20.3 installed from cdn.sheetjs.com (the npm xlsx
  package is outdated).
- **Labels:** Code 128 SVG (core/barcode.js), sizes 38x25, 50x25, 50x30 mm, print via the Windows print dialog or PDF.

## Phase 2 decisions (point of sale)

- **Prices** come from core/pricing.js only: pack price = branch price if set, else the batch MRP; unit price = the
  unit's fixed price if set, else pack price * factor / pack size; a line's gross is rounded once on the base quantity.
  The screen shows quotes (pos.quote); pos.complete re-checks every line, batch, price and stock before writing.
- **A sale line is one batch.** FEFO picks batches (never expired or quarantined); a quantity bigger than the first batch
  becomes several lines. The cashier can choose another batch. Near-expiry batches are flagged at the counter.
- **Discounts:** line % plus a bill discount (% or amount) spread over lines with largest-remainder allocation, so lines
  always add up to the bill. Above max(branch pos.maxDiscountPercent, customer usual discount) needs
  discount.above_limit or a manager approval. A typed price needs price.override or approval.
- **Manager approval at the counter:** pos.approve checks the manager's own login and rights and returns a token valid
  5 minutes, for this cashier only, used once; the approver is stored on the sale or return and audited. Nobody
  approves their own request.
- **Tax** is inside the price: line tax = net * rate / (100 + rate).
- **Payments:** cash, card, Easypaisa, JazzCash, bank, mixed. Wallet and bank payments need a transaction number. Card
  and wallets cannot exceed the bill; only cash gives change. Only the cash applied is recorded as paid; change is
  stored separately and is never revenue. The unpaid rest is credit: only for a chosen customer with a credit limit,
  within the limit, with sales.credit (or approval). Walk-in customers always pay in full.
- **Customers** are shared by all branches; what they owe is per branch (customer_ledger, append-only). Payments
  received later go to the oldest unpaid bills (receipt_allocations); their date can be changed with
  payments.edit_date and a logged reason.
- **Shifts:** one open shift per computer. Selling needs your own open shift (setting pos.requireShift). Refunds (void,
  return, cancelled receipt) leave the drawer of this computer, whoever's shift it is. Expected cash = opening + cash
  sales + cash receipts - cash refunds + cash in - cash out. Closing with a difference needs a note. X report = open
  shift, Z report = closed shift; both are worked out from the records, never stored totals.
- **Void** cancels a whole bill (stock back as SALE_RETURN, refunds recorded, customer account reversed) and is refused
  once the bill has a return or a later payment. **Returns** are against the original lines; money and cost go back
  cumulatively so a full return gives back exactly what was paid. What the customer still owes on that bill is reduced
  first; only the rest is paid back. Conditions: restock; damaged or expired (comes back, then goes out as DAMAGED or
  EXPIRED, both rows visible); quarantine (comes back and the whole batch is quarantined at the branch). Returns above
  pos.returnApprovalValue need sales.void or approval.
- **Prescriptions:** a bill with a prescription-only item needs patient and doctor names; a controlled drug also needs
  patient CNIC, doctor PMDC number and prescription number. Optional photo (under 1 MB). Never deleted.
- **Controlled drug register** is built from the stock ledger joined to prescriptions, with a running balance per drug
  per branch, so it can never disagree with stock.
- **Holds** are local to this computer (held_bills, not synced) and are checked again in full when finished.
- **Receipts:** HTML for 58 mm, 80 mm or A4 (core/receipt.js): branch details and licence, bill, cashier, customer,
  patient, lines with batch and expiry, discounts, tax, payments, change or balance, footer, Code 128 barcode of the
  bill number. Printed through the Windows print dialog, or silently to the chosen printer (per-computer settings in
  local_state device_settings). Reprints need sales.reprint, are marked COPY and audited. PDF save available. Medicine
  labels (50 x 30 mm) with dosage instructions per line. The in-app receipt preview uses a shadow root (no iframe).
- **Cash drawer:** opened by the printer driver setting "open drawer on print"; the Electron print path cannot send raw
  ESC/POS bytes. **Customer display:** a second window on the second screen, fed by display.update.
- **POS shortcuts** (F2 search, F3 customer, F4 quantity, F6 bill discount, F8 hold, F9 held bills, F10 pay, Delete
  remove line, Ctrl+N new bill, Ctrl+P reprint last) are defined once in pages/pos.js (POS_KEYS) for Phase 4 rebinding.

## Phase 3 decisions (sync and backups)

- **Code layout:** src/main/sync/ (apply.js merge rules, ops.js log and cursors, peer.js HTTP client, lan-server.js the
  Primary's service and UDP discovery, engine.js background loops, join.js first-run join), src/main/backup.js,
  gateway/ (cloud gateway: Cloudflare Worker or Node server; Turso or SQLite adapter; see gateway/README.md).
- **One protocol** for LAN and cloud: POST /v1/push {ops}, GET /v1/pull?after=N, bearer device token. Push first, then
  pull; cursors move only after the other side answered, so a crash repeats a batch that is then ignored by op_id.
  sync_ops.source records which peer an op came from so it is not sent straight back.
- **Merge** (apply.js): append tables INSERT OR IGNORE; lww tables newer updated_at wins, tie by larger op_id; columns
  unknown to this version are dropped (the op stays in sync_ops); unknown tables are kept for after an update.
  Foreign keys are deferred per batch; a batch that still has a missing reference is applied without reference checks
  and recorded as a conflict rather than blocking sync for ever.
- **Unique clashes** made offline on two computers are settled the same way everywhere without talking: the row with the
  larger id is renamed (username "ali" -> "ali-ZZZZ", codes and names likewise), barcodes are switched off, and rows
  that are the same logical record (settings, product_branch, batch_status, stock take lines) merge into the existing
  id. Each case is written to sync_conflicts and shown on the Sync screen.
- **Overselling** after a merge is allowed; a batch below zero is recorded as a negative_stock conflict and listed under
  Batches -> "Below zero".
- **LAN:** the Primary runs an HTTP service (port 47800, MEDIESCARE_LAN_PORT) and answers UDP broadcasts "MEDIESCARE?"
  on 47801 (used instead of mDNS: same result, no extra library). Counters poll every 4 s. Pairing = 6-digit code
  (10 minutes, one use, 5 wrong tries block for 10 minutes) + login of someone with devices.edit; only the Primary
  hands out computer numbers of its branch, so document numbers never clash. Token hashes in lan_tokens; a revoked
  device is refused at once.
- **Cloud:** only the Primary talks to the gateway (every 30 s, and 0.5 s after a counter sends sales). The Head Office
  Primary registers the organisation automatically when the build has a cloud address (config.js /
  MEDIESCARE_CLOUD_URL). A branch's main computer joins with the organisation code + a manager's login (checked by the
  gateway against the synced users and roles); extra computers join over LAN. Gateway scope: branch devices push and pull
  only their branch (branch_id or branch_id2) plus shared rows; Head Office devices everything. The gateway keeps the
  whole op log per organisation (the off-site copy) and never stores plain tokens.
- **Backups:** daily automatic (checked every 30 minutes, last 14 kept), manual, a safety copy before every restore,
  optional second copy to a chosen folder, optional AES-256-GCM encryption with a key protected by Windows
  (safeStorage); encrypted backups restore only on the same computer and Windows user (documented on screen; the cloud
  copy is the way to rebuild a lost computer). Restore checks the file is a backup of this organisation, then the app
  restarts.
- **Clock check:** each answer carries serverTime; more than 2 minutes difference shows a warning.

## Phase 4 decisions (finance and insight)

- **Migration 005_insight:** expense_categories (global, 10 defaults with fixed ids), expenses (branch, lww), petty_cash (branch,
  append-only; balance = SUM(amount)), approval_requests (branch, lww), notification_reads (local), cash_movements.ref_type/ref_id.
- **Expenses** (services/expenses.js): paid from drawer (a cash movement of this computer's open shift, ref_type 'expense', so
  the shift expected cash is right), petty box, bank (reference needed), card, online. Above expenses.approvalValue (Rs, branch
  setting) without expenses.approve: bank/card/online/petty wait in the approval queue (money moves on approval); drawer cannot
  wait, so the screen asks a manager at once. Never deleted: cancel puts the money back (drawer of this computer, or a petty entry).
  Petty top-up/withdraw optionally through the drawer (cash movement ref_type 'petty').
- **Financial journal** (services/finance.js): one UNION over the documents, never stored totals. Columns: amount, money in,
  money out, receivable change, payable change, stock value change. Drawer/petty moves and expense cash movements are not
  counted twice. Write-off and adjustment rows need cost.view. Day = local date (date(at,'localtime') for timestamps).
- **Reports** (services/reports.js): one RPC reports.run {report, filters} -> {columns, rows, totals, notes, chart}; catalogue in
  REPORTS with the filters each accepts and whether it is financial (reports.financial) or needs cost.view. Print and export
  re-use the same rows (export.run / export.print with source reports.run). Cancelled bills are not counted; returns count on
  their own day. Reconciliation: opening + movements by type = expected closing, compared with on-hand (stock_balances when the
  period ends today); differences and stock-take corrections are highlighted. Management summary compares with the previous
  period of the same length.
- **Dashboards:** dashboard.branch (today split cash/card/online/credit, collections, returns, expenses, profit with cost.view;
  low stock, near expiry, expired, receivables, payables, pending approvals; 30-day trend, top products, category share folded
  to 7, sales vs purchases 6 months). Every tile opens the records behind it. dashboard.allBranches needs branches.view_all.
- **Charts** (renderer ui/charts.js): inline SVG, tokens --chart-1/--chart-2 (light #1a78ad/#eb6834, dark #3987e5/#d95926,
  validated for contrast and colour blindness), hover tooltips, legend for 2 series, a Table switch on every chart card.
- **Approvals** (services/approvals.js): one queue of counter requests, pending expenses, pending adjustments and expired
  write-offs, and transfer requests. Counter requests: the cashier sends needs (discount.above_limit, price.override,
  sales.credit, sales.void, expenses.approve) from the approval dialog; a manager with approvals.approve and every needed right
  decides on any computer; the requester's dialog polls and gets token "req:<id>", usable once by that person within
  approvals.validMinutes. consumeApproval marks it used in the same transaction. Nobody decides their own request.
  Bill cancellation now also works by approval (sales.void RPC allows pos.create; the service requires sales.void or approval).
- **Notifications** (services/notifications.js): derived when asked (low/out of stock, near expiry, expired, below zero,
  customer bills overdue after customers.creditDays, supplier bills past due, approvals waiting, transfers to receive / to send /
  shortages, sync errors, conflicts, clock, backup failed or older than 2 days), each permission-aware. A signature per item;
  the bell counts items whose signature this person has not seen; opening the list marks them seen.
- **Global search** (search.global): products (barcode exact), batches, bills, customers, suppliers, POs and GRNs, transfers,
  supplier payments, customer receipts, expenses, adjustments, users, branches; branch-scoped unless branches.view_all. An exact
  barcode or document number + Enter opens the record. Pages, actions and reports are listed by the renderer.
- **Shortcuts:** catalogue in core/shortcuts.js (global + counter actions with defaults); users.prefs.shortcuts holds only
  changed keys; every key must be unique (the counter also hears global keys); plain letters need Ctrl or Alt. shortcuts.others
  edits other users. The counter (POS_KEYS) and the shell use renderer keys.js.

## Phase 5 decisions (hardening)

- **Role tests** (test/roles.test.js): every RPC method with a permission is called by every default role; a role without
  the permission must get "no permission" before the service runs, a role with it must never get it. Plus: cost and
  profit absent for roles without cost.view (lists, bill, batches, dashboard, export), other branches refused.
- **Performance** (`npm run test:perf`, scripts/perf.js): 50,000 products, 100,000 batches, 500,000 stock movements,
  100,000 bills over 330 days with sync triggers on; the screens' own RPC calls are timed against limits (counter 150 ms,
  screens 1 s, reports 4 s). Fixes from it: migration 006 (covering indexes for the stock check and reconciliation, and
  branch/date indexes), batches totals from a lean query, financial journal filters each part by date (UTC bounds of
  local days, finance.localStart), reconciliation compares timestamps instead of date().
- **Data size:** a busy branch (300 bills a day) makes about 1.7 GB a year per computer, most of it the sync operation
  log (sync_ops keeps a full copy of every row written). It is not trimmed: a computer joining over the shop network
  replays it from the start. Trimming needs a snapshot join first (open item).
- **Backups** are now gzip files written by a worker thread (backup-worker.js -> backup-copy.js; on the main thread if a
  worker cannot start), so the counter keeps working and nothing large is held in memory. Encrypted format MEDIBK2 =
  "MEDIBK2" + IV + AES-256-GCM(gzip) + tag, streamed. Restore reads plain .db, .db.gz, MEDIBK1 (older) and MEDIBK2.
  backup.create / restore / autoIfDue are async; one backup runs at a time.
- **Installer** (electron-builder, package.json "build"): NSIS, x64, assisted installer that lets the person choose
  "just me" or "all users", desktop and Start menu shortcuts, data kept on uninstall. build/installer.nsh adds Windows
  Firewall rules for TCP 47800 and UDP 47801 (private and domain networks) when installing for all users. Icons
  build/icon.png and build/icon.ico are drawn from mediescare-icons/mediescare-icon.svg (`npm run icon`). better-sqlite3 is
  unpacked from the asar; npmRebuild is off (the prebuilt Electron binary is used).
- **Build settings:** scripts/release.js writes src/main/build-config.json (cloud gateway address and setup key from
  MEDIESCARE_CLOUD_URL / MEDIESCARE_CLOUD_SETUP_KEY) before building and blanks it afterwards; config.js reads it.
  `npm run dist` builds only; `npm run release` also publishes the GitHub Release (needs GH_TOKEN and the
  cloud settings). Never run release unless the owner asks.
- **Auto-update** (src/main/updater.js, electron-updater 6.6.2): only in an installed copy built with a GitHub
  repository (app-update.yml present); otherwise "not set up". Checks 30 s after start and every 6 hours, downloads in
  the background, installs on "Restart and update" (Help and updates page, settings.edit; a safety backup first) or
  when the app closes. Pending migrations then run with their own safety copy.
- **Installer checked:** `npm run dist` builds dist/Mediescare-Setup-0.1.0.exe (85 MB); the packaged app starts, opens its
  database (better-sqlite3 from app.asar.unpacked) and runs all migrations; the backup worker thread runs inside the package.
- **Docs:** docs/admin-guide.md, docs/cashier-quick-start.md, docs/legacy-migration.md; shown in the app on the Help and
  updates page (help.guide reads docs/*.md, which the installer includes).
- **Legacy migration** (`npm run migrate -- <folder> [--out <data folder>]`, scripts/migrate-legacy.js): creates the Head
  Office from organisation.json, then imports products, suppliers, customers (new import kind, with opening balance),
  opening stock through the Import screen's own rules; a file with any wrong row is not imported. Sample in
  docs/legacy-sample/; test/migration.test.js runs it.
- **End-to-end test** (test/endtoend.test.js): the brief's definition of done (Head Office receives by batch, FEFO
  transfer, branch main computer and counter offline all day with different roles, return and expense, sync in the
  evening, Head Office reports, journal, all-branches and reconciliation agree, ledgers identical on every computer).

## Join codes and the free gateway (2026-10-18)

- The owner wants everything free. The Workers free plan allows about 10 ms CPU per request; the old join checked a
  manager's password with scrypt in the gateway (59 ms measured), so join was redesigned. Pushes and pulls were
  already light (200 ops about 1 ms).
- **Join code** (migration 007, table join_codes, synced branch/lww, core/joincodes.js): devices.createJoinCode
  (devices.edit, branch access), 12 characters without O/0/I/1, shown once, 24 hours, used once, cancellable
  (devices.cancelJoinCode), listed on the Computers page. Only the SHA-256 of the normalised code is stored; making one
  starts a sync so it reaches the gateway at once.
- **Recovery key:** 20 characters, made at setup.createHeadOffice (returned once as me.recoveryKey, shown on a setup
  screen that needs a tick before continuing); hash in org.recovery_hash (synced). Only the owner (isSuper) can make a
  new one (org.newRecoveryKey). Joining with it makes a Head Office computer.
- **Gateway /v1/join**: compares hashes only; join_uses (claimed with a primary-key insert before the token, so two
  computers cannot use one code) and join_fails (20 wrong per organisation per hour, then 429). The scrypt check was
  removed from the gateway.
- **setup.joinExisting** (primary): checks the cloud is configured, then the code format, joins, then checks the
  manager's login locally (active, same branch as the code, devices.edit or super). A wrong login leaves the computer
  joined but signs nobody in (JOINED_SIGN_IN; the screen offers "Go to sign in").
- **Batches:** gateway MAX_PUSH/MAX_PULL 300; app PUSH_BATCH 250, PULL_BATCH 300. Both servers answer "handled" and the
  app moves its push cursor only that far, so a smaller limit never loses operations (test/join.test.js pushes 700).
- **Manuals:** docs/USER-MANUAL.md (every screen, for staff; also on the Help page with working contents links) and
  docs/SYSTEM-MANUAL.md (stack, hosting, database, data model, sync, gateway, security, config, build, tests,
  performance, runbook, operations, extending, risks).

## Release and updates (2026-10-22)

- Owner's cloud is live: gateway https://mediescare-gateway.mediescare.workers.dev (Cloudflare Workers free) in front of
  Turso. The setup key is given to builds through MEDIESCARE_CLOUD_SETUP_KEY (never committed).
- Releases live in https://github.com/ThemedEdits/mediescare-new (public). Version 1.0.0 is the first release.
- release.js publishes releaseType "release" (drafts are invisible to installed copies) and refuses to publish without
  the cloud URL and setup key. package.json build.publish is the single publisher (github ThemedEdits/mediescare-new, releaseType release); passing extra -c.publish flags once created two publishers and a half-uploaded release. release.js always blanks build-config.json, even on failure.
- Updates: updater.js checks every hour, silent install on Restart and update (quitAndInstall(true, true)), an Update
  chip in the top bar (shell.js refreshUpdate, polled with the bell every 60 s).
- `npm run ship` (scripts/ship.js): clean tree required, backend tests, npm version, push with the tag.
  .github/workflows/release.yml builds and publishes on tag v*; it needs repository secrets MEDIESCARE_CLOUD_URL and
  MEDIESCARE_CLOUD_SETUP_KEY (only an admin of the repository can add them) and skips a tag that is already published.
- Docs added: README.md, docs/INSTALL.md (end users), docs/RELEASING.md, docs/TESTING-CHECKLIST.md (multi-PC test).

## Open items carried forward

- **Needs the owner:** Turso URL and token (run `npm run gateway:check`), a place to run the gateway (Cloudflare
  account or a Node server), then the gateway address built into the app (MEDIESCARE_CLOUD_URL). Until then cloud
  sync shows "Not set up"; LAN sync and backups work without it.
- Not tested for real: Turso itself (the adapter is tested against a stand-in that follows Turso's HTTP API), the
  Cloudflare runtime (scrypt through nodejs_compat), several physical computers on a real shop network, Windows
  the installer's firewall rules on a real Windows install, UDP broadcast on networks that block it.
- The sync operation log is never trimmed (about 1.7 GB a year per computer for a busy branch). Trimming needs a
  snapshot-based join for new computers first.
- Cloudflare free-plan fit is from local CPU measurement; check Workers metrics (CPU time) after the first real sync.
  Free plan: 100,000 requests a day (about 10-15 branches at the 30 s interval).
- Auto-update: detection and download were checked against the real GitHub release (see the release report); the
  silent install was not run on this development computer. The installer is not code-signed (Windows SmartScreen will warn until a signing certificate is used).
- Not tested with real hardware: receipt and label printers, silent printing, the Windows print dialog, cash drawer,
  a second screen for the customer display, barcode scanners (keyboard-wedge Enter is simulated in tests only).
- FBR POS integration not built; sales carry fbr_invoice_no / fbr_status columns so it can be added later.
- Notifications are shown in the app only (no Windows toast, SMS or WhatsApp).
- Auto-logout default is 30 minutes; inactivity is enforced in main, the screen checks every 30 seconds.

## Commands

- `npm install` - installs deps and fetches the prebuilt better-sqlite3 binary for Electron (no C++ tools here).
- `npm start` - run the app. Data dir: Electron userData (`%APPDATA%/Mediescare`), override with `MEDIESCARE_DATA_DIR`.
- `npm test` - backend tests.
- `npm run test:ui` - headless UI smoke test (temp data dir, fails on any console error).
- `npm run test:perf` - performance test with 50k products / 500k movements (about 10 minutes; KEEP_DB=1 keeps the data).
- `npm run icon` - draws build/icon.png and build/icon.ico from the SVG logo.
- `npm run dist` - builds dist/Mediescare-Setup-<version>.exe (nothing uploaded). `npm run release` publishes; only on request.
- `npm run migrate -- <folder> --out <data folder>` - one-time legacy data migration.

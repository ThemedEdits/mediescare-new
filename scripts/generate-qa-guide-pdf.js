'use strict';
/**
 * Compiles the exact sequence of architecture, synchronization, and database Q&A
 * into a publication-quality PDF guide for sharing.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const htmlFile = path.join(root, 'docs', 'Mediescare-Architecture-and-Sync-Guide.html');
const pdfFile = path.join(root, 'docs', 'Mediescare-Architecture-and-Sync-Guide.pdf');

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Mediescare - Architecture, Synchronization & Database Flow Guide</title>
<style>
  @page {
    size: A4 portrait;
    margin: 16mm 14mm 16mm 14mm;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 9pt;
      color: #94a3b8;
    }
    @bottom-left {
      content: "Mediescare Architecture & Data Flow Guide";
      font-size: 9pt;
      color: #94a3b8;
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.6;
    font-size: 10.5pt;
    margin: 0;
    padding: 0;
  }
  .doc-header {
    border-bottom: 2px solid #1a78ad;
    padding-bottom: 18px;
    margin-bottom: 24px;
  }
  .badge-tag {
    display: inline-block;
    background: #e6f2f9;
    color: #1a78ad;
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border-radius: 9999px;
    margin-bottom: 10px;
  }
  h1.doc-title {
    font-size: 24pt;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 6px 0;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .doc-subtitle {
    font-size: 13pt;
    color: #64748b;
    margin: 0 0 14px 0;
    font-weight: 400;
  }
  .meta-box {
    display: flex;
    gap: 20px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 9pt;
    color: #475569;
  }
  .meta-box strong { color: #0f172a; }

  .chapter {
    margin-top: 28px;
    page-break-inside: avoid;
  }
  .chapter-header {
    background: #f1f5f9;
    border-left: 4px solid #1a78ad;
    padding: 10px 14px;
    margin-bottom: 14px;
    border-radius: 0 6px 6px 0;
  }
  .chapter-number {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    color: #1a78ad;
    letter-spacing: 0.05em;
    display: block;
  }
  .chapter-title {
    font-size: 15pt;
    font-weight: 700;
    color: #0f172a;
    margin: 2px 0 0 0;
  }
  .user-question-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 16px;
  }
  .user-question-title {
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    color: #15803d;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .user-question-text {
    font-size: 10.5pt;
    font-style: italic;
    color: #166534;
    margin: 0;
  }

  .answer-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px 18px;
    margin-bottom: 18px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }
  h3.answer-heading {
    font-size: 12pt;
    color: #1a78ad;
    margin-top: 0;
    margin-bottom: 10px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
  }
  p { margin: 0 0 10px 0; }
  ul, ol { margin: 0 0 12px 0; padding-left: 22px; }
  li { margin-bottom: 4px; }

  /* Diagram box */
  .diagram-box {
    background: #0f172a;
    color: #f8fafc;
    border-radius: 6px;
    padding: 14px 18px;
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 9pt;
    line-height: 1.5;
    margin: 14px 0;
    overflow-x: auto;
  }
  .diagram-box .accent { color: #38bdf8; font-weight: bold; }
  .diagram-box .green { color: #4ade80; }
  .diagram-box .amber { color: #fbbf24; }

  /* Tables */
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 9.5pt;
  }
  table.data-table th {
    background: #f1f5f9;
    color: #334155;
    font-weight: 700;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
  }
  table.data-table td {
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  table.data-table tr:nth-child(even) td {
    background: #f8fafc;
  }

  /* Code block */
  pre.sql-code {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 3px solid #1a78ad;
    border-radius: 4px;
    padding: 10px 14px;
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 9pt;
    color: #0f172a;
    overflow-x: auto;
    margin: 10px 0 14px 0;
    white-space: pre-wrap;
  }

  .callout-box {
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    font-size: 10pt;
    color: #1e40af;
    margin: 12px 0;
  }
  .callout-box strong { color: #1d4ed8; }

  .page-break {
    page-break-before: always;
  }
</style>
</head>
<body>

<!-- Header / Cover Top -->
<div class="doc-header">
  <span class="badge-tag">Official Architecture & Operations Reference</span>
  <h1 class="doc-title">Mediescare Pharmacy System</h1>
  <div class="doc-subtitle">Complete Architecture, Multi-Computer Offline Synchronization & Database Flow Guide</div>
  <div class="meta-box">
    <div><strong>Platform:</strong> Windows 10/11 Desktop (Electron + SQLite)</div>
    <div><strong>Cloud Infrastructure:</strong> Cloudflare Workers + Turso (libSQL)</div>
    <div><strong>Author:</strong> Mediescare Engineering Team</div>
    <div><strong>Release Version:</strong> 1.0.0 Production</div>
  </div>
</div>

<!-- ========================================== -->
<!-- CHAPTER 1: MULTI-COMPUTER OFFLINE SYNC -->
<!-- ========================================== -->
<div class="chapter">
  <div class="chapter-header">
    <span class="chapter-number">Chapter 1</span>
    <h2 class="chapter-title">Multi-Computer Branch Synchronization & Offline Operation</h2>
  </div>

  <div class="user-question-box">
    <div class="user-question-title">User Question / Scenario:</div>
    <p class="user-question-text">
      "If two computers are connected on a same branch, and when they are offline working without internet, how would the data sync between them? Would that need internet connection to sync in between those two? Or would that be done automatically to the main computer and then when network is back, the data from main computer to database is synced?"
    </p>
  </div>

  <div class="answer-card">
    <h3 class="answer-heading">1.1 Direct Answer & Offline Independence</h3>
    <p>
      <strong>No internet connection is required to sync data between two computers in the same branch.</strong>
    </p>
    <p>
      As long as both computers are connected to the same local shop Wi-Fi or Ethernet cable in your pharmacy (even if your external internet cable is completely disconnected or the ISP is down), <strong>they automatically sync directly with each other over the Local Area Network (LAN) every 4 seconds</strong>.
    </p>
    <p>
      When internet connectivity is restored later, the branch's <strong>Main Computer</strong> automatically uploads all accumulated offline transactions to the cloud database.
    </p>

    <div class="diagram-box">
<span class="accent">[Counter PC #2]</span> &lt;─── <span class="green">Local Shop Wi-Fi / LAN (Every 4 Seconds • No Internet Required)</span> ───&gt; <span class="accent">[Main PC of Branch]</span>
                                                                                          │
                                                                               <span class="amber">Internet Restored Later</span>
                                                                                          ▼
                                                                             <span class="accent">[Cloud Database & Head Office]</span>
    </div>

    <h3 class="answer-heading">1.2 Step-by-Step Breakdown: What Happens While Offline</h3>
    <ul>
      <li><strong>Local Embedded Sync Server:</strong> The <strong>Main Computer</strong> of the branch runs a lightweight built-in HTTP server on local port <code>47801</code>.</li>
      <li><strong>Automatic 4-Second Exchange:</strong> Every 4 seconds, <strong>Counter PC #2</strong> sends its newly created sales, payments, or customer records directly to the Main Computer over the local network, and pulls any stock changes made on the Main PC.</li>
      <li><strong>Shared Real-Time Stock Balance:</strong> If PC #1 sells 5 strips of medicine, PC #2's screen reflects the deducted stock within 4 seconds—<strong>without a single byte of internet traffic</strong>.</li>
      <li><strong>Decentralized Resilience:</strong> Every PC holds its own local SQLite database (<code>mediescare.db</code>). If counter staff type or scan barcodes quickly, the app never freezes or lags waiting for any remote network roundtrip.</li>
    </ul>

    <h3 class="answer-heading">1.3 What Happens When Internet Connection Returns</h3>
    <ol>
      <li>Only the <strong>Main PC</strong> connects to the cloud. Secondary counter computers never need cloud access; they talk only to the Main PC.</li>
      <li>While offline, the Main PC stores all transactions in an outgoing synchronization queue (<code>sync_ops</code>).</li>
      <li>The moment internet is restored:
        <ul>
          <li>The Main PC contacts the Cloud Gateway (<code>mediescare-gateway.mediescare.workers.dev</code>).</li>
          <li>It pushes all accumulated offline sales, shifts, payments, and stock adjustments in compressed batches (up to 250 operations per batch).</li>
          <li>It downloads any new products, price changes, or transfer dispatches sent from Head Office.</li>
          <li>The <strong>Cloud Sync Chip</strong> in the top bar turns from amber (<strong>Offline</strong>) to green (<strong>Synced</strong>).</li>
        </ul>
      </li>
    </ol>

    <h3 class="answer-heading">1.4 What If Even the Local Wi-Fi Router Fails? (Total Outage)</h3>
    <p>If the electricity cuts out the Wi-Fi router and both computers are completely isolated from each other:</p>
    <ul>
      <li><strong>Counters Never Stop:</strong> Both cashiers can continue billing and printing receipts simultaneously on battery/UPS.</li>
      <li><strong>Zero Document Number Clashes:</strong> Every bill number carries the unique device ID (e.g., <code>BL-HO-DEV01-00042</code> vs <code>BL-HO-DEV02-00019</code>). Bill numbers can never overwrite or duplicate.</li>
      <li><strong>Automatic Catch-Up:</strong> As soon as the local Wi-Fi router powers back on, the two PCs reconnect and automatically reconcile their backlogged queues.</li>
    </ul>

    <table class="data-table">
      <thead>
        <tr>
          <th>Operational Scenario</th>
          <th>Do Counter PCs Stay In Sync?</th>
          <th>Is Internet Needed?</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Normal Day (Internet active)</strong></td>
          <td>Yes, real-time live sync</td>
          <td>Yes (branch + cloud sync)</td>
        </tr>
        <tr>
          <td><strong>Internet Down (Local Wi-Fi working)</strong></td>
          <td><strong>Yes, automatic sync every 4 seconds</strong></td>
          <td><strong>No (LAN only)</strong></td>
        </tr>
        <tr>
          <td><strong>Total Outage (Internet and Wi-Fi down)</strong></td>
          <td>Both PCs bill independently; auto-merges as soon as Wi-Fi returns</td>
          <td><strong>No</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<div class="page-break"></div>

<!-- ========================================== -->
<!-- CHAPTER 2: LOCAL DATABASE STRUCTURE -->
<!-- ========================================== -->
<div class="chapter">
  <div class="chapter-header">
    <span class="chapter-number">Chapter 2</span>
    <h2 class="chapter-title">Local Database Structure, Tables & Search Methods</h2>
  </div>

  <div class="user-question-box">
    <div class="user-question-title">User Question / Scenario:</div>
    <p class="user-question-text">
      "Where does the actual data go in the database in which table? Like products, sales, audits, etc all these? Where does it actually go and how can we search any of it in the database?"
    </p>
  </div>

  <div class="answer-card">
    <h3 class="answer-heading">2.1 Physical Database Location on Windows</h3>
    <p>All application data is stored in a single, high-performance <strong>SQLite database file</strong> on the computer's local hard drive:</p>
    <pre class="sql-code">%APPDATA%\Mediescare\mediescare.db
(Full Windows Path: C:\Users\&lt;Username&gt;\AppData\Roaming\Mediescare\mediescare.db)</pre>

    <h3 class="answer-heading">2.2 Table-by-Table Data Mapping</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 25%;">Data Category</th>
          <th style="width: 28%;">Database Table(s)</th>
          <th>What Is Stored Here</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Products & Medicines</strong></td>
          <td><code>products</code></td>
          <td>Product brand name, generic formulation, category, manufacturer, pack size, prescription flag, and active status.</td>
        </tr>
        <tr>
          <td><strong>Packaging Units & Barcodes</strong></td>
          <td><code>product_units</code><br/><code>product_barcodes</code></td>
          <td>Packaging hierarchy conversions (1 Pack = 10 Strips = 100 Tablets) and scannable barcode mappings.</td>
        </tr>
        <tr>
          <td><strong>Batches & Expiry Dates</strong></td>
          <td><code>batches</code></td>
          <td>Manufacturer batch number, expiration date, purchase trade price, and printed MRP.</td>
        </tr>
        <tr>
          <td><strong>Stock Ledger</strong></td>
          <td><code>stock_ledger</code></td>
          <td>The immutable inventory ledger. Every purchase, sale, return, or adjustment writes a permanent row (tracked in base units / tablets).</td>
        </tr>
        <tr>
          <td><strong>Sales & Customer Invoices</strong></td>
          <td><code>sales</code></td>
          <td>Invoice number (<code>doc_no</code>), cashier ID, branch ID, customer ID, subtotal, discount, tax, net total, and payment status.</td>
        </tr>
        <tr>
          <td><strong>Sale Line Items</strong></td>
          <td><code>sale_lines</code></td>
          <td>Line-by-line items: product ID, batch ID, dispensing unit, quantity sold, unit price, line discount, and tax.</td>
        </tr>
        <tr>
          <td><strong>Sale Payments</strong></td>
          <td><code>sale_payments</code></td>
          <td>Payment tenders per bill: Cash, Card, Easypaisa, JazzCash, or Customer Credit with exact amounts.</td>
        </tr>
        <tr>
          <td><strong>Audit Log</strong></td>
          <td><code>audit_log</code></td>
          <td>Permanent record of <strong>who did what, when, and why</strong>. Stores action name, user name, old JSON state, new JSON state, and reason notes.</td>
        </tr>
        <tr>
          <td><strong>Cashier Shifts</strong></td>
          <td><code>shifts</code></td>
          <td>Shift start/close times, opening cash float, counted cash denomination breakdown, drawer variances, and notes.</td>
        </tr>
        <tr>
          <td><strong>Suppliers & GRNs</strong></td>
          <td><code>suppliers</code>, <code>grns</code><br/><code>grn_lines</code>, <code>supplier_bills</code></td>
          <td>Supplier directory, Goods Received delivery notes, distributor bonus units, invoice matching, and accounts payable.</td>
        </tr>
        <tr>
          <td><strong>Customers & Accounts</strong></td>
          <td><code>customers</code><br/><code>customer_ledger</code></td>
          <td>Customer phone, CNIC, credit limit, and running ledger balance.</td>
        </tr>
        <tr>
          <td><strong>Controlled Drugs & Rx</strong></td>
          <td><code>prescriptions</code></td>
          <td>Statutory narcotics/sedatives records: Patient CNIC, Prescribing Doctor name, and PMDC registration number.</td>
        </tr>
        <tr>
          <td><strong>Sync Outbox</strong></td>
          <td><code>sync_ops</code></td>
          <td>The local replication ledger of changes waiting to be sent to other computers or the cloud.</td>
        </tr>
      </tbody>
    </table>

    <h3 class="answer-heading">2.3 How to Search and Inspect the Data</h3>
    <ul>
      <li><strong>Method A: Directly in the App (No Database Knowledge Needed)</strong>
        <ul>
          <li><strong>Global Omnibar (Ctrl+K):</strong> Press <code>Ctrl+K</code> anywhere to search by bill number (<code>INV-</code>), medicine name, barcode, customer, or supplier.</li>
          <li><strong>Audit Log Screen:</strong> Navigate to <code>Audit Log</code> in the sidebar to search all database changes by user, date, or action.</li>
        </ul>
      </li>
      <li><strong>Method B: Using Free GUI Tools (e.g. DB Browser for SQLite)</strong>
        <p>Download and open <a href="https://sqlitebrowser.org/">DB Browser for SQLite</a>, click <strong>Open Database</strong>, and select <code>%APPDATA%\Mediescare\mediescare.db</code>. You can browse all tables visually or execute custom queries.</p>
      </li>
      <li><strong>Method C: Sample SQL Queries</strong>
        <pre class="sql-code">-- 1. Search recent sales bills with totals in Rupees:
SELECT doc_no, customer_name, (total / 100.0) AS total_rs, payment_status, created_at 
FROM sales ORDER BY created_at DESC LIMIT 20;

-- 2. Search products, batches and expiry dates:
SELECT p.name, p.generic_name, b.batch_no, b.expiry_date, (b.mrp / 100.0) AS mrp_rs
FROM products p JOIN batches b ON b.product_id = p.id
WHERE p.name LIKE '%panadol%' ORDER BY b.expiry_date ASC;

-- 3. Search forensic audit trail:
SELECT created_at, user_name, action, target_type, target_id, reason
FROM audit_log ORDER BY created_at DESC LIMIT 25;</pre>
      </li>
    </ul>
  </div>
</div>

<div class="page-break"></div>

<!-- ========================================== -->
<!-- CHAPTER 3: TURSO CLOUD DATABASE -->
<!-- ========================================== -->
<div class="chapter">
  <div class="chapter-header">
    <span class="chapter-number">Chapter 3</span>
    <h2 class="chapter-title">Cloud Database (Turso) Architecture & Console Queries</h2>
  </div>

  <div class="user-question-box">
    <div class="user-question-title">User Question / Scenario:</div>
    <p class="user-question-text">
      "How can we check all this in the Turso console? Is it going in there na?"
    </p>
  </div>

  <div class="answer-card">
    <h3 class="answer-heading">3.1 Yes, The Data Goes Directly into Turso</h3>
    <p>
      <strong>Yes, your data is synced into Turso!</strong> However, because Turso acts as the <strong>central cloud synchronization ledger</strong> for all branches, it stores data in an <strong>Operations Log table called <code>ops</code></strong> rather than plain static tables.
    </p>
    <p>
      Every time a product is created, a sale is posted, or a batch is updated, it arrives in Turso as a synchronized event containing the table name (<code>tbl</code>), action type (<code>kind</code>: insert/update), and the full record payload stored as JSON text in the <code>data</code> column.
    </p>

    <div class="callout-box">
      <strong>Why Turso Stores Operations (Event Sourcing):</strong>
      <ol style="margin-top: 6px; padding-left: 20px;">
        <li><strong>No Overwriting:</strong> If two branches make sales simultaneously while offline, neither overwrites the other in the cloud. Each change receives a unique global operation ID.</li>
        <li><strong>Automatic Branch Catch-Up:</strong> When a new branch opens or a replacement PC joins, it pulls the historical operations log from Turso and automatically builds its local database.</li>
      </ol>
    </div>

    <h3 class="answer-heading">3.2 How to Access the Turso Console</h3>
    <ol>
      <li>Log in to your <strong><a href="https://turso.tech">Turso Web Dashboard</a></strong>.</li>
      <li>Select your pharmacy database (e.g. <code>mediescare</code>).</li>
      <li>Click on the <strong>SQL Console</strong> / <strong>Shell</strong> tab.</li>
      <li>Run the queries below directly in the web browser.</li>
    </ol>

    <h3 class="answer-heading">3.3 Production Queries for Turso Web Console</h3>
    <p><strong>1. View Total Synced Count by Data Category:</strong></p>
    <pre class="sql-code">SELECT tbl AS data_category, count(*) AS total_records 
FROM ops 
GROUP BY tbl;</pre>

    <p><strong>2. View Live Stream of Incoming Branch Operations:</strong></p>
    <pre class="sql-code">SELECT seq, tbl, kind, received_at, data 
FROM ops 
ORDER BY seq DESC 
LIMIT 15;</pre>

    <p><strong>3. Query Synced Products from Inside the JSON Payload:</strong></p>
    <pre class="sql-code">SELECT 
  json_extract(data, '$.name') AS product_name,
  json_extract(data, '$.generic_name') AS generic,
  json_extract(data, '$.pack_size') AS pack_size,
  received_at
FROM ops 
WHERE tbl = 'products'
ORDER BY seq DESC;</pre>

    <p><strong>4. Query Synced Sales & Bills in Turso:</strong></p>
    <pre class="sql-code">SELECT 
  json_extract(data, '$.doc_no') AS bill_number,
  json_extract(data, '$.customer_name') AS customer,
  json_extract(data, '$.total') / 100.0 AS bill_total_rs,
  received_at
FROM ops 
WHERE tbl = 'sales'
ORDER BY seq DESC;</pre>

    <p><strong>5. View All Registered Branch Computers & Last Seen Times:</strong></p>
    <pre class="sql-code">SELECT name, branch_id, all_branches, last_seen_at 
FROM devices 
ORDER BY last_seen_at DESC;</pre>
  </div>
</div>

<div class="page-break"></div>

<!-- ========================================== -->
<!-- CHAPTER 4: TURSO LIMITS & CLOUDFLARE ROLE -->
<!-- ========================================== -->
<div class="chapter">
  <div class="chapter-header">
    <span class="chapter-number">Chapter 4</span>
    <h2 class="chapter-title">Turso Free Plan Capacity & The Security Role of Cloudflare</h2>
  </div>

  <div class="user-question-box">
    <div class="user-question-title">User Question / Scenario:</div>
    <p class="user-question-text">
      "In Turso's free plan, what is the limit of data? Like storage and all? Also what role did Cloudflare play in this software?"
    </p>
  </div>

  <div class="answer-card">
    <h3 class="answer-heading">4.1 Turso Free Tier Limits & Real-World Lifespan</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Turso Free Plan Limit</th>
          <th>What It Means for Mediescare</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Storage Capacity</strong></td>
          <td><strong>9 GB</strong> included storage</td>
          <td><strong>Lasts multiple years.</strong> A busy pharmacy producing ~300 bills/day uses roughly <strong>0.5 GB to 1.0 GB per year</strong>. For 1 to 3 branches, 9 GB lasts 3 to 5+ years without paying a penny.</td>
        </tr>
        <tr>
          <td><strong>Monthly Row Reads</strong></td>
          <td><strong>1 Billion</strong> reads / month</td>
          <td>Enormous headroom; even dozens of branches syncing continuously use only a tiny fraction.</td>
        </tr>
        <tr>
          <td><strong>Monthly Row Writes</strong></td>
          <td><strong>25 Million</strong> writes / month</td>
          <td>A busy branch uses ~45,000 writes/month (less than <strong>0.2%</strong> of the monthly quota).</td>
        </tr>
        <tr>
          <td><strong>Databases Allowed</strong></td>
          <td>Up to <strong>500 databases</strong></td>
          <td>Mediescare uses 1 cloud database for all branches.</td>
        </tr>
      </tbody>
    </table>

    <div class="callout-box">
      <strong>Future Scalability:</strong> If your pharmacy chain expands to dozens of branches years from now and exceeds 9 GB, Turso's paid tier is just <strong>$9/month</strong> for 24 GB of storage.
    </div>

    <h3 class="answer-heading">4.2 What Role Cloudflare Plays in Mediescare</h3>
    <p>
      Cloudflare hosts the <strong>Mediescare Cloud Gateway</strong> (<code>mediescare-gateway.mediescare.workers.dev</code>) using <strong>Cloudflare Workers</strong>.
    </p>
    <p>
      Instead of allowing desktop pharmacy computers to connect directly to the raw Turso database, <strong>all desktop computers communicate only with Cloudflare</strong>, which acts as a secure reverse-proxy shield in front of Turso.
    </p>

    <div class="diagram-box">
[Pharmacy Desktop Apps] ──HTTPS (Scoped Device Token)──&gt; <span class="accent">[Cloudflare Workers Gateway]</span> ──HTTPS (Master Token)──&gt; <span class="green">[Turso Cloud Database]</span>
    </div>

    <h3 class="answer-heading">4.3 The 5 Crucial Functions of Cloudflare</h3>
    <ol>
      <li>
        <strong>Zero-Trust Database Token Security:</strong>
        <p>If desktop apps connected directly to Turso, the master database administrative token would have to be packaged inside the Windows installer <code>.exe</code>. Anyone reverse-engineering the software could extract that token and gain full access to view, alter, or delete the entire pharmacy database. With Cloudflare, the master Turso token lives strictly as an encrypted secret inside Cloudflare's infrastructure; desktop apps never see it.</p>
      </li>
      <li>
        <strong>Branch Data Isolation (Scoping):</strong>
        <p>Every PC receives a unique 256-bit device token upon registration. When Branch 2 requests updates, Cloudflare validates the token and <strong>only delivers Branch 2's data</strong> (+ shared global product master). Cloudflare prevents one branch from snooping on or tampering with another branch's cash drawers or sales.</p>
      </li>
      <li>
        <strong>Setup Key Protection:</strong>
        <p>The gateway enforces a secret <code>SETUP_KEY</code>. Even if unauthorized third parties obtain a copy of Mediescare, they cannot register new organizations on your cloud infrastructure without your administrative setup key.</p>
      </li>
      <li>
        <strong>Brute-Force Attack Prevention:</strong>
        <p>When joining new computers with 6-digit codes or recovery keys, Cloudflare enforces rate limiting: after 20 invalid attempts in an hour, that computer is temporarily blocked to eliminate brute-force guessing attacks.</p>
      </li>
      <li>
        <strong>100% Free Cloudflare Hosting:</strong>
        <p>Cloudflare Workers' free plan provides <strong>100,000 requests per day</strong> and <strong>10 ms CPU time per request</strong>. Because Mediescare's gateway code is lightweight (no bloated server frameworks), each sync request takes <strong>only ~1 ms of CPU</strong>. A branch main PC syncing every 30 seconds uses ~5,800 requests/day, allowing <strong>10 to 15 branches to operate completely free</strong>.</p>
      </li>
    </ol>
  </div>
</div>

</body>
</html>
`;
}

app.whenReady().then(async () => {
  try {
    console.log('Writing Architecture Q&A HTML document...');
    const html = buildHTML();
    fs.writeFileSync(htmlFile, html, 'utf8');
    console.log(`Saved HTML source: ${htmlFile}`);

    console.log('Opening headless browser to compile PDF...');
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await win.loadFile(htmlFile);
    await new Promise((r) => setTimeout(r, 1500));

    console.log('Generating PDF via Electron printToPDF...');
    const pdfData = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: {
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      }
    });

    fs.writeFileSync(pdfFile, pdfData);
    console.log(`SUCCESS: PDF compiled at: ${pdfFile} (${(pdfData.length / 1024).toFixed(1)} KB)`);
    app.quit();
  } catch (err) {
    console.error('Failed to compile PDF:', err);
    process.exit(1);
  }
});

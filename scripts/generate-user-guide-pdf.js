'use strict';
/**
 * Generates the official Mediescare Comprehensive Visual User Guide PDF.
 * Uses Electron to render the styled manual with all screenshots, callout badges,
 * button explanations, and navigation breakdowns, and prints directly to A4 PDF.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const shotsDir = path.join(root, 'docs', 'guide-screenshots');
const htmlFile = path.join(root, 'docs', 'Mediescare-User-Guide.html');
const pdfFile = path.join(root, 'docs', 'Mediescare-User-Guide.pdf');

// Helper to convert screenshot file to data URI or relative path
function shotPath(name) {
  const p = path.join(shotsDir, name);
  if (!fs.existsSync(p)) return '';
  return `guide-screenshots/${name}`;
}

const manualSections = [
  {
    id: 'intro',
    title: '1. Introduction & System Architecture',
    desc: 'Mediescare is an offline-first pharmacy management and Point of Sale (POS) system built specifically for multi-branch retail and hospital pharmacies. It guarantees continuous counter selling during internet and power outages through decentralized local SQLite databases, synchronized with an encrypted cloud ledger when online.',
    items: [
      {
        title: 'Core Architecture & Offline Resilience',
        shot: '03-home.png',
        text: 'Every counter and branch maintains its own full local database. Selling, inventory lookups, and receipt printing execute with zero network latency. Changes automatically sync to the Head Office and cloud whenever connectivity is present.',
        badges: ['Offline-First', 'SQLite Embedded', 'Cloud Auto-Sync', 'Multi-Branch']
      }
    ]
  },
  {
    id: 'setup',
    title: '2. First-Time Setup & Organization Registration',
    desc: 'When launched for the first time, Mediescare guides the user through initialization. All standard pharmacy information is pre-filled for effortless onboarding.',
    items: [
      {
        title: 'Setup Choice: Head Office vs Branch',
        shot: '01-setup-choice.png',
        text: 'Choose between initializing the primary Head Office computer (creates the central database) or joining an existing branch to a Head Office network.',
        controls: [
          { name: 'Create a new Head Office', role: 'Initializes the master pharmacy organization, stores central data, and creates initial Super Admin.' },
          { name: 'Connect a branch computer', role: 'Connects this computer to an existing Head Office via a 6-word join code or network discovery.' }
        ]
      },
      {
        title: 'Pharmacy Organization Details',
        shot: '02-setup-step2.png',
        text: 'Pre-fills Mediescare defaults including Drug Sale Licence number, registered address, phone number, and branch identifiers.',
        controls: [
          { name: 'Continue / Submit', role: 'Validates inputs and moves to administrative password setup.' },
          { name: 'Back', role: 'Returns to the previous screen without losing entered information.' }
        ]
      },
      {
        title: 'Secret Recovery Key',
        shot: '02b-recovery-key.png',
        text: 'Generates a 24-character cryptographic recovery key shown only once. This key allows an owner to recover an entire pharmacy organization or rebuild a primary computer.',
        controls: [
          { name: 'Confirmation Checkbox', role: 'Must be checked to confirm the recovery key has been safely written down.' },
          { name: 'Continue', role: 'Enables once confirmed to open the main app interface.' }
        ]
      }
    ]
  },
  {
    id: 'shell',
    title: '3. Application Shell, Top Bar & Navigation Menu',
    desc: 'The workspace layout provides instant access to all operations through an adaptive top bar and a responsive sidebar navigation.',
    items: [
      {
        title: 'Top Bar Controls',
        shot: '03-home.png',
        text: 'The top bar stays accessible across all screens and provides vital live status indicators.',
        controls: [
          { name: 'Branch Chip', role: 'Displays active branch name (e.g. Mediescare Head Office). Clicking opens the switch branch dropdown for authorized managers.' },
          { name: 'Cloud & LAN Sync Chip', role: 'Real-time sync indicator. Shows Synced (green), Syncing (blue), or Offline (amber). Clicking opens the sync details popover.' },
          { name: 'Search Trigger (Ctrl+K)', role: 'Opens the Global Command Palette to search medicines, bills, batches, suppliers, and customers instantly.' },
          { name: 'Notifications Bell', role: 'Displays unread system alerts, stock warnings, and expiry alerts with quick links to affected records.' },
          { name: 'User Profile Chip', role: 'Displays user name and role badge. Opens profile settings, keyboard shortcuts guide, and Sign Out action.' },
          { name: 'Sidebar Collapse Button', role: 'Collapses the side menu into an icon-only minimal bar to maximize screen space for POS and tables.' }
        ]
      },
      {
        title: 'Global Command Palette (Ctrl+K)',
        shot: '17-palette.png',
        text: 'Universal omnibar to jump anywhere in the system within seconds. Supports keyboard navigation (Up/Down/Enter/Escape).',
        controls: [
          { name: 'Search Input', role: 'Type any medicine name, bill document number, supplier, customer, or page title to filter live results.' },
          { name: 'Keyboard Shortcut [Enter]', role: 'Immediately opens the highlighted record or navigates to the selected page.' }
        ]
      }
    ]
  },
  {
    id: 'pos',
    title: '4. Point of Sale (POS / The Counter)',
    desc: 'High-speed counter interface optimized for barcode scanners and keyboard-only operation. Supports multiple units, instant price lookups, discounts, hold bills, and all payment methods.',
    items: [
      {
        title: 'Opening the Cash Drawer Shift',
        shot: '60-pos-open-shift.png',
        text: 'Every cashier opens a shift before billing to track physical drawer float cash and maintain financial accountability.',
        controls: [
          { name: 'Opening Float Input', role: 'Enter initial cash in drawer (e.g. Rs 5,000 for change).' },
          { name: 'Open Shift Button', role: 'Activates billing and prints an shift-open audit slip.' }
        ]
      },
      {
        title: 'Scanning Items & Managing Cart',
        shot: '61-pos-cart.png',
        text: 'Scan barcode or type medicine name. Items are automatically allocated from the earliest expiring batch (FEFO).',
        controls: [
          { name: 'Product Search / Scan (Ctrl+Space)', role: 'Focuses barcode scan box. Type name or scan barcode to add item instantly.' },
          { name: 'Unit Dropdown (Pack / Strip / Tablet)', role: 'Switches dispensing unit. Prices and stock deduct accordingly.' },
          { name: 'Quantity Input', role: 'Adjusts quantity sold. Automatically alerts if stock is insufficient.' },
          { name: 'Discount Input (% / Fixed)', role: 'Applies line-item discount within cashier allowed threshold.' },
          { name: 'Hold Bill Button', role: 'Saves current bill in temporary queue so cashier can attend to the next customer.' },
          { name: 'Resume Bills Button', role: 'Restores any previously held bill to the counter.' },
          { name: 'Pay / Tender Button (F12 or Enter)', role: 'Opens the payment tender modal.' }
        ]
      },
      {
        title: 'Payment Tender & Customer Credit',
        shot: '62-pos-pay.png',
        text: 'Accepts all standard Pakistani and international payment options with automatic change calculation.',
        controls: [
          { name: 'Cash (F1)', role: 'Standard cash tender. Shows exact change to return.' },
          { name: 'Card (F2)', role: 'Bank POS debit/credit card transaction.' },
          { name: 'Easypaisa (F3)', role: 'Direct mobile wallet tender.' },
          { name: 'JazzCash (F4)', role: 'Direct mobile wallet tender.' },
          { name: 'Credit Account (F5)', role: 'Posts to customer ledger if within credit limit.' },
          { name: 'Customer Picker', role: 'Selects registered customer for loyalty and credit billing.' },
          { name: 'Complete & Print (Enter)', role: 'Finalizes transaction, updates stock, and triggers receipt print.' }
        ]
      },
      {
        title: 'Receipt Preview & Thermal Printing',
        shot: '65-receipt-preview.png',
        text: 'Clean 80mm or 58mm thermal receipts with pharmacy header, drug details, batch, expiry, tax summary, and custom footer.',
        controls: [
          { name: 'Print Button', role: 'Sends raw ESC/POS commands directly to thermal printer.' },
          { name: 'New Bill (F2)', role: 'Clears screen and prepares counter for the next customer.' }
        ]
      }
    ]
  },
  {
    id: 'sales-shifts',
    title: '5. Sales History & Cashier Shift Management',
    desc: 'Audit all past transactions, print duplicate receipts, handle returns/refunds, and reconcile daily cash drawers.',
    items: [
      {
        title: 'Sales & Receipts List',
        shot: '64-sales.png',
        text: 'Comprehensive ledger of all completed, held, and cancelled sales with filtering by date, payment method, and cashier.',
        controls: [
          { name: 'View Details Link', role: 'Opens full bill with line items, tax, and batch breakdown.' },
          { name: 'Void / Refund Button', role: 'Voids sale, restores batches into stock, and records reversal in financial journal.' },
          { name: 'Reprint Receipt', role: 'Prints duplicate customer receipt.' },
          { name: 'Export to Excel / CSV', role: 'Exports filtered sales ledger for external accounting.' }
        ]
      },
      {
        title: 'Cashier Shift Reconciliation (X-Report & Z-Report)',
        shot: '66-shift-x.png',
        text: 'Mid-shift audit (X-Report) and end-of-day closing (Z-Report) with cash counting breakdown and over/short variance logging.',
        controls: [
          { name: 'Counted Cash Inputs', role: 'Enter counts of Rs 5000, 1000, 500, 100, 50, 20, 10 notes.' },
          { name: 'Print Shift Report', role: 'Prints thermal summary of cash, digital payments, refunds, and net drawer balance.' },
          { name: 'Close Shift Button', role: 'Locks shift and logs any variance with required cashier reason note.' }
        ]
      }
    ]
  },
  {
    id: 'products-stock',
    title: '6. Medicines, Products & Batch Expiry Tracking',
    desc: 'Full pharmaceutical product catalog with multi-unit packaging, batch-level FEFO tracking, and automatic reorder alerts.',
    items: [
      {
        title: 'Medicines Catalog',
        shot: '32-product-page.png',
        text: 'Searchable directory showing stock on hand, pack size, trade price, MRP, and active batches.',
        controls: [
          { name: 'Add Product Button', role: 'Opens product creation form with generic formulas and unit mappings.' },
          { name: 'Edit Product Button', role: 'Updates pricing, barcodes, and categorization.' },
          { name: 'Stock by Batch Tab', role: 'Inspects individual batches, expiry dates, and supplier origins.' },
          { name: 'Why This Stock? Tab', role: 'Forensic audit trail tracing every single tablet in and out of the branch.' }
        ]
      },
      {
        title: 'Adding / Editing Product Details',
        shot: '31-product-form.png',
        text: 'Comprehensive medical product setup supporting multi-level packaging units.',
        controls: [
          { name: 'Brand Name & Generic Input', role: 'Enables searching by chemical formulation and brand.' },
          { name: 'Packaging Structure', role: 'Defines how many strips/tablets are in a pack for seamless fraction selling.' },
          { name: 'Controlled Drug Checkbox', role: 'Enforces mandatory patient CNIC and doctor prescription recording on sale.' },
          { name: 'Save Button', role: 'Validates and saves product to local catalog and syncs across branches.' }
        ]
      },
      {
        title: 'Batches and Expiry Tracking',
        shot: '35-batches.png',
        text: 'Monitors pharmaceutical expiration timelines. Visual color-coded badges highlight expired (red), near-expiry (yellow), and healthy stock (green).',
        controls: [
          { name: 'Filter by Expiry Range', role: 'Filters batches expiring in 30, 60, 90, or 180 days.' },
          { name: 'Export Expiry Report', role: 'Generates return list for supplier credit notes before items expire.' }
        ]
      },
      {
        title: 'Stock Adjustments (Damaged / Breakages)',
        shot: '37-adjustment-form.png',
        text: 'Adjusts inventory count for broken ampoules, damaged packaging, expired medicines, or physical audit corrections.',
        controls: [
          { name: 'Adjustment Reason Dropdown', role: 'Selects category: Damaged, Expired, Breakage, Physical Count Variance.' },
          { name: 'Post Adjustment Button', role: 'Updates batch balances and logs financial write-off.' }
        ]
      }
    ]
  },
  {
    id: 'purchases',
    title: '7. Purchasing, Suppliers & Goods Received (GRN)',
    desc: 'Manage supplier relationships, issue purchase orders, receive incoming stock with batch verification, and settle invoices.',
    items: [
      {
        title: 'Goods Received Note (GRN Editor)',
        shot: '33-grn-editor.png',
        text: 'Receives delivery from distributors. Records invoice numbers, batch numbers, expiry dates, bonus units, and distributor discounts.',
        controls: [
          { name: 'Batch No & Expiry Date Inputs', role: 'Enters exact manufacturer batch details.' },
          { name: 'Trade Price & MRP Inputs', role: 'Calculates pharmacy margin and updates product selling prices.' },
          { name: 'Bonus Units Field', role: 'Records free promotional schemes (e.g., 10+1 free) without distorting unit cost.' },
          { name: 'Post GRN Button', role: 'Increments inventory stock, creates new batch records, and adds payable bill to supplier ledger.' }
        ]
      },
      {
        title: 'Supplier Invoices & Payment Ledger',
        shot: '54-supplier-bills.png',
        text: 'Tracks outstanding debts owed to pharmaceutical distributors with due date alerts.',
        controls: [
          { name: 'Record Payment Button', role: 'Applies cash or bank cheque payment against oldest open invoices.' },
          { name: 'Return to Supplier Button', role: 'Creates debit note for expired or returned items.' }
        ]
      }
    ]
  },
  {
    id: 'controlled',
    title: '8. Controlled Drugs & Prescription Register',
    desc: 'Maintains statutory legal compliance for scheduled narcotics, sedatives, and prescription-only medications.',
    items: [
      {
        title: 'Controlled Drug Register',
        shot: '67-controlled.png',
        text: 'Every sale of a controlled medication mandates logging patient identity, prescribing doctor, and clinic details.',
        controls: [
          { name: 'Patient Name & CNIC Inputs', role: 'Records identity for regulatory inspection.' },
          { name: 'Doctor Name & PMDC Reg No', role: 'Verifies medical prescription validity.' },
          { name: 'Print Register Report', role: 'Exports official inspection ledger required by health authorities.' }
        ]
      }
    ]
  },
  {
    id: 'transfers',
    title: '9. Branch Transfers & Shop Network Sync',
    desc: 'Enables multi-branch operations: dispatch medicines from central warehouse to retail outlets, track transit shortages, and sync in real time.',
    items: [
      {
        title: 'Inter-Branch Stock Dispatch & Receipt',
        shot: '38-transfer-dispatched.png',
        text: 'Head Office creates a transfer packing list. Branch inspects items upon delivery and records any damaged or short units.',
        controls: [
          { name: 'Dispatch Transfer', role: 'Deducts stock from sender and marks shipment in-transit.' },
          { name: 'Receive & Confirm', role: 'Adds items to receiving branch stock and logs any discrepancy notes.' }
        ]
      },
      {
        title: 'Local Shop Network Pairing (LAN)',
        shot: '70-sync-pair.png',
        text: 'Pairs secondary counter computers with the branch main PC via local Wi-Fi / Ethernet without requiring internet access.',
        controls: [
          { name: '6-Digit Pairing Code', role: 'Connects secondary POS terminals in seconds.' },
          { name: 'Refresh Connection', role: 'Verifies active counter communication status.' }
        ]
      }
    ]
  },
  {
    id: 'reports',
    title: '10. Reports, Accounting & Executive Dashboard',
    desc: 'Business intelligence suite providing live revenue tracking, gross profit analysis, tax summaries, and daily reconciliation.',
    items: [
      {
        title: 'Executive Analytics Dashboard',
        shot: '80-dashboard.png',
        text: 'High-level overview of daily sales volume, gross profit margin, customer count, and low-stock alerts.',
        controls: [
          { name: 'Today / Week / Month Toggle', role: 'Filters performance metrics over selectable time windows.' },
          { name: 'Branch Selector', role: 'Consolidates multi-branch performance for pharmacy owners.' }
        ]
      },
      {
        title: 'Daily Sales & Drawer Reconciliation Report',
        shot: '82-report-daily.png',
        text: 'Itemized sales report with tax breakdowns, cashier totals, payment methods, and profit figures.',
        controls: [
          { name: 'Date Range Filter', role: 'Selects single day or date range.' },
          { name: 'Print Report Button', role: 'Formats report for thermal printer or full-page laser printer.' },
          { name: 'Export to Excel', role: 'Downloads structured `.xlsx` spreadsheet.' }
        ]
      },
      {
        title: 'Financial Journal & Expenses',
        shot: '85-finance.png',
        text: 'Automated double-entry general ledger tracking cash in hand, bank accounts, expenses, and accounts payable.',
        controls: [
          { name: 'Add Expense Button', role: 'Records petty cash vouchers, electricity bills, staff lunch, or rent payments.' }
        ]
      }
    ]
  },
  {
    id: 'admin',
    title: '11. Administration, Roles, Printers & Backups',
    desc: 'Configure staff permissions, manage system settings, pair thermal receipt printers, and automate daily encrypted backups.',
    items: [
      {
        title: 'Role-Based Permissions Checklist',
        shot: '15-role-editor.png',
        text: 'Granular security controls ensure cashiers, pharmacists, and managers only access features appropriate for their role.',
        controls: [
          { name: 'Permission Checkboxes', role: 'Toggles specific access (e.g., View Purchase Cost, Void Sales, Edit Products, Apply Discounts).' },
          { name: 'Save Role Button', role: 'Applies updated permissions immediately across all computers.' }
        ]
      },
      {
        title: 'Thermal Receipt Printer Setup',
        shot: '68-printer.png',
        text: 'Configure USB, Serial, or LAN receipt printers with customizable bill headers, logos, and cut commands.',
        controls: [
          { name: 'Paper Width (80mm / 58mm)', role: 'Switches layout width for standard thermal printers.' },
          { name: 'Test Print Button', role: 'Sends test diagnostic slip to verify connection and paper alignment.' }
        ]
      },
      {
        title: 'Automated Encrypted Backups',
        shot: '72-backups.png',
        text: 'Mediescare automatically creates daily encrypted SQLite database snapshots to protect against hardware failure.',
        controls: [
          { name: 'Backup Now Button', role: 'Creates an instantaneous encrypted backup snapshot.' },
          { name: 'Copy to USB / External Drive', role: 'Exports backup offsite for disaster recovery.' },
          { name: 'Restore Backup Button', role: 'Restores a selected historical snapshot with a mandatory safety copy created first.' }
        ]
      }
    ]
  }
];

function generateHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Mediescare - Visual User Guide & Operations Manual</title>
<style>
  @page {
    size: A4 portrait;
    margin: 14mm 12mm 14mm 12mm;
    @bottom-right {
      content: counter(page);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.5;
    font-size: 11pt;
    margin: 0;
    padding: 0;
  }
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 40px;
    page-break-after: always;
  }
  .cover-logo {
    width: 84px;
    height: 84px;
    margin-bottom: 24px;
  }
  .cover h1 {
    font-size: 32pt;
    font-weight: 800;
    color: #1a78ad;
    margin: 0 0 10px 0;
    letter-spacing: -0.02em;
  }
  .cover h2 {
    font-size: 16pt;
    font-weight: 500;
    color: #475569;
    margin: 0 0 28px 0;
  }
  .cover-meta {
    margin-top: 40px;
    padding: 16px 28px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    font-size: 11pt;
    color: #64748b;
    display: inline-block;
  }
  .cover-badge {
    background: #e6f2f9;
    color: #1a78ad;
    padding: 6px 14px;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 16px;
    display: inline-block;
  }
  .section-break {
    page-break-before: always;
  }
  h2.section-title {
    font-size: 18pt;
    color: #0f172a;
    border-bottom: 2px solid #1a78ad;
    padding-bottom: 6px;
    margin-top: 0;
    margin-bottom: 12px;
  }
  p.section-desc {
    color: #475569;
    font-size: 11pt;
    margin-bottom: 22px;
  }
  .guide-item {
    margin-bottom: 26px;
    page-break-inside: avoid;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    background: #ffffff;
  }
  .guide-item h3 {
    margin-top: 0;
    font-size: 13pt;
    color: #1a78ad;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .guide-item p {
    font-size: 10.5pt;
    color: #334155;
    margin: 0 0 14px 0;
  }
  .shot-wrap {
    text-align: center;
    margin: 12px 0 16px 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #cbd5e1;
    background: #0f172a;
  }
  .shot-wrap img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  .controls-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
    font-size: 10pt;
  }
  .controls-table th {
    text-align: left;
    background: #f1f5f9;
    padding: 6px 10px;
    color: #475569;
    font-weight: 600;
    border-bottom: 1px solid #cbd5e1;
  }
  .controls-table td {
    padding: 7px 10px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .controls-table tr:last-child td {
    border-bottom: none;
  }
  .btn-name {
    font-weight: 600;
    color: #0f172a;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 9.5pt;
    white-space: nowrap;
  }
  .tag-badge {
    display: inline-block;
    background: #f1f5f9;
    color: #475569;
    font-size: 9pt;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    margin-right: 6px;
  }
  .toc {
    page-break-after: always;
    padding: 20px 0;
  }
  .toc h2 {
    font-size: 18pt;
    color: #1a78ad;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 6px;
    margin-bottom: 16px;
  }
  .toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .toc-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px dashed #e2e8f0;
    font-size: 11pt;
    font-weight: 500;
    color: #334155;
  }
  .toc-item span:first-child {
    color: #0f172a;
  }
</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
  <div class="cover-badge">Official Release v1.0.0</div>
  <img class="cover-logo" src="guide-screenshots/03-home.png" style="width: 72px; height: 72px; object-fit: contain; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Mediescare Logo" />
  <h1>Mediescare Pharmacy</h1>
  <h2>Visual Operations Manual & Illustrated Feature Guide</h2>
  <p style="max-width: 540px; color: #64748b; font-size: 11pt; margin-bottom: 30px;">
    A complete visual walkthrough of every button, navigation screen, and workflow in the Mediescare Offline-First Multi-Branch Pharmacy Management System.
  </p>
  <div class="cover-meta">
    <strong>Audience:</strong> Pharmacy Owners, Store Managers, Pharmacists & Cashiers<br/>
    <strong>Application Version:</strong> 1.0.0 Production Release<br/>
    <strong>Published:</strong> October 2026
  </div>
</div>

<!-- Table of Contents -->
<div class="toc">
  <h2>Contents List</h2>
  <ul class="toc-list">
    ${manualSections.map((s, idx) => `
      <li class="toc-item">
        <span>${s.title}</span>
        <span>Section ${idx + 1}</span>
      </li>
    `).join('')}
  </ul>
</div>

<!-- Guide Sections -->
${manualSections.map((sec, idx) => `
  <div class="section-break">
    <h2 class="section-title">${sec.title}</h2>
    <p class="section-desc">${sec.desc}</p>

    ${sec.items.map((item) => `
      <div class="guide-item">
        <h3>${item.title}</h3>
        <p>${item.text}</p>

        ${item.badges ? `
          <div style="margin-bottom: 12px;">
            ${item.badges.map(b => `<span class="tag-badge">${b}</span>`).join('')}
          </div>
        ` : ''}

        ${item.shot ? `
          <div class="shot-wrap">
            <img src="${shotPath(item.shot)}" alt="${item.title}" />
          </div>
        ` : ''}

        ${item.controls && item.controls.length ? `
          <table class="controls-table">
            <thead>
              <tr>
                <th style="width: 32%;">Button / Control</th>
                <th>Function & Behavior</th>
              </tr>
            </thead>
            <tbody>
              ${item.controls.map(c => `
                <tr>
                  <td><span class="btn-name">${c.name}</span></td>
                  <td>${c.role}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>
    `).join('')}
  </div>
`).join('')}

</body>
</html>
`;
}

app.whenReady().then(async () => {
  try {
    console.log('Writing HTML manual...');
    const html = generateHTML();
    fs.writeFileSync(htmlFile, html, 'utf8');
    console.log(`Saved HTML manual: ${htmlFile}`);

    console.log('Opening headless browser to render PDF...');
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
    // Give images a moment to decode fully
    await new Promise((r) => setTimeout(r, 2000));

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
    console.log(`SUCCESS: User guide PDF created at: ${pdfFile} (${(pdfData.length / (1024 * 1024)).toFixed(2)} MB)`);
    app.quit();
  } catch (err) {
    console.error('Failed to generate PDF:', err);
    process.exit(1);
  }
});

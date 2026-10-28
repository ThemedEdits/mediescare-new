'use strict';
// Receipt and medicine label documents (HTML) for thermal 58 mm, 80 mm and A4 printers.
const barcode = require('./barcode');
const money = require('./money');
const { htmlEscape: esc } = require('./exporter');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso, format) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  const p = (n) => String(n).padStart(2, '0');
  const day = p(d.getDate());
  const month = p(d.getMonth() + 1);
  const y = d.getFullYear();
  switch (format) {
    case 'MM/DD/YYYY': return `${month}/${day}/${y}`;
    case 'YYYY-MM-DD': return `${y}-${month}-${day}`;
    case 'DD-MMM-YYYY': return `${day}-${MONTHS[d.getMonth()]}-${y}`;
    default: return `${day}/${month}/${y}`;
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Electron page sizes in inches (thermal rolls are long; the printer cuts at the end).
function pageSize(format) {
  if (format === '52') return { width: 52 / 25.4, height: 11 };
  if (format === '58') return { width: 58 / 25.4, height: 11 };
  if (format === '80') return { width: 80 / 25.4, height: 11 };
  return 'A4';
}

const METHOD = { cash: 'Cash', card: 'Card', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', bank: 'Bank' };

function render({
  org, branch, sale, format = '80', showBatch = true, footer = '', taxLabel = 'Tax', reprint = false,
  currency = { symbol: 'Rs', decimals: 2 }, dateFormat,
  showLogo = true, logoPlacement = 'center', logoSize = 'medium',
  headerText = '', headerAlignment = 'center', headerSize = 'normal',
  showBranchAddress = true, showBranchPhone = true, showBranchLicence = true, showBranchNtn = true,
  showDiscount = true, showBarcode = true, copies = 1,
  footerAlignment = 'center', footerSize = 'normal',
}) {
  const m = (v) => money.format(v, { symbol: '', decimals: currency.decimals });
  const thermal = format === '52' || format === '58' || format === '80';
  const width = format === '52' ? '48mm' : format === '58' ? '54mm' : format === '80' ? '74mm' : '190mm';
  const base = format === '52' ? 7.5 : format === '58' ? 8.2 : format === '80' ? 9.5 : 10.5;
  const lines = sale.lines.map((l) => {
    const disc = (showDiscount !== false && l.discount) ? `<div class="sub">Discount -${m(l.discount)}</div>` : '';
    const batch = (showBatch !== false && l.batchNo) ? `<div class="sub">Batch ${esc(l.batchNo)} Exp ${esc(fmtDate(l.expiryDate, dateFormat).slice(-7))}</div>` : '';
    if (thermal) {
      return `<tr><td colspan="3" class="name">${esc(l.productLabel)}</td></tr>
        <tr><td class="qty">${esc(l.qtyText)}</td><td class="num price-cell">${m(l.unitPrice)}/${esc(l.unitName)}</td><td class="num amt-cell">${m(l.net)}</td></tr>
        <tr><td colspan="3">${batch}${disc}</td></tr>`;
    }
    return `<tr><td>${l.lineNo}</td><td>${esc(l.productLabel)}${batch}</td><td>${esc(l.qtyText)}</td><td class="num">${m(l.unitPrice)} / ${esc(l.unitName)}</td>
      <td class="num">${(showDiscount !== false && l.discount) ? '-' + m(l.discount) : ''}</td><td class="num">${m(l.net)}</td></tr>`;
  }).join('');
  const pays = sale.payments.filter((p) => p.kind === 'sale').map((p) => `<tr><td>${esc(METHOD[p.method] || p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="num">${m(p.amount)}</td></tr>`).join('');
  const rx = sale.prescription;

  let logoPx = 46;
  if (typeof logoSize === 'number') logoPx = logoSize;
  else if (logoSize === 'small') logoPx = (format === '52' ? 24 : 32);
  else if (logoSize === 'large') logoPx = (format === '52' ? 44 : 64);
  else if (logoSize === 'xlarge') logoPx = (format === '52' ? 56 : 80);
  else logoPx = (format === '52' ? 34 : 46);

  const logoAlign = logoPlacement === 'left' ? 'left' : logoPlacement === 'right' ? 'right' : 'center';
  const logoHtml = showLogo ? `<div style="text-align: ${logoAlign}; margin-bottom: 6px;">
      <svg width="${logoPx}" height="${logoPx}" viewBox="0 0 380.7 386.17" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block; vertical-align: middle;">
        <path fill="#1a78ad" d="M199.79,330.25c-45.83-44.86-50.36-106.96,17.98-130.83,0,0-9.31,9.85-9.31,9.85.59-46.05,15.63-91.22,67.98-97.97,76.1-7.9,120.84,67.98,98.51,135.87-12.33,38.89-40.07,69.19-72.97,91.34-15.57,11.09-32.73,19.43-49.91,26.9,21.14-17.85,41.77-36.25,59.22-57.58,25.69-31.9,45.99-74.73,33.57-115.28-3.78-14.14-12.13-27.09-24.2-35.55-21.64-15.82-58.08-17.23-71.99,9.06-7.44,12.74-10.04,29.97-12.34,44.94-.56,2.9-2.16,9.93-2.93,13.02-65.19,11.83-58.76,57.66-33.6,106.22h0Z"/>
        <path fill="#2c7232" d="M184.02,176.12c-62.89-33.35-149.34-4.3-148.63,74.04-.43,29.46,13.7,56.18,34.09,77.03,27.05,29.82,63.93,47.06,106.43,56.47C96.75,399.67-.95,337.25.02,250.39c-1.97-98.51,117.83-145.93,184-74.26h0Z"/>
        <path fill="#1a78ad" d="M186.39.03c2.31-.1,37.7-1.04,55.77,26.7,13.87,21.29,7.9,44.67,5.07,55.77-2.41,9.43-8.04,31.52-29.41,44.95-19.12,12.03-38.86,9.58-43.94,8.79-6.07-.95-19.96-3.11-31.1-14.2-12.22-12.17-13.78-27.78-15.55-45.63-.95-9.58-1.83-19.45,1.84-31.73,1.38-4.62,4.88-15.86,14.72-26.07C160.07,1.72,181.53.23,186.39.03Z"/>
      </svg>
    </div>` : '';

  const headAlign = headerAlignment === 'left' ? 'left' : headerAlignment === 'right' ? 'right' : 'center';
  const headFontPt = headerSize === 'small' ? (base - 1.5) : headerSize === 'large' ? (base + 1.5) : base;

  const head = `<div style="text-align: ${headAlign}; word-break: break-word;">
      ${logoHtml}
      <div class="shop">${esc(org ? org.name : '')}</div>
      ${headerText ? `<div class="sub" style="margin: 4px 0; text-align: ${headAlign}; font-size: ${headFontPt}pt; white-space: pre-line; word-break: break-word;">${esc(headerText)}</div>` : ''}
      <div>${esc(branch.name)}</div>
      ${branch.address && showBranchAddress !== false ? `<div>${esc(branch.address)}</div>` : ''}
      ${branch.phone && showBranchPhone !== false ? `<div>Phone ${esc(branch.phone)}</div>` : ''}
      ${branch.licence_no && showBranchLicence !== false ? `<div>Licence ${esc(branch.licence_no)}</div>` : ''}
      ${branch.ntn && showBranchNtn !== false ? `<div>NTN ${esc(branch.ntn)}</div>` : ''}
    </div>
    ${reprint ? '<div class="center copy">COPY - printed again</div>' : ''}
    ${sale.status === 'voided' ? '<div class="center copy">CANCELLED</div>' : ''}
    <table class="meta"><tr><td>Bill</td><td class="num">${esc(sale.docNo)}</td></tr>
      <tr><td>Date</td><td class="num">${esc(fmtDate(sale.soldAt, dateFormat))} ${esc(fmtTime(sale.soldAt))}</td></tr>
      <tr><td>Cashier</td><td class="num">${esc(sale.cashierName)}</td></tr>
      <tr><td>Customer</td><td class="num">${esc(sale.customerName || 'Walk-in Customer')}</td></tr>
      ${rx ? `<tr><td>Patient</td><td class="num">${esc(rx.patientName)}</td></tr><tr><td>Doctor</td><td class="num">${esc(rx.doctorName)}</td></tr>` : ''}
    </table>`;
  const items = thermal
    ? `<table class="items thermal"><tr><th class="qty-col">Qty</th><th class="num price-col">Price</th><th class="num amt-col">Amount</th></tr>${lines}</table>`
    : `<table class="items a4"><tr><th>#</th><th>Item</th><th>Qty</th><th class="num">Price</th><th class="num">Discount</th><th class="num">Amount</th></tr>${lines}</table>`;
  const totals = `<table class="totals">
      <tr><td>Items total</td><td class="num">${m(sale.gross)}</td></tr>
      ${sale.discount ? `<tr><td>Discount</td><td class="num">-${m(sale.discount)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="num">${esc(currency.symbol)} ${m(sale.total)}</td></tr>
      ${sale.tax ? `<tr><td>${esc(taxLabel)} included</td><td class="num">${m(sale.tax)}</td></tr>` : ''}
      ${pays}
      ${sale.change ? `<tr><td>Cash received</td><td class="num">${m(sale.tendered)}</td></tr><tr><td>Change</td><td class="num">${m(sale.change)}</td></tr>` : ''}
      ${sale.credit ? `<tr><td>On account (to pay)</td><td class="num">${m(sale.credit)}</td></tr>` : ''}
    </table>`;

  const barcodeModule = format === '52' ? 0.95 : format === '58' ? 1.05 : format === '80' ? 1.25 : 1.4;
  const barcodeHeight = format === '52' ? 24 : format === '58' ? 26 : format === '80' ? 30 : 34;
  const barcodeFontSize = format === '52' ? 7.5 : format === '58' ? 8 : 8.5;
  const barcodeHtml = showBarcode !== false ? `<div class="code">${barcode.svg(sale.docNo, { module: barcodeModule, height: barcodeHeight, fontSize: barcodeFontSize })}</div>` : '';

  const footAlign = footerAlignment === 'left' ? 'left' : footerAlignment === 'right' ? 'right' : 'center';
  const footFontPt = footerSize === 'small' ? (base - 2) : footerSize === 'large' ? (base + 0.5) : (base - 1);
  const footHtml = footer ? `<div class="foot" style="text-align: ${footAlign}; font-size: ${footFontPt}pt; white-space: pre-line; word-break: break-word;">${esc(footer)}</div>` : '';

  const singleDoc = `<div class="doc doc-${format.toLowerCase()}">${head}${items}${totals}
    ${sale.returnedTotal ? `<div class="foot">Returns on this bill: ${m(sale.returnedTotal)}</div>` : ''}
    ${footHtml}
    ${barcodeHtml}
  </div>`;
  const numCopies = Math.max(1, Math.min(Number(copies) || 1, 2));
  const docs = numCopies === 2
    ? `${singleDoc}<div style="page-break-after: always; border-bottom: 2px dashed #999; margin: 16px 0;"></div>${singleDoc}`
    : singleDoc;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.docNo)}</title><style>
    @page { size: ${thermal ? `${format}mm auto` : 'A4'}; margin: ${thermal ? '2mm' : '12mm'}; }
    body, :host, .doc { margin: 0; font: ${base}pt/1.3 Arial, "Segoe UI", sans-serif; color: #000; box-sizing: border-box; }
    .doc { width: ${width}; max-width: 100%; margin: 0 auto; box-sizing: border-box; overflow-wrap: break-word; word-wrap: break-word; }
    .center { text-align: center; } .shop { font-size: ${base + 2.5}pt; font-weight: bold; }
    .copy { font-weight: bold; border: 1px solid #000; margin: 4px 0; padding: 2px; }
    table { width: 100%; border-collapse: collapse; box-sizing: border-box; }
    td, th { padding: 2px 2px; vertical-align: top; text-align: left; box-sizing: border-box; }
    .num { text-align: right; }
    .meta { margin: 6px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; width: 100%; table-layout: fixed; }
    .meta td:first-child { width: 35%; }
    .meta td.num { width: 65%; text-align: right; word-break: break-word; white-space: normal; }
    .items { width: 100%; }
    .items.thermal { table-layout: fixed; }
    .items th.qty-col, .items td.qty { width: 28%; text-align: left; }
    .items th.price-col, .items td.price-cell { width: 38%; text-align: right; }
    .items th.amt-col, .items td.amt-cell { width: 34%; text-align: right; }
    .items th { border-bottom: 1px solid #000; font-weight: bold; }
    .items .name { font-weight: bold; padding-top: 3px; word-break: break-word; }
    .items.a4 { table-layout: auto; }
    .items.a4 td, .items.a4 th { padding: 4px 6px; border-bottom: 1px solid #ccc; }
    .sub { font-size: ${Math.max(5.5, base - 1.5)}pt; color: #333; word-break: break-word; }
    .totals { margin-top: 6px; border-top: 1px dashed #000; width: 100%; table-layout: fixed; }
    .totals td:first-child { width: 55%; word-break: break-word; }
    .totals td.num { width: 45%; text-align: right; white-space: nowrap; }
    .totals .grand td { font-weight: bold; font-size: ${base + 1.5}pt; border-top: 1px solid #000; padding-top: 2px; }
    .foot { margin-top: 8px; text-align: center; font-size: ${Math.max(6, base - 1)}pt; word-break: break-word; }
    .code { text-align: center; margin-top: 6px; width: 100%; }
    .code svg { max-width: 100%; width: auto; height: auto; display: block; margin: 0 auto; }
  </style></head><body>${docs}</body></html>`;
}

// Small labels stuck on medicine packs: patient, medicine, how to take it.
function medicineLabels({ org, branch, sale, items, patient }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page { size: 50mm 30mm; margin: 0; } body { margin: 0; font-family: Arial, sans-serif; }
    .l { width: 50mm; height: 30mm; box-sizing: border-box; padding: 1.5mm 2mm; page-break-after: always; overflow: hidden; }
    .shop { font-size: 6pt; } .med { font-size: 8.5pt; font-weight: bold; } .how { font-size: 9pt; margin: 1mm 0; } .meta { font-size: 6pt; color: #333; }
  </style></head><body>${items.map((l) => `<div class="l"><div class="shop">${esc(org ? org.name : '')} - ${esc(branch.name)}${branch.phone ? ' - ' + esc(branch.phone) : ''}</div>
    <div class="med">${esc(l.productLabel)}</div><div class="how">${esc(l.instructions || '')}</div>
    <div class="meta">${patient ? `For ${esc(patient)} - ` : ''}${esc(sale.docNo)} - ${esc(fmtDate(sale.soldAt))} - Batch ${esc(l.batchNo)} Exp ${esc(l.expiryDate.slice(0, 7))}</div></div>`).join('')}</body></html>`;
}

module.exports = { render, medicineLabels, pageSize };

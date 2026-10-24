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
  if (format === '58') return { width: 58 / 25.4, height: 11 };
  if (format === '80') return { width: 80 / 25.4, height: 11 };
  return 'A4';
}

const METHOD = { cash: 'Cash', card: 'Card', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', bank: 'Bank' };

function render({ org, branch, sale, format = '80', showBatch = true, footer = '', taxLabel = 'Tax', reprint = false, currency = { symbol: 'Rs', decimals: 2 }, dateFormat }) {
  const m = (v) => money.format(v, { symbol: '', decimals: currency.decimals });
  const thermal = format === '58' || format === '80';
  const width = format === '58' ? '54mm' : format === '80' ? '74mm' : '190mm';
  const base = format === '58' ? 8.5 : format === '80' ? 9.5 : 11;
  const lines = sale.lines.map((l) => {
    const disc = l.discount ? `<div class="sub">Discount -${m(l.discount)}</div>` : '';
    const batch = showBatch ? `<div class="sub">Batch ${esc(l.batchNo)}  Exp ${esc(fmtDate(l.expiryDate, dateFormat).slice(-7))}</div>` : '';
    if (thermal) {
      return `<tr><td colspan="3" class="name">${esc(l.productLabel)}</td></tr>
        <tr><td class="qty">${esc(l.qtyText)}</td><td class="num">${m(l.unitPrice)}/${esc(l.unitName)}</td><td class="num">${m(l.net)}</td></tr>
        <tr><td colspan="3">${batch}${disc}</td></tr>`;
    }
    return `<tr><td>${l.lineNo}</td><td>${esc(l.productLabel)}${batch}</td><td>${esc(l.qtyText)}</td><td class="num">${m(l.unitPrice)} / ${esc(l.unitName)}</td>
      <td class="num">${l.discount ? '-' + m(l.discount) : ''}</td><td class="num">${m(l.net)}</td></tr>`;
  }).join('');
  const pays = sale.payments.filter((p) => p.kind === 'sale').map((p) => `<tr><td>${esc(METHOD[p.method] || p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="num">${m(p.amount)}</td></tr>`).join('');
  const rx = sale.prescription;
  const head = `<div class="center">
      <div class="shop">${esc(org ? org.name : '')}</div>
      <div>${esc(branch.name)}</div>
      ${branch.address ? `<div>${esc(branch.address)}</div>` : ''}
      ${branch.phone ? `<div>Phone ${esc(branch.phone)}</div>` : ''}
      ${branch.licence_no ? `<div>Licence ${esc(branch.licence_no)}</div>` : ''}
      ${branch.ntn ? `<div>NTN ${esc(branch.ntn)}</div>` : ''}
    </div>
    ${reprint ? '<div class="center copy">COPY - printed again</div>' : ''}
    ${sale.status === 'voided' ? '<div class="center copy">CANCELLED</div>' : ''}
    <table class="meta"><tr><td>Bill</td><td class="num">${esc(sale.docNo)}</td></tr>
      <tr><td>Date</td><td class="num">${esc(fmtDate(sale.soldAt, dateFormat))} ${esc(fmtTime(sale.soldAt))}</td></tr>
      <tr><td>Cashier</td><td class="num">${esc(sale.cashierName)}</td></tr>
      ${sale.customerName ? `<tr><td>Customer</td><td class="num">${esc(sale.customerName)}</td></tr>` : ''}
      ${rx ? `<tr><td>Patient</td><td class="num">${esc(rx.patientName)}</td></tr><tr><td>Doctor</td><td class="num">${esc(rx.doctorName)}</td></tr>` : ''}
    </table>`;
  const items = thermal
    ? `<table class="items"><tr><th>Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>${lines}</table>`
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.docNo)}</title><style>
    @page { size: ${thermal ? `${format}mm auto` : 'A4'}; margin: ${thermal ? '2mm' : '12mm'}; }
    body { margin: 0; font: ${base}pt/1.3 Arial, "Segoe UI", sans-serif; color: #000; }
    .doc { width: ${width}; margin: 0 auto; }
    .center { text-align: center; } .shop { font-size: ${base + 3}pt; font-weight: bold; }
    .copy { font-weight: bold; border: 1px solid #000; margin: 4px 0; padding: 2px; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 1px 0; vertical-align: top; text-align: left; }
    .num { text-align: right; white-space: nowrap; } .meta { margin: 6px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
    .items th { border-bottom: 1px solid #000; font-weight: bold; } .items .name { font-weight: bold; padding-top: 3px; }
    .items.a4 td, .items.a4 th { padding: 4px 6px; border-bottom: 1px solid #ccc; }
    .sub { font-size: ${base - 1.5}pt; color: #333; } .qty { white-space: nowrap; }
    .totals { margin-top: 6px; border-top: 1px dashed #000; } .totals .grand td { font-weight: bold; font-size: ${base + 2}pt; border-top: 1px solid #000; padding-top: 2px; }
    .foot { margin-top: 8px; text-align: center; font-size: ${base - 1}pt; } .code { text-align: center; margin-top: 6px; } .code svg { width: ${thermal ? '90%' : '60mm'}; height: auto; }
  </style></head><body><div class="doc">${head}${items}${totals}
    ${sale.returnedTotal ? `<div class="foot">Returns on this bill: ${m(sale.returnedTotal)}</div>` : ''}
    <div class="foot">${esc(footer)}</div>
    <div class="code">${barcode.svg(sale.docNo, { module: 1.4, height: 34, fontSize: 9 })}</div>
  </div></body></html>`;
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

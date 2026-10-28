const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../mediescare-icons');
const names = {
  netSalesToday: 'net sales today.svg',
  grossProfit: 'gross profit.svg',
  bills: 'bills.svg',
  expenses: 'expenses.svg',
  cashSales: 'cash sales.svg',
  cardOnline: 'card and online.svg',
  lowStock: 'low or out of stock.svg',
  expiringSoon: 'expiring soon.svg',
  waitingApproval: 'waiting for approval.svg',
  weOweSuppliers: 'we owe suppliers.svg'
};

let out = '// Auto-generated stat SVGs from mediescare-icons\n';
out += 'export const STAT_ICONS = {\n';

for (const [key, file] of Object.entries(names)) {
  const filePath = path.join(dir, file);
  let raw = fs.readFileSync(filePath, 'utf8').replace(/<\?xml[^>]*\?>/g, '').trim();
  const prefix = 'si-' + key;
  // Scope CSS class selectors inside <style>...</style> (must start with letter, not number following dot)
  raw = raw.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
    const scoped = css.replace(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g, '.' + prefix + '-$1');
    return '<style>' + scoped + '</style>';
  });
  raw = raw.replace(/class="([^"]+)"/g, (_, cls) => {
    const scopedCls = cls.split(/\s+/).map((c) => prefix + '-' + c).join(' ');
    return 'class="' + scopedCls + '"';
  });
  raw = raw.replace('<svg ', '<svg class="stat-svg ' + prefix + '" ');
  out += '  ' + key + ': `' + raw.replace(/`/g, '\\`') + '`,\n';
}

out += '};\n\n';
out += 'export function statIcon(key) {\n';
out += '  const html = STAT_ICONS[key];\n';
out += '  if (!html) return null;\n';
out += '  const parser = new DOMParser();\n';
out += '  const doc = parser.parseFromString(html, "image/svg+xml");\n';
out += '  const svg = doc.documentElement;\n';
out += '  if (!svg || svg.tagName.toLowerCase() !== "svg") return null;\n';
out += '  const wrapper = document.createElement("span");\n';
out += '  wrapper.className = "stat-icon custom-stat-icon";\n';
out += '  wrapper.appendChild(svg);\n';
out += '  return wrapper;\n';
out += '}\n';

const target = path.join(__dirname, '../src/renderer/js/ui/stat-icons.js');
fs.writeFileSync(target, out);
console.log('Successfully generated', target, 'Length:', out.length);

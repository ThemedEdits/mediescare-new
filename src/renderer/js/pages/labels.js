// Barcode labels for products and batches: choose items and copies, preview, print or save as PDF.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { toast, toastError } from '../ui/toast.js';
import { productPicker, batchSelect, filterSelect, numberInput } from '../ui/stockui.js';
import { busy } from '../ui/form.js';

export async function render(page, { params }) {
  const items = [];
  const list = h('tbody');
  const preview = h('div.row.wrap', { style: { gap: '10px', alignItems: 'flex-start' } });
  let size = '50x25';

  async function add(p, batchId = '') {
    const sel = await batchSelect(p.id, { includeExpired: true, status: 'in_stock', value: batchId });
    sel.options[0].textContent = t('labels.noBatch');
    const copies = numberInput({ min: 1, max: 500, value: 1, style: { width: '84px' } });
    const it = { product: p, sel, copies };
    it.row = h('tr', h('td', p.label), h('td', sel), h('td', copies), h('td', h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => { items.splice(items.indexOf(it), 1); it.row.remove(); refresh(); } }, icon('x', 'sm'))));
    for (const el of [sel, copies]) el.addEventListener('change', refresh);
    items.push(it);
    list.append(it.row);
    refresh();
  }
  const payload = () => ({ size, items: items.map((i) => ({ productId: i.product.id, batchId: i.sel.value || undefined, copies: i.copies.value })) });

  async function refresh() {
    if (!items.length) { preview.replaceChildren(h('p.small.faint', t('labels.empty'))); return; }
    try {
      const labels = await call('labels.preview', payload());
      const [w, hh] = size.split('x').map(Number);
      preview.replaceChildren(...labels.map((l) => {
        // The barcode SVG is built in the main process from escaped text only.
        const code = h('div', { style: { flex: 1, minHeight: 0 } });
        code.innerHTML = l.svg;
        const svg = code.querySelector('svg');
        if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
        return h('div', { style: { width: `${w * 3.2}px`, height: `${hh * 3.2}px`, background: '#fff', color: '#000', border: '1px solid var(--border-strong)', padding: '4px 6px', display: 'flex', flexDirection: 'column', fontFamily: 'Arial, sans-serif', overflow: 'hidden' } },
          h('div', { style: { fontSize: '9px' } }, l.shop), h('div', { style: { fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' } }, l.name),
          h('div', { style: { fontSize: '9px' } }, l.price), l.batch ? h('div', { style: { fontSize: '9px' } }, l.batch) : null, code);
      }));
    } catch (err) { toastError(err); }
  }

  const sizeSel = filterSelect([{ value: '38x25', label: '38 x 25 mm' }, { value: '50x25', label: '50 x 25 mm' }, { value: '50x30', label: '50 x 30 mm' }], (v) => { size = v; refresh(); }, { value: size, width: '140px' });
  const printBtn = h('button.btn.primary', { type: 'button' }, icon('printer', 'sm'), t('labels.printNow'));
  const pdfBtn = h('button.btn', { type: 'button' }, icon('download', 'sm'), t('labels.savePdf'));
  printBtn.onclick = () => busy(printBtn, null, async () => {
    if (!items.length) return;
    try { const r = await call('labels.print', payload()); if (r && r.printed) toast(t('labels.sent')); } catch (err) { toastError(err); }
  });
  pdfBtn.onclick = () => busy(pdfBtn, null, async () => {
    if (!items.length) return;
    try { const r = await call('labels.print', { ...payload(), output: 'pdf' }); if (r && r.saved) toast(t('audit.exported', { rows: '', path: r.path })); } catch (err) { toastError(err); }
  });
  page.append(h('div.page-head', h('div', h('h1', t('labels.title')), h('p.sub', t('labels.sub'))), h('div.row', h('span.small.muted', t('labels.size')), sizeSel, pdfBtn, printBtn)));
  page.append(h('div.grid-2', { style: { alignItems: 'start' } },
    h('div.card', h('div.card-body.stack', h('div.field', h('label', t('adjustments.addItem')), productPicker({ onPick: (p) => add(p) })),
      h('table.data', h('thead', h('tr', h('th', t('products.name')), h('th', t('stock.batch')), h('th', t('labels.copies')), h('th', ''))), list),
      h('p.small.muted', t('labels.hint')))),
    h('div.card', h('div.card-head', h('h2', t('labels.preview'))), h('div.card-body', preview))));
  refresh();
  if (params.productId) {
    try { const p = await call('products.get', { id: params.productId }); await add(p, params.batchId || ''); } catch (err) { toastError(err); }
  }
}

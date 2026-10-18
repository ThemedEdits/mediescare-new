// One product: details, batches at this branch, why the stock is what it is, prices, branch values.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { can, state } from '../state.js';
import { dataTable } from '../ui/table.js';
import { confirm } from '../ui/modal.js';
import { Form, fieldText, input, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { statusBadge, expiryBadge, kv, docHeader, moneyInput, rupees } from '../ui/stockui.js';
import { openProductForm } from './products.js';
import { batchActions, ledgerTable } from './batches.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const id = params.id;
  let p;
  try { p = await call('products.get', { id }); } catch (err) { toastError(err); navigate('products'); return; }
  const lists = await call('lookups.all');

  const edit = can('products.edit') ? h('button.btn', { type: 'button', onclick: () => openProductForm(p, { lists, onSaved: () => navigate('product', { id }) }) }, icon('edit', 'sm'), t('common.edit')) : null;
  const labels = h('a.btn', { href: `#/labels?productId=${id}` }, icon('printer', 'sm'), t('labels.print'));
  const toggle = can('products.delete') ? h('button.btn', { type: 'button', class: p.active ? 'danger' : '', onclick: async () => {
    let reason = '';
    if (p.active) {
      reason = await confirm({ title: t('products.deactivateTitle', { name: p.label }), text: t('products.deactivateText'), confirmLabel: t('products.deactivate'), danger: true, requireReason: true });
      if (reason === false) return;
    }
    try { await call('products.setActive', { id, active: !p.active, reason }); navigate('product', { id }); } catch (err) { toastError(err); }
  } }, p.active ? t('products.deactivate') : t('products.activate')) : null;

  page.append(docHeader({
    title: p.label, back: { href: '#/products', label: t('products.title') },
    status: h('span.row', statusBadge(p.stockStatus, t(`stockStatus.${p.stockStatus}`)), p.rxRequired ? h('span.badge.warning', p.controlled ? t('products.controlled') : t('products.rxRequired')) : null, !p.active ? h('span.badge', t('common.inactive')) : null),
    sub: [p.genericName, p.formName, p.manufacturerName, `SKU ${p.sku}`].filter(Boolean).join(' - '),
    actions: [labels, toggle, edit],
  }));

  const tabs = [
    ['overview', t('product.tabOverview')], ['batches', t('product.tabBatches')], ['why', t('product.tabWhy')],
    ['prices', t('product.tabPrices')], ['branch', t('product.tabBranch')],
  ];
  let current = params.tab || 'overview';
  const tabBar = h('div.row', { role: 'tablist', style: { marginBottom: '16px' } });
  const body = h('div');
  page.append(tabBar, body);

  function drawTabs() {
    tabBar.replaceChildren(...tabs.map(([key, label]) => h('button.btn', { type: 'button', role: 'tab', class: key === current ? 'primary' : '', 'aria-selected': String(key === current), onclick: () => { current = key; history.replaceState(null, '', `#/product?id=${id}&tab=${key}`); drawTabs(); show(); } }, label)));
  }

  async function show() {
    mount(body, h('div.loading', h('span.spinner')));
    try {
      if (current === 'overview') overview();
      else if (current === 'batches') await batchesTab();
      else if (current === 'why') await whyTab();
      else if (current === 'prices') await pricesTab();
      else if (current === 'branch') branchTab();
    } catch (err) { mount(body, h('div.form-error', icon('alertCircle', 'sm'), h('div', err.message))); }
  }

  function overview() {
    const units = p.units.map((u) => `${u.name} = ${u.factor} ${p.baseUnit}`).join(', ');
    mount(body, h('div.grid-2', { style: { alignItems: 'start' } },
      h('div.card', h('div.card-head', h('h2', t('product.details'))), h('div.card-body', kv([
        [t('products.brandName'), p.brandName], [t('products.genericName'), p.genericName], [t('products.strength'), p.strength],
        [t('products.form'), p.formName], [t('products.category'), p.categoryName], [t('products.manufacturer'), p.manufacturerName],
        [t('products.drugClass'), p.drugClassName], [t('products.storage'), p.storageName], [t('products.drapRegNo'), p.drapRegNo],
        [t('products.coldChain'), p.coldChain ? t('common.yes') : t('common.no')], [t('products.units'), units],
        [t('products.barcodes'), p.barcodes.map((b) => b.barcode).join(', ')], [t('products.supplier'), p.defaultSupplierName], [t('products.notes'), p.notes],
      ]))),
      h('div.card', h('div.card-head', h('h2', t('product.stockAndPrice'))), h('div.card-body', kv([
        [t('products.onHand'), h('strong', p.onHandText)], [t('products.mrpPerPack'), fmt.money(p.mrp)],
        p.branchMrp !== null ? [t('product.branchPrice'), fmt.money(p.branchMrp)] : null,
        can('cost.view') ? [t('products.tradePerPack'), fmt.money(p.tradePrice)] : null,
        [t('products.taxRate'), `${(p.taxRateBp / 100).toFixed(2)}%`],
        [t('products.reorderLevel'), p.reorderLevel ? `${p.reorderLevel} ${p.baseUnit}` : t('common.none')],
        [t('products.minStock'), p.minStock || '-'], [t('products.maxStock'), p.maxStock || '-'], [t('product.rack'), p.rack],
      ])))));
  }

  async function batchesTab() {
    const res = await call('stock.product', { productId: id });
    const table = dataTable({
      id: 'product-batches', searchable: false, pageSize: 25,
      columns: [
        { key: 'batchNo', label: t('stock.batch'), render: (b) => h('div', h('div.cell-main.row', b.batchNo, b.quarantined ? h('span.badge.danger', t('stock.quarantined')) : null), h('div.cell-sub', b.supplierName || '')) },
        { key: 'expiryDate', label: t('stock.expiry'), render: (b) => h('div.row', fmt.date(b.expiryDate), expiryBadge(b)) },
        { key: 'onHand', label: t('products.onHand'), align: 'num', render: (b) => b.onHandText },
        { key: 'mrp', label: t('products.mrp'), align: 'num', render: (b) => fmt.money(b.mrp) },
        { key: 'cost', label: t('stock.cost'), align: 'num', hidden: !can('cost.view'), render: (b) => fmt.money(b.cost) },
        { key: 'value', label: t('stock.value'), align: 'num', hidden: !can('cost.view'), render: (b) => fmt.money(b.value) },
        { key: 'receivedAt', label: t('stock.received'), render: (b) => fmt.date(b.receivedAt) },
        { key: 'actions', label: '', render: (b) => batchActions(b, () => show()) },
      ],
      rows: res.batches,
      empty: { icon: 'layers', title: t('product.noBatches') },
    });
    mount(body, h('div.stack', h('div.form-note', icon('info', 'sm'), h('div', t('product.batchesNote', { total: res.onHandText }))), table.el));
  }

  async function whyTab() {
    const box = h('div.stack');
    mount(body, box);
    const from = input({ type: 'date', style: { width: '160px' } });
    const to = input({ type: 'date', style: { width: '160px' } });
    const recon = h('div.card');
    async function load() {
      const res = await call('stock.product', { productId: id, from: from.value || undefined, to: to.value || undefined });
      from.value = res.reconciliation.from;
      to.value = res.reconciliation.to;
      const r = res.reconciliation;
      mount(recon, h('div.card-head', h('h2', t('product.why', { qty: res.onHandText }))), h('div.card-body',
        h('table.diff', h('tbody',
          h('tr', h('td', t('product.opening', { date: fmt.date(r.from) })), h('td.num', r.openingText)),
          ...r.movements.map((m) => h('tr', h('td', m.label), h('td.num', { class: m.qty < 0 ? 'old' : 'new' }, (m.qty > 0 ? '+' : '') + m.qtyText))),
          h('tr', h('td', h('strong', t('product.closing', { date: fmt.date(r.to) }))), h('td.num', h('strong', r.closingText))))),
        h('p.small.muted', { style: { marginTop: '8px' } }, t('product.whyNote'))));
    }
    from.addEventListener('change', load);
    to.addEventListener('change', load);
    box.append(h('div.row', h('span.small.muted', t('common.from')), from, h('span.small.muted', t('common.to')), to), recon);
    await load();
    box.append(h('h2', { style: { marginTop: '8px' } }, t('product.allMovements')), ledgerTable({ productId: id, id: 'product-ledger' }));
  }

  async function pricesTab() {
    const [hist, comp] = await Promise.all([
      call('products.priceHistory', { id }),
      can('cost.view') ? call('suppliers.priceComparison', { productId: id }).catch(() => []) : Promise.resolve(null),
    ]);
    const fields = { mrp: t('products.mrp'), trade_price: t('products.tradePrice'), branch_mrp: t('product.branchPrice') };
    const histTable = dataTable({
      id: 'price-history', searchable: false, rows: hist, defaultSort: { key: 'at', dir: 'desc' },
      columns: [
        { key: 'at', label: t('audit.at'), render: (r) => fmt.dateTime(r.at) },
        { key: 'field', label: t('product.priceField'), render: (r) => fields[r.field] || r.field },
        { key: 'oldValue', label: t('audit.before'), align: 'num', render: (r) => fmt.money(r.oldValue) },
        { key: 'newValue', label: t('audit.after'), align: 'num', render: (r) => fmt.money(r.newValue) },
        { key: 'source', label: t('product.priceSource'), render: (r) => t(`priceSource.${r.source}`) },
        { key: 'reason', label: t('audit.reason') },
        { key: 'username', label: t('audit.user') },
      ],
      empty: { icon: 'history', title: t('product.noPriceHistory') },
    });
    const parts = [h('h2', t('product.priceHistory')), histTable.el];
    if (comp) {
      parts.push(h('h2', { style: { marginTop: '16px' } }, t('product.supplierPrices')), dataTable({
        id: 'price-compare', searchable: false, rows: comp,
        columns: [
          { key: 'supplierName', label: t('suppliers.name') },
          { key: 'lastDate', label: t('product.lastBought'), render: (r) => fmt.date(r.lastDate) },
          { key: 'lastPrice', label: t('product.lastTradePrice'), align: 'num', render: (r) => fmt.money(r.lastPrice) },
          { key: 'lastNetCost', label: t('product.lastNetCost'), align: 'num', render: (r) => fmt.money(r.lastNetCost) },
          { key: 'lowestNetCost', label: t('product.lowestNetCost'), align: 'num', render: (r) => fmt.money(r.lowestNetCost) },
          { key: 'purchases', label: t('product.timesBought'), align: 'num' },
        ],
        empty: { icon: 'truck', title: t('product.noPurchases') },
      }).el);
    }
    mount(body, h('div.stack', ...parts));
  }

  function branchTab() {
    const editable = can('products.edit');
    const form = new Form();
    const save = h('button.btn.primary', { type: 'button' }, t('common.saveChanges'));
    const fields = [
      form.add('rack', fieldText(input({ value: p.rack || '', maxlength: 40, readonly: !editable }), t('product.rack'))),
      form.add('reorderLevel', fieldText(input({ type: 'number', min: 0, value: p.reorderLevel !== p.productReorderLevel ? p.reorderLevel : '', placeholder: String(p.productReorderLevel), readonly: !editable }), t('products.reorderLevel'))),
      form.add('reorderQty', fieldText(input({ type: 'number', min: 0, value: p.reorderQty !== p.productReorderQty ? p.reorderQty : '', placeholder: String(p.productReorderQty), readonly: !editable }), t('products.reorderQty'))),
      form.add('minStock', fieldText(input({ type: 'number', min: 0, value: p.minStock !== p.productMinStock ? p.minStock : '', placeholder: String(p.productMinStock), readonly: !editable }), t('products.minStock'))),
      form.add('maxStock', fieldText(input({ type: 'number', min: 0, value: p.maxStock !== p.productMaxStock ? p.maxStock : '', placeholder: String(p.productMaxStock), readonly: !editable }), t('products.maxStock'))),
    ];
    if (can('prices.branch_override')) {
      fields.push(form.add('branchMrp', fieldText(moneyInput({ value: rupees(p.branchMrp), placeholder: t('product.branchPricePh') }), t('product.branchPrice'), { hint: t('product.branchPriceHint') })));
      fields.push(form.add('priceReason', fieldText(input({ maxlength: 300 }), t('products.priceReason'))));
    }
    save.onclick = () => busy(save, null, async () => {
      form.clearErrors();
      try {
        p = await call('products.setBranch', { id, ...form.values() });
        toast(t('common.saved'));
        branchTab();
      } catch (err) { form.showError(err); }
    });
    mount(body, h('div.card', h('div.card-head', h('div', h('h2', t('product.branchValues', { branch: state.me.branch.name })), h('p.small.muted', t('product.branchValuesHint')))),
      h('div.card-body.stack', form.errorBox, h('div.form-grid', ...fields), editable ? h('div.row', h('div.spacer'), save) : null)));
  }

  drawTabs();
  await show();
}

// Medicines and products: list with stock status, add and edit.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import { dataTable } from '../ui/table.js';
import { openModal } from '../ui/modal.js';
import { Form, fieldText, input, textarea, checkbox, busy } from '../ui/form.js';
import { combobox } from '../ui/combobox.js';
import { toast, toastError } from '../ui/toast.js';
import { statusBadge, exportButton, filterSelect, moneyInput, rupees } from '../ui/stockui.js';
import * as fmt from '../ui/format.js';

export async function render(page, { params, navigate }) {
  const lists = await call('lookups.all');
  const filter = { categoryId: '', manufacturerId: '', status: 'active', stockStatus: params.stock || '', rx: '' };

  const isHeadOffice = !state.me || !state.me.branch || state.me.branch.isHeadOffice;
  const addBtn = (can('products.create') && isHeadOffice) ? h('button.btn.primary', { type: 'button', onclick: () => openProductForm(null, { lists, onSaved: (p) => navigate('product', { id: p.id }) }) }, icon('plus', 'sm'), t('products.add')) : null;
  const importBtn = (can('import.create') && isHeadOffice) ? h('a.btn', { href: '#/import?kind=products' }, icon('download', 'sm'), t('import.title')) : null;
  const columns = [
    { key: 'sku', label: t('products.sku'), width: '120px', render: (p) => h('span.mono', p.sku), hidden: true },
    { key: 'brandName', label: t('products.name'), render: (p) => h('div', h('div.cell-main.row', p.label, p.rxRequired ? h('span.badge.warning', p.controlled ? t('products.controlledShort') : t('products.rxShort')) : null, !p.active ? h('span.badge', t('common.inactive')) : null), h('div.cell-sub', [p.genericName, p.formName].filter(Boolean).join(' - '))) },
    { key: 'manufacturerName', label: t('products.manufacturer') },
    { key: 'categoryName', label: t('products.category'), hidden: true },
    { key: 'packSize', label: t('products.pack'), sortable: false, render: (p) => (p.packSize > 1 ? `${p.packUnit} of ${p.packSize}` : p.baseUnit) },
    { key: 'mrp', label: t('products.mrp'), align: 'num', render: (p) => fmt.money(p.mrp) },
    { key: 'onHand', label: t('products.onHand'), align: 'num', render: (p) => h('span', { class: p.onHand > 0 ? '' : 'muted' }, p.onHandText) },
    { key: 'stockStatus', label: t('products.stockStatus'), sortable: false, render: (p) => statusBadge(p.stockStatus, t(`stockStatus.${p.stockStatus}`)) },
    { key: 'nearestExpiry', label: t('products.nearestExpiry'), sortable: false, render: (p) => (p.nearestExpiry ? fmt.date(p.nearestExpiry) : '') },
    { key: 'stockValue', label: t('products.stockValue'), align: 'num', sortable: false, hidden: !can('cost.view'), render: (p) => fmt.money(p.stockValue) },
  ];
  const exportBtn = exportButton({
    source: 'products.list', title: t('products.title'), perm: 'products.export', getParams: () => ({ ...filter }),
    columns: [
      { key: 'sku', label: 'SKU' }, { key: 'brandName', label: 'Brand name' }, { key: 'genericName', label: 'Generic name' }, { key: 'strength', label: 'Strength' },
      { key: 'formName', label: 'Form' }, { key: 'categoryName', label: 'Category' }, { key: 'manufacturerName', label: 'Manufacturer' },
      { key: 'packUnit', label: 'Pack unit' }, { key: 'packSize', label: 'Units in pack', type: 'number' }, { key: 'mrp', label: 'MRP', type: 'money' },
      { key: 'tradePrice', label: 'Trade price', type: 'money' }, { key: 'onHand', label: 'On hand (smallest units)', type: 'number', total: true },
      { key: 'onHandText', label: 'On hand' }, { key: 'stockValue', label: 'Stock value', type: 'money', total: true }, { key: 'nearestExpiry', label: 'Nearest expiry' },
    ],
  });
  page.append(h('div.page-head', h('div', h('h1', t('products.title')), h('p.sub', t('products.sub'))), h('div.row', importBtn, exportBtn, addBtn)));

  const cat = combobox({ options: lists.category.map((c) => ({ value: c.id, label: c.name })), emptyLabel: `${t('products.category')}: ${t('common.all')}`, onChange: (v) => { filter.categoryId = v; reload(); } });
  const man = combobox({ options: lists.manufacturer.map((c) => ({ value: c.id, label: c.name })), emptyLabel: `${t('products.manufacturer')}: ${t('common.all')}`, onChange: (v) => { filter.manufacturerId = v; reload(); } });
  cat.style.width = '190px';
  man.style.width = '190px';
  const stockSel = filterSelect([
    { value: '', label: `${t('products.stockStatus')}: ${t('common.all')}` }, { value: 'in', label: t('stockStatus.in') }, { value: 'low', label: t('stockStatus.low') },
    { value: 'out', label: t('stockStatus.out') }, { value: 'over', label: t('stockStatus.over') },
  ], (v) => { filter.stockStatus = v; reload(); }, { value: filter.stockStatus });
  const statusSel = filterSelect([{ value: 'active', label: t('common.active') }, { value: 'inactive', label: t('common.inactive') }, { value: '', label: t('common.all') }], (v) => { filter.status = v; reload(); }, { width: '130px' });
  const rxSel = filterSelect([{ value: '', label: `${t('products.rxFilter')}: ${t('common.all')}` }, { value: 'rx', label: t('products.rxOnly') }, { value: 'controlled', label: t('products.controlledOnly') }], (v) => { filter.rx = v; reload(); });

  const table = dataTable({
    id: 'products', columns, tools: [cat, man, stockSel, rxSel, statusSel], searchPlaceholder: t('products.searchPh'),
    fetch: async (opts) => { try { return await call('products.list', { ...filter, ...opts }); } catch (err) { toastError(err); return { rows: [], total: 0 }; } },
    onRowClick: (p) => navigate('product', { id: p.id }),
    empty: { icon: 'pill', title: t('products.empty'), text: t('products.emptyText'), action: addBtn ? h('button.btn.primary', { type: 'button', onclick: () => addBtn.click() }, t('products.add')) : null },
  });
  page.append(table.el);
  function reload() { table.resetPage(); table.refresh(); }
  if (params.new && can('products.create') && addBtn) { history.replaceState(null, '', '#/products'); addBtn.click(); }
}

// Product form, used for add and edit. `p` is the product detail on edit.
export function openProductForm(p, { lists, onSaved }) {
  const isNew = !p;
  const v = p || { baseUnit: 'Tablet', packUnit: 'Strip', packSize: 10, units: [], barcodes: [] };
  const form = new Form();
  const lookupBox = (kind, value, label) => {
    const box = combobox({ options: lists[kind].map((x) => ({ value: x.id, label: x.name })), value: value || '', emptyLabel: t('common.none') });
    return box;
  };
  const unitOptions = lists.unit.map((u) => u.name);
  const unitInput = (value) => {
    const el = input({ value: value || '', maxlength: 30, list: 'unit-names' });
    return el;
  };
  const datalist = h('datalist', { id: 'unit-names' }, ...unitOptions.map((u) => h('option', { value: u })));

  // Manufacturer can be typed new.
  const manNew = input({ maxlength: 80, placeholder: t('products.newManufacturerPh') });
  const extraUnits = (v.units || []).filter((u) => u.factor !== 1 && u.factor !== v.packSize);
  const unitsBox = h('div.stack.tight');
  function unitRow(u = {}) {
    const name = input({ value: u.name || '', maxlength: 30, placeholder: t('products.unitNamePh'), list: 'unit-names' });
    const factor = input({ type: 'number', min: 1, value: u.factor || '', placeholder: t('products.unitFactorPh'), style: { width: '120px' } });
    const row = h('div.row', name, factor, h('button.btn.ghost.sm.icon-only', { type: 'button', 'aria-label': t('common.remove'), onclick: () => row.remove() }, icon('x', 'sm')));
    row.read = () => ({ name: name.value.trim(), factor: factor.value });
    unitsBox.append(row);
  }
  for (const u of extraUnits) unitRow(u);
  const barcodes = textarea({ rows: 2, value: (v.barcodes || []).map((b) => b.barcode).join('\n'), placeholder: t('products.barcodesPh') });

  const rx = checkbox(t('products.rxRequired'), { checked: !!v.rxRequired });
  const controlled = checkbox(t('products.controlled'), { checked: !!v.controlled });
  const cold = checkbox(t('products.coldChain'), { checked: !!v.coldChain });
  controlled.control.addEventListener('change', () => { if (controlled.control.checked) rx.control.checked = true; });

  const packLocked = p && p.hasMovements;
  const body = [
    form.errorBox,
    h('div.section-title', t('products.sectionIdentity')),
    h('div.form-grid',
      form.add('brandName', fieldText(input({ value: v.brandName || '', maxlength: 120, autofocus: true }), t('products.brandName'), { required: true })),
      form.add('genericName', fieldText(input({ value: v.genericName || '', maxlength: 200 }), t('products.genericName'))),
      form.add('strength', fieldText(input({ value: v.strength || '', maxlength: 60, placeholder: '500mg' }), t('products.strength'))),
      form.add('sku', fieldText(input({ value: v.sku || '', maxlength: 40, placeholder: isNew ? t('products.skuAuto') : '' }), t('products.sku'))),
      form.add('formId', fieldText(lookupBox('form', v.formId), t('products.form'))),
      form.add('categoryId', fieldText(lookupBox('category', v.categoryId), t('products.category'))),
      form.add('manufacturerId', fieldText(lookupBox('manufacturer', v.manufacturerId), t('products.manufacturer'))),
      form.add('manufacturerIdNew', fieldText(manNew, t('products.newManufacturer'), { hint: t('products.newManufacturerHint') })),
      form.add('drugClassId', fieldText(lookupBox('drug_class', v.drugClassId), t('products.drugClass'))),
      form.add('storageId', fieldText(lookupBox('storage', v.storageId), t('products.storage'))),
      form.add('drapRegNo', fieldText(input({ value: v.drapRegNo || '', maxlength: 60 }), t('products.drapRegNo'))),
      h('div.field', h('label', t('products.flags')), rx, controlled, cold)),
    form.add('rxRequired', { el: h('span'), input: rx.control, setError: (m) => toast(m, { type: 'error' }), clearError() {} }),
    h('div.section-title', { style: { marginTop: '16px' } }, t('products.sectionUnits')),
    h('div.form-grid',
      form.add('baseUnit', fieldText(unitInput(v.baseUnit), t('products.baseUnit'), { required: true, hint: t('products.baseUnitHint') })),
      form.add('packUnit', fieldText(unitInput(v.packUnit), t('products.packUnit'), { required: true, hint: t('products.packUnitHint') })),
      form.add('packSize', fieldText(input({ type: 'number', min: 1, value: v.packSize || 1, readonly: packLocked }), t('products.packSize'), { required: true, hint: packLocked ? t('products.packLockedHint') : t('products.packSizeHint') })),
      h('div.field', h('label', t('products.moreUnits')), unitsBox, h('button.btn.sm', { type: 'button', onclick: () => unitRow() }, icon('plus', 'sm'), t('products.addUnit')), h('div.hint', t('products.moreUnitsHint')))),
    form.add('units', { el: h('span'), input: h('input'), setError: (m) => toast(m, { type: 'error' }), clearError() {} }),
    form.add('barcodes', fieldText(barcodes, t('products.barcodes'), { hint: t('products.barcodesHint'), span2: true })),
    h('div.section-title', { style: { marginTop: '16px' } }, t('products.sectionPrices')),
    h('div.form-grid',
      form.add('mrp', fieldText(moneyInput({ value: rupees(v.mrp) }), t('products.mrpPerPack'), { hint: t('products.mrpHint') })),
      can('cost.view') ? form.add('tradePrice', fieldText(moneyInput({ value: rupees(v.tradePrice) }), t('products.tradePerPack'))) : h('span'),
      form.add('taxRate', fieldText(input({ type: 'number', min: 0, max: 100, step: '0.01', value: v.taxRateBp ? v.taxRateBp / 100 : 0 }), t('products.taxRate'), { hint: t('products.taxHint') })),
      form.add('discountPercent', fieldText(input({ type: 'number', min: 0, max: 100, step: '0.1', value: v.discountPercent || '' }), t('products.defaultDiscount'), { hint: t('products.defaultDiscountHint') })),
      !isNew ? form.add('priceReason', fieldText(input({ maxlength: 300 }), t('products.priceReason'), { hint: t('products.priceReasonHint') })) : h('span')),
    h('div.section-title', { style: { marginTop: '16px' } }, t('products.sectionLevels')),
    h('p.small.muted', t('products.levelsHint')),
    h('div.form-grid',
      form.add('reorderLevel', fieldText(input({ type: 'number', min: 0, value: v.productReorderLevel || 0 }), t('products.reorderLevel'))),
      form.add('reorderQty', fieldText(input({ type: 'number', min: 0, value: v.productReorderQty || 0 }), t('products.reorderQty'))),
      form.add('minStock', fieldText(input({ type: 'number', min: 0, value: v.productMinStock || 0 }), t('products.minStock'))),
      form.add('maxStock', fieldText(input({ type: 'number', min: 0, value: v.productMaxStock || 0 }), t('products.maxStock')))),
    form.add('notes', fieldText(textarea({ value: v.notes || '', maxlength: 1000 }), t('products.notes'), { span2: true })),
    datalist,
  ];

  const save = h('button.btn.primary', { type: 'button' }, isNew ? t('common.create') : t('common.saveChanges'));
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const m = openModal({ title: isNew ? t('products.add') : t('products.edit'), body, footer: [cancel, save], size: 'wide' });
  cancel.onclick = () => m.close();
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    const values = form.values();
    const typedManNew = manNew.value.trim();
    let mfrId = values.manufacturerId || '';
    let mfrNew = typedManNew;
    const comboText = (form.fields.manufacturerId && form.fields.manufacturerId.input && form.fields.manufacturerId.input.value || '').trim();
    if (!mfrId && !mfrNew && comboText && comboText !== t('common.none')) {
      const match = (lists.manufacturer || []).find((x) => x.name.toLowerCase() === comboText.toLowerCase());
      if (match) mfrId = match.id;
      else mfrNew = comboText;
    }
    const payload = {
      ...values,
      id: p ? p.id : undefined,
      manufacturerId: mfrId,
      manufacturerIdNew: mfrId ? '' : mfrNew,
      rxRequired: rx.control.checked, controlled: controlled.control.checked, coldChain: cold.control.checked,
      units: [...unitsBox.children].map((r) => r.read()).filter((u) => u.name || u.factor),
      barcodes: barcodes.value.split(/[\s,]+/).map((b) => b.trim()).filter(Boolean),
    };
    if (!can('cost.view')) delete payload.tradePrice;
    try {
      const saved = await call(isNew ? 'products.create' : 'products.update', payload);
      try {
        const fresh = await call('lookups.all');
        Object.assign(lists, fresh);
      } catch (_) {}
      m.close();
      const prodName = saved.label || saved.brandName || values.brandName || t('nav.product');
      toast(isNew ? t('products.createdSuccess', { name: prodName }) : t('products.updatedSuccess', { name: prodName }), {
        type: 'success',
        title: isNew ? t('products.addedTitle') : t('products.updatedTitle'),
      });
      if (onSaved) onSaved(saved);
    } catch (err) { form.showError(err); }
  });
}

// Receipt printer and customer display for this computer only.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { Form, fieldText, select, checkbox, busy } from '../ui/form.js';
import { toast } from '../ui/toast.js';

export async function render(page) {
  const s = await call('device.settings');
  page.append(h('div.page-head', h('div', h('h1', t('printer.title')), h('p.sub', t('printer.sub')))));
  const form = new Form();
  const printer = select([{ value: '', label: t('printer.ask') }, ...s.printers.map((p) => ({ value: p.name, label: p.displayName + (p.isDefault ? ` (${t('printer.default')})` : '') }))], { value: s.printerName, disabled: !s.canEdit });
  const paper = select([{ value: '', label: t('printer.branchPaper') }, { value: '58', label: '58 mm' }, { value: '80', label: '80 mm' }, { value: 'A4', label: 'A4' }], { value: s.paper, disabled: !s.canEdit });
  const silent = checkbox(t('printer.silent'), { checked: s.silentPrint, disabled: !s.canEdit });
  const display = checkbox(t('printer.display'), { checked: s.customerDisplay, disabled: !s.canEdit });
  const save = h('button.btn.primary', { type: 'button', disabled: !s.canEdit }, t('common.saveChanges'));
  save.onclick = () => busy(save, null, async () => {
    form.clearErrors();
    try {
      await call('device.saveSettings', { printerName: printer.value, paper: paper.value, silentPrint: silent.control.checked, customerDisplay: display.control.checked });
      toast(t('common.saved'));
    } catch (err) { form.showError(err); }
  });
  page.append(h('div.card', h('div.card-body.stack',
    !s.printers.length ? h('div.form-note', icon('info', 'sm'), h('div', t('printer.none'))) : null,
    form.errorBox,
    h('div.form-grid', form.add('printerName', fieldText(printer, t('printer.printer'))), form.add('paper', fieldText(paper, t('printer.paper')))),
    silent, h('p.small.muted', t('printer.silentHint')),
    display, h('p.small.muted', t('printer.displayHint')),
    h('div.form-note', icon('info', 'sm'), h('div', t('printer.drawerNote'))),
    s.canEdit ? h('div.row', h('span.spacer'), save) : h('p.small.muted', t('settings.readOnlyBranch')))));
}

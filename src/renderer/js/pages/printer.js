// Receipt printer, branding, content options, live interactive preview and hardware guide.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { Form, fieldText, textarea, select, checkbox, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';

export async function render(page) {
  const s = await call('device.settings');
  const form = new Form();

  // ---- Controls ----
  const printer = select([
    { value: '', label: t('printer.ask') },
    ...s.printers.map((p) => ({ value: p.name, label: p.displayName + (p.isDefault ? ` (${t('printer.default')})` : '') })),
  ], { value: s.printerName || '', disabled: !s.canEdit });

  const paper = select([
    { value: '80', label: '80 mm (Standard Thermal Slip)' },
    { value: '58', label: '58 mm (Compact Thermal Roll)' },
    { value: '52', label: '52 mm (Mini Thermal Slip)' },
    { value: 'A4', label: 'A4 (Standard Laser / Inkjet Page)' },
  ], { value: s.paper || '80', disabled: !s.canEdit });

  const silent = checkbox(t('printer.silent'), { checked: s.silentPrint, disabled: !s.canEdit });
  const openDrawer = checkbox(t('printer.openDrawer'), { checked: s.openDrawer, disabled: !s.canEdit });
  const display = checkbox(t('printer.display'), { checked: s.customerDisplay, disabled: !s.canEdit });
  const copies = select([
    { value: 1, label: t('printer.copies1') },
    { value: 2, label: t('printer.copies2') },
  ], { value: s.copies || 1, disabled: !s.canEdit });

  // Branding & Header Customization
  const showLogo = checkbox(t('printer.showLogo'), { checked: s.showLogo !== false, disabled: !s.canEdit });
  const logoPlacement = select([
    { value: 'center', label: t('printer.logoCenter') },
    { value: 'left', label: t('printer.logoLeft') },
    { value: 'right', label: t('printer.logoRight') },
  ], { value: s.logoPlacement || 'center', disabled: !s.canEdit });

  const logoSize = select([
    { value: 'small', label: t('printer.logoSizeSm') },
    { value: 'medium', label: t('printer.logoSizeMd') },
    { value: 'large', label: t('printer.logoSizeLg') },
    { value: 'xlarge', label: t('printer.logoSizeXl') },
  ], { value: s.logoSize || 'medium', disabled: !s.canEdit });

  const headerText = textarea({ value: s.headerText || '', rows: 3, maxlength: 1000, placeholder: t('printer.headerTextPh'), disabled: !s.canEdit });

  const headerAlignment = select([
    { value: 'center', label: t('printer.alignCenter') },
    { value: 'left', label: t('printer.alignLeft') },
    { value: 'right', label: t('printer.alignRight') },
  ], { value: s.headerAlignment || 'center', disabled: !s.canEdit });

  const headerSize = select([
    { value: 'small', label: t('printer.sizeSm') },
    { value: 'normal', label: t('printer.sizeMd') },
    { value: 'large', label: t('printer.sizeLg') },
  ], { value: s.headerSize || 'normal', disabled: !s.canEdit });

  const showAddress = checkbox(t('printer.showAddress'), { checked: s.showBranchAddress !== false, disabled: !s.canEdit });
  const showPhone = checkbox(t('printer.showPhone'), { checked: s.showBranchPhone !== false, disabled: !s.canEdit });
  const showLicence = checkbox(t('printer.showLicence'), { checked: s.showBranchLicence !== false, disabled: !s.canEdit });
  const showNtn = checkbox(t('printer.showNtn'), { checked: s.showBranchNtn !== false, disabled: !s.canEdit });

  // Body content & Footer Customization
  const showBatch = checkbox(t('printer.showBatch'), { checked: s.showBatchExpiry !== false, disabled: !s.canEdit });
  const showDiscount = checkbox(t('printer.showDiscount'), { checked: s.showItemDiscount !== false, disabled: !s.canEdit });
  const showBarcode = checkbox(t('printer.showBarcode'), { checked: s.showBarcode !== false, disabled: !s.canEdit });

  const footerText = textarea({
    value: s.footerText !== undefined ? s.footerText : 'Thank you for your visit. Medicines once sold are returnable within 7 days with the receipt.',
    rows: 3,
    maxlength: 1000,
    placeholder: t('printer.footerTextPh'),
    disabled: !s.canEdit,
  });

  const footerAlignment = select([
    { value: 'center', label: t('printer.alignCenter') },
    { value: 'left', label: t('printer.alignLeft') },
    { value: 'right', label: t('printer.alignRight') },
  ], { value: s.footerAlignment || 'center', disabled: !s.canEdit });

  const footerSize = select([
    { value: 'small', label: t('printer.sizeSm') },
    { value: 'normal', label: t('printer.sizeMd') },
    { value: 'large', label: t('printer.sizeLg') },
  ], { value: s.footerSize || 'normal', disabled: !s.canEdit });

  // Collect current values
  function currentValues() {
    return {
      printerName: printer.value,
      paper: paper.value || '80',
      silentPrint: silent.control.checked,
      openDrawer: openDrawer.control.checked,
      customerDisplay: display.control.checked,
      copies: Number(copies.value) || 1,
      showLogo: showLogo.control.checked,
      logoPlacement: logoPlacement.value || 'center',
      logoSize: logoSize.value || 'medium',
      headerText: headerText.value.trim(),
      headerAlignment: headerAlignment.value || 'center',
      headerSize: headerSize.value || 'normal',
      showBranchAddress: showAddress.control.checked,
      showBranchPhone: showPhone.control.checked,
      showBranchLicence: showLicence.control.checked,
      showBranchNtn: showNtn.control.checked,
      showBatchExpiry: showBatch.control.checked,
      showItemDiscount: showDiscount.control.checked,
      showBarcode: showBarcode.control.checked,
      footerText: footerText.value.trim(),
      footerAlignment: footerAlignment.value || 'center',
      footerSize: footerSize.value || 'normal',
    };
  }

  // ---- Test print action ----
  const doTestPrint = async (btn, targetPaper) => {
    await busy(btn, t('printer.testing'), async () => {
      try {
        const vals = currentValues();
        if (targetPaper) vals.paper = targetPaper;
        const res = await call('device.testPrint', vals);
        if (res.printed) toast(t('printer.testSent'));
        else if (res.reason) toast(res.reason, { type: 'warning' });
        else toast(t('printer.testSent'));
      } catch (err) {
        toastError(err);
      }
    });
  };

  // ---- Full-Screen Auto-Fit Modal Preview (Zero Scrollbars) ----
  async function showReceiptPreviewModal(initialFormat) {
    let currentFormat = initialFormat;
    const paperEl = h('div.receipt-paper');
    const scaleBox = h('div.receipt-scale-box', paperEl);
    const stage = h('div.receipt-fit-stage', scaleBox);

    // Format switcher pills inside modal header
    const fmtPills = [
      { id: 'A4', label: t('printer.previewA4') },
      { id: '80', label: t('printer.preview80') },
      { id: '52', label: t('printer.preview52') },
    ];
    const pillButtons = fmtPills.map((p) => {
      const btn = h('button.btn.sm', {
        type: 'button',
        class: p.id === currentFormat ? 'primary' : '',
        onclick: () => switchFormat(p.id),
      }, p.label);
      return { id: p.id, btn };
    });

    const headTitle = h('div.row', { style: { gap: '16px', alignItems: 'center' } },
      h('span', t('printer.previewTitle')),
      h('div.row', { style: { gap: '6px' } }, ...pillButtons.map((x) => x.btn))
    );

    const printBtn = h('button.btn.primary', { type: 'button' }, icon('printer', 'sm'), t('printer.testPrint'));
    printBtn.onclick = () => doTestPrint(printBtn, currentFormat);

    const closeBtn = h('button.btn', { type: 'button' }, t('common.close'));

    let ro = null;
    const m = openModal({
      title: headTitle,
      size: 'receipt-preview-modal',
      body: stage,
      footer: [printBtn, closeBtn],
      onClose: () => {
        if (ro) ro.disconnect();
      },
    });
    closeBtn.onclick = () => m.close();

    function fitReceipt() {
      if (!paperEl || !stage) return;
      paperEl.style.transform = 'none';
      scaleBox.style.width = 'auto';
      scaleBox.style.height = 'auto';

      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      if (!stageW || !stageH) return;

      const padW = 32;
      const padH = 32;
      const availW = Math.max(80, stageW - padW);
      const availH = Math.max(80, stageH - padH);

      const paperW = paperEl.offsetWidth || (currentFormat === 'A4' ? 794 : currentFormat === '52' ? 220 : 340);
      const paperH = paperEl.offsetHeight || (currentFormat === 'A4' ? 1123 : 500);

      const scaleX = availW / paperW;
      const scaleY = availH / paperH;
      // Fit completely in screen with full available size, no scrollbars!
      const scale = Math.min(scaleX, scaleY, 1.0);

      paperEl.style.transform = `scale(${scale})`;
      paperEl.style.transformOrigin = 'center center';
      scaleBox.style.width = `${Math.round(paperW * scale)}px`;
      scaleBox.style.height = `${Math.round(paperH * scale)}px`;
    }

    ro = new ResizeObserver(() => fitReceipt());
    ro.observe(stage);

    async function switchFormat(fmt) {
      currentFormat = fmt;
      pillButtons.forEach((x) => x.btn.classList.toggle('primary', x.id === currentFormat));
      await loadPreview();
    }

    async function loadPreview() {
      const vals = { ...currentValues(), paper: currentFormat };
      const cls = currentFormat === '52' ? 'w52' : currentFormat === '58' ? 'w58' : currentFormat === 'A4' ? 'wa4' : 'w80';
      paperEl.className = `receipt-paper ${cls}`;
      try {
        const res = await call('device.sampleReceipt', vals);
        const parser = new DOMParser();
        const doc = parser.parseFromString(res.html, 'text/html');

        const shadow = paperEl.shadowRoot || paperEl.attachShadow({ mode: 'open' });
        shadow.replaceChildren();

        // Original style sheets from the receipt renderer
        for (const st of doc.querySelectorAll('style')) {
          shadow.append(st.cloneNode(true));
        }

        // Preview helper styles
        const basePt = currentFormat === '52' ? 7.5 : currentFormat === '58' ? 8.2 : currentFormat === '80' ? 9.5 : 10.5;
        const helperStyle = document.createElement('style');
        helperStyle.textContent = `
          :host {
            display: block;
            width: 100%;
            color: #000;
            background: #fff;
            font-family: Arial, "Segoe UI", sans-serif;
            font-size: ${basePt}pt !important;
            line-height: 1.3 !important;
            user-select: text;
            box-sizing: border-box;
          }
          .doc {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            box-sizing: border-box !important;
            font-size: ${basePt}pt !important;
            line-height: 1.3 !important;
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            box-sizing: border-box !important;
          }
          td, th {
            padding: 2px 2px !important;
            vertical-align: top !important;
            box-sizing: border-box !important;
          }
          .num {
            text-align: right !important;
          }
          .items.thermal {
            table-layout: fixed !important;
          }
          .items th.qty-col, .items td.qty {
            width: 28% !important;
            text-align: left !important;
          }
          .items th.price-col, .items td.price-cell {
            width: 38% !important;
            text-align: right !important;
          }
          .items th.amt-col, .items td.amt-cell {
            width: 34% !important;
            text-align: right !important;
          }
          .items th {
            padding-bottom: 3px !important;
            border-bottom: 1px solid #000 !important;
            font-weight: bold !important;
          }
          .items .name {
            padding-top: 4px !important;
            font-weight: bold !important;
            word-break: break-word !important;
          }
          .items.a4 {
            table-layout: auto !important;
          }
          .items.a4 td, .items.a4 th {
            padding: 6px 8px !important;
          }
          .meta {
            width: 100% !important;
            table-layout: fixed !important;
          }
          .meta td:first-child {
            width: 35% !important;
          }
          .meta td.num {
            width: 65% !important;
            text-align: right !important;
            word-break: break-word !important;
            white-space: normal !important;
          }
          .totals {
            width: 100% !important;
            table-layout: fixed !important;
          }
          .totals td:first-child {
            width: 55% !important;
            word-break: break-word !important;
          }
          .totals td.num {
            width: 45% !important;
            text-align: right !important;
            white-space: nowrap !important;
          }
          .code {
            text-align: center !important;
            margin-top: 8px !important;
            width: 100% !important;
          }
          .code svg {
            max-width: 100% !important;
            width: auto !important;
            height: auto !important;
            display: block !important;
            margin: 0 auto !important;
          }
        `;
        shadow.append(helperStyle);

        const docEl = doc.querySelector('.doc');
        if (docEl) {
          shadow.append(document.importNode(docEl, true));
        }

        requestAnimationFrame(() => requestAnimationFrame(fitReceipt));
      } catch (err) {
        paperEl.replaceChildren(h('div.form-note', icon('alertCircle', 'sm'), String(err.message || err)));
      }
    }

    await loadPreview();
  }

  const testBtnHead = h('button.btn', { type: 'button' }, icon('printer', 'sm'), t('printer.testPrint'));
  testBtnHead.onclick = () => doTestPrint(testBtnHead);

  // ---- Save action ----
  const saveBtn = h('button.btn.primary', { type: 'button', disabled: !s.canEdit }, icon('check', 'sm'), t('common.saveChanges'));
  saveBtn.onclick = () => busy(saveBtn, null, async () => {
    form.clearErrors();
    try {
      const vals = currentValues();
      await call('device.saveSettings', vals);
      toast(t('common.saved'));
    } catch (err) {
      form.showError(err);
    }
  });

  // ---- Header ----
  page.append(h('div.page-head',
    h('div', h('h1', t('printer.title')), h('p.sub', t('printer.sub'))),
    h('div.row', testBtnHead, s.canEdit ? saveBtn : null)));

  // ---- Preview Bar: "see the preview in :" with 3 buttons ----
  const previewBar = h('div.card.printer-preview-bar',
    h('div.preview-bar-content',
      h('div.preview-prompt-text', t('printer.seePreviewIn')),
      h('div.row.preview-buttons-wrap',
        h('button.btn.preview-choice-btn', { type: 'button', onclick: () => showReceiptPreviewModal('A4') }, icon('receipt', 'sm'), t('printer.previewA4')),
        h('button.btn.preview-choice-btn', { type: 'button', onclick: () => showReceiptPreviewModal('80') }, icon('receipt', 'sm'), t('printer.preview80')),
        h('button.btn.preview-choice-btn', { type: 'button', onclick: () => showReceiptPreviewModal('52') }, icon('receipt', 'sm'), t('printer.preview52')))));
  page.append(previewBar);

  // ---- Cards ----
  const hardwareCard = h('div.card',
    h('div.card-head', h('h2', t('printer.hardwareSection'))),
    h('div.card-body.stack',
      !s.printers.length ? h('div.form-note', icon('info', 'sm'), h('div', t('printer.none'))) : null,
      form.errorBox,
      h('div.form-grid',
        form.add('printerName', fieldText(printer, t('printer.printer'))),
        form.add('paper', fieldText(paper, t('printer.paper')))),
      h('div.form-grid',
        form.add('copies', fieldText(copies, t('printer.copies'))),
        silent),
      p(t('printer.silentHint')),
      openDrawer,
      p(t('printer.drawerNote')),
      display,
      p(t('printer.displayHint'))));

  const brandingCard = h('div.card',
    h('div.card-head', h('h2', t('printer.brandingSection'))),
    h('div.card-body.stack',
      h('div.form-grid',
        showLogo,
        form.add('logoPlacement', fieldText(logoPlacement, t('printer.logoPlacement')))),
      h('div.form-grid',
        form.add('logoSize', fieldText(logoSize, t('printer.logoSize'))),
        form.add('headerAlignment', fieldText(headerAlignment, t('printer.headerAlign')))),
      h('div.form-grid',
        form.add('headerSize', fieldText(headerSize, t('printer.headerSize')))),
      form.add('headerText', fieldText(headerText, t('printer.headerText'))),
      h('div.section-title', 'Pharmacy contact info on slip'),
      h('div.form-grid', showAddress, showPhone, showLicence, showNtn)));

  const contentCard = h('div.card',
    h('div.card-head', h('h2', t('printer.contentSection'))),
    h('div.card-body.stack',
      h('div.form-grid', showBatch, showDiscount, showBarcode),
      h('div.form-grid',
        form.add('footerAlignment', fieldText(footerAlignment, t('printer.footerAlign'))),
        form.add('footerSize', fieldText(footerSize, t('printer.footerSize')))),
      form.add('footerText', fieldText(footerText, t('printer.footerText')))));

  const guideCard = h('div.card',
    h('div.card-head', h('h2', t('printer.guideSection'))),
    h('div.card-body.stack',
      guideItem(t('printer.guideThermal'), t('printer.guideThermalText')),
      guideItem(t('printer.guideLaser'), t('printer.guideLaserText')),
      guideItem(t('printer.guideTest'), t('printer.guideTestText'))));

  const leftColumn = h('div.stack', hardwareCard, guideCard);
  const rightColumn = h('div.stack', brandingCard, contentCard);

  // ---- 2-Column Grid Mount ----
  page.append(h('div.grid-2', { style: { alignItems: 'start' } }, leftColumn, rightColumn));
}

function p(text) {
  return h('p.small.muted', { style: { marginTop: '-4px' } }, text);
}

function guideItem(title, text) {
  return h('div.printer-guide-item', h('h4', title), h('p', text));
}

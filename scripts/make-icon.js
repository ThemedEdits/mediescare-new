'use strict';
// Draws mediescare-icons/mediescare-icon.svg with Electron and writes build/icon.png (512) and build/icon.ico
// (16 to 256 px, PNG entries) for the installer and the window. Run: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeImage } = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'mediescare-icons', 'mediescare-icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent"><img id="i" style="width:512px;height:512px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const big = img.resize({ width: 512, height: 512, quality: 'best' });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), big.toPNG());
  const pngs = SIZES.map((size) => ({ size, data: nativeImage.createFromBuffer(big.toPNG()).resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
  console.log(`written ${path.join(out, 'icon.png')} and icon.ico (${SIZES.join(', ')} px)`);
  app.exit(0);
});

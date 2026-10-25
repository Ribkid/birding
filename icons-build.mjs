import { chromium } from 'playwright';
import fs from 'fs';
const svg = fs.readFileSync('/home/claude/birddex/icons/icon.svg', 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.12]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = size * (1 - pad * 2);
  await p.setContent(`<body style="margin:0;background:#1A5FCC;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await p.screenshot({ path: `/home/claude/birddex/icons/${name}.png` });
}
await b.close();

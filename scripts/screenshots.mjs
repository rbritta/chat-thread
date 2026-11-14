// Regenerates the README images from the demo: `npm run screenshots` (needs Chrome or Edge).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { serve } from './serve-demo.mjs';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/demo/`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : { channel: process.env.PW_CHANNEL || 'chrome' }),
});

/** One part of the demo as a PNG buffer (or the whole page), with the system in `colorScheme`. */
async function capture({ width, height = 900, scale = 2, section, colorScheme = 'dark', path }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce', colorScheme });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-thread="scheduled"] .ct-msg');
  await page.evaluate(() => document.fonts.ready);
  const target = section ? page.locator(section) : page;
  const png = await target.screenshot({ path, ...(section ? {} : { fullPage: true }) });
  await ctx.close();
  return png;
}

async function shot(name, options) {
  await capture({ ...options, path: `${docs}${name}.png` });
  console.log(`docs/${name}.png`);
}

/** The same part of the demo with the system light and then dark, side by side in one image. */
async function lightAndDark(name, options, scale = 2) {
  const images = [];
  for (const colorScheme of ['light', 'dark']) {
    const png = await capture({ ...options, scale, colorScheme });
    images.push({ src: `data:image/png;base64,${png.toString('base64')}`, width: png.readUInt32BE(16) / scale });
  }
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(`<body style="margin:0"><div id="pair" style="display:inline-flex;align-items:flex-start;gap:16px">${
    images.map((img) => `<img src="${img.src}" style="width:${img.width}px">`).join('')}</div></body>`);
  await page.locator('#pair').screenshot({ path: `${docs}${name}.png`, omitBackground: true });
  await ctx.close();
  console.log(`docs/${name}.png`);
}

await shot('thread', { width: 1200, section: '#task .frame' });
await shot('session', { width: 1200, section: '#session .frame' });
await shot('reading-phone', { width: 360, height: 780, section: '#reading .frame' });
await shot('log', { width: 1200, section: '#log .frame' });
await shot('whatsapp', { width: 1200, section: '#previews .previews' });
await shot('light', { width: 1200, section: '#themes .frame--light' });
await lightAndDark('auto-light-dark', { width: 1200, section: '#themes .frame--auto' });

await browser.close();
server.close();

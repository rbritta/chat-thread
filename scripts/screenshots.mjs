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

async function shot(name, { width, height = 900, scale = 2, section, before }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-thread="scheduled"] .ct-msg');
  await page.evaluate(() => document.fonts.ready);
  if (before) await before(page);
  const target = section ? page.locator(section) : page;
  await target.screenshot({ path: `${docs}${name}.png`, ...(section ? {} : { fullPage: true }) });
  await ctx.close();
  console.log(`docs/${name}.png`);
}

await shot('thread', { width: 1200, section: '#task .frame' });
await shot('session', { width: 1200, section: '#session .frame' });
await shot('reading-phone', { width: 360, height: 780, section: '#reading .frame' });
await shot('log', { width: 1200, section: '#log .frame' });
await shot('whatsapp', { width: 1200, section: '#previews .previews' });

await browser.close();
server.close();

// The thread in a real browser (installed Chrome or Edge, through playwright-core, headless).
// Skipped when no browser is found: set PW_CHANNEL=msedge or PW_EXECUTABLE=/path to pick one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve-demo.mjs';

let chromium;
let browser;
let server;
let base;

before(async () => {
  try {
    ({ chromium } = await import('playwright-core'));
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : { channel: process.env.PW_CHANNEL || 'chrome' }),
    });
  } catch {
    browser = null;
  }
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function page(width = 1200, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('[data-thread="scheduled"] .ct-msg');
  return { p, ctx, errors };
}

const thread = (name) => `[data-thread="${name}"]`;

test('the demo renders every mode with no errors and no CSP violations', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const count = (sel) => p.locator(sel).count();
  assert.equal(await count(`${thread('task')} .ct-msg`), 4);
  assert.equal(await count(`${thread('task')} .ct-msg--queued`), 1);
  assert.equal(await count(`${thread('session')} .ct-code`), 1);
  assert.equal(await count(`${thread('reading')} .ct-typing`), 1);
  assert.equal(await count(`${thread('reading')} .ct-chip`), 3);
  assert.equal(await count(`${thread('log')} .ct-msg`), 3);
  assert.equal(await count(`${thread('log')} .ct-composer`), 0);
  assert.equal(await count(`${thread('log')} .ct-author--1, ${thread('log')} .ct-author--2`), 2, 'two group authors, two colors');
  assert.equal(await count('.ct--whatsapp.ct--preview'), 2);
  assert.equal(await count('.ct--preview .ct-day'), 0);
  assert.equal(await p.locator(`${thread('task')} .ct-day`).first().textContent(), 'Today');
  const weekday = await p.evaluate(() => new Date(Date.now() - 3 * 864e5).toLocaleDateString(undefined, { weekday: 'long' }));
  assert.equal((await p.locator(`${thread('log')} .ct-day`).textContent()).toLowerCase(), weekday.toLowerCase());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the box: disabled when empty, Shift+Enter breaks the line, Enter sends, the reply arrives', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const box = p.locator(`${thread('directions')} .ct-input`);
  const send = p.locator(`${thread('directions')} .ct-send`);
  assert.equal(await send.isDisabled(), true);
  await box.click();
  await box.pressSequentially('first line');
  assert.equal(await send.isDisabled(), false);
  const oneLine = await box.evaluate((el) => el.offsetHeight);
  await box.press('Shift+Enter');
  await box.pressSequentially('  second <b>line</b> **as written**');
  assert.ok((await box.evaluate((el) => el.offsetHeight)) > oneLine, 'the box grew');
  await box.press('Enter');
  const mine = p.locator(`${thread('directions')} .ct-msg--mine`).last();
  assert.equal(await mine.locator('.ct-plain').evaluate((el) => el.firstChild.textContent), 'first line\n  second <b>line</b> **as written**');
  assert.equal(await box.inputValue(), '');
  assert.equal(await send.isDisabled(), true);
  await mine.locator('.ct-tick--read').waitFor();
  await p.locator(`${thread('directions')} .ct-typing`).waitFor();
  await p.locator(`${thread('directions')} .ct-msg--theirs`, { hasText: 'release branch is named' }).waitFor();
  assert.equal(await p.locator(`${thread('directions')} .ct-typing`).count(), 0, 'the reply clears the typing dots');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the box grows to six lines, then scrolls', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const box = p.locator(`${thread('session')} .ct-input`);
  await box.fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
  const { height, line, overflow } = await box.evaluate((el) => ({
    height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight), overflow: getComputedStyle(el).overflowY,
  }));
  assert.ok(Math.abs(height - line * 6) < 2, `height ${height} is six lines of ${line}`);
  assert.equal(overflow, 'auto');
  await ctx.close();
});

test('read more opens and closes a long message; short ones lose the button', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const long = p.locator(`${thread('task')} .ct-msg`, { has: p.locator('.ct-more') });
  assert.equal(await long.count(), 1);
  const body = long.locator('.ct-body');
  const closed = await body.evaluate((el) => el.clientHeight);
  await long.locator('.ct-more').click();
  assert.equal(await long.locator('.ct-more').textContent(), 'Show less');
  assert.equal(await long.locator('.ct-more').getAttribute('aria-expanded'), 'true');
  assert.ok((await body.evaluate((el) => el.clientHeight)) > closed);
  await long.locator('.ct-more').click();
  assert.equal(await long.locator('.ct-more').textContent(), 'Read more');
  assert.equal(await p.locator(`${thread('reading')} .ct-more`).count(), 1, 'the long note of the day is collapsed too');
  await ctx.close();
});

test('Copy puts the code on the clipboard', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const button = p.locator(`${thread('session')} .ct-copy`);
  await button.click();
  await p.waitForFunction(() => document.querySelector('[data-thread="session"] .ct-copy').textContent === 'Copied');
  // Windows hands the text back with \r\n line ends
  assert.equal((await p.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), 'node edits.test.js\n✗ editing a deleted message keeps the original');
  await p.waitForFunction(() => document.querySelector('[data-thread="session"] .ct-copy').textContent === 'Copy', null, { timeout: 3000 });
  await ctx.close();
});

test('× removes a queued message from the thread and the store; toggles and chips go with what is sent', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await p.click(`${thread('session')} .ct-remove`);
  assert.equal(await p.locator(`${thread('session')} .ct-msg--queued`).count(), 0);
  assert.equal(await p.evaluate(() => window.demoChats.session.messages.some((m) => m.state === 'queued')), false);

  await p.check(`${thread('task')} .ct-toggles input[name=close]`);
  await p.fill(`${thread('task')} .ct-input`, 'wrap up after this');
  await p.click(`${thread('task')} .ct-send`);
  await p.waitForFunction(() => window.demoChats.task.messages.some((m) => m.text === 'wrap up after this' && typeof m.id === 'number'));
  assert.deepEqual(await p.evaluate(() => window.demoChats.task.messages.find((m) => m.text === 'wrap up after this').meta), { toggles: { close: true } });

  await p.click(`${thread('reading')} .ct-chip >> text=Historical context`);
  await p.locator(`${thread('reading')} .ct-msg--mine`, { hasText: 'Historical context' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('WhatsApp previews: marks rendered, tail drawn, blue ticks, clock when scheduled', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const reminder = p.locator(`${thread('reminder')} .ct-msg`);
  assert.equal(await reminder.locator('strong').textContent(), 'Thursday, Nov 14 at 9:30 AM');
  assert.equal(await reminder.locator('del').textContent(), 'Wednesday');
  assert.equal(await reminder.locator('em').textContent(), '(555) 010-0199');
  assert.equal(await reminder.evaluate((el) => getComputedStyle(el, '::after').content), '""');
  assert.equal(await reminder.locator('.ct-tick--read').evaluate((el) => getComputedStyle(el).stroke), 'rgb(83, 189, 235)');
  assert.equal(await reminder.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(217, 253, 211)');
  assert.equal(await p.locator(`${thread('scheduled')} .ct-tick--clock`).count(), 1);
  await ctx.close();
});

test('links have no underline and turn gray on hover', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const link = p.locator(`${thread('task')} .ct-body a`).first();
  assert.equal(await link.evaluate((el) => getComputedStyle(el).textDecorationLine), 'none');
  await link.hover();
  assert.equal(await link.evaluate((el) => getComputedStyle(el).color), 'rgb(110, 118, 129)');
  await ctx.close();
});

for (const width of [360, 1200]) {
  test(`no horizontal scroll at ${width} px`, async (t) => {
    if (!browser) return t.skip('no browser');
    const { p, ctx, errors } = await page(width, 800);
    await p.fill(`${thread('session')} .ct-input`, 'x'.repeat(400));
    await p.click(`${thread('session')} .ct-send`);
    const { scroll, client } = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(scroll <= client, `page is ${scroll}px wide in a ${client}px window`);
    const wide = await p.evaluate(() => [...document.querySelectorAll('.ct-msg')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length);
    assert.equal(wide, 0, 'no bubble crosses the right edge');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('the API: hydrate, waiting, a failed send, update and destroy', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx } = await page();
  const result = await p.evaluate(async () => {
    const { createChat, renderThread } = await import('/src/chat-thread.js');
    const out = {};
    const el = document.createElement('div');
    document.body.append(el);
    el.innerHTML = renderThread([{ id: 1, from: 'other', text: '```\nls\n```' }], { author: 'Bot' });
    let failed = null;
    el.addEventListener('chat-error', (e) => { failed = e.detail.message; });
    const chat = createChat(el, {
      hydrate: true,
      author: 'Bot',
      store: { load: () => ({ messages: [] }), send: () => Promise.reject(new Error('offline')) },
      onError: () => {},
    });
    out.hydrated = el.querySelectorAll('.ct').length === 1 && el.querySelector('.ct-copy') !== null;
    chat.setWaiting(true);
    out.waiting = el.querySelector('.ct-waiting')?.textContent;
    await chat.send('hello');
    out.failed = failed;
    out.alert = el.querySelector('.ct-msg--mine').className;
    chat.append({ from: 'other', text: 'back online' });
    out.waitingAfterReply = el.querySelectorAll('.ct-waiting').length;
    const m = chat.append({ from: 'me', text: 'sent', state: 'sent' });
    chat.updateMessage(m.id, { state: 'read' });
    out.readTicks = el.querySelectorAll('.ct-msg--mine .ct-tick--read').length;
    chat.update({ messages: [{ from: 'other', text: 'fresh' }], typing: 'Bot' });
    out.afterUpdate = [el.querySelectorAll('.ct-msg:not(.ct-typing)').length, el.querySelector('.ct-typing')?.getAttribute('aria-label')];
    chat.configure({ mode: 'readonly' });
    out.readonly = el.querySelector('.ct-composer') === null;
    chat.destroy();
    out.empty = el.innerHTML === '';
    return out;
  });
  assert.deepEqual(result, {
    hydrated: true,
    waiting: 'Bot has not replied yet…',
    failed: 'offline',
    alert: 'ct-msg ct-msg--mine ct-msg--alert',
    waitingAfterReply: 0,
    readTicks: 1,
    afterUpdate: [1, 'Bot is typing'],
    readonly: true,
    empty: true,
  });
  await ctx.close();
});

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

async function page(width = 1200, height = 900, { colorScheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
  // every CSP violation lands in the errors, even one the console would not show
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
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
  assert.equal(await count(`${thread('booking')} .ct.ct--light`), 1);
  assert.equal(await count(`${thread('booking')} .ct-msg--note`), 2);
  assert.equal(await count(`${thread('reminders')} .ct.ct--auto`), 1);
  assert.equal(await count(`${thread('reminders')} .ct-msg--note.ct-msg--alert`), 1);
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

// WCAG contrast ratio of two computed colors, run inside the page
function contrastIn(page, pairs) {
  return page.evaluate((list) => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return list.map(([a, b]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); });
  }, pairs);
}

test('light: its palette, text that passes AA on both bubbles and on the page, a dark page around it changes nothing', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const found = await p.evaluate(() => {
    const ct = document.querySelector('[data-thread="booking"] .ct');
    const style = (el, prop = 'backgroundColor') => getComputedStyle(el)[prop];
    // a bubble from the other side, drawn with the same theme next to the thread, to read its colors
    const extra = document.createElement('div');
    extra.className = 'ct ct--light';
    extra.innerHTML = '<div class="ct-list"><div class="ct-msg ct-msg--theirs"><div class="ct-body"><p>x</p></div></div></div>';
    ct.parentElement.append(extra);
    const colors = {};
    for (const name of ['text', 'muted', 'link', 'author', 'title', 'tick', 'author-1', 'author-2', 'author-3', 'author-4', 'author-5', 'author-6']) {
      const span = document.createElement('span');
      span.style.color = `var(--ct-${name})`;
      extra.append(span);
      colors[name] = getComputedStyle(span).color;
    }
    const mine = ct.querySelector('.ct-msg--mine');
    const link = ct.querySelector('.ct-msg--note a');
    const out = {
      backgrounds: { mine: style(mine), theirs: style(extra.querySelector('.ct-msg--theirs')), page: style(ct.closest('.frame')) },
      colors,
      text: style(ct, 'color'),
      border: style(mine, 'borderTopColor'),
      field: style(ct.querySelector('.ct-field')),
      send: style(ct.querySelector('.ct-send')),
      link: style(link, 'color'),
      underline: style(link, 'textDecorationLine'),
      scheme: style(ct, 'colorScheme'),
    };
    extra.remove();
    return out;
  });
  assert.deepEqual(found.backgrounds, { mine: 'rgb(227, 249, 232)', theirs: 'rgb(255, 255, 255)', page: 'rgb(245, 246, 248)' });
  assert.deepEqual([found.text, found.border, found.field, found.send, found.link, found.underline, found.scheme],
    ['rgb(31, 35, 40)', 'rgb(180, 226, 192)', 'rgb(255, 255, 255)', 'rgb(31, 136, 61)', 'rgb(9, 105, 218)', 'none', 'light']);

  const pairs = [];
  for (const name of ['text', 'muted', 'link', 'tick']) for (const where of ['mine', 'theirs', 'page']) pairs.push([name, where]);
  for (const name of ['author', 'title', 'author-1', 'author-2', 'author-3', 'author-4', 'author-5', 'author-6']) pairs.push([name, 'theirs']);
  const ratios = await contrastIn(p, pairs.map(([name, where]) => [found.colors[name], found.backgrounds[where]]));
  assert.ok(ratios.every((r) => r > 1 && r <= 21), `ratios were measured: ${ratios}`);
  const failing = pairs.filter(([name], i) => ratios[i] < (name === 'tick' ? 3 : 4.5)).map(([name, where]) => `${name} on ${where}`);
  assert.deepEqual(failing, [], 'WCAG AA: 4.5 for text, 3 for the tick icon');

  const link = p.locator(`${thread('booking')} .ct-msg--note a`);
  await link.hover();
  assert.equal(await link.evaluate((el) => getComputedStyle(el).color), 'rgb(110, 118, 129)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('auto: dark by default, light when the system is light, and <html data-theme> wins over the system', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, 900, { colorScheme: 'light' });
  const LIGHT = 'rgb(227, 249, 232) rgb(31, 35, 40)';
  const DARK = 'rgb(31, 59, 52) rgb(230, 237, 243)';
  const read = async () => {
    const seen = await p.evaluate(() => {
      const ct = document.querySelector('[data-thread="reminders"] .ct');
      return `${getComputedStyle(ct.querySelector('.ct-msg--mine')).backgroundColor} ${getComputedStyle(ct).color}`;
    });
    return seen === LIGHT ? 'light' : seen === DARK ? 'dark' : seen;
  };
  const setTheme = (value) => p.evaluate((v) => { if (v === null) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v; }, value);
  const seen = {};
  for (const scheme of ['light', 'dark', 'no-preference']) {
    await p.emulateMedia({ colorScheme: scheme });
    for (const theme of [null, 'light', 'dark', 'sepia']) {
      await setTheme(theme);
      seen[`${scheme}/${theme}`] = await read();
    }
  }
  assert.deepEqual(seen, {
    'light/null': 'light', 'light/light': 'light', 'light/dark': 'dark', 'light/sepia': 'light',
    'dark/null': 'dark', 'dark/light': 'light', 'dark/dark': 'dark', 'dark/sepia': 'dark',
    'no-preference/null': 'dark', 'no-preference/light': 'light', 'no-preference/dark': 'dark', 'no-preference/sepia': 'dark',
  });

  // the demo's buttons set and clear it
  await setTheme(null);
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.click('[data-scheme="light"]');
  assert.equal(await read(), 'light');
  assert.equal(await p.getAttribute('[data-scheme="light"]', 'aria-pressed'), 'true');
  await p.click('[data-scheme="system"]');
  assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
  assert.equal(await read(), 'dark');

  // theme light ignores all of it, and an app's own --ct-* on its container still beat auto
  assert.equal(await p.locator(`${thread('booking')} .ct-msg--mine`).evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(227, 249, 232)');
  await p.click('[data-scheme="light"]');
  await p.evaluate(() => [...document.styleSheets].find((sheet) => sheet.href?.endsWith('demo.css')).insertRule('[data-thread="reminders"] .ct { --ct-mine: rgb(1, 2, 3); }'));
  assert.equal(await read(), 'rgb(1, 2, 3) rgb(31, 35, 40)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a note: no bubble, the whole width, the theme\'s text, markdown, a quiet time below; replies arrive as notes', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const note = p.locator(`${thread('booking')} .ct-msg--note`).last();
  const box = await note.evaluate((el) => {
    const s = getComputedStyle(el);
    const list = el.closest('.ct-list').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const meta = el.querySelector(':scope > .ct-meta');
    return {
      background: s.backgroundColor,
      border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join(' '),
      color: s.color,
      fullWidth: Math.abs(r.width - list.width) < 1 && Math.abs(r.left - list.left) < 1,
      items: el.querySelectorAll('li').length,
      strong: el.querySelector('strong')?.textContent,
      authorOrTicks: el.querySelectorAll('.ct-author, .ct-tick').length,
      meta: meta && { color: getComputedStyle(meta).color, size: getComputedStyle(meta).fontSize, below: meta.getBoundingClientRect().top >= el.querySelector('.ct-body').getBoundingClientRect().bottom - 1 },
    };
  });
  assert.deepEqual(box, {
    background: 'rgba(0, 0, 0, 0)',
    border: '0px 0px 0px 0px',
    color: 'rgb(31, 35, 40)',
    fullWidth: true,
    items: 3,
    strong: 'Sam',
    authorOrTicks: 0,
    meta: { color: 'rgb(89, 99, 110)', size: '11px', below: true },
  });
  const alert = await p.locator(`${thread('reminders')} .ct-msg--alert`).evaluate((el) => [getComputedStyle(el).borderLeftWidth, getComputedStyle(el).borderTopWidth]);
  assert.deepEqual(alert, ['3px', '0px'], 'an alert note gets a bar on the left, not a box');

  await p.click(`${thread('booking')} .ct-chip >> text=14:00`);
  await p.locator(`${thread('booking')} .ct-msg--mine`, { hasText: '14:00' }).waitFor();
  await p.locator(`${thread('booking')} .ct-msg--note`, { hasText: 'booked for' }).waitFor();
  assert.equal(await p.locator(`${thread('booking')} .ct-typing`).count(), 0);

  const clamp = await p.evaluate(async () => {
    const { createChat } = await import('/src/chat-thread.js');
    const el = document.createElement('div');
    document.querySelector('[data-thread="booking"]').after(el);
    const at = new Date().toISOString();
    const chat = createChat(el, { theme: 'light', clamp: 5, mode: 'readonly', messages: [
      { id: 1, kind: 'note', text: 'fits after all', at },
      { id: 2, kind: 'note', text: Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n'), at },
    ] });
    const [short, long] = el.querySelectorAll('.ct-msg--note');
    const body = long.querySelector('.ct-body--clamped');
    const out = {
      shortKeepsMetaBelow: short.querySelector(':scope > .ct-meta') !== null && short.querySelector('.ct-more') === null,
      mask: getComputedStyle(body).maskImage.startsWith('linear-gradient'),
      fadeBox: getComputedStyle(body, '::after').display,
      more: long.querySelector('.ct-more')?.textContent,
    };
    chat.destroy();
    el.remove();
    return out;
  });
  assert.deepEqual(clamp, { shortKeepsMetaBelow: true, mask: true, fadeBox: 'none', more: 'Read more' });
  assert.deepEqual(errors, []);
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
    const notes = await p.evaluate(() => [...document.querySelectorAll('.ct-msg--note')].map((el) => Math.round(el.closest('.ct-list').getBoundingClientRect().width - el.getBoundingClientRect().width)));
    assert.deepEqual([...new Set(notes)], [0], 'every note takes the whole width');
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

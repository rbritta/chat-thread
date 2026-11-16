// The thread in a real browser (installed Chrome or Edge, through playwright-core, headless).
// test/browser.js finds the browser, pins the language and time zone, and says why when it skips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve-demo.mjs';
import { launch, newContext } from './browser.js';

let browser;
let skip;
let server;
let base;

before(async () => {
  ({ browser, skip } = await launch());
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser?.close();
  server?.close();
});

// Motion is reduced unless a test asks for it, so what a test reads right after a click is final.
async function page(width = 1200, height = 900, { colorScheme = 'dark', reducedMotion = 'reduce' } = {}) {
  const ctx = await newContext(browser, { viewport: { width, height }, colorScheme, reducedMotion });
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
  if (!browser) return t.skip(skip);
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
  for (const name of ['task', 'session', 'directions', 'reading', 'log', 'reminders']) {
    assert.equal(await count(`${thread(name)} .ct.ct--auto`), 1, `${name} follows the page's theme`);
  }
  assert.equal(await count(`${thread('log')} .ct-author--1, ${thread('log')} .ct-author--2, ${thread('log')} .ct-author--3`), 2, 'hydrated with no options: they came with the markup');
  assert.equal(await p.locator(`${thread('task')} .ct-day`).first().textContent(), 'Today');
  const weekday = await p.evaluate(() => new Date(Date.now() - 3 * 864e5).toLocaleDateString(undefined, { weekday: 'long' }));
  assert.equal((await p.locator(`${thread('log')} .ct-day`).textContent()).toLowerCase(), weekday.toLowerCase());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the box: disabled when empty, Shift+Enter breaks the line, Enter sends, the reply arrives', async (t) => {
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  if (!browser) return t.skip(skip);
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
  let noPreferenceIsLight = false;
  for (const scheme of ['light', 'dark', 'no-preference']) {
    await p.emulateMedia({ colorScheme: scheme });
    // some Chrome builds answer no-preference as light: then the system is light, and so is the thread
    if (scheme === 'no-preference') noPreferenceIsLight = await p.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
    for (const theme of [null, 'light', 'dark', 'sepia']) {
      await setTheme(theme);
      seen[`${scheme}/${theme}`] = await read();
    }
  }
  const unset = noPreferenceIsLight ? 'light' : 'dark';
  assert.deepEqual(seen, {
    'light/null': 'light', 'light/light': 'light', 'light/dark': 'dark', 'light/sepia': 'light',
    'dark/null': 'dark', 'dark/light': 'light', 'dark/dark': 'dark', 'dark/sepia': 'dark',
    'no-preference/null': unset, 'no-preference/light': 'light', 'no-preference/dark': 'dark', 'no-preference/sepia': unset,
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
  if (!browser) return t.skip(skip);
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

test('the API: hydrate, waiting, a failed send, update and destroy', async (t) => {
  if (!browser) return t.skip(skip);
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
    out.failedMark = el.querySelector('.ct-msg--mine .ct-tick--failed')?.getAttribute('aria-label');
    chat.append({ from: 'other', text: 'back online' });
    out.waitingAfterReply = el.querySelectorAll('.ct-waiting').length;
    const m = chat.append({ from: 'me', text: 'sent', state: 'sent' });
    chat.updateMessage(m.id, { state: 'read' });
    out.readTicks = el.querySelectorAll('.ct-msg--mine .ct-tick--read').length;
    chat.update({ messages: [{ from: 'other', text: 'fresh' }], typing: 'Bot' });
    out.afterUpdate = [el.querySelectorAll('.ct-msg:not(.ct-typing)').length, el.querySelector('.ct-typing .ct-sr')?.textContent];
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
    failedMark: 'Not sent',
    waitingAfterReply: 0,
    readTicks: 1,
    afterUpdate: [1, 'Bot is typing'],
    readonly: true,
    empty: true,
  });
  await ctx.close();
});

// A thread of a test's own, at the top of the demo page: `await window.sandbox(options, html?)` inside p.evaluate.
// `options: null` only draws the html. Installed through evaluate: the demo's CSP refuses inline scripts.
const installSandbox = (p) => p.evaluate(() => {
  window.sandbox = async (options = {}, html) => {
    const lib = await import('/src/chat-thread.js');
    const el = document.createElement('div');
    el.className = 'sandbox';
    document.querySelector('main').prepend(el);
    if (html) el.innerHTML = html(lib);
    return { lib, el, chat: options === null ? null : lib.createChat(el, options) };
  };
});

test('hydrating a server-rendered thread the way an app does: the server\'s options, toggles, a reply that clears waiting, ×, a failure', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page();
  // what the server does: renderThread with its options and the waiting line; the page passes only callbacks
  await p.evaluate(async () => {
    const { createChat, renderThread } = await import('/src/chat-thread.js');
    const el = document.createElement('div');
    el.id = 'served';
    document.querySelector('main').prepend(el);
    const at = new Date(Date.now() - 60000).toISOString();
    el.innerHTML = renderThread([
      { id: 11, from: 'other', author: 'Helper', text: `Hi! ${'word '.repeat(120)}`, at },
      { id: 12, from: 'me', text: 'later', state: 'queued', at },
    ], {
      timeZone: 'Asia/Tokyo', locale: 'en-GB', author: 'Helper',
      strings: { placeholder: 'Write a reply', more: 'Show all', less: 'Fold it back', failed: 'Could not send' },
      toggles: [{ name: 'close', label: 'Close when done' }],
    }, { waiting: true });
    window.calls = [];
    window.failNext = false;
    window.served = createChat(el, {
      hydrate: true,
      onSend: async (text, { toggles }) => {
        window.calls.push(['send', text, toggles]);
        if (window.failNext) throw new Error('offline');
        return { id: 99, state: 'sent' };
      },
      onRemove: (message) => { window.calls.push(['remove', message.id]); },
      onError: (err) => { window.calls.push(['error', err.message]); },
    });
  });
  const served = p.locator('#served');
  assert.equal(await served.locator('.ct-input').getAttribute('placeholder'), 'Write a reply');
  await served.locator('.ct-more').click();
  assert.equal(await served.locator('.ct-more').textContent(), 'Fold it back', 'the words came from the markup');

  await served.locator('.ct-toggles input[name=close]').check();
  await served.locator('.ct-input').fill('hello');
  await served.locator('.ct-input').press('Enter');
  const sent = served.locator('.ct-msg--mine[data-id="99"]');
  await sent.waitFor();
  const tokyo = await p.evaluate(() => {
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
    return { time, day };
  });
  assert.equal(await sent.locator('time').textContent(), tokyo.time, 'in the server\'s time zone');
  assert.equal(await sent.getAttribute('data-day'), tokyo.day);
  assert.equal(await served.locator('.ct-waiting').count(), 1, 'sending does not answer for the other side');

  await p.evaluate(() => window.served.append({ id: 100, from: 'other', text: 'Done.' }));
  assert.equal(await served.locator('.ct-waiting').count(), 0, 'the reply clears the waiting line the server drew');
  assert.equal(await served.locator('.ct-msg--theirs').last().locator('.ct-author').textContent(), 'Helper');
  await p.evaluate(() => window.served.setTyping(true));
  assert.equal(await served.locator('.ct-typing .ct-sr').textContent(), 'Helper is typing');
  await p.evaluate(() => window.served.setTyping(false));

  await served.locator('.ct-remove').click();
  assert.equal(await served.locator('.ct-msg--queued').count(), 0);

  await p.evaluate(() => { window.failNext = true; });
  await served.locator('.ct-input').fill('again');
  await served.locator('.ct-input').press('Enter');
  await served.locator('.ct-tick--failed').waitFor();
  assert.equal(await served.locator('.ct-tick--failed').getAttribute('aria-label'), 'Could not send');
  assert.deepEqual(await p.evaluate(() => window.calls), [
    ['send', 'hello', { close: true }], ['remove', '12'], ['send', 'again', { close: true }], ['error', 'offline'],
  ]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('rapid sends: a double Enter or a double click sends once; a double × removes once', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page();
  const box = p.locator(`${thread('directions')} .ct-input`);
  const mine = (text) => p.locator(`${thread('directions')} .ct-msg--mine`, { hasText: text }).count();
  await box.fill('once');
  await box.press('Enter');
  await box.press('Enter');
  assert.equal(await mine('once'), 1);
  await box.fill('twice');
  await p.locator(`${thread('directions')} .ct-send`).dblclick();
  assert.equal(await mine('twice'), 1);

  await installSandbox(p);
  const removed = await p.evaluate(async () => {
    const calls = [];
    const store = {
      load: () => [],
      send: (d) => d,
      remove: (id) => new Promise((resolve) => setTimeout(() => { calls.push(id); resolve({ ok: true }); }, 60)),
    };
    const { el } = await window.sandbox({ store, messages: [{ id: 5, from: 'me', text: 'later', state: 'queued' }] });
    const x = el.querySelector('.ct-remove');
    x.click();
    x.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { calls, left: el.querySelectorAll('.ct-msg').length };
  });
  assert.deepEqual(removed, { calls: [5], left: 0 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('IME: the Enter that picks a word never sends, in Chrome or in Safari\'s order', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page();
  await installSandbox(p);
  const result = await p.evaluate(async () => {
    const sent = [];
    const { el } = await window.sandbox({ onSend: (text) => { sent.push(text); } });
    const input = el.querySelector('.ct-input');
    input.value = 'にほんご';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const enter = (init = {}, keyCode) => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      if (keyCode) Object.defineProperty(ev, 'keyCode', { value: keyCode });
      input.dispatchEvent(ev);
    };
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    enter({ isComposing: true });
    enter({}, 229);
    enter();
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    enter();
    const during = sent.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    enter();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { during, after: sent };
  });
  assert.deepEqual(result, { during: 0, after: ['にほんご'] });
  await ctx.close();
});

test('focus: Send keeps it in the box, from the mouse or the keyboard; × gives it to the box; configure keeps it', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page();
  const box = p.locator(`${thread('directions')} .ct-input`);
  const focusedIsBox = () => box.evaluate((el) => document.activeElement === el);
  await box.fill('by mouse');
  await p.click(`${thread('directions')} .ct-send`);
  assert.equal(await focusedIsBox(), true);
  await box.fill('by keyboard');
  await box.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.className), 'ct-send');
  await p.keyboard.press('Enter');
  assert.equal(await focusedIsBox(), true, 'the button went disabled: the focus came back to the box');

  const remove = p.locator(`${thread('session')} .ct-remove`);
  await remove.focus();
  await p.keyboard.press('Enter');
  await p.locator(`${thread('session')} .ct-msg--queued`).waitFor({ state: 'detached' });
  assert.equal(await p.evaluate(() => document.activeElement.matches('[data-thread="session"] .ct-input')), true);

  await p.check(`${thread('task')} .ct-toggles input[name=close]`);
  await p.fill(`${thread('task')} .ct-input`, 'half written');
  await p.focus(`${thread('task')} .ct-input`);
  await p.evaluate(() => window.demoChats.task.configure({ strings: { send: 'Go' } }));
  assert.deepEqual(await p.evaluate(() => {
    const el = document.querySelector('[data-thread="task"]');
    return [el.querySelector('.ct-toggles input').checked, el.querySelector('.ct-input').value, document.activeElement === el.querySelector('.ct-input'),
      el.querySelector('.ct-input').placeholder, el.querySelector('.ct-send').getAttribute('aria-label')];
  }), [true, 'half written', true, 'Message to Session 2', 'Go'], 'strings merge: the placeholder stays');
  await ctx.close();
});

test('keyboard: with enterSends off, Enter breaks the line and Ctrl+Enter sends', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page();
  await installSandbox(p);
  await p.evaluate(async () => {
    window.sent = [];
    await window.sandbox({ enterSends: false, onSend: (text) => { window.sent.push(text); } });
  });
  const box = p.locator('.sandbox .ct-input');
  assert.equal(await box.getAttribute('enterkeyhint'), 'enter');
  await box.click();
  await box.pressSequentially('one');
  await box.press('Enter');
  await box.pressSequentially('two');
  assert.equal(await box.inputValue(), 'one\ntwo');
  await box.press('Control+Enter');
  assert.deepEqual(await p.evaluate(() => window.sent), ['one\ntwo']);
  await ctx.close();
});

test('the box grows without scrolling the page back', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page(1200, 700);
  // a box already four lines tall, at the very bottom of the page: measuring it must not leave the page scrolled back
  const box = p.locator(`${thread('reminders')} .ct-input`);
  await box.fill('one\ntwo\nthree\nfour');
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const before = await p.evaluate(() => window.scrollY);
  const seen = [];
  for (const key of ['m', 'o', 'r', 'e', 'Shift+Enter', 'x']) {
    await box.press(key);
    seen.push(await p.evaluate(() => window.scrollY));
  }
  assert.ok(seen.every((y, i) => y >= (i ? seen[i - 1] : before)), `the page never scrolled back: ${before} ${seen}`);
  await ctx.close();
});

test('typing dots: bare dots for a side that narrates in notes, a bubble for one that talks in bubbles', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page();
  const reading = p.locator(`${thread('reading')} .ct-typing`);
  assert.equal(await reading.getAttribute('class'), 'ct-msg ct-msg--theirs ct-typing');
  await p.click(`${thread('booking')} .ct-chip >> text=16:30`);
  const typing = p.locator(`${thread('booking')} .ct-typing`);
  await typing.waitFor();
  const look = await typing.evaluate((el) => {
    const s = getComputedStyle(el);
    const list = el.closest('.ct-list').getBoundingClientRect();
    const dots = el.querySelector('.ct-dots').getBoundingClientRect();
    return {
      cls: el.className, background: s.backgroundColor, border: s.borderTopWidth, names: el.querySelectorAll('.ct-author').length,
      label: el.querySelector('.ct-sr').textContent, atLeft: dots.left - list.left < 8,
    };
  });
  assert.deepEqual(look, { cls: 'ct-msg ct-msg--note ct-typing', background: 'rgba(0, 0, 0, 0)', border: '0px', names: 0, label: 'Assistant is typing', atLeft: true });
  await p.locator(`${thread('booking')} .ct-msg--note`, { hasText: 'booked for' }).waitFor();
  assert.equal(await typing.count(), 0);

  await installSandbox(p);
  const forced = await p.evaluate(async () => {
    const { el, chat } = await window.sandbox({ typingKind: 'note', author: 'Bot' });
    chat.setTyping(true);
    const empty = el.querySelector('.ct-typing').className;
    chat.configure({ typingKind: 'bubble' });
    return [empty, el.querySelector('.ct-typing').className];
  });
  assert.deepEqual(forced, ['ct-msg ct-msg--note ct-typing', 'ct-msg ct-msg--theirs ct-typing'], 'the option decides when given');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('motion: messages arrive and leave eased, Read more unrolls, and nothing jumps at the end', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page(1200, 900, { reducedMotion: 'no-preference' });
  await installSandbox(p);
  const result = await p.evaluate(async () => {
    const out = {};
    const long = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n');
    const { el, chat } = await window.sandbox({
      onRemove: () => {},
      messages: [{ id: 1, from: 'other', text: long }, { id: 2, from: 'me', text: 'later', state: 'queued' }],
    });
    const composer = el.querySelector('.ct-composer');
    const top = () => composer.getBoundingClientRect().top;

    chat.append({ id: 3, from: 'other', text: 'hello' });
    const arrived = el.querySelector('[data-id="3"]');
    out.arrives = arrived.getAnimations().length;
    await Promise.all(arrived.getAnimations().map((a) => a.finished));

    const more = el.querySelector('.ct-more');
    const body = more.previousElementSibling;
    const closed = body.offsetHeight;
    more.click();
    const [open] = body.getAnimations();
    out.unrolls = !!open && body.classList.contains('ct-body--clamped');
    open.pause();
    open.currentTime = 239;
    out.openEndsWhereItStays = Math.abs(body.offsetHeight - body.scrollHeight) <= 2;
    open.play();
    await open.finished;
    out.open = !body.classList.contains('ct-body--clamped') && body.offsetHeight > closed + 100;

    const queued = el.querySelector('[data-id="2"]');
    const gap = parseFloat(getComputedStyle(el.querySelector('.ct-list')).rowGap);
    const height = queued.offsetHeight;
    const startTop = top();
    queued.querySelector('.ct-remove').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [leave] = queued.getAnimations();
    out.leaves = !!leave && !queued.hasAttribute('data-id') && queued.getAttribute('aria-hidden') === 'true';
    leave.pause();
    leave.currentTime = 199;
    const nearEnd = top();
    leave.play();
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.gone = !queued.isConnected;
    out.closesItsGap = Math.abs(startTop - top() - height - gap) <= 1;
    out.noJumpAtTheEnd = Math.abs(nearEnd - top()) <= 1;
    return out;
  });
  assert.deepEqual(result, { arrives: 1, unrolls: true, openEndsWhereItStays: true, open: true, leaves: true, gone: true, closesItsGap: true, noJumpAtTheEnd: true });

  await p.emulateMedia({ reducedMotion: 'reduce' });
  const still = await p.evaluate(async () => {
    const { el, chat } = await window.sandbox({ onRemove: () => {}, messages: [{ id: 2, from: 'me', text: 'later', state: 'queued' }] });
    chat.append({ from: 'other', text: Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n') });
    const node = el.querySelector('.ct-msg--theirs');
    const animations = node.getAnimations().length;
    node.querySelector('.ct-more').click();
    el.querySelector('.ct-remove').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return [animations, node.querySelector('.ct-body').getAnimations().length, el.querySelectorAll('.ct-msg--queued').length];
  });
  assert.deepEqual(still, [0, 0, 0], 'reduced motion: no animation at all');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('live updates: a redraw keeps Read more open and the focus; an echo of a send is one message', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page();
  await installSandbox(p);
  const result = await p.evaluate(async () => {
    const out = {};
    const long = 'word '.repeat(200);
    let release;
    const store = { load: () => [], send: (d) => new Promise((resolve) => { release = () => resolve({ ...d, id: 7, state: 'sent' }); }) };
    const { el, chat } = await window.sandbox({ store, messages: [{ id: 1, from: 'other', text: long }] });
    const more = el.querySelector('.ct-more');
    more.focus();
    more.click();
    chat.updateMessage(1, { text: `${long} and more` });
    out.streamedStaysOpen = el.querySelector('.ct-more').getAttribute('aria-expanded') === 'true' && !el.querySelector('.ct-body--clamped');
    out.focusStays = document.activeElement === el.querySelector('.ct-more');

    const sending = chat.send('hi');
    chat.append({ id: 7, from: 'me', text: 'hi', state: 'delivered' });   // a live feed echoes it before the store answers
    release();
    await sending;
    out.once = el.querySelectorAll('.ct-msg--mine').length;
    out.kept = chat.messages.filter((m) => m.text === 'hi').map((m) => [m.id, m.state]);
    chat.append({ id: 7, from: 'me', text: 'hi', state: 'read' });
    out.updatedInPlace = [el.querySelectorAll('.ct-msg--mine').length, el.querySelectorAll('.ct-msg--mine .ct-tick--read').length];
    return out;
  });
  assert.deepEqual(result, { streamedStaysOpen: true, focusStays: true, once: 1, kept: [[7, 'sent']], updatedInPlace: [1, 1] });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the log: no live region inside it, and a reload is not read out', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page();
  await installSandbox(p);
  const result = await p.evaluate(async () => {
    const { lib, el, chat } = await window.sandbox({ author: 'Bot', typing: true, waiting: true });
    const list = el.querySelector('.ct-list');
    const roles = el.querySelectorAll('[role=status], [aria-live]:not(.ct-list)').length;
    chat.configure({ store: lib.memoryStore([{ text: 'a' }, { text: 'b' }]) });
    await chat.reload();
    const during = el.querySelector('.ct-list').getAttribute('aria-live');
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { role: list.getAttribute('role'), roles, during, after: el.querySelector('.ct-list').getAttribute('aria-live'), count: el.querySelectorAll('.ct-msg:not(.ct-typing)').length };
  });
  assert.deepEqual(result, { role: 'log', roles: 0, during: 'off', after: null, count: 2 });
  await ctx.close();
});

test('edge cases: an empty thread, many messages, a thread hydrated on its own element', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page();
  await installSandbox(p);
  const result = await p.evaluate(async () => {
    const out = {};
    const empty = await window.sandbox({ author: 'Bot' });
    out.empty = empty.el.querySelector('.ct-list').children.length;
    empty.chat.setTyping(true);
    await empty.chat.send('first');
    out.first = [...empty.el.querySelector('.ct-list').children].map((n) => n.className.split(' ').pop());

    const many = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1, from: i % 3 ? 'other' : 'me', text: i % 50 ? `message ${i}` : 'long '.repeat(150), at: new Date(Date.now() - (1500 - i) * 36e5).toISOString(),
    }));
    const start = performance.now();
    const big = await window.sandbox({ messages: many, autoScroll: false });
    out.ms = performance.now() - start;
    out.count = big.el.querySelectorAll('.ct-msg').length;
    out.days = big.el.querySelectorAll('.ct-day').length;
    big.chat.append({ from: 'other', text: 'one more', at: new Date().toISOString() });
    out.last = big.el.querySelector('.ct-list').lastElementChild.textContent.startsWith('one more');

    const own = await window.sandbox(null, ({ renderThread }) => renderThread([], { theme: 'light' }));
    const thread = own.el.querySelector('.ct');
    const self = own.lib.createChat(thread, { hydrate: true });
    self.configure({ theme: 'auto' });
    out.ownElement = [self.el === thread, thread.className, thread.querySelectorAll('.ct').length];
    self.destroy();
    out.destroyed = [thread.isConnected, thread.children.length];
    return out;
  });
  assert.equal(result.empty, 0);
  assert.deepEqual(result.first, ['ct-day', 'ct-msg--mine', 'ct-typing'], 'a day, my message, then the dots still waiting');
  assert.equal(result.count, 1500);
  assert.ok(result.days > 60);
  assert.ok(result.ms < 4000, `1500 messages drawn in ${Math.round(result.ms)} ms`);
  assert.equal(result.last, true);
  assert.deepEqual(result.ownElement, [true, 'ct ct--auto', 0], 'configure keeps the element the app holds, with no thread inside a thread');
  assert.deepEqual(result.destroyed, [true, 0]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the page switch repaints every thread and the page, the WhatsApp previews keep their skin, and the choice is remembered', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page(1200, 900, { colorScheme: 'dark' });
  const paint = () => p.evaluate(() => {
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const out = { page: bg(document.body), frame: bg(document.querySelector('#task .frame')) };
    for (const el of document.querySelectorAll('[data-thread]')) out[el.dataset.thread] = bg(el.querySelector('.ct-msg--mine'));
    return out;
  });
  const DARK = 'rgb(31, 59, 52)';
  const LIGHT = 'rgb(227, 249, 232)';
  const WHATSAPP = 'rgb(217, 253, 211)';
  const expected = (mine, page, frame) => ({
    page, frame, task: mine, session: mine, directions: mine, reading: mine, log: mine, reminders: mine,
    booking: LIGHT, reminder: WHATSAPP, scheduled: WHATSAPP,
  });
  assert.deepEqual(await paint(), expected(DARK, 'rgb(5, 7, 10)', 'rgb(13, 17, 23)'));
  await p.click('[data-scheme="light"]');
  assert.deepEqual(await paint(), expected(LIGHT, 'rgb(255, 255, 255)', 'rgb(245, 246, 248)'));
  assert.equal(await p.getAttribute('[data-scheme="light"]', 'aria-pressed'), 'true');

  await p.reload();
  await p.waitForSelector('[data-thread="scheduled"] .ct-msg');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'remembered');
  assert.equal(await p.getAttribute('[data-scheme="light"]', 'aria-pressed'), 'true');
  assert.deepEqual(await paint(), expected(LIGHT, 'rgb(255, 255, 255)', 'rgb(245, 246, 248)'));

  await p.click('[data-scheme="system"]');
  assert.deepEqual(await p.evaluate(() => [document.documentElement.hasAttribute('data-theme'), localStorage.getItem('chat-thread-demo-theme')]), [false, null]);
  await p.emulateMedia({ colorScheme: 'light' });
  assert.equal((await paint()).task, LIGHT, 'System follows the system');
  await p.click('[data-scheme="dark"]');
  assert.equal((await paint()).task, DARK, 'Dark wins over a light system');

  // storage refused (a private window, blocked site data): the switch still works
  const blocked = await newContext(browser, { colorScheme: 'dark', reducedMotion: 'reduce' });
  await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const q = await blocked.newPage();
  const qErrors = [];
  q.on('pageerror', (e) => qErrors.push(e.message));
  await q.goto(`${base}/demo/`);
  await q.click('[data-scheme="light"]');
  assert.equal(await q.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.deepEqual(qErrors, []);
  await blocked.close();
  assert.deepEqual(errors, []);
  await ctx.close();
});

// The colors every thread on the demo page really uses, measured on its own bubbles and page.
function measureThemes(p) {
  return p.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const over = (fg, bg) => {
      const [r, g, b, a = 1] = parse(fg);
      const [R, G, B] = parse(bg);
      return `rgb(${r * a + R * (1 - a)}, ${g * a + G * (1 - a)}, ${b * a + B * (1 - a)})`;
    };
    const pageBehind = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (parse(c)[3] !== 0) return c;
      }
      return 'rgb(255, 255, 255)';
    };
    return [...document.querySelectorAll('.ct')].map((ct) => {
      const page = pageBehind(ct);
      const probe = (cls) => {
        const el = document.createElement('div');
        el.className = cls;
        ct.append(el);
        const c = getComputedStyle(el).backgroundColor;
        el.remove();
        return over(c, page);
      };
      const color = (name) => {
        const span = document.createElement('span');
        span.style.color = `var(--ct-${name})`;
        ct.append(span);
        const c = getComputedStyle(span).color;
        span.remove();
        return c;
      };
      const field = document.createElement('div');
      field.style.background = 'var(--ct-field)';
      ct.append(field);
      const fieldBg = over(getComputedStyle(field).backgroundColor, page);
      field.style.background = 'var(--ct-day)';
      const dayBg = over(getComputedStyle(field).backgroundColor, page);
      field.remove();
      return {
        name: `${ct.closest('[data-thread]')?.dataset.thread} (${ct.className})`,
        whatsapp: ct.classList.contains('ct--whatsapp'),
        backgrounds: { mine: probe('ct-msg ct-msg--mine'), theirs: probe('ct-msg ct-msg--theirs'), page, field: fieldBg, day: dayBg },
        colors: Object.fromEntries(['text', 'muted', 'link', 'author', 'title', 'tick', 'author-1', 'author-2', 'author-3', 'author-4', 'author-5', 'author-6'].map((n) => [n, color(n)])),
      };
    });
  });
}

test('every theme passes WCAG AA: text, muted text, links, names and titles on both bubbles and on the page', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx } = await page();
  const failing = [];
  for (const scheme of ['dark', 'light']) {
    await p.click(`[data-scheme="${scheme}"]`);
    for (const thread of await measureThemes(p)) {
      const pairs = [];
      for (const name of ['text', 'muted', 'link']) for (const where of ['mine', 'theirs', 'page']) pairs.push([name, where]);
      for (const name of ['author', 'title']) pairs.push([name, 'theirs']);
      if (!thread.whatsapp) for (const n of [1, 2, 3, 4, 5, 6]) pairs.push([`author-${n}`, 'theirs']);
      // the read tick is an icon (3:1); WhatsApp's own blue is kept on purpose, its state is in the label
      if (!thread.whatsapp) for (const where of ['mine', 'page']) pairs.push(['tick', where]);
      pairs.push(['muted', 'field'], ['muted', 'day'], ['text', 'field']);
      const ratios = await contrastIn(p, pairs.map(([name, where]) => [thread.colors[name], thread.backgrounds[where]]));
      pairs.forEach(([name, where], i) => {
        if (ratios[i] < (name === 'tick' ? 3 : 4.5)) failing.push(`${scheme} page, ${thread.name}: ${name} on ${where} = ${ratios[i].toFixed(2)}`);
      });
    }
  }
  assert.deepEqual(failing, []);
  await ctx.close();
});

for (const width of [360, 1200]) {
  for (const scheme of ['light', 'dark']) {
    test(`no horizontal scroll at ${width} px in ${scheme}, with a long code line, a long link and a long word`, async (t) => {
      if (!browser) return t.skip(skip);
      const { p, ctx, errors } = await page(width, 800);
      await p.click(`[data-scheme="${scheme}"]`);
      await p.evaluate(() => {
        const long = `\`\`\`\n${'const value = 1; '.repeat(30)}\n\`\`\`\nhttps://example.com/${'path/'.repeat(40)}\n${'x'.repeat(300)}`;
        window.demoChats.session.append({ from: 'other', text: long });
        window.demoChats.booking.append({ from: 'other', kind: 'note', text: long });
        window.demoChats.directions.append({ from: 'me', text: `${'y'.repeat(300)} https://example.com/${'q'.repeat(200)}` });
      });
      const found = await p.evaluate(() => {
        const client = document.documentElement.clientWidth;
        const pres = [...document.querySelectorAll('.ct-code pre')].slice(-2);
        return {
          scroll: document.documentElement.scrollWidth <= client,
          outside: [...document.querySelectorAll('.ct-msg, .ct-composer')].filter((el) => el.getBoundingClientRect().right > client + 0.5).length,
          codeScrollsInside: pres.every((pre) => pre.scrollWidth > pre.clientWidth && pre.getBoundingClientRect().right <= pre.closest('.ct-msg').getBoundingClientRect().right + 0.5),
          notesFullWidth: [...new Set([...document.querySelectorAll('.ct-msg--note')].map((el) => Math.round(el.closest('.ct-list').getBoundingClientRect().width - el.getBoundingClientRect().width)))],
        };
      });
      assert.deepEqual(found, { scroll: true, outside: 0, codeScrollsInside: true, notesFullWidth: [0] });
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
}

test('the + opens a menu; Camera takes a photo (here from the file input), the preview sends it with its caption', async (t) => {
  if (!browser) return t.skip(skip);
  const { p, ctx, errors } = await page(1200, 900);
  await installSandbox(p);
  await p.evaluate(async () => {
    window.sent = [];
    // no camera API in the test: the file input is the way in, as on a phone
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { chat } = await window.sandbox({ attach: ['camera'], onSend: async (text, info) => { window.sent.push({ text, caption: info.caption, type: info.photo?.type, size: info.photo?.size, image: info.message.image ?? null }); return { state: 'sent' }; } });
    window.box = chat;
  });
  const sb = p.locator('.sandbox');
  const plus = sb.locator('.ct-attach');
  assert.equal(await sb.locator('.ct-menu').isHidden(), true);
  await plus.click();
  assert.equal(await plus.getAttribute('aria-expanded'), 'true');
  assert.equal(await sb.locator('.ct-menu').isVisible(), true);
  await p.keyboard.press('Escape');
  assert.equal(await sb.locator('.ct-menu').isHidden(), true, 'Escape closes the menu');
  await plus.click();
  await p.locator('main h1, body').first().click({ position: { x: 5, y: 5 } });
  assert.equal(await sb.locator('.ct-menu').isHidden(), true, 'a click outside closes it');
  await plus.click();
  const chooser = p.waitForEvent('filechooser');
  await sb.locator('.ct-menu-item[data-attach="camera"]').click();
  // a 4x3 red PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGP4z8AARww4OQD1MQv1NXv7ggAAAABJRU5ErkJggg==', 'base64');
  await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('.ct-cam .ct-cam-shot:not([hidden])');
  assert.equal(await p.locator('.ct-cam-foot--live').isHidden(), true);
  await p.locator('.ct-cam-caption').fill('the shelf');
  await p.locator('.ct-cam-send').click();
  await p.waitForFunction(() => window.sent.length === 1);
  const sent = await p.evaluate(() => window.sent[0]);
  assert.equal(sent.text, '📷 the shelf');
  assert.equal(sent.caption, 'the shelf');
  assert.equal(sent.type, 'image/jpeg');
  assert.ok(sent.size > 0);
  assert.equal(sent.image, null, 'the preview never goes to the app');
  assert.equal(await p.locator('.ct-cam').count(), 0, 'the camera closes after sending');
  const shown = await sb.locator('.ct-msg--mine').last().locator('.ct-img img').getAttribute('src');
  assert.match(shown, /^data:image\/jpeg;base64,/, 'the photo shows in the bubble at once');
  assert.equal(await sb.locator('.ct-msg--mine').last().textContent().then((s) => s.includes('📷 the shelf')), true);
  assert.equal(await sb.locator('.ct-input').inputValue(), '', 'the box was not touched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a photo in a bubble: a thumbnail that opens full size; Escape, the X or outside the photo closes it', async (t) => {
  if (!browser) return t.skip(skip);
  for (const width of [1200, 360]) {
    const { p, ctx, errors } = await page(width, 800);
    await installSandbox(p);
    // a 600x400 picture, served for the test
    await p.route('**/test-photo.svg', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#888"/></svg>' }));
    await p.evaluate(async () => {
      const { chat } = await window.sandbox({});
      chat.append({ id: 'ph', from: 'me', text: 'the shelf', image: { src: '/test-photo.svg', alt: 'shelf' }, state: 'sent', at: new Date().toISOString() });
    });
    await p.waitForFunction(() => document.querySelector('.ct-msg[data-id="ph"] .ct-img img')?.complete);
    const sb = p.locator('.sandbox');
    const thumb = sb.locator('.ct-msg[data-id="ph"] .ct-img');
    assert.equal(await thumb.count(), 1);
    const box = await thumb.boundingBox();
    assert.ok(box.width <= 282, `thumbnail stays small (${box.width})`);
    await thumb.click();
    const view = p.locator('.ct-viewer');
    assert.equal(await view.isVisible(), true);
    assert.equal(await p.locator('.ct-viewer .ct-cam-title').textContent(), 'shelf');
    const big = await p.locator('.ct-viewer-img').boundingBox();
    assert.ok(big.width > box.width && big.x >= 0 && big.x + big.width <= width && big.y + big.height <= 800, `full size, inside the screen (${JSON.stringify(big)})`);
    assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('ct-cam-close')), true);
    await p.keyboard.press('Escape');
    assert.equal(await view.count(), 0, 'Escape closes it');
    assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('ct-img')), true, 'the focus goes back to the thumbnail');
    await thumb.click();
    await p.locator('.ct-viewer .ct-cam-close').click();
    assert.equal(await view.count(), 0, 'the X closes it');
    await thumb.click();
    await p.mouse.click(5, 790);
    assert.equal(await view.count(), 0, 'a click outside the photo closes it');
    assert.equal(await sb.locator('.ct-msg').filter({ hasText: 'the shelf' }).count(), 1, 'nothing was sent');
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
    await ctx.close();
  }
});

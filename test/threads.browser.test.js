// createThreads in a real browser, on the demo's Threads section (see chat-thread.browser.test.js
// for how the browser is found). Skipped when there is none.
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
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${base}/demo/`);
  await p.waitForSelector('[data-threads="team"] .ct-th', { state: 'attached' });
  return { p, ctx, errors };
}

const team = '[data-threads="team"]';
const session = '[data-threads="session"]';
const closeAll = async (p) => { while (await p.locator(`${team} .ct-th--open`).count()) await p.locator(`${team} .ct-th--open .ct-th-toggle`).first().click(); };
const visible = (p, sel) => p.locator(sel).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

test('threads keep the order they were opened in, with the resolved ones hidden behind a button on top', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  assert.equal(await p.locator(`${team} .ct-th`).count(), 3);
  assert.equal(await visible(p, `${team} .ct-th`), 2, 'the resolved one is hidden');
  const more = p.locator(`${team} .ct-th-more`);
  assert.equal(await more.textContent(), 'Show 1 resolved');
  const first = await p.locator(`${team} > *`).first().getAttribute('class');
  assert.match(first, /ct-th-more/, 'the button is above the threads');
  await more.click();
  assert.equal(await visible(p, `${team} .ct-th`), 3);
  assert.match(await p.locator(`${team} .ct-th`).first().getAttribute('class'), /ct-th--resolved/, 'the oldest, resolved, is on top');
  assert.equal(await more.textContent(), 'Hide resolved');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('there is one message box: the one of the thread you are in', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  assert.equal(await visible(p, `${team} .ct-composer`), 1);
  // opening the idle thread moves the box there
  await p.locator(`${team} .ct-th:not(.ct-th--open) .ct-th-toggle`).last().click();
  assert.equal(await visible(p, `${team} .ct-composer`), 1);
  assert.match(await p.locator(`${team} .ct-th`).last().getAttribute('class'), /ct-th--active/);
  // closing every open thread leaves the box that starts a new one
  await closeAll(p);
  assert.equal(await visible(p, `${team} .ct-th-new .ct-composer`), 1);
  assert.equal(await visible(p, `${team} .ct-composer`), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the box at the bottom opens a thread, and the text goes there, not to the box', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await closeAll(p);
  await p.locator(`${team} .ct-th-new .ct-input`).fill('Who has the keys?');
  await p.keyboard.press('Enter');
  await p.waitForFunction((sel) => document.querySelectorAll(`${sel} .ct-th`).length === 4, team);
  const last = p.locator(`${team} .ct-th`).last();
  assert.equal(await last.locator('.ct-th-tt').textContent(), 'Who has the keys?', 'no title: the first line is the title');
  assert.match(await last.getAttribute('class'), /ct-th--open.*ct-th--active|ct-th--active/);
  assert.equal(await visible(p, `${team} .ct-th-new .ct-msg`), 0);
  assert.equal(await p.locator(`${team} .ct-th-new`).isHidden(), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Ctrl+Shift+Enter or the Branch button opens a thread derived from the one you are in', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const branch = p.locator(`${team} .ct-th--active .ct-th-branch`);
  assert.equal(await branch.isDisabled(), true, 'nothing typed, nothing to branch');
  const input = p.locator(`${team} .ct-th--active .ct-input`);
  await input.fill('And the domain renewal?');
  assert.equal(await branch.isDisabled(), false);
  const before = await p.locator(`${team} .ct-th--active .ct-msg`).count();
  await p.keyboard.press('Control+Shift+Enter');
  await p.waitForFunction((sel) => document.querySelectorAll(`${sel} .ct-th`).length === 4, team);
  const derived = p.locator(`${team} .ct-th`).last();
  assert.match(await derived.locator('.ct-th-from').textContent(), /from Invoice for the October hosting/);
  assert.match(await derived.getAttribute('class'), /ct-th--active/);
  assert.equal(await p.locator(`${team} .ct-th`).nth(1).locator('.ct-msg').count(), before, 'the text did not go to the old thread');
  // the button does the same
  await p.locator(`${team} .ct-th--active .ct-input`).fill('One more');
  await p.locator(`${team} .ct-th--active .ct-th-branch`).click();
  await p.waitForFunction((sel) => document.querySelectorAll(`${sel} .ct-th`).length === 5, team);
  assert.match(await p.locator(`${team} .ct-th`).last().locator('.ct-th-from').textContent(), /from And the domain renewal\?/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('resolving folds a thread into one line; reopening brings it back', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const th = p.locator(`${team} .ct-th`).nth(1);
  await th.locator('.ct-th-resolve').click();
  assert.match(await th.getAttribute('class'), /ct-th--resolved/);
  assert.equal(await th.isHidden(), true, 'hidden with the other resolved ones');
  assert.equal(await p.locator(`${team} .ct-th-more`).textContent(), 'Show 2 resolved');
  await p.locator(`${team} .ct-th-more`).click();
  assert.match(await th.locator('.ct-th-meta').textContent(), /^Resolved/);
  await th.locator('.ct-th-reopen').click();
  assert.doesNotMatch(await th.getAttribute('class'), /ct-th--resolved/);
  // from outside, through the API
  await p.evaluate(() => window.demoThreads.team.resolve('t2', 'Ana'));
  assert.match(await th.locator('.ct-th-meta').textContent(), /Resolved by Ana/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a title someone gives wins over the first line; an AI title carries its mark', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const th = p.locator(`${team} .ct-th`).nth(1);
  assert.match(await th.locator('.ct-th-ai').textContent(), /Assistant/);
  await th.locator('.ct-th-rename').click();
  const input = th.locator('.ct-th-rename-input');
  await input.fill('Hosting charged twice');
  await input.press('Enter');
  assert.equal(await th.locator('.ct-th-tt').textContent(), 'Hosting charged twice');
  assert.equal(await th.locator('.ct-th-ai').count(), 0, 'a person renamed it');
  await p.evaluate(() => window.demoThreads.team.rename('t2', 'Duplicate hosting charge', 'Assistant', true));
  assert.equal(await th.locator('.ct-th-tt').textContent(), 'Duplicate hosting charge');
  assert.equal(await th.locator('.ct-th-ai').count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a working thread shows the typing dots and its activity; the questions header shows Qn and the state', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const q2 = p.locator(`${session} .ct-th`).last();
  assert.equal(await q2.locator('.ct-th-n').textContent(), 'Q2');
  assert.equal(await q2.getAttribute('data-tone'), 'busy');
  assert.match(await q2.locator('.ct-th-st').textContent(), /Working · typed in the IDE/);
  assert.equal(await q2.locator('.ct-typing').count(), 1);
  assert.equal(await q2.locator('.ct-th-activity').textContent(), 'Running the tests…');
  await p.evaluate(() => {
    const box = window.demoThreads.session;
    box.append('q2', { from: 'other', text: 'Yes, same watcher.', at: new Date().toISOString() });
    box.upsert({ id: 'q2', tone: 'wait', activity: '' });
  });
  assert.equal(await q2.locator('.ct-typing').count(), 0);
  assert.match(await q2.locator('.ct-th-st').textContent(), /Waiting for you/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the list follows a new message only when the reader was at the bottom', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page(1200, 900);
  const gap = () => p.evaluate((sel) => { const l = document.querySelector(`${sel} .ct-th--active .ct-list`); return l.scrollHeight - l.scrollTop - l.clientHeight; }, team);
  const add = (n) => p.evaluate((count) => { for (let i = 0; i < count; i++) window.demoThreads.team.append('t2', { from: 'other', author: 'Ana', text: `line ${i}\nmore\nmore`, at: new Date().toISOString() }); }, n);
  await add(30);
  await p.locator(`${team} .ct-th--active .ct-th-earlier`).click();
  await p.evaluate((sel) => { const l = document.querySelector(`${sel} .ct-th--active .ct-list`); l.scrollTop = l.scrollHeight; }, team);
  await add(1);
  assert.ok(await gap() < 2, 'at the bottom, it follows');
  await p.evaluate((sel) => { document.querySelector(`${sel} .ct-th--active .ct-list`).scrollTop = 0; }, team);
  await add(1);
  assert.ok(await gap() > 100, 'scrolled up, it stays');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('typing in a thread keeps the focus and the text while messages arrive', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const input = p.locator(`${team} .ct-th--active .ct-input`);
  await input.click();
  await p.keyboard.type('half a sen');
  await p.evaluate(() => {
    const box = window.demoThreads.team;
    box.append('t2', { from: 'other', author: 'Ana', text: 'new', at: new Date().toISOString() });
    box.upsert({ id: 't2', tone: 'busy' });
    box.upsert({ id: 't2', tone: 'wait' });
  });
  await p.keyboard.type('tence');
  assert.equal(await input.inputValue(), 'half a sentence');
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains('ct-input')), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('threads fit a phone and a light page', async (t) => {
  if (!browser) return t.skip('no browser');
  for (const [w, scheme] of [[360, 'dark'], [1200, 'light']]) {
    const { p, ctx, errors } = await page(w, 800, { colorScheme: scheme });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no sideways scroll at ${w}`);
    const card = await p.locator(`${team} .ct-th`).nth(1).evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(card, scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 31, 36)');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('threads a page adds after createThreads get the box', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  const r = await p.evaluate(async () => {
    const { createThreads } = await import('/src/chat-thread.js');
    const host = document.createElement('div');
    document.body.append(host);
    const box = createThreads(host, { mode: 'questions' });
    const before = host.querySelector('.ct-th-new').hidden;
    box.upsert({ id: 'q1', n: 1, title: 'Fetched later', status: 'open', tone: 'wait', messages: [{ from: 'other', text: 'Hi' }] });
    return { before, active: box.active, fresh: host.querySelector('.ct-th-new').hidden };
  });
  assert.deepEqual(r, { before: false, active: 'q1', fresh: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a long thread shows its latest messages, the earlier ones behind a button', async (t) => {
  if (!browser) return t.skip('no browser');
  const { p, ctx, errors } = await page();
  await p.evaluate(() => { for (let i = 0; i < 5; i++) window.demoThreads.team.append('t2', { from: 'other', author: 'Ana', text: `n${i}`, at: new Date().toISOString() }); });
  const th = p.locator(`${team} .ct-th--active`);
  const shown = () => visible(p, `${team} .ct-th--active .ct-msg`);
  assert.equal(await shown(), 2);
  const all = await th.locator('.ct-msg').count();
  const bt = th.locator('.ct-th-earlier');
  assert.equal(await bt.textContent(), `Show ${all - 2} earlier messages`);
  await bt.click();
  assert.equal(await shown(), all);
  assert.equal(await bt.textContent(), 'Show only the latest');
  await bt.click();
  assert.equal(await shown(), 2);
  assert.equal(await visible(p, `${team} .ct-th--active .ct-day`) <= 1, true, 'no separator above nothing');
  assert.deepEqual(errors, []);
  await ctx.close();
});

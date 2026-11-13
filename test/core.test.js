import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  DEFAULT_STRINGS, authorTone, dayKey, dayLabel, escapeHtml, formatTime, isLong, linkify, normalizeChips, normalizeMessage,
  normalizeToggles, renderComposer, renderList, renderMarkdown, renderMessage, renderPlain, renderThread, renderWhatsApp, resolveOptions,
  safeUrl,
} from '../src/core.js';

const UTC = { timeZone: 'UTC', locale: 'en-US' };
const NOW = () => new Date('2026-11-13T20:00:00Z');

test('safeUrl keeps http(s) and relative links, refuses script schemes', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('/settings#disk'), '/settings#disk');
  assert.equal(safeUrl('#task'), '#task');
  assert.equal(safeUrl('./a.html'), './a.html');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//evil.example'), null);
  assert.equal(safeUrl('/a b'), null);
  assert.equal(safeUrl(42), null);
});

test('linkify escapes the text and links bare URLs without trailing punctuation', () => {
  const html = linkify('See <b>this</b>: https://example.com/x, then stop.');
  assert.match(html, /&lt;b&gt;this&lt;\/b&gt;/);
  assert.match(html, /<a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<\/a>, then stop\./);
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('markdown: paragraphs, headings, lists, code with Copy, inline marks and links', () => {
  const html = renderMarkdown('# Plan\n**On it.** Steps:\n1. *first* `npm test`\n2. ~~old~~ new\n\n- a [link](https://example.com/x)\n- bare https://example.com/y.\n\n```js\nconst a = 1 < 2;\n```\nline one\nline two');
  assert.match(html, /^<p class="ct-heading">Plan<\/p>/);
  assert.match(html, /<p><strong>On it\.<\/strong> Steps:<\/p>/);
  assert.match(html, /<ol><li><em>first<\/em> <code>npm test<\/code><\/li><li><del>old<\/del> new<\/li><\/ol>/);
  assert.match(html, /<ul><li>a <a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer">link<\/a><\/li>/);
  assert.match(html, /bare <a href="https:\/\/example.com\/y"[^>]*>https:\/\/example.com\/y<\/a>\.<\/li>/);
  assert.match(html, /<div class="ct-code"><pre><code data-lang="js">const a = 1 &lt; 2;<\/code><\/pre><button type="button" class="ct-copy">Copy<\/button><\/div>/);
  assert.match(html, /<p>line one<br>line two<\/p>$/);
  assert.match(renderMarkdown('3. three\n4. four'), /<ol start="3">/);
});

test('markdown never lets HTML or script links through, and leaves math and snake_case alone', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) `<b>` 2 * 3 * 4 and snake_case_name');
  assert.doesNotMatch(html, /<img|<b>|href="javascript/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\[x\]\(javascript:alert\(1\)\)/);
  assert.match(html, /<code>&lt;b&gt;<\/code>/);
  assert.match(html, /2 \* 3 \* 4 and snake_case_name/);
  assert.equal(renderMarkdown('```\nunclosed <code>'), '<div class="ct-code"><pre><code>unclosed &lt;code&gt;</code></pre><button type="button" class="ct-copy">Copy</button></div>');
  assert.doesNotMatch(renderMarkdown('```\nx\n```', { copy: false }), /ct-copy/);
});

test('whatsapp marks: *bold* _italic_ ~strike~ ```mono``` only at word edges', () => {
  const html = renderWhatsApp('Hi *Alex*, _see_ ~old~ ```a  b``` `x`\n2*3*4 snake_case ~ a~\n\nhttps://example.com/q_1');
  assert.match(html, /^<p>Hi <strong>Alex<\/strong>, <em>see<\/em> <del>old<\/del> <code class="ct-mono">a {2}b<\/code> <code>x<\/code><br>2\*3\*4 snake_case ~ a~<\/p>/);
  assert.match(html, /<p><a href="https:\/\/example.com\/q_1"[^>]*>https:\/\/example.com\/q_1<\/a><\/p>$/);
  assert.equal(renderWhatsApp('*_both_*'), '<p><strong><em>both</em></strong></p>');
  assert.equal(renderWhatsApp('"*quoted*"'), '<p>&quot;<strong>quoted</strong>&quot;</p>');
  assert.equal(renderWhatsApp('<script>*x*</script>'), '<p>&lt;script&gt;<strong>x</strong>&lt;/script&gt;</p>');
});

test('plain text stays as written: escaped, spaces and line breaks kept, links clickable', () => {
  assert.equal(renderPlain('  **not bold**\n<i>x</i>  https://example.com '), '<p class="ct-plain">  **not bold**\n&lt;i&gt;x&lt;/i&gt;  <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>');
  assert.equal(renderPlain('   \n'), '');
});

test('times and day labels follow the time zone and the locale', () => {
  assert.equal(dayKey('2026-11-13T02:30:00Z', { timeZone: 'America/Sao_Paulo' }), '2026-11-12');
  assert.equal(dayKey('2026-11-13T02:30:00Z', { timeZone: 'UTC' }), '2026-11-13');
  assert.equal(dayKey('nope'), '');
  assert.equal(formatTime('2026-11-13T17:05:00Z', UTC), '17:05');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { ...UTC, hour12: true }), '5:05 PM');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { timeZone: 'Bad/Zone' }).length > 0, true, 'a bad zone falls back instead of throwing');
  const opts = { now: NOW(), ...UTC };
  assert.equal(dayLabel('2026-11-13', opts), 'Today');
  assert.equal(dayLabel('2026-11-12', opts), 'Yesterday');
  assert.equal(dayLabel('2026-11-10', opts), 'Tuesday');
  assert.equal(dayLabel('2026-10-02', opts), 'Oct 2');
  assert.equal(dayLabel('2025-10-02', opts), 'Oct 2, 2025');
  assert.equal(dayLabel('2026-11-10', { ...opts, locale: 'pt-BR' }), 'Terça-feira');
  assert.equal(dayLabel('2026-11-13', { ...opts, strings: { ...DEFAULT_STRINGS, today: 'Hoje' } }), 'Hoje');
});

test('normalizeMessage falls back on bad input instead of throwing', () => {
  const m = normalizeMessage({ id: '7', from: 'admin', text: 42, at: 'nope', state: 'lost', alert: 'yes', format: 'html', meta: [1] });
  assert.deepEqual(m, { id: '7', from: 'other', author: '', text: '42', at: null, state: null, alert: false, tag: '', title: '', format: null, meta: null });
  assert.equal(normalizeMessage({ id: 3, from: 'me' }).id, 3);
  assert.equal(normalizeMessage(null).from, 'other');
});

test('chips and toggles drop what cannot be shown', () => {
  assert.deepEqual(normalizeChips(['Explain', { label: 'Short', text: 'Make it shorter', fill: true }, { label: '' }, 3]), [
    { label: 'Explain', text: 'Explain', fill: false },
    { label: 'Short', text: 'Make it shorter', fill: true },
  ]);
  assert.deepEqual(normalizeToggles([{ name: 'close', label: 'Close when done' }, { name: 'bad name' }, null]), [{ name: 'close', label: 'Close when done', checked: false }]);
});

test('resolveOptions fills defaults and replaces bad values', () => {
  const o = resolveOptions({ mode: 'kiosk', theme: 'Not<valid>', format: 'html', clamp: 'x', author: '  Bot  ' });
  assert.deepEqual([o.mode, o.theme, o.format, o.clamp, o.days, o.author], ['chat', 'dark', 'auto', 500, true, 'Bot']);
  assert.equal(resolveOptions({ mode: 'preview' }).days, false);
  assert.equal(resolveOptions(o), o, 'resolving twice is free');
});

test('a bubble: side, author only on the other side, time, ticks by state', () => {
  const opts = { ...UTC, now: NOW, author: 'Assistant' };
  const mine = renderMessage({ id: 1, from: 'me', text: 'hi **there**', at: '2026-11-13T17:50:00Z' }, opts);
  assert.match(mine, /^<div class="ct-msg ct-msg--mine" data-id="1" data-day="2026-11-13">/);
  assert.doesNotMatch(mine, /ct-author/);
  assert.match(mine, /<p class="ct-plain">hi \*\*there\*\*<span class="ct-meta"><time datetime="2026-11-13T17:50:00.000Z">17:50<\/time><svg class="ct-tick ct-tick--read"[^>]*aria-label="Read"/);
  const theirs = renderMessage({ id: 2, from: 'other', text: 'hi **there**', at: '2026-11-13T17:51:00Z' }, opts);
  assert.match(theirs, /<span class="ct-author">Assistant<\/span><div class="ct-body"><p>hi <strong>there<\/strong><span class="ct-meta"><time[^>]*>17:51<\/time><\/span><\/p><\/div>/);
  assert.match(renderMessage({ from: 'me', text: 'x', state: 'sent' }, opts), /aria-label="Sent"><path d="M5 13l4 4 10-11"/);
  assert.match(renderMessage({ from: 'me', text: 'x', state: 'delivered' }, opts), /<svg class="ct-tick" [^>]*aria-label="Delivered"/);
  assert.match(renderMessage({ from: 'me', text: 'x', state: 'pending' }, opts), /ct-tick--clock[^>]*aria-label="Pending"/);
  assert.doesNotMatch(renderMessage({ from: 'me', text: 'x' }, { ...opts, ticks: false }), /ct-tick/);
});

test('queued, alert, tag, title and code at the end', () => {
  const queued = renderMessage({ id: 9, from: 'me', text: 'later', state: 'queued' }, UTC);
  assert.match(queued, /class="ct-msg ct-msg--mine ct-msg--queued"/);
  assert.match(queued, /<p class="ct-plain"><span class="ct-tag">Queued<\/span>later/);
  assert.match(queued, /<button type="button" class="ct-remove" aria-label="Remove" title="Remove">×<\/button>/);
  assert.doesNotMatch(renderMessage({ id: 9, from: 'me', text: 'x', state: 'queued' }, { mode: 'readonly' }), /ct-remove/, 'nothing to remove in a log');
  assert.match(renderMessage({ from: 'me', text: 'x', state: 'queued', tag: 'waits for the session' }, UTC), /<span class="ct-tag">waits for the session<\/span>/);
  assert.match(renderMessage({ from: 'other', text: 'x', alert: true }), /ct-msg--theirs ct-msg--alert/);
  assert.match(renderMessage({ from: 'other', title: 'Note of the day', text: 'x' }), /<p class="ct-title">Note of the day<\/p><div class="ct-body">/);
  const code = renderMessage({ from: 'other', text: 'run:\n```\nnpm test\n```', at: '2026-11-13T10:00:00Z' }, UTC);
  assert.match(code, /<\/div><\/div><span class="ct-meta">/, 'after a code block the time goes below it');
});

test('long messages start collapsed with "Read more" and the time below it', () => {
  const html = renderMessage({ from: 'other', text: 'word '.repeat(150), at: '2026-11-13T10:00:00Z' }, UTC);
  assert.match(html, /<div class="ct-body ct-body--clamped">.*<\/div><button type="button" class="ct-more" aria-expanded="false">Read more<\/button><span class="ct-meta">/);
  assert.equal(isLong('a\n'.repeat(11)), true);
  assert.equal(isLong('short'), false);
  assert.equal(isLong('x'.repeat(5000), 0), false, 'clamp 0 turns it off');
});

test('formats: theirs markdown and mine plain by default; whatsapp for everyone when asked', () => {
  assert.match(renderMessage({ from: 'other', text: '*a*' }), /<em>a<\/em>/);
  assert.match(renderMessage({ from: 'me', text: '*a*' }), /\*a\*/);
  assert.match(renderMessage({ from: 'me', text: '*a*' }, { format: 'whatsapp' }), /<strong>a<\/strong>/);
  assert.match(renderMessage({ from: 'other', text: '*a*', format: 'plain' }), /\*a\*/, 'a message can choose its own format');
});

test('group authors get a stable color slot', () => {
  assert.equal(authorTone('Dana'), authorTone('Dana'));
  assert.ok(authorTone('Kim') >= 1 && authorTone('Kim') <= 6);
  assert.match(renderMessage({ from: 'other', author: 'Dana', text: 'x' }, { colorAuthors: true }), new RegExp(`ct-author ct-author--${authorTone('Dana')}`));
});

test('the list: a separator per day, then the typing and waiting lines', () => {
  const list = renderList([
    { id: 1, from: 'me', text: 'a', at: '2026-11-12T10:00:00Z' },
    { id: 2, from: 'other', text: 'b', at: '2026-11-13T09:00:00Z' },
    { id: 3, from: 'me', text: 'c', at: '2026-11-13T09:05:00Z' },
  ], { ...UTC, now: NOW, author: 'Assistant' }, { typing: true, waiting: 'Session 2' });
  assert.deepEqual([...list.matchAll(/class="ct-day"[^>]*>([^<]*)</g)].map((m) => m[1]), ['Yesterday', 'Today']);
  assert.match(list, /<div class="ct-msg ct-msg--theirs ct-typing" role="status" aria-label="Assistant is typing"><span class="ct-author">Assistant<\/span><span class="ct-dots"/);
  assert.match(list, /<div class="ct-waiting" role="status">Session 2 has not replied yet…<\/div>$/);
  assert.doesNotMatch(renderList([{ text: 'a', at: '2026-11-12T10:00:00Z' }], { days: false }), /ct-day/);
  assert.match(renderList([], {}, { typing: 'x', waiting: true }), /No reply yet…/);
});

test('the thread: modes, themes, composer with chips and toggles', () => {
  const chat = renderThread([{ from: 'other', text: 'hi' }], {
    chips: ['Explain', { label: 'Shorter', text: 'Make it shorter', fill: true }],
    toggles: [{ name: 'close', label: 'Close the session when done', checked: true }],
    strings: { placeholder: 'Ask about the reading' },
  });
  assert.match(chat, /^<div class="ct" data-mode="chat"><div class="ct-list" role="log" aria-label="Conversation">/);
  assert.match(chat, /<button type="button" class="ct-chip" data-text="Explain">Explain<\/button><button type="button" class="ct-chip" data-text="Make it shorter" data-fill>Shorter<\/button>/);
  assert.match(chat, /<textarea class="ct-input" rows="1" maxlength="20000" placeholder="Ask about the reading" aria-label="Ask about the reading"><\/textarea>/);
  assert.match(chat, /<button type="button" class="ct-send" disabled aria-label="Send"/);
  assert.match(chat, /<label><input type="checkbox" name="close" checked> Close the session when done<\/label>/);
  const log = renderThread([{ from: 'other', text: 'hi', at: '2026-11-13T10:00:00Z' }], { mode: 'readonly' });
  assert.match(log, /^<div class="ct ct--readonly" data-mode="readonly">/);
  assert.doesNotMatch(log, /ct-composer/);
  const preview = renderThread([{ from: 'me', text: 'hi', at: '2026-11-13T10:00:00Z' }], { mode: 'preview', theme: 'whatsapp' });
  assert.match(preview, /^<div class="ct ct--whatsapp ct--preview" data-mode="preview">/);
  assert.doesNotMatch(preview, /ct-day|ct-composer/);
  assert.equal(renderComposer({}).includes('ct-chips'), false);
});

test('CSP-safe markup: no style attributes, no inline handlers, everything escaped', () => {
  const evil = '<script>x</script> " onmouseover="x" style="color:red" [a](javascript:x)';
  const html = renderThread([
    { id: '"><b>', from: 'other', author: evil, title: evil, tag: evil, text: `${evil}\n\`\`\`\n${evil}\n\`\`\`` },
    { from: 'me', text: evil, state: 'queued', id: 1 },
    { from: 'other', text: evil, format: 'whatsapp' },
  ], { author: evil, chips: [evil], toggles: [{ name: 'x', label: evil }], strings: { placeholder: evil } }, { typing: evil, waiting: evil });
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son\w+="/);
  assert.doesNotMatch(html, /<script|<b>|javascript:x"/);
});

test('the dist builds load and render exactly like src', async () => {
  const messages = [{ id: 1, from: 'other', author: 'Bot', text: '**hi** `x`', at: '2026-11-13T10:00:00Z' }];
  const expected = renderThread(messages, { ...UTC, now: NOW });
  const esm = await import('../dist/chat-thread.mjs');
  assert.equal(esm.renderThread(messages, { ...UTC, now: NOW }), expected);
  assert.equal(typeof esm.default, 'function');
  const sandbox = { Intl, Date, Symbol, console };
  vm.runInNewContext(await readFile(new URL('../dist/chat-thread.global.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(sandbox.ChatThread.renderThread(messages, { ...UTC, now: NOW }), expected);
  assert.deepEqual(Object.keys(sandbox.ChatThread).filter((k) => /^(createChat|restStore|memoryStore|localStore)$/.test(k)).sort(), ['createChat', 'localStore', 'memoryStore', 'restStore']);
});

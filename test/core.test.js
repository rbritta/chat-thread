import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  DEFAULT_STRINGS, authorTone, dayKey, dayLabel, escapeHtml, formatTime, isLong, linkify, normalizeChips, normalizeMessage,
  normalizeAttach, normalizeToggles, renderComposer, renderList, renderMarkdown, renderMessage, renderPinned, renderPlain, renderThread, renderTyping, renderWhatsApp,
  keepOriginal, pinnedOf, resolveOptions, reviseMessage, safeUrl,
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
  // 12 or 24 hours: the locale decides, like the rest of the page; hour12 forces one of them
  assert.equal(formatTime('2026-11-13T17:05:00Z', UTC), '5:05 PM');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { timeZone: 'UTC', locale: 'en-IE' }), '17:05');
  assert.equal(formatTime('2026-11-13T09:05:00Z', { timeZone: 'UTC', locale: 'en-GB' }), '09:05');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { ...UTC, hour12: false }), '17:05');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { timeZone: 'UTC', locale: 'en-GB', hour12: true }).startsWith('5:05'), true);
  assert.equal(resolveOptions({ hour12: 'yes' }).hour12, undefined, 'only true or false force it');
  assert.equal(formatTime('2026-11-13T17:05:00Z', { timeZone: 'Bad/Zone' }).length > 0, true, 'a bad zone falls back instead of throwing');
  const opts = { now: NOW(), ...UTC };
  assert.equal(dayLabel('2026-11-13', opts), 'Today');
  assert.equal(dayLabel('2026-11-12', opts), 'Yesterday');
  assert.equal(dayLabel('2026-11-10', opts), 'Tuesday');
  assert.equal(dayLabel('2026-10-02', opts), 'Oct 2');
  assert.equal(dayLabel('2025-10-02', opts), 'Oct 2, 2025');
  assert.equal(dayLabel('2026-10-02', { ...opts, locale: 'en-GB' }), '2 Oct');
  assert.equal(dayLabel('2026-11-13', { ...opts, strings: { ...DEFAULT_STRINGS, today: 'Earlier today' } }), 'Earlier today');
});

test('normalizeMessage falls back on bad input instead of throwing', () => {
  const m = normalizeMessage({ id: '7', from: 'admin', kind: 'aside', text: 42, at: 'nope', state: 'lost', alert: 'yes', format: 'html', meta: [1] });
  assert.deepEqual(m, { id: '7', from: 'other', kind: 'bubble', author: '', text: '42', at: null, state: null, alert: false, tag: '', title: '', format: null, meta: null, image: null, pinned: false, original: null });
  assert.equal(normalizeMessage({ kind: 'note' }).kind, 'note');
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
  const opts = { ...UTC, hour12: false, now: NOW, author: 'Assistant' };
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

test('a note: no bubble, no author, no ticks, markdown, the time on its own line', () => {
  const opts = { ...UTC, hour12: false, now: NOW, author: 'Assistant', colorAuthors: true };
  const note = renderMessage({ id: 4, from: 'other', kind: 'note', text: 'Friday has **three** times:\n- 10:30\n- 14:00', at: '2026-11-13T10:03:00Z' }, opts);
  assert.equal(note, '<div class="ct-msg ct-msg--note" data-id="4" data-day="2026-11-13"><div class="ct-body"><p>Friday has <strong>three</strong> times:</p><ul><li>10:30</li><li>14:00</li></ul></div><span class="ct-meta"><time datetime="2026-11-13T10:03:00.000Z">10:03</time></span></div>');
  assert.equal(renderMessage({ kind: 'note', text: 'no time' }, opts), '<div class="ct-msg ct-msg--note"><div class="ct-body"><p>no time</p></div></div>', 'no at, no time');
  assert.match(renderMessage({ kind: 'note', text: 'hi', author: 'Dana', title: 'Today' }, opts), /^<div class="ct-msg ct-msg--note"><p class="ct-title">Today<\/p><div class="ct-body">/, 'a title yes, an author line no');
  const mine = renderMessage({ id: 5, from: 'me', kind: 'note', state: 'queued', text: '**booked**' }, opts);
  assert.match(mine, /class="ct-msg ct-msg--note ct-msg--queued"/);
  assert.match(mine, /<strong>booked<\/strong>/, 'a note is markdown on either side');
  assert.doesNotMatch(mine, /ct-tick|ct-remove/);
  assert.match(renderMessage({ kind: 'note', text: 'failed', alert: true }), /class="ct-msg ct-msg--note ct-msg--alert"/);
  const long = renderMessage({ kind: 'note', text: 'word '.repeat(150), at: '2026-11-13T10:00:00Z' }, UTC);
  assert.match(long, /<div class="ct-body ct-body--clamped">.*<\/div><button type="button" class="ct-more" aria-expanded="false">Read more<\/button><span class="ct-meta">/);
  assert.match(renderMessage({ kind: 'note', text: '*a*' }, { format: 'whatsapp' }), /<strong>a<\/strong>/, 'the thread format still applies');
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
  assert.match(list, /<div class="ct-msg ct-msg--theirs ct-typing" data-author="Assistant"><span class="ct-author" aria-hidden="true">Assistant<\/span><span class="ct-sr">Assistant is typing<\/span><span class="ct-dots" aria-hidden="true">/);
  assert.match(list, /<div class="ct-waiting" data-author="Session 2">Session 2 has not replied yet…<\/div>$/);
  assert.doesNotMatch(list, /role="status"/, 'the log announces them: no live region inside the live region');
  assert.doesNotMatch(renderList([{ text: 'a', at: '2026-11-12T10:00:00Z' }], { days: false }), /ct-day/);
  assert.match(renderList([], {}, { typing: 'x', waiting: true }), /No reply yet…/);
});

test('the thread: modes, themes, composer with chips and toggles', () => {
  const chat = renderThread([{ from: 'other', text: 'hi' }], {
    chips: ['Explain', { label: 'Shorter', text: 'Make it shorter', fill: true }],
    toggles: [{ name: 'close', label: 'Close the session when done', checked: true }],
    strings: { placeholder: 'Ask about the reading' },
  });
  assert.match(chat, /^<div class="ct" data-mode="chat" data-options="[^"]+"><div class="ct-list" role="log" aria-label="Conversation">/);
  assert.match(chat, /<button type="button" class="ct-chip" data-text="Explain">Explain<\/button><button type="button" class="ct-chip" data-text="Make it shorter" data-fill>Shorter<\/button>/);
  assert.match(chat, /<textarea class="ct-input" rows="1" maxlength="20000" enterkeyhint="send" placeholder="Ask about the reading" aria-label="Ask about the reading"><\/textarea>/);
  assert.match(renderComposer({ enterSends: false }), /enterkeyhint="enter"/);
  assert.match(chat, /<button type="button" class="ct-send" disabled aria-label="Send"/);
  assert.match(chat, /<label><input type="checkbox" name="close" checked> Close the session when done<\/label>/);
  const log = renderThread([{ from: 'other', text: 'hi', at: '2026-11-13T10:00:00Z' }], { mode: 'readonly' });
  assert.match(log, /^<div class="ct ct--readonly" data-mode="readonly">/);
  assert.doesNotMatch(log, /ct-composer/);
  const preview = renderThread([{ from: 'me', text: 'hi', at: '2026-11-13T10:00:00Z' }], { mode: 'preview', theme: 'whatsapp' });
  assert.match(preview, /^<div class="ct ct--whatsapp ct--preview" data-mode="preview"[ >]/);
  assert.doesNotMatch(preview, /ct-day|ct-composer/);
  assert.equal(renderComposer({}).includes('ct-chips'), false);
  assert.match(renderThread([], { theme: 'light' }), /^<div class="ct ct--light" data-mode="chat"[ >]/);
  assert.match(renderThread([], { theme: 'auto', mode: 'readonly' }), /^<div class="ct ct--auto ct--readonly" data-mode="readonly"[ >]/);
});

test('CSP-safe markup: no style attributes, no inline handlers, everything escaped', () => {
  const evil = '<script>x</script> " onmouseover="x" style="color:red" [a](javascript:x)';
  const html = renderThread([
    { id: '"><b>', from: 'other', author: evil, title: evil, tag: evil, text: `${evil}\n\`\`\`\n${evil}\n\`\`\`` },
    { from: 'me', text: evil, state: 'queued', id: 1 },
    { from: 'other', text: evil, format: 'whatsapp' },
    { from: 'other', kind: 'note', text: evil, title: evil, tag: evil, at: '2026-11-13T10:00:00Z' },
    { from: 'other', text: `| ${evil} | b |\n|---|---|\n| ${evil} | [${evil}](reply:${evil} "${evil}") |\n| | [x](fill:${evil}) |` },
    { id: '"><i>', from: 'other', pinned: true, original: evil, title: evil, text: `| ${evil} | [✓](reply:${evil}) |\n|---|---|\n| ${evil} | ${evil} |` },
  ], { author: evil, chips: [evil], toggles: [{ name: 'x', label: evil }], strings: { placeholder: evil, pinned: evil, showSource: evil } }, { typing: evil, waiting: evil });
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son\w+="/);
  assert.doesNotMatch(html, /<script|<b>|javascript:x"/);
  // no attribute value lets a < or > through, and only the tags the library writes are there
  for (const [, value] of html.matchAll(/="([^"]*)"/g)) assert.doesNotMatch(value, /[<>]/);
  const tags = new Set([...html.matchAll(/<([a-z][\w-]*)/g)].map((m) => m[1]));
  const ours = ['br', 'button', 'circle', 'code', 'del', 'div', 'em', 'i', 'input', 'label', 'p', 'path', 'pre', 'span', 'strong', 'svg', 'table', 'tbody', 'td', 'textarea', 'th', 'thead', 'time', 'tr'];
  assert.deepEqual([...tags].filter((t) => !ours.includes(t)), []);
});

test('the dist builds load and render exactly like src', async () => {
  const messages = [
    { id: 1, from: 'other', author: 'Bot', text: '**hi** `x`', at: '2026-11-13T10:00:00Z' },
    { id: 2, from: 'other', kind: 'note', text: 'a note', at: '2026-11-13T10:01:00Z' },
  ];
  const expected = renderThread(messages, { ...UTC, now: NOW });
  const esm = await import('../dist/chat-thread.mjs');
  assert.equal(esm.renderThread(messages, { ...UTC, now: NOW }), expected);
  assert.equal(typeof esm.default, 'function');
  const sandbox = { Intl, Date, Symbol, console };
  vm.runInNewContext(await readFile(new URL('../dist/chat-thread.global.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(sandbox.ChatThread.renderThread(messages, { ...UTC, now: NOW }), expected);
  assert.deepEqual(Object.keys(sandbox.ChatThread).filter((k) => /^(createChat|restStore|memoryStore|localStore)$/.test(k)).sort(), ['createChat', 'localStore', 'memoryStore', 'restStore']);
});

test('safeUrl refuses backslashes and control characters: "/\\host" is another site to a browser', () => {
  assert.equal(safeUrl('/\\evil.example'), null);
  assert.equal(safeUrl('/x\\y'), null);
  assert.equal(safeUrl('/\u0000x'), null);
  assert.equal(safeUrl('https://example.com/a\u0007'), null);
  assert.equal(safeUrl('https://'), null);
  assert.equal(safeUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
  assert.doesNotMatch(renderMarkdown('[x](/\\evil.example)'), /<a /);
  assert.doesNotMatch(renderMarkdown('[x](  javascript:alert(1) )'), /<a /);
  assert.match(renderMarkdown('[x](https://example.com/"onmouseover="y)'), /href="https:\/\/example\.com\/&quot;onmouseover=&quot;y"/);
  assert.equal(linkify(`https://example.com/${'a'.repeat(3000)}`).includes('<a '), false, 'too long to be a link');
});

test('emphasis marks never cross: the tags always nest', () => {
  const nested = (html) => {
    const open = [];
    for (const [, close, tag] of html.matchAll(/<(\/?)(strong|em|del)>/g)) {
      if (!close) open.push(tag);
      else if (open.pop() !== tag) return false;
    }
    return open.length === 0;
  };
  for (const text of ['**a *b** c*', '*a **b* c**', '~~a *b~~ c*', '**a _b** c_', '_a **b_ c**']) assert.ok(nested(renderMarkdown(text)), text);
  for (const text of ['*a _b* c_', '_a *b_ c*', '~a *b~ c*']) assert.ok(nested(renderWhatsApp(text)), text);
  assert.equal(renderMarkdown('**a *b** c*'), '<p><strong>a *b</strong> c*</p>');
  assert.equal(renderMarkdown('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>', 'proper nesting still works');
});

test('markdown: a fence may carry more than the language, and "# C#" keeps its #', () => {
  const html = renderMarkdown('```js title="a.js"\nconst a = 1;\n```\nafter');
  assert.match(html, /^<div class="ct-code"><pre><code data-lang="js">const a = 1;<\/code><\/pre>/);
  assert.match(html, /<p>after<\/p>$/, 'the closing fence closes it');
  assert.match(renderMarkdown('```{r}\nx\n```'), /<pre><code>x<\/code><\/pre>/);
  assert.equal(renderMarkdown('# C#'), '<p class="ct-heading">C#</p>');
  assert.equal(renderMarkdown('## Title ##'), '<p class="ct-heading">Title</p>');
  assert.match(renderMarkdown('```js```'), /^<p>/, 'backticks on the line: not a fence');
});

test('a bad locale falls back without losing the time zone, and never throws', () => {
  // the runtime's own language (12 or 24 hours, as the machine is set), still in Tokyo time
  const fallback = formatTime('2026-11-13T02:30:00Z', { locale: 'not a locale', timeZone: 'Asia/Tokyo' });
  assert.equal(fallback, formatTime('2026-11-13T02:30:00Z', { timeZone: 'Asia/Tokyo' }));
  assert.match(fallback, /^11:30/);
  const html = renderThread([{ text: 'x', at: '2026-11-10T10:00:00Z' }], { locale: 'not a locale', timeZone: 'UTC', now: NOW });
  assert.match(html, /class="ct-day"[^>]*>[A-Z]/);
});

test('day separators fall on the days of the time zone given', () => {
  const messages = [
    { id: 1, from: 'other', text: 'late', at: '2026-11-13T02:30:00Z' },
    { id: 2, from: 'me', text: 'later', at: '2026-11-13T12:00:00Z' },
  ];
  const days = (timeZone) => [...renderList(messages, { timeZone, locale: 'en-US', now: NOW }).matchAll(/class="ct-day"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(days('UTC'), ['Today']);
  assert.deepEqual(days('America/Sao_Paulo'), ['Yesterday', 'Today']);
  assert.deepEqual(days('Asia/Tokyo'), ['Yesterday'], 'both on the 13th there, and it is the 14th now');
});

test('typing dots take the shape of the other side: a note side types as a note', () => {
  const opts = { ...UTC, now: NOW, author: 'Assistant' };
  const shape = (messages, o = opts) => (renderList(messages, o, { typing: true }).match(/<div class="ct-msg (ct-msg--\w+) ct-typing"/) || [])[1];
  const note = { from: 'other', kind: 'note', text: 'Pick a time.' };
  const bubble = { from: 'other', text: 'Hi' };
  const mine = { from: 'me', text: 'Friday' };
  assert.equal(shape([]), 'ct-msg--theirs', 'nothing yet: a bubble, as before');
  assert.equal(shape([bubble, mine]), 'ct-msg--theirs');
  assert.equal(shape([note, mine]), 'ct-msg--note', 'my bubbles do not count');
  assert.equal(shape([note, bubble, mine]), 'ct-msg--theirs', 'the last one of the other side decides');
  assert.equal(shape([note, mine], { ...opts, typingKind: 'bubble' }), 'ct-msg--theirs', 'the option wins');
  assert.equal(shape([bubble], { ...opts, typingKind: 'note' }), 'ct-msg--note');
  assert.equal(resolveOptions({ typingKind: 'cloud' }).typingKind, 'auto');
  assert.equal(renderTyping(true, opts, 'note'), '<div class="ct-msg ct-msg--note ct-typing" data-author="Assistant"><span class="ct-sr">Assistant is typing</span><span class="ct-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>', 'a note has no name line');
  assert.match(renderTyping('x', { strings: { typing: '{author} escreve' } }), /<span class="ct-sr">x escreve<\/span>/);
  assert.match(renderTyping(true, {}), /^<div class="ct-msg ct-msg--theirs ct-typing"><span class="ct-sr">Typing<\/span>/);
});

test('a failed message shows a red mark labelled "Not sent" in place of the ticks', () => {
  const html = renderMessage({ id: 'tmp-1', from: 'me', text: 'hello', state: 'failed', alert: true }, { strings: { failed: 'Could not send' } });
  assert.match(html, /^<div class="ct-msg ct-msg--mine ct-msg--alert"/);
  assert.match(html, /<svg class="ct-tick ct-tick--failed"[^>]*aria-label="Could not send">/);
  assert.equal(normalizeMessage({ state: 'failed' }).state, 'failed');
});

test('the thread carries its options for hydration, escaped, and only those that differ', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const html = renderThread([], {
    ...UTC, author: evil, hour12: true, mode: 'readonly', days: true, typingKind: 'note',
    strings: { placeholder: 'Write a reply', send: DEFAULT_STRINGS.send, more: evil, less: undefined },
    toggles: [{ name: 'close', label: evil }], chips: ['Hi'],
  });
  const attr = /data-options="([^"]*)"/.exec(html)[1];
  assert.doesNotMatch(attr, /[<>"]/);
  const carried = JSON.parse(attr.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  assert.deepEqual(carried, {
    author: evil, typingKind: 'note', locale: 'en-US', timeZone: 'UTC', hour12: true,
    chips: [{ label: 'Hi', text: 'Hi', fill: false }], toggles: [{ name: 'close', label: evil, checked: false }],
    strings: { placeholder: 'Write a reply', more: evil },
  });
  assert.doesNotMatch(renderThread([], {}), /data-options/, 'nothing to carry, no attribute');
  assert.doesNotMatch(renderThread([], { mode: 'preview' }), /data-options/, 'days follow the mode by default');
});

test('fields are cut without splitting an emoji, and missing strings fall back', () => {
  const author = `${'a'.repeat(79)}😀`;
  assert.equal(normalizeMessage({ author }).author, 'a'.repeat(79), 'the emoji does not fit whole: it goes whole');
  assert.equal(normalizeMessage({ text: '😀'.repeat(10001) }).text.length, 20000);
  assert.equal(resolveOptions({ strings: { placeholder: undefined, send: null } }).strings.placeholder, 'Message');
});

test('the + left of the box: only known items, once, and nothing without them', () => {
  assert.deepEqual(normalizeAttach(['camera', 'camera', 'files', 7]), ['camera']);
  assert.deepEqual(normalizeAttach('camera'), []);
  assert.doesNotMatch(renderComposer({}), /ct-attach|ct-file/);
  const box = renderComposer({ attach: ['camera'], strings: { attach: 'Anexar', camera: 'Câmera' } });
  assert.match(box, /<div class="ct-row"><button type="button" class="ct-attach" aria-haspopup="menu" aria-expanded="false" aria-label="Anexar" title="Anexar">/);
  assert.match(box, /<div class="ct-menu" role="menu" hidden><button type="button" class="ct-menu-item" role="menuitem" data-attach="camera">.*Câmera<\/button><\/div>/);
  assert.match(box, /<input type="file" class="ct-file" accept="image\/\*" capture="environment" tabindex="-1" aria-hidden="true" hidden><div class="ct-field">/);
  assert.match(renderThread([], { attach: ['camera'] }), /data-options="[^"]*attach/);
});

test('a photo in the bubble: a button with the picture before the text; only safe URLs', () => {
  assert.deepEqual(normalizeMessage({ image: '/f/1.jpg' }).image, { src: '/f/1.jpg', alt: '' });
  assert.deepEqual(normalizeMessage({ image: { src: 'https://x.test/a.jpg', alt: 'shelf' } }).image, { src: 'https://x.test/a.jpg', alt: 'shelf' });
  assert.equal(normalizeMessage({ image: 'javascript:alert(1)' }).image, null);
  assert.equal(normalizeMessage({}).image, null);
  assert.deepEqual(normalizeMessage({ image: { src: '/a.jpg', width: 480, height: 640 } }).image, { src: '/a.jpg', alt: '', width: 480, height: 640 });
  assert.deepEqual(normalizeMessage({ image: { src: '/a.jpg', width: '480', height: -1 } }).image, { src: '/a.jpg', alt: '' });
  assert.match(renderMessage({ image: { src: '/a.jpg', width: 480, height: 640 } }), /<img src="\/a\.jpg" alt="" width="210" height="280" loading="lazy"/);
  assert.equal(normalizeMessage({ image: 'data:image/jpeg;base64,/9j/4AAQ==' }).image.src, 'data:image/jpeg;base64,/9j/4AAQ==', 'a camera preview');
  assert.equal(normalizeMessage({ image: 'data:image/svg+xml;base64,PHN2Zz4=' }).image, null, 'never SVG');
  assert.equal(normalizeMessage({ image: 'data:image/png;base64,AA"><script>' }).image, null);
  const html = renderMessage({ from: 'me', text: 'the shelf', image: { src: '/f/1.jpg?a=1&b=2', alt: 'x"y' }, at: '2026-11-13T19:00:00Z' }, { ...UTC, strings: { enlarge: 'Ampliar' } });
  assert.match(html, /class="ct-msg ct-msg--mine ct-msg--image"/);
  assert.match(html, /<button type="button" class="ct-img" aria-label="Ampliar" title="Ampliar"><img src="\/f\/1\.jpg\?a=1&amp;b=2" alt="x&quot;y" loading="lazy" decoding="async"><\/button><div class="ct-body">/);
  assert.match(html, /the shelf/);
  assert.doesNotMatch(renderMessage({ text: 'a' }), /ct-img/);
});

const TABLE = [
  '| # | When | What | Decision | |',
  '|:--|--:|:-:|---|---|',
  '| 1 | 15:44 | Lunch \\| box | **done** ~~old~~ | [✓](reply:yes 1 "Confirm it") |',
  '| | [Keep](reply:keep) [Write](fill:change 1 to) | | | |',
  '| 2 | 16:00 | A<br>B || [✎](fill:item 2 "Edit") |',
  '| 3 | *she said* |',
].join('\n');

test('a table (GFM): alignment, \\| as a pipe, <br> in a cell, || joins cells, and the rows fit the head', () => {
  const html = renderMarkdown(TABLE);
  assert.match(html, /^<div class="ct-table ct-table--cards"><table><thead><tr><th align="left">#<\/th><th align="right">When<\/th><th align="center">What<\/th><th>Decision<\/th><th><\/th><\/tr><\/thead><tbody>/);
  assert.match(html, /<td data-col="What" align="center">Lunch \| box<\/td>/);
  assert.match(html, /<td data-col="Decision"><strong>done<\/strong> <del>old<\/del><\/td>/);
  assert.match(html, /<td data-col="What" align="center" colspan="2">A<br>B<\/td><td data-col="" class="ct-td--actions">/, '|| widens the cell on its left');
  assert.match(html, /<tr data-key="3"><td data-col="#" align="left">3<\/td><td data-col="When" align="right"><em>she said<\/em><\/td><td data-col="What" align="center"><\/td><td data-col="Decision"><\/td><td data-col=""><\/td><\/tr>/, 'a short row is filled');
  assert.equal(renderMarkdown('| a | b |\n|---|\n| 1 | 2 |'), '<p>| a | b |<br>|---|<br>| 1 | 2 |</p>', 'a delimiter row that does not fit the head is text');
  assert.equal(renderMarkdown('| a | b |\n|---|---|'), '<div class="ct-table"><table><thead><tr><th>a</th><th>b</th></tr></thead></table></div>', 'two columns: no cards on a phone');
  assert.match(renderMarkdown('before\n| a |\n|---|\n| 1 |\n\nafter'), /^<p>before<\/p><div class="ct-table">.*<\/div><p>after<\/p>$/);
  assert.match(renderMarkdown('```\n| a |\n|---|\n```'), /<pre/, 'a fence is never a table');
  const evil = renderMarkdown('| a |\n|---|\n| <b onclick="x">x</b> [y](javascript:z) <br/> <br> |');
  assert.doesNotMatch(evil, /<b |onclick="|href="javascript/, 'a cell is escaped like any text');
  assert.match(evil, /&lt;b onclick=&quot;x&quot;&gt;x&lt;\/b&gt; \[y\]\(javascript:z\) <br> <br><\/td>/, 'only <br> is read, as a line break');
});

test('the rows of a table: a row whose first cell is empty is the foot of the row above, and a row with reply: waits', () => {
  const html = renderMarkdown(TABLE);
  assert.match(html, /<tr data-key="1" class="ct-tr--waiting ct-tr--continued">/, 'the row has a foot after it and waits for an answer');
  assert.match(html, /<tr data-key="1" class="ct-tr--foot ct-tr--waiting"><td data-col="#" align="left"><\/td><td data-col="When" align="right"><div class="ct-actions">/, 'the foot keeps the key; its suggestions are a row of pills');
  assert.match(html, /<tr data-key="2"><td/, 'decided: no reply: on the row, no waiting');
  assert.match(html, /<td data-col="" class="ct-td--actions">/, 'a cell of buttons is marked, for the cards');
  assert.match(renderMarkdown('| a | b |\n|---|---|\n| | x |'), /<tr><td data-col="a"><\/td><td data-col="b">x<\/td><\/tr>/, 'with no row above, an empty first cell is an ordinary row');
});

test('buttons in a message: reply: sends, fill: writes in the box; ✓ and ✎ are icons; the hint names them', () => {
  const html = renderMarkdown(TABLE, { replies: true });
  assert.match(html, /<button type="button" class="ct-chip ct-reply ct-chip--icon" data-text="yes 1" title="Confirm it" aria-label="Confirm it"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12\.5/);
  assert.match(html, /<button type="button" class="ct-chip ct-reply" data-text="keep">Keep<\/button>/);
  assert.match(html, /<button type="button" class="ct-chip ct-reply" data-text="change 1 to " data-fill>Write<\/button>/, 'fill: ends in a space, ready to type on');
  assert.match(html, /data-text="item 2 " data-fill title="Edit" aria-label="Edit"><svg/, 'the pencil');
  assert.match(renderMarkdown('[x](reply:a\\) b "h\\"i")', { replies: true }), /data-text="a\) b" title="h&quot;i" aria-label="h&quot;i">x<\/button>/, '\\) and \\" are escapes');
  assert.match(renderMarkdown('[Yes](reply:ok) <script>', { replies: true }), /^<p><button [^>]*>Yes<\/button> &lt;script&gt;<\/p>$/);
  assert.match(renderMarkdown('`[a](reply:b)`', { replies: true }), /<code>\[a\]\(reply:b\)<\/code>/, 'never inside code');
  // off: the same marks, but nothing to press
  const off = renderMarkdown(TABLE);
  assert.doesNotMatch(off, /<button/);
  assert.match(off, /<span class="ct-chip ct-reply ct-chip--icon ct-reply--off" role="img" aria-label="Confirm it" title="Confirm it"><svg/);
  assert.match(off, /<span class="ct-chip ct-reply ct-reply--off" data-fill>Write<\/span>/);
});

test('only the other side\'s messages answer, and only in a chat', () => {
  const text = 'Pick: [Yes](reply:yes)';
  assert.match(renderMessage({ from: 'other', text }), /<button type="button" class="ct-chip ct-reply" data-text="yes">Yes<\/button>/);
  assert.match(renderMessage({ from: 'other', kind: 'note', text }), /<button type="button" class="ct-chip ct-reply"/);
  assert.match(renderMessage({ from: 'me', text, format: 'markdown' }), /<span class="ct-chip ct-reply ct-reply--off">Yes<\/span>/, 'my own buttons are only marks');
  assert.match(renderMessage({ from: 'other', text }, { mode: 'readonly' }), /ct-reply--off/);
  assert.match(renderMessage({ from: 'other', text }, { mode: 'preview' }), /ct-reply--off/);
  assert.match(renderMessage({ from: 'other', text, format: 'plain' }), /\[Yes\]\(reply:yes\)/, 'plain text stays text');
});

test('the pinned message: above the box, out of the list; "Final" when resolved; the original and the markdown', () => {
  const pin = { id: 'p', from: 'other', pinned: true, text: '| a | b |\n|---|---|\n| 1 | [✓](reply:y "Yes") |', original: 'first' };
  const html = renderPinned(pin, {});
  assert.match(html, /^<div class="ct-pinned" role="region" aria-label="Pinned" data-id="p" data-view="current"><div class="ct-pinned-head"><span class="ct-pinned-label">Pinned<\/span><span class="ct-pinned-hint">Rewritten in place as things are decided<\/span><button type="button" class="ct-pinned-view" data-view="original" aria-pressed="false">See the original<\/button><button type="button" class="ct-pinned-view" data-view="source" aria-pressed="false">See the markdown<\/button><\/div>/);
  assert.match(html, /<div class="ct-body ct-pinned-body"><div class="ct-table">.*<button type="button" class="ct-chip ct-reply ct-chip--icon" data-text="y"/);
  assert.match(html, /<div class="ct-body ct-pinned-body ct-pinned-original" hidden><p>first<\/p><\/div><pre class="ct-pinned-source" hidden>\| a \| b \|\n\|---\|---\|\n\| 1 \| \[✓\]\(reply:y &quot;Yes&quot;\) \|<\/pre><\/div>$/);
  const final = renderPinned(pin, {}, { resolved: true });
  assert.match(final, /^<div class="ct-pinned ct-pinned--final" role="region" aria-label="Final"/);
  assert.match(final, /<span class="ct-pinned-label">Final<\/span><span class="ct-pinned-hint">Resolved: this is where it ended<\/span>/);
  assert.doesNotMatch(final, /<button type="button" class="ct-chip/, 'resolved: nothing left to answer');
  const source = renderPinned(pin, {}, { view: 'source' });
  assert.match(source, /data-view="source"><div class="ct-pinned-head">.*aria-pressed="true">See the current one<\/button><\/div><div class="ct-body ct-pinned-body" hidden>.*<pre class="ct-pinned-source">/);
  assert.doesNotMatch(renderPinned({ ...pin, original: pin.text }, {}), /data-view="original"|ct-pinned-original/, 'no original button while the text is the first one');
  assert.match(renderPinned({ ...pin, original: null }, {}, { view: 'original' }), /data-view="current"><div/, 'no original to show: the current one');
  assert.match(renderPinned(pin, { strings: { pinned: 'Fixada', showSource: 'Ver o MD' } }), /<span class="ct-pinned-label">Fixada<\/span>.*>Ver o MD<\/button>/);
  assert.match(renderPinned(pin, { mode: 'readonly' }), /ct-reply--off/, 'a log has nothing to answer');
  // in the thread: drawn between the list and the box, and only the last pinned one
  const thread = renderThread([{ id: 1, from: 'other', pinned: true, text: 'old' }, { id: 2, from: 'other', text: 'hi' }, pin], {}, { resolved: true });
  assert.match(thread, /<div class="ct-list" role="log"[^>]*>.*<\/div><div class="ct-pinned ct-pinned--final"[^>]*data-id="p".*<\/div><div class="ct-composer/s);
  assert.doesNotMatch(thread, /<div class="ct-msg[^"]*" data-id="p"/, 'the pinned one is not in the list too');
  assert.match(thread, /<div class="ct-msg ct-msg--theirs" data-id="1"/, 'an older pinned one stays in the list');
  assert.doesNotMatch(renderThread([{ id: 2, text: 'hi' }], {}), /ct-pinned/);
});

test('pinned and original: the first text of a pinned message is kept through its rewrites', () => {
  assert.deepEqual([normalizeMessage({ pinned: 'yes' }).pinned, normalizeMessage({ pinned: true }).pinned, normalizeMessage({ original: 3 }).original], [false, true, null]);
  assert.equal(pinnedOf([{ id: 1, pinned: true }, { id: 2 }, { id: 3, pinned: true }, { id: 4 }]).id, 3);
  assert.equal(pinnedOf([{ id: 1 }]), null);
  assert.equal(pinnedOf(null), null);
  const a = reviseMessage({ id: 1, from: 'other', pinned: true, text: 'a' }, { text: 'b' });
  assert.deepEqual([a.id, a.text, a.original], [1, 'b', 'a']);
  const b = reviseMessage(a, { text: 'c', id: 9 });
  assert.deepEqual([b.id, b.text, b.original], [1, 'c', 'a'], 'the first text stays; the id never changes');
  assert.equal(reviseMessage({ id: 1, text: 'a' }, { text: 'b' }).original, null, 'not pinned: nothing kept');
  assert.equal(reviseMessage({ id: 1, text: 'a' }, { text: 'b', pinned: true }).original, 'a', 'pinned by the change itself');
  assert.equal(reviseMessage(a, { original: null }).original, null, 'the app may forget it');
  assert.equal(reviseMessage(a, { original: 'z' }).original, 'z', 'or set it');
  assert.equal(reviseMessage(a, { state: 'read' }).original, 'a', 'another field leaves it');
  assert.equal(keepOriginal({ pinned: true, text: 'a' }, { text: 'a' }), null, 'the same text is no rewrite');
});

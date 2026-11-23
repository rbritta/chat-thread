/**
 * Pure helpers for chat-thread: text formats, times and the HTML of a thread as a string.
 * No DOM and no I/O, so a server renders the exact markup the browser does, and every
 * rule here is covered by plain `node --test`.
 *
 *   import { renderThread } from 'chat-thread/core';
 *   res.end(renderThread(messages, { author: 'Assistant', timeZone: 'America/Sao_Paulo' }));
 */

export const LIMITS = Object.freeze({ text: 20000, author: 80, title: 200, tag: 120, url: 2048, id: 120, chip: 400, chips: 12, toggles: 8 });
/** My messages: a clock while `pending` or `queued`, ticks for `sent`, `delivered` and `read`; `failed` when sending threw. */
export const STATES = Object.freeze(['pending', 'queued', 'sent', 'delivered', 'read', 'failed']);
export const FORMATS = Object.freeze(['markdown', 'whatsapp', 'plain']);
export const MODES = Object.freeze(['chat', 'readonly', 'preview']);
/** `bubble` is a message in a bubble; `note` is the other side narrating, full width, with no bubble. */
export const KINDS = Object.freeze(['bubble', 'note']);

/** Every visible word. Pass `strings` to reword or translate: `{ placeholder: 'Write a reply', send: 'Post' }`. */
export const DEFAULT_STRINGS = Object.freeze({
  thread: 'Conversation',
  placeholder: 'Message',
  send: 'Send',
  more: 'Read more',
  less: 'Show less',
  copy: 'Copy',
  copied: 'Copied',
  remove: 'Remove',
  queued: 'Queued',
  today: 'Today',
  yesterday: 'Yesterday',
  typing: '{author} is typing',
  typingNoAuthor: 'Typing',
  waiting: '{author} has not replied yet…',
  waitingNoAuthor: 'No reply yet…',
  pending: 'Pending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
  suggestions: 'Suggestions',
  attach: 'Attach',
  camera: 'Camera',
  takePhoto: 'Take photo',
  retake: 'Take another',
  caption: 'Caption',
  close: 'Close',
  photo: 'Photo',
  enlarge: 'Enlarge photo',
  pinned: 'Pinned',
  final: 'Final',
  pinnedHint: 'Rewritten in place as things are decided',
  finalHint: 'Resolved: this is where it ended',
  showOriginal: 'See the original',
  showSource: 'See the markdown',
  showCurrent: 'See the current one',
});

/** What the + left of the box can offer. Only `camera` for now: take a photo and send it with a caption. */
export const ATTACH = Object.freeze(['camera']);

export const DEFAULTS = Object.freeze({
  mode: 'chat',
  theme: 'dark',
  format: 'auto',
  author: '',
  colorAuthors: false,
  ticks: true,
  days: null,
  clamp: 500,
  copy: true,
  enterSends: true,
  autoScroll: true,
  sendState: null,
  typingKind: 'auto',
  chips: Object.freeze([]),
  toggles: Object.freeze([]),
  attach: Object.freeze([]),
  locale: undefined,
  timeZone: undefined,
  hour12: undefined,
});

const RESOLVED = Symbol('chat-thread options');
const NUL = '\u0000';

/** A value as text of at most `max` characters, never cutting an emoji (a surrogate pair) in half. */
function clip(value, max) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.length <= max) return s;
  const last = s.charCodeAt(max - 1);
  return s.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * The options with every default filled in and bad values replaced: `mode` falls back to
 * `chat`, an unknown `format` to `auto`, `days` follows the mode (no day separators in a preview).
 */
export function resolveOptions(options = {}) {
  if (options && options[RESOLVED]) return options;
  const given = options || {};
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(given)) if (v !== undefined) o[k] = v;
  o.strings = { ...DEFAULT_STRINGS };
  const strings = given.strings && typeof given.strings === 'object' ? given.strings : {};
  for (const [k, v] of Object.entries(strings)) if (v !== undefined && v !== null) o.strings[k] = String(v);
  if (!MODES.includes(o.mode)) o.mode = 'chat';
  if (typeof o.theme !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(o.theme)) o.theme = 'dark';
  if (o.format !== 'auto' && !FORMATS.includes(o.format)) o.format = 'auto';
  if (o.typingKind !== 'auto' && !KINDS.includes(o.typingKind)) o.typingKind = 'auto';
  o.clamp = Number.isFinite(Number(o.clamp)) ? Math.max(0, Number(o.clamp)) : DEFAULTS.clamp;
  if (o.days === null) o.days = o.mode !== 'preview';
  o.author = clip(o.author, LIMITS.author).trim();
  o.chips = normalizeChips(o.chips);
  o.toggles = normalizeToggles(o.toggles);
  o.attach = normalizeAttach(o.attach);
  if (!STATES.includes(o.sendState)) o.sendState = null;
  if (typeof o.hour12 !== 'boolean') o.hour12 = undefined;
  o.now = typeof given.now === 'function' ? given.now : () => new Date();
  o[RESOLVED] = true;
  return o;
}

/**
 * Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`.
 * Whitespace, control characters and backslashes are refused too: a browser reads `/\host`
 * as `//host`, which is another site.
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url || /[\s\\\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return url;
  return /^https?:\/\/./i.test(url) ? url : null;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// A bare URL ends before trailing punctuation and before the emphasis marks around it.
const URL_RE = /https?:\/\/[^\s<>"'`\u0000]+[^\s<>"'`\u0000.,;:!?)\]}*_~]/gi;

function anchor(href, label) {
  const external = /^https?:/i.test(href);
  return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
}

/** Escaped text with bare http(s) URLs turned into links that open in a new tab. */
export function linkify(value) {
  const raw = String(value ?? '');
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(URL_RE)) {
    if (!safeUrl(match[0])) continue;
    out += escapeHtml(raw.slice(last, match.index)) + anchor(match[0], escapeHtml(match[0]));
    last = match.index + match[0].length;
  }
  return out + escapeHtml(raw.slice(last));
}

/** Newlines normalized, no NUL (used as a placeholder), no trailing blank space. */
const clean = (value) => String(value ?? '').replace(/\r\n?/g, '\n').split(NUL).join('').replace(/^\n+/, '').replace(/\s+$/, '');

/** Placeholders for pieces of HTML that later passes must not touch (code, links). */
function stasher() {
  const items = [];
  return {
    keep: (html) => `${NUL}${items.push(html) - 1}${NUL}`,
    restore(html) {
      let out = html;
      for (let n = 0; n < 4 && out.includes(NUL); n++) out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => items[Number(i)] ?? '');
      return out;
    },
  };
}

/** Bare URLs as links, kept away from the passes that follow. */
const stashUrls = (s, keep) => s.replace(URL_RE, (url) => (safeUrl(url) ? keep(anchor(url, escapeHtml(url))) : url));

/**
 * Whether the emphasis tags in a piece of HTML close in the order they open. The marks are
 * matched one kind at a time, so `**a *b** c*` would otherwise cross: `<strong>a <em>b</strong> c</em>`.
 */
function balanced(html) {
  const open = [];
  for (const [, closing, tag] of html.matchAll(/<(\/?)(strong|em|del)>/g)) {
    if (!closing) open.push(tag);
    else if (open.pop() !== tag) return false;
  }
  return open.length === 0;
}

/** A replacer for a mark regex with the groups (before, inner): wraps the inner text when that keeps the tags nested. */
const wrapIn = (tag) => (whole, before, inner) => (balanced(inner) ? `${before}<${tag}>${inner}</${tag}>` : whole);

function markdownEmphasis(s) {
  return s
    .replace(/()(\*\*|__)(?=\S)([^\n]*?\S)\2/g, (whole, before, mark, inner) => wrapIn('strong')(whole, before, inner))
    .replace(/(^|[^\w*])\*(?=[^\s*])([^\n*]*?[^\s*])\*(?![\w*])/g, wrapIn('em'))
    .replace(/(^|[^\w])_(?=[^\s_])([^\n_]*?[^\s_])_(?!\w)/g, wrapIn('em'))
    .replace(/()~~(?=\S)([^\n]*?\S)~~/g, wrapIn('del'));
}

const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** Labels of a reply button that become the library's icons: the pencil and the check. */
const REPLY_ICONS = { '✎': PENCIL_ICON, '✏': PENCIL_ICON, '✏️': PENCIL_ICON, '✓': CHECK_ICON, '✔': CHECK_ICON, '✔️': CHECK_ICON };

// [label](reply:text "hint") and [label](fill:text "hint"); a backslash escapes ) and " in the text and the hint
const REPLY_LINK = /\[([^\]\n]{1,500})\]\((reply|fill):((?:\\.|[^)"\\\n\u0000])*?)\s*(?:"((?:\\.|[^"\\\n\u0000])*)"\s*)?\)/g;
const unescapeLink = (s) => s.replace(/\\(.)/g, '$1');

/**
 * A reply button inside a message: `reply:` sends its text, `fill:` puts it in the box (with a
 * space at the end, to go on typing). A one-symbol label is a round icon (✎ and ✓ become the
 * library's pencil and check) named by the hint. With `live` off (my own messages, a log, a
 * resolved thread) it is the same chip as a span that does nothing.
 */
function replyButton(label, kind, rawText, rawHint, live) {
  let text = clip(unescapeLink(rawText).trim(), LIMITS.chip);
  if (!text) return null;
  if (kind === 'fill') text += ' ';
  const hint = clip(unescapeLink(rawHint || '').trim(), LIMITS.title);
  const symbol = label.trim();
  const icon = REPLY_ICONS[symbol];
  const round = !!icon || [...symbol].length === 1;
  const cls = `ct-chip ct-reply${round ? ' ct-chip--icon' : ''}`;
  const name = hint || (round ? text.trim() : '');
  const face = icon || markdownEmphasis(escapeHtml(label));
  const fill = kind === 'fill' ? ' data-fill' : '';
  if (!live) {
    const named = name ? `${round ? ` role="img" aria-label="${escapeHtml(name)}"` : ''} title="${escapeHtml(name)}"` : '';
    return `<span class="${cls} ct-reply--off"${fill}${named}>${face}</span>`;
  }
  const named = name ? ` title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"` : '';
  return `<button type="button" class="${cls}" data-text="${escapeHtml(text)}"${fill}${named}>${face}</button>`;
}

/**
 * One line of markdown: `code`, [links](url), bare URLs, **bold**, *italic*, ~~strike~~, and
 * the reply buttons `[label](reply:text)` and `[label](fill:text)`, live when `replies` is on.
 */
function markdownInline(line, { replies = false } = {}) {
  const { keep, restore } = stasher();
  let s = line.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(REPLY_LINK, (whole, label, kind, text, hint) => {
    const html = replyButton(label, kind, text, hint, replies);
    return html ? keep(html) : whole;
  });
  s = s.replace(/\[([^\]\n]{1,500})\]\(\s*([^)\s]+)\s*\)/g, (whole, label, url) => {
    const href = safeUrl(url);
    return href ? keep(anchor(href, markdownEmphasis(escapeHtml(label)))) : whole;
  });
  s = stashUrls(s, keep);
  return restore(markdownEmphasis(escapeHtml(s)));
}

function codeBlock(code, lang, { copy, strings }) {
  const data = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
  const button = copy ? `<button type="button" class="ct-copy">${escapeHtml(strings.copy)}</button>` : '';
  return `<div class="ct-code"><pre><code${data}>${escapeHtml(code)}</code></pre>${button}</div>`;
}

// An opening fence: ``` or ~~~, a language, and anything after it (```js title="a.js").
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w#+.-]{0,30})[^`]*$/;

/**
 * The cells of a table row. `\|` is a pipe inside a cell; `||` (nothing between the bars)
 * stretches the cell on its left over one more column, as MultiMarkdown does.
 */
function tableCells(row) {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const parts = [''];
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      parts[parts.length - 1] += '|';
      k++;
    } else if (s[k] === '|') parts.push('');
    else parts[parts.length - 1] += s[k];
  }
  const cells = [];
  for (const part of parts) {
    if (part === '' && cells.length) cells[cells.length - 1].span += 1;
    else cells.push({ text: part.trim(), span: 1 });
  }
  return cells;
}

const DELIMITER = /^\s*:?-+:?\s*$/;

/** The alignments of a table when `head` and `next` start one (GFM: a delimiter cell per column), else null. */
function tableStart(head, next) {
  if (!head.includes('|') || next === undefined || !next.includes('-')) return null;
  const columns = tableCells(head).reduce((n, c) => n + c.span, 0);
  const delimiters = tableCells(next);
  if (delimiters.length !== columns || !delimiters.every((c) => c.span === 1 && DELIMITER.test(c.text))) return null;
  return delimiters.map(({ text }) => {
    const t = text.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    return t.startsWith(':') ? 'left' : '';
  });
}

/** A row's cells brought to the table's columns: extra cells dropped, missing ones empty. */
function fitCells(cells, columns) {
  const out = [];
  let used = 0;
  for (const c of cells) {
    if (used >= columns) break;
    const span = Math.min(c.span, columns - used);
    out.push({ ...c, span, col: used });
    used += span;
  }
  while (used < columns) out.push({ text: '', span: 1, col: used++ });
  return out;
}

/** A cell's words with no marks: the column names on a phone's cards and the row keys. */
const plainCell = (text) => text.replace(/<br\s*\/?>[\s\S]*$/i, '').replace(/[*_`~]/g, '').trim();
/** A cell: inline markdown, and `<br>` (the only HTML read, as GFM tables use it) for a line break. */
const cellHtml = (text, ctx) => text.split(/<br\s*\/?>/i).map((piece) => markdownInline(piece, ctx)).join('<br>');

/**
 * A GFM table. A row whose first cell is empty continues the row above it: the same
 * `data-key`, no line between them, the class `ct-tr--foot`, its cells' buttons in a row
 * (`.ct-actions`). A row whose group has a `reply:` button waits for an answer (`ct-tr--waiting`).
 */
function renderTable(head, aligns, rows, ctx) {
  const columns = aligns.length;
  const align = (col) => (aligns[col] ? ` align="${aligns[col]}"` : '');
  const span = (c) => (c.span > 1 ? ` colspan="${c.span}"` : '');
  const header = fitCells(tableCells(head), columns);
  const names = [];
  for (const c of header) for (let k = 0; k < c.span; k++) names[c.col + k] = plainCell(c.text);
  const body = rows.map((line) => fitCells(tableCells(line), columns));
  // rows in groups: a row with its first cell filled, then the rows that continue it
  const groups = [];
  for (const cells of body) {
    const foot = cells[0].text === '' && groups.length > 0;
    if (foot) groups[groups.length - 1].rows.push(cells);
    else groups.push({ key: plainCell(cells[0].text), rows: [cells] });
  }
  const waits = (cells) => cells.some((c) => /\]\(reply:/.test(c.text));
  const tbody = groups.map((g) => {
    const waiting = g.rows.some(waits);
    return g.rows.map((cells, n) => {
      const foot = n > 0;
      const cls = [foot ? 'ct-tr--foot' : '', waiting ? 'ct-tr--waiting' : '', n < g.rows.length - 1 ? 'ct-tr--continued' : ''].filter(Boolean).join(' ');
      const tds = cells.map((c) => {
        const html = cellHtml(c.text, ctx);
        const buttons = /\]\((?:reply|fill):/.test(c.text);
        const inner = foot && c.text ? `<div class="ct-actions">${html}</div>` : html;
        const tdClass = buttons && !foot ? ' class="ct-td--actions"' : '';
        return `<td data-col="${escapeHtml(names[c.col] || '')}"${align(c.col)}${span(c)}${tdClass}>${inner}</td>`;
      }).join('');
      return `<tr${g.key ? ` data-key="${escapeHtml(g.key)}"` : ''}${cls ? ` class="${cls}"` : ''}>${tds}</tr>`;
    }).join('');
  }).join('');
  const ths = header.map((c) => `<th${align(c.col)}${span(c)}>${cellHtml(c.text, ctx)}</th>`).join('');
  return `<div class="ct-table${columns >= 3 ? ' ct-table--cards' : ''}"><table><thead><tr>${ths}</tr></thead>${tbody ? `<tbody>${tbody}</tbody>` : ''}</table></div>`;
}

/**
 * A safe subset of markdown, as chat answers use it: paragraphs (single newlines kept),
 * `#` headings, `-` and `1.` lists, GFM tables, fenced code with a Copy button, `code`,
 * **bold**, *italic*, ~~strike~~, [links](url) and bare URLs. Raw HTML is always shown as
 * text (only `<br>` inside a table cell breaks the line). With `replies`, `[label](reply:text)`
 * and `[label](fill:text)` are buttons that answer (see `renderMessage`).
 */
export function renderMarkdown(value, { copy = true, strings = DEFAULT_STRINGS, replies = false } = {}) {
  const ctx = { replies: replies === true };
  const inline = (line) => markdownInline(line, ctx);
  const lines = clean(value).split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const start = list.type === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${list.type}${start}>${list.items.map((item) => `<li>${item.map(inline).join('<br>')}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const aligns = tableStart(line, lines[i + 1]);
    if (aligns) {
      flushPara();
      flushList();
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE.test(lines[i]); i++) rows.push(lines[i]);
      i--;
      out.push(renderTable(line, aligns, rows, ctx));
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const body = [];
      while (++i < lines.length && !close.test(lines[i])) body.push(lines[i]);
      out.push(codeBlock(body.join('\n'), fence[2], { copy, strings }));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // the closing #s need a space before them: "# C#" is about C#
    const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      out.push(`<p class="ct-heading">${inline(heading[1])}</p>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = bullet ? null : /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      flushPara();
      if (!list || list.type !== type) {
        flushList();
        list = { type, start: numbered ? Number(numbered[1]) : 1, items: [] };
      }
      list.items.push([bullet ? bullet[1] : numbered[2]]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1].push(line.trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
}

// WhatsApp marks only count at word edges: `2*3*4` and `snake_case` stay as they are.
const WHATSAPP_MARKS = [
  [/(^|[\s([{"'“‘;>_~])\*(?=[^\s*])([^\n*]*?[^\s*])\*(?=$|[\s.,!?;:)\]}"'”’&<_~])/g, 'strong'],
  [/(^|[\s([{"'“‘;>*~])_(?=[^\s_])([^\n_]*?[^\s_])_(?=$|[\s.,!?;:)\]}"'”’&<*~])/g, 'em'],
  [/(^|[\s([{"'“‘;>*_])~(?=[^\s~])([^\n~]*?[^\s~])~(?=$|[\s.,!?;:)\]}"'”’&<*_])/g, 'del'],
];

/** Text as WhatsApp shows it: *bold*, _italic_, ~strike~, ```monospace```, `code` and links. */
export function renderWhatsApp(value) {
  const { keep, restore } = stasher();
  let s = clean(value);
  s = s.replace(/```([\s\S]+?)```/g, (_, code) => keep(`<code class="ct-mono">${escapeHtml(code)}</code>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = escapeHtml(stashUrls(s, keep));
  for (const [re, tag] of WHATSAPP_MARKS) s = s.replace(re, wrapIn(tag));
  const html = s.split(/\n[ \t]*\n+/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return restore(html);
}

/** Text exactly as the person wrote it: escaped, links clickable, spaces and line breaks kept. */
export function renderPlain(value) {
  const s = clean(value);
  return s ? `<p class="ct-plain">${linkify(s)}</p>` : '';
}

/** The body HTML of a text in one of `FORMATS`. */
export function formatText(value, format = 'plain', { copy = true, strings = DEFAULT_STRINGS, replies = false } = {}) {
  if (format === 'markdown') return renderMarkdown(value, { copy, strings, replies });
  if (format === 'whatsapp') return renderWhatsApp(value);
  return renderPlain(value);
}

const toDate = (at) => {
  if (at === null || at === undefined || at === '') return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A time as an ISO string, or null when absent or unreadable. */
export const normalizeAt = (at) => toDate(at)?.toISOString() ?? null;

const formatters = new Map();
/**
 * A cached Intl.DateTimeFormat. A bad locale or a bad time zone falls back one at a time, so
 * a typo in the locale still shows the times in the right zone.
 */
function formatter(locale, opts) {
  const key = JSON.stringify([locale ?? null, opts]);
  let f = formatters.get(key);
  if (!f) {
    const { timeZone: _zone, ...anyZone } = opts;
    for (const [l, o] of [[locale, opts], [undefined, opts], [locale, anyZone], [undefined, anyZone]]) {
      try {
        f = new Intl.DateTimeFormat(l, o);
        break;
      } catch { /* try the next, simpler one */ }
    }
    formatters.set(key, f);
  }
  return f;
}

/** The calendar day of a time (`2026-11-13`) in `timeZone` (default: the runtime's). */
export function dayKey(at, { timeZone } = {}) {
  const d = toDate(at);
  if (!d) return '';
  const parts = formatter('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whether the locale writes `5:50 PM` (12 hours) rather than `17:50`, as its own clock does. */
function usesTwelveHours(locale, timeZone) {
  const cycle = formatter(locale, { timeZone, hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/**
 * The time shown inside a bubble. The locale decides between `17:50` and `5:50 PM`, like the rest of the
 * page; `hour12: true` or `false` forces one of them.
 */
export function formatTime(at, { locale, timeZone, hour12 } = {}) {
  const d = toDate(at);
  if (!d) return '';
  const twelve = typeof hour12 === 'boolean' ? hour12 : usesTwelveHours(locale, timeZone);
  const opts = twelve ? { timeZone, hour: 'numeric', minute: '2-digit', hour12: true } : { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return formatter(locale, opts).format(d);
}

function capitalize(label, locale) {
  let first = label.charAt(0);
  try { first = first.toLocaleUpperCase(locale); } catch { first = first.toUpperCase(); }
  return first + label.slice(1);
}

/** The day separator: Today, Yesterday, the weekday within a week, then the date. */
export function dayLabel(key, { now = new Date(), locale, timeZone, strings = DEFAULT_STRINGS } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return '';
  const today = dayKey(now, { timeZone });
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86400000);
  if (diff === 0) return strings.today;
  if (diff === 1) return strings.yesterday;
  const noon = new Date(`${key}T12:00:00Z`);
  const label = diff > 1 && diff < 7
    ? formatter(locale, { timeZone: 'UTC', weekday: 'long' }).format(noon)
    : formatter(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) }).format(noon);
  return capitalize(label, locale);
}

/**
 * A message as the thread and the stores keep it. `from` is `me` (right side) or `other`
 * (left side, with its `author`); `kind` is `bubble` or `note` (no bubble, full width).
 * Bad fields fall back instead of throwing.
 */
export function normalizeMessage(input) {
  const m = input && typeof input === 'object' ? input : {};
  let id = null;
  if (typeof m.id === 'number' && Number.isFinite(m.id)) id = m.id;
  else if (m.id !== null && m.id !== undefined && m.id !== '') id = clip(m.id, LIMITS.id);
  return {
    id,
    from: m.from === 'me' ? 'me' : 'other',
    kind: KINDS.includes(m.kind) ? m.kind : 'bubble',
    author: clip(m.author, LIMITS.author).trim(),
    text: clip(m.text, LIMITS.text),
    at: normalizeAt(m.at),
    state: STATES.includes(m.state) ? m.state : null,
    alert: m.alert === true,
    tag: clip(m.tag, LIMITS.tag).trim(),
    title: clip(m.title, LIMITS.title).trim(),
    format: FORMATS.includes(m.format) ? m.format : null,
    meta: m.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta : null,
    image: normalizeImage(m.image),
    pinned: m.pinned === true,
    original: typeof m.original === 'string' && m.original ? clip(m.original, LIMITS.text) : null,
  };
}

/**
 * The `original` of a message after a change: the text a pinned message had before its first
 * rewrite, kept from then on. `given` is the `original` the change itself brought: when it is
 * not `undefined`, the app decided (a string, or `null` to forget it).
 */
export function keepOriginal(before, after, given) {
  if (given !== undefined) return after.original;
  if (before.original) return before.original;
  return (before.pinned || after.pinned) && before.text && before.text !== after.text ? before.text : null;
}

/** A message with `patch` applied, as `updateMessage` and the stores do it: the id stays, and so does the first text of a pinned message. */
export function reviseMessage(before, patch = {}) {
  const prev = normalizeMessage(before);
  const next = normalizeMessage({ ...prev, ...patch, id: prev.id });
  next.original = keepOriginal(prev, next, patch.original);
  return next;
}

/** The message the thread shows above the box: the last one with `pinned: true`, or null. */
export function pinnedOf(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.pinned === true) return list[i];
  return null;
}

/** A picture inlined as base64 (what a camera preview makes), up to 1 MB. Never SVG: it can carry script. */
const dataImage = (value) => (typeof value === 'string' && value.length <= 1_400_000 && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : null);

/** The thumbnail's width and height attributes: the picture's size brought into 280 px, so its room is kept while it loads. */
function thumbSize({ width, height }) {
  if (!width) return '';
  const k = Math.min(1, 280 / Math.max(width, height));
  return ` width="${Math.max(1, Math.round(width * k))}" height="${Math.max(1, Math.round(height * k))}"`;
}

/** A photo in the bubble: a URL or `{ src, alt? }`. Only http(s) and relative URLs, like links. */
function normalizeImage(value) {
  const v = typeof value === 'string' ? { src: value } : value && typeof value === 'object' ? value : null;
  const src = v && (safeUrl(v.src) || dataImage(v.src));
  if (!src) return null;
  const image = { src, alt: clip(v.alt, LIMITS.title).trim() };
  // its size, when known, keeps the room for it while it loads
  const side = (n) => (Number.isInteger(n) && n > 0 && n <= 20000 ? n : null);
  if (side(v.width) && side(v.height)) Object.assign(image, { width: v.width, height: v.height });
  return image;
}

/** Suggestion chips: strings or `{ label, text?, fill? }`. `fill` puts the text in the box instead of sending it. */
export function normalizeChips(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (typeof c === 'string' ? { label: c } : c && typeof c === 'object' ? c : {}))
    .map((c) => ({ label: clip(c.label, LIMITS.chip).trim(), text: clip(c.text ?? c.label, LIMITS.chip).trim(), fill: c.fill === true }))
    .filter((c) => c.label && c.text)
    .slice(0, LIMITS.chips);
}

/** Checkboxes under the box: `{ name, label, checked? }`. Their values go with every message sent. */
export function normalizeToggles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object' && /^[\w-]{1,40}$/.test(t.name || ''))
    .map((t) => ({ name: t.name, label: clip(t.label, LIMITS.chip).trim() || t.name, checked: t.checked === true }))
    .slice(0, LIMITS.toggles);
}

/** The + menu's items: known names only, each once, in the order given. */
export function normalizeAttach(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((a) => ATTACH.includes(a)))];
}

/** Whether a text starts collapsed behind "Read more" (the browser unfolds it if it fits after all). */
export const isLong = (value, clamp = DEFAULTS.clamp) =>
  clamp > 0 && (String(value ?? '').length > clamp || String(value ?? '').split('\n').length > 10);

/** A stable color slot (1 to 6) for an author's name, used by `colorAuthors`. */
export function authorTone(name) {
  let hash = 0;
  for (const ch of String(name ?? '')) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return (Math.abs(hash) % 6) + 1;
}

/** `'{author} is typing'` with the author filled in. */
export const fill = (template, values = {}) => String(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

const TICK_PATH = 'M2 13l4 4 8-9M10 16l1 1 9-10';
const icon = (cls, label, inner) => `<svg class="ct-tick${cls}" viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(label)}">${inner}</svg>`;
const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CAMERA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l-1.8 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
const ATTACH_ICONS = { camera: CAMERA_ICON };
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z"/></svg>';

/** Ticks of my message: clock while pending or queued, one tick sent, two delivered, two in color read, a red mark when it failed. */
function ticks(state, strings) {
  if (state === 'pending' || state === 'queued') return icon(' ct-tick--clock', strings[state === 'queued' ? 'queued' : 'pending'], '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>');
  if (state === 'failed') return icon(' ct-tick--failed', strings.failed, '<circle cx="12" cy="12" r="8"/><path d="M12 7.5v5M12 16.2v.1"/>');
  if (state === 'sent') return icon('', strings.sent, '<path d="M5 13l4 4 10-11"/>');
  if (state === 'delivered') return icon('', strings.delivered, `<path d="${TICK_PATH}"/>`);
  return icon(' ct-tick--read', strings.read, `<path d="${TICK_PATH}"/>`);
}

const intoLast = (html, extra) => (html.endsWith('</p>') ? `${html.slice(0, -4)}${extra}</p>` : null);
const intoFirst = (html, extra) => (/^<p[^>]*>/.test(html) ? html.replace(/^<p[^>]*>/, (open) => open + extra) : `${extra}${html}`);
const authorLabel = (name, o, attrs = '') =>
  `<span class="ct-author${o.colorAuthors ? ` ct-author--${authorTone(name)}` : ''}"${attrs}>${escapeHtml(name)}</span>`;

/**
 * One message. `options` are the thread's (see `DEFAULTS`). A `note` has no bubble, no
 * author line and no ticks: it is markdown across the whole width, with the time below it.
 */
export function renderMessage(input, options) {
  const o = resolveOptions(options);
  const s = o.strings;
  const m = normalizeMessage(input);
  const mine = m.from === 'me';
  const note = m.kind === 'note';
  const format = m.format || (o.format === 'auto' ? (mine && !note ? 'plain' : 'markdown') : o.format);
  const classes = ['ct-msg', note ? 'ct-msg--note' : mine ? 'ct-msg--mine' : 'ct-msg--theirs'];
  if (m.state === 'queued') classes.push('ct-msg--queued');
  if (m.alert) classes.push('ct-msg--alert');

  const name = mine || note ? '' : m.author || o.author;
  const author = name ? authorLabel(name, o) : '';
  const title = m.title ? `<p class="ct-title">${escapeHtml(m.title)}</p>` : '';

  // buttons inside a message answer for me: only in the other side's messages, and only where I can send
  let body = formatText(m.text, format, { copy: o.copy, strings: s, replies: !mine && o.mode === 'chat' });
  const image = m.image
    ? `<button type="button" class="ct-img" aria-label="${escapeHtml(s.enlarge)}" title="${escapeHtml(s.enlarge)}"><img src="${escapeHtml(m.image.src)}" alt="${escapeHtml(m.image.alt)}"${thumbSize(m.image)} loading="lazy" decoding="async"></button>`
    : '';
  const tag = m.tag || (m.state === 'queued' ? s.queued : '');
  if (tag) body = intoFirst(body, `<span class="ct-tag">${escapeHtml(tag)}</span>`);

  const time = m.at ? `<time datetime="${m.at}">${escapeHtml(formatTime(m.at, o))}</time>` : '';
  const removable = mine && !note && m.state === 'queued' && o.mode === 'chat' && m.id !== null;
  const metaInner = `${time}${mine && !note && o.ticks ? ticks(m.state, s) : ''}${removable ? `<button type="button" class="ct-remove" aria-label="${escapeHtml(s.remove)}" title="${escapeHtml(s.remove)}">×</button>` : ''}`;
  const meta = metaInner ? `<span class="ct-meta">${metaInner}</span>` : '';

  let inner;
  if (isLong(m.text, o.clamp)) {
    inner = `<div class="ct-body ct-body--clamped">${body}</div><button type="button" class="ct-more" aria-expanded="false">${escapeHtml(s.more)}</button>${meta}`;
  } else {
    const joined = note ? null : intoLast(body, meta);
    inner = joined === null ? `<div class="ct-body">${body}</div>${meta}` : `<div class="ct-body">${joined}</div>`;
  }
  const id = m.id !== null ? ` data-id="${escapeHtml(String(m.id))}"` : '';
  const day = m.at ? ` data-day="${dayKey(m.at, o)}"` : '';
  if (image) classes.push('ct-msg--image');
  return `<div class="${classes.join(' ')}"${id}${day}>${author}${title}${image}${inner}</div>`;
}

const PIN_VIEWS = ['current', 'original', 'source'];

/**
 * The pinned message above the box: a head ("Pinned", or "Final" once the thread is
 * `resolved`) with "See the original" (when the text changed since it was pinned) and "See
 * the markdown", then the message's text. `view` is the one shown: `current`, `original` or
 * `source`. Its reply buttons answer while the thread is open; resolved, they are only marks.
 */
export function renderPinned(input, options, { resolved = false, view = 'current' } = {}) {
  const o = resolveOptions(options);
  const s = o.strings;
  const m = normalizeMessage(input);
  const mine = m.from === 'me';
  const format = m.format || (o.format === 'auto' ? (mine && m.kind !== 'note' ? 'plain' : 'markdown') : o.format);
  const original = m.original && m.original !== m.text ? m.original : '';
  const v = PIN_VIEWS.includes(view) && (view !== 'original' || original) ? view : 'current';
  const live = !mine && o.mode === 'chat' && !resolved;
  const body = (text, replies) => formatText(text, format, { copy: o.copy, strings: s, replies });
  const hidden = (name) => (v === name ? '' : ' hidden');
  const button = (name, label) => `<button type="button" class="ct-pinned-view" data-view="${name}" aria-pressed="${v === name}">${escapeHtml(v === name ? s.showCurrent : label)}</button>`;
  const title = m.title ? `<p class="ct-title">${escapeHtml(m.title)}</p>` : '';
  const id = m.id !== null ? ` data-id="${escapeHtml(String(m.id))}"` : '';
  const head = `<div class="ct-pinned-head"><span class="ct-pinned-label">${escapeHtml(resolved ? s.final : s.pinned)}</span><span class="ct-pinned-hint">${escapeHtml(resolved ? s.finalHint : s.pinnedHint)}</span>${original ? button('original', s.showOriginal) : ''}${button('source', s.showSource)}</div>`;
  return `<div class="ct-pinned${resolved ? ' ct-pinned--final' : ''}" role="region" aria-label="${escapeHtml(resolved ? s.final : s.pinned)}"${id} data-view="${v}">${head}`
    + `<div class="ct-body ct-pinned-body"${hidden('current')}>${title}${body(m.text, live)}</div>`
    + (original ? `<div class="ct-body ct-pinned-body ct-pinned-original"${hidden('original')}>${title}${body(original, false)}</div>` : '')
    + `<pre class="ct-pinned-source"${hidden('source')}>${escapeHtml(m.text)}</pre></div>`;
}

/** The day separator before the first message of each day. */
export function renderDay(key, options) {
  const o = resolveOptions(options);
  return `<div class="ct-day" data-day="${escapeHtml(key)}">${escapeHtml(dayLabel(key, { now: o.now(), locale: o.locale, timeZone: o.timeZone, strings: o.strings }))}</div>`;
}

/**
 * Three bouncing dots on the other side. `author` is `true` (the thread's author) or a name.
 * `kind` is the shape: `bubble`, with the name above the dots, or `note`, bare dots on the
 * left for a side that narrates. The words ("Assistant is typing") are there for screen
 * readers only; the thread's log announces them.
 */
export function renderTyping(author, options, kind = 'bubble') {
  const o = resolveOptions(options);
  const name = clip(author === true ? o.author : author, LIMITS.author).trim();
  const label = name ? fill(o.strings.typing, { author: name }) : o.strings.typingNoAuthor;
  const note = kind === 'note';
  const tag = name && !note ? authorLabel(name, o, ' aria-hidden="true"') : '';
  const data = name ? ` data-author="${escapeHtml(name)}"` : '';
  return `<div class="ct-msg ${note ? 'ct-msg--note' : 'ct-msg--theirs'} ct-typing"${data}>${tag}<span class="ct-sr">${escapeHtml(label)}</span><span class="ct-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

/** "Assistant has not replied yet…", in muted italics on the other side. */
export function renderWaiting(author, options) {
  const o = resolveOptions(options);
  const name = clip(author === true ? o.author : author, LIMITS.author).trim();
  const data = name ? ` data-author="${escapeHtml(name)}"` : '';
  return `<div class="ct-waiting"${data}>${escapeHtml(name ? fill(o.strings.waiting, { author: name }) : o.strings.waitingNoAuthor)}</div>`;
}

/**
 * The shape of the typing dots under `typingKind: 'auto'`: the shape of the last message that
 * is not a bubble of mine. A side that narrates in notes types as a note.
 */
function typingKindOf(messages, o) {
  if (o.typingKind !== 'auto') return o.typingKind;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === 'note' || messages[i].from !== 'me') return messages[i].kind;
  }
  return 'bubble';
}

/**
 * The inside of `.ct-list`: day separators, bubbles, then the typing and waiting lines.
 * `state` is `{ typing, waiting }`, each `false`, `true` (the thread's `author`) or a name.
 * The pinned message (the last one with `pinned: true`) is not in the list: it is above the box.
 */
export function renderList(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const list = (Array.isArray(messages) ? messages : []).map(normalizeMessage);
  const pinned = pinnedOf(list);
  const parts = [];
  let last = '';
  for (const m of list) {
    if (m === pinned) continue;
    const key = o.days && m.at ? dayKey(m.at, o) : '';
    if (key && key !== last) {
      parts.push(renderDay(key, o));
      last = key;
    }
    parts.push(renderMessage(m, o));
  }
  if (state.typing) parts.push(renderTyping(state.typing, o, typingKindOf(list, o)));
  if (state.waiting) parts.push(renderWaiting(state.waiting, o));
  return parts.join('');
}

/** The box at the bottom: suggestion chips, the growing text field, the round Send button and the toggles. */
export function renderComposer(options) {
  const o = resolveOptions(options);
  const s = o.strings;
  const chips = o.chips.length
    ? `<div class="ct-chips" role="group" aria-label="${escapeHtml(s.suggestions)}">${o.chips
      .map((c) => `<button type="button" class="ct-chip" data-text="${escapeHtml(c.text)}"${c.fill ? ' data-fill' : ''}>${escapeHtml(c.label)}</button>`).join('')}</div>`
    : '';
  const toggles = o.toggles.length
    ? `<div class="ct-toggles">${o.toggles.map((t) => `<label><input type="checkbox" name="${escapeHtml(t.name)}"${t.checked ? ' checked' : ''}> ${escapeHtml(t.label)}</label>`).join('')}</div>`
    : '';
  // the + and its menu; the file input is a phone's own camera (and the way in with no camera API)
  const attach = o.attach.length
    ? `<button type="button" class="ct-attach" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(s.attach)}" title="${escapeHtml(s.attach)}">${PLUS_ICON}</button><div class="ct-menu" role="menu" hidden>${o.attach
      .map((a) => `<button type="button" class="ct-menu-item" role="menuitem" data-attach="${a}"><span class="ct-menu-icon ct-menu-icon--${a}">${ATTACH_ICONS[a]}</span>${escapeHtml(s[a])}</button>`).join('')}</div><input type="file" class="ct-file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" hidden>`
    : '';
  // enterkeyhint: a phone's keyboard labels its Enter key "send" when Enter sends
  return `<div class="ct-composer">${chips}<div class="ct-row">${attach}<div class="ct-field"><textarea class="ct-input" rows="1" maxlength="${LIMITS.text}" enterkeyhint="${o.enterSends ? 'send' : 'enter'}" placeholder="${escapeHtml(s.placeholder)}" aria-label="${escapeHtml(s.placeholder)}"></textarea></div><button type="button" class="ct-send" disabled aria-label="${escapeHtml(s.send)}" title="${escapeHtml(s.send)}">${SEND_ICON}</button></div>${toggles}</div>`;
}

// The options a browser needs to go on drawing a server-rendered thread the same way.
const CARRIED = ['theme', 'format', 'author', 'colorAuthors', 'ticks', 'clamp', 'copy', 'enterSends', 'sendState', 'typingKind', 'locale', 'timeZone', 'hour12'];

/**
 * The options that differ from the defaults, for the thread's `data-options`: with them,
 * `createChat(el, { hydrate: true })` draws new messages, times, day separators and every
 * word the way the server did, without the page passing them again.
 */
function carriedOptions(o) {
  const out = {};
  for (const key of CARRIED) if (o[key] !== undefined && o[key] !== DEFAULTS[key]) out[key] = o[key];
  if (o.days !== (o.mode !== 'preview')) out.days = o.days;
  if (o.chips.length) out.chips = o.chips;
  if (o.toggles.length) out.toggles = o.toggles;
  if (o.attach.length) out.attach = o.attach;
  const strings = Object.fromEntries(Object.entries(o.strings).filter(([k, v]) => v !== DEFAULT_STRINGS[k]));
  if (Object.keys(strings).length) out.strings = strings;
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

/**
 * A whole thread as an HTML string: what a server sends, and what `createChat` draws.
 * Modes: `chat` (with the box), `readonly` (no box) and `preview` (no box, no day separators).
 * `state` is `{ typing, waiting, resolved }`: `resolved` turns the pinned message's "Pinned" into "Final".
 */
export function renderThread(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const pinned = pinnedOf((Array.isArray(messages) ? messages : []).map(normalizeMessage));
  const classes = ['ct'];
  if (o.theme !== 'dark') classes.push(`ct--${o.theme}`);
  if (o.mode !== 'chat') classes.push(`ct--${o.mode}`);
  const carried = carriedOptions(o);
  const data = carried ? ` data-options="${escapeHtml(carried)}"` : '';
  return `<div class="${classes.join(' ')}" data-mode="${o.mode}"${data}><div class="ct-list" role="log" aria-label="${escapeHtml(o.strings.thread)}">${renderList(messages, o, state)}</div>${pinned ? renderPinned(pinned, o, { resolved: state.resolved === true }) : ''}${o.mode === 'chat' ? renderComposer(o) : ''}</div>`;
}

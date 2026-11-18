/*! chat-thread v0.9.0 | MIT | https://github.com/rbritta/chat-thread */
/**
 * Pure helpers for chat-thread: text formats, times and the HTML of a thread as a string.
 * No DOM and no I/O, so a server renders the exact markup the browser does, and every
 * rule here is covered by plain `node --test`.
 *
 *   import { renderThread } from 'chat-thread/core';
 *   res.end(renderThread(messages, { author: 'Assistant', timeZone: 'America/Sao_Paulo' }));
 */

const LIMITS = Object.freeze({ text: 20000, author: 80, title: 200, tag: 120, url: 2048, id: 120, chip: 400, chips: 12, toggles: 8 });
/** My messages: a clock while `pending` or `queued`, ticks for `sent`, `delivered` and `read`; `failed` when sending threw. */
const STATES = Object.freeze(['pending', 'queued', 'sent', 'delivered', 'read', 'failed']);
const FORMATS = Object.freeze(['markdown', 'whatsapp', 'plain']);
const MODES = Object.freeze(['chat', 'readonly', 'preview']);
/** `bubble` is a message in a bubble; `note` is the other side narrating, full width, with no bubble. */
const KINDS = Object.freeze(['bubble', 'note']);

/** Every visible word. Pass `strings` to reword or translate: `{ placeholder: 'Write a reply', send: 'Post' }`. */
const DEFAULT_STRINGS = Object.freeze({
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
});

/** What the + left of the box can offer. Only `camera` for now: take a photo and send it with a caption. */
const ATTACH = Object.freeze(['camera']);

const DEFAULTS = Object.freeze({
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
function resolveOptions(options = {}) {
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
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url || /[\s\\\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return url;
  return /^https?:\/\/./i.test(url) ? url : null;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// A bare URL ends before trailing punctuation and before the emphasis marks around it.
const URL_RE = /https?:\/\/[^\s<>"'`\u0000]+[^\s<>"'`\u0000.,;:!?)\]}*_~]/gi;

function anchor(href, label) {
  const external = /^https?:/i.test(href);
  return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
}

/** Escaped text with bare http(s) URLs turned into links that open in a new tab. */
function linkify(value) {
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

/** One line of markdown: `code`, [links](url), bare URLs, **bold**, *italic*, ~~strike~~. */
function markdownInline(line) {
  const { keep, restore } = stasher();
  let s = line.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
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
 * A safe subset of markdown, as chat answers use it: paragraphs (single newlines kept),
 * `#` headings, `-` and `1.` lists, fenced code with a Copy button, `code`, **bold**,
 * *italic*, ~~strike~~, [links](url) and bare URLs. Raw HTML is always shown as text.
 */
function renderMarkdown(value, { copy = true, strings = DEFAULT_STRINGS } = {}) {
  const lines = clean(value).split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(markdownInline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const start = list.type === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${list.type}${start}>${list.items.map((item) => `<li>${item.map(markdownInline).join('<br>')}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
      out.push(`<p class="ct-heading">${markdownInline(heading[1])}</p>`);
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
function renderWhatsApp(value) {
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
function renderPlain(value) {
  const s = clean(value);
  return s ? `<p class="ct-plain">${linkify(s)}</p>` : '';
}

/** The body HTML of a text in one of `FORMATS`. */
function formatText(value, format = 'plain', { copy = true, strings = DEFAULT_STRINGS } = {}) {
  if (format === 'markdown') return renderMarkdown(value, { copy, strings });
  if (format === 'whatsapp') return renderWhatsApp(value);
  return renderPlain(value);
}

const toDate = (at) => {
  if (at === null || at === undefined || at === '') return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A time as an ISO string, or null when absent or unreadable. */
const normalizeAt = (at) => toDate(at)?.toISOString() ?? null;

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
function dayKey(at, { timeZone } = {}) {
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
function formatTime(at, { locale, timeZone, hour12 } = {}) {
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
function dayLabel(key, { now = new Date(), locale, timeZone, strings = DEFAULT_STRINGS } = {}) {
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
function normalizeMessage(input) {
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
  };
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
function normalizeChips(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (typeof c === 'string' ? { label: c } : c && typeof c === 'object' ? c : {}))
    .map((c) => ({ label: clip(c.label, LIMITS.chip).trim(), text: clip(c.text ?? c.label, LIMITS.chip).trim(), fill: c.fill === true }))
    .filter((c) => c.label && c.text)
    .slice(0, LIMITS.chips);
}

/** Checkboxes under the box: `{ name, label, checked? }`. Their values go with every message sent. */
function normalizeToggles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object' && /^[\w-]{1,40}$/.test(t.name || ''))
    .map((t) => ({ name: t.name, label: clip(t.label, LIMITS.chip).trim() || t.name, checked: t.checked === true }))
    .slice(0, LIMITS.toggles);
}

/** The + menu's items: known names only, each once, in the order given. */
function normalizeAttach(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((a) => ATTACH.includes(a)))];
}

/** Whether a text starts collapsed behind "Read more" (the browser unfolds it if it fits after all). */
const isLong = (value, clamp = DEFAULTS.clamp) =>
  clamp > 0 && (String(value ?? '').length > clamp || String(value ?? '').split('\n').length > 10);

/** A stable color slot (1 to 6) for an author's name, used by `colorAuthors`. */
function authorTone(name) {
  let hash = 0;
  for (const ch of String(name ?? '')) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return (Math.abs(hash) % 6) + 1;
}

/** `'{author} is typing'` with the author filled in. */
const fill = (template, values = {}) => String(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

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
function renderMessage(input, options) {
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

  let body = formatText(m.text, format, { copy: o.copy, strings: s });
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

/** The day separator before the first message of each day. */
function renderDay(key, options) {
  const o = resolveOptions(options);
  return `<div class="ct-day" data-day="${escapeHtml(key)}">${escapeHtml(dayLabel(key, { now: o.now(), locale: o.locale, timeZone: o.timeZone, strings: o.strings }))}</div>`;
}

/**
 * Three bouncing dots on the other side. `author` is `true` (the thread's author) or a name.
 * `kind` is the shape: `bubble`, with the name above the dots, or `note`, bare dots on the
 * left for a side that narrates. The words ("Assistant is typing") are there for screen
 * readers only; the thread's log announces them.
 */
function renderTyping(author, options, kind = 'bubble') {
  const o = resolveOptions(options);
  const name = clip(author === true ? o.author : author, LIMITS.author).trim();
  const label = name ? fill(o.strings.typing, { author: name }) : o.strings.typingNoAuthor;
  const note = kind === 'note';
  const tag = name && !note ? authorLabel(name, o, ' aria-hidden="true"') : '';
  const data = name ? ` data-author="${escapeHtml(name)}"` : '';
  return `<div class="ct-msg ${note ? 'ct-msg--note' : 'ct-msg--theirs'} ct-typing"${data}>${tag}<span class="ct-sr">${escapeHtml(label)}</span><span class="ct-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

/** "Assistant has not replied yet…", in muted italics on the other side. */
function renderWaiting(author, options) {
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
 */
function renderList(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const list = (Array.isArray(messages) ? messages : []).map(normalizeMessage);
  const parts = [];
  let last = '';
  for (const m of list) {
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
function renderComposer(options) {
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
 */
function renderThread(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const classes = ['ct'];
  if (o.theme !== 'dark') classes.push(`ct--${o.theme}`);
  if (o.mode !== 'chat') classes.push(`ct--${o.mode}`);
  const carried = carriedOptions(o);
  const data = carried ? ` data-options="${escapeHtml(carried)}"` : '';
  return `<div class="${classes.join(' ')}" data-mode="${o.mode}"${data}><div class="ct-list" role="log" aria-label="${escapeHtml(o.strings.thread)}">${renderList(messages, o, state)}</div>${o.mode === 'chat' ? renderComposer(o) : ''}</div>`;
}

/**
 * chat-thread: a WhatsApp-style conversation thread for the browser.
 *
 *   const chat = createChat(element, { store: restStore('/api/chat/support'), author: 'Assistant' });
 *   await chat.reload();                                // messages from the store
 *   chat.setTyping(true);                               // the other side is writing
 *   chat.append({ from: 'other', text: 'Done.' });      // a reply arrived (clears typing)
 *   chat.destroy();
 *
 * My messages sit on the right with time and ticks; the other side sits on the left with
 * its author, or narrates across the whole width with no bubble (`kind: 'note'`). Their
 * text is markdown (code gets a Copy button), mine stays as I wrote it.
 * The box grows from one to six lines: Enter sends, Shift+Enter breaks the line.
 *
 * The thread never talks to a server by itself: sending goes through `store.send` or
 * `onSend` (see `restStore` for the HTTP client and `server/` for the Node side). The HTML
 * comes from `renderThread` in core.js, so a server can draw the same thread and this
 * script only hydrates it (`hydrate: true`), with the options the server wrote into it.
 */


let sequence = 0;

const reportError = (err) => console.error('[chat-thread]', err);
const sameId = (a, b) => String(a) === String(b);
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function fragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

// Motion is short and eased out (quick, then settling softly, so nothing snaps into place at
// the end), and there is none when the system asks for less.
const EASE_OUT = 'cubic-bezier(.2, 0, 0, 1)';
const motionAllowed = () => !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A new node fades in and rises a few pixels; a transform, so nothing around it moves. */
function animateIn(node) {
  if (!node?.animate || !motionAllowed()) return;
  node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE_OUT });
}

/**
 * Nodes leaving the list fade out while their height closes, so what is below slides up
 * instead of jumping; then they are removed. A negative margin on the side where the list's
 * gap is closes the gap and the borders with them (border widths snap to whole pixels, so
 * they are not animated), and the last frame matches the layout after the removal.
 */
function animateOut(nodes, gap) {
  if (!motionAllowed()) {
    for (const node of nodes) node.remove();
    return Promise.resolve();
  }
  const last = (node) => {
    for (let n = node.nextElementSibling; n; n = n.nextElementSibling) if (!nodes.includes(n)) return false;
    return true;
  };
  return Promise.all(nodes.map((node) => {
    if (!node.animate) return node.remove();
    const s = getComputedStyle(node);
    const close = `${-(gap + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth))}px`;
    const from = { opacity: 1, height: `${node.offsetHeight}px`, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, marginBottom: s.marginBottom };
    const to = {
      opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px',
      marginTop: last(node) ? close : '0px', marginBottom: last(node) ? '0px' : close,
    };
    node.style.overflow = 'hidden';
    return node.animate([from, to], { duration: 200, easing: EASE_OUT }).finished.catch(() => {}).then(() => node.remove());
  }));
}

/** The thread to hydrate: `el` itself or the `.ct` inside it. */
function findThread(el) {
  const root = el.classList?.contains('ct') ? el : el.querySelector('.ct');
  if (!root) throw new Error('createChat: nothing to hydrate; render the thread with renderThread() first');
  return root;
}

/** The options a server wrote into the thread (`renderThread` puts them in `data-options`). */
function carriedBy(root) {
  let carried = {};
  try { carried = JSON.parse(root.dataset.options || '{}'); } catch { /* markup without them: nothing carried */ }
  if (!carried || typeof carried !== 'object' || Array.isArray(carried)) carried = {};
  if (root.dataset.mode) carried.mode = root.dataset.mode;
  return carried;
}

/** `next` over `base`: values left undefined keep the old ones, and `strings` merge word by word. */
function mergeOptions(base, next = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(next)) if (v !== undefined) out[k] = v;
  if (base.strings || next.strings) out.strings = { ...base.strings, ...next.strings };
  return out;
}

/**
 * Draws a thread in `el` (or hydrates the one a server rendered there) and returns its
 * controller. Options are the ones in `DEFAULTS` plus `messages`, `store`, `strings`,
 * `typing`, `waiting`, `onSend`, `onRemove`, `onChange`, `onError`, `now` and `hydrate`.
 */
function createChat(el, options = {}) {
  if (!el) throw new Error('createChat needs an element');
  const hydrating = options?.hydrate === true;
  let root = hydrating ? findThread(el) : null;
  let given = hydrating ? mergeOptions(carriedBy(root), options) : { ...options };
  let opts = resolveOptions(given);
  let messages = (given.messages || []).map(normalizeMessage);
  let typing = given.typing || false;
  let waiting = given.waiting || false;
  let list = null;
  let input = null;
  let sendButton = null;
  let composing = false;
  let composeEnd = null;
  let quiet = null;
  const timers = new Set();
  const painted = new WeakMap();   // the typing or waiting node -> the state it shows
  const removing = new WeakSet();  // queued messages whose × was already pressed
  const copied = new WeakMap();    // Copy button -> the timer that turns "Copied" back

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => {
    clearTimeout(t);
    timers.delete(t);
  };
  const fail = (err) => {
    (given.onError || reportError)(err);
    root?.dispatchEvent(new CustomEvent('chat-error', { detail: err, bubbles: true }));
  };
  const emit = (event) => {
    try { given.onChange?.(event); } catch (err) { fail(err); }
  };

  const listeners = [
    ['click', onClick], ['keydown', onKeydown], ['input', onInput], ['mousedown', onMouseDown],
    ['compositionstart', onComposition], ['compositionend', onComposition], ['change', onChange],
  ];

  function mount(hydrate) {
    if (!hydrate) place(fragment(renderThread(messages, opts, { typing, waiting })).firstElementChild);
    list = root.querySelector('.ct-list');
    input = root.querySelector('.ct-input');
    sendButton = root.querySelector('.ct-send');
    for (const [type, fn] of listeners) root.addEventListener(type, fn);
    if (hydrate) adoptIndicators();
    else markIndicators();
    settle(root);
    grow();
  }

  function unmount() {
    if (!root) return;
    closeMenu();
    camera.close();
    viewer.close();
    for (const [type, fn] of listeners) root.removeEventListener(type, fn);
  }

  /* ---- the + menu ---- */
  const attachButton = () => root?.querySelector('.ct-attach');
  const menu = () => root?.querySelector('.ct-menu');
  function outside(ev) {
    if (!ev.target.closest?.('.ct-attach, .ct-menu')) closeMenu();
  }
  function openMenu() {
    const m = menu();
    if (!m) return;
    m.hidden = false;
    attachButton()?.setAttribute('aria-expanded', 'true');
    m.querySelector('.ct-menu-item')?.focus();
    document.addEventListener('pointerdown', outside, true);
  }
  function closeMenu(refocus = false) {
    document.removeEventListener('pointerdown', outside, true);
    const m = menu();
    if (!m || m.hidden) return;
    m.hidden = true;
    attachButton()?.setAttribute('aria-expanded', 'false');
    if (refocus) attachButton()?.focus();
  }

  /* ---- the camera: live video on a computer, the phone's own camera through the file input ---- */
  /** A photo in a bubble opens at full size over everything; Escape, the X or a click outside the photo closes it. */
  const viewer = (() => {
    let layer = null;
    let from = null;

    function open(button) {
      const img = button.querySelector('img');
      if (!img) return;
      close();
      from = button;
      const s = opts.strings;
      const alt = img.getAttribute('alt') || '';
      layer = fragment(`<div class="ct-cam ct-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(alt || s.photo)}">
<div class="ct-cam-top"><button type="button" class="ct-cam-close" aria-label="${escapeHtml(s.close)}" title="${escapeHtml(s.close)}">${CLOSE_ICON}</button><span class="ct-cam-title">${escapeHtml(alt || s.photo)}</span></div>
<div class="ct-cam-view"><img class="ct-viewer-img" alt="${escapeHtml(alt)}"></div>
</div>`).firstElementChild;
      layer.querySelector('.ct-viewer-img').src = img.currentSrc || img.src;
      layer.addEventListener('click', (ev) => {
        if (ev.target.closest?.('.ct-cam-close') || !ev.target.closest?.('.ct-viewer-img, .ct-cam-top')) back();
      });
      layer.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        back();
      });
      root.appendChild(layer);
      layer.querySelector('.ct-cam-close').focus();
    }

    function back() {
      const b = from;
      close();
      if (b?.isConnected) b.focus();
    }

    function close() {
      layer?.remove();
      layer = null;
      from = null;
    }

    return { open, close };
  })();

  const camera = (() => {
    let layer = null;
    let stream = null;
    let shot = null;   // the canvas with the photo taken
    let viaFile = false;
    const MAX_SIDE = 2048;

    const stop = () => {
      for (const track of stream?.getTracks?.() ?? []) track.stop();
      stream = null;
    };
    const q = (sel) => layer?.querySelector(sel);

    function build() {
      const s = opts.strings;
      const sendIcon = root.querySelector('.ct-send')?.innerHTML ?? '';
      layer = fragment(`<div class="ct-cam" role="dialog" aria-modal="true" aria-label="${escapeHtml(s.camera)}">
<div class="ct-cam-top"><button type="button" class="ct-cam-close" aria-label="${escapeHtml(s.close)}" title="${escapeHtml(s.close)}">${CLOSE_ICON}</button><span class="ct-cam-title"></span></div>
<div class="ct-cam-view"><video class="ct-cam-video" autoplay muted playsinline></video><canvas class="ct-cam-shot" hidden></canvas></div>
<div class="ct-cam-foot ct-cam-foot--live"><button type="button" class="ct-cam-take" aria-label="${escapeHtml(s.takePhoto)}" title="${escapeHtml(s.takePhoto)}"></button></div>
<div class="ct-cam-foot ct-cam-foot--shot" hidden><button type="button" class="ct-cam-retake">${escapeHtml(s.retake)}</button><div class="ct-field"><textarea class="ct-cam-caption" rows="1" maxlength="2000" placeholder="${escapeHtml(s.caption)}" aria-label="${escapeHtml(s.caption)}"></textarea></div><button type="button" class="ct-send ct-cam-send" aria-label="${escapeHtml(s.send)}" title="${escapeHtml(s.send)}">${sendIcon}</button></div>
</div>`).firstElementChild;
      layer.addEventListener('click', onLayerClick);
      layer.addEventListener('keydown', onLayerKey);
      root.appendChild(layer);
    }

    function show(phase) {
      const live = phase === 'live';
      q('.ct-cam-video').hidden = !live;
      q('.ct-cam-shot').hidden = live;
      q('.ct-cam-foot--live').hidden = !live;
      q('.ct-cam-foot--shot').hidden = live;
      q('.ct-cam-title').textContent = live ? opts.strings.takePhoto : opts.strings.photo;
      (live ? q('.ct-cam-take') : q('.ct-cam-caption'))?.focus();
    }

    /** The picture, at most MAX_SIDE on its long side, on the preview canvas. */
    function keep(source, width, height) {
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const c = q('.ct-cam-shot');
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      shot = c;
      show('shot');
    }

    async function live() {
      viaFile = false;
      if (!layer) build();
      show('live');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!layer) return stop();   // closed while the browser asked
        q('.ct-cam-video').srcObject = stream;
      } catch (err) {
        // no camera, or the permission refused: the file input still lets a photo in
        close();
        pick();
      }
    }

    function pick() {
      viaFile = true;
      const file = root.querySelector('.ct-file');
      if (!file) return;
      file.value = '';
      file.click();
    }

    async function fromFile(file) {
      if (!file || !/^image\//.test(file.type)) return;
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        if (!layer) build();
        keep(bitmap, bitmap.width, bitmap.height);
        bitmap.close?.();
      } catch (err) {
        fail(err);
      }
    }

    function take() {
      const video = q('.ct-cam-video');
      if (!video?.videoWidth) return;
      keep(video, video.videoWidth, video.videoHeight);
      stop();
    }

    /** A light copy for the bubble (a data: URL, so a strict CSP with `img-src 'self' data:` shows it). */
    function thumbnail(source) {
      try {
        const scale = Math.min(1, 560 / Math.max(source.width, source.height));
        const c = document.createElement('canvas');
        c.width = Math.round(source.width * scale);
        c.height = Math.round(source.height * scale);
        c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
        return { src: c.toDataURL('image/jpeg', 0.8), width: c.width, height: c.height };
      } catch {
        return null;
      }
    }

    async function deliver() {
      if (!shot) return;
      const caption = q('.ct-cam-caption').value.trim();
      const photo = await new Promise((resolve) => shot.toBlob(resolve, 'image/jpeg', 0.85));
      const preview = thumbnail(shot);
      close();
      if (photo) send(caption, { photo, preview });
      input?.focus();
    }

    function close() {
      stop();
      shot = null;
      if (!layer) return;
      layer.remove();
      layer = null;
    }

    function onLayerClick(ev) {
      const b = ev.target.closest?.('button');
      if (!b) return;
      if (b.classList.contains('ct-cam-close')) {
        close();
        attachButton()?.focus();
      } else if (b.classList.contains('ct-cam-take')) take();
      else if (b.classList.contains('ct-cam-retake')) {
        if (viaFile) pick();
        else live();
      } else if (b.classList.contains('ct-cam-send')) deliver();
    }

    function onLayerKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        attachButton()?.focus();
      } else if (ev.key === 'Enter' && !ev.shiftKey && ev.target.classList?.contains('ct-cam-caption') && !ev.isComposing) {
        ev.preventDefault();
        deliver();
      }
    }

    return {
      /** A phone (coarse pointer) or a browser with no camera API opens the phone's camera app. */
      open() {
        const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
        if (coarse || !navigator.mediaDevices?.getUserMedia) pick();
        else live();
      },
      fromFile,
      close,
    };
  })();

  /** Puts a freshly drawn thread where the old one is, keeping the element the app holds. */
  function place(fresh) {
    if (root === el) {
      // hydrated on the thread element itself: it stays, and takes the new one's attributes and insides
      for (const name of ['class', 'data-mode', 'data-options']) {
        const value = fresh.getAttribute(name);
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
      el.replaceChildren(...fresh.childNodes);
    } else if (root?.parentNode) {
      root.replaceWith(fresh);
      root = fresh;
    } else {
      el.replaceChildren(fresh);
      root = fresh;
    }
  }

  /** Long messages start collapsed; the ones that fit after all lose the "Read more". */
  function settle(scope) {
    // measure all first, then change: one layout for the whole list, not one per message
    const fits = [...scope.querySelectorAll('.ct-body--clamped')]
      .filter((body) => body.clientHeight && body.scrollHeight <= body.clientHeight + 2);
    for (const body of fits) {
      body.classList.remove('ct-body--clamped');
      const msg = body.parentElement;
      msg.querySelector(':scope > .ct-more')?.remove();
      const meta = msg.querySelector(':scope > .ct-meta');
      // a bubble keeps the time at the end of its last line; a note keeps it below the text
      if (meta && !msg.classList.contains('ct-msg--note') && body.lastElementChild?.tagName === 'P') body.lastElementChild.append(meta);
    }
  }

  /** The box grows with the text up to six lines, then scrolls. */
  function grow() {
    if (!input) return;
    const field = input.parentElement;
    // Measuring needs the box at its smallest for a moment. Its frame keeps the current height
    // meanwhile, so the page never gets shorter: at the bottom of a page, a shorter page clamps
    // the scroll, and not every engine puts it back once the box is tall again.
    field.style.minHeight = `${field.offsetHeight}px`;
    input.style.height = 'auto';
    const line = parseFloat(getComputedStyle(input).lineHeight) || 21;
    const max = line * 6;
    const full = input.scrollHeight;
    input.style.height = `${Math.min(full, max)}px`;
    input.style.overflowY = full > max + 1 ? 'auto' : 'hidden';
    field.style.removeProperty('min-height');
    if (sendButton) sendButton.disabled = !input.value.trim();
  }

  /**
   * Changes the whole list without the log reading it all out: a live region announces
   * what is added to it, and a reload is not news. New messages are announced again a
   * moment later.
   */
  function quietly(change) {
    if (quiet) cancel(quiet.timer);
    else quiet = { before: list.getAttribute('aria-live') };
    list.setAttribute('aria-live', 'off');
    change();
    const target = list;
    quiet.timer = later(() => {
      if (quiet.before === null) target.removeAttribute('aria-live');
      else target.setAttribute('aria-live', quiet.before);
      quiet = null;
    }, 300);
  }

  function drawList() {
    quietly(() => list.replaceChildren(fragment(renderList(messages, opts, { typing, waiting }))));
    markIndicators();
    settle(list);
  }

  const indicator = (cls) => list.querySelector(`:scope > .${cls}`);

  /** What the typing and waiting nodes should show, as comparable keys ('' for nothing). */
  function indicatorKeys() {
    return {
      'ct-typing': typing ? JSON.stringify([typing, typingShape()]) : '',
      'ct-waiting': waiting ? JSON.stringify([waiting]) : '',
    };
  }

  /** Records that the typing and waiting nodes on screen show the current state. */
  function markIndicators() {
    const keys = indicatorKeys();
    for (const [cls, key] of Object.entries(keys)) {
      const node = indicator(cls);
      if (node) painted.set(node, key);
    }
  }

  /** A hydrated thread starts with the typing and waiting lines the server drew (a reply then clears them). */
  function adoptIndicators() {
    const shown = (node) => (node ? node.dataset.author || true : false);
    typing = shown(indicator('ct-typing'));
    waiting = shown(indicator('ct-waiting'));
    markIndicators();
    // options given to createChat that ask for something else win, and the lines change to match
    if (given.typing !== undefined) typing = given.typing || false;
    if (given.waiting !== undefined) waiting = given.waiting || false;
    drawIndicators();
  }

  /** Redraws the typing and waiting lines that changed, and only those (so they do not blink). */
  function drawIndicators() {
    const keys = indicatorKeys();
    for (const cls of ['ct-typing', 'ct-waiting']) {
      const node = indicator(cls);
      if (node && painted.get(node) === keys[cls]) continue;
      node?.remove();
      if (!keys[cls]) continue;
      const html = cls === 'ct-typing' ? renderTyping(typing, opts, typingShape()) : renderWaiting(waiting, opts);
      const fresh = fragment(html).firstElementChild;
      painted.set(fresh, keys[cls]);
      list.insertBefore(fresh, cls === 'ct-typing' ? indicator('ct-waiting') : null);
      animateIn(fresh);
    }
  }

  /** `typingKind: 'auto'`: the dots take the shape of the last message that is not a bubble of mine. */
  function typingShape() {
    if (opts.typingKind !== 'auto') return opts.typingKind;
    for (let n = list.lastElementChild; n; n = n.previousElementSibling) {
      const c = n.classList;
      if (!c.contains('ct-msg') || c.contains('ct-typing') || c.contains('ct-msg--mine')) continue;
      return c.contains('ct-msg--note') ? 'note' : 'bubble';
    }
    return 'bubble';
  }

  function lastDay() {
    const days = list.querySelectorAll(':scope > [data-day]');
    return days.length ? days[days.length - 1].dataset.day : '';
  }

  /** Adds one message at the end (before the typing and waiting lines) and returns its node. */
  function insert(message) {
    const key = opts.days && message.at ? dayKey(message.at, opts) : '';
    const day = key && key !== lastDay() ? fragment(renderDay(key, opts)).firstElementChild : null;
    const node = fragment(renderMessage(message, opts)).firstElementChild;
    const before = list.querySelector(':scope > .ct-typing, :scope > .ct-waiting');
    if (day) list.insertBefore(day, before);
    list.insertBefore(node, before);
    settle(node);
    animateIn(day);
    animateIn(node);
    if (opts.autoScroll) node.scrollIntoView?.({ block: 'nearest' });
    return node;
  }

  const nodeOf = (id) => [...list.querySelectorAll(':scope > .ct-msg[data-id]')].find((n) => sameId(n.dataset.id, id)) || null;

  /** Draws one message again in place, keeping it open if it was, and the focus on the same button. */
  function redraw(id, message) {
    const node = nodeOf(id);
    if (!node) return null;
    const open = node.querySelector(':scope > .ct-more')?.getAttribute('aria-expanded') === 'true';
    const focused = node.contains(document.activeElement) ? document.activeElement.classList[0] : '';
    const fresh = fragment(renderMessage(message, opts)).firstElementChild;
    node.replaceWith(fresh);
    settle(fresh);
    const more = fresh.querySelector(':scope > .ct-more');
    if (open && more) setOpen(more, true, false);
    if (focused?.startsWith('ct-')) fresh.querySelector(`.${focused}`)?.focus();
    return fresh;
  }

  /** Removes day separators left without messages. */
  function pruneDays() {
    for (const day of list.querySelectorAll(':scope > .ct-day')) {
      const next = day.nextElementSibling;
      if (!next || next.matches('.ct-day, .ct-typing, .ct-waiting')) day.remove();
    }
  }

  /** The day separator that would be left alone if `node` went. */
  function orphanDay(node) {
    const prev = node.previousElementSibling;
    if (!prev?.classList.contains('ct-day')) return null;
    const next = node.nextElementSibling;
    return !next || next.matches('.ct-day, .ct-typing, .ct-waiting') ? prev : null;
  }

  const toggleBoxes = () => root.querySelectorAll('.ct-toggles input[type=checkbox][name]');

  function readToggles() {
    const values = {};
    for (const box of toggleBoxes()) values[box.name] = box.checked;
    return values;
  }

  /** Sends the box's text, or `raw`; with `photo` (a Blob), `raw` is its caption and may be empty. */
  async function send(raw, { photo = null, preview = null } = {}) {
    const fromBox = raw === undefined && !photo;
    const value = String(fromBox ? input?.value ?? '' : raw ?? '').replace(/\s+$/, '').replace(/^\n+/, '');
    if ((!value.trim() && !photo) || opts.mode !== 'chat') return null;
    const toggles = readToggles();
    const hasToggles = Object.keys(toggles).length > 0;
    const text = photo ? `📷 ${value.trim() || opts.strings.photo}` : value;
    const draft = { from: 'me', text, at: opts.now().toISOString() };
    if (opts.sendState) draft.state = opts.sendState;
    if (hasToggles || photo) draft.meta = { ...(hasToggles ? { toggles } : {}), ...(photo ? { photo: { type: photo.type, size: photo.size } } : {}) };
    // the box empties before anything is awaited, so a second Enter finds nothing to send
    if (fromBox) {
      input.value = '';
      grow();
    }
    // the photo just taken shows in the bubble at once; it stays on this page and never goes to the store
    const local = photo && preview ? { image: { ...preview, alt: value.trim() || opts.strings.photo } } : {};
    const temp = normalizeMessage({ ...draft, ...local, id: `tmp-${++sequence}`, state: 'pending' });
    messages.push(temp);
    insert(temp);
    let saved = null;
    try {
      if (opts.store) saved = await opts.store.send(draft);
      const info = { toggles, message: saved || draft, chat: api };
      if (photo) Object.assign(info, { photo, caption: value.trim() });
      const answer = await given.onSend?.(text, info);
      if (!saved && answer && typeof answer === 'object') saved = answer;
    } catch (err) {
      settleDraft(temp, { ...temp, state: 'failed', alert: true });
      fail(err);
      return null;
    }
    const final = settleDraft(temp, { ...draft, ...local, ...(saved || {}), id: saved?.id ?? temp.id.replace('tmp-', 'local-') });
    emit({ type: 'send', message: final, toggles });
    return final;
  }

  /**
   * The draft of a send becomes the saved message (or the failed one). If a live feed already
   * appended the saved message while the store was answering, the draft just goes.
   */
  function settleDraft(temp, next) {
    const message = normalizeMessage(next);
    const index = messages.indexOf(temp);
    if (!sameId(message.id, temp.id) && nodeOf(message.id)) {
      if (index >= 0) messages.splice(index, 1);
      nodeOf(temp.id)?.remove();
      pruneDays();
      upsert(message);
    } else {
      if (index >= 0) messages[index] = message;
      redraw(temp.id, message);
    }
    return message;
  }

  /** Puts a message in the thread: in place when its id is already on screen, at the end otherwise. */
  function upsert(message) {
    const index = messages.findIndex((m) => sameId(m.id, message.id));
    if (index >= 0) messages[index] = message;
    else messages.push(message);   // new, or one the server drew and this script now knows
    if (nodeOf(message.id)) redraw(message.id, message);
    else insert(message);
  }

  async function remove(node) {
    const id = node?.dataset.id;
    if (id === undefined || removing.has(node)) return;
    removing.add(node);
    const known = messages.find((m) => sameId(m.id, id));
    const message = known || { id };
    try {
      if (opts.store?.remove) await opts.store.remove(message.id);
      await given.onRemove?.(message);
    } catch (err) {
      removing.delete(node);
      fail(err);
      return;
    }
    if (known && messages.includes(known)) messages.splice(messages.indexOf(known), 1);
    const day = orphanDay(node);
    const leaving = day ? [day, node] : [node];
    // out of the thread's bookkeeping now; the nodes only finish their way out
    for (const n of leaving) {
      n.removeAttribute('data-id');
      n.removeAttribute('data-day');
      n.setAttribute('aria-hidden', 'true');
    }
    if (node.contains(document.activeElement)) input?.focus();
    emit({ type: 'remove', message });
    await animateOut(leaving, parseFloat(getComputedStyle(list).rowGap) || 0);
    pruneDays();
  }

  /** Opens or closes a long message. The height eases between the two; the fade stays on while it opens. */
  function setOpen(button, open, animate = true) {
    const body = button.previousElementSibling;
    if (!body) return;
    const from = body.getBoundingClientRect().height;
    for (const run of body.getAnimations?.() ?? []) run.cancel();
    button.textContent = open ? opts.strings.less : opts.strings.more;
    button.setAttribute('aria-expanded', String(open));
    const still = !animate || !body.animate || !motionAllowed();
    if (open) {
      if (still) {
        body.classList.remove('ct-body--clamped');
        return;
      }
      body.classList.add('ct-body--clamped');
      const run = body.animate([{ maxHeight: `${from}px` }, { maxHeight: `${body.scrollHeight}px` }], { duration: 240, easing: EASE_OUT });
      // the promise, not the finish event: it settles first, so the open state is there as soon as anyone looks
      run.finished.then(() => body.classList.remove('ct-body--clamped'), () => {});
      return;
    }
    body.classList.add('ct-body--clamped');
    // closing can carry the button above the screen: bring it back, so the reader keeps the place
    const keepInView = () => button.scrollIntoView?.({ block: 'nearest' });
    if (still) {
      keepInView();
      return;
    }
    const run = body.animate([{ maxHeight: `${from}px` }, { maxHeight: `${body.getBoundingClientRect().height}px` }], { duration: 200, easing: EASE_OUT });
    run.finished.then(keepInView, () => {});
  }

  async function copy(button) {
    const code = button.parentElement.querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = opts.strings.copied;
      if (copied.has(button)) cancel(copied.get(button));
      copied.set(button, later(() => { button.textContent = opts.strings.copy; }, 1200));
    } catch {
      // No clipboard (plain http, or permission refused): select the code so Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(code);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  }

  function onClick(ev) {
    const button = ev.target.closest?.('button');
    if (!button || !root.contains(button) || button.closest('.ct-cam')) return;
    const is = (cls) => button.classList.contains(cls);
    if (is('ct-attach')) {
      if (menu()?.hidden === false) closeMenu();
      else openMenu();
    } else if (is('ct-menu-item')) {
      closeMenu();
      if (button.dataset.attach === 'camera') camera.open();
    } else if (is('ct-send')) {
      send();
      // pressed from the keyboard, the button is now disabled: the focus goes back to the box
      input?.focus();
    } else if (is('ct-more')) setOpen(button, button.getAttribute('aria-expanded') !== 'true');
    else if (is('ct-img')) viewer.open(button);
    else if (is('ct-copy')) copy(button);
    else if (is('ct-remove')) remove(button.closest('.ct-msg'));
    else if (is('ct-chip')) {
      const value = button.dataset.text || button.textContent;
      if (button.hasAttribute('data-fill') && input) {
        input.value = value;
        grow();
        input.focus();
      } else {
        send(value);
      }
    }
  }

  /** A click on Send leaves the focus (and a phone's keyboard) in the box. */
  function onMouseDown(ev) {
    if (input && ev.target.closest?.('.ct-send')) ev.preventDefault();
  }

  function onComposition(ev) {
    if (ev.target !== input) return;
    if (composeEnd) cancel(composeEnd);
    composeEnd = null;
    if (ev.type === 'compositionstart') composing = true;
    // Safari fires the Enter that picks a word after compositionend: it still belongs to the word
    else composeEnd = later(() => { composing = false; composeEnd = null; }, 0);
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape' && menu()?.hidden === false) {
      ev.preventDefault();
      closeMenu(true);
      return;
    }
    if (ev.target !== input || ev.key !== 'Enter' || ev.shiftKey) return;
    if (composing || ev.isComposing || ev.keyCode === 229) return;
    // with enterSends off, Ctrl+Enter (Cmd+Enter on a Mac) still sends
    if (!opts.enterSends && !ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    send();
  }

  function onChange(ev) {
    if (!ev.target.classList?.contains('ct-file')) return;
    camera.fromFile(ev.target.files?.[0]);
  }

  function onInput(ev) {
    if (ev.target === input) grow();
  }

  const api = {
    /**
     * Adds a message at the end. A message from the other side clears typing and waiting.
     * A message whose id is already in the thread (a live feed echoing a send) changes that one instead.
     */
    append(message) {
      const m = normalizeMessage(message);
      if (m.id === null) m.id = `local-${++sequence}`;
      if (m.from !== 'me' && (typing || waiting)) {
        typing = false;
        waiting = false;
        drawIndicators();
      }
      upsert(m);
      emit({ type: 'append', message: m });
      return m;
    },
    /** Changes one message in place, e.g. `{ state: 'read' }` or a streamed `{ text }`. */
    updateMessage(id, patch = {}) {
      const index = messages.findIndex((m) => sameId(m.id, id));
      if (index < 0) return null;
      const m = normalizeMessage({ ...messages[index], ...patch, id: messages[index].id });
      messages[index] = m;
      redraw(id, m);
      return m;
    },
    /** Replaces the whole list and/or the indicators: `{ messages?, typing?, waiting? }`. */
    update({ messages: next, typing: t, waiting: w } = {}) {
      if (next) messages = next.map(normalizeMessage);
      if (t !== undefined) typing = t || false;
      if (w !== undefined) waiting = w || false;
      drawList();
    },
    /** `true` (the thread's author), a name, or `false`. */
    setTyping(value) {
      typing = value || false;
      drawIndicators();
    },
    /** "… has not replied yet": `true`, a name, or `false`. */
    setWaiting(value) {
      waiting = value || false;
      drawIndicators();
    },
    /** Loads the messages from the store again. */
    async reload() {
      if (!opts.store) return messages;
      try {
        const data = await opts.store.load();
        messages = (Array.isArray(data) ? data : data?.messages || []).map(normalizeMessage);
        drawList();
        emit({ type: 'load', messages: [...messages] });
      } catch (err) {
        fail(err);
      }
      return messages;
    },
    /** Sends a text as if it had been typed in the box; `{ photo }` (a Blob) sends a photo with `value` as its caption. */
    send: (value, extra) => send(value, extra),
    /** Opens the camera, as the + menu's Camera does (only with `attach: ['camera']`). */
    openCamera() { if (root?.querySelector('.ct-file')) camera.open(); },
    /** New options. The text being typed, the toggles' boxes and the focus in the box are kept. */
    configure(next = {}) {
      const draft = input?.value ?? '';
      const checked = readToggles();
      const focused = !!input && document.activeElement === input;
      given = mergeOptions(given, next);
      opts = resolveOptions(given);
      if (next.messages) messages = next.messages.map(normalizeMessage);
      unmount();
      mount(false);
      if (!next.toggles) for (const box of toggleBoxes()) if (box.name in checked) box.checked = checked[box.name];
      if (input && draft) {
        input.value = draft;
        grow();
      }
      if (focused) input?.focus();
    },
    focus() { input?.focus(); },
    get messages() { return messages.map((m) => ({ ...m })); },
    get el() { return root; },
    get composer() { return root?.querySelector('.ct-composer') ?? null; },
    /** Takes the thread out of the page (only the thread: what else is in `el` stays). */
    destroy() {
      unmount();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (root === el) el.replaceChildren();
      else root?.remove();
    },
  };

  mount(hydrating);
  return api;
}

/** A fetch-based store for the routes in `server/http-handler.js`, bound to one thread URL. */
function restStore(url, { headers = {}, fetch: doFetch = (...args) => globalThis.fetch(...args) } = {}) {
  const base = String(url).replace(/\/$/, '');
  const call = async (method, path, body) => {
    const res = await doFetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(typeof headers === 'function' ? headers() : headers) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path || '/'}: ${res.status}`);
    return data;
  };
  return {
    load: () => call('GET', ''),
    // the server decides who wrote it: whatever comes through the handler is `from: 'me'`
    send: (draft) => call('POST', '', { text: draft.text, state: draft.state ?? undefined, meta: draft.meta ?? undefined }),
    remove: (id) => call('PATCH', `/${encodeURIComponent(id)}`, { removed: true }),
  };
}

function listStore(read, write) {
  const find = (data, id) => data.messages.findIndex((m) => sameId(m.id, id));
  return {
    load: () => ({ messages: read().messages }),
    send(draft) {
      const data = read();
      const message = normalizeMessage({ ...draft, id: data.next, at: draft.at || new Date().toISOString() });
      data.messages.push(message);
      data.next += 1;
      write(data);
      return message;
    },
    update(id, patch = {}) {
      const data = read();
      const i = find(data, id);
      if (i < 0) throw new Error('message not found');
      data.messages[i] = normalizeMessage({ ...data.messages[i], ...patch, id: data.messages[i].id });
      write(data);
      return data.messages[i];
    },
    remove(id) {
      const data = read();
      const i = find(data, id);
      if (i >= 0) data.messages.splice(i, 1);
      write(data);
      return { ok: true };
    },
  };
}

const seed = (messages) => {
  let next = 1;
  const list = (messages || []).map((m) => normalizeMessage(m));
  for (const m of list) if (typeof m.id === 'number' && m.id >= next) next = m.id + 1;
  for (const m of list) if (m.id === null) m.id = next++;
  return { next, messages: list };
};

/** A store in memory: for demos, tests and threads that live as long as the page. */
function memoryStore(messages = []) {
  let data = seed(messages);
  const clone = (d) => ({ next: d.next, messages: d.messages.map((m) => ({ ...m })) });
  return listStore(() => clone(data), (d) => { data = clone(d); });
}

/** A store in localStorage: for prototypes and threads that live in one browser. */
function localStore(name = 'chat-thread', storage = globalThis.localStorage) {
  const read = () => {
    try {
      const saved = JSON.parse(storage.getItem(name) || 'null');
      return saved && Array.isArray(saved.messages) ? { next: Number(saved.next) || 1, messages: saved.messages.map(normalizeMessage) } : seed([]);
    } catch {
      return seed([]);
    }
  };
  const write = (data) => {
    try { storage.setItem(name, JSON.stringify(data)); } catch { /* storage full or blocked: the thread still works this session */ }
  };
  return listStore(read, write);
}


/**
 * chat-thread threads: several conversations about different subjects in one place, each a
 * full chat thread under a header.
 *
 *   const box = createThreads(element, {
 *     threads: [{ id: 'q1', title: 'Deploy', participants: [{ name: 'Ana' }], messages: [...] }],
 *     onSend: (id, text) => api.send(id, text),
 *     onNewThread: (text, parentId) => api.open(text, parentId),   // returns the new thread
 *   });
 *   box.append('q1', { from: 'other', text: 'Done.' });
 *   box.resolve('q1', 'Ana');                                     // from outside, too
 *
 * Threads stay in the order they were opened; a resolved one collapses into one line in its
 * place, hidden behind "Show N resolved" at the top. There is one message box: the one of the
 * active thread (the last one opened or touched). Its Branch button, right of Send, or
 * Ctrl+Shift+Enter opens a new thread with the text, derived from that one. With no thread
 * open, a box at the bottom starts a new thread. `newThreads: false` leaves all three out, for
 * an app that shows threads the person cannot start (one question in a side panel, a history).
 *
 * Two headers ship: `conversation` (the default: avatars, title, who and when, for people
 * talking to people, with or without an AI in between) and `questions` (a numbered badge
 * with the state, for AI sessions). `header` replaces them with the app's own.
 *
 * The title is what someone gave the thread (a person, or an AI on the way, marked with ✦);
 * without one, the first line of the first message.
 */

const THREAD_STRINGS = Object.freeze({
  resolved: 'Resolved',
  resolvedBy: 'Resolved by {name}',
  waiting: 'Waiting for you',
  busy: 'Working',
  message: '{count} message',
  messages: '{count} messages',
  resolve: 'Resolve',
  reopen: 'Reopen',
  rename: 'Rename',
  you: 'You',
  untitled: 'Untitled',
  titledBy: 'Title by {name}',
  showResolved: 'Show {count} resolved',
  showResolvedOne: 'Show 1 resolved',
  hideResolved: 'Hide resolved',
  earlier: 'Show {count} earlier messages',
  earlierOne: 'Show 1 earlier message',
  latestOnly: 'Show only the latest',
  newThread: 'Write to start a new thread',
  branch: 'Start another thread with this text',
  from: 'from {title}',
  fromQ: 'from Q{n}',
  and: '{a} and {b}',
  andMore: '{list} and +{count}',
});

const THREAD_MODES = Object.freeze(['conversation', 'questions']);

const ICONS = {
  resolve: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 8.2l1.8 1.8 3.6-3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 8.4l2.7 2.7 5.7-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reopen: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.8v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rename: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.9l2.5 2.5-7.4 7.4-3 .5.5-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  branch: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.5V9M8 9L3.6 3.8M8 9l4.4-5.2M3.4 7V3.6h3.4M12.6 7V3.6H9.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg class="ct-th-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/** The title shown: the one someone gave, or the first line of the first message. */
function threadTitle(thread, strings = THREAD_STRINGS) {
  const given = String(thread.title ?? '').trim();
  if (given) return given;
  const line = firstLine((thread.messages || [])[0]?.text).replace(/\s+/g, ' ');
  return line ? (line.length > 90 ? `${line.slice(0, 89)}…` : line) : strings.untitled;
}

function names(people, s) {
  const list = people.map((p) => p.name).filter(Boolean);
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return fill(s.and, { a: list[0], b: list[1] });
  return fill(s.andMore, { list: list.slice(0, 2).join(', '), count: list.length - 2 });
}

function titleHtml(t, s) {
  const by = t.titleBy && t.titleByAI ? `<i class="ct-th-ai" title="${escapeHtml(fill(s.titledBy, { name: t.titleBy }))}">✦ ${escapeHtml(t.titleBy)}</i>` : '';
  return `<span class="ct-th-t"><span class="ct-th-tt">${escapeHtml(threadTitle(t, s))}</span>${by}</span>`;
}

const resolvedText = (t, s) => (t.resolvedBy ? fill(s.resolvedBy, { name: t.resolvedBy }) : s.resolved);

/** The default header: avatars (a check once resolved), title, who and how many, when. */
function conversationHeader(t, { strings: s, preview, when }) {
  const people = t.participants || [];
  const side = t.status === 'resolved'
    ? `<span class="ct-th-ok">${ICONS.check}</span>`
    : `<span class="ct-th-av">${people.slice(0, 3).map((p) => `<b class="ct-th-av--${authorTone(p.name)}">${escapeHtml(String(p.name || '?').charAt(0).toUpperCase())}</b>`).join('')}</span>`;
  let state = '';
  if (t.status !== 'resolved' && (t.tone === 'wait' || t.tone === 'busy')) {
    state = `<span class="ct-th-state ct-th-state--${t.tone}"><span class="ct-th-dot"></span>${escapeHtml(t.label || (t.tone === 'wait' ? s.waiting : s.busy))}</span>`;
  }
  const count = (t.messages || []).length;
  const meta = t.status === 'resolved'
    ? `${escapeHtml(resolvedText(t, s))} · ${escapeHtml(when(t.resolvedAt || t.lastAt))}`
    : [names(people, s), fill(count === 1 ? s.message : s.messages, { count }), when(t.lastAt)].filter(Boolean).map(escapeHtml).join(' · ');
  const from = t.parent ? `<span class="ct-th-from">↳ ${escapeHtml(fill(s.from, { title: t.parent.title || '' }))}</span>` : '';
  return `${side}<span class="ct-th-main">${titleHtml(t, s)}${from}<span class="ct-th-meta">${state}${meta}</span><span class="ct-th-p">${escapeHtml(preview)}</span></span>`;
}

/** For AI sessions: the badge Qn colored by the state, the state, where it came from, when it opened. */
function questionsHeader(t, { strings: s, preview, when }) {
  const state = t.status === 'resolved' ? resolvedText(t, s) : t.label || (t.tone === 'wait' ? s.waiting : t.tone === 'busy' ? s.busy : '');
  const bits = [state, t.origin, t.parent ? fill(s.fromQ, { n: t.parent.n ?? '' }) : ''].filter(Boolean).map(escapeHtml).join(' · ');
  return `<span class="ct-th-n">Q${escapeHtml(t.n ?? '')}</span><span class="ct-th-main"><span class="ct-th-st">${bits}<time>${escapeHtml(when(t.at))}</time></span>${titleHtml(t, s)}<span class="ct-th-p">${escapeHtml(preview)}</span></span>`;
}

const THREAD_HEADERS = Object.freeze({ conversation: conversationHeader, questions: questionsHeader });

const THEMES = ['dark', 'light', 'auto'];
const near = (list) => !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;

/**
 * Draws the threads in `el` and returns their controller. Options: `threads`, `mode`
 * (`conversation` or `questions`), `header`, `theme`, `strings`, `chat` (options for every
 * thread's createChat: author, locale, timeZone, strings...), `showResolved`, `latest` (how many
 * of the last messages a thread shows before "Show N earlier"; 2, 0 shows all), `newThreads`
 * (false: no Branch button, no Ctrl+Shift+Enter, no box at the bottom), `rename` (false: no
 * pencil), and the callbacks `onSend(id, text, info)`, `onNewThread(text, parentId)` (returns the
 * new thread, or a promise of it), `onResolve(id)`, `onReopen(id)`, `onRename(id, title)`,
 * `onError(err)`.
 */
function createThreads(el, options = {}) {
  if (!el) throw new Error('createThreads: no element');
  const o = { mode: 'conversation', theme: options.chat?.theme || 'dark', showResolved: false, latest: 2, newThreads: true, rename: true, ...options };
  // what the person may do besides talking: start threads (Branch, Ctrl+Shift+Enter, the bottom box) and rename them
  const canStart = o.newThreads !== false;
  const canRename = o.rename !== false;
  const s = { ...THREAD_STRINGS, ...o.strings };
  const chatOpts = { autoScroll: false, ...o.chat, theme: o.theme };
  const report = o.onError || ((err) => console.error('[chat-thread]', err));
  let mode = THREAD_MODES.includes(o.mode) ? o.mode : 'conversation';
  let header = typeof o.header === 'function' ? o.header : null;
  const items = new Map();
  let active = null;
  let destroyed = false;

  el.classList.add('ct-threads', `ct-threads--${THEMES.includes(o.theme) ? o.theme : 'dark'}`);
  el.classList.toggle('ct-threads--hide-resolved', !o.showResolved);
  el.innerHTML = '<button type="button" class="ct-th-more" hidden></button><div class="ct-th-list"></div><div class="ct-th-new" hidden></div>';
  const more = el.querySelector('.ct-th-more');
  const list = el.querySelector('.ct-th-list');
  const fresh = el.querySelector('.ct-th-new');

  const when = (at) => {
    if (!at) return '';
    const time = formatTime(at, chatOpts);
    if (!time) return '';
    if (dayKey(at, chatOpts) === dayKey(new Date(), chatOpts)) return time;
    try {
      return `${new Intl.DateTimeFormat(chatOpts.locale, { timeZone: chatOpts.timeZone, day: '2-digit', month: '2-digit' }).format(new Date(at))} ${time}`;
    } catch {
      return time;
    }
  };
  const preview = (t) => {
    const m = (t.messages || [])[(t.messages || []).length - 1];
    if (!m) return '';
    const who = m.from === 'me' ? s.you : m.author || chatOpts.author || '';
    return `${who ? `${who}: ` : ''}${String(m.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`;
  };
  const drawHeader = (t) => (header || THREAD_HEADERS[mode])(t, { strings: s, mode, preview: preview(t), when, escapeHtml, headers: THREAD_HEADERS });

  function count() {
    const k = [...items.values()].filter((x) => x.t.status === 'resolved').length;
    more.hidden = !k;
    more.textContent = el.classList.contains('ct-threads--hide-resolved') ? fill(k === 1 ? s.showResolvedOne : s.showResolved, { count: k }) : s.hideResolved;
  }

  /** One message box: the active thread's; with none open, the one at the bottom (when threads can be started). */
  function activate(x) {
    if (x && (!x.open || !items.has(x.t.id))) x = null;
    if (!x) x = [...items.values()].filter((y) => y.open).pop() || null;
    active = x;
    for (const y of items.values()) y.el.classList.toggle('ct-th--active', y === x);
    fresh.hidden = !!x || !canStart;
  }

  function draw(x) {
    const t = x.t;
    const resolved = t.status === 'resolved';
    t.lastAt = (t.messages || [])[(t.messages || []).length - 1]?.at || t.at;
    x.el.className = `ct-th${resolved ? ' ct-th--resolved' : ''}${x.open ? ' ct-th--open' : ''}${active === x ? ' ct-th--active' : ''}`;
    x.el.dataset.tone = resolved ? 'ok' : t.tone || 'idle';
    x.toggle.innerHTML = drawHeader(t);
    x.toggle.setAttribute('aria-expanded', String(x.open));
    const act = (label, cls, icon) => `<button type="button" class="ct-th-ic ${cls}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}</button>`;
    x.acts.innerHTML = (canRename ? act(s.rename, 'ct-th-rename', ICONS.rename) : '') + (resolved ? act(s.reopen, 'ct-th-reopen', ICONS.reopen) : act(s.resolve, 'ct-th-resolve', ICONS.resolve)) + ICONS.chevron;
    const busy = !resolved && t.tone === 'busy';
    if (x.typing !== busy) {
      x.typing = busy;
      x.chat.setTyping(busy);
    }
    x.activity.textContent = busy && t.activity ? `${t.activity}…` : '';
    x.activity.hidden = !(busy && t.activity);
    if (canStart) branchButton(x.el, () => x.t);
    fold(x);
    count();
  }

  /** "Show N earlier" / "Show only the latest", with a light motion: the list unrolls upward with the latest kept at
   *  the bottom and the earlier ones rising in, or rolls back with them fading out. */
  function earlierToggle(x) {
    const l = x.el.querySelector('.ct-list');
    if (!l) return;
    const quiet = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    x.roll?.cancel();
    for (const n of l.querySelectorAll('.ct-th-in, .ct-th-out')) n.classList.remove('ct-th-in', 'ct-th-out');
    const end = () => { l.scrollTop = l.scrollHeight; };
    const from = l.offsetHeight;
    if (!x.all) {
      const shown = [...l.querySelectorAll('.ct-th-old')];
      x.all = true;
      fold(x);
      end();
      if (quiet || !l.animate) return;
      for (const n of shown) n.classList.add('ct-th-in');
      roll(x, l, from, l.offsetHeight, 280);
      return;
    }
    end();
    x.all = false;
    fold(x);
    const going = [...l.querySelectorAll('.ct-th-old')];
    const to = l.offsetHeight;
    if (quiet || !l.animate || !going.length) return end();
    for (const n of going) n.classList.add('ct-th-out');
    end();
    roll(x, l, l.offsetHeight, to, 240).then(() => { for (const n of going) n.classList.remove('ct-th-out'); end(); });
  }

  /** Animates the list's height, keeping its bottom (the latest messages) in place. */
  function roll(x, l, from, to, ms) {
    const run = l.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: ms, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    x.roll = run;
    let on = true;
    const stick = () => { if (!on) return; l.scrollTop = l.scrollHeight; requestAnimationFrame(stick); };
    requestAnimationFrame(stick);
    return run.finished.catch(() => {}).then(() => { on = false; if (x.roll === run) x.roll = null; });
  }

  /** A long thread shows only its latest messages, with "Show N earlier" above them. */
  function fold(x) {
    const l = x.el.querySelector('.ct-list');
    if (!l) return;
    const msgs = [...l.children].filter((n) => n.classList.contains('ct-msg') && !n.classList.contains('ct-typing'));
    const keep = Math.max(0, Number(o.latest) || 0);
    const hide = keep && !x.all ? Math.max(0, msgs.length - keep) : 0;
    const old = new Set(msgs.slice(0, hide));
    let nextOld = false;
    for (const n of [...l.children].reverse()) {
      if (n.classList.contains('ct-msg') && !n.classList.contains('ct-typing')) nextOld = old.has(n);
      else if (!n.classList.contains('ct-day')) continue;
      n.classList.toggle('ct-th-old', n.classList.contains('ct-day') ? nextOld : old.has(n));
    }
    let b = l.previousElementSibling?.classList.contains('ct-th-earlier') ? l.previousElementSibling : null;
    const label = hide ? fill(hide === 1 ? s.earlierOne : s.earlier, { count: hide }) : x.all && keep && msgs.length > keep ? s.latestOnly : '';
    if (!label) return b?.remove();
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'ct-th-earlier';
      l.before(b);
    }
    b.textContent = label;
  }

  /** Threads keep the order they were opened in: the oldest on top. */
  function place(x) {
    const at = String(x.t.at ?? '');
    // already in order: moving the node would take the focus (and a phone's keyboard) out of its box
    if (x.el.parentNode === list) {
      const atOf = (n) => { const y = n && [...items.values()].find((z) => z.el === n); return y ? String(y.t.at ?? '') : null; };
      const prev = atOf(x.el.previousElementSibling), next = atOf(x.el.nextElementSibling);
      if ((prev === null || prev <= at) && (next === null || next > at)) return;
    }
    const after = [...items.values()].find((y) => y !== x && String(y.t.at ?? '') > at);
    const ref = after ? after.el : null;
    const focused = x.el.contains(document.activeElement) ? document.activeElement : null;
    list.insertBefore(x.el, ref);
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  const bottom = (x) => {
    const l = x.el.querySelector('.ct-list');
    if (l) l.scrollTop = l.scrollHeight;
  };

  /** The Branch button right of Send (put back if a redraw took it away). */
  function branchButton(root, from) {
    const row = root.querySelector('.ct-composer .ct-row');
    if (!row || row.querySelector('.ct-th-branch')) return;
    const input = row.querySelector('.ct-input');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ct-th-branch';
    b.disabled = !input?.value.trim();
    b.setAttribute('aria-label', s.branch);
    b.title = `${s.branch} (Ctrl+Shift+Enter)`;
    b.innerHTML = ICONS.branch;
    row.appendChild(b);
    root.ctBranchFrom = from;
  }

  function branch(root) {
    const input = root.querySelector('.ct-composer .ct-input');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const b = root.querySelector('.ct-th-branch');
    if (b) b.disabled = true;
    start(text, root.ctBranchFrom ? root.ctBranchFrom() : null);
  }

  async function start(text, parent) {
    if (!canStart || typeof o.onNewThread !== 'function') return;
    try {
      const t = await o.onNewThread(text, parent ? parent.id : null);
      if (!t || destroyed) return;
      if (parent && !t.parent) t.parent = { id: parent.id, n: parent.n, title: threadTitle(parent, s) };
      const x = items.get(t.id) || add(t, true);
      x.open = true;
      activate(x);
      draw(x);
      x.el.scrollIntoView?.({ block: 'nearest' });
      x.el.querySelector('.ct-composer .ct-input')?.focus();
    } catch (err) {
      report(err);
    }
  }

  function rename(x) {
    const input = document.createElement('input');
    input.className = 'ct-th-rename-input';
    input.value = threadTitle(x.t, s);
    input.maxLength = 200;
    input.setAttribute('aria-label', s.rename);
    x.toggle.hidden = true;
    x.toggle.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      x.toggle.hidden = false;
      if (save && value && value !== threadTitle(x.t, s)) {
        api.rename(x.t.id, value, s.you);
        try { o.onRename?.(x.t.id, value); } catch (err) { report(err); }
      }
      x.toggle.focus();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function add(t, open = false) {
    const node = document.createElement('section');
    node.innerHTML = '<div class="ct-th-head"><button type="button" class="ct-th-toggle"></button><span class="ct-th-acts"></span></div><div class="ct-th-body"><div class="ct-th-chat"></div></div>';
    const x = {
      t: { ...t, messages: [...(t.messages || [])] },
      el: node,
      head: node.querySelector('.ct-th-head'),
      toggle: node.querySelector('.ct-th-toggle'),
      acts: node.querySelector('.ct-th-acts'),
      open: !!open,
      typing: false,
    };
    const body = node.querySelector('.ct-th-body');
    body.id = `ct-th-${String(t.id).replace(/[^\w-]/g, '_')}-${Math.random().toString(36).slice(2, 7)}`;
    x.toggle.setAttribute('aria-controls', body.id);
    x.chat = createChat(node.querySelector('.ct-th-chat'), {
      ...chatOpts,
      messages: x.t.messages,
      onSend: (text, info) => o.onSend?.(x.t.id, text, info),
      onChange: () => {
        if (!x.chat) return;
        x.t.messages = x.chat.messages;
        draw(x);
      },
    });
    x.activity = document.createElement('div');
    x.activity.className = 'ct-th-activity';
    x.activity.hidden = true;
    x.chat.composer?.before(x.activity);
    items.set(t.id, x);
    place(x);
    draw(x);
    if (x.open) requestAnimationFrame(() => bottom(x));
    return x;
  }

  el.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target.closest('.ct-th-more') === more) {
      el.classList.toggle('ct-threads--hide-resolved');
      count();
      return;
    }
    const earlier = target.closest('.ct-th-earlier');
    if (earlier) {
      const y = [...items.values()].find((z) => z.el.contains(earlier));
      if (y) earlierToggle(y);
      return;
    }
    const b = target.closest('.ct-th-branch');
    if (b) {
      branch(b.closest('.ct-th') || fresh);
      return;
    }
    const node = target.closest('.ct-th');
    if (!node || !el.contains(node)) return;
    const x = [...items.values()].find((y) => y.el === node);
    if (!x || !x.head.contains(target)) return;
    if (canRename && target.closest('.ct-th-rename')) return rename(x);
    if (target.closest('.ct-th-resolve')) {
      api.resolve(x.t.id);
      try { o.onResolve?.(x.t.id); } catch (err) { report(err); }
      return;
    }
    if (target.closest('.ct-th-reopen')) {
      api.reopen(x.t.id);
      try { o.onReopen?.(x.t.id); } catch (err) { report(err); }
      return;
    }
    if (target.closest('.ct-th-rename-input')) return;
    x.open = !x.open;
    activate(x.open ? x : active === x ? null : active);
    draw(x);
    if (x.open) bottom(x);
  });
  el.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('.ct-th-branch')) ev.preventDefault();
  });
  el.addEventListener('input', (ev) => {
    if (!ev.target.classList?.contains('ct-input')) return;
    const b = ev.target.closest('.ct-composer')?.querySelector('.ct-th-branch');
    if (b) b.disabled = !ev.target.value.trim();
  });
  // capture: before the box's own Enter, which would send it to this thread (with no new threads, the box keeps the key)
  el.addEventListener('keydown', (ev) => {
    if (!canStart || ev.key !== 'Enter' || !ev.shiftKey || !(ev.ctrlKey || ev.metaKey) || !ev.target.classList?.contains('ct-input')) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    branch(ev.target.closest('.ct-th') || fresh);
  }, true);
  el.addEventListener('focusin', (ev) => {
    const node = ev.target.closest('.ct-th');
    const x = node && [...items.values()].find((y) => y.el === node);
    if (x && x.open && active !== x) {
      activate(x);
    }
  });

  for (const t of o.threads || []) add(t, t.open ?? (t.status !== 'resolved' && t.tone !== 'idle'));

  // with no thread open: this box starts one (the text goes to the new thread, not here); none when threads cannot start
  const freshChat = canStart && createChat(fresh, {
    ...chatOpts,
    strings: { ...chatOpts.strings, placeholder: s.newThread },
    attach: [],   // a photo goes to a thread that exists: onNewThread takes text only
    onSend: (text) => {
      setTimeout(() => {
        freshChat.update({ messages: [] });
        start(text, null);
      }, 0);
    },
  });
  activate(active);

  const need = (id) => {
    const x = items.get(id);
    if (!x) throw new Error(`createThreads: no thread ${id}`);
    return x;
  };

  const api = {
    get el() { return el; },
    get active() { return active ? active.t.id : null; },
    threads() { return [...items.values()].map((x) => ({ ...x.t, messages: [...x.chat.messages] })); },
    get(id) { const x = items.get(id); return x ? { ...x.t, messages: [...x.chat.messages] } : null; },
    chat(id) { return items.get(id)?.chat ?? null; },
    /** Adds a thread, or changes the fields given of one already there (its messages: `update`). */
    upsert(patch) {
      const x = items.get(patch.id);
      if (!x) {
        const y = add(patch, patch.open ?? (patch.status !== 'resolved' && patch.tone !== 'idle'));
        // the first thread open gets the box (threads added after createThreads, as a page that fetches them does)
        if (y.open && !active) activate(y);
        return undefined;
      }
      const { messages, ...rest } = patch;
      Object.assign(x.t, rest);
      if (messages) {
        const atEnd = near(x.el.querySelector('.ct-list'));
        x.chat.update({ messages });
        x.t.messages = x.chat.messages;
        if (atEnd) bottom(x);
      }
      if ('at' in rest) place(x);
      draw(x);
    },
    remove(id) {
      const x = items.get(id);
      if (!x) return;
      x.chat.destroy();
      x.el.remove();
      items.delete(id);
      if (active === x) activate(null);
      count();
    },
    rename(id, title, by = s.you, ai = false) { api.upsert({ id: need(id).t.id, title, titleBy: by, titleByAI: !!ai }); },
    resolve(id, by = null) {
      const x = need(id);
      x.open = false;
      api.upsert({ id, status: 'resolved', resolvedBy: by, resolvedAt: new Date().toISOString(), tone: 'ok' });
      if (active === x) activate(null);
      draw(x);
    },
    reopen(id) { need(id); api.upsert({ id, status: 'open', resolvedBy: null, resolvedAt: null, tone: 'wait', label: '' }); },
    open(id) {
      const x = need(id);
      x.open = true;
      activate(x);
      draw(x);
      bottom(x);
    },
    close(id) {
      const x = need(id);
      x.open = false;
      if (active === x) activate(null);
      draw(x);
    },
    /** A message at the end of a thread; the list follows it when the reader was at the bottom. */
    append(id, message) {
      const x = need(id);
      const atEnd = near(x.el.querySelector('.ct-list'));
      x.chat.append(message);
      x.t.messages = x.chat.messages;
      draw(x);
      if (atEnd && x.open) bottom(x);
    },
    updateMessage(id, messageId, patch) {
      const x = need(id);
      x.chat.updateMessage(messageId, patch);
      x.t.messages = x.chat.messages;
      draw(x);
    },
    setMode(next) {
      if (!THREAD_MODES.includes(next)) return;
      mode = next;
      for (const x of items.values()) draw(x);
    },
    setHeader(fn) {
      header = typeof fn === 'function' ? fn : null;
      for (const x of items.values()) draw(x);
    },
    destroy() {
      destroyed = true;
      for (const x of items.values()) x.chat.destroy();
      if (freshChat) freshChat.destroy();
      items.clear();
      el.innerHTML = '';
      el.classList.remove('ct-threads', 'ct-threads--hide-resolved', ...THEMES.map((t) => `ct-threads--${t}`));
    },
  };
  return api;
}

export { createChat, restStore, memoryStore, localStore, LIMITS, STATES, FORMATS, MODES, KINDS, DEFAULT_STRINGS, ATTACH, DEFAULTS, resolveOptions, safeUrl, escapeHtml, linkify, renderMarkdown, renderWhatsApp, renderPlain, formatText, normalizeAt, dayKey, formatTime, dayLabel, normalizeMessage, normalizeChips, normalizeToggles, normalizeAttach, isLong, authorTone, fill, renderMessage, renderDay, renderTyping, renderWaiting, renderList, renderComposer, renderThread, THREAD_STRINGS, THREAD_MODES, threadTitle, THREAD_HEADERS, createThreads };
export default createChat;

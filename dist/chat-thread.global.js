/*! chat-thread v0.2.0 | MIT | https://github.com/rbritta/chat-thread */
(function (global) {
'use strict';
/**
 * Pure helpers for chat-thread: text formats, times and the HTML of a thread as a string.
 * No DOM and no I/O, so a server renders the exact markup the browser does, and every
 * rule here is covered by plain `node --test`.
 *
 *   import { renderThread } from 'chat-thread/core';
 *   res.end(renderThread(messages, { author: 'Assistant', timeZone: 'America/Sao_Paulo' }));
 */

const LIMITS = Object.freeze({ text: 20000, author: 80, title: 200, tag: 120, url: 2048, id: 120, chip: 400, chips: 12, toggles: 8 });
const STATES = Object.freeze(['pending', 'queued', 'sent', 'delivered', 'read']);
const FORMATS = Object.freeze(['markdown', 'whatsapp', 'plain']);
const MODES = Object.freeze(['chat', 'readonly', 'preview']);
/** `bubble` is a message in a bubble; `note` is the other side narrating, full width, with no bubble. */
const KINDS = Object.freeze(['bubble', 'note']);

/** Every visible word. Pass `strings` to translate: `{ placeholder: 'Mensagem', send: 'Enviar' }`. */
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
  suggestions: 'Suggestions',
});

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
  chips: Object.freeze([]),
  toggles: Object.freeze([]),
  locale: undefined,
  timeZone: undefined,
  hour12: false,
});

const RESOLVED = Symbol('chat-thread options');
const NUL = '\u0000';
const text = (v, max) => (v === null || v === undefined ? '' : String(v).slice(0, max));

/**
 * The options with every default filled in and bad values replaced: `mode` falls back to
 * `chat`, an unknown `format` to `auto`, `days` follows the mode (no day separators in a preview).
 */
function resolveOptions(options = {}) {
  if (options && options[RESOLVED]) return options;
  const given = options || {};
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(given)) if (v !== undefined) o[k] = v;
  o.strings = { ...DEFAULT_STRINGS, ...(given.strings || {}) };
  if (!MODES.includes(o.mode)) o.mode = 'chat';
  if (typeof o.theme !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(o.theme)) o.theme = 'dark';
  if (o.format !== 'auto' && !FORMATS.includes(o.format)) o.format = 'auto';
  o.clamp = Number.isFinite(Number(o.clamp)) ? Math.max(0, Number(o.clamp)) : DEFAULTS.clamp;
  if (o.days === null) o.days = o.mode !== 'preview';
  o.author = text(o.author, LIMITS.author).trim();
  o.chips = normalizeChips(o.chips);
  o.toggles = normalizeToggles(o.toggles);
  if (!STATES.includes(o.sendState)) o.sendState = null;
  o.now = typeof given.now === 'function' ? given.now : () => new Date();
  o[RESOLVED] = true;
  return o;
}

/** Only http(s), relative (`/x`, `./x`, `../x`) and in-page links: never `javascript:` or `data:`. */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return /\s/.test(url) ? null : url;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
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

function markdownEmphasis(s) {
  return s
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^\n*]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^\n_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '<del>$1</del>');
}

/** One line of markdown: `code`, [links](url), bare URLs, **bold**, *italic*, ~~strike~~. */
function markdownInline(line) {
  const { keep, restore } = stasher();
  let s = line.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g, (whole, label, url) => {
    const href = safeUrl(url);
    return href ? keep(anchor(href, markdownEmphasis(escapeHtml(label)))) : whole;
  });
  s = s.replace(URL_RE, (url) => (safeUrl(url) ? keep(anchor(url, escapeHtml(url))) : url));
  return restore(markdownEmphasis(escapeHtml(s)));
}

function codeBlock(code, lang, { copy, strings }) {
  const data = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
  const button = copy ? `<button type="button" class="ct-copy">${escapeHtml(strings.copy)}</button>` : '';
  return `<div class="ct-code"><pre><code${data}>${escapeHtml(code)}</code></pre>${button}</div>`;
}

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
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]{0,30})\s*$/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body = [];
      while (++i < lines.length && !new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i]);
      out.push(codeBlock(body.join('\n'), fence[2], { copy, strings }));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
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
  s = s.replace(URL_RE, (url) => (safeUrl(url) ? keep(anchor(url, escapeHtml(url))) : url));
  s = escapeHtml(s);
  for (const [re, tag] of WHATSAPP_MARKS) s = s.replace(re, `$1<${tag}>$2</${tag}>`);
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
function formatter(locale, opts) {
  const key = JSON.stringify([locale ?? null, opts]);
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, opts);
    } catch {
      const { timeZone: _ignored, ...rest } = opts;
      f = new Intl.DateTimeFormat(undefined, rest);
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

/** The time shown inside a bubble: `17:50`, or `5:50 PM` with `hour12`. */
function formatTime(at, { locale, timeZone, hour12 = false } = {}) {
  const d = toDate(at);
  if (!d) return '';
  const opts = hour12 ? { timeZone, hour: 'numeric', minute: '2-digit', hour12: true } : { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return formatter(locale, opts).format(d);
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
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
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
  else if (m.id !== null && m.id !== undefined && m.id !== '') id = String(m.id).slice(0, LIMITS.id);
  return {
    id,
    from: m.from === 'me' ? 'me' : 'other',
    kind: KINDS.includes(m.kind) ? m.kind : 'bubble',
    author: text(m.author, LIMITS.author).trim(),
    text: text(m.text, LIMITS.text),
    at: normalizeAt(m.at),
    state: STATES.includes(m.state) ? m.state : null,
    alert: m.alert === true,
    tag: text(m.tag, LIMITS.tag).trim(),
    title: text(m.title, LIMITS.title).trim(),
    format: FORMATS.includes(m.format) ? m.format : null,
    meta: m.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta : null,
  };
}

/** Suggestion chips: strings or `{ label, text?, fill? }`. `fill` puts the text in the box instead of sending it. */
function normalizeChips(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (typeof c === 'string' ? { label: c } : c && typeof c === 'object' ? c : {}))
    .map((c) => ({ label: text(c.label, LIMITS.chip).trim(), text: text(c.text ?? c.label, LIMITS.chip).trim(), fill: c.fill === true }))
    .filter((c) => c.label && c.text)
    .slice(0, LIMITS.chips);
}

/** Checkboxes under the box: `{ name, label, checked? }`. Their values go with every message sent. */
function normalizeToggles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object' && /^[\w-]{1,40}$/.test(t.name || ''))
    .map((t) => ({ name: t.name, label: text(t.label, LIMITS.chip).trim() || t.name, checked: t.checked === true }))
    .slice(0, LIMITS.toggles);
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
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z"/></svg>';

/** Ticks of my message: clock while pending or queued, one tick sent, two delivered, two in color read. */
function ticks(state, strings) {
  if (state === 'pending' || state === 'queued') return icon(' ct-tick--clock', strings[state === 'queued' ? 'queued' : 'pending'], '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>');
  if (state === 'sent') return icon('', strings.sent, '<path d="M5 13l4 4 10-11"/>');
  if (state === 'delivered') return icon('', strings.delivered, `<path d="${TICK_PATH}"/>`);
  return icon(' ct-tick--read', strings.read, `<path d="${TICK_PATH}"/>`);
}

const intoLast = (html, extra) => (html.endsWith('</p>') ? `${html.slice(0, -4)}${extra}</p>` : null);
const intoFirst = (html, extra) => (/^<p[^>]*>/.test(html) ? html.replace(/^<p[^>]*>/, (open) => open + extra) : `${extra}${html}`);

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
  const author = name ? `<span class="ct-author${o.colorAuthors ? ` ct-author--${authorTone(name)}` : ''}">${escapeHtml(name)}</span>` : '';
  const title = m.title ? `<p class="ct-title">${escapeHtml(m.title)}</p>` : '';

  let body = formatText(m.text, format, { copy: o.copy, strings: s });
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
  return `<div class="${classes.join(' ')}"${id}${day}>${author}${title}${inner}</div>`;
}

/** The day separator before the first message of each day. */
function renderDay(key, options) {
  const o = resolveOptions(options);
  return `<div class="ct-day" data-day="${escapeHtml(key)}">${escapeHtml(dayLabel(key, { now: o.now(), locale: o.locale, timeZone: o.timeZone, strings: o.strings }))}</div>`;
}

/** Three bouncing dots on the other side. `author` is shown above them when given. */
function renderTyping(author, options) {
  const o = resolveOptions(options);
  const name = text(author === true ? o.author : author, LIMITS.author).trim();
  const label = name ? fill(o.strings.typing, { author: name }) : o.strings.typingNoAuthor;
  const tag = name ? `<span class="ct-author${o.colorAuthors ? ` ct-author--${authorTone(name)}` : ''}">${escapeHtml(name)}</span>` : '';
  return `<div class="ct-msg ct-msg--theirs ct-typing" role="status" aria-label="${escapeHtml(label)}">${tag}<span class="ct-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

/** "Assistant has not replied yet…", in muted italics on the other side. */
function renderWaiting(author, options) {
  const o = resolveOptions(options);
  const name = text(author === true ? o.author : author, LIMITS.author).trim();
  return `<div class="ct-waiting" role="status">${escapeHtml(name ? fill(o.strings.waiting, { author: name }) : o.strings.waitingNoAuthor)}</div>`;
}

/**
 * The inside of `.ct-list`: day separators, bubbles, then the typing and waiting lines.
 * `state` is `{ typing, waiting }`, each `false`, `true` (the thread's `author`) or a name.
 */
function renderList(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const parts = [];
  let last = '';
  for (const raw of Array.isArray(messages) ? messages : []) {
    const m = normalizeMessage(raw);
    const key = o.days && m.at ? dayKey(m.at, o) : '';
    if (key && key !== last) {
      parts.push(renderDay(key, o));
      last = key;
    }
    parts.push(renderMessage(m, o));
  }
  if (state.typing) parts.push(renderTyping(state.typing, o));
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
  return `<div class="ct-composer">${chips}<div class="ct-row"><div class="ct-field"><textarea class="ct-input" rows="1" maxlength="${LIMITS.text}" placeholder="${escapeHtml(s.placeholder)}" aria-label="${escapeHtml(s.placeholder)}"></textarea></div><button type="button" class="ct-send" disabled aria-label="${escapeHtml(s.send)}" title="${escapeHtml(s.send)}">${SEND_ICON}</button></div>${toggles}</div>`;
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
  return `<div class="${classes.join(' ')}" data-mode="${o.mode}"><div class="ct-list" role="log" aria-label="${escapeHtml(o.strings.thread)}">${renderList(messages, o, state)}</div>${o.mode === 'chat' ? renderComposer(o) : ''}</div>`;
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
 * script only hydrates it (`hydrate: true`).
 */


let sequence = 0;

const reportError = (err) => console.error('[chat-thread]', err);

function fragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

/**
 * Draws a thread in `el` (or hydrates the one a server rendered there) and returns its
 * controller. Options are the ones in `DEFAULTS` plus `messages`, `store`, `strings`,
 * `typing`, `waiting`, `onSend`, `onRemove`, `onChange`, `onError`, `now` and `hydrate`.
 */
function createChat(el, options = {}) {
  if (!el) throw new Error('createChat needs an element');
  let given = { ...options };
  let opts = resolveOptions(given);
  let messages = (given.messages || []).map(normalizeMessage);
  let typing = given.typing || false;
  let waiting = given.waiting || false;
  let root = null;
  let list = null;
  let input = null;
  let sendButton = null;
  const timers = new Set();

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };
  const fail = (err) => {
    (given.onError || reportError)(err);
    root?.dispatchEvent(new CustomEvent('chat-error', { detail: err, bubbles: true }));
  };
  const emit = (event) => {
    try { given.onChange?.(event); } catch (err) { fail(err); }
  };

  function mount(hydrate) {
    if (hydrate) {
      root = el.classList.contains('ct') ? el : el.querySelector('.ct');
      if (!root) throw new Error('createChat: nothing to hydrate; render the thread with renderThread() first');
    } else {
      el.replaceChildren(fragment(renderThread(messages, opts, { typing, waiting })));
      root = el.firstElementChild;
    }
    list = root.querySelector('.ct-list');
    input = root.querySelector('.ct-input');
    sendButton = root.querySelector('.ct-send');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('input', onInput);
    settle(root);
    grow();
  }

  function unmount() {
    if (!root) return;
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
    root.removeEventListener('input', onInput);
  }

  /** Long messages start collapsed; the ones that fit after all lose the "Read more". */
  function settle(scope) {
    for (const body of scope.querySelectorAll('.ct-body--clamped')) {
      if (!body.clientHeight || body.scrollHeight > body.clientHeight + 2) continue;
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
    input.style.height = 'auto';
    const line = parseFloat(getComputedStyle(input).lineHeight) || 21;
    const max = line * 6;
    input.style.height = `${Math.min(input.scrollHeight, max)}px`;
    input.style.overflowY = input.scrollHeight > max + 1 ? 'auto' : 'hidden';
    if (sendButton) sendButton.disabled = !input.value.trim();
  }

  function drawList() {
    list.replaceChildren(fragment(renderList(messages, opts, { typing, waiting })));
    settle(list);
  }

  function drawIndicators() {
    for (const node of list.querySelectorAll(':scope > .ct-typing, :scope > .ct-waiting')) node.remove();
    let html = '';
    if (typing) html += renderTyping(typing, opts);
    if (waiting) html += renderWaiting(waiting, opts);
    if (html) list.append(fragment(html));
  }

  function lastDay() {
    const days = list.querySelectorAll(':scope > [data-day]');
    return days.length ? days[days.length - 1].dataset.day : '';
  }

  /** Adds one bubble at the end (before the typing and waiting lines) and returns its node. */
  function insert(message, scroll = true) {
    const html = [];
    const key = opts.days && message.at ? dayKey(message.at, opts) : '';
    if (key && key !== lastDay()) html.push(renderDay(key, opts));
    html.push(renderMessage(message, opts));
    const frag = fragment(html.join(''));
    const node = frag.lastElementChild;
    list.insertBefore(frag, list.querySelector(':scope > .ct-typing, :scope > .ct-waiting'));
    settle(node);
    if (scroll && opts.autoScroll) node.scrollIntoView?.({ block: 'nearest' });
    return node;
  }

  const nodeOf = (id) => [...list.querySelectorAll(':scope > .ct-msg[data-id]')].find((n) => n.dataset.id === String(id)) || null;

  function redraw(id, message) {
    const node = nodeOf(id);
    if (!node) return null;
    const frag = fragment(renderMessage(message, opts));
    const fresh = frag.firstElementChild;
    node.replaceWith(frag);
    settle(fresh);
    return fresh;
  }

  /** Removes day separators left without messages. */
  function pruneDays() {
    for (const day of list.querySelectorAll(':scope > .ct-day')) {
      const next = day.nextElementSibling;
      if (!next || next.classList.contains('ct-day') || next.classList.contains('ct-typing') || next.classList.contains('ct-waiting')) day.remove();
    }
  }

  function readToggles() {
    const values = {};
    for (const box of root.querySelectorAll('.ct-toggles input[type=checkbox][name]')) values[box.name] = box.checked;
    return values;
  }

  async function send(raw) {
    const fromBox = raw === undefined;
    const value = String(fromBox ? input?.value ?? '' : raw).replace(/\s+$/, '').replace(/^\n+/, '');
    if (!value.trim() || opts.mode !== 'chat') return null;
    const toggles = readToggles();
    const draft = { from: 'me', text: value, at: opts.now().toISOString() };
    if (opts.sendState) draft.state = opts.sendState;
    if (Object.keys(toggles).length) draft.meta = { toggles };
    if (fromBox) {
      input.value = '';
      grow();
    }
    const temp = normalizeMessage({ ...draft, id: `tmp-${++sequence}`, state: 'pending' });
    messages.push(temp);
    insert(temp);
    let saved = null;
    try {
      if (opts.store) saved = await opts.store.send(draft);
      const answer = await given.onSend?.(value, { toggles, message: saved || draft, chat: api });
      if (!saved && answer && typeof answer === 'object') saved = answer;
    } catch (err) {
      const failed = normalizeMessage({ ...temp, alert: true });
      if (messages.includes(temp)) messages[messages.indexOf(temp)] = failed;
      redraw(temp.id, failed);
      fail(err);
      return null;
    }
    const final = normalizeMessage({ ...draft, ...(saved || {}), id: saved?.id ?? temp.id.replace('tmp-', 'local-') });
    const index = messages.indexOf(temp);
    if (index >= 0) messages[index] = final;
    redraw(temp.id, final);
    emit({ type: 'send', message: final, toggles });
    return final;
  }

  async function remove(node) {
    const id = node?.dataset.id;
    if (id === undefined) return;
    const index = messages.findIndex((m) => String(m.id) === id);
    const message = index >= 0 ? messages[index] : { id };
    try {
      if (opts.store?.remove) await opts.store.remove(message.id);
      await given.onRemove?.(message);
    } catch (err) {
      fail(err);
      return;
    }
    if (index >= 0) messages.splice(messages.indexOf(message), 1);
    node.remove();
    pruneDays();
    emit({ type: 'remove', message });
  }

  function toggleMore(button) {
    const body = button.previousElementSibling;
    const open = body.classList.toggle('ct-body--clamped') === false;
    button.textContent = open ? opts.strings.less : opts.strings.more;
    button.setAttribute('aria-expanded', String(open));
  }

  async function copy(button) {
    const code = button.parentElement.querySelector('code');
    const value = code?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = opts.strings.copied;
      later(() => { button.textContent = opts.strings.copy; }, 1200);
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
    if (!button || !root.contains(button)) return;
    if (button.classList.contains('ct-send')) send();
    else if (button.classList.contains('ct-more')) toggleMore(button);
    else if (button.classList.contains('ct-copy')) copy(button);
    else if (button.classList.contains('ct-remove')) remove(button.closest('.ct-msg'));
    else if (button.classList.contains('ct-chip')) {
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

  function onKeydown(ev) {
    if (ev.target !== input || ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return;
    if (!opts.enterSends) return;
    ev.preventDefault();
    send();
  }

  function onInput(ev) {
    if (ev.target === input) grow();
  }

  const api = {
    /** Adds a message at the end. A message from the other side clears typing and waiting. */
    append(message) {
      const m = normalizeMessage(message);
      if (m.id === null) m.id = `local-${++sequence}`;
      messages.push(m);
      if (m.from !== 'me' && (typing || waiting)) {
        typing = false;
        waiting = false;
        drawIndicators();
      }
      insert(m);
      emit({ type: 'append', message: m });
      return m;
    },
    /** Changes one message in place, e.g. `{ state: 'read' }` or a streamed `{ text }`. */
    updateMessage(id, patch = {}) {
      const index = messages.findIndex((m) => String(m.id) === String(id));
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
    /** Sends a text as if it had been typed in the box. */
    send: (value) => send(value),
    /** New options; the text being typed is kept. */
    configure(next = {}) {
      const draft = input?.value ?? '';
      given = { ...given, ...next };
      opts = resolveOptions(given);
      if (next.messages) messages = next.messages.map(normalizeMessage);
      unmount();
      mount(false);
      if (input && draft) {
        input.value = draft;
        grow();
      }
    },
    focus() { input?.focus(); },
    get messages() { return messages.map((m) => ({ ...m })); },
    get el() { return root; },
    get composer() { return root.querySelector('.ct-composer'); },
    destroy() {
      unmount();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      el.replaceChildren();
    },
  };

  mount(given.hydrate === true);
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
  const find = (data, id) => data.messages.findIndex((m) => String(m.id) === String(id));
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


global.ChatThread = { createChat, restStore, memoryStore, localStore, LIMITS, STATES, FORMATS, MODES, KINDS, DEFAULT_STRINGS, DEFAULTS, resolveOptions, safeUrl, escapeHtml, linkify, renderMarkdown, renderWhatsApp, renderPlain, formatText, normalizeAt, dayKey, formatTime, dayLabel, normalizeMessage, normalizeChips, normalizeToggles, isLong, authorTone, fill, renderMessage, renderDay, renderTyping, renderWaiting, renderList, renderComposer, renderThread };
})(typeof globalThis !== 'undefined' ? globalThis : window);

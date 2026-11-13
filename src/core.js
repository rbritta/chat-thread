/**
 * Pure helpers for chat-thread: text formats, times and the HTML of a thread as a string.
 * No DOM and no I/O, so a server renders the exact markup the browser does, and every
 * rule here is covered by plain `node --test`.
 *
 *   import { renderThread } from 'chat-thread/core';
 *   res.end(renderThread(messages, { author: 'Assistant', timeZone: 'America/Sao_Paulo' }));
 */

export const LIMITS = Object.freeze({ text: 20000, author: 80, title: 200, tag: 120, url: 2048, id: 120, chip: 400, chips: 12, toggles: 8 });
export const STATES = Object.freeze(['pending', 'queued', 'sent', 'delivered', 'read']);
export const FORMATS = Object.freeze(['markdown', 'whatsapp', 'plain']);
export const MODES = Object.freeze(['chat', 'readonly', 'preview']);

/** Every visible word. Pass `strings` to translate: `{ placeholder: 'Mensagem', send: 'Enviar' }`. */
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
  suggestions: 'Suggestions',
});

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
export function resolveOptions(options = {}) {
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
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > LIMITS.url) return null;
  if (/^(\/(?!\/)|\.{1,2}\/|#|\?)/.test(url)) return /\s/.test(url) ? null : url;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
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
export function renderMarkdown(value, { copy = true, strings = DEFAULT_STRINGS } = {}) {
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
export function renderWhatsApp(value) {
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
export function renderPlain(value) {
  const s = clean(value);
  return s ? `<p class="ct-plain">${linkify(s)}</p>` : '';
}

/** The body HTML of a text in one of `FORMATS`. */
export function formatText(value, format = 'plain', { copy = true, strings = DEFAULT_STRINGS } = {}) {
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
export const normalizeAt = (at) => toDate(at)?.toISOString() ?? null;

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
export function dayKey(at, { timeZone } = {}) {
  const d = toDate(at);
  if (!d) return '';
  const parts = formatter('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The time shown inside a bubble: `17:50`, or `5:50 PM` with `hour12`. */
export function formatTime(at, { locale, timeZone, hour12 = false } = {}) {
  const d = toDate(at);
  if (!d) return '';
  const opts = hour12 ? { timeZone, hour: 'numeric', minute: '2-digit', hour12: true } : { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return formatter(locale, opts).format(d);
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
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

/**
 * A message as the thread and the stores keep it. `from` is `me` (right side) or `other`
 * (left side, with its `author`). Bad fields fall back instead of throwing.
 */
export function normalizeMessage(input) {
  const m = input && typeof input === 'object' ? input : {};
  let id = null;
  if (typeof m.id === 'number' && Number.isFinite(m.id)) id = m.id;
  else if (m.id !== null && m.id !== undefined && m.id !== '') id = String(m.id).slice(0, LIMITS.id);
  return {
    id,
    from: m.from === 'me' ? 'me' : 'other',
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
export function normalizeChips(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (typeof c === 'string' ? { label: c } : c && typeof c === 'object' ? c : {}))
    .map((c) => ({ label: text(c.label, LIMITS.chip).trim(), text: text(c.text ?? c.label, LIMITS.chip).trim(), fill: c.fill === true }))
    .filter((c) => c.label && c.text)
    .slice(0, LIMITS.chips);
}

/** Checkboxes under the box: `{ name, label, checked? }`. Their values go with every message sent. */
export function normalizeToggles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object' && /^[\w-]{1,40}$/.test(t.name || ''))
    .map((t) => ({ name: t.name, label: text(t.label, LIMITS.chip).trim() || t.name, checked: t.checked === true }))
    .slice(0, LIMITS.toggles);
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

/** One bubble. `options` are the thread's (see `DEFAULTS`). */
export function renderMessage(input, options) {
  const o = resolveOptions(options);
  const s = o.strings;
  const m = normalizeMessage(input);
  const mine = m.from === 'me';
  const format = m.format || (o.format === 'auto' ? (mine ? 'plain' : 'markdown') : o.format);
  const classes = ['ct-msg', mine ? 'ct-msg--mine' : 'ct-msg--theirs'];
  if (m.state === 'queued') classes.push('ct-msg--queued');
  if (m.alert) classes.push('ct-msg--alert');

  const name = mine ? '' : m.author || o.author;
  const author = name ? `<span class="ct-author${o.colorAuthors ? ` ct-author--${authorTone(name)}` : ''}">${escapeHtml(name)}</span>` : '';
  const title = m.title ? `<p class="ct-title">${escapeHtml(m.title)}</p>` : '';

  let body = formatText(m.text, format, { copy: o.copy, strings: s });
  const tag = m.tag || (m.state === 'queued' ? s.queued : '');
  if (tag) body = intoFirst(body, `<span class="ct-tag">${escapeHtml(tag)}</span>`);

  const time = m.at ? `<time datetime="${m.at}">${escapeHtml(formatTime(m.at, o))}</time>` : '';
  const removable = mine && m.state === 'queued' && o.mode === 'chat' && m.id !== null;
  const metaInner = `${time}${mine && o.ticks ? ticks(m.state, s) : ''}${removable ? `<button type="button" class="ct-remove" aria-label="${escapeHtml(s.remove)}" title="${escapeHtml(s.remove)}">×</button>` : ''}`;
  const meta = metaInner ? `<span class="ct-meta">${metaInner}</span>` : '';

  let inner;
  if (isLong(m.text, o.clamp)) {
    inner = `<div class="ct-body ct-body--clamped">${body}</div><button type="button" class="ct-more" aria-expanded="false">${escapeHtml(s.more)}</button>${meta}`;
  } else {
    const joined = intoLast(body, meta);
    inner = joined === null ? `<div class="ct-body">${body}</div>${meta}` : `<div class="ct-body">${joined}</div>`;
  }
  const id = m.id !== null ? ` data-id="${escapeHtml(String(m.id))}"` : '';
  const day = m.at ? ` data-day="${dayKey(m.at, o)}"` : '';
  return `<div class="${classes.join(' ')}"${id}${day}>${author}${title}${inner}</div>`;
}

/** The day separator before the first message of each day. */
export function renderDay(key, options) {
  const o = resolveOptions(options);
  return `<div class="ct-day" data-day="${escapeHtml(key)}">${escapeHtml(dayLabel(key, { now: o.now(), locale: o.locale, timeZone: o.timeZone, strings: o.strings }))}</div>`;
}

/** Three bouncing dots on the other side. `author` is shown above them when given. */
export function renderTyping(author, options) {
  const o = resolveOptions(options);
  const name = text(author === true ? o.author : author, LIMITS.author).trim();
  const label = name ? fill(o.strings.typing, { author: name }) : o.strings.typingNoAuthor;
  const tag = name ? `<span class="ct-author${o.colorAuthors ? ` ct-author--${authorTone(name)}` : ''}">${escapeHtml(name)}</span>` : '';
  return `<div class="ct-msg ct-msg--theirs ct-typing" role="status" aria-label="${escapeHtml(label)}">${tag}<span class="ct-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

/** "Assistant has not replied yet…", in muted italics on the other side. */
export function renderWaiting(author, options) {
  const o = resolveOptions(options);
  const name = text(author === true ? o.author : author, LIMITS.author).trim();
  return `<div class="ct-waiting" role="status">${escapeHtml(name ? fill(o.strings.waiting, { author: name }) : o.strings.waitingNoAuthor)}</div>`;
}

/**
 * The inside of `.ct-list`: day separators, bubbles, then the typing and waiting lines.
 * `state` is `{ typing, waiting }`, each `false`, `true` (the thread's `author`) or a name.
 */
export function renderList(messages = [], options = {}, state = {}) {
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
  return `<div class="ct-composer">${chips}<div class="ct-row"><div class="ct-field"><textarea class="ct-input" rows="1" maxlength="${LIMITS.text}" placeholder="${escapeHtml(s.placeholder)}" aria-label="${escapeHtml(s.placeholder)}"></textarea></div><button type="button" class="ct-send" disabled aria-label="${escapeHtml(s.send)}" title="${escapeHtml(s.send)}">${SEND_ICON}</button></div>${toggles}</div>`;
}

/**
 * A whole thread as an HTML string: what a server sends, and what `createChat` draws.
 * Modes: `chat` (with the box), `readonly` (no box) and `preview` (no box, no day separators).
 */
export function renderThread(messages = [], options = {}, state = {}) {
  const o = resolveOptions(options);
  const classes = ['ct'];
  if (o.theme !== 'dark') classes.push(`ct--${o.theme}`);
  if (o.mode !== 'chat') classes.push(`ct--${o.mode}`);
  return `<div class="${classes.join(' ')}" data-mode="${o.mode}"><div class="ct-list" role="log" aria-label="${escapeHtml(o.strings.thread)}">${renderList(messages, o, state)}</div>${o.mode === 'chat' ? renderComposer(o) : ''}</div>`;
}

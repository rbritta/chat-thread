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
import { authorTone, dayKey, escapeHtml, fill, formatTime } from './core.js';
import { createChat } from './chat-thread.js';

export const THREAD_STRINGS = Object.freeze({
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

export const THREAD_MODES = Object.freeze(['conversation', 'questions']);

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
export function threadTitle(thread, strings = THREAD_STRINGS) {
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

export const THREAD_HEADERS = Object.freeze({ conversation: conversationHeader, questions: questionsHeader });

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
export function createThreads(el, options = {}) {
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

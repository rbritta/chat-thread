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
import {
  dayKey, normalizeMessage, renderDay, renderList, renderMessage, renderThread, renderTyping,
  renderWaiting, resolveOptions,
} from './core.js';

export * from './core.js';

let sequence = 0;

const reportError = (err) => console.error('[chat-thread]', err);
const sameId = (a, b) => String(a) === String(b);

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
export function createChat(el, options = {}) {
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
    ['compositionstart', onComposition], ['compositionend', onComposition],
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
    for (const [type, fn] of listeners) root.removeEventListener(type, fn);
  }

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

  async function send(raw) {
    const fromBox = raw === undefined;
    const value = String(fromBox ? input?.value ?? '' : raw).replace(/\s+$/, '').replace(/^\n+/, '');
    if (!value.trim() || opts.mode !== 'chat') return null;
    const toggles = readToggles();
    const draft = { from: 'me', text: value, at: opts.now().toISOString() };
    if (opts.sendState) draft.state = opts.sendState;
    if (Object.keys(toggles).length) draft.meta = { toggles };
    // the box empties before anything is awaited, so a second Enter finds nothing to send
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
      settleDraft(temp, { ...temp, state: 'failed', alert: true });
      fail(err);
      return null;
    }
    const final = settleDraft(temp, { ...draft, ...(saved || {}), id: saved?.id ?? temp.id.replace('tmp-', 'local-') });
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
    if (!button || !root.contains(button)) return;
    const is = (cls) => button.classList.contains(cls);
    if (is('ct-send')) {
      send();
      // pressed from the keyboard, the button is now disabled: the focus goes back to the box
      input?.focus();
    } else if (is('ct-more')) setOpen(button, button.getAttribute('aria-expanded') !== 'true');
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
    if (ev.target !== input || ev.key !== 'Enter' || ev.shiftKey) return;
    if (composing || ev.isComposing || ev.keyCode === 229) return;
    // with enterSends off, Ctrl+Enter (Cmd+Enter on a Mac) still sends
    if (!opts.enterSends && !ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    send();
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
    /** Sends a text as if it had been typed in the box. */
    send: (value) => send(value),
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
export function restStore(url, { headers = {}, fetch: doFetch = (...args) => globalThis.fetch(...args) } = {}) {
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
export function memoryStore(messages = []) {
  let data = seed(messages);
  const clone = (d) => ({ next: d.next, messages: d.messages.map((m) => ({ ...m })) });
  return listStore(() => clone(data), (d) => { data = clone(d); });
}

/** A store in localStorage: for prototypes and threads that live in one browser. */
export function localStore(name = 'chat-thread', storage = globalThis.localStorage) {
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

export default createChat;

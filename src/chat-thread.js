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
import {
  dayKey, normalizeMessage, renderDay, renderList, renderMessage, renderThread, renderTyping,
  renderWaiting, resolveOptions,
} from './core.js';

export * from './core.js';

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
export function createChat(el, options = {}) {
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

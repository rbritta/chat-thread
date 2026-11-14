# chat-thread for AI agents

Read this before adding the thread to an app or changing the library.

## Adding the thread to an app

1. **Depend on it, never copy it.** `npm install github:rbritta/chat-thread#<commit>` (pin the commit), then import from `chat-thread`, `chat-thread/core` or `chat-thread/server`. Script-tag pages use `dist/chat-thread.global.js` and `dist/chat-thread.css`.
2. **Map your messages** to `{ id, from: 'me' | 'other', kind, author, text, at, state, alert, tag, title, format, meta }` in one small function in the app. `from` is about the person looking at the screen: what they wrote is `me`. A bot or system that narrates (no bubble, the whole width) gets `kind: 'note'` there; everything else stays `bubble`.
3. **Pick where the HTML is drawn.** If the app already renders HTML on the server, call `renderThread(messages, options)` there (pass `timeZone` and `locale`: the server's are not the user's) and `createChat(el, { hydrate: true, onSend })` in the browser: the options travel in the markup (`data-options`), so the browser needs only its callbacks (pass `messages` too if it will call `updateMessage` on server-drawn messages). Otherwise `createChat(el, { messages | store })` draws it.
4. **Pick the store.** Server with a database: `createSqliteStore(db)` + `createHttpHandler(store)` on the server and `restStore('/api/chat/<thread>')` in the browser. One page only: `memoryStore()` or `localStore(name)`. Existing tables or API: implement `{ load(), send(draft), remove?(id) }`, or skip the store and answer in `onSend`.
5. **Put the handler behind the app's own auth and CSRF.** It has none. With a CSRF header, pass `restStore(url, { headers: () => ({ 'x-csrf-token': token }) })`. The handler only writes `from: 'me'` and only removes `me` messages; the app writes the other side with `store.add(thread, { from: 'other', ... })`.
6. **Drive the other side from the app:** `setTyping(true)` while it works, `append(reply)` when it answers (clears typing and waiting), `updateMessage(id, { state: 'read' })` when it picked a message up, `{ state: 'queued' }` while it is busy, `{ alert: true }` for a failure or a request that needs attention. A send whose `onSend` or `store.send` throws is marked `state: 'failed'` by the thread itself. The typing dots take the shape of the other side's last message (a bubble, or bare dots after a note); `typingKind` forces one.
7. **Pick the theme, then adjust with custom properties** on the app's container (`--ct-theirs`, `--ct-font-size`...), never by overriding `.ct-*` rules. `dark` for dark apps, `light` for light ones, `auto` for apps that switch (below). The thread has no background: the app's shows through.
8. **Translate** with `strings`, `locale` and `timeZone`. Every visible word lives in `DEFAULT_STRINGS`.

## Apps with their own light/dark switch

- **The switch sets `data-theme` on `<html>`** (`light` or `dark`, nothing for "follow the system"): use `theme: 'auto'` and stop there. The CSS follows the attribute, and `prefers-color-scheme` when it is absent; no script, no re-render.
- **The switch marks the theme some other way** (a class on `<body>`, a context value): either also set `document.documentElement.dataset.theme` in the same place, or pass `theme: 'light' | 'dark'` and call `chat.configure({ theme })` on every change (`configure` redraws and keeps the text being typed).
- **The app's palette is not quite ours:** set the `--ct-*` properties on its container for each of its themes, under its own selectors (`[data-theme="light"] .my-panel .ct { --ct-mine: ... }`). They win over `light` and `auto`, which are written with `:where()` to stay as weak as `.ct`.
- **Server-rendered pages** do the same: `renderThread(messages, { theme: 'auto' })` needs nothing at request time, since the choice happens in the browser's CSS.

### React

React must not render anything inside the thread's element: hand it an empty `<div>` and let the library own it.

```jsx
import { useEffect, useRef } from 'react';
import { createChat } from 'chat-thread';
import 'chat-thread/style.css';

export function Conversation({ messages, onSend }) {
  const box = useRef(null);
  const chat = useRef(null);
  const send = useRef(onSend);
  send.current = onSend;                         // the latest handler, without recreating the chat

  useEffect(() => {
    chat.current = createChat(box.current, { theme: 'auto', author: 'Assistant', onSend: (text, info) => send.current(text, info) });
    return () => { chat.current.destroy(); chat.current = null; };   // StrictMode mounts twice: this keeps one thread
  }, []);

  useEffect(() => { chat.current.update({ messages }); }, [messages]);   // React state is the source of truth

  return <div ref={box} />;
}
```

Keep one source of truth: either React state (pass the list, `update({ messages })` on change, and add the sent message to the state in `onSend`) or the chat (`append`, `updateMessage`, `setTyping` from the app's events, no `messages` prop). Mixing both draws messages twice.

A read-only transcript needs no controller: `renderThread` escapes every field, so its string can go straight into the DOM.

```jsx
import { useEffect, useRef } from 'react';
import { renderThread } from 'chat-thread/core';

export function Transcript({ messages }) {
  const box = useRef(null);
  useEffect(() => { box.current.innerHTML = renderThread(messages, { mode: 'readonly', theme: 'auto' }); }, [messages]);
  return <div ref={box} />;
}
```

`dangerouslySetInnerHTML={{ __html: renderThread(...) }}` works the same and also renders on a React server. For Read more and Copy to respond, add `createChat(box.current, { hydrate: true, mode: 'readonly' })` in the effect and `destroy()` in its cleanup.

## Shapes

```js
// a message, as normalizeMessage returns it and the stores keep it
{ id, from, kind /* bubble|note */, author, text, at /* ISO */, state /* pending|queued|sent|delivered|read|failed|null */, alert, tag, title, format, meta }
// browser store
{ load() -> { messages } | messages[], send(draft) -> message, remove?(id) }
// server store (thread = any id: 'support', 'user-42', 'task:17')
store.load(thread, { limit?, before? }) -> { messages }
store.add(thread, draft) -> message                 // draft.from defaults to 'other'
store.update(thread, id, patch, { from? }) -> message   // patch: state, alert, text, kind, tag, title, format, meta, or { removed: true }
store.remove(thread, id, { from? }) -> { ok, id }
store.threads({ limit? }) -> { threads: [{ thread, count, last }] }
// onChange (server): { type: 'add' | 'update' | 'remove', thread, message, before?, patch? }
// onChange (browser): { type: 'send' | 'append' | 'remove' | 'load', message? | messages?, toggles? }
```

## Changing the library

- `src/core.js` holds every rule that has no DOM: formats, times, options and all the HTML. Test it there (`test/core.test.js`). The server and the browser draw with the same functions, so a markup change is made once.
- `src/chat-thread.js` is the DOM: events, the growing box, Read more, Copy, ×, and the browser stores. Its behavior is covered by `test/chat-thread.browser.test.js` (real Chrome through playwright-core, headless).
- `server/` is Node only and must keep working with both `node:sqlite` and better-sqlite3 (only `exec` and `prepare().run/get/all`).
- A theme is a block of `--ct-*` values and nothing else. `light` is written twice in `chat-thread.css` (once for `.ct--light` and `data-theme="light"`, once inside the `prefers-color-scheme: light` query): change both, and keep the `:where()` around the page selectors so an app's own properties still win. `test/chat-thread.browser.test.js` checks the colors and measures WCAG AA for every theme on its bubbles and on the page behind it.
- Every class starts with `ct-`. The markup has no `style` attribute and no inline handler: sizes the script changes go through `element.style` (CSSOM), which a strict CSP allows. Keep it that way; `test/core.test.js` checks it.
- Motion goes through `element.animate` in `chat-thread.js` (also CSP-safe): about 200 ms, eased out, and nothing when `prefers-reduced-motion` asks for less. It must end exactly where the layout ends (the browser test pauses an animation near its end and compares). The browser tests run with reduced motion unless a test asks for it.
- The thread is a `role="log"`: it announces what is added to it. Put no other live region inside it, and change the whole list through `quietly()` so a reload is not read out.
- Everything rendered is escaped with `escapeHtml`; URLs go through `safeUrl`. My own text is `renderPlain` (as written); only the other side gets markdown by default.
- No runtime dependencies. No build step for ESM users. After changing `src/`, run `npm run build` and commit `dist/` (CI fails when `dist/` is stale). Top-level names in `core.js` and `chat-thread.js` must not collide: the build concatenates them, and refuses to build when they do.
- Run `npm test` before committing. If the look changed, run `npm run screenshots` and commit `docs/`.
- The demo data is made up and lives in the JSON block of `demo/index.html`. Never put real names, messages or numbers there.
- The demo's theme switch is `demo/theme.js` (a classic script in `<head>`, so the remembered choice paints first). Every example except the WhatsApp previews and the fixed-light booking uses `theme: 'auto'`; the page's own colors are tokens in `demo/demo.css`, light written twice like the library's.

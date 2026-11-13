# chat-thread for AI agents

Read this before adding the thread to an app or changing the library.

## Adding the thread to an app

1. **Depend on it, never copy it.** `npm install github:rbritta/chat-thread#<commit>` (pin the commit), then import from `chat-thread`, `chat-thread/core` or `chat-thread/server`. Script-tag pages use `dist/chat-thread.global.js` and `dist/chat-thread.css`.
2. **Map your messages** to `{ id, from: 'me' | 'other', author, text, at, state, alert, tag, title, format, meta }` in one small function in the app. `from` is about the person looking at the screen: what they wrote is `me`.
3. **Pick where the HTML is drawn.** If the app already renders HTML on the server, call `renderThread(messages, options)` there (pass `timeZone` and `locale`: the server's are not the user's) and `createChat(el, { hydrate: true, onSend })` in the browser. Otherwise `createChat(el, { messages | store })` draws it.
4. **Pick the store.** Server with a database: `createSqliteStore(db)` + `createHttpHandler(store)` on the server and `restStore('/api/chat/<thread>')` in the browser. One page only: `memoryStore()` or `localStore(name)`. Existing tables or API: implement `{ load(), send(draft), remove?(id) }`, or skip the store and answer in `onSend`.
5. **Put the handler behind the app's own auth and CSRF.** It has none. With a CSRF header, pass `restStore(url, { headers: () => ({ 'x-csrf-token': token }) })`. The handler only writes `from: 'me'` and only removes `me` messages; the app writes the other side with `store.add(thread, { from: 'other', ... })`.
6. **Drive the other side from the app:** `setTyping(true)` while it works, `append(reply)` when it answers (clears typing and waiting), `updateMessage(id, { state: 'read' })` when it picked a message up, `{ state: 'queued' }` while it is busy, `{ alert: true }` for a failure or a request that needs attention.
7. **Theme with custom properties** on the app's container (`--ct-theirs`, `--ct-font-size`...), never by overriding `.ct-*` rules. The thread has no background: the app's shows through.
8. **Translate** with `strings`, `locale` and `timeZone`. Every visible word lives in `DEFAULT_STRINGS`.

## Shapes

```js
// a message, as normalizeMessage returns it and the stores keep it
{ id, from, author, text, at /* ISO */, state /* pending|queued|sent|delivered|read|null */, alert, tag, title, format, meta }
// browser store
{ load() -> { messages } | messages[], send(draft) -> message, remove?(id) }
// server store (thread = any id: 'support', 'user-42', 'task:17')
store.load(thread, { limit?, before? }) -> { messages }
store.add(thread, draft) -> message                 // draft.from defaults to 'other'
store.update(thread, id, patch, { from? }) -> message   // patch: state, alert, text, tag, title, format, meta, or { removed: true }
store.remove(thread, id, { from? }) -> { ok, id }
store.threads({ limit? }) -> { threads: [{ thread, count, last }] }
// onChange (server): { type: 'add' | 'update' | 'remove', thread, message, before?, patch? }
// onChange (browser): { type: 'send' | 'append' | 'remove' | 'load', message? | messages?, toggles? }
```

## Changing the library

- `src/core.js` holds every rule that has no DOM: formats, times, options and all the HTML. Test it there (`test/core.test.js`). The server and the browser draw with the same functions, so a markup change is made once.
- `src/chat-thread.js` is the DOM: events, the growing box, Read more, Copy, ×, and the browser stores. Its behavior is covered by `test/chat-thread.browser.test.js` (real Chrome through playwright-core, headless).
- `server/` is Node only and must keep working with both `node:sqlite` and better-sqlite3 (only `exec` and `prepare().run/get/all`).
- Every class starts with `ct-`. The markup has no `style` attribute and no inline handler: sizes the script changes go through `element.style` (CSSOM), which a strict CSP allows. Keep it that way; `test/core.test.js` checks it.
- Everything rendered is escaped with `escapeHtml`; URLs go through `safeUrl`. My own text is `renderPlain` (as written); only the other side gets markdown by default.
- No runtime dependencies. No build step for ESM users. After changing `src/`, run `npm run build` and commit `dist/` (CI fails when `dist/` is stale). Top-level names in `core.js` and `chat-thread.js` must not collide: the build concatenates them.
- Run `npm test` before committing. If the look changed, run `npm run screenshots` and commit `docs/`.
- The demo data is made up and lives in the JSON block of `demo/index.html`. Never put real names, messages or numbers there.

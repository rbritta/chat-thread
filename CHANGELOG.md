# Changelog

## 0.2.0 (2026-11-13)

For light apps and for bots that narrate.

- `theme: 'light'`: the light twin of the dark palette. Text, muted text, links, author names and titles pass WCAG AA on both bubbles and on a `#f5f6f8` page; the tests measure it.
- `theme: 'auto'`: dark or light with CSS only. `<html data-theme="light">` or `"dark"` decides; without it, `prefers-color-scheme` does; otherwise dark. Written with `:where()`, so an app's own `--ct-*` on its container still win.
- `kind: 'note'` on a message: no bubble, no author line, no ticks, the whole width in the theme's text color, markdown on either side, the time below in the muted color (`--ct-note-meta: none` hides it). An alert note gets a bar on the left; a long note fades out with a mask, over any background. `renderThread` draws it the same on a server.
- SQLite store: a `kind` column, added to a 0.1.0 table the first time a store opens it. The HTTP handler still only writes bubbles from the browser.
- Each theme sets `color-scheme`, so native checkboxes and scrollbars match it.
- Demo: a "Light and auto" section with a booking assistant and a System / Light / Dark switch. README: Themes and Notes; AGENTS.md: apps with their own light/dark switch, React included.

## 0.1.0 (2026-11-13)

First release, extracted from six apps that each drew their own conversation: two dev dashboards, a Bible reading app, a WhatsApp log viewer and two clinic messaging tools ([docs/extraction.md](docs/extraction.md)).

- Bubbles by side, author on the other side (with a color per author in groups), time and ticks inside the bubble.
- Markdown subset with a Copy button on code, plain text for my own messages, WhatsApp marks for previews and logs. Raw HTML is never rendered.
- Read more, typing dots, "has not replied yet", day separators, queued messages with ×, alert border.
- The box: pill that grows from one to six lines, Enter sends, Shift+Enter breaks the line, round Send button, suggestion chips and toggles.
- Modes `chat`, `readonly` and `preview`; the dark theme and the light `whatsapp` theme, all in `--ct-*` custom properties.
- `renderThread` and friends as pure functions for server-side rendering, `createChat` with `hydrate` in the browser.
- `memoryStore`, `localStore`, `restStore`, the SQLite store and the HTTP handler for Node.
- `dist/` builds for a script tag (`window.ChatThread`) and for import (`chat-thread.mjs`). CSP-safe markup.

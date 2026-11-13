# Changelog

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

# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-17

### Added

- `createThreads({ newThreads: false })` leaves out every way to start a thread: the Branch button, Ctrl+Shift+Enter (the box keeps the key) and the box at the bottom. For an app that shows threads the person answers but cannot open, such as one question of an AI session in a side panel.
- `createThreads({ rename: false })` leaves out the pencil, for threads whose title the app owns. `rename()` from code still works.

## [0.8.0] - 2026-11-16

### Added

- A photo sent from the camera shows in its bubble at once, from a small copy (at most 560 px, a `data:` URL, so a CSP with `img-src 'self' data:` allows it). The copy stays on the page: the store and `onSend` never get it, and the saved message's own `image` replaces it.
- `image` also takes a base64 `data:` URL of a JPEG, PNG, WebP or GIF (never SVG), up to about 1 MB.
- The live demo shows both: a photo in the Questions thread that opens full size, and the + with Camera in its box.

### Changed

- `image` takes `width` and `height` (the picture's own size): the thumbnail keeps its room while it loads, so the page does not jump when it arrives. Without them it holds at least 80 px on a light placeholder. The camera's preview gives them.

## [0.7.0] - 2026-11-16

### Added

- `image` on a message (`'/photos/1.jpg'` or `{ src, alt }`, http(s) or relative URLs only): a thumbnail above the text, at most 280 px (220 px on a phone). A click opens it full size over the page; Escape, the X or a click outside the photo closes it and gives the focus back to the thumbnail. New string: `enlarge`.

## [0.6.0] - 2026-11-16

### Added

- `attach: ['camera']`: a + left of the box opens a menu with Camera. On a computer the camera opens live over the page (`getUserMedia`); on a phone, or with no camera or the permission refused, the device's own camera through a file input. The photo comes back to a preview with a caption field and Send; `onSend(text, { photo, caption, ... })` gets it as a JPEG `Blob` (at most 2048 px on the long side), and the bubble reads `📷 caption` (or `📷 Photo`) until the app answers. `chat.send(caption, { photo })` and `chat.openCamera()` do the same from code. New strings: `attach`, `camera`, `takePhoto`, `retake`, `caption`, `close`, `photo`; new color `--ct-camera`.

### Changed

- `createThreads`: the Branch button is Send's twin, the same 40 px on the same line, with the colors swapped (Send's icon color as its face, Send's color for the arrows), and fades like Send when there is nothing to branch.

## [0.5.5] - 2026-11-15

### Fixed

- `createThreads`: an `upsert` that carries `at` (as a page that polls and sends the whole header again does) no longer moves a thread that is already in order. Moving it took the focus out of the box being typed in, and a phone closed its keyboard.

## [0.5.4] - 2026-11-14

Project housekeeping: the library itself is unchanged.

### Added

- `CONTRIBUTING.md`, `SECURITY.md` (private vulnerability reporting), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), issue forms, a pull request template and Dependabot for the actions and npm.
- `release.yml`: a `v*` tag runs the tests and publishes a GitHub Release with that version's section of this file as its notes and the `npm pack` tarball attached. `scripts/release-notes.mjs` cuts the section and refuses a tag that is not the version in `package.json`.
- `npm run test:coverage`: the tests with a coverage summary of the code Node runs (`src/core.js`, `server/`).

### Changed

- CI runs on Ubuntu and Windows with Node 22 and 24, with read-only permissions, cancels a run that a newer push replaces, checks that `dist/` is current and prints the coverage summary.
- The browser tests share one launcher (`test/browser.js`) and always run in CI (`PW_REQUIRE=1`): there, a missing browser fails the run. Elsewhere they skip with the reason printed, instead of silently.
- The browser tests pin the page's language (en-US), time zone (UTC) and clock, and Node's zone, so they give the same result on any machine.
- The README follows the shape of its sibling repositories (badges, install, quick start, the family table), with the size measured again: the bundle grew with `createThreads` in 0.5.0, to about 81 kB unminified, 26 kB gzipped.
- This file follows Keep a Changelog.

## [0.5.3] - 2026-11-14

- The motion of 0.5.2 was lost in a long thread: the earlier messages appeared above the view, all at once. Now the list unrolls (its height grows over 0.28 s) with the latest messages held at the bottom and the earlier ones coming down from above; "Show only the latest" rolls it back while they fade.

## [0.5.2] - 2026-11-14

- A light motion on "Show N earlier" and "Show only the latest": the earlier messages rise in (fade from 6 px below, 0.22 s); folding back fades them out before they go. None with `prefers-reduced-motion`.

## [0.5.1] - 2026-11-14

- "Show N earlier messages" in purple (`--ct-th-earlier`, `--ct-th-earlier-border`), so it is seen at a glance.

## [0.5.0] - 2026-11-14

New

- `createThreads(el, options)`: several subjects in one place, each a thread under a header. Threads keep the order they were opened in; a resolved one folds into one line, hidden behind "Show N resolved" at the top. Only the active thread has a message box, and with none open a box at the bottom starts a new thread. The Branch button right of Send (or Ctrl+Shift+Enter) opens a thread derived from the current one with the text. Titles come from a person, an AI (marked ✦) or the first message. Two headers, `conversation` (the default) and `questions` (`Qn` with the state), or the app's own. A working thread shows the typing dots and its activity. Light, dark and auto like the thread.
- A long thread shows only its latest messages (`latest`, 2 by default, as in a Q&A where the last answer is what matters), with "Show N earlier messages" above them and "Show only the latest" to fold back.
- `THREAD_STRINGS`, `THREAD_MODES`, `THREAD_HEADERS` and `threadTitle` are exported for apps that draw their own header.
- The demo has a Threads section; `test/threads.browser.test.js` covers it.

## [0.4.0] - 2026-11-14

Dates and times follow the browser, and the app can say otherwise.

- `hour12` now defaults to the locale's own clock: `17:50` in Brazil or Britain, `5:50 PM` in the United States. It used to be always 24 hours; pass `hour12: false` to keep that.
- README: a "Dates and times" section with examples, and what to pass when the thread is drawn on a server, where there is no browser to follow.

## [0.3.0] - 2026-11-13

A full review: safer links, a server-rendered thread that hydrates with its own options, quiet motion, accessibility, and every example of the demo in light and dark. Nothing in the API was renamed or removed.

New

- `typingKind`: the typing dots take the shape of the other side's last message. After a note they are bare dots on the left, with no bubble and no name; otherwise a bubble, as before. `'bubble'` or `'note'` forces one.
- `state: 'failed'`: a send whose `onSend` or `store.send` throws now shows a red mark labelled "Not sent" (`strings.failed`) instead of a clock that never ends. It still gets `alert: true`. The SQLite store accepts it from the server; the HTTP handler still refuses it from the browser.
- `renderThread` writes the options that differ from the defaults into `data-options`, and `createChat(el, { hydrate: true })` reads them: new messages, times, day separators and every word come out the way the server drew them, without the page passing them again. Options given to `createChat` win.
- Motion: a new message fades in, a removed one folds away while what is below slides up, "Read more" unrolls and rolls back. About 200 ms, eased out, and none with `prefers-reduced-motion`.
- Ctrl+Enter (Cmd+Enter) sends when `enterSends` is off; a phone's keyboard shows a Send key when Enter sends.

Fixed

- A markdown link to `/\host` opened another site (browsers read it as `//host`). Links with backslashes or control characters are now plain text.
- Hydrating a thread the server drew with a waiting or typing line: a reply did not clear it and went above it. Both are taken over now.
- A bad `locale` dropped the time zone (times in the server's zone) and made `renderThread` throw on day separators.
- Emphasis marks could cross (`**a *b** c*` gave `<strong>a <em>b</strong> c</em>`); now they always nest, in markdown and in WhatsApp marks.
- A code fence with more than a language (```` ```js title="a.js" ````) was not a fence, and its closing fence opened a new one. `# C#` lost its `#`.
- A double click on × removed twice (the store saw two calls).
- The Enter that picks a word in an IME is now ignored also when the browser reports it just after the composition ended, or without `isComposing`.
- Focus: after Send from the keyboard, the disabled button lost it; it goes back to the box. × gives it to the box too. A click on Send no longer takes the focus out of the box.
- `updateMessage` (a streamed text) closed a message the reader had opened with "Read more", and took the focus away.
- A live feed that echoed a message as it was being sent showed it twice; `append` with an id already in the thread now changes that message.
- `configure` cleared the toggles and the focus, and replaced all `strings` with the ones given; it keeps them now and merges the words.
- `configure` after hydrating on the `.ct` element itself drew a thread inside the thread; `destroy` emptied the whole container instead of removing only the thread.
- The box grows without letting a page at its bottom scroll back while measuring.
- A long thread checks its "Read more" sizes in one pass instead of one layout per message.
- Copy's "Copied" could flip back early after a second click.
- Text cut at a limit could split an emoji in half; strings set to `undefined` blanked the word instead of keeping the default.
- The SQLite store answers a row with unreadable `meta` with `meta: null` instead of failing the whole thread.

Accessibility

- The typing dots say "Assistant is typing" to screen readers; the typing and waiting lines are no longer live regions inside the log, which announces them itself.
- `reload()`, `update()` and `configure()` no longer make a screen reader read the whole thread again.
- Contrast: every theme passes WCAG AA for text, muted text, links, names and titles on both bubbles and on the page behind them, measured by the tests. In `dark` the muted gray is a shade lighter (`#98a1ab`) and the focus ring brighter; in `whatsapp` the muted gray, links and focus are a shade darker than WhatsApp's own (its blue read ticks stay). The placeholder and queued messages are no longer faded below the contrast line.

Demo

- A System / Light / Dark switch at the top repaints every example and the page around them; it is remembered per viewer. The examples use `theme: 'auto'`; the WhatsApp previews keep their WhatsApp look, and the booking assistant stays `theme: 'light'`, as their captions say.
- The read-only log hydrates with `createChat(el, { hydrate: true })` alone.

Build and tests

- The build refuses to run when `core.js` and `chat-thread.js` declare the same top-level name.
- 67 tests (42 before): every fix above has one, plus contrast in every theme, no horizontal scroll at 360 and 1200 px in light and dark, 1500 messages, an empty thread and the motion.

## [0.2.0] - 2026-11-13

For light apps and for bots that narrate.

- `theme: 'light'`: the light twin of the dark palette. Text, muted text, links, author names and titles pass WCAG AA on both bubbles and on a `#f5f6f8` page; the tests measure it.
- `theme: 'auto'`: dark or light with CSS only. `<html data-theme="light">` or `"dark"` decides; without it, `prefers-color-scheme` does; otherwise dark. Written with `:where()`, so an app's own `--ct-*` on its container still win.
- `kind: 'note'` on a message: no bubble, no author line, no ticks, the whole width in the theme's text color, markdown on either side, the time below in the muted color (`--ct-note-meta: none` hides it). An alert note gets a bar on the left; a long note fades out with a mask, over any background. `renderThread` draws it the same on a server.
- SQLite store: a `kind` column, added to a 0.1.0 table the first time a store opens it. The HTTP handler still only writes bubbles from the browser.
- Each theme sets `color-scheme`, so native checkboxes and scrollbars match it.
- Demo: a "Light and auto" section with a booking assistant and a System / Light / Dark switch. README: Themes and Notes; AGENTS.md: apps with their own light/dark switch, React included.

## [0.1.0] - 2026-11-13

First release, extracted from six apps that each drew their own conversation: two dev dashboards, a Bible reading app, a WhatsApp log viewer and two clinic messaging tools ([docs/extraction.md](docs/extraction.md)).

- Bubbles by side, author on the other side (with a color per author in groups), time and ticks inside the bubble.
- Markdown subset with a Copy button on code, plain text for my own messages, WhatsApp marks for previews and logs. Raw HTML is never rendered.
- Read more, typing dots, "has not replied yet", day separators, queued messages with ×, alert border.
- The box: pill that grows from one to six lines, Enter sends, Shift+Enter breaks the line, round Send button, suggestion chips and toggles.
- Modes `chat`, `readonly` and `preview`; the dark theme and the light `whatsapp` theme, all in `--ct-*` custom properties.
- `renderThread` and friends as pure functions for server-side rendering, `createChat` with `hydrate` in the browser.
- `memoryStore`, `localStore`, `restStore`, the SQLite store and the HTTP handler for Node.
- `dist/` builds for a script tag (`window.ChatThread`) and for import (`chat-thread.mjs`). CSP-safe markup.

[Unreleased]: https://github.com/rbritta/chat-thread/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/rbritta/chat-thread/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rbritta/chat-thread/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rbritta/chat-thread/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/rbritta/chat-thread/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/rbritta/chat-thread/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/rbritta/chat-thread/releases/tag/v0.5.4

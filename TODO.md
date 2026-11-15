# Roadmap

Ideas that are not built yet, roughly in order. Open an issue before starting a big one.

- [ ] Conversation list beside the thread (avatar, name, last message), for log viewers and inboxes.
- [ ] Stick to the bottom while new messages arrive, with a "new messages" pill when scrolled up.
- [ ] Live updates from the HTTP handler (Server-Sent Events) and a `poll` option for `restStore`.
- [ ] Older messages on scroll up (`load({ before })` is already in the server store).
- [ ] Attachments: an image or a file card inside the bubble.
- [ ] Reply to a message (the quoted bubble on top) and reactions.
- [ ] A `system` kind: a short centered line ("Dana joined", "Moved to Friday").
- [ ] Markdown tables and quotes.
- [ ] Publish to npm once the API has settled on real use.

## Found by moving six real conversation screens onto chat-thread (2026-11-14)

Each of these is drawn today by the host app on top of the bubble; a library hook would let it go.

- [ ] Trusted rich content inside a bubble: `message.html` (already sanitized by the host) or a `renderBody` hook, for media, link cards, quoted passages and app-specific blocks.
- [ ] A per-message `variant` that becomes a class (`ct-msg--edited`, `--deleted`, `--alert`, `--wide`).
- [ ] An "edited" mark beside the time (`edited: true`, `strings.edited`).
- [ ] Message actions beside the time ("Details", "Copy"): `actions` on the message and an `onAction` callback.
- [ ] `linkify` for bare domains, `www.`, e-mail and phone, and URLs with parentheses.
- [ ] `renderWhatsApp` keeps repeated spaces and blank lines (today the host needs `white-space: pre-wrap`).
- [ ] Highlighted spans in a preview (a placeholder still to fill, a value already filled).
- [ ] "Read more" by rendered height rather than character count, opening in steps (`clampStep`), and re-measured after content changes.
- [ ] Composer: `maxLength`, value buttons with a tone (OK / No / custom), and a draft that survives a re-render from outside.

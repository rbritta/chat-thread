# What was extracted, and what stays in the apps

chat-thread comes from six apps that each drew their own conversation: two dev dashboards (a
task board that talks to work sessions, and a personal session console), a Bible reading app, a
WhatsApp log viewer and two clinic messaging tools. They had drifted apart: three copies of the
same bubbles, different colors per app, a time label above each bubble in some and inside it in
others, and class names that collided with the page around them.

The rule for the split: if two apps need it and it has no meaning of its own, it is in the
library. If it says what a message *means* in one app, it stays in that app.

## Generic: now in the library

| Piece | Where it was before | In chat-thread |
| --- | --- | --- |
| Bubbles by side: mine on the right, the other side on the left, the corner on the author's side almost square | all six, with three different sets of rules | `.ct-msg--mine`, `.ct-msg--theirs` |
| Author label only on the other side (a session, an AI, a person in a group) | dashboards (a "You 17:53" label above every bubble), log viewer | `author`, per message or for the whole thread; `colorAuthors` for groups |
| Time and ticks inside the bubble, floating at the end of the last line | Bible reading app, clinic tools | `.ct-meta`, ticks by `state` |
| Markdown subset, never raw HTML; code with a Copy button | dashboards (their own formatter) | `renderMarkdown`, default for the other side |
| The person's own text exactly as written | dashboards | `renderPlain`, default for my side |
| WhatsApp marks rendered: \*bold\*, \_italic\_, \~strike\~ | missing: the clinic previews showed the asterisks | `renderWhatsApp`, `format: 'whatsapp'` |
| "Read more" on long messages | Bible reading app | `clamp`, measured again in the browser |
| Typing dots | Bible reading app | `setTyping()` |
| "… has not replied yet" | task board | `setWaiting()` |
| Day separator | Bible reading app | `days`, Today / Yesterday / weekday / date |
| Queued message: dashed, clock, × to remove | task board, session console | `state: 'queued'`, `tag`, `onRemove` / `store.remove` |
| Alert or request: red border | task board | `alert: true` |
| Pill box that grows from one to six lines, Enter sends, Shift+Enter breaks the line, round Send button disabled when empty | Bible reading app (the others had a square box with a text button) | `.ct-composer` |
| Suggestion chips | Bible reading app | `chips` |
| An options slot under the box (the "Close the session when done" checkbox) | task board | `toggles`, or any control placed in `chat.composer` |
| Read-only mode | log viewer | `mode: 'readonly'` |
| A single-bubble preview | clinic tools | `mode: 'preview'` |
| Themes by CSS variables: the dark green palette, the light WhatsApp look with the tail and blue ticks | each app had fixed colors | `--ct-*` custom properties, `theme: 'whatsapp'` |
| HTML drawn on the server as a string | dashboards, Bible reading app | `renderThread()` in `core.js` (pure) |
| Client script that draws or hydrates the thread and runs the box | each app's own | `createChat(el, options)`, `hydrate: true` |
| Stores | each app's own fetch calls | `memoryStore`, `localStore`, `restStore`, SQLite store and HTTP handler |
| Every visible word translatable | hard-coded in each app, in two languages | `strings`, `locale`, `timeZone` |

## App-specific: stays in each app

| What | Why it stays |
| --- | --- |
| Where messages come from and go to: a work session's queue, an AI call, the WhatsApp mirror, a clinic's scheduler | The library never talks to a server by itself: the app answers `onSend` or `store.send`, and calls `append`, `setTyping`, `updateMessage` |
| Deciding that a message is queued, read or an alert | Only the app knows whether its session is busy or its request failed |
| What the toggles mean (closing a session when done) | The library only hands the values over in `meta.toggles` |
| The frames around the thread: the task row, the daily-notes text on the side, the log viewer's list of conversations, the clinic's form and the scheduled-message card | Layout of each app; the demo draws them only to show the thread in context |
| Each app's palette tweak (a bluer or greener bubble for the other side, a smaller font in narrow columns) | A few `--ct-*` properties set on the app's container |
| The task board's "lead and bullet points" rewrite, which turned a long one-line answer into a list | A guess about one app's answers; with markdown the answer brings its own list |
| The phone number highlight in one clinic preview | WhatsApp itself does not style it that way; the app can wrap the number in its template |
| The reading text's taller line height in the Bible reading app | A reading choice of that app, one CSS rule on its container |
| Authentication, CSRF and who may read which thread | The HTTP handler trusts whoever reaches it; the app checks first |
| Notifications, sounds, unread counts | Outside the thread |

## Integration, after approval

Each app depends on the repository pinned to a commit and keeps a thin wrapper: it maps its own
message shape to `{ id, from, author, text, at, state, alert, tag, title }`, picks the theme
properties, renders on the server with `renderThread()` where it already renders HTML, and calls
`createChat(el, { hydrate: true, onSend })` in the browser. The old bubble CSS and markdown code
in the app go away in the same change.

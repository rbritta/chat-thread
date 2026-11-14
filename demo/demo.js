// The demo: made-up threads read from the JSON block in index.html, so the page needs no
// inline script or style and runs under a strict Content-Security-Policy.
import { createChat, createThreads, memoryStore, renderThread } from '../src/chat-thread.js';

const data = JSON.parse(document.getElementById('demo-data').textContent);

// "when" is [days ago, "HH:MM"] in this browser's time, so the labels read Today, Yesterday...
const today = new Date();
function at([daysAgo, time]) {
  const [h, m] = time.split(':').map(Number);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, h, m).toISOString();
}
const messagesOf = (name) => data[name].messages.map(({ when, ...m }, i) => ({ id: i + 1, ...m, at: at(when) }));
const slot = (name) => document.querySelector(`[data-thread="${name}"]`);

/** A thread you can type in. The other side answers with a canned reply (a text or a message) after a moment. */
function live(name) {
  const { options } = data[name];
  const reply = typeof data[name].reply === 'string' ? { text: data[name].reply } : data[name].reply;
  const store = memoryStore(messagesOf(name));
  const chat = createChat(slot(name), {
    ...options,
    store,
    messages: store.load().messages,
    onChange(event) {
      if (event.type !== 'send' || !reply) return;
      setTimeout(() => chat.setTyping(true), 500);
      setTimeout(() => chat.append({ ...reply, from: 'other', at: new Date().toISOString() }), 1900);
    },
  });
  return chat;
}

const chats = Object.fromEntries(['task', 'session', 'directions', 'reading', 'booking', 'reminders'].map((name) => [name, live(name)]));

// Read-only, as a server would send it: a string from renderThread(), then hydrated for "Read more" and Copy.
// The options travel in the markup (data-options), so hydrating needs none of them again.
const log = slot('log');
log.innerHTML = renderThread(messagesOf('log'), data.log.options);
chats.log = createChat(log, { hydrate: true });

// Previews are plain strings: no script needed to show them.
for (const name of ['reminder', 'scheduled']) slot(name).innerHTML = renderThread(messagesOf(name), data[name].options);

// Threads: "when" works as above; a new thread gets the next number, and the other side answers it.
const threadsOf = (name) => data[name].map(({ when, messages, ...t }) => ({ ...t, at: at(when), messages: messages.map(({ when: w, ...m }, i) => ({ id: `${t.id}-${i + 1}`, ...m, at: at(w) })) }));
function threads(name, list, options) {
  let n = list.length;
  const box = createThreads(document.querySelector(`[data-threads="${name}"]`), {
    theme: 'auto',
    threads: list,
    ...options,
    onSend(id) {
      setTimeout(() => box.upsert({ id, tone: 'busy', activity: options.mode === 'questions' ? 'Thinking' : '' }), 400);
      setTimeout(() => {
        box.append(id, { from: 'other', author: options.chat.author, text: 'On it.', at: new Date().toISOString() });
        box.upsert({ id, tone: 'wait', activity: '' });
      }, 2200);
      return { state: 'read' };
    },
    onNewThread(text) {
      n += 1;
      const now = new Date().toISOString();
      return { id: `${name}-${n}`, n, at: now, tone: 'busy', participants: options.people, messages: [{ id: `${name}-${n}-1`, from: 'me', text, at: now, state: 'read' }] };
    },
  });
  return box;
}
window.demoThreads = {
  team: threads('team', threadsOf('threadsTeam'), { people: [{ name: 'You' }, { name: 'Ana' }], chat: { author: 'Ana', colorAuthors: true, strings: { placeholder: 'Message' } } }),
  session: threads('session', threadsOf('threadsSession'), { mode: 'questions', chat: { author: 'Session 2' } }),
};

// The theme switch at the top is theme.js: the threads with theme 'auto' follow it with CSS only.

window.demoChats = chats;

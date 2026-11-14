// The demo: made-up threads read from the JSON block in index.html, so the page needs no
// inline script or style and runs under a strict Content-Security-Policy.
import { createChat, memoryStore, renderThread } from '../src/chat-thread.js';

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
const log = slot('log');
log.innerHTML = renderThread(messagesOf('log'), data.log.options);
chats.log = createChat(log, { ...data.log.options, hydrate: true });

// Previews are plain strings: no script needed to show them.
for (const name of ['reminder', 'scheduled']) slot(name).innerHTML = renderThread(messagesOf(name), data[name].options);

// Theme auto follows <html data-theme>: Light and Dark set it, System removes it.
const schemes = document.querySelectorAll('[data-scheme]');
for (const button of schemes) {
  button.addEventListener('click', () => {
    if (button.dataset.scheme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = button.dataset.scheme;
    for (const other of schemes) other.setAttribute('aria-pressed', String(other === button));
  });
}

window.demoChats = chats;

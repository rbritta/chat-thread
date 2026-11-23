import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHttpHandler, createSqliteStore, renderThread } from '../server/index.js';
import { restStore } from '../src/chat-thread.js';

const clock = (start = '2026-11-13T12:00:00.000Z') => {
  let t = Date.parse(start);
  const now = () => new Date(t).toISOString();
  now.advance = (ms) => { t += ms; };
  return now;
};

test('add, load, update and remove messages of a thread; nothing is deleted', () => {
  const now = clock();
  const changes = [];
  const db = new DatabaseSync(':memory:');
  const store = createSqliteStore(db, { now, onChange: (c) => changes.push(`${c.type}:${c.thread}`) });
  const a = store.add('support', { from: 'me', text: 'Is the backup done?\r\n' });
  now.advance(60_000);
  const b = store.add('support', { author: 'Assistant', text: 'Yes, at **03:10**.', meta: { run: 7 } });
  store.add('other-thread', { text: 'elsewhere' });
  assert.deepEqual([a.from, a.text, a.state, a.at], ['me', 'Is the backup done?', null, '2026-11-13T12:00:00.000Z']);
  assert.deepEqual([b.from, b.author, b.meta, b.alert], ['other', 'Assistant', { run: 7 }, false]);
  assert.deepEqual(store.load('support').messages.map((m) => m.id), [a.id, b.id]);

  const read = store.update('support', a.id, { state: 'read' });
  assert.equal(read.state, 'read');
  const streamed = store.update('support', b.id, { text: 'Yes, at **03:10**. All 4 disks.', alert: true });
  assert.deepEqual([streamed.text, streamed.alert], ['Yes, at **03:10**. All 4 disks.', true]);
  assert.deepEqual(store.remove('support', a.id), { ok: true, id: a.id });
  assert.deepEqual(store.load('support').messages.map((m) => m.id), [b.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 3, 'the removed row is still there');
  assert.ok(db.prepare('SELECT removed_at FROM chat_messages WHERE id = ?').get(a.id).removed_at);
  assert.throws(() => store.update('support', a.id, { state: 'read' }), { name: 'NotFoundError' });
  assert.throws(() => store.update('other-thread', b.id, { state: 'read' }), { name: 'NotFoundError' }, 'ids belong to their thread');
  assert.deepEqual(changes, ['add:support', 'add:support', 'add:other-thread', 'update:support', 'update:support', 'remove:support']);
});

test('the store refuses what a thread would never send', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  assert.throws(() => store.add('t', {}), { name: 'ValidationError' });
  assert.throws(() => store.add('t', { text: '   ' }), { name: 'ValidationError' });
  assert.throws(() => store.add('t', { text: 'x', from: 'admin' }), /from must be/);
  assert.throws(() => store.add('t', { text: 'x', state: 'lost' }), /state must be/);
  assert.throws(() => store.add('t', { text: 'x', format: 'html' }), /format must be/);
  assert.throws(() => store.add('t', { text: 'x', alert: 'yes' }), /alert must be/);
  assert.throws(() => store.add('t', { text: 'x', at: 'nope' }), /at must be/);
  assert.throws(() => store.add('t', { text: 'x', meta: [1] }), /meta must be/);
  assert.throws(() => store.add('t', { text: 'x'.repeat(20001) }), /longer than/);
  assert.throws(() => store.add('../etc', { text: 'x' }), /thread must be/);
  assert.throws(() => createSqliteStore(new DatabaseSync(':memory:'), { table: 'x; DROP TABLE y' }), /invalid table/);
  assert.equal(store.add('t', { text: 'x', author: 'a'.repeat(200) }).author.length, 80, 'labels are cut, not refused');
});

test('load pages backwards with limit and before; threads lists the latest first', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'), { table: 'msgs' });
  const ids = Array.from({ length: 5 }, (_, i) => store.add('a', { text: `m${i}` }).id);
  store.add('b', { text: 'only one' });
  assert.deepEqual(store.load('a', { limit: 2 }).messages.map((m) => m.text), ['m3', 'm4']);
  assert.deepEqual(store.load('a', { limit: 2, before: ids[3] }).messages.map((m) => m.text), ['m1', 'm2']);
  const { threads } = store.threads();
  assert.deepEqual(threads.map((t) => [t.thread, t.count, t.last.text]), [['b', 1, 'only one'], ['a', 5, 'm4']]);
});

test('kind: notes are stored and drawn without a bubble; a 0.1.0 table gets the column', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now: clock() });
  const note = store.add('t', { author: 'Assistant', kind: 'note', text: 'Friday has **three** times open.' });
  const bubble = store.add('t', { from: 'me', text: 'Friday' });
  assert.deepEqual([note.kind, bubble.kind], ['note', 'bubble']);
  assert.throws(() => store.add('t', { text: 'x', kind: 'aside' }), /kind must be one of bubble, note/);
  assert.equal(store.update('t', bubble.id, { kind: 'note' }).kind, 'note');
  const html = renderThread(store.load('t').messages, { timeZone: 'UTC', now: () => new Date('2026-11-13T20:00:00Z') });
  assert.match(html, /<div class="ct-msg ct-msg--note" data-id="1"[^>]*><div class="ct-body"><p>Friday has <strong>three<\/strong> times open\.<\/p><\/div>/);

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, thread TEXT NOT NULL, side TEXT NOT NULL DEFAULT 'other',
    author TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', tag TEXT NOT NULL DEFAULT '',
    state TEXT, alert INTEGER NOT NULL DEFAULT 0, format TEXT, meta TEXT, at TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT)`);
  db.exec(`INSERT INTO chat_messages (thread, text, at, created_at, updated_at) VALUES ('t', 'from 0.1.0', '2026-11-13T10:00:00.000Z', 'x', 'x')`);
  const old = createSqliteStore(db);
  assert.deepEqual(old.load('t').messages.map((m) => [m.text, m.kind]), [['from 0.1.0', 'bubble']]);
  assert.equal(old.add('t', { kind: 'note', text: 'new' }).kind, 'note');
  assert.equal(createSqliteStore(db).load('t').messages.length, 2, 'opening it again changes nothing');
});

test('pinned and original: the first text of a pinned message stays when it is rewritten; older tables get the columns', async () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now: clock() });
  const pin = store.add('t', { author: 'Assistant', pinned: true, text: '| # | What |\n|---|---|\n| 1 | [✓](reply:ok 1) |' });
  const plain = store.add('t', { text: 'not pinned' });
  assert.deepEqual([pin.pinned, pin.original, plain.pinned, plain.original], [true, null, false, null]);
  const v2 = store.update('t', pin.id, { text: '| # | What |\n|---|---|\n| 1 | ok |' });
  assert.deepEqual([v2.pinned, v2.original], [true, pin.text], 'the first rewrite keeps the text it had');
  const v3 = store.update('t', pin.id, { text: 'v3' });
  assert.deepEqual([v3.text, v3.original], ['v3', pin.text], 'later rewrites keep the first one');
  assert.equal(store.update('t', pin.id, { state: 'read' }).original, pin.text);
  assert.equal(store.update('t', plain.id, { text: 'changed' }).original, null, 'not pinned: nothing kept');
  assert.equal(store.update('t', pin.id, { original: null }).original, null, 'the app may forget it');
  assert.equal(store.update('t', pin.id, { pinned: false }).pinned, false);
  assert.throws(() => store.add('t', { text: 'x', pinned: 'yes' }), /pinned must be/);
  assert.throws(() => store.add('t', { text: 'x', original: 3 }), /original must be/);
  const html = renderThread(store.load('t').messages, { timeZone: 'UTC' });
  assert.doesNotMatch(html, /ct-pinned/, 'unpinned: back in the list');
  store.update('t', plain.id, { pinned: true, text: 'pinned now' });
  const pinnedHtml = renderThread(store.load('t').messages, { timeZone: 'UTC' }, { resolved: true });
  assert.match(pinnedHtml, /<div class="ct-pinned ct-pinned--final"[^>]*data-id="2"[^>]*>.*<p>pinned now<\/p>.*<div class="ct-body ct-pinned-body ct-pinned-original" hidden><p>changed<\/p>/s);

  // the browser writes as me, and never pins
  await withServer(async ({ store: served, base }) => {
    const sent = await restStore(`${base}/api/chat/t`).send({ text: 'pin me', pinned: true, original: 'x' });
    assert.deepEqual([sent.pinned, sent.original], [false, null]);
    assert.equal(served.load('t').messages[0].pinned, false);
  });

  // a table from before 0.10.0 gets the two columns, unpinned
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, thread TEXT NOT NULL, side TEXT NOT NULL DEFAULT 'other',
    author TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', tag TEXT NOT NULL DEFAULT '',
    state TEXT, alert INTEGER NOT NULL DEFAULT 0, format TEXT, meta TEXT, kind TEXT NOT NULL DEFAULT 'bubble', at TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT)`);
  db.exec(`INSERT INTO chat_messages (thread, text, at, created_at, updated_at) VALUES ('t', 'from 0.9.0', '2026-11-13T10:00:00.000Z', 'x', 'x')`);
  const old = createSqliteStore(db);
  assert.deepEqual(old.load('t').messages.map((m) => [m.text, m.pinned, m.original]), [['from 0.9.0', false, null]]);
  const id = old.load('t').messages[0].id;
  assert.equal(old.update('t', id, { pinned: true }).pinned, true);
  assert.equal(old.update('t', id, { text: 'rewritten' }).original, 'from 0.9.0');
  assert.equal(createSqliteStore(db).load('t').messages[0].original, 'from 0.9.0', 'opening it again changes nothing');
});

test('what the store returns renders straight into a thread', () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now: clock() });
  store.add('t', { from: 'me', text: 'hi' });
  store.add('t', { author: 'Bot', text: '**hello**' });
  const html = renderThread(store.load('t').messages, { timeZone: 'UTC', now: () => new Date('2026-11-13T20:00:00Z') });
  assert.match(html, /ct-msg--mine/);
  assert.match(html, /<span class="ct-author">Bot<\/span><div class="ct-body"><p><strong>hello<\/strong>/);
  assert.match(html, /class="ct-day"[^>]*>Today</);
});

async function withServer(fn) {
  const store = createSqliteStore(new DatabaseSync(':memory:'), { now: clock() });
  const handle = createHttpHandler(store, { prefix: '/api/chat' });
  const server = createServer(async (req, res) => {
    if (await handle(req, res)) return;
    res.writeHead(418);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ store, base });
  } finally {
    server.close();
  }
}

test('restStore against the HTTP handler: the browser always writes as me', async () => {
  await withServer(async ({ store, base }) => {
    const rest = restStore(`${base}/api/chat/support`);
    const sent = await rest.send({ from: 'other', kind: 'note', text: 'pretending', author: 'Admin', state: 'queued', meta: { toggles: { close: true } } });
    assert.deepEqual([sent.from, sent.kind, sent.author, sent.state, sent.meta], ['me', 'bubble', '', 'queued', { toggles: { close: true } }]);
    const reply = store.add('support', { from: 'other', author: 'Assistant', text: 'Hello' });
    assert.deepEqual((await rest.load()).messages.map((m) => m.from), ['me', 'other']);
    await assert.rejects(rest.remove(reply.id), /message not found/, 'the browser cannot remove the other side');
    assert.deepEqual(await rest.remove(sent.id), { ok: true, id: sent.id });
    assert.deepEqual((await rest.load()).messages.map((m) => m.id), [reply.id]);
    const threads = await (await fetch(`${base}/api/chat`)).json();
    assert.deepEqual(threads.threads.map((t) => t.thread), ['support']);
    const page = await (await fetch(`${base}/api/chat/support?limit=1`)).json();
    assert.equal(page.messages.length, 1);
    assert.equal((await fetch(`${base}/elsewhere`)).status, 418, 'other routes fall through');
  });
});

test('the handler answers errors as JSON with the right status', async () => {
  await withServer(async ({ base }) => {
    const post = (path, body, raw) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
    let res = await post('/api/chat/t', { text: '' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /needs a text/);
    res = await post('/api/chat/t', { text: 'x', state: 'read' });
    assert.equal(res.status, 400, 'the browser cannot claim a read tick');
    res = await post('/api/chat/t', null, '{not json');
    assert.equal(res.status, 400);
    res = await post('/api/chat/t', null, JSON.stringify({ text: 'x'.repeat(70 * 1024) }));
    assert.equal(res.status, 413);
    res = await post('/api/chat/bad%2', { text: 'x' });
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/chat/t/1`, { method: 'PATCH', body: JSON.stringify({ state: 'read' }) });
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/chat/t/99`, { method: 'PATCH', body: JSON.stringify({ removed: true }) });
    assert.equal(res.status, 404);
    res = await fetch(`${base}/api/chat/t/x/y`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('a body some framework already read is used as is', async () => {
  const store = createSqliteStore(new DatabaseSync(':memory:'));
  const handle = createHttpHandler(store);
  const fakeRes = () => {
    const res = { status: 0, body: '', writeHead(s) { res.status = s; }, end(b) { res.body = b; } };
    return res;
  };
  for (const body of [{ text: 'as object' }, JSON.stringify({ text: 'as string' })]) {
    const res = fakeRes();
    assert.equal(await handle({ method: 'POST', url: '/api/chat/t', body }, res), true);
    assert.equal(res.status, 201);
  }
  assert.deepEqual(store.load('t').messages.map((m) => [m.from, m.text]), [['me', 'as object'], ['me', 'as string']]);
  const res = fakeRes();
  assert.equal(await handle({ method: 'GET', url: '/somewhere-else' }, res), false);
});

test('failed is a state the server may set, never the browser; an unreadable meta does not break the thread', async () => {
  const db = new DatabaseSync(':memory:');
  const store = createSqliteStore(db, { now: clock() });
  const m = store.add('t', { from: 'me', text: 'hello' });
  assert.equal(store.update('t', m.id, { state: 'failed' }).state, 'failed');
  db.prepare('UPDATE chat_messages SET meta = ? WHERE id = ?').run('{not json', m.id);
  assert.equal(store.load('t').messages[0].meta, null);
  const removed = store.remove('t', m.id);
  const row = db.prepare('SELECT removed_at, updated_at FROM chat_messages WHERE id = ?').get(removed.id);
  assert.equal(row.removed_at, row.updated_at, 'one moment for both');
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/chat/t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x', state: 'failed' }) });
    assert.equal(res.status, 400);
  });
});

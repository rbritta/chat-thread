/**
 * A store for chat-thread on SQLite. Works with `node:sqlite` (DatabaseSync) and with
 * better-sqlite3: both expose `exec` and `prepare(sql).run/get/all`.
 *
 *   import { DatabaseSync } from 'node:sqlite';
 *   const store = createSqliteStore(new DatabaseSync('chat.db'));
 *   store.add('support', { from: 'me', text: 'Is the backup done?' });
 *   store.add('support', { from: 'other', author: 'Assistant', text: 'Yes, at **03:10**.' });
 *   store.load('support');                         // { messages }, oldest first
 *   store.update('support', 2, { state: 'read' });
 *   store.remove('support', 1);                    // keeps the row with removed_at
 *   store.threads();                               // { threads: [{ thread, count, last }] }
 *
 * A thread is any id you choose (`support`, `user-42`, `task:17`). Nothing is ever deleted:
 * removed messages keep their row with a timestamp.
 */
import { FORMATS, KINDS, LIMITS, STATES, normalizeAt } from '../src/core.js';

const COLUMNS = `
  id INTEGER PRIMARY KEY,
  thread TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'other',
  kind TEXT NOT NULL DEFAULT 'bubble',
  author TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  state TEXT,
  alert INTEGER NOT NULL DEFAULT 0,
  format TEXT,
  meta TEXT,
  at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT`;

const THREAD = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,119}$/;
const MAX_META = 16 * 1024;

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; this.status = 404; }
}

/** The meta column as an object; a value some other writer left unreadable comes back as null, not as an error for the whole thread. */
function readMeta(text) {
  if (!text) return null;
  try {
    const meta = JSON.parse(text);
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
  } catch {
    return null;
  }
}

const fromRow = (r) => ({
  id: r.id,
  thread: r.thread,
  from: r.side,
  kind: r.kind,
  author: r.author,
  text: r.text,
  title: r.title,
  tag: r.tag,
  state: r.state,
  alert: r.alert === 1,
  format: r.format,
  meta: readMeta(r.meta),
  at: r.at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function checkThread(thread) {
  if (typeof thread !== 'string' || !THREAD.test(thread)) throw new ValidationError('thread must be 1 to 120 letters, digits or ._:@- and start with a letter or digit');
  return thread;
}

/** The patch as columns, refusing what a thread would never send. */
function toColumns(patch, { creating = false } = {}) {
  const cols = {};
  const str = (name, max) => {
    if (patch[name] === undefined) return;
    if (patch[name] !== null && typeof patch[name] !== 'string') throw new ValidationError(`${name} must be text`);
    cols[name] = (patch[name] ?? '').trim().slice(0, max);
  };
  if (patch.from !== undefined) {
    if (patch.from !== 'me' && patch.from !== 'other') throw new ValidationError('from must be "me" or "other"');
    cols.side = patch.from;
  }
  if (patch.kind !== undefined) {
    if (!KINDS.includes(patch.kind)) throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
    cols.kind = patch.kind;
  }
  if (patch.text !== undefined) {
    if (typeof patch.text !== 'string') throw new ValidationError('text must be text');
    if (patch.text.length > LIMITS.text) throw new ValidationError(`text is longer than ${LIMITS.text} characters`);
    cols.text = patch.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  }
  str('author', LIMITS.author);
  str('title', LIMITS.title);
  str('tag', LIMITS.tag);
  if (patch.state !== undefined) {
    if (patch.state !== null && !STATES.includes(patch.state)) throw new ValidationError(`state must be one of ${STATES.join(', ')}`);
    cols.state = patch.state;
  }
  if (patch.format !== undefined) {
    if (patch.format !== null && !FORMATS.includes(patch.format)) throw new ValidationError(`format must be one of ${FORMATS.join(', ')}`);
    cols.format = patch.format;
  }
  if (patch.alert !== undefined) {
    if (typeof patch.alert !== 'boolean') throw new ValidationError('alert must be true or false');
    cols.alert = patch.alert ? 1 : 0;
  }
  if (patch.at !== undefined) {
    const at = normalizeAt(patch.at);
    if (!at) throw new ValidationError('at must be a date');
    cols.at = at;
  }
  if (patch.meta !== undefined) {
    if (patch.meta !== null && (typeof patch.meta !== 'object' || Array.isArray(patch.meta))) throw new ValidationError('meta must be an object');
    cols.meta = patch.meta === null ? null : JSON.stringify(patch.meta);
    if (cols.meta && cols.meta.length > MAX_META) throw new ValidationError('meta is too large');
  }
  if (creating && !cols.text && !cols.title) throw new ValidationError('a message needs a text');
  return cols;
}

export function createSqliteStore(db, { table = 'chat_messages', now = () => new Date().toISOString(), onChange = () => {} } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('invalid table name');
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLUMNS})`);
  // a table made by 0.1.0 has no kind column: every message in it was a bubble
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'kind')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN kind TEXT NOT NULL DEFAULT 'bubble'`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_thread ON ${table}(thread, removed_at, id)`);

  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const many = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const byId = (thread, id) => one(`SELECT * FROM ${table} WHERE thread = ? AND id = ? AND removed_at IS NULL`, thread, Number(id));

  /** Changes a message: `state`, `alert`, `text` (a streamed answer), `kind`, `tag`, `title`, `format`, `meta`; or `{ removed: true }`. */
  function update(thread, id, patch = {}, { from } = {}) {
    checkThread(thread);
    const before = byId(thread, id);
    if (!before || (from && before.side !== from)) throw new NotFoundError('message not found');
    if (patch.removed === true) {
      const stamp = now();
      run(`UPDATE ${table} SET removed_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, before.id);
      const message = fromRow(before);
      onChange({ type: 'remove', thread, message });
      return { ok: true, id: before.id };
    }
    const { from: _side, ...rest } = patch;
    const cols = toColumns(rest);
    const names = Object.keys(cols);
    if (names.length) {
      run(`UPDATE ${table} SET ${names.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...names.map((c) => cols[c]), now(), before.id);
    }
    const message = fromRow(one(`SELECT * FROM ${table} WHERE id = ?`, before.id));
    onChange({ type: 'update', thread, message, before: fromRow(before), patch: rest });
    return message;
  }

  return {
    table,
    update,

    /** The thread's messages, oldest first: the last `limit` (at most 500), or the ones before the id `before`. */
    load(thread, { limit = 200, before } = {}) {
      checkThread(thread);
      const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const rows = before
        ? many(`SELECT * FROM ${table} WHERE thread = ? AND removed_at IS NULL AND id < ? ORDER BY id DESC LIMIT ?`, thread, Number(before), n)
        : many(`SELECT * FROM ${table} WHERE thread = ? AND removed_at IS NULL ORDER BY id DESC LIMIT ?`, thread, n);
      return { messages: rows.reverse().map(fromRow) };
    },

    get(thread, id) {
      const row = byId(checkThread(thread), id);
      return row ? fromRow(row) : null;
    },

    /** A new message. `from` is `me` or `other` (default `other`, the side your app writes for); `kind` is `bubble` (default) or `note`. */
    add(thread, draft = {}) {
      checkThread(thread);
      const stamp = now();
      const cols = { side: 'other', at: stamp, ...toColumns(draft, { creating: true }) };
      const names = Object.keys(cols);
      const res = run(`INSERT INTO ${table} (thread, ${names.join(', ')}, created_at, updated_at) VALUES (?, ${names.map(() => '?').join(', ')}, ?, ?)`,
        thread, ...names.map((c) => cols[c]), stamp, stamp);
      const message = fromRow(byId(thread, Number(res.lastInsertRowid)));
      onChange({ type: 'add', thread, message });
      return message;
    },

    /** Same as `update(thread, id, { removed: true })`. With `{ from: 'me' }` it only removes my own messages. */
    remove(thread, id, { from } = {}) {
      return update(thread, id, { removed: true }, { from });
    },

    /** Threads with their last message, most recent first. */
    threads({ limit = 100 } = {}) {
      const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const rows = many(`SELECT thread, COUNT(*) AS count, MAX(id) AS last_id FROM ${table} WHERE removed_at IS NULL
        GROUP BY thread ORDER BY last_id DESC LIMIT ?`, n);
      return {
        threads: rows.map((r) => ({ thread: r.thread, count: Number(r.count), last: fromRow(one(`SELECT * FROM ${table} WHERE id = ?`, r.last_id)) })),
      };
    },
  };
}

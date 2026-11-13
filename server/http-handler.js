/**
 * The HTTP routes that `restStore()` in the browser talks to, for plain `node:http`
 * (or anything with the same req/res, like Express).
 *
 *   const handle = createHttpHandler(store, { prefix: '/api/chat' });
 *   http.createServer(async (req, res) => {
 *     if (await handle(req, res)) return;    // true when it answered
 *     ...your other routes
 *   });
 *
 *   GET    /api/chat                    -> { threads }
 *   GET    /api/chat/:thread            -> { messages }  (?limit=200&before=<id>)
 *   POST   /api/chat/:thread            -> the new message, always `from: 'me'`
 *   PATCH  /api/chat/:thread/:id        -> { ok } for { removed: true }, only on my own messages
 *
 * The browser only ever writes as `me`: your app answers on the server with
 * `store.add(thread, { from: 'other', ... })`. If a framework already read the body,
 * `req.body` (object or string) is used. Authentication and CSRF are yours: run your
 * checks before calling `handle`.
 */
const MAX_BODY = 64 * 1024;
const BROWSER_STATES = ['pending', 'queued', 'sent'];

const httpError = (status, message) => Object.assign(new Error(message), { status });

function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body !== 'string') return Promise.resolve(req.body ?? {});
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch { return Promise.reject(httpError(400, 'invalid JSON')); }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // too large: answer 413 now and let the rest of the body drain (destroying the socket would hide the answer)
      if (size > MAX_BODY) { chunks.length = 0; reject(httpError(413, 'body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch {
        reject(httpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function decode(part) {
  try { return decodeURIComponent(part); } catch { throw httpError(400, 'bad thread id'); }
}

export function createHttpHandler(store, { prefix = '/api/chat' } = {}) {
  const base = prefix.replace(/\/$/, '');
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path !== base && !path.startsWith(`${base}/`)) return false;
    const rest = path.slice(base.length);
    try {
      if ((rest === '' || rest === '/') && req.method === 'GET') return send(res, 200, await store.threads()), true;
      let m = rest.match(/^\/([^/]+)$/);
      if (m && req.method === 'GET') {
        const query = url.searchParams;
        return send(res, 200, await store.load(decode(m[1]), { limit: query.get('limit') ?? undefined, before: query.get('before') ?? undefined })), true;
      }
      if (m && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object') throw httpError(400, 'body must be an object');
        if (body.state !== undefined && body.state !== null && !BROWSER_STATES.includes(body.state)) throw httpError(400, `state must be one of ${BROWSER_STATES.join(', ')}`);
        const draft = { from: 'me', text: body.text, meta: body.meta, ...(body.state ? { state: body.state } : {}) };
        return send(res, 201, await store.add(decode(m[1]), draft)), true;
      }
      m = rest.match(/^\/([^/]+)\/(\d+)$/);
      if (m && req.method === 'PATCH') {
        const body = await readJson(req);
        if (body?.removed !== true) throw httpError(400, 'only { "removed": true } is accepted here');
        return send(res, 200, await store.remove(decode(m[1]), Number(m[2]), { from: 'me' })), true;
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, err.status || 500, { error: err.status ? err.message : 'internal error' });
      if (!err.status) console.error('[chat-thread]', err);
    }
    return true;
  };
}

/**
 * Yahoo Finance reverse proxy — Cloudflare Worker
 *
 * Routes:
 *   GET|POST https://<worker>.workers.dev/<host>/<path>?<query>
 *
 * Example:
 *   https://yahoo-proxy.example.workers.dev/query1.finance.yahoo.com/v7/finance/options/AAPL
 *   → forwards to → https://query1.finance.yahoo.com/v7/finance/options/AAPL
 *
 * Allowed target hosts (allowlist prevents open-proxy abuse):
 *   - query1.finance.yahoo.com
 *   - query2.finance.yahoo.com
 *
 * Optional shared secret:
 *   Set the PROXY_SECRET environment variable / secret binding in Cloudflare.
 *   When set, the incoming request must include the header:
 *     x-proxy-secret: <value>
 *   Requests without the correct secret receive 403.
 *   Leave PROXY_SECRET unset to skip the check (fine for personal projects).
 *
 * Deploy:
 *   npx wrangler deploy  (from this directory)
 *   — or paste this file into the Cloudflare Workers dashboard editor.
 *
 * After deploying, copy the *.workers.dev URL and set it as YAHOO_PROXY_URL
 * in your server's environment variables.
 */

const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-proxy-secret',
}

// Run once per cold-start: migrate old single-row schema → append-only + access table
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run()

  const migrated = await db.prepare(`SELECT value FROM meta WHERE key = 'chains_v2'`).first()
  if (!migrated) {
    // Rename old primary-key table if it exists
    await db.prepare(`ALTER TABLE chains RENAME TO chains_v1_backup`).run().catch(() => {})
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS chains (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         ticker     TEXT NOT NULL,
         data       TEXT NOT NULL,
         fetched_at INTEGER NOT NULL
       )`
    ).run()
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_chains_ticker_time ON chains (ticker, fetched_at DESC)`
    ).run()
    // Migrate existing rows
    await db.prepare(
      `INSERT OR IGNORE INTO chains (ticker, data, fetched_at)
       SELECT ticker, data, updated_at FROM chains_v1_backup`
    ).run().catch(() => {})
    await db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('chains_v2', '1')`).run()
  }

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ticker_accesses (
       ticker        TEXT PRIMARY KEY,
       last_accessed INTEGER NOT NULL,
       access_count  INTEGER NOT NULL DEFAULT 1
     )`
  ).run()
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    // -------------------------------------------------------------------------
    // POST /access/:ticker  — fire-and-forget access tracking (no auth)
    // GET  /access/hot      — tickers accessed since ?since=<unixSec>
    // -------------------------------------------------------------------------
    if (url.pathname.startsWith('/access/')) {
      if (!env.DB) return new Response('D1 binding not configured', { status: 503 })
      await ensureSchema(env.DB)

      if (url.pathname === '/access/hot' && request.method === 'GET') {
        const since = Number(url.searchParams.get('since')) || (Math.floor(Date.now() / 1000) - 86400)
        const { results } = await env.DB.prepare(
          `SELECT ticker, last_accessed, access_count FROM ticker_accesses
           WHERE last_accessed > ? ORDER BY last_accessed DESC`
        ).bind(since).all()
        return new Response(JSON.stringify({ tickers: results ?? [] }), {
          headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }

      const accessMatch = url.pathname.match(/^\/access\/([A-Z0-9.\-]{1,10})$/i)
      if (accessMatch && request.method === 'POST') {
        const ticker = accessMatch[1].toUpperCase()
        const now = Math.floor(Date.now() / 1000)
        await env.DB.prepare(
          `INSERT INTO ticker_accesses (ticker, last_accessed, access_count) VALUES (?, ?, 1)
           ON CONFLICT(ticker) DO UPDATE SET last_accessed = ?, access_count = access_count + 1`
        ).bind(ticker, now, now).run()
        return new Response(JSON.stringify({ ok: true, ticker }), {
          headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }
    }

    // -------------------------------------------------------------------------
    // GET  /cache/:ticker  — newest snapshot (history preserved)
    // POST /cache/:ticker  — append new snapshot (requires x-proxy-secret)
    // -------------------------------------------------------------------------
    const cacheMatch = url.pathname.match(/^\/cache\/([A-Z0-9.\-]{1,10})$/i)
    if (cacheMatch) {
      const ticker = cacheMatch[1].toUpperCase()
      if (!env.DB) return new Response('D1 binding not configured', { status: 503 })
      await ensureSchema(env.DB)

      if (request.method === 'GET') {
        const row = await env.DB.prepare(
          `SELECT data, fetched_at FROM chains WHERE ticker = ? ORDER BY fetched_at DESC LIMIT 1`
        ).bind(ticker).first()
        if (!row) return new Response('Not found', { status: 404 })
        // Inject cachedAt into the JSON payload if not already present
        let payload
        try { payload = JSON.parse(row.data) } catch { payload = {} }
        if (!payload.cachedAt) payload.cachedAt = row.fetched_at
        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json', 'X-Cache-Fetched-At': String(row.fetched_at), ...CORS },
        })
      }

      if (request.method === 'POST') {
        if (env.PROXY_SECRET) {
          if (request.headers.get('x-proxy-secret') !== env.PROXY_SECRET) {
            return new Response('Forbidden', { status: 403 })
          }
        }
        let body
        try {
          body = await request.text()
          JSON.parse(body)
        } catch {
          return new Response('Invalid JSON body', { status: 400 })
        }
        // Stamp cachedAt into the stored payload
        const now = Math.floor(Date.now() / 1000)
        let parsed
        try { parsed = JSON.parse(body) } catch { parsed = {} }
        parsed.cachedAt = now
        body = JSON.stringify(parsed)
        await env.DB.prepare(
          `INSERT INTO chains (ticker, data, fetched_at) VALUES (?, ?, ?)`
        ).bind(ticker, body, now).run()
        return new Response(JSON.stringify({ ok: true, ticker }), {
          headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }

      return new Response('Method not allowed', { status: 405 })
    }

    // -------------------------------------------------------------------------
    // Yahoo Finance proxy — all other routes
    // -------------------------------------------------------------------------
    if (env.PROXY_SECRET) {
      const incoming = request.headers.get('x-proxy-secret')
      if (incoming !== env.PROXY_SECRET) {
        return new Response('Forbidden', { status: 403 })
      }
    }

    const parts = url.pathname.slice(1).split('/')
    const targetHost = parts[0]
    const targetPath = '/' + parts.slice(1).join('/')

    if (!ALLOWED_HOSTS.has(targetHost)) {
      return new Response(`Blocked: target host "${targetHost}" is not allowed`, { status: 400 })
    }

    const targetUrl = `https://${targetHost}${targetPath}${url.search}`
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.delete('x-proxy-secret')
    proxyHeaders.set('User-Agent', 'Mozilla/5.0 (compatible; yahoo-finance2; +https://github.com/gadicc/node-yahoo-finance2)')

    let response
    try {
      response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'follow',
      }))
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502 })
    }

    const respHeaders = new Headers(response.headers)
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v))
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: respHeaders })
  },
}

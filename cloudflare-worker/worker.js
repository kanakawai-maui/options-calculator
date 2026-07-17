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

// Ensure the chains table exists (runs once per Worker instance cold-start)
async function ensureSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS chains (
       ticker     TEXT PRIMARY KEY,
       data       TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`
  ).run()
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // -------------------------------------------------------------------------
    // Cache routes — no proxy-secret required for reads, required for writes
    // GET  /cache/:ticker  — return stored chain JSON (404 if missing)
    // POST /cache/:ticker  — upsert chain JSON (requires x-proxy-secret)
    // -------------------------------------------------------------------------
    const cacheMatch = url.pathname.match(/^\/cache\/([A-Z0-9.\-]{1,10})$/i)
    if (cacheMatch) {
      const ticker = cacheMatch[1].toUpperCase()

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-proxy-secret',
          },
        })
      }

      if (request.method === 'GET') {
        if (!env.DB) return new Response('D1 binding not configured', { status: 503 })
        await ensureSchema(env.DB)
        const row = await env.DB.prepare(
          'SELECT data, updated_at FROM chains WHERE ticker = ?'
        ).bind(ticker).first()
        if (!row) return new Response('Not found', { status: 404 })
        return new Response(row.data, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache-Updated-At': String(row.updated_at),
          },
        })
      }

      if (request.method === 'POST') {
        // Writes require the shared secret
        if (env.PROXY_SECRET) {
          const incoming = request.headers.get('x-proxy-secret')
          if (incoming !== env.PROXY_SECRET) {
            return new Response('Forbidden', { status: 403 })
          }
        }
        if (!env.DB) return new Response('D1 binding not configured', { status: 503 })
        await ensureSchema(env.DB)
        let body
        try {
          body = await request.text()
          JSON.parse(body) // validate it's parseable JSON before storing
        } catch {
          return new Response('Invalid JSON body', { status: 400 })
        }
        await env.DB.prepare(
          'INSERT OR REPLACE INTO chains (ticker, data, updated_at) VALUES (?, ?, ?)'
        ).bind(ticker, body, Math.floor(Date.now() / 1000)).run()
        return new Response(JSON.stringify({ ok: true, ticker }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }

      return new Response('Method not allowed', { status: 405 })
    }

    // -------------------------------------------------------------------------
    // Yahoo Finance proxy — all other routes
    // -------------------------------------------------------------------------

    // --- Optional shared-secret check for proxy routes ---
    if (env.PROXY_SECRET) {
      const incoming = request.headers.get('x-proxy-secret')
      if (incoming !== env.PROXY_SECRET) {
        return new Response('Forbidden', { status: 403 })
      }
    }


    // Path format: /<targetHost>/<rest-of-path>
    // e.g. /query1.finance.yahoo.com/v7/finance/options/AAPL?...
    const parts = url.pathname.slice(1).split('/')  // drop leading /
    const targetHost = parts[0]
    const targetPath = '/' + parts.slice(1).join('/')

    if (!ALLOWED_HOSTS.has(targetHost)) {
      return new Response(`Blocked: target host "${targetHost}" is not allowed`, {
        status: 400,
      })
    }

    const targetUrl = `https://${targetHost}${targetPath}${url.search}`

    // Forward the request, stripping our custom header so Yahoo never sees it
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.delete('x-proxy-secret')
    // Ensure Yahoo sees a browser-like User-Agent to avoid blocks
    proxyHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (compatible; yahoo-finance2; +https://github.com/gadicc/node-yahoo-finance2)',
    )

    const upstreamRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    })

    let response
    try {
      response = await fetch(upstreamRequest)
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502 })
    }

    // Return the upstream response with CORS headers so browsers can also call
    // this worker directly if needed.
    const respHeaders = new Headers(response.headers)
    respHeaders.set('Access-Control-Allow-Origin', '*')
    respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    respHeaders.set('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    })
  },
}

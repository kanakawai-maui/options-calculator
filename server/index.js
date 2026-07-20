require('dotenv').config()

// ---------------------------------------------------------------------------
// Yahoo Finance proxy — intercepts outbound fetch calls made by yahoo-finance2
// and reroutes them through a Cloudflare Worker when YAHOO_PROXY_URL is set.
//
// This is needed because Yahoo Finance blocks Render free-tier IP ranges.
// Set YAHOO_PROXY_URL to your deployed *.workers.dev URL to enable the proxy.
// Set YAHOO_PROXY_SECRET to the matching CF secret binding (optional but
// recommended to prevent open-proxy abuse).
// ---------------------------------------------------------------------------
if (process.env.YAHOO_PROXY_URL) {
  const proxyBase = process.env.YAHOO_PROXY_URL.replace(/\/$/, '')
  const proxySecret = process.env.YAHOO_PROXY_SECRET || null
  const YAHOO_RE = /^https:\/\/(query1|query2)\.finance\.yahoo\.com(\/|$)/

  const _originalFetch = globalThis.fetch
  globalThis.fetch = function patchedFetch(input, init) {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (urlStr && YAHOO_RE.test(urlStr)) {
      // Rewrite:  https://query1.finance.yahoo.com/v7/…
      //       →   https://<proxyBase>/query1.finance.yahoo.com/v7/…
      const parsed = new URL(urlStr)
      const rewritten = `${proxyBase}/${parsed.host}${parsed.pathname}${parsed.search}`
      const headers = new Headers(
        (init && init.headers) ? init.headers
          : (input && typeof input === 'object' && input.headers) ? input.headers
          : {}
      )
      if (proxySecret) {
        headers.set('x-proxy-secret', proxySecret)
      }
      return _originalFetch(rewritten, { ...(init || {}), headers })
    }
    return _originalFetch(input, init)
  }

  console.log(`[proxy] Yahoo Finance requests will be routed through ${proxyBase}`)
}

const path = require('path')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const admin = require('firebase-admin')
const YahooFinance = require('yahoo-finance2').default
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

// ─── Firebase Admin (token verification only — no service account needed) ────
if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
} else {
  console.warn('[auth] FIREBASE_PROJECT_ID not set — /api/screener will be unprotected')
}

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' })
  }
  try {
    req.user = await admin.auth().verifyIdToken(token)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

const app = express()
const PORT = Number(process.env.PORT || 4000)

// Trust the first proxy hop (Render, Railway, etc.) so rate limiting uses the
// real client IP from X-Forwarded-For rather than the proxy's address.
app.set('trust proxy', 1)

// Security headers
// CSP is extended to allow the Google/Firebase origins required by Firebase Auth
// (signInWithPopup loads apis.google.com scripts and opens firebaseapp.com iframes).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': [
        "'self'",
        'https://apis.google.com',
        'https://*.gstatic.com',
      ],
      'frame-src': [
        "'self'",
        'https://*.firebaseapp.com',
        'https://accounts.google.com',
      ],
      'connect-src': [
        "'self'",
        'https://*.googleapis.com',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
        'https://*.firebaseio.com',
      ],
      'img-src': [
        "'self'",
        'data:',
        'https://*.googleapis.com',
        'https://*.gstatic.com',
      ],
    },
  },
}))

// CORS — restrict to the deployed frontend origin(s); falls back to localhost for dev
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:5173', 'http://localhost:4000']
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server) only outside production
    if (!origin) return callback(null, process.env.NODE_ENV !== 'production')
    callback(null, allowedOrigins.includes(origin))
  },
}))

app.use(express.json({ limit: '10kb' }))

// ─── Rate limiters ───────────────────────────────────────────────────────────
const makeLimit = (max, windowMs = 60_000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  })

// Global fallback — covers any route not given a specific limiter below
app.use(makeLimit(60))
// Per-route limits (applied before the route handlers)
app.use('/api/screener',      makeLimit(3))   // each call spawns ≤120 upstream reqs
app.use('/api/option-chain',  makeLimit(20))
app.use('/api/search',        makeLimit(30))
app.use('/api/market-status', makeLimit(10))
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/health', (_, response) => {
  response.json({ ok: true })
})

// Proxy for Yahoo Finance market status (browser can't call Yahoo directly
// because Yahoo doesn't send CORS headers). Uses yahoo-finance2's chart()
// which handles the cookie/crumb handshake so we don't get rate-limited.
app.get('/api/market-status', async (_, response) => {
  try {
    const now = new Date()
    const period1 = new Date(now)
    period1.setHours(0, 0, 0, 0)
    const chart = await yahooFinance.chart('SPY', {
      interval: '1m',
      period1,
      period2: now,
      includePrePost: false,
      return: 'object',
    })
    const regular = chart?.meta?.currentTradingPeriod?.regular ?? null
    response.json({
      start: regular?.start ? toUnixSeconds(regular.start) : null,
      end: regular?.end ? toUnixSeconds(regular.end) : null,
    })
  } catch (err) {
    console.error('[market-status]', err?.message || err)
    response.status(500).json({ error: 'Market status unavailable.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function toUnixSeconds(value) {
  if (value == null) return null
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? Math.round(value / 1000) : Math.round(value)
  }
  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) return null
  return Math.round(parsed / 1000)
}

function normalizeContract(contract) {
  return {
    contractSymbol: contract.contractSymbol,
    strike: Number(contract.strike),
    expiration: toUnixSeconds(contract.expiration),
    bid: Number(contract.bid) || 0,
    ask: Number(contract.ask) || 0,
    mark: Number(contract.regularMarketPrice) || 0,
    lastPrice: Number(contract.lastPrice) || 0,
    impliedVolatility: Number(contract.impliedVolatility) || null,
    inTheMoney: Boolean(contract.inTheMoney),
    volume: Number(contract.volume) || 0,
    openInterest: Number(contract.openInterest) || 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screener
// ─────────────────────────────────────────────────────────────────────────────

const SCREENER_DEFAULT_UNIVERSE = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD',
  // High-IV / retail favorites
  'PLTR', 'SOFI', 'COIN', 'MARA', 'RIOT', 'GME', 'SMCI', 'ARM', 'MU', 'INTC',
  'CRWD', 'SHOP', 'UBER', 'BABA',
  // Broad-market ETFs
  'SPY', 'QQQ', 'IWM', 'DIA',
  // Financials / cyclicals
  'JPM', 'BAC', 'F',
  // Energy / commodities
  'XOM', 'CVX', 'GLD', 'SLV', 'TLT', 'HYG',
]

function nearest(arr, target) {
  if (!arr.length) return null
  return arr.reduce((best, c) =>
    Math.abs(c.strike - target) < Math.abs(best.strike - target) ? c : best,
  )
}
function nearestAbove(arr, target) {
  const above = arr.filter((c) => c.strike >= target)
  if (!above.length) return null
  return above.reduce((best, c) => (c.strike < best.strike ? c : best))
}
function nearestBelow(arr, target) {
  const below = arr.filter((c) => c.strike <= target)
  if (!below.length) return null
  return below.reduce((best, c) => (c.strike > best.strike ? c : best))
}
function avgOf(nums) {
  const clean = nums.filter((n) => Number.isFinite(n))
  if (!clean.length) return null
  return clean.reduce((s, n) => s + n, 0) / clean.length
}

async function screenTicker(symbol, targetDTE) {
  const [quote, optionsMeta] = await Promise.all([
    yahooFinance.quote(symbol),
    yahooFinance.options(symbol),
  ])

  const spot = Number(quote.regularMarketPrice)
  if (!spot) throw new Error('no spot price')

  const expirations = (optionsMeta.expirationDates || [])
    .map(toUnixSeconds)
    .filter((v) => Number.isFinite(v))
  if (!expirations.length) throw new Error('no expirations')

  const nowSec = Date.now() / 1000
  const targetSec = nowSec + Math.max(1, targetDTE) * 86400
  const chosenExp = expirations.reduce((best, e) =>
    Math.abs(e - targetSec) < Math.abs(best - targetSec) ? e : best,
  )
  const dte = Math.max(1, Math.round((chosenExp - nowSec) / 86400))

  const chainData = await yahooFinance.options(symbol, {
    date: new Date(chosenExp * 1000),
  })
  const chain = chainData.options?.[0] || { calls: [], puts: [] }
  const calls = (chain.calls || []).map(normalizeContract).filter((c) => c.strike > 0)
  const puts = (chain.puts || []).map(normalizeContract).filter((c) => c.strike > 0)

  if (!calls.length && !puts.length) throw new Error('empty chain')

  // ATM IV — average of nearest-to-spot call & put IV
  const atmCall = nearest(calls.filter((c) => c.impliedVolatility > 0), spot)
  const atmPut = nearest(puts.filter((p) => p.impliedVolatility > 0), spot)
  const atmIV = avgOf([atmCall?.impliedVolatility, atmPut?.impliedVolatility])

  // IV Skew — OTM put (~-10%) minus OTM call (~+10%)
  const otmCallForSkew = nearestAbove(
    calls.filter((c) => c.impliedVolatility > 0),
    spot * 1.1,
  )
  const otmPutForSkew = nearestBelow(
    puts.filter((p) => p.impliedVolatility > 0),
    spot * 0.9,
  )
  const ivSkew =
    otmPutForSkew?.impliedVolatility && otmCallForSkew?.impliedVolatility
      ? otmPutForSkew.impliedVolatility - otmCallForSkew.impliedVolatility
      : null

  // Volume / OI aggregates
  const totalCallVol = calls.reduce((s, c) => s + c.volume, 0)
  const totalPutVol = puts.reduce((s, c) => s + c.volume, 0)
  const totalCallOI = calls.reduce((s, c) => s + c.openInterest, 0)
  const totalPutOI = puts.reduce((s, c) => s + c.openInterest, 0)

  // Average bid-ask spread % on 10 strikes closest to spot (liquidity proxy)
  const nearSpot = [...calls, ...puts]
    .filter((c) => c.bid > 0 && c.ask > 0)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, 10)
  const spreadPcts = nearSpot
    .map((c) => {
      const mid = (c.bid + c.ask) / 2
      return mid > 0 ? (c.ask - c.bid) / mid : null
    })
    .filter((n) => Number.isFinite(n))
  const avgSpreadPct = spreadPcts.length ? avgOf(spreadPcts) : null

  // Max Pain
  const strikes = Array.from(
    new Set([...calls, ...puts].map((c) => c.strike)),
  ).sort((a, b) => a - b)
  let maxPain = null
  let minLoss = Infinity
  for (const K of strikes) {
    let loss = 0
    for (const c of calls) loss += c.openInterest * Math.max(K - c.strike, 0)
    for (const p of puts) loss += p.openInterest * Math.max(p.strike - K, 0)
    if (loss < minLoss) {
      minLoss = loss
      maxPain = K
    }
  }

  return {
    symbol,
    name: quote.shortName || quote.longName || symbol,
    price: spot,
    changePct: Number(quote.regularMarketChangePercent) || null,
    expiration: chosenExp,
    dte,
    atmIV,
    ivSkew,
    totalVolume: totalCallVol + totalPutVol,
    totalOI: totalCallOI + totalPutOI,
    putCallOI: totalCallOI > 0 ? totalPutOI / totalCallOI : null,
    avgSpreadPct,
    maxPain,
    maxPainPct: maxPain != null ? (maxPain - spot) / spot : null,
    strikeCount: strikes.length,
  }
}

app.post('/api/screener', requireAuth, async (request, response) => {
  const targetDTE = Math.min(Math.max(Number(request.body?.targetDTE) || 30, 1), 365)
  const rawTickers =
    Array.isArray(request.body?.tickers) && request.body.tickers.length > 0
      ? request.body.tickers
      : SCREENER_DEFAULT_UNIVERSE

  const tickers = Array.from(
    new Set(
      rawTickers
        .map((t) => String(t).trim().toUpperCase())
        .filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)),
    ),
  ).slice(0, 60)

  if (!tickers.length) {
    response.json({ rows: [], errors: [] })
    return
  }

  const settled = await Promise.allSettled(
    tickers.map((t) => screenTicker(t, targetDTE)),
  )

  const rows = []
  const errors = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push(r.value)
    else errors.push({ symbol: tickers[i], message: r.reason?.message || 'failed' })
  })

  response.json({ rows, errors, universe: tickers, targetDTE })
})

app.get('/api/search', async (request, response) => {
  const query = String(request.query.q || '').trim()
  if (!query) {
    response.json({ results: [] })
    return
  }

  try {
    const data = await yahooFinance.search(query, { quotesCount: 8, newsCount: 0 })
    const results = (data.quotes || [])
      .filter((q) => ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(q.quoteType))
      .slice(0, 7)
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        quoteType: q.quoteType,
      }))
    response.json({ results })
  } catch (error) {
    console.error('[search]', error?.message || error)
    response.status(500).json({ results: [], error: 'Search unavailable.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// D1 cache reader — reads the most recent prefetched chain from CF Worker
// Active when CACHE_WORKER_URL is set in env.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromD1Cache(ticker) {
  const baseUrl = process.env.CACHE_WORKER_URL
  if (!baseUrl) throw new Error('CACHE_WORKER_URL not configured')
  const url = `${baseUrl.replace(/\/$/, '')}/cache/${encodeURIComponent(ticker)}`
  const res = await fetch(url)
  if (res.status === 404) throw new Error(`No cached data for ${ticker}`)
  if (!res.ok) throw new Error(`D1 cache ${res.status}: ${res.statusText}`)
  const data = await res.json()
  return { ...data, source: 'D1 cache (prefetched)' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Massive API — backup option chain provider (active when MASSIVE_API_KEY is set)
// Requires Options Starter plan or higher: https://massive.com
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromMassive(ticker, requestedExpiration) {
  const apiKey = process.env.MASSIVE_API_KEY
  if (!apiKey) throw new Error('MASSIVE_API_KEY not configured')

  const base = 'https://api.massive.com'

  // Step 1: Get available expiration dates from the reference contracts endpoint
  const refUrl =
    `${base}/v3/reference/options/contracts` +
    `?underlying_ticker=${encodeURIComponent(ticker)}` +
    `&expired=false&order=asc&sort=expiration_date&limit=1000&apiKey=${apiKey}`
  const refRes = await fetch(refUrl)
  if (!refRes.ok) throw new Error(`Massive contracts ${refRes.status}: ${refRes.statusText}`)
  const refData = await refRes.json()

  if (!refData.results?.length) throw new Error('Massive: no contracts found')

  // Deduplicate expiration dates (YYYY-MM-DD) → unix seconds
  // Use 20:00 UTC as a stable anchor (≈ 4pm ET, options expiry close)
  const expDateSet = new Set()
  for (const c of refData.results) {
    if (c.expiration_date) expDateSet.add(c.expiration_date)
  }
  const sortedDates = Array.from(expDateSet).sort()
  const expirationDates = sortedDates.map(d =>
    Math.round(new Date(d + 'T20:00:00Z').getTime() / 1000),
  )

  if (!expirationDates.length) throw new Error('Massive: no expiration dates parsed')

  // Step 2: Select closest expiration to the requested one, or default to ~30 days out
  const _nowSec = Date.now() / 1000
  let selectedExpiration
  if (requestedExpiration) {
    selectedExpiration = expirationDates.reduce((best, e) =>
      Math.abs(e - requestedExpiration) < Math.abs(best - requestedExpiration) ? e : best,
    )
  } else {
    const _target30 = _nowSec + 30 * 86400
    selectedExpiration = expirationDates.reduce((best, e) =>
      Math.abs(e - _target30) < Math.abs(best - _target30) ? e : best,
    )
  }
  const selectedDate = sortedDates[expirationDates.indexOf(selectedExpiration)]

  // Step 3: Fetch option chain snapshot for the selected expiration
  const chainUrl =
    `${base}/v3/snapshot/options/${encodeURIComponent(ticker)}` +
    `?expiration_date=${selectedDate}&limit=250&apiKey=${apiKey}`
  const chainRes = await fetch(chainUrl)
  if (!chainRes.ok) throw new Error(`Massive chain ${chainRes.status}: ${chainRes.statusText}`)
  const chainData = await chainRes.json()

  if (!chainData.results?.length) throw new Error(`Massive: empty chain for ${selectedDate}`)

  // Step 4: Normalize to the same contract shape the client expects
  const spotPrice = chainData.results[0]?.underlying_asset?.price ?? null
  const calls = []
  const puts = []

  for (const r of chainData.results) {
    const d = r.details || {}
    const q = r.last_quote || {}
    const strike = Number(d.strike_price) || 0
    if (!strike || !d.contract_type) continue

    const bid = Number(q.bid) || 0
    const ask = Number(q.ask) || 0
    const mark = q.midpoint != null ? Number(q.midpoint) : (bid + ask) / 2

    const contract = {
      contractSymbol: (d.ticker || '').replace(/^O:/, ''),
      strike,
      expiration: selectedExpiration,
      bid,
      ask,
      mark,
      lastPrice: r.last_trade?.price != null ? Number(r.last_trade.price) : mark,
      impliedVolatility: r.implied_volatility != null ? Number(r.implied_volatility) : null,
      inTheMoney: spotPrice != null
        ? (d.contract_type === 'call' ? spotPrice > strike : spotPrice < strike)
        : false,
      volume: Number(r.day?.volume) || 0,
      openInterest: Number(r.open_interest) || 0,
    }

    if (d.contract_type === 'call') calls.push(contract)
    else if (d.contract_type === 'put') puts.push(contract)
  }

  return {
    ticker,
    quote: {
      symbol: ticker,
      regularMarketPrice: spotPrice,
      regularMarketChangePercent: null,
    },
    expirationDates,
    selectedExpiration,
    optionChain: { calls, puts },
    source: 'Massive API (backup provider)',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback demo data (used when Yahoo Finance is rate-limited)
// Generates a synthetic AAPL-like option chain using a simplified BSM approach
// ─────────────────────────────────────────────────────────────────────────────

function generateFallbackChain(ticker, requestedExpiration) {
  const spot = 210.00
  const now = Math.floor(Date.now() / 1000)
  const day = 86400

  // Four synthetic expirations relative to now
  const expirationDates = [
    now + 2 * day,
    now + 9 * day,
    now + 30 * day,
    now + 64 * day,
  ].map(v => Math.round(v))

  const selectedExpiration =
    requestedExpiration && expirationDates.includes(requestedExpiration)
      ? requestedExpiration
      : expirationDates[2]

  const T = Math.max((selectedExpiration - now) / (365 * day), 1 / 365)
  const iv = 0.28
  const atmTV = iv * spot * Math.sqrt(T) * 0.4

  function timeValue(moneynessFrac) {
    return atmTV * Math.exp(-0.5 * Math.pow(moneynessFrac / (iv * Math.sqrt(T)), 2))
  }

  const strikes = []
  for (let k = 155; k <= 265; k += 5) strikes.push(k)

  const expTag = new Date(selectedExpiration * 1000).toISOString().slice(2, 10).replace(/-/g, '')

  const calls = strikes.map((K) => {
    const mark = Math.max(0.01, Math.round((Math.max(spot - K, 0) + timeValue((spot - K) / spot)) * 100) / 100)
    const spread = Math.max(0.02, mark * 0.015)
    return {
      contractSymbol: `${ticker}${expTag}C${String(K * 1000).padStart(8, '0')}`,
      strike: K,
      expiration: selectedExpiration,
      bid: Math.round((mark - spread) * 100) / 100,
      ask: Math.round((mark + spread) * 100) / 100,
      mark,
      lastPrice: mark,
      impliedVolatility: Math.round((iv + (K < spot ? -0.02 : 0.02)) * 1000) / 1000,
      inTheMoney: K < spot,
      volume: Math.floor(1000 + (Math.abs(spot - K) < 10 ? 4000 : 500)),
      openInterest: Math.floor(5000 + (Math.abs(spot - K) < 15 ? 15000 : 2000)),
    }
  })

  const puts = strikes.map((K) => {
    const mark = Math.max(0.01, Math.round((Math.max(K - spot, 0) + timeValue((K - spot) / spot)) * 100) / 100)
    const spread = Math.max(0.02, mark * 0.015)
    return {
      contractSymbol: `${ticker}${expTag}P${String(K * 1000).padStart(8, '0')}`,
      strike: K,
      expiration: selectedExpiration,
      bid: Math.round((mark - spread) * 100) / 100,
      ask: Math.round((mark + spread) * 100) / 100,
      mark,
      lastPrice: mark,
      impliedVolatility: Math.round((iv + (K > spot ? -0.02 : 0.02)) * 1000) / 1000,
      inTheMoney: K > spot,
      volume: Math.floor(1000 + (Math.abs(spot - K) < 10 ? 4000 : 500)),
      openInterest: Math.floor(5000 + (Math.abs(spot - K) < 15 ? 15000 : 2000)),
    }
  })

  return {
    ticker,
    quote: { symbol: ticker, regularMarketPrice: spot, regularMarketChangePercent: 0.42 },
    expirationDates,
    selectedExpiration,
    optionChain: { calls, puts },
    source: 'Demo data (live feed unavailable)',
  }
}

app.get('/api/option-chain', async (request, response) => {
  const ticker = String(request.query.ticker || '').trim().toUpperCase()
  // Validate expiration is a plausible unix timestamp (now → +2 years)
  const _nowSec = Math.floor(Date.now() / 1000)
  const _rawExp = request.query.expiration ? Number(request.query.expiration) : null
  const expiration =
    _rawExp && Number.isFinite(_rawExp) && _rawExp > _nowSec && _rawExp < _nowSec + 2 * 365 * 86400
      ? _rawExp
      : null

  if (!ticker) {
    response.status(400).json({ error: 'Missing required query: ticker' })
    return
  }

  // When DISABLE_LIVE_FETCH is set, skip Yahoo/Massive and go straight to D1 cache
  const disableLive = process.env.DISABLE_LIVE_FETCH === 'true'

  if (!disableLive) {
    // Use Massive as primary provider when an API key is configured
    if (process.env.MASSIVE_API_KEY) {
      try {
        const result = await fetchFromMassive(ticker, expiration)
        response.json(result)
        return
      } catch (err) {
        console.error(`[option-chain] ${ticker}: Massive failed:`, err?.message || err)
      }
    } else {
      // Fall back to Yahoo Finance when no Massive key is set
      try {
        const quote = await yahooFinance.quote(ticker)

        let optionData = await yahooFinance.options(ticker)

        const expirationDates = (optionData.expirationDates || [])
          .map(toUnixSeconds)
          .filter((value) => Number.isFinite(value))

        let selectedExpiration = expiration
        if (!selectedExpiration || !expirationDates.includes(selectedExpiration)) {
          // Default to the expiration closest to ~30 days out (matches client logic)
          const nowSec = Date.now() / 1000
          const target30 = nowSec + 30 * 86400
          selectedExpiration = expirationDates.length > 0
            ? expirationDates.reduce((best, e) =>
                Math.abs(e - target30) < Math.abs(best - target30) ? e : best)
            : null
        }

        if (selectedExpiration) {
          optionData = await yahooFinance.options(ticker, {
            date: new Date(selectedExpiration * 1000),
          })
        }

        const chain = optionData.options?.[0] || { calls: [], puts: [] }

        response.json({
          ticker,
          quote: {
            symbol: quote.symbol,
            regularMarketPrice: Number(quote.regularMarketPrice) || null,
            regularMarketChangePercent: Number(quote.regularMarketChangePercent) || null,
          },
          expirationDates,
          selectedExpiration,
          optionChain: {
            calls: (chain.calls || []).map(normalizeContract),
            puts: (chain.puts || []).map(normalizeContract),
          },
          source: 'Yahoo Finance via yahoo-finance2',
        })
        return
      } catch (error) {
        console.error(`[option-chain] ${ticker}:`, error?.message || error)
      }
    }
  } else {
    console.log(`[option-chain] ${ticker}: live fetch disabled, using D1 cache`)
  }

  // D1 cache — last resort before synthetic data
  if (process.env.CACHE_WORKER_URL) {
    try {
      const cached = await fetchFromD1Cache(ticker)
      response.json(cached)
      return
    } catch (cacheErr) {
      console.error(`[option-chain] ${ticker}: D1 cache failed:`, cacheErr?.message || cacheErr)
    }
  }

  response.json(generateFallbackChain(ticker, expiration))
})

// Serve built React client
const clientDist = path.join(__dirname, '..', 'client', 'dist')
app.use(express.static(clientDist))

app.listen(PORT, () => {
  console.log(`Options API server listening on http://localhost:${PORT}`)
})

// Catch-all: return index.html for client-side routes
app.use((_, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

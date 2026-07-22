/**
 * scripts/prefetch.js
 *
 * Populates the D1 option-chain cache by fetching from Yahoo Finance locally.
 * Home/residential IPs are not rate-limited by Yahoo like cloud/datacenter IPs.
 *
 * Usage:
 *   node scripts/prefetch.js                   # all tickers, default concurrency
 *   node scripts/prefetch.js AAPL MSFT         # specific tickers only
 *   node scripts/prefetch.js --concurrency 2   # reduce parallel ticker count (default: 4)
 *
 * Requires scripts/.env (copy from scripts/.env.example):
 *   CACHE_WORKER_URL=https://your-worker.workers.dev
 *   PROXY_SECRET=your_secret_here              # leave blank if not set
 *
 * Performance:
 *   4 tickers × 3 expirations concurrently ≈ 30–40s for 37 tickers with all expirations.
 *   Exponential backoff on 429 / network errors. Inter-batch jitter prevents burst spikes.
 */

const path = require('path')
const fs   = require('fs')
const serverRoot = path.join(__dirname, '..', 'server')

require(path.join(serverRoot, 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '.env'),
})

const YahooFinance = require(
  path.join(serverRoot, 'node_modules', 'yahoo-finance2')
).default
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

const CACHE_WORKER_URL = (process.env.CACHE_WORKER_URL || '').replace(/\/$/, '')
const PROXY_SECRET = process.env.PROXY_SECRET || ''

if (!CACHE_WORKER_URL) {
  console.error('ERROR: CACHE_WORKER_URL is not set in scripts/.env')
  process.exit(1)
}

// Mirrors SCREENER_DEFAULT_UNIVERSE in server/index.js
const DEFAULT_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD',
  'PLTR', 'SOFI', 'COIN', 'MARA', 'RIOT', 'GME', 'SMCI', 'ARM', 'MU', 'INTC',
  'CRWD', 'SHOP', 'UBER', 'BABA',
  'SPY', 'QQQ', 'IWM', 'DIA',
  'JPM', 'BAC', 'F',
  'XOM', 'CVX', 'GLD', 'SLV', 'TLT', 'HYG',
]

// Number of expiration dates fetched concurrently per ticker.
// Keep at 3 to stay well within Yahoo's undocumented rate limits.
const EXP_CONCURRENCY = 3

const LAST_RUN_FILE = path.join(__dirname, '.last-run')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUnixSeconds(value) {
  if (value == null) return null
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? Math.round(value / 1000) : Math.round(value)
  }
  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) return null
  return Math.round(parsed / 1000)
}

// Normalized contract — drops contractSymbol (unused client-side),
// pre-computes a definitive mark price so clients always have a reliable value.
function normalizeContract(contract) {
  const bid       = Number(contract.bid)       || 0
  const ask       = Number(contract.ask)       || 0
  const lastPrice = Number(contract.lastPrice) || 0
  const rawMark   = Number(contract.regularMarketPrice) || 0
  const mark = rawMark > 0
    ? rawMark
    : (bid > 0 && ask > 0)
      ? Math.round(((bid + ask) / 2) * 100) / 100
      : lastPrice > 0 ? lastPrice : 0
  return {
    strike:            Number(contract.strike),
    expiration:        toUnixSeconds(contract.expiration),
    bid,
    ask,
    mark,
    lastPrice,
    impliedVolatility: Number(contract.impliedVolatility) || null,
    inTheMoney:        Boolean(contract.inTheMoney),
    volume:            Number(contract.volume)       || 0,
    openInterest:      Number(contract.openInterest) || 0,
  }
}

// Retry with exponential backoff + full jitter. Handles 429s and network errors.
async function withRetry(fn, { retries = 3, baseMs = 1000, label = '' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      const status = err?.status ?? err?.response?.status ?? null
      const is429  = status === 429 || /429|rate.?limit|too.?many/i.test(err?.message || '')
      const delay  = (baseMs * Math.pow(2, attempt)) + Math.random() * baseMs
      process.stderr.write(
        `  [retry ${attempt + 1}/${retries}]${label ? ' ' + label : ''}${is429 ? ' (429)' : ''} — wait ${Math.round(delay)}ms\n`
      )
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// Run fn(item) on up to `limit` items concurrently.
// Errors must be handled inside fn — this function never throws.
async function pooled(items, limit, fn) {
  let i = 0
  async function worker() {
    while (i < items.length) {
      const item = items[i++]
      await fn(item).catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function pushToCache(ticker, data) {
  const url = `${CACHE_WORKER_URL}/cache/${ticker}`
  const headers = { 'Content-Type': 'application/json' }
  if (PROXY_SECRET) headers['x-proxy-secret'] = PROXY_SECRET
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker ${res.status}: ${text.slice(0, 120)}`)
  }
}

function readLastRun() {
  try {
    const ts = parseInt(fs.readFileSync(LAST_RUN_FILE, 'utf8').trim(), 10)
    return Number.isFinite(ts) ? ts : null
  } catch { return null }
}

function writeLastRun() {
  fs.writeFileSync(LAST_RUN_FILE, String(Math.floor(Date.now() / 1000)), 'utf8')
}

async function fetchHotTickers(since) {
  try {
    const res = await fetch(`${CACHE_WORKER_URL}/access/hot?since=${since}`)
    if (!res.ok) return []
    const json = await res.json()
    return (json || []).map(r => r.ticker).filter(Boolean)
  } catch { return [] }
}

// ─── Expiration selection ─────────────────────────────────────────────────────

// Returns true if a Unix-second timestamp falls on the third Friday of its UTC month
// (i.e. standard monthly options expiration).
function isMonthlyExpiration(ts) {
  const d = new Date(ts * 1000)
  if (d.getUTCDay() !== 5) return false            // must be Friday
  const dom = d.getUTCDate()
  return dom >= 15 && dom <= 21                    // 3rd Friday is always day 15–21
}

// From the full Yahoo expiration list, pick:
//   1. All dates within the next ~6 weeks (weekly/near-term coverage)
//   2. Standard monthly expirations up to ~6 months out
//   3. The single longest-dated LEAP (> 1 year out)
function selectExpirations(timestamps) {
  const nowSec       = Math.floor(Date.now() / 1000)
  const sixWeeks     = nowSec + 6  * 7  * 24 * 3600
  const sixMonths    = nowSec + 6  * 30 * 24 * 3600
  const oneYear      = nowSec + 365     * 24 * 3600

  const selected = new Set()

  for (const ts of timestamps) {
    if (ts <= sixWeeks)                           selected.add(ts)  // near-term
    else if (ts <= sixMonths && isMonthlyExpiration(ts)) selected.add(ts)  // monthly ≤6 mo
  }

  // Longest-dated LEAP
  const leaps = timestamps.filter(ts => ts > oneYear)
  if (leaps.length) selected.add(leaps[leaps.length - 1])

  return timestamps.filter(ts => selected.has(ts))
}

// ─── Per-ticker fetch ─────────────────────────────────────────────────────────

async function processTicker(ticker) {
  // One round trip: quote + expiration list in parallel
  const [quote, optionsMeta] = await withRetry(
    () => Promise.all([yf.quote(ticker), yf.options(ticker)]),
    { retries: 3, baseMs: 1000, label: `${ticker} meta` }
  )

  const allExpirations = (optionsMeta.expirationDates || [])
    .map(toUnixSeconds)
    .filter(v => Number.isFinite(v))

  const expirationDates = selectExpirations(allExpirations)

  if (!expirationDates.length) throw new Error('no expirations')

  const quoteData = {
    symbol:                     quote.symbol,
    regularMarketPrice:         Number(quote.regularMarketPrice)         || null,
    regularMarketChangePercent: Number(quote.regularMarketChangePercent) || null,
  }

  let expOk = 0, expFail = 0

  // Fetch all expirations with limited concurrency
  await pooled(expirationDates, EXP_CONCURRENCY, async (expiration) => {
    try {
      const chainData = await withRetry(
        () => yf.options(ticker, { date: new Date(expiration * 1000) }),
        { retries: 3, baseMs: 800, label: `${ticker} chain:${expiration}` }
      )
      const chain = chainData.options?.[0] || { calls: [], puts: [] }
      const payload = {
        ticker,
        selectedExpiration: expiration,
        expirationDates,
        quote: quoteData,
        optionChain: {
          calls: (chain.calls || []).map(normalizeContract).filter(c => c.strike > 0),
          puts:  (chain.puts  || []).map(normalizeContract).filter(c => c.strike > 0),
        },
        source:   'D1 cache (prefetched locally)',
        cachedAt: Math.floor(Date.now() / 1000),
      }
      await withRetry(
        () => pushToCache(ticker, payload),
        { retries: 2, baseMs: 500, label: `${ticker} push:${expiration}` }
      )
      expOk++
    } catch (err) {
      expFail++
      process.stderr.write(`  [skip] ${ticker} exp:${expiration} — ${err.message}\n`)
    }
  })

  return { expOk, expTotal: expirationDates.length, expFail }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Parse --concurrency N (must appear before or after ticker names)
  const argv = process.argv.slice(2)
  let TICKER_CONCURRENCY = 4
  const concIdx = argv.indexOf('--concurrency')
  if (concIdx !== -1 && argv[concIdx + 1]) {
    const v = parseInt(argv[concIdx + 1], 10)
    if (v >= 1 && v <= 10) TICKER_CONCURRENCY = v
    argv.splice(concIdx, 2)
  }

  let tickers
  if (argv.length) {
    tickers = argv.map(t => t.toUpperCase())
  } else {
    const lastRun = readLastRun() ?? Math.floor(Date.now() / 1000) - 86400
    const hotTickers = await fetchHotTickers(lastRun)
    if (hotTickers.length) {
      console.log(`Prioritizing ${hotTickers.length} hot: ${hotTickers.join(', ')}`)
    }
    const hotSet = new Set(hotTickers)
    tickers = [...hotTickers, ...DEFAULT_TICKERS.filter(t => !hotSet.has(t))]
  }

  const startMs = Date.now()
  console.log(
    `Prefetching ${tickers.length} ticker(s) [ticker-p=${TICKER_CONCURRENCY}, exp-p=${EXP_CONCURRENCY}] → ${CACHE_WORKER_URL}\n`
  )

  let ok = 0, fail = 0

  // Process tickers in batches of TICKER_CONCURRENCY; print results after each batch
  for (let i = 0; i < tickers.length; i += TICKER_CONCURRENCY) {
    const batch = tickers.slice(i, i + TICKER_CONCURRENCY)

    const lines = await Promise.all(batch.map(async (ticker) => {
      try {
        const { expOk, expTotal, expFail } = await processTicker(ticker)
        ok++
        const note = expFail ? `, ${expFail} failed` : ''
        return `  ${ticker.padEnd(6)} ✓  ${expOk}/${expTotal} exps${note}`
      } catch (err) {
        fail++
        return `  ${ticker.padEnd(6)} ✗  ${err.message}`
      }
    }))

    lines.forEach(l => console.log(l))

    // Inter-batch jitter: 100–200ms to spread request bursts
    if (i + TICKER_CONCURRENCY < tickers.length) {
      await new Promise(r => setTimeout(r, 100 + Math.random() * 100))
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`\nDone: ${ok} ok, ${fail} failed in ${elapsed}s`)

  if (!argv.length) {
    writeLastRun()
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})

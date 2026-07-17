/**
 * scripts/prefetch.js
 *
 * Run this locally to populate the D1 option-chain cache via the CF Worker.
 * Your home IP is not blocked by Yahoo Finance, so fetches succeed here.
 *
 * Usage:
 *   node scripts/prefetch.js              # fetch all tickers
 *   node scripts/prefetch.js AAPL MSFT    # fetch specific tickers only
 *
 * Requires a scripts/.env file (copy from scripts/.env.example):
 *   CACHE_WORKER_URL=https://yahoo-finance-proxy.rob-b31.workers.dev
 *   PROXY_SECRET=your_secret_here         # leave blank if not set
 */

// Resolve dotenv and yahoo-finance2 from the server's node_modules
const path = require('path')
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

// Tickers to prefetch — mirrors SCREENER_DEFAULT_UNIVERSE in server/index.js
const DEFAULT_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD',
  'PLTR', 'SOFI', 'COIN', 'MARA', 'RIOT', 'GME', 'SMCI', 'ARM', 'MU', 'INTC',
  'CRWD', 'SHOP', 'UBER', 'BABA',
  'SPY', 'QQQ', 'IWM', 'DIA',
  'JPM', 'BAC', 'F',
  'XOM', 'CVX', 'GLD', 'SLV', 'TLT', 'HYG',
]

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

async function fetchChain(ticker) {
  const [quote, optionsMeta] = await Promise.all([
    yf.quote(ticker),
    yf.options(ticker),
  ])

  const expirationDates = (optionsMeta.expirationDates || [])
    .map(toUnixSeconds)
    .filter((v) => Number.isFinite(v))

  if (!expirationDates.length) throw new Error('no expiration dates')

  // Fetch chain for the nearest expiration (~30 days out)
  const nowSec = Date.now() / 1000
  const target30d = nowSec + 30 * 86400
  const selectedExpiration = expirationDates.reduce((best, e) =>
    Math.abs(e - target30d) < Math.abs(best - target30d) ? e : best,
  )

  const chainData = await yf.options(ticker, {
    date: new Date(selectedExpiration * 1000),
  })
  const chain = chainData.options?.[0] || { calls: [], puts: [] }

  return {
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
    source: 'D1 cache (prefetched locally)',
    cachedAt: Math.floor(Date.now() / 1000),
  }
}

async function pushToCache(ticker, data) {
  const url = `${CACHE_WORKER_URL}/cache/${ticker}`
  const headers = { 'Content-Type': 'application/json' }
  if (PROXY_SECRET) headers['x-proxy-secret'] = PROXY_SECRET

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker responded ${res.status}: ${text}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tickers = process.argv.slice(2).length
    ? process.argv.slice(2).map((t) => t.toUpperCase())
    : DEFAULT_TICKERS

  console.log(`Prefetching ${tickers.length} ticker(s) → ${CACHE_WORKER_URL}\n`)

  let ok = 0
  let fail = 0

  for (const ticker of tickers) {
    try {
      process.stdout.write(`  ${ticker.padEnd(6)} fetch...`)
      const data = await fetchChain(ticker)
      process.stdout.write(` push...`)
      await pushToCache(ticker, data)
      const calls = data.optionChain.calls.length
      const puts = data.optionChain.puts.length
      console.log(` ✓  (${calls} calls, ${puts} puts)`)
      ok++
    } catch (err) {
      console.log(` ✗  ${err.message}`)
      fail++
    }

    // Small delay between tickers to avoid rate limits
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`\nDone: ${ok} succeeded, ${fail} failed`)
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})

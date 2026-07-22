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

// Fetch quote + expiration dates for a ticker (single call)
async function fetchMeta(ticker) {
  const [quote, optionsMeta] = await Promise.all([
    yf.quote(ticker),
    yf.options(ticker),
  ])
  const expirationDates = (optionsMeta.expirationDates || [])
    .map(toUnixSeconds)
    .filter((v) => Number.isFinite(v))
  if (!expirationDates.length) throw new Error('no expiration dates')
  return { quote, expirationDates }
}

// Fetch chain data for one specific expiration and return the cache payload
async function fetchChainForExpiration(ticker, selectedExpiration, expirationDates, quote) {
  const chainData = await yf.options(ticker, {
    date: new Date(selectedExpiration * 1000),
  })
  const chain = chainData.options?.[0] || { calls: [], puts: [] }

  return {
    ticker,
    selectedExpiration,
    expirationDates,
    quote: {
      symbol: quote.symbol,
      regularMarketPrice: Number(quote.regularMarketPrice) || null,
      regularMarketChangePercent: Number(quote.regularMarketChangePercent) || null,
    },
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

// ─── Hot-ticker prioritization ────────────────────────────────────────────────

const fs = require('fs')
const LAST_RUN_FILE = path.join(__dirname, '.last-run')

function readLastRun() {
  try {
    const ts = parseInt(fs.readFileSync(LAST_RUN_FILE, 'utf8').trim(), 10)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

function writeLastRun() {
  fs.writeFileSync(LAST_RUN_FILE, String(Math.floor(Date.now() / 1000)), 'utf8')
}

async function fetchHotTickers(since) {
  try {
    const url = `${CACHE_WORKER_URL}/access/hot?since=${since}`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    return (json || []).map((r) => r.ticker).filter(Boolean)
  } catch {
    return []
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let tickers
  if (process.argv.slice(2).length) {
    tickers = process.argv.slice(2).map((t) => t.toUpperCase())
  } else {
    // Fetch hot tickers (recently accessed) and move them to the front
    const lastRun = readLastRun() ?? Math.floor(Date.now() / 1000) - 86400
    const hotTickers = await fetchHotTickers(lastRun)
    if (hotTickers.length) {
      console.log(`Prioritizing ${hotTickers.length} hot ticker(s): ${hotTickers.join(', ')}`)
    }
    // Deduplicate: hot first, then the rest of DEFAULT_TICKERS not already in hot
    const hotSet = new Set(hotTickers)
    tickers = [...hotTickers, ...DEFAULT_TICKERS.filter((t) => !hotSet.has(t))]
  }

  console.log(`Prefetching ${tickers.length} ticker(s) → ${CACHE_WORKER_URL}\n`)

  let ok = 0
  let fail = 0

  for (const ticker of tickers) {
    try {
      process.stdout.write(`  ${ticker.padEnd(6)} fetch meta...`)
      const { quote, expirationDates } = await fetchMeta(ticker)
      process.stdout.write(` ${expirationDates.length} expirations...`)

      let expOk = 0
      let expFail = 0
      for (const expiration of expirationDates) {
        try {
          const data = await fetchChainForExpiration(ticker, expiration, expirationDates, quote)
          await pushToCache(ticker, data)
          expOk++
        } catch (expErr) {
          expFail++
        }
        // Small delay between expirations to avoid rate limits
        await new Promise((r) => setTimeout(r, 300))
      }

      console.log(` ✓  (${expOk}/${expirationDates.length} expirations${expFail ? `, ${expFail} failed` : ''})`)
      ok++
    } catch (err) {
      console.log(` ✗  ${err.message}`)
      fail++
    }

    // Delay between tickers
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`\nDone: ${ok} succeeded, ${fail} failed`)

  if (!process.argv.slice(2).length) {
    writeLastRun()
    console.log(`Last-run timestamp saved to ${LAST_RUN_FILE}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})

require('dotenv').config()

const path = require('path')
const express = require('express')
const cors = require('cors')
const YahooFinance = require('yahoo-finance2').default
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

const app = express()
const PORT = Number(process.env.PORT || 4000)

app.use(cors())
app.use(express.json())

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
    response.status(500).json({ error: err?.message || 'market-status failed' })
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

app.post('/api/screener', async (request, response) => {
  const targetDTE = Number(request.body?.targetDTE) || 30
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
    response
      .status(500)
      .json({ results: [], error: error instanceof Error ? error.message : 'Search failed' })
  }
})

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
  const expiration = request.query.expiration ? Number(request.query.expiration) : null

  if (!ticker) {
    response.status(400).json({ error: 'Missing required query: ticker' })
    return
  }

  try {
    const quote = await yahooFinance.quote(ticker)

    let optionData = await yahooFinance.options(ticker)

    const expirationDates = (optionData.expirationDates || [])
      .map(toUnixSeconds)
      .filter((value) => Number.isFinite(value))

    let selectedExpiration = expiration
    if (!selectedExpiration || !expirationDates.includes(selectedExpiration)) {
      selectedExpiration = expirationDates[0] || null
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
   } catch (error) {
     console.error(`[option-chain] ${ticker}:`, error?.message || error)
     response.json(generateFallbackChain(ticker, expiration))
   }
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

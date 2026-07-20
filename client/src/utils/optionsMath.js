function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  let probability =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))

  if (x > 0) {
    probability = 1 - probability
  }

  return probability
}

export function blackScholes({ stockPrice, strike, timeYears, volatility, rate, optionType }) {
  if (timeYears <= 0 || volatility <= 0) {
    if (optionType === 'call') {
      return Math.max(stockPrice - strike, 0)
    }
    return Math.max(strike - stockPrice, 0)
  }

  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  const d2 = d1 - sigmaSqrtT

  if (optionType === 'call') {
    return (
      stockPrice * normalCdf(d1) - strike * Math.exp(-rate * timeYears) * normalCdf(d2)
    )
  }

  return (
    strike * Math.exp(-rate * timeYears) * normalCdf(-d2) - stockPrice * normalCdf(-d1)
  )
}

function normalPdf(x) {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI)
}

/**
 * Black-Scholes delta. Call delta = N(d1); put delta = N(d1) - 1.
 * Returns a value in [-1, 1] representing dPrice/dStock for a single share.
 */
export function calcDelta({ stockPrice, strike, timeYears, volatility, rate, optionType }) {
  if (timeYears <= 0 || volatility <= 0) {
    if (optionType === 'call') return stockPrice > strike ? 1 : 0
    return stockPrice < strike ? -1 : 0
  }
  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  return optionType === 'call' ? normalCdf(d1) : normalCdf(d1) - 1
}

/**
 * Gamma — rate of change of delta with respect to the underlying price.
 * Same value for calls and puts on the same contract.
 */
export function calcGamma({ stockPrice, strike, timeYears, volatility, rate }) {
  if (timeYears <= 0 || volatility <= 0 || stockPrice <= 0) return 0
  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  return normalPdf(d1) / (stockPrice * sigmaSqrtT)
}

/**
 * Theta — time decay per calendar day (negative for long options).
 * Returned in dollars-per-day for a single share (multiply × 100 for one contract).
 */
export function calcTheta({ stockPrice, strike, timeYears, volatility, rate, optionType }) {
  if (timeYears <= 0 || volatility <= 0 || stockPrice <= 0) return 0
  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  const d2 = d1 - sigmaSqrtT
  const pdf = normalPdf(d1)
  const rateDecay = rate * strike * Math.exp(-rate * timeYears)
  const annualTheta =
    -(stockPrice * pdf * volatility) / (2 * Math.sqrt(timeYears)) -
    rateDecay * (optionType === 'call' ? normalCdf(d2) : -normalCdf(-d2))
  return annualTheta / 365
}

/**
 * Vega — change in option price per 1-percentage-point rise in implied volatility.
 * Returned in dollars-per-1%-IV for a single share.
 */
export function calcVega({ stockPrice, strike, timeYears, volatility, rate }) {
  if (timeYears <= 0 || volatility <= 0 || stockPrice <= 0) return 0
  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  return (stockPrice * normalPdf(d1) * Math.sqrt(timeYears)) / 100
}

/**
 * Rho — change in option price per 1-percentage-point rise in the risk-free rate.
 * Returned in dollars-per-1%-rate for a single share.
 */
export function calcRho({ stockPrice, strike, timeYears, volatility, rate, optionType }) {
  if (timeYears <= 0 || volatility <= 0 || stockPrice <= 0) return 0
  const sigmaSqrtT = volatility * Math.sqrt(timeYears)
  const d1 =
    (Math.log(stockPrice / strike) + (rate + (volatility * volatility) / 2) * timeYears) /
    sigmaSqrtT
  const d2 = d1 - sigmaSqrtT
  if (optionType === 'call') {
    return (strike * timeYears * Math.exp(-rate * timeYears) * normalCdf(d2)) / 100
  }
  return -(strike * timeYears * Math.exp(-rate * timeYears) * normalCdf(-d2)) / 100
}

/**
 * Log-normal probability density of underlying price = x at time T,
 * given current spot, IV, and risk-free rate.
 */
export function logNormalPdf({ x, spotPrice, timeYears, volatility, rate }) {
  if (x <= 0 || timeYears <= 0 || volatility <= 0 || spotPrice <= 0) return 0
  const sigmaT = volatility * Math.sqrt(timeYears)
  const mu = Math.log(spotPrice) + (rate - (volatility * volatility) / 2) * timeYears
  const z = (Math.log(x) - mu) / sigmaT
  return Math.exp(-(z * z) / 2) / (x * sigmaT * Math.sqrt(2 * Math.PI))
}

function toHeatColor(value, maxAbs) {
  if (maxAbs <= 0) {
    return 'rgba(255, 255, 255, 0.02)'
  }

  const intensity = Math.min(Math.abs(value) / maxAbs, 1)
  // On dark backgrounds we need a wider alpha range so weak values stay visible
  // but strong values pop without washing out the numeric text on top.
  const alpha = 0.1 + intensity * 0.55

  if (value >= 0) {
    // Emerald / mint green
    return `rgba(34, 197, 94, ${alpha.toFixed(3)})`
  }

  // Rose red
  return `rgba(239, 68, 68, ${alpha.toFixed(3)})`
}

function bucketProbability({
  spotPrice,
  stockPrice,
  lowerBound,
  upperBound,
  timeYears,
  volatility,
  rate,
}) {
  if (timeYears <= 0 || volatility <= 0) {
    const epsilon = Math.max(stockPrice * 0.005, 0.25)
    return Math.abs(spotPrice - stockPrice) <= epsilon ? 1 : 0
  }

  const sigmaT = volatility * Math.sqrt(timeYears)
  const mu = Math.log(spotPrice) + (rate - (volatility * volatility) / 2) * timeYears

  const zUpper = (Math.log(upperBound) - mu) / sigmaT
  const zLower = (Math.log(lowerBound) - mu) / sigmaT

  return Math.max(normalCdf(zUpper) - normalCdf(zLower), 0)
}

/**
 * Build heatmap data for one or more option legs.
 *
 * @param {object} params
 * @param {number} params.spotPrice  - Current underlying price
 * @param {Array}  params.legs       - Array of leg objects:
 *   { strike, markPrice, optionType, positionSide, quantity, impliedVolatility, expiration }
 * @param {number} params.moveRangePercent - ±% price range to model
 */
export function buildHeatmap({ spotPrice, legs, moveRangePercent }) {
  if (!spotPrice || !legs || legs.length === 0) {
    return {
      dayLevels: [],
      dayLabels: [],
      priceLevels: [],
      rows: [],
      expiryCurve: [],
      maxDTE: 0,
      avgVolatility: 0.25,
    }
  }

  const nowSeconds = Date.now() / 1000

  // Per-leg DTE (days to expiration from today, minimum 1).
  // Stock legs have no expiry — assign a large sentinel so they never expire in the loop.
  const legDTEs = legs.map((l) => {
    if (l.optionType === 'stock') return 99999
    return Math.max(Math.round((Number(l.expiration) - nowSeconds) / 86400), 1)
  })

  // maxDTE drives the time axis — only count option legs (stock has no expiry)
  const optionDTEs = legDTEs.filter((_, i) => legs[i].optionType !== 'stock')
  const maxDTE = optionDTEs.length > 0 ? Math.max(...optionDTEs) : 30

  // Average IV for probability bucketing — only count option legs
  const optionLegs = legs.filter((l) => l.optionType !== 'stock')
  const avgVolatility =
    optionLegs.length > 0
      ? optionLegs.reduce((sum, l) => sum + Math.max(Number(l.impliedVolatility) || 0.25, 0.05), 0) / optionLegs.length
      : 0.25

  const range = Math.max(5, Math.min(200, Number(moveRangePercent) || 30)) / 100
  const daysToExpiration = maxDTE

  const minPrice = Math.max(spotPrice * (1 - range), 0.01)
  const maxPrice = spotPrice * (1 + range)
  const rowsCount = 13

  const priceLevels = Array.from({ length: rowsCount }, (_, index) => {
    const ratio = index / (rowsCount - 1)
    return minPrice + (maxPrice - minPrice) * ratio
  })

  const dayLevels = Array.from({ length: daysToExpiration + 1 }, (_, day) => day)
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)
  const dayLabels = dayLevels.map((day) => {
    const date = new Date(baseDate.getTime() + day * 86400000)
    return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  })

  const boundaries = priceLevels.map((price, index) => {
    const previous = priceLevels[index - 1] ?? price
    const next = priceLevels[index + 1] ?? price

    const lower = index === 0 ? Math.max(price - (next - price) / 2, 0.01) : (previous + price) / 2
    const upper =
      index === priceLevels.length - 1 ? price + (price - previous) / 2 : (price + next) / 2

    return {
      lowerBound: Math.max(lower, 0.01),
      upperBound: Math.max(upper, 0.02),
    }
  })

  const rawRows = priceLevels.map((price, rowIndex) => {
    const cells = dayLevels.map((days) => {
      // Sum P/L across all legs; each leg uses its own remaining time
      let totalPnl = 0
      for (let li = 0; li < legs.length; li++) {
        const leg = legs[li]
        const direction = leg.positionSide === 'sell' ? -1 : 1

        if (leg.optionType === 'stock') {
          // Stock: linear P&L per share (100 shares per quantity unit)
          totalPnl += (price - leg.markPrice) * 100 * leg.quantity * direction
          continue
        }

        const daysRemaining = Math.max(legDTEs[li] - days, 0)
        const timeYears = daysRemaining / 365
        const volatility = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)

        const estimatedValue = blackScholes({
          stockPrice: price,
          strike: leg.strike,
          timeYears,
          volatility,
          rate: 0.05,
          optionType: leg.optionType,
        })

        totalPnl += (estimatedValue - leg.markPrice) * 100 * leg.quantity * direction
      }

      const probability = bucketProbability({
        spotPrice,
        stockPrice: price,
        lowerBound: boundaries[rowIndex].lowerBound,
        upperBound: boundaries[rowIndex].upperBound,
        timeYears: maxDTE / 365,
        volatility: avgVolatility,
        rate: 0.05,
      })

      return {
        day: days,
        stockPrice: price,
        value: totalPnl,
        probability,
      }
    })

    return {
      stockPrice: price,
      cells,
    }
  })

  const allValues = rawRows.flatMap((row) => row.cells.map((cell) => Math.abs(cell.value)))
  const maxAbs = allValues.length > 0 ? Math.max(...allValues) : 1

  const styledRows = rawRows
    .map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        color: toHeatColor(cell.value, maxAbs),
      })),
    }))

  return {
    dayLevels,
    dayLabels,
    priceLevels,
    // Rows are displayed as a price-vs-time heatmap. Sort descending by price
    // so the highest stock price is at the top and the lowest is at the bottom
    // — this matches standard chart conventions and keeps the y-axis monotonic.
    rows: styledRows.slice().sort((a, b) => b.stockPrice - a.stockPrice),
    expiryCurve: styledRows
      .map((row) => {
        const last = row.cells[row.cells.length - 1]
        return {
          stockPrice: row.stockPrice,
          value: last?.value ?? 0,
          probability: last?.probability ?? 0,
        }
      })
      .sort((a, b) => a.stockPrice - b.stockPrice),
    maxDTE,
    avgVolatility,
  }
}

/**
 * Compute a price-vs-price aggregate P/L grid for a multi-underlying position.
 *
 * @param {object} params
 * @param {Array}  params.groups          - Array of { ticker, legs, spot, refSpot? }
 *   groups[0] forms the row axis (priceA), groups[1] forms the column axis (priceB).
 *   groups[2+] contribute their P/L at their own refSpot to every cell.
 * @param {number} params.daysElapsed     - Days elapsed from today (0 = now)
 * @param {number} params.moveRangePercentA - ±% price range for group A
 * @param {number} params.moveRangePercentB - ±% price range for group B
 * @param {number} [params.rowsCount=13]  - Number of price levels per axis
 *
 * @returns {{
 *   tickerA: string, tickerB: string, otherTickers: string[],
 *   pricesA: number[], pricesB: number[],
 *   grid: Array<Array<{value: number, color: string}>>,
 *   maxAbs: number,
 *   spotIdxA: number, spotIdxB: number,
 *   maxDTE: number,
 * }}
 */
export function buildAggregateHeatmap({
  groups,
  daysElapsed = 0,
  moveRangePercentA = 30,
  moveRangePercentB = 30,
  rowsCount = 13,
}) {
  const empty = {
    tickerA: '', tickerB: '', otherTickers: [],
    pricesA: [], pricesB: [], grid: [], maxAbs: 1,
    spotIdxA: 0, spotIdxB: 0, maxDTE: 0,
  }
  if (!groups || groups.length < 2) return empty

  const nowSeconds = Date.now() / 1000

  // Helper: DTE array for a set of legs (stock legs get a large sentinel value)
  function legDTEs(legs) {
    return legs.map((l) => {
      if (l.optionType === 'stock') return 99999
      return Math.max(Math.round((Number(l.expiration) - nowSeconds) / 86400), 1)
    })
  }

  // Helper: P/L for one group's legs at a given stock price and daysElapsed
  function groupPnl(legs, dtesForLegs, stockPrice, elapsed) {
    let total = 0
    for (let li = 0; li < legs.length; li++) {
      const leg = legs[li]
      const direction = leg.positionSide === 'sell' ? -1 : 1

      if (leg.optionType === 'stock') {
        total += (stockPrice - leg.markPrice) * 100 * leg.quantity * direction
        continue
      }

      const daysRemaining = Math.max(dtesForLegs[li] - elapsed, 0)
      const timeYears = daysRemaining / 365
      const volatility = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)
      const estimated = blackScholes({
        stockPrice,
        strike: leg.strike,
        timeYears,
        volatility,
        rate: 0.05,
        optionType: leg.optionType,
      })
      total += (estimated - leg.markPrice) * 100 * leg.quantity * direction
    }
    return total
  }

  // Helper: build a linearly-spaced price array ±rangePercent around refSpot
  function buildPriceLevels(refSpot, rangePercent, count) {
    const range = Math.max(5, Math.min(200, Number(rangePercent) || 30)) / 100
    const lo = Math.max(refSpot * (1 - range), 0.01)
    const hi = refSpot * (1 + range)
    return Array.from({ length: count }, (_, i) => lo + (hi - lo) * (i / (count - 1)))
  }

  // Helper: nearest index to a target in a sorted (ascending) price array
  function nearestIdx(prices, target) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < prices.length; i++) {
      const d = Math.abs(prices[i] - target)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  const gA = groups[0]
  const gB = groups[1]
  const others = groups.slice(2)

  const refA = gA.refSpot ?? gA.spot
  const refB = gB.refSpot ?? gB.spot

  const dtesA = legDTEs(gA.legs)
  const dtesB = legDTEs(gB.legs)
  const otherDtes = others.map((g) => legDTEs(g.legs))

  const allDTEs = [...dtesA, ...dtesB, ...others.flatMap((g) => legDTEs(g.legs))]
  const maxDTE = allDTEs.length > 0 ? Math.max(...allDTEs) : 0

  const pricesA = buildPriceLevels(refA, moveRangePercentA, rowsCount)
  const pricesB = buildPriceLevels(refB, moveRangePercentB, rowsCount)

  // Pre-compute the "other groups" fixed P/L contribution (constant across the whole grid)
  let fixedOtherPnl = 0
  for (let k = 0; k < others.length; k++) {
    const og = others[k]
    const refOther = og.refSpot ?? og.spot
    fixedOtherPnl += groupPnl(og.legs, otherDtes[k], refOther, daysElapsed)
  }

  // Build grid: rows = pricesA descending (top = highest), cols = pricesB ascending
  const rawGrid = pricesA.map((pA) =>
    pricesB.map((pB) => {
      const pnl = groupPnl(gA.legs, dtesA, pA, daysElapsed)
                + groupPnl(gB.legs, dtesB, pB, daysElapsed)
                + fixedOtherPnl
      return pnl
    }),
  )

  // Compute maxAbs for color scaling
  let maxAbs = 0
  for (const row of rawGrid) {
    for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v))
  }
  if (maxAbs === 0) maxAbs = 1

  const grid = rawGrid.map((row) =>
    row.map((value) => ({ value, color: toHeatColor(value, maxAbs) })),
  )

  // Row-sort descending by priceA so highest price = top row (matches heatmap convention)
  const sortedPricesA = [...pricesA].reverse()
  const sortedGrid = [...grid].reverse()

  const spotIdxA = nearestIdx(sortedPricesA, refA)
  const spotIdxB = nearestIdx(pricesB, refB)

  return {
    tickerA: gA.ticker,
    tickerB: gB.ticker,
    otherTickers: others.map((g) => g.ticker),
    pricesA: sortedPricesA,
    pricesB,
    grid: sortedGrid,
    maxAbs,
    spotIdxA,
    spotIdxB,
    maxDTE,
  }
}

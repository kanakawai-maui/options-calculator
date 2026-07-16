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

function blackScholes({ stockPrice, strike, timeYears, volatility, rate, optionType }) {
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

  // Per-leg DTE (days to expiration from today, minimum 1)
  const legDTEs = legs.map((l) =>
    Math.max(Math.round((Number(l.expiration) - nowSeconds) / 86400), 1),
  )
  const maxDTE = Math.max(...legDTEs)

  // Average IV for probability bucketing
  const avgVolatility =
    legs.reduce((sum, l) => sum + Math.max(Number(l.impliedVolatility) || 0.25, 0.05), 0) /
    legs.length

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
        const daysRemaining = Math.max(legDTEs[li] - days, 0)
        const timeYears = daysRemaining / 365
        const volatility = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)
        const direction = leg.positionSide === 'sell' ? -1 : 1

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

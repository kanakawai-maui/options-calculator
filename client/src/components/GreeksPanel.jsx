import { useMemo, useState } from 'react'
import { calcDelta, calcGamma, calcTheta, calcVega, calcRho } from '../utils/optionsMath'

/* ─── shared SVG layout constants ─────────────────────────────────────────── */

const CHART_W = 960
const CHART_H = 200
const PAD_L = 52
const PAD_R = 20
const PAD_T = 24
const PAD_B = 30

function mapX(v, vMin, vMax) {
  const span = Math.max(vMax - vMin, 1e-9)
  return PAD_L + ((v - vMin) / span) * (CHART_W - PAD_L - PAD_R)
}

function mapY(v, vMin, vMax) {
  const span = Math.max(vMax - vMin, 1e-9)
  return CHART_H - PAD_B - ((v - vMin) / span) * (CHART_H - PAD_T - PAD_B)
}

/* ─── time-slice palette ───────────────────────────────────────────────────── */

const TIME_SLICES = [
  { label: 'Today', fraction: 0, color: '#60a5fa' },      // blue
  { label: '¼ DTE', fraction: 0.25, color: '#a78bfa' },   // violet
  { label: '½ DTE', fraction: 0.5, color: '#fb923c' },    // orange
  { label: '¾ DTE', fraction: 0.75, color: '#f472b6' },   // pink
  { label: 'Expiry', fraction: 1, color: '#4ade80' },     // green
]

/* ─── y-axis tick helper ───────────────────────────────────────────────────── */

function yTicks(yMin, yMax, count = 3) {
  const span = yMax - yMin
  const step = span / (count + 1)
  return Array.from({ length: count }, (_, i) => {
    const v = yMin + step * (i + 1)
    return { v, y: mapY(v, yMin, yMax) }
  })
}

/* ─── number formatter ─────────────────────────────────────────────────────── */

function fmtGreek(v, decimals = 3) {
  if (!Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v).toFixed(decimals)}`
}

/* ─── build curve data across price range for one greek ───────────────────── */

function buildCurves({ legs, spotPrice, moveRangePercent, greek }) {
  const range = Math.max(5, Math.min(200, Number(moveRangePercent) || 30)) / 100
  const minPrice = Math.max(spotPrice * (1 - range), 0.01)
  const maxPrice = spotPrice * (1 + range)
  const samples = 100
  const nowSec = Date.now() / 1000

  // Per-leg time to expiry (days)
  const legDTEs = legs.map((l) =>
    Math.max((Number(l.expiration) - nowSec) / 86400, 0),
  )
  const maxDTE = Math.max(...legDTEs, 1)

  const slices = TIME_SLICES.map((slice) => {
    const points = []
    for (let i = 0; i <= samples; i++) {
      const S = minPrice + ((maxPrice - minPrice) * i) / samples
      let value = 0
      for (let li = 0; li < legs.length; li++) {
        const leg = legs[li]
        const daysRemaining = Math.max(legDTEs[li] * (1 - slice.fraction), 0)
        const timeYears = Math.max(daysRemaining / 365, 0)
        const volatility = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)
        const direction = leg.positionSide === 'sell' ? -1 : 1
        const multiplier = direction * leg.quantity * 100

        const params = { stockPrice: S, strike: leg.strike, timeYears, volatility, rate: 0.05, optionType: leg.optionType }

        let raw = 0
        if (greek === 'delta') raw = calcDelta(params)
        else if (greek === 'gamma') raw = calcGamma(params)
        else if (greek === 'theta') raw = calcTheta(params)
        else if (greek === 'vega') raw = calcVega(params)
        else if (greek === 'rho') raw = calcRho(params)

        value += raw * multiplier
      }
      points.push({ x: S, y: value })
    }
    return { ...slice, points }
  })

  // Global y range across all slices (add symmetric padding)
  let yMin = Infinity
  let yMax = -Infinity
  for (const slice of slices) {
    for (const p of slice.points) {
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
  }
  // If all values are the same (e.g. at expiry, all greeks ~ 0), add small padding
  if (yMax - yMin < 1e-6) {
    const mid = (yMin + yMax) / 2
    yMin = mid - 1
    yMax = mid + 1
  } else {
    const pad = (yMax - yMin) * 0.08
    yMin -= pad
    yMax += pad
  }

  return { slices, yMin, yMax, minPrice, maxPrice, maxDTE }
}

/* ─── single greek chart ───────────────────────────────────────────────────── */

const GREEK_META = {
  delta: { symbol: 'Δ', label: 'Delta', unit: 'shares', description: 'Rate of change of position value per $1 move in the underlying. +100 = long 100 share-equivalents.' },
  gamma: { symbol: 'Γ', label: 'Gamma', unit: 'Δ/share', description: 'Rate of change of delta per $1 move. High gamma = delta shifts quickly; spikes near expiry at-the-money.' },
  theta: { symbol: 'Θ', label: 'Theta', unit: '$/day', description: 'Daily time decay in dollars. Negative for long options (you lose money each day). Positive if you sold the position.' },
  vega: { symbol: 'ν', label: 'Vega', unit: '$/1% IV', description: 'Change in position value per 1% rise in implied volatility. Positive = benefits from volatility expansion.' },
  rho: { symbol: 'ρ', label: 'Rho', unit: '$/1% rate', description: 'Change in position value per 1% rise in interest rates. Calls have positive rho, puts have negative rho.' },
}

function GreekChart({ greek, slices, yMin, yMax, minPrice, maxPrice, spotPrice, maxDTE }) {
  const meta = GREEK_META[greek]
  const ticks = yTicks(yMin, yMax, 3)
  const spotX = mapX(spotPrice, minPrice, maxPrice)
  const zeroY = yMin <= 0 && yMax >= 0 ? mapY(0, yMin, yMax) : null

  // Find spot value for each slice (nearest sample point)
  const spotValues = slices.map((slice) => {
    const pt = slice.points.reduce((best, p) =>
      Math.abs(p.x - spotPrice) < Math.abs(best.x - spotPrice) ? p : best,
    )
    return { label: slice.label, color: slice.color, value: pt.y }
  })

  // Choose decimals based on magnitude
  const absMax = Math.max(Math.abs(yMin), Math.abs(yMax))
  const decimals = absMax > 100 ? 1 : absMax > 10 ? 2 : 3

  return (
    <div className="greek-chart-panel">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">
              {meta.symbol} {meta.label}
              <span className="greek-unit-label">&nbsp;({meta.unit})</span>
            </div>
          </div>
        </div>
        <div className="insight-badges">
          {spotValues.map((sv) => (
            <span
              key={sv.label}
              className="greek-badge"
              style={{ borderColor: sv.color, color: sv.color }}
            >
              {sv.label}: {fmtGreek(sv.value, decimals)}
            </span>
          ))}
        </div>
      </div>

      <svg
        className="insight-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`${meta.label} across underlying prices`}
      >
        {/* grid + y-axis labels */}
        {ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD_L} y1={t.y}
              x2={CHART_W - PAD_R} y2={t.y}
              className="insight-grid"
            />
            <text x={PAD_L - 6} y={t.y + 4} className="insight-y-label" textAnchor="end">
              {fmtGreek(t.v, decimals)}
            </text>
          </g>
        ))}

        {/* zero line (if in range) */}
        {zeroY != null && (
          <line
            x1={PAD_L} y1={zeroY}
            x2={CHART_W - PAD_R} y2={zeroY}
            className="insight-zero"
          />
        )}

        {/* x-axis */}
        <line
          x1={PAD_L} y1={CHART_H - PAD_B}
          x2={CHART_W - PAD_R} y2={CHART_H - PAD_B}
          className="insight-axis"
        />

        {/* time-slice curves */}
        {slices.map((slice) => {
          const d = slice.points
            .map((p, i) => {
              const x = mapX(p.x, minPrice, maxPrice)
              const y = mapY(p.y, yMin, yMax)
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
            })
            .join(' ')
          return (
            <path
              key={slice.label}
              d={d}
              fill="none"
              stroke={slice.color}
              strokeWidth="1.8"
              strokeLinejoin="round"
              opacity="0.85"
            />
          )
        })}

        {/* spot price vertical */}
        <line
          x1={spotX} y1={PAD_T}
          x2={spotX} y2={CHART_H - PAD_B}
          className="insight-spot-line"
        />
        <text x={spotX} y={PAD_T - 6} textAnchor="middle" className="insight-marker-label">
          Spot ${spotPrice.toFixed(0)}
        </text>

        {/* axis labels */}
        <text
          x={PAD_L - 6} y={PAD_T - 6}
          className="insight-axis-title"
          textAnchor="end"
        >
          {meta.symbol}
        </text>
        <text
          x={CHART_W - PAD_R} y={CHART_H - PAD_B + 22}
          className="insight-axis-title"
          textAnchor="end"
        >
          Underlying price
        </text>
      </svg>

      <p className="insight-caption">{meta.description}</p>
    </div>
  )
}

/* ─── legend ───────────────────────────────────────────────────────────────── */

function TimeSliceLegend({ maxDTE }) {
  return (
    <div className="greeks-legend">
      {TIME_SLICES.map((s) => {
        const daysLeft = maxDTE > 0 ? Math.round(maxDTE * (1 - s.fraction)) : null
        const label =
          daysLeft != null && maxDTE > 0
            ? `${s.label} (${daysLeft}d left)`
            : s.label
        return (
          <span key={s.label} className="greeks-legend-item">
            <span
              className="greeks-legend-swatch"
              style={{ background: s.color }}
            />
            {label}
          </span>
        )
      })}
    </div>
  )
}

/* ─── public component ────────────────────────────────────────────────────── */

export function GreeksPanel({ activelegs, spotPrice, moveRangePercent, ticker, dragHandle }) {
  const [open, setOpen] = useState(true)
  const data = useMemo(() => {
    if (!activelegs.length || !spotPrice) return null

    const greeks = ['delta', 'gamma', 'theta', 'vega', 'rho']
    const results = {}
    let maxDTE = 1

    for (const greek of greeks) {
      const { slices, yMin, yMax, minPrice, maxPrice, maxDTE: dte } = buildCurves({
        legs: activelegs,
        spotPrice,
        moveRangePercent,
        greek,
      })
      results[greek] = { slices, yMin, yMax, minPrice, maxPrice }
      if (dte > maxDTE) maxDTE = dte
    }

    return { results, maxDTE }
  }, [activelegs, spotPrice, moveRangePercent])

  if (!data) return null

  const { results, maxDTE } = data

  return (
    <section className="heatmap-panel">
      <div className="heatmap-header">
        <div className="heatmap-header-text">
          <h2>
            {ticker && (
              <span className="ticker-chip ticker-chip--heading ticker-chip--sm">{ticker}</span>
            )}
            {ticker ? ' Greeks Over Time' : 'Greeks Over Time'}
          </h2>
        </div>
        <div className="heatmap-header-actions">
          {dragHandle}
          <button
            type="button"
            className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Collapse Greeks' : 'Expand Greeks'}
          >
            <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
              <path d="M0 0L5 6L10 0z" />
            </svg>
          </button>
        </div>
      </div>

      {open && <>
      <TimeSliceLegend maxDTE={maxDTE} />

      <div className="greeks-charts-grid">
        {['delta', 'gamma', 'theta', 'vega', 'rho'].map((greek) => {
          const { slices, yMin, yMax, minPrice, maxPrice } = results[greek]
          return (
            <GreekChart
              key={greek}
              greek={greek}
              slices={slices}
              yMin={yMin}
              yMax={yMax}
              minPrice={minPrice}
              maxPrice={maxPrice}
              spotPrice={spotPrice}
              maxDTE={maxDTE}
            />
          )
        })}
      </div>
      </> }
    </section>
  )
}

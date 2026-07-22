import { useCallback, useMemo, useRef, useState } from 'react'
import { calcDelta, calcGamma, calcTheta, calcVega, logNormalPdf } from '../utils/optionsMath'
import './Insights.css'

const CHART_W = 960
const CHART_H = 200
const PAD_L = 44
const PAD_R = 20
const PAD_T = 20
const PAD_B = 30

function fmtSignedUsd(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : '−'
  return `${sign}$${Math.abs(n).toFixed(0)}`
}

function mapX(v, vMin, vMax) {
  const span = Math.max(vMax - vMin, 1e-9)
  return PAD_L + ((v - vMin) / span) * (CHART_W - PAD_L - PAD_R)
}

function mapY(v, vMin, vMax) {
  const span = Math.max(vMax - vMin, 1e-9)
  return CHART_H - PAD_B - ((v - vMin) / span) * (CHART_H - PAD_T - PAD_B)
}

function interpZero(xA, yA, xB, yB) {
  if (yA === yB) return xA
  return xA + ((0 - yA) / (yB - yA)) * (xB - xA)
}

function SingleTickerBadge({ ticker }) {
  if (!ticker) return null
  return (
    <div className="insight-tickers" aria-label="Underlying">
      <span className="insight-tickers-label">Underlying:</span>
      <span className="ticker-chip ticker-chip--sm">{ticker}</span>
    </div>
  )
}

function InfoHover({ text }) {
  const [visible, setVisible] = useState(false)
  const [offset, setOffset] = useState(0)
  const ref = useRef(null)

  const handleOpen = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const bubbleWidth = 230
      const margin = 8
      const centerX = rect.left + rect.width / 2
      let off = 0
      const leftEdge = centerX - bubbleWidth / 2
      const rightEdge = centerX + bubbleWidth / 2
      if (leftEdge < margin) off = margin - leftEdge
      else if (rightEdge > window.innerWidth - margin) off = window.innerWidth - margin - rightEdge
      setOffset(off)
    }
    setVisible(true)
  }
  const handleClose = () => setVisible(false)

  return (
    <span
      ref={ref}
      className="info-hover"
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
      tabIndex={0}
      role="button"
      aria-label="Chart info"
    >
      <span className="info-hover-icon">?</span>
      {visible && (
        <span
          className="info-hover-tooltip"
          role="tooltip"
          style={{
            transform: `translateX(calc(-50% + ${offset}px))`,
            '--arrow-left': `calc(50% - ${offset}px)`,
          }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

/* ─────────────────────────── 1. Probability of Profit ───────────────────── */

function ProbOfProfit({ spotPrice, heatmap, ticker }) {
  const stats = useMemo(() => {
    const curve = heatmap.expiryCurve ?? []
    if (curve.length < 2 || !spotPrice) return null

    let pop = 0
    let ev = 0
    let totalProb = 0
    for (const point of curve) {
      totalProb += point.probability
      if (point.value > 0) pop += point.probability
      ev += point.value * point.probability
    }
    if (totalProb > 0) {
      pop = pop / totalProb
      ev = ev / totalProb
    }

    const breakevens = []
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1]
      const b = curve[i]
      if ((a.value <= 0 && b.value > 0) || (a.value >= 0 && b.value < 0)) {
        breakevens.push(interpZero(a.stockPrice, a.value, b.stockPrice, b.value))
      }
    }

    const prices = curve.map((p) => p.stockPrice)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const samples = 220
    const T = Math.max(heatmap.maxDTE ?? 30, 1) / 365
    const sigma = Math.max(heatmap.avgVolatility ?? 0.25, 0.05)

    const density = []
    let maxD = 0
    for (let i = 0; i <= samples; i++) {
      const x = minPrice + ((maxPrice - minPrice) * i) / samples
      const d = logNormalPdf({ x, spotPrice, timeYears: T, volatility: sigma, rate: 0.05 })
      density.push({ x, d })
      if (d > maxD) maxD = d
    }

    const signAt = (x) => {
      for (let i = 1; i < curve.length; i++) {
        if (x >= curve[i - 1].stockPrice && x <= curve[i].stockPrice) {
          const a = curve[i - 1]
          const b = curve[i]
          const t = (x - a.stockPrice) / Math.max(b.stockPrice - a.stockPrice, 1e-9)
          return a.value + (b.value - a.value) * t
        }
      }
      return curve[curve.length - 1].value
    }

    const buildAreaPath = (predicate) => {
      const segments = []
      let current = null
      for (const s of density) {
        const inRegion = predicate(signAt(s.x))
        if (inRegion) {
          if (!current) current = []
          current.push(s)
        } else if (current) {
          segments.push(current)
          current = null
        }
      }
      if (current) segments.push(current)
      return segments
        .map((seg) => {
          if (seg.length < 2) return ''
          const xMin = seg[0].x
          const xMax = seg[seg.length - 1].x
          const pathTop = seg
            .map(
              (s, i) =>
                `${i === 0 ? 'M' : 'L'} ${mapX(s.x, minPrice, maxPrice).toFixed(2)} ${mapY(s.d, 0, maxD).toFixed(2)}`,
            )
            .join(' ')
          return `${pathTop} L ${mapX(xMax, minPrice, maxPrice).toFixed(2)} ${mapY(0, 0, maxD).toFixed(2)} L ${mapX(xMin, minPrice, maxPrice).toFixed(2)} ${mapY(0, 0, maxD).toFixed(2)} Z`
        })
        .join(' ')
    }

    const profitPath = buildAreaPath((v) => v > 0)
    const lossPath = buildAreaPath((v) => v <= 0)

    return { pop, ev, breakevens, minPrice, maxPrice, profitPath, lossPath }
  }, [spotPrice, heatmap])

  if (!stats) return null

  const spotXPos = mapX(spotPrice, stats.minPrice, stats.maxPrice)

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">Probability of Profit</div>
            <InfoHover text="Bell curve shows the log-normal price distribution at expiration derived from implied volatility. Green area = profit zone, red = loss zone. PoP is the probability that the position expires in profit." />
          </div>
          <SingleTickerBadge ticker={ticker} />
        </div>
        <div className="insight-badges">
          <span className={`insight-badge ${stats.pop >= 0.5 ? 'pos' : 'neg'}`}>
            PoP {(stats.pop * 100).toFixed(0)}%
          </span>
          <span className={`insight-badge ${stats.ev >= 0 ? 'pos' : 'neg'}`}>
            EV {fmtSignedUsd(stats.ev)}
          </span>
        </div>
      </div>
      <svg
        className="insight-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Probability of profit distribution"
      >
        <line
          x1={PAD_L}
          y1={CHART_H - PAD_B}
          x2={CHART_W - PAD_R}
          y2={CHART_H - PAD_B}
          className="insight-axis"
        />
        <path d={stats.lossPath} className="insight-area-loss" />
        <path d={stats.profitPath} className="insight-area-profit" />
        <line
          x1={spotXPos}
          y1={PAD_T}
          x2={spotXPos}
          y2={CHART_H - PAD_B}
          className="insight-spot-line"
        />
        <text x={spotXPos} y={PAD_T - 6} textAnchor="middle" className="insight-marker-label">
          Spot ${spotPrice.toFixed(0)}
        </text>
        {stats.breakevens.map((be) => {
          const x = mapX(be, stats.minPrice, stats.maxPrice)
          return (
            <g key={be}>
              <line x1={x} y1={PAD_T} x2={x} y2={CHART_H - PAD_B} className="insight-breakeven" />
              <text x={x} y={CHART_H - PAD_B + 14} textAnchor="middle" className="insight-marker-label">
                BE ${be.toFixed(0)}
              </text>
            </g>
          )
        })}
        <text x={PAD_L} y={PAD_T - 6} className="insight-axis-title" textAnchor="start">
          Probability density
        </text>
        <text x={CHART_W - PAD_R} y={CHART_H - PAD_B + 22} className="insight-axis-title" textAnchor="end">
          Stock price at expiration
        </text>
      </svg>
      <p className="insight-caption">
        Green area = probability-weighted profit zone. Red = loss zone. Bell shape is the
        log-normal expected price distribution at expiration derived from implied volatility.
      </p>
    </div>
  )
}

/* ─────────────────────────── 2. Volatility Skew ─────────────────────────── */

function VolatilitySkew({ chainData, spotPrice, activelegs, ticker }) {
  const stats = useMemo(() => {
    if (!chainData || !spotPrice) return null
    const calls = (chainData.calls ?? [])
      .filter((c) => c.strike && c.impliedVolatility > 0)
      .map((c) => ({ strike: c.strike, iv: c.impliedVolatility }))
      .sort((a, b) => a.strike - b.strike)
    const puts = (chainData.puts ?? [])
      .filter((p) => p.strike && p.impliedVolatility > 0)
      .map((p) => ({ strike: p.strike, iv: p.impliedVolatility }))
      .sort((a, b) => a.strike - b.strike)
    if (calls.length < 2 && puts.length < 2) return null

    const all = [...calls, ...puts]
    const minStrike = Math.min(...all.map((p) => p.strike))
    const maxStrike = Math.max(...all.map((p) => p.strike))
    const maxIv = Math.max(...all.map((p) => p.iv)) * 1.05
    const minIv = 0

    const buildPath = (arr) => {
      if (arr.length < 2) return ''
      return arr
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'} ${mapX(p.strike, minStrike, maxStrike).toFixed(2)} ${mapY(p.iv, minIv, maxIv).toFixed(2)}`,
        )
        .join(' ')
    }

    const nearest = (arr) =>
      arr.length
        ? arr.reduce((best, p) =>
            Math.abs(p.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? p : best,
          )
        : null
    const atmCall = nearest(calls)
    const atmPut = nearest(puts)

    const findNearest = (arr, target) =>
      arr.length
        ? arr.reduce((best, p) =>
            Math.abs(p.strike - target) < Math.abs(best.strike - target) ? p : best,
          )
        : null
    const otmPut = findNearest(puts, spotPrice * 0.9)
    const otmCall = findNearest(calls, spotPrice * 1.1)
    const skew = otmPut && otmCall ? (otmPut.iv - otmCall.iv) * 100 : null

    return { calls, puts, callPath: buildPath(calls), putPath: buildPath(puts), minStrike, maxStrike, minIv, maxIv, atmCall, atmPut, skew }
  }, [chainData, spotPrice])

  if (!stats) return null

  const spotXPos = mapX(spotPrice, stats.minStrike, stats.maxStrike)
  const legStrikes = Array.from(new Set(activelegs.map((l) => l.strike)))

  const ivTicks = [0.25, 0.5, 0.75].map((frac) => {
    const ivValue = stats.minIv + (stats.maxIv - stats.minIv) * frac
    return { iv: ivValue, y: mapY(ivValue, stats.minIv, stats.maxIv) }
  })

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">Implied Volatility Skew</div>
            <InfoHover text="IV plotted at each strike for calls (green) and puts (red). A steep put-side skew means the market is pricing in more downside risk — puts are more expensive relative to calls." />
          </div>
          <SingleTickerBadge ticker={ticker} />
        </div>
        <div className="insight-badges">
          {stats.atmCall ? (
            <span className="insight-badge neutral">ATM Call IV {(stats.atmCall.iv * 100).toFixed(1)}%</span>
          ) : null}
          {stats.atmPut ? (
            <span className="insight-badge neutral">ATM Put IV {(stats.atmPut.iv * 100).toFixed(1)}%</span>
          ) : null}
          {stats.skew != null ? (
            <span className={`insight-badge ${stats.skew > 0 ? 'neg' : 'pos'}`}>
              Skew {stats.skew >= 0 ? '+' : ''}{stats.skew.toFixed(1)}%
            </span>
          ) : null}
        </div>
      </div>
      <svg className="insight-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="Implied volatility skew">
        {ivTicks.map((t) => (
          <g key={t.iv}>
            <line x1={PAD_L} y1={t.y} x2={CHART_W - PAD_R} y2={t.y} className="insight-grid" />
            <text x={PAD_L - 6} y={t.y + 3} className="insight-y-label" textAnchor="end">
              {(t.iv * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        <line x1={PAD_L} y1={CHART_H - PAD_B} x2={CHART_W - PAD_R} y2={CHART_H - PAD_B} className="insight-axis" />
        {legStrikes.map((s) => {
          if (s < stats.minStrike || s > stats.maxStrike) return null
          const x = mapX(s, stats.minStrike, stats.maxStrike)
          return <line key={s} x1={x} y1={PAD_T} x2={x} y2={CHART_H - PAD_B} className="insight-leg-line" />
        })}
        <line x1={spotXPos} y1={PAD_T} x2={spotXPos} y2={CHART_H - PAD_B} className="insight-spot-line" />
        <path d={stats.callPath} className="insight-line insight-line-call" />
        <path d={stats.putPath} className="insight-line insight-line-put" />
        {stats.calls.map((p) => (
          <circle key={`c-${p.strike}`} cx={mapX(p.strike, stats.minStrike, stats.maxStrike)} cy={mapY(p.iv, stats.minIv, stats.maxIv)} r={1.6} className="insight-dot insight-dot-call" />
        ))}
        {stats.puts.map((p) => (
          <circle key={`p-${p.strike}`} cx={mapX(p.strike, stats.minStrike, stats.maxStrike)} cy={mapY(p.iv, stats.minIv, stats.maxIv)} r={1.6} className="insight-dot insight-dot-put" />
        ))}
        <text x={spotXPos} y={PAD_T - 6} textAnchor="middle" className="insight-marker-label">
          Spot ${spotPrice.toFixed(0)}
        </text>
        <g transform={`translate(${PAD_L + 8}, ${PAD_T + 6})`}>
          <rect width={9} height={2} y={4} className="insight-legend-call" />
          <text x={14} y={8} className="insight-legend-text">Calls</text>
          <rect width={9} height={2} y={4} x={62} className="insight-legend-put" />
          <text x={76} y={8} className="insight-legend-text">Puts</text>
        </g>
        <text x={PAD_L - 6} y={PAD_T - 6} className="insight-axis-title" textAnchor="end">IV</text>
        <text x={CHART_W - PAD_R} y={CHART_H - PAD_B + 22} className="insight-axis-title" textAnchor="end">Strike price</text>
      </svg>
      <p className="insight-caption">
        A steep put-side skew (puts more expensive than calls) means the market is paying up for
        downside protection — good for premium sellers, expensive for put buyers.
      </p>
    </div>
  )
}

/* ─────────────────────────── 3. Delta Profile ────────────────────────────── */

function DeltaProfile({ activelegs, spotPrice, heatmap, ticker }) {
  const stats = useMemo(() => {
    if (!activelegs.length || !spotPrice) return null
    const curve = heatmap.expiryCurve ?? []
    if (curve.length < 2) return null

    const nowSec = Date.now() / 1000
    const prices = curve.map((p) => p.stockPrice)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)

    const samples = 120
    const rows = []
    let maxAbsDelta = 0

    for (let i = 0; i <= samples; i++) {
      const x = minPrice + ((maxPrice - minPrice) * i) / samples
      let total = 0
      for (const leg of activelegs) {
        const T = Math.max((Number(leg.expiration) - nowSec) / (365 * 86400), 1 / 365)
        const sigma = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)
        const direction = leg.positionSide === 'sell' ? -1 : 1
        const d = calcDelta({ stockPrice: x, strike: leg.strike, timeYears: T, volatility: sigma, rate: 0.05, optionType: leg.optionType })
        total += d * direction * leg.quantity * 100
      }
      rows.push({ x, delta: total })
      if (Math.abs(total) > maxAbsDelta) maxAbsDelta = Math.abs(total)
    }

    const yMax = Math.max(maxAbsDelta, 1)
    const yMin = -yMax

    const currentDelta = rows.reduce(
      (best, r) => (Math.abs(r.x - spotPrice) < Math.abs(best.x - spotPrice) ? r : best),
    ).delta

    const crossings = []
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]
      const b = rows[i]
      if ((a.delta <= 0 && b.delta > 0) || (a.delta >= 0 && b.delta < 0)) {
        const cross = a.delta === b.delta ? a.x : a.x + ((0 - a.delta) / (b.delta - a.delta)) * (b.x - a.x)
        crossings.push(cross)
      }
    }

    const path = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${mapX(r.x, minPrice, maxPrice).toFixed(2)} ${mapY(r.delta, yMin, yMax).toFixed(2)}`).join(' ')

    const zeroY = mapY(0, yMin, yMax)
    const posSegments = []
    const negSegments = []
    let curPos = null
    let curNeg = null
    for (const r of rows) {
      const x = mapX(r.x, minPrice, maxPrice)
      const y = mapY(r.delta, yMin, yMax)
      if (r.delta >= 0) {
        if (!curPos) curPos = []
        curPos.push({ x, y })
        if (curNeg) { negSegments.push(curNeg); curNeg = null }
      } else {
        if (!curNeg) curNeg = []
        curNeg.push({ x, y })
        if (curPos) { posSegments.push(curPos); curPos = null }
      }
    }
    if (curPos) posSegments.push(curPos)
    if (curNeg) negSegments.push(curNeg)

    const areaPath = (segs) =>
      segs.map((seg) => {
        if (seg.length < 2) return ''
        const first = seg[0]
        const last = seg[seg.length - 1]
        const top = seg.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x.toFixed(2)} ${s.y.toFixed(2)}`).join(' ')
        return `${top} L ${last.x.toFixed(2)} ${zeroY.toFixed(2)} L ${first.x.toFixed(2)} ${zeroY.toFixed(2)} Z`
      }).join(' ')

    return { path, posArea: areaPath(posSegments), negArea: areaPath(negSegments), minPrice, maxPrice, yMin, yMax, currentDelta, crossings, zeroY }
  }, [activelegs, spotPrice, heatmap])

  if (!stats) return null

  const spotXPos = mapX(spotPrice, stats.minPrice, stats.maxPrice)
  const currentDeltaShares = stats.currentDelta

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">Position Delta Profile</div>
            <InfoHover text="Position delta across stock prices. Positive delta = bullish exposure, negative = bearish. Zero crossings show where your directional bias flips as the underlying moves." />
          </div>
          <SingleTickerBadge ticker={ticker} />
        </div>
        <div className="insight-badges">
          <span className={`insight-badge ${currentDeltaShares >= 0 ? 'pos' : 'neg'}`}>
            {'\u0394'} at Spot {currentDeltaShares >= 0 ? '+' : '\u2212'}{Math.abs(currentDeltaShares).toFixed(0)}
          </span>
          {stats.crossings.length > 0 ? (
            <span className="insight-badge accent">
              Flips at ${stats.crossings.map((c) => c.toFixed(0)).join(' \u00b7 $')}
            </span>
          ) : (
            <span className="insight-badge neutral">
              {currentDeltaShares >= 0 ? 'Bullish throughout' : 'Bearish throughout'}
            </span>
          )}
        </div>
      </div>
      <svg className="insight-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="Position delta across underlying prices">
        <line x1={PAD_L} y1={stats.zeroY} x2={CHART_W - PAD_R} y2={stats.zeroY} className="insight-zero" />
        <path d={stats.negArea} className="insight-area-loss" />
        <path d={stats.posArea} className="insight-area-profit" />
        <path d={stats.path} className="insight-line insight-line-delta" />
        {stats.crossings.map((c) => {
          const x = mapX(c, stats.minPrice, stats.maxPrice)
          return (
            <g key={c}>
              <line x1={x} y1={PAD_T} x2={x} y2={CHART_H - PAD_B} className="insight-breakeven" />
              <text x={x} y={CHART_H - PAD_B + 14} textAnchor="middle" className="insight-marker-label">
                {'\u0394'}=0 ${c.toFixed(0)}
              </text>
            </g>
          )
        })}
        <line x1={spotXPos} y1={PAD_T} x2={spotXPos} y2={CHART_H - PAD_B} className="insight-spot-line" />
        <text x={PAD_L - 6} y={PAD_T + 4} className="insight-y-label" textAnchor="end">+{stats.yMax.toFixed(0)}</text>
        <text x={PAD_L - 6} y={CHART_H - PAD_B} className="insight-y-label" textAnchor="end">{stats.yMin.toFixed(0)}</text>
        <text x={PAD_L - 6} y={stats.zeroY + 3} className="insight-y-label" textAnchor="end">0</text>
        <text x={spotXPos} y={PAD_T - 6} textAnchor="middle" className="insight-marker-label">Spot ${spotPrice.toFixed(0)}</text>
        <text x={PAD_L - 6} y={PAD_T - 6} className="insight-axis-title" textAnchor="end">{'\u0394'} (shares)</text>
        <text x={CHART_W - PAD_R} y={CHART_H - PAD_B + 22} className="insight-axis-title" textAnchor="end">Underlying price</text>
      </svg>
      <p className="insight-caption">
        Delta shows directional exposure. Positive {'\u0394'} = bullish, negative = bearish. Watch where
        the curve crosses zero &mdash; that&rsquo;s where your position flips direction.
      </p>
    </div>
  )
}

/* ─────────────────────────── 4. Open Interest & Max Pain ─────────────────── */

function OpenInterestMaxPain({ chainData, spotPrice, ticker }) {
  const stats = useMemo(() => {
    if (!chainData || !spotPrice) return null
    const calls = (chainData.calls ?? []).filter((c) => c.strike > 0)
    const puts = (chainData.puts ?? []).filter((p) => p.strike > 0)
    if (!calls.length && !puts.length) return null

    const callMap = new Map(calls.map((c) => [c.strike, Number(c.openInterest) || 0]))
    const putMap = new Map(puts.map((p) => [p.strike, Number(p.openInterest) || 0]))

    const strikes = Array.from(new Set([...callMap.keys(), ...putMap.keys()])).sort((a, b) => a - b)
    if (strikes.length < 2) return null

    const combined = strikes.map((k) => ({ strike: k, callOI: callMap.get(k) ?? 0, putOI: putMap.get(k) ?? 0 }))
    const totalOI = combined.reduce((s, r) => s + r.callOI + r.putOI, 0)
    if (totalOI === 0) return null

    let maxPain = strikes[0]
    let minLoss = Infinity
    for (const K of strikes) {
      let loss = 0
      for (const row of combined) {
        loss += row.callOI * Math.max(K - row.strike, 0)
        loss += row.putOI * Math.max(row.strike - K, 0)
      }
      if (loss < minLoss) { minLoss = loss; maxPain = K }
    }

    const minStrike = strikes[0]
    const maxStrike = strikes[strikes.length - 1]
    const maxOI = Math.max(...combined.map((r) => Math.max(r.callOI, r.putOI))) || 1
    const availWidth = CHART_W - PAD_L - PAD_R
    const barWidth = Math.max(2, Math.min(14, availWidth / (combined.length * 1.4)))

    return {
      combined, minStrike, maxStrike, maxOI, maxPain, barWidth,
      totalCallOI: combined.reduce((s, r) => s + r.callOI, 0),
      totalPutOI: combined.reduce((s, r) => s + r.putOI, 0),
    }
  }, [chainData, spotPrice])

  if (!stats) return null

  const midY = (PAD_T + (CHART_H - PAD_B)) / 2
  const halfHeight = midY - PAD_T
  const spotXPos = mapX(spotPrice, stats.minStrike, stats.maxStrike)
  const maxPainXPos = mapX(stats.maxPain, stats.minStrike, stats.maxStrike)
  const pcRatio = stats.totalCallOI > 0 ? stats.totalPutOI / stats.totalCallOI : 0
  const maxPainPct = ((stats.maxPain - spotPrice) / spotPrice) * 100

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">Open Interest &amp; Max Pain</div>
            <InfoHover text="Open interest by strike for calls (↑) and puts (↓). Max Pain is the strike where option writers lose the least — prices tend to gravitate here as expiration approaches. P/C ratio > 1 signals bearish positioning." />
          </div>
          <SingleTickerBadge ticker={ticker} />
        </div>
        <div className="insight-badges">
          <span className="insight-badge accent">
            Max Pain ${stats.maxPain.toFixed(0)} &middot; {maxPainPct >= 0 ? '+' : ''}{maxPainPct.toFixed(1)}%
          </span>
          <span className={`insight-badge ${pcRatio > 1 ? 'neg' : 'pos'}`}>P/C {pcRatio.toFixed(2)}</span>
        </div>
      </div>
      <svg className="insight-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="Open interest and max pain by strike">
        <line x1={PAD_L} y1={midY} x2={CHART_W - PAD_R} y2={midY} className="insight-axis" />
        {stats.combined.map((row) => {
          const cx = mapX(row.strike, stats.minStrike, stats.maxStrike)
          const callH = (row.callOI / stats.maxOI) * halfHeight
          const putH = (row.putOI / stats.maxOI) * halfHeight
          return (
            <g key={row.strike}>
              {row.callOI > 0 ? (
                <rect x={cx - stats.barWidth / 2} y={midY - callH} width={stats.barWidth} height={callH} className="insight-bar-call">
                  <title>${row.strike} Call OI: {row.callOI.toLocaleString()}</title>
                </rect>
              ) : null}
              {row.putOI > 0 ? (
                <rect x={cx - stats.barWidth / 2} y={midY} width={stats.barWidth} height={putH} className="insight-bar-put">
                  <title>${row.strike} Put OI: {row.putOI.toLocaleString()}</title>
                </rect>
              ) : null}
            </g>
          )
        })}
        <line x1={maxPainXPos} y1={PAD_T} x2={maxPainXPos} y2={CHART_H - PAD_B} className="insight-maxpain-line" />
        <text x={maxPainXPos} y={PAD_T - 6} textAnchor="middle" className="insight-marker-label insight-marker-accent">
          Max Pain ${stats.maxPain.toFixed(0)}
        </text>
        <line x1={spotXPos} y1={PAD_T} x2={spotXPos} y2={CHART_H - PAD_B} className="insight-spot-line" />
        <text x={spotXPos} y={CHART_H - PAD_B + 14} textAnchor="middle" className="insight-marker-label">
          Spot ${spotPrice.toFixed(0)}
        </text>
        <text x={PAD_L} y={PAD_T + 12} className="insight-legend-text insight-legend-text-call">{'\u2191'} Call OI</text>
        <text x={PAD_L} y={CHART_H - PAD_B - 6} className="insight-legend-text insight-legend-text-put">{'\u2193'} Put OI</text>
        <text x={CHART_W - PAD_R} y={CHART_H - PAD_B + 22} className="insight-axis-title" textAnchor="end">Strike price</text>
      </svg>
      <p className="insight-caption">
        Max pain is the strike where option writers lose the least at expiration. Price often
        gravitates toward it as expiration approaches. P/C ratio &gt; 1 = bearish positioning.
      </p>
    </div>
  )
}

/* ─────────────────────────── 5. 3D P/L Surface ──────────────────────────── */

function PnlSurface({ spotPrice, heatmap, ticker, legs = [] }) {
  const stats = useMemo(() => {
    if (!heatmap?.rows?.length || !spotPrice) return null
    const rowsAsc = [...heatmap.rows].sort((a, b) => a.stockPrice - b.stockPrice)
    const dayLevels = heatmap.dayLevels ?? []
    if (rowsAsc.length < 2 || dayLevels.length < 2) return null

    const targetCols = 28
    const stride = Math.max(1, Math.ceil(dayLevels.length / targetCols))
    const sampledDayIdx = []
    for (let d = 0; d < dayLevels.length; d += stride) sampledDayIdx.push(d)
    if (sampledDayIdx[sampledDayIdx.length - 1] !== dayLevels.length - 1) {
      sampledDayIdx.push(dayLevels.length - 1)
    }

    const grid = rowsAsc.map((row) => sampledDayIdx.map((d) => row.cells[d]))

    let maxAbs = 0
    let maxVal = -Infinity
    let minVal = Infinity
    for (const r of grid) {
      for (const c of r) {
        const v = c?.value ?? 0
        maxAbs = Math.max(maxAbs, Math.abs(v))
        if (v > maxVal) maxVal = v
        if (v < minVal) minVal = v
      }
    }
    if (maxAbs === 0) maxAbs = 1

    let spotIdx = 0
    let best = Infinity
    rowsAsc.forEach((r, i) => {
      const d = Math.abs(r.stockPrice - spotPrice)
      if (d < best) { best = d; spotIdx = i }
    })

    return { grid, rows: rowsAsc, sampledDayIdx, dayLabels: heatmap.dayLabels ?? [], dayLevels, maxAbs, maxVal, minVal, spotIdx }
  }, [heatmap, spotPrice])

  const scenarioPaths = useMemo(() => {
    if (!stats) return []
    const sigma = Math.max(heatmap?.avgVolatility ?? 0.25, 0.05)
    const rate = 0.05
    const zList = [2, 1, 0, -1, -2]
    const rows = stats.rows
    const nP = rows.length
    if (nP < 2) return []
    const minRowPrice = rows[0].stockPrice
    const maxRowPrice = rows[nP - 1].stockPrice

    const paths = zList.map((z) => {
      const points = stats.sampledDayIdx.map((dayOrig, j) => {
        const t = dayOrig / 365
        const rawPrice = t > 0
          ? spotPrice * Math.exp((rate - (sigma * sigma) / 2) * t + sigma * Math.sqrt(t) * z)
          : spotPrice
        const clamped = Math.max(minRowPrice, Math.min(maxRowPrice, rawPrice))
        let lo = 0
        for (let i = 0; i < nP - 1; i++) {
          if (rows[i].stockPrice <= clamped && rows[i + 1].stockPrice >= clamped) { lo = i; break }
          if (i === nP - 2) lo = nP - 2
        }
        const p1 = rows[lo].stockPrice
        const p2 = rows[lo + 1].stockPrice
        const v1 = stats.grid[lo][j]?.value ?? 0
        const v2 = stats.grid[lo + 1][j]?.value ?? 0
        const tt = p2 === p1 ? 0 : (clamped - p1) / (p2 - p1)
        const value = v1 + (v2 - v1) * tt
        return { pIdx: lo + tt, dayIdx: j, rawPrice, price: clamped, value }
      })
      const last = points[points.length - 1]
      return { z, points, expiryValue: last?.value ?? 0, expiryPrice: last?.rawPrice ?? spotPrice }
    })

    const ROLES = [
      { label: 'Excellent', color: '#10b981' },
      { label: 'Good', color: '#84cc16' },
      { label: 'Average', color: '#facc15' },
      { label: 'Bad', color: '#f97316' },
      { label: 'Worst', color: '#ef4444' },
    ]
    const ranked = [...paths].sort((a, b) => b.expiryValue - a.expiryValue)
    ranked.forEach((p, idx) => {
      p.role = ROLES[idx].label
      p.color = ROLES[idx].color
      p.rank = idx
    })
    return paths
  }, [stats, heatmap, spotPrice])

  const INITIAL_YAW = -25 * (Math.PI / 180)
  const INITIAL_PITCH = 18 * (Math.PI / 180)
  const [yaw, setYaw] = useState(INITIAL_YAW)
  const [pitch, setPitch] = useState(INITIAL_PITCH)
  const [dragging, setDragging] = useState(false)
  const [showScenarios, setShowScenarios] = useState(true)
  const [greekOverlay, setGreekOverlay] = useState('none')
  const [showIdealSell, setShowIdealSell] = useState(false)
  const dragRef = useRef(null)

  // Compute ideal sell points: global max + an early-exit candidate
  const idealSellPoints = useMemo(() => {
    if (!stats) return []
    const { grid, rows, sampledDayIdx, dayLevels } = stats
    const nP = rows.length
    const nD = sampledDayIdx.length

    // Global max P/L across entire surface
    let maxVal = -Infinity
    let maxI = 0, maxJ = 0
    for (let i = 0; i < nP; i++) {
      for (let j = 0; j < nD; j++) {
        const v = grid[i][j]?.value ?? 0
        if (v > maxVal) { maxVal = v; maxI = i; maxJ = j }
      }
    }

    const points = []
    if (maxVal > 0) {
      const price = rows[maxI].stockPrice
      const dayOrig = sampledDayIdx[maxJ]
      points.push({
        i: maxI, j: maxJ, value: maxVal,
        label: 'Max Gain',
        sublabel: `$${price.toFixed(0)} · +${dayOrig}d`,
        type: 'primary',
      })
    }

    // Early-exit: best P/L within first third of the time axis
    const earlyLimit = Math.max(1, Math.floor(nD * 0.33))
    let earlyMaxVal = -Infinity
    let earlyI = 0, earlyJ = 0
    for (let i = 0; i < nP; i++) {
      for (let j = 0; j < earlyLimit; j++) {
        const v = grid[i][j]?.value ?? 0
        if (v > earlyMaxVal) { earlyMaxVal = v; earlyI = i; earlyJ = j }
      }
    }
    if (
      earlyMaxVal > 0 &&
      earlyMaxVal >= maxVal * 0.4 &&
      (Math.abs(earlyI - maxI) > 2 || Math.abs(earlyJ - maxJ) > 2)
    ) {
      const price = rows[earlyI].stockPrice
      const dayOrig = sampledDayIdx[earlyJ]
      points.push({
        i: earlyI, j: earlyJ, value: earlyMaxVal,
        label: 'Early Exit',
        sublabel: `$${price.toFixed(0)} · +${dayOrig}d`,
        type: 'secondary',
      })
    }

    return points
  }, [stats])

  const greekStats = useMemo(() => {
    if (!stats || !legs.length || greekOverlay === 'none') return null
    const nowSeconds = Date.now() / 1000
    const legDTEs = legs.map((l) =>
      Math.max(Math.round((Number(l.expiration) - nowSeconds) / 86400), 1),
    )

    let maxAbs = 0
    let maxVal = -Infinity
    let minVal = Infinity

    const grid = stats.rows.map((row) =>
      stats.sampledDayIdx.map((dayOrig) => {
        let total = 0
        for (let li = 0; li < legs.length; li++) {
          const leg = legs[li]
          const daysRemaining = Math.max(legDTEs[li] - dayOrig, 0)
          const timeYears = daysRemaining / 365
          const volatility = Math.max(Number(leg.impliedVolatility) || 0.25, 0.05)
          const direction = leg.positionSide === 'sell' ? -1 : 1
          const qty = leg.quantity ?? 1
          let v = 0
          if (greekOverlay === 'delta') {
            v = calcDelta({ stockPrice: row.stockPrice, strike: leg.strike, timeYears, volatility, rate: 0.05, optionType: leg.optionType })
          } else if (greekOverlay === 'gamma') {
            v = calcGamma({ stockPrice: row.stockPrice, strike: leg.strike, timeYears, volatility, rate: 0.05 })
          } else if (greekOverlay === 'theta') {
            v = calcTheta({ stockPrice: row.stockPrice, strike: leg.strike, timeYears, volatility, rate: 0.05, optionType: leg.optionType })
          } else if (greekOverlay === 'vega') {
            v = calcVega({ stockPrice: row.stockPrice, strike: leg.strike, timeYears, volatility, rate: 0.05 })
          }
          total += v * direction * qty * 100
        }
        if (Math.abs(total) > maxAbs) maxAbs = Math.abs(total)
        if (total > maxVal) maxVal = total
        if (total < minVal) minVal = total
        return total
      }),
    )

    if (maxAbs === 0) maxAbs = 1
    return { grid, maxAbs, maxVal, minVal }
  }, [stats, legs, greekOverlay])

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, yaw, pitch }
    setDragging(true)
  }, [yaw, pitch])

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    const sens = 0.6 * (Math.PI / 180)
    setYaw(dragRef.current.yaw + dx * sens)
    setPitch(Math.max(-Math.PI / 2.4, Math.min(Math.PI / 2.4, dragRef.current.pitch - dy * sens)))
  }, [])

  const onPointerUp = useCallback((e) => {
    e.currentTarget?.releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDragging(false)
  }, [])

  const resetView = useCallback(() => {
    setYaw(INITIAL_YAW)
    setPitch(INITIAL_PITCH)
  }, [INITIAL_YAW, INITIAL_PITCH])

  if (!stats) return null

  const W = 1200
  const H = 460
  const cx = W / 2
  const cy = H / 2 + 20
  const priceWidth = 780
  const depthWidth = 340
  const valHalf = 150
  const nP = stats.rows.length
  const nD = stats.sampledDayIdx.length

  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)

  function project(pIdx, dIdx, val) {
    const x = (pIdx / (nP - 1) - 0.5) * priceWidth
    const y = (val / stats.maxAbs) * valHalf
    const z = (dIdx / (nD - 1) - 0.5) * depthWidth
    const x1 = x * cosY - z * sinY
    const z1 = x * sinY + z * cosY
    const y2 = y * cosP + z1 * sinP
    const z2 = -y * sinP + z1 * cosP
    return { x: cx + x1, y: cy - y2, z: z2 }
  }

  const c00 = project(0, 0, 0)
  const c10 = project(nP - 1, 0, 0)
  const c01 = project(0, nD - 1, 0)
  const c11 = project(nP - 1, nD - 1, 0)
  const zTop = project(0, 0, stats.maxAbs)
  const zBot = project(0, 0, -stats.maxAbs)

  const cellColor = (v) => {
    const intensity = Math.min(Math.abs(v) / stats.maxAbs, 1)
    const alphaFill = 0.4 + intensity * 0.5
    if (v >= 0) return `rgba(34, 197, 94, ${alphaFill.toFixed(3)})`
    return `rgba(239, 68, 68, ${alphaFill.toFixed(3)})`
  }

  const quads = []
  for (let j = 0; j < nD - 1; j++) {
    for (let i = 0; i < nP - 1; i++) {
      const v00 = stats.grid[i][j]?.value ?? 0
      const v10 = stats.grid[i + 1][j]?.value ?? 0
      const v11 = stats.grid[i + 1][j + 1]?.value ?? 0
      const v01 = stats.grid[i][j + 1]?.value ?? 0
      const p00 = project(i, j, v00)
      const p10 = project(i + 1, j, v10)
      const p11 = project(i + 1, j + 1, v11)
      const p01 = project(i, j + 1, v01)
      const avgV = (v00 + v10 + v11 + v01) / 4
      const depth = (p00.z + p10.z + p11.z + p01.z) / 4
      quads.push({
        key: `q-${i}-${j}`,
        points: `${p00.x.toFixed(1)},${p00.y.toFixed(1)} ${p10.x.toFixed(1)},${p10.y.toFixed(1)} ${p11.x.toFixed(1)},${p11.y.toFixed(1)} ${p01.x.toFixed(1)},${p01.y.toFixed(1)}`,
        fill: cellColor(avgV),
        depth,
      })
    }
  }
  quads.sort((a, b) => a.depth - b.depth)

  const GREEK_COLORS = {
    delta: (v, a) => v >= 0 ? `rgba(99,179,237,${a})` : `rgba(251,146,60,${a})`,
    gamma: (_v, a) => `rgba(192,132,252,${a})`,
    theta: (v, a) => v >= 0 ? `rgba(99,179,237,${a})` : `rgba(251,146,60,${a})`,
    vega:  (_v, a) => `rgba(45,212,191,${a})`,
  }

  const greekQuads = greekStats
    ? (() => {
        const result = []
        const colorFn = GREEK_COLORS[greekOverlay] ?? GREEK_COLORS.delta
        for (let j = 0; j < nD - 1; j++) {
          for (let i = 0; i < nP - 1; i++) {
            const v00 = greekStats.grid[i][j]
            const v10 = greekStats.grid[i + 1][j]
            const v11 = greekStats.grid[i + 1][j + 1]
            const v01 = greekStats.grid[i][j + 1]
            // Scale Greek value to occupy same vertical range as P&L surface
            const scale = stats.maxAbs / greekStats.maxAbs
            const p00 = project(i, j, v00 * scale)
            const p10 = project(i + 1, j, v10 * scale)
            const p11 = project(i + 1, j + 1, v11 * scale)
            const p01 = project(i, j + 1, v01 * scale)
            const avgV = (v00 + v10 + v11 + v01) / 4
            const intensity = Math.min(Math.abs(avgV) / greekStats.maxAbs, 1)
            const alpha = (0.18 + intensity * 0.42).toFixed(3)
            const depth = (p00.z + p10.z + p11.z + p01.z) / 4
            result.push({
              key: `gq-${i}-${j}`,
              points: `${p00.x.toFixed(1)},${p00.y.toFixed(1)} ${p10.x.toFixed(1)},${p10.y.toFixed(1)} ${p11.x.toFixed(1)},${p11.y.toFixed(1)} ${p01.x.toFixed(1)},${p01.y.toFixed(1)}`,
              fill: colorFn(avgV, alpha),
              depth,
            })
          }
        }
        result.sort((a, b) => a.depth - b.depth)
        return result
      })()
    : []

  const dayWires = stats.sampledDayIdx.map((_, j) => {
    let depthSum = 0
    const pts = stats.rows.map((_, i) => {
      const v = stats.grid[i][j]?.value ?? 0
      const p = project(i, j, v)
      depthSum += p.z
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    return { key: `dw-${j}`, points: pts.join(' '), isFront: j === 0, isBack: j === nD - 1, depth: depthSum / stats.rows.length }
  })

  const priceWires = stats.rows.map((_, i) => {
    let depthSum = 0
    const pts = stats.sampledDayIdx.map((_, j) => {
      const v = stats.grid[i][j]?.value ?? 0
      const p = project(i, j, v)
      depthSum += p.z
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    return { key: `pw-${i}`, points: pts.join(' '), depth: depthSum / stats.sampledDayIdx.length }
  })

  const spotCurve = stats.sampledDayIdx.map((_, j) => {
    const v = stats.grid[stats.spotIdx][j]?.value ?? 0
    const proj = project(stats.spotIdx, j, v)
    const base = project(stats.spotIdx, j, 0)
    return { proj, base, value: v }
  })
  const spotCurtainPath =
    spotCurve.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ') +
    ' ' +
    spotCurve.slice().reverse().map((s) => `L ${s.base.x.toFixed(1)} ${s.base.y.toFixed(1)}`).join(' ') + ' Z'
  const spotTopPath = spotCurve.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ')
  const spotEnd = spotCurve[spotCurve.length - 1]
  const spotFront = spotCurve[0]

  const priceTickIdx = [0, Math.floor((nP - 1) / 2), nP - 1]
  const dayTickIdx = [0, Math.floor((nD - 1) / 2), nD - 1]
  const yawDeg = ((yaw * 180) / Math.PI).toFixed(0)
  const pitchDeg = ((pitch * 180) / Math.PI).toFixed(0)

  return (
    <div className="insight-panel insight-panel--full">
      <div className="insight-header">
        <div className="insight-title-block">
          <div className="insight-title-row">
            <div className="insight-title">3D P/L Surface &mdash; Price &times; Time</div>
            <InfoHover text="Total P/L at every combination of stock price (rows) and days elapsed (columns). Amber ridge = flat stock (pure theta decay). Colored paths = ±2σ, ±1σ, 0σ lognormal scenarios. Drag to rotate, double-click to reset." />
          </div>
          <SingleTickerBadge ticker={ticker} />
        </div>
        <div className="insight-badges">
          <span className="insight-badge pos">Max +${stats.maxVal.toFixed(0)}</span>
          <span className="insight-badge neg">Min ${stats.minVal.toFixed(0)}</span>
          <span className="insight-badge accent">
            At Spot @ Expiry {spotEnd.value >= 0 ? '+' : '\u2212'}${Math.abs(spotEnd.value).toFixed(0)}
          </span>
          <span className="insight-badge neutral">{yawDeg}&deg; &middot; {pitchDeg}&deg;</span>
          <button
            type="button"
            className={`insight-reset-btn ${showIdealSell ? 'is-active' : ''}`}
            onClick={() => setShowIdealSell((v) => !v)}
            aria-pressed={showIdealSell}
          >
            {showIdealSell ? 'Hide ideal sells' : 'Ideal sell points'}
          </button>
          <button
            type="button"
            className={`insight-reset-btn ${showScenarios ? 'is-active' : ''}`}
            onClick={() => setShowScenarios((v) => !v)}
            aria-pressed={showScenarios}
          >
            {showScenarios ? 'Hide scenarios' : 'Show scenarios'}
          </button>
          <select
            className="insight-greek-select"
            value={greekOverlay}
            onChange={(e) => setGreekOverlay(e.target.value)}
            aria-label="Greek surface overlay"
          >
            <option value="none">Greeks: Off</option>
            <option value="delta">Overlay: Delta</option>
            <option value="gamma">Overlay: Gamma</option>
            <option value="theta">Overlay: Theta</option>
            <option value="vega">Overlay: Vega</option>
          </select>
          <button type="button" className="insight-reset-btn" onClick={resetView}>Reset view</button>
        </div>
      </div>
      <svg
        className={`insight-chart insight-chart--tall surface-svg ${dragging ? 'surface-svg--grabbing' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Three-dimensional profit and loss surface — drag to rotate"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
      >
        <defs>
          <linearGradient id="spot-curtain-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245, 181, 68, 0.35)" />
            <stop offset="100%" stopColor="rgba(245, 181, 68, 0.05)" />
          </linearGradient>
        </defs>
        <polygon
          points={`${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`}
          className="surface-baseplane"
        />
        <line x1={zTop.x} y1={zTop.y} x2={zBot.x} y2={zBot.y} className="surface-axis" />
        <line x1={c00.x} y1={c00.y} x2={c01.x} y2={c01.y} className="surface-axis" />
        <line x1={c00.x} y1={c00.y} x2={c10.x} y2={c10.y} className="surface-axis" />
        <line
          x1={c11.x} y1={c11.y}
          x2={project(nP - 1, nD - 1, stats.maxAbs * 0.7).x}
          y2={project(nP - 1, nD - 1, stats.maxAbs * 0.7).y}
          className="surface-axis-faint"
        />
        {quads.map((q) => (
          <polygon key={q.key} points={q.points} fill={q.fill} className="surface-cell" />
        ))}
        {greekQuads.map((q) => (
          <polygon key={q.key} points={q.points} fill={q.fill} className="surface-greek-cell" />
        ))}
        {dayWires.map((w) => (
          <polyline key={w.key} points={w.points} className={`surface-wire ${w.isBack ? 'surface-wire-expiry' : ''} ${w.isFront ? 'surface-wire-today' : ''}`} />
        ))}
        {priceWires.map((w) => (
          <polyline key={w.key} points={w.points} className="surface-wire surface-wire-price" />
        ))}
        <path d={spotCurtainPath} fill="url(#spot-curtain-grad)" className="surface-curtain" />
        <path d={spotTopPath} className="surface-spot-ridge" />
        {priceTickIdx.map((i) => {
          const p = project(i, 0, 0)
          const price = stats.rows[i].stockPrice
          const pctFromSpot = ((price - spotPrice) / spotPrice) * 100
          return (
            <g key={`pt-${i}`}>
              <circle cx={p.x} cy={p.y} r={2} className="surface-tick-dot" />
              <text x={p.x} y={p.y + 16} textAnchor="middle" className="insight-marker-label">${price.toFixed(0)}</text>
              <text x={p.x} y={p.y + 30} textAnchor="middle" className="surface-tick-sub">
                {pctFromSpot >= 0 ? '+' : ''}{pctFromSpot.toFixed(0)}%
              </text>
            </g>
          )
        })}
        {dayTickIdx.map((j) => {
          const p = project(nP - 1, j, 0)
          const dayIdxOriginal = stats.sampledDayIdx[j]
          return (
            <g key={`dt-${j}`}>
              <circle cx={p.x} cy={p.y} r={2} className="surface-tick-dot" />
              <text x={p.x + 8} y={p.y + 4} textAnchor="start" className="insight-marker-label">
                {j === 0 ? 'Today' : `+${stats.dayLevels[dayIdxOriginal]}d`}
              </text>
            </g>
          )
        })}
        <text x={zTop.x - 8} y={zTop.y + 3} textAnchor="end" className="insight-y-label">+${stats.maxAbs.toFixed(0)}</text>
        <text x={c00.x - 8} y={c00.y + 3} textAnchor="end" className="insight-y-label">$0</text>
        <text x={zBot.x - 8} y={zBot.y + 3} textAnchor="end" className="insight-y-label">&minus;${stats.maxAbs.toFixed(0)}</text>
        <circle cx={spotFront.proj.x} cy={spotFront.proj.y} r={3} className="surface-spot-dot" />
        <circle cx={spotEnd.proj.x} cy={spotEnd.proj.y} r={3.5} className="surface-spot-dot" />
        <text x={spotEnd.proj.x + 8} y={spotEnd.proj.y - 6} textAnchor="start" className="insight-marker-label insight-marker-accent">
          If Flat: {spotEnd.value >= 0 ? '+' : '\u2212'}${Math.abs(spotEnd.value).toFixed(0)}
        </text>
        {showIdealSell && idealSellPoints.map((pt) => {
          const proj = project(pt.i, pt.j, pt.value)
          const isPrimary = pt.type === 'primary'
          const color = isPrimary ? '#f0c040' : '#a78bfa'
          const r = isPrimary ? 7 : 5.5
          return (
            <g key={`ideal-${pt.type}`} className="surface-ideal-sell">
              {/* diamond marker = rotated square */}
              <rect
                x={proj.x - r}
                y={proj.y - r}
                width={r * 2}
                height={r * 2}
                fill={color}
                stroke="rgba(11,15,25,0.9)"
                strokeWidth={1.5}
                transform={`rotate(45 ${proj.x} ${proj.y})`}
                opacity={0.92}
              />
              {/* halo glow */}
              <rect
                x={proj.x - r - 3}
                y={proj.y - r - 3}
                width={(r + 3) * 2}
                height={(r + 3) * 2}
                fill="none"
                stroke={color}
                strokeWidth={1}
                transform={`rotate(45 ${proj.x} ${proj.y})`}
                opacity={0.3}
              />
              <text
                x={proj.x + r + 6}
                y={proj.y - 6}
                textAnchor="start"
                className="surface-ideal-label"
                style={{ fill: color }}
              >
                {pt.label}
              </text>
              <text
                x={proj.x + r + 6}
                y={proj.y + 8}
                textAnchor="start"
                className="surface-ideal-sublabel"
              >
                {pt.sublabel} &middot; +${pt.value.toFixed(0)}
              </text>
            </g>
          )
        })}
        {showScenarios &&
          [...scenarioPaths].sort((a, b) => b.rank - a.rank).map((path) => {
            const projected = path.points.map((pt) => project(pt.pIdx, pt.dayIdx, pt.value))
            if (projected.length === 0) return null
            const d = projected.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
            const end = projected[projected.length - 1]
            const start = projected[0]
            return (
              <g key={`scenario-${path.z}`} className="surface-scenario-group">
                <path d={d} className="surface-scenario-halo" stroke="rgba(11, 15, 25, 0.85)" strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d={d} className="surface-scenario-path" stroke={path.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={start.x} cy={start.y} r={2.5} fill={path.color} stroke="rgba(11, 15, 25, 0.9)" strokeWidth={1} />
                <circle cx={end.x} cy={end.y} r={4} fill={path.color} stroke="rgba(11, 15, 25, 0.9)" strokeWidth={1.5} />
              </g>
            )
          })}
        {showScenarios && (
          <g className="surface-scenario-legend" transform={`translate(16, ${H - 96})`}>
            <rect x={-6} y={-14} width={158} height={92} rx={6} className="surface-legend-bg" />
            <text x={0} y={0} className="surface-legend-title">Scenario paths</text>
            {[...scenarioPaths].sort((a, b) => a.rank - b.rank).map((path, idx) => {
              const y = 14 + idx * 13
              const sign = path.expiryValue >= 0 ? '+' : '\u2212'
              return (
                <g key={`legend-${path.z}`}>
                  <line x1={0} y1={y} x2={18} y2={y} stroke={path.color} strokeWidth={2} strokeLinecap="round" />
                  <circle cx={22} cy={y} r={2.5} fill={path.color} />
                  <text x={30} y={y + 3} className="surface-legend-label">{path.role}</text>
                  <text x={148} y={y + 3} textAnchor="end" className="surface-legend-value" fill={path.color}>
                    {sign}${Math.abs(path.expiryValue).toFixed(0)}
                  </text>
                </g>
              )
            })}
          </g>
        )}
        {!dragging ? (
          <text x={W - 16} y={H - 12} textAnchor="end" className="surface-hint">
            drag to rotate &middot; double-click to reset
          </text>
        ) : null}
        {greekStats && !dragging && (() => {
          const GREEK_META = {
            delta: { label: 'Delta', color: '#63b3ed', negColor: '#fb923c', unit: 'Δ' },
            gamma: { label: 'Gamma', color: '#c084fc', negColor: '#c084fc', unit: 'Γ' },
            theta: { label: 'Theta ($/day)', color: '#63b3ed', negColor: '#fb923c', unit: 'Θ' },
            vega:  { label: 'Vega ($/1%IV)', color: '#2dd4bf', negColor: '#2dd4bf', unit: 'V' },
          }
          const meta = GREEK_META[greekOverlay]
          if (!meta) return null
          const hasNeg = greekStats.minVal < 0
          const posSign = greekStats.maxVal >= 0 ? '+' : ''
          const negSign = greekStats.minVal < 0 ? '−' : ''
          return (
            <g className="surface-greek-legend" transform={`translate(${W - 180}, 16)`}>
              <rect x={-6} y={-14} width={176} height={hasNeg ? 62 : 48} rx={6} className="surface-legend-bg" />
              <text x={0} y={0} className="surface-legend-title">{meta.label} overlay</text>
              <rect x={0} y={12} width={14} height={10} rx={2} fill={meta.color} opacity={0.7} />
              <text x={20} y={21} className="surface-legend-label">
                Max: {posSign}{greekStats.maxVal.toFixed(2)}
              </text>
              {hasNeg && (
                <>
                  <rect x={0} y={30} width={14} height={10} rx={2} fill={meta.negColor} opacity={0.7} />
                  <text x={20} y={39} className="surface-legend-label">
                    Min: {negSign}{Math.abs(greekStats.minVal).toFixed(2)}
                  </text>
                </>
              )}
            </g>
          )
        })()}
      </svg>
      <p className="insight-caption">
        The surface shows total P/L at every combination of stock price and days elapsed. Amber
        ridge = trajectory if the stock stays exactly at spot (pure theta decay). Colored paths
        trace 5 scenario trajectories (&plusmn;2&sigma;, &plusmn;1&sigma;, and 0&sigma; lognormal drifts) draped over the
        surface, ranked by expiry outcome from Excellent to Worst. Green regions = profit, red
        = loss. Drag anywhere on the chart to rotate.
      </p>
    </div>
  )
}

/* ───────────────────────── Chain Insights strip ────────────────────────── */

export function ChainInsights({ chainData, spotPrice, activelegs = [], ticker, dragHandle }) {
  const [open, setOpen] = useState(true)
  if (!chainData || !spotPrice || !ticker) return null
  return (
    <section className="insights-panel-wrap">
      <div className="insights-panel-header">
        <span className="insights-panel-title">Chain Insights</span>
        {dragHandle}
        <button
          type="button"
          className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse chain insights' : 'Expand chain insights'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="chain-insights-strip">
          <VolatilitySkew
            chainData={chainData}
            spotPrice={spotPrice}
            activelegs={activelegs}
            ticker={ticker}
          />
          <OpenInterestMaxPain
            chainData={chainData}
            spotPrice={spotPrice}
            ticker={ticker}
          />
        </div>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

export function Insights({ groups = [], aggregateMode = false, dragHandle }) {
  const [open, setOpen] = useState(true)
  const validGroups = groups.filter(
    (g) => g && g.spot && g.legs && g.legs.length > 0 && g.heatmap,
  )
  if (validGroups.length === 0) return null

  const multi = validGroups.length > 1

  const content = !multi ? (
    // Single underlying — panels are direct grid children for natural 2-col flow:
    // [PoP]    [Delta]   ← row 1
    // [3D Surface — full width]  ← row 2
    (() => {
      const g = validGroups[0]
      return (
        <div className="insights-section insights-section--single">
          <ProbOfProfit spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} />
          <DeltaProfile activelegs={g.legs} spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} />
          <PnlSurface spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} legs={g.legs} />
        </div>
      )
    })()
  ) : (
    // Multi underlying — side-by-side comparison groups with PoP + Delta,
    // then full-width 3D surfaces per underlying (hidden in aggregate mode — shown in AggregateView)
    <div className="insights-section insights-section--multi">
      {validGroups.map((g) => (
        <div key={g.ticker} className="insights-group insights-group--multi">
          <div className="insights-group-header">
            <span className="ticker-chip ticker-chip--heading">{g.ticker}</span>
            <span className="insights-group-legs">
              {g.legs.length} leg{g.legs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ProbOfProfit spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} />
          <DeltaProfile activelegs={g.legs} spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} />
        </div>
      ))}
      {!aggregateMode && validGroups.map((g) => (
        <PnlSurface key={`surface-${g.ticker}`} spotPrice={g.spot} heatmap={g.heatmap} ticker={g.ticker} legs={g.legs} />
      ))}
    </div>
  )

  return (
    <section className="insights-panel-wrap">
      <div className="insights-panel-header">
        <span className="insights-panel-title">Analysis</span>
        {dragHandle}
        <button
          type="button"
          className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse analysis' : 'Expand analysis'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>
      {open && content}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * P/L panel for a single underlying: expiration curve + heatmap + horizontal
 * scrollbar. Each instance owns its own scroll refs so multiple panels can
 * coexist (one per ticker) when a position spans multiple underlyings.
 */

function buildCurvePath(points, width, height, padding) {
  if (points.length < 2) return ''
  const prices = points.map((p) => p.stockPrice)
  const values = points.map((p) => p.value)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const xSpan = Math.max(maxPrice - minPrice, 1)
  const ySpan = Math.max(maxValue - minValue, 1)
  return points
    .map((pt, i) => {
      const x = padding + ((pt.stockPrice - minPrice) / xSpan) * (width - padding * 2)
      const y =
        height -
        padding -
        ((pt.value - minValue) / ySpan) * (height - padding * 2)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function mapRange(value, min, max, outMin, outMax) {
  const span = Math.max(max - min, 1)
  return outMin + ((value - min) / span) * (outMax - outMin)
}

export function PositionPnLPanel({
  ticker,
  spotPrice,
  heatmap,
  headingSuffix,
  showTickerBadge,
  dragHandle,
  legs = [],
}) {
  const scrollRef = useRef(null)
  const thumbRef = useRef(null)
  const trackRef = useRef(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartScrollLeft = useRef(0)
  const [open, setOpen] = useState(true)
  const [includePremium, setIncludePremium] = useState(true)

  // Net premium offset: the constant shift added to P/L values when premium is excluded.
  // Long leg: adds back the cost paid → shows gross payoff
  // Short leg: removes the credit received → shows gross liability
  const netPremiumOffset = useMemo(() =>
    legs.reduce((sum, leg) => {
      const dir = leg.positionSide === 'buy' ? 1 : -1
      return sum + leg.markPrice * 100 * leg.quantity * dir
    }, 0)
  , [legs])

  // Adjusted expiry curve — shifts values by the premium offset when toggle is off
  const adjustedCurve = useMemo(() => {
    const raw = heatmap?.expiryCurve ?? []
    if (includePremium || netPremiumOffset === 0 || legs.length === 0) return raw
    return raw.map(pt => ({ ...pt, value: pt.value + netPremiumOffset }))
  }, [heatmap?.expiryCurve, includePremium, netPremiumOffset, legs.length])

  // Unlimited-risk detection: naked short call with no covering long call
  const isUnlimitedRisk = useMemo(() =>
    legs.some(leg =>
      leg.positionSide === 'sell' && leg.optionType === 'call' &&
      !legs.some(l =>
        l.positionSide === 'buy' && l.optionType === 'call' &&
        l.ticker === leg.ticker && l.expiration === leg.expiration
      )
    )
  , [legs])

  // Large-loss detection: naked short put (large downside) or deep loss vs gain
  const hasNakedShortPut = useMemo(() =>
    legs.some(leg =>
      leg.positionSide === 'sell' && leg.optionType === 'put' &&
      !legs.some(l =>
        l.positionSide === 'buy' && l.optionType === 'put' &&
        l.ticker === leg.ticker && l.expiration === leg.expiration
      )
    )
  , [legs])

  const updateThumb = useCallback(() => {
    const scroll = scrollRef.current
    const thumb = thumbRef.current
    const track = trackRef.current
    if (!scroll || !thumb || !track) return
    const scrollable = scroll.scrollWidth - scroll.clientWidth
    if (scrollable <= 0) {
      thumb.style.width = '100%'
      thumb.style.left = '0px'
      return
    }
    const trackWidth = track.clientWidth
    const thumbWidth = Math.max((scroll.clientWidth / scroll.scrollWidth) * trackWidth, 40)
    const thumbLeft = (scroll.scrollLeft / scrollable) * (trackWidth - thumbWidth)
    thumb.style.width = `${thumbWidth}px`
    thumb.style.left = `${thumbLeft}px`
  }, [])

  const onThumbPointerDown = useCallback((e) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartScrollLeft.current = scrollRef.current?.scrollLeft ?? 0
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [])

  const onThumbPointerMove = useCallback((e) => {
    if (!isDragging.current) return
    const scroll = scrollRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!scroll || !track || !thumb) return
    const scrollable = scroll.scrollWidth - scroll.clientWidth
    if (scrollable <= 0) return
    const dx = e.clientX - dragStartX.current
    const trackWidth = track.clientWidth
    const thumbWidth = thumb.offsetWidth
    scroll.scrollLeft = dragStartScrollLeft.current + dx * (scrollable / (trackWidth - thumbWidth))
  }, [])

  const onThumbPointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const onTrackPointerDown = useCallback((e) => {
    if (e.target !== trackRef.current) return
    const scroll = scrollRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!scroll || !track || !thumb) return
    const rect = track.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const trackWidth = track.clientWidth
    const thumbWidth = thumb.offsetWidth
    const scrollable = scroll.scrollWidth - scroll.clientWidth
    const clampedLeft = Math.max(0, Math.min(clickX - thumbWidth / 2, trackWidth - thumbWidth))
    scroll.scrollLeft = (clampedLeft / (trackWidth - thumbWidth)) * scrollable
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const ro = new ResizeObserver(updateThumb)
    ro.observe(scroll)
    updateThumb()
    return () => ro.disconnect()
  }, [updateThumb, heatmap?.rows?.length])

  const chartWidth = 960
  const chartHeight = 220
  const chartPadding = 28
  const curvePath = buildCurvePath(adjustedCurve, chartWidth, chartHeight, chartPadding)
  const curvePrices = adjustedCurve.map((p) => p.stockPrice)
  const curveValues = adjustedCurve.map((p) => p.value)
  const minPriceCurve = curvePrices.length ? Math.min(...curvePrices) : 0
  const maxPriceCurve = curvePrices.length ? Math.max(...curvePrices) : 1
  const minCurve = curveValues.length ? Math.min(...curveValues) : 0
  const maxCurve = curveValues.length ? Math.max(...curveValues) : 0
  const maxGain = maxCurve
  const maxLoss = minCurve
  const isLargeLoss = hasNakedShortPut || (maxLoss < -200 && Math.abs(maxLoss) > Math.abs(maxGain) * 1.5)
  const isDangerZone = isUnlimitedRisk || isLargeLoss
  const xSpan = Math.max(maxPriceCurve - minPriceCurve, 1)
  const ySpan = Math.max(maxCurve - minCurve, 1)
  const zeroY =
    maxCurve === minCurve
      ? chartHeight / 2
      : chartHeight - chartPadding - ((0 - minCurve) / ySpan) * (chartHeight - chartPadding * 2)
  const clampedZeroY = Math.max(chartPadding, Math.min(chartHeight - chartPadding, zeroY))
  const minX = chartPadding
  const maxX = chartWidth - chartPadding
  const spotX = mapRange(spotPrice || minPriceCurve, minPriceCurve, maxPriceCurve, minX, maxX)

  // Area path: traces zero line → curve → back to zero line, used for profit/loss fills
  const curveAreaPath = adjustedCurve.length < 2 ? '' : (() => {
    const pts = adjustedCurve.map(pt => ({
      x: chartPadding + ((pt.stockPrice - minPriceCurve) / xSpan) * (chartWidth - chartPadding * 2),
      y: chartHeight - chartPadding - ((pt.value - minCurve) / ySpan) * (chartHeight - chartPadding * 2),
    }))
    return (
      `M ${pts[0].x.toFixed(2)},${clampedZeroY.toFixed(2)} ` +
      pts.map(p => `L ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') +
      ` L ${pts[pts.length - 1].x.toFixed(2)},${clampedZeroY.toFixed(2)} Z`
    )
  })()

  // Stable SVG ID fragment (avoids collisions when multiple panels render)
  const svgId = (ticker || 'c').replace(/[^a-zA-Z0-9]/g, '_')
  // Per-cell offset applied to heatmap numbers when premium is toggled off
  const cellOffset = !includePremium && legs.length > 0 ? netPremiumOffset : 0

  return (
    <section className="heatmap-panel">
      <div className="heatmap-header">
        <div className="heatmap-header-text">
          <h2>
            {ticker && (
              <span
                className={`ticker-chip ticker-chip--heading ${
                  showTickerBadge ? '' : 'ticker-chip--sm'
                }`}
              >
                {ticker}
              </span>
            )}
            {headingSuffix}
          </h2>
          <p>Rows: stock price · Columns: days to expiration</p>
        </div>
        <div className="heatmap-header-actions">
          {dragHandle}
          {isDangerZone && (
            <span
              className="curve-danger-badge"
              title={isUnlimitedRisk
                ? 'Naked short call detected — losses are theoretically unlimited as the stock rises'
                : 'Large potential loss detected relative to maximum gain'}
            >
              ⚠ {isUnlimitedRisk ? 'Unlimited Risk' : 'High Risk'}
            </span>
          )}
          {legs.length > 0 && (
            <button
              type="button"
              className={`curve-premium-toggle${!includePremium ? ' active' : ''}`}
              onClick={() => setIncludePremium(v => !v)}
              title={includePremium
                ? 'Showing net P/L after deducting premium cost. Click to show gross payoff.'
                : 'Showing gross payoff without premium deduction. Click to show net P/L.'}
              aria-pressed={!includePremium}
            >
              {includePremium ? 'Incl. Premium' : 'Excl. Premium'}
            </button>
          )}
          <button
            type="button"
            className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Collapse P/L panel' : 'Expand P/L panel'}
          >
            <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
              <path d="M0 0L5 6L10 0z" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <>

      {adjustedCurve.length > 1 ? (
        <div className="curve-panel">
          <div className="curve-title-row">
            <span className="curve-title">
              {includePremium ? 'P/L at Expiration' : 'Gross Payoff at Expiration'}
            </span>
            {isDangerZone && (
              <span className="curve-danger-inline">
                ⚠ {isUnlimitedRisk
                  ? 'Unlimited risk — loss grows as stock rises'
                  : `Max loss ≈ $${Math.abs(maxLoss).toFixed(0)}`}
              </span>
            )}
          </div>
          <svg
            className="curve-chart"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`${includePremium ? 'Profit and loss' : 'Gross payoff'} curve at expiration${ticker ? ` for ${ticker}` : ''}`}
          >
            <defs>
              <clipPath id={`cpos-${svgId}`}>
                <rect
                  x={chartPadding} y={chartPadding}
                  width={chartWidth - chartPadding * 2}
                  height={Math.max(0, clampedZeroY - chartPadding)}
                />
              </clipPath>
              <clipPath id={`cneg-${svgId}`}>
                <rect
                  x={chartPadding} y={clampedZeroY}
                  width={chartWidth - chartPadding * 2}
                  height={Math.max(0, chartHeight - chartPadding - clampedZeroY)}
                />
              </clipPath>
              {isDangerZone && (
                <pattern id={`dhatch-${svgId}`} patternUnits="userSpaceOnUse" width="10" height="10">
                  <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(239,68,68,0.45)" strokeWidth="2" />
                </pattern>
              )}
            </defs>
            {curveAreaPath && (
              <path d={curveAreaPath} fill="rgba(34,197,94,0.11)" clipPath={`url(#cpos-${svgId})`} />
            )}
            {curveAreaPath && (
              <path
                d={curveAreaPath}
                fill={isDangerZone ? `url(#dhatch-${svgId})` : 'rgba(239,68,68,0.11)'}
                clipPath={`url(#cneg-${svgId})`}
              />
            )}
            {isDangerZone && curveAreaPath && (
              <path d={curveAreaPath} fill="rgba(239,68,68,0.07)" clipPath={`url(#cneg-${svgId})`} />
            )}
            <line
              x1={chartPadding}
              y1={chartPadding}
              x2={chartPadding}
              y2={chartHeight - chartPadding}
              className="curve-axis"
            />
            <line
              x1={chartPadding}
              y1={chartHeight - chartPadding}
              x2={chartWidth - chartPadding}
              y2={chartHeight - chartPadding}
              className="curve-axis"
            />
            <line
              x1={chartPadding}
              y1={clampedZeroY}
              x2={chartWidth - chartPadding}
              y2={clampedZeroY}
              className="curve-zero"
            />
            <path d={curvePath} className="curve-line" />

            <text x={12} y={chartPadding + 2} className="curve-label" textAnchor="start">
              {maxCurve.toFixed(0)}
            </text>
            <text
              x={12}
              y={chartHeight - chartPadding + 2}
              className="curve-label"
              textAnchor="start"
            >
              {minCurve.toFixed(0)}
            </text>
            <text x={chartPadding + 4} y={15} className="curve-axis-title" textAnchor="start">
              {includePremium ? 'Net P/L (USD)' : 'Gross Payoff (USD)'}
            </text>
            {maxGain > 0 && (
              <text
                x={chartWidth - chartPadding - 4}
                y={chartPadding + 12}
                className="curve-label curve-label--profit"
                textAnchor="end"
              >
                Max gain: ${maxGain.toFixed(0)}
              </text>
            )}
            {maxLoss < 0 && (
              <text
                x={chartWidth - chartPadding - 4}
                y={chartHeight - chartPadding - 6}
                className={`curve-label${isDangerZone ? ' curve-label--danger' : ''}`}
                textAnchor="end"
              >
                {isUnlimitedRisk ? '⚠ Max loss: unlimited' : `Max loss: $${Math.abs(maxLoss).toFixed(0)}`}
              </text>
            )}

            <circle cx={minX} cy={chartHeight - chartPadding} r="2.5" className="curve-tick" />
            <circle cx={spotX} cy={chartHeight - chartPadding} r="2.5" className="curve-spot" />
            <circle cx={maxX} cy={chartHeight - chartPadding} r="2.5" className="curve-tick" />

            <text
              x={minX}
              y={chartHeight - chartPadding + 14}
              className="curve-label"
              textAnchor="middle"
            >
              ${minPriceCurve.toFixed(0)}
            </text>
            <text
              x={spotX}
              y={chartHeight - chartPadding + 14}
              className="curve-label"
              textAnchor="middle"
            >
              Spot ${spotPrice ? spotPrice.toFixed(0) : '--'}
            </text>
            <text
              x={maxX}
              y={chartHeight - chartPadding + 14}
              className="curve-label"
              textAnchor="middle"
            >
              ${maxPriceCurve.toFixed(0)}
            </text>
          </svg>
          <p className="curve-caption">
            X-axis: stock price at expiration. Y-axis: {includePremium ? 'net P/L after premium' : 'gross payoff before premium'} (USD).
          </p>
        </div>
      ) : null}

      {!heatmap || heatmap.rows.length === 0 ? (
        <p className="placeholder">Loading data to generate the heatmap.</p>
      ) : (
        <>
          <div className="heatmap-scroll" ref={scrollRef} onScroll={updateThumb}>
            <table className="heatmap-table">
              <tbody>
                {heatmap.rows.map((row) => (
                  <tr key={row.stockPrice}>
                    <th>${row.stockPrice.toFixed(0)}</th>
                    {row.cells.map((cell, index) => (
                      <td
                        key={`${row.stockPrice}-${index}`}
                        style={{ backgroundColor: cell.color }}
                        title={`Day ${cell.day} / Price $${cell.stockPrice.toFixed(2)} / Probability ${(cell.probability * 100).toFixed(2)}%`}
                      >
                        <span>{(cell.value + cellOffset).toFixed(0)}</span>
                        <span className="probability">
                          {(cell.probability * 100).toFixed(1)}%
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Day / Date</th>
                  {heatmap.dayLevels.map((day, index) => (
                    <th key={day}>
                      <span>{day}</span>
                      <span className="axis-date">{heatmap.dayLabels?.[index] ?? ''}</span>
                    </th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div
            className="heatmap-scrollbar"
            ref={trackRef}
            onPointerDown={onTrackPointerDown}
            role="scrollbar"
            aria-label="Scroll heatmap horizontally"
            aria-orientation="horizontal"
          >
            <div
              className="heatmap-scrollbar-thumb"
              ref={thumbRef}
              onPointerDown={onThumbPointerDown}
              onPointerMove={onThumbPointerMove}
              onPointerUp={onThumbPointerUp}
            />
          </div>
        </>
      )}
        </>
      )}
    </section>
  )
}

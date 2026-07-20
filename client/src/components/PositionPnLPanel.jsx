import { useCallback, useEffect, useRef, useState } from 'react'

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
}) {
  const scrollRef = useRef(null)
  const thumbRef = useRef(null)
  const trackRef = useRef(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartScrollLeft = useRef(0)
  const [open, setOpen] = useState(true)

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
  const curvePath = buildCurvePath(
    heatmap?.expiryCurve ?? [],
    chartWidth,
    chartHeight,
    chartPadding,
  )
  const curvePrices = (heatmap?.expiryCurve ?? []).map((p) => p.stockPrice)
  const curveValues = (heatmap?.expiryCurve ?? []).map((p) => p.value)
  const minPriceCurve = curvePrices.length ? Math.min(...curvePrices) : 0
  const maxPriceCurve = curvePrices.length ? Math.max(...curvePrices) : 1
  const minCurve = curveValues.length ? Math.min(...curveValues) : 0
  const maxCurve = curveValues.length ? Math.max(...curveValues) : 0
  const zeroY =
    maxCurve === minCurve
      ? chartHeight / 2
      : chartHeight -
        chartPadding -
        ((0 - minCurve) / (maxCurve - minCurve)) * (chartHeight - chartPadding * 2)
  const minX = chartPadding
  const maxX = chartWidth - chartPadding
  const spotX = mapRange(spotPrice || minPriceCurve, minPriceCurve, maxPriceCurve, minX, maxX)

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

      {heatmap?.expiryCurve?.length > 1 ? (
        <div className="curve-panel">
          <div className="curve-title">P/L at Expiration</div>
          <svg
            className="curve-chart"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`Profit and loss curve at expiration${ticker ? ` for ${ticker}` : ''}`}
          >
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
              y1={Math.max(chartPadding, Math.min(chartHeight - chartPadding, zeroY))}
              x2={chartWidth - chartPadding}
              y2={Math.max(chartPadding, Math.min(chartHeight - chartPadding, zeroY))}
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
              P/L (USD)
            </text>

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
            X-axis: stock price at expiration. Y-axis: projected profit/loss in USD.
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
                        <span>{cell.value.toFixed(0)}</span>
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

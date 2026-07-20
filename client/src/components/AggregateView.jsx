import { useCallback, useMemo, useRef, useState } from 'react'
import { buildAggregateHeatmap } from '../utils/optionsMath'

// ─────────────────────────── helpers ─────────────────────────────────────────

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// ─────────────────────────── 2-D Aggregate Heatmap ───────────────────────────

function AggregateHeatmap({ data, tickerA, tickerB }) {
  const [open, setOpen] = useState(true)
  if (!data || data.pricesA.length === 0) return null

  const { pricesA, pricesB, grid, spotIdxA, spotIdxB } = data

  return (
    <section className="heatmap-panel">
      <div className="heatmap-header">
        <div className="heatmap-header-text">
          <h2>
            <span className="ticker-chip ticker-chip--heading ticker-chip--sm">{tickerA}</span>
            {' × '}
            <span className="ticker-chip ticker-chip--heading ticker-chip--sm">{tickerB}</span>
            {' '}Aggregate P/L (USD)
          </h2>
          <p>Rows: {tickerA} price · Columns: {tickerB} price</p>
        </div>
        <button
          type="button"
          className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse heatmap' : 'Expand heatmap'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="agg-heatmap-outer">
          <div className="agg-y-label">{tickerA} ↕</div>
          <div className="agg-heatmap-scroll">
            <table className="heatmap-table agg-heatmap-table">
              <tbody>
                {grid.map((row, ri) => (
                  <tr key={ri} className={ri === spotIdxA ? 'agg-spot-row' : ''}>
                    <th className={`agg-row-price${ri === spotIdxA ? ' agg-spot-price' : ''}`}>
                      ${pricesA[ri].toFixed(0)}
                    </th>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={ci === spotIdxB ? 'agg-spot-col' : ''}
                        style={{ backgroundColor: cell.color }}
                        title={`${tickerA} $${pricesA[ri].toFixed(2)} · ${tickerB} $${pricesB[ci].toFixed(2)}\nP/L: ${cell.value >= 0 ? '+' : ''}${cell.value.toFixed(0)}`}
                      >
                        <span>{cell.value.toFixed(0)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th />
                  {pricesB.map((p, ci) => (
                    <th key={ci} className={ci === spotIdxB ? 'agg-spot-price' : ''}>
                      ${p.toFixed(0)}
                    </th>
                  ))}
                </tr>
              </tfoot>
            </table>
            <p className="agg-x-label">{tickerB} →</p>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────── 3-D Aggregate Surface ───────────────────────────

function AggregateSurface({ data, daysElapsed }) {
  const INITIAL_YAW   = -25 * (Math.PI / 180)
  const INITIAL_PITCH =  18 * (Math.PI / 180)

  const [yaw,   setYaw]   = useState(INITIAL_YAW)
  const [pitch, setPitch] = useState(INITIAL_PITCH)
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(true)
  const dragRef = useRef(null)

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
    setPitch(clamp(dragRef.current.pitch - dy * sens, -Math.PI / 2.4, Math.PI / 2.4))
  }, [])

  const onPointerUp = useCallback((e) => {
    e.currentTarget?.releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDragging(false)
  }, [])

  const resetView = useCallback(() => {
    setYaw(INITIAL_YAW)
    setPitch(INITIAL_PITCH)
  }, [])

  const geometry = useMemo(() => {
    if (!data || data.pricesA.length < 2 || data.pricesB.length < 2) return null

    const { pricesA, pricesB, grid, maxAbs, spotIdxA, spotIdxB, tickerA, tickerB } = data
    const nA = pricesA.length   // row axis (was "price" axis)
    const nB = pricesB.length   // col axis (was "day/depth" axis)

    const W = 1200, H = 460
    const cx = W / 2, cy = H / 2 + 20
    const priceWidth = 780, depthWidth = 340, valHalf = 150

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch)

    function project(ai, bi, val) {
      const x = (ai / (nA - 1) - 0.5) * priceWidth
      const y = (val / maxAbs) * valHalf
      const z = (bi / (nB - 1) - 0.5) * depthWidth
      const x1 = x * cosY - z * sinY
      const z1 = x * sinY + z * cosY
      const y2 = y * cosP + z1 * sinP
      const z2 = -y * sinP + z1 * cosP
      return { x: cx + x1, y: cy - y2, z: z2 }
    }

    function cellColor(v) {
      const intensity = clamp(Math.abs(v) / maxAbs, 0, 1)
      const a = (0.4 + intensity * 0.5).toFixed(3)
      return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`
    }

    const c00 = project(0, 0, 0)
    const c10 = project(nA - 1, 0, 0)
    const c01 = project(0, nB - 1, 0)
    const c11 = project(nA - 1, nB - 1, 0)
    const zTop = project(0, 0, maxAbs)
    const zBot = project(0, 0, -maxAbs)

    // Surface quads
    const quads = []
    for (let j = 0; j < nB - 1; j++) {
      for (let i = 0; i < nA - 1; i++) {
        const v00 = grid[i][j]?.value ?? 0
        const v10 = grid[i + 1][j]?.value ?? 0
        const v11 = grid[i + 1][j + 1]?.value ?? 0
        const v01 = grid[i][j + 1]?.value ?? 0
        const p00 = project(i,     j,     v00)
        const p10 = project(i + 1, j,     v10)
        const p11 = project(i + 1, j + 1, v11)
        const p01 = project(i,     j + 1, v01)
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

    // Wireframes: along priceB slices (columns = "depth" wires)
    const bWires = Array.from({ length: nB }, (_, j) => {
      const pts = Array.from({ length: nA }, (_, i) => {
        const p = project(i, j, grid[i][j]?.value ?? 0)
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
      })
      return { key: `bw-${j}`, points: pts.join(' ') }
    })

    // Wireframes: along priceA slices (row = "price" wires)
    const aWires = Array.from({ length: nA }, (_, i) => {
      const pts = Array.from({ length: nB }, (_, j) => {
        const p = project(i, j, grid[i][j]?.value ?? 0)
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
      })
      return { key: `aw-${i}`, points: pts.join(' ') }
    })

    // Spot-A curtain: follow priceA[spotIdxA] across all priceB values
    const curtainA = Array.from({ length: nB }, (_, j) => {
      const v = grid[spotIdxA][j]?.value ?? 0
      return { proj: project(spotIdxA, j, v), base: project(spotIdxA, j, 0) }
    })
    const curtainAPath =
      curtainA.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ') +
      ' ' +
      curtainA.slice().reverse().map((s) => `L ${s.base.x.toFixed(1)} ${s.base.y.toFixed(1)}`).join(' ') + ' Z'
    const curtainATop = curtainA.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ')

    // Spot-B curtain: follow priceB[spotIdxB] across all priceA values
    const curtainB = Array.from({ length: nA }, (_, i) => {
      const v = grid[i][spotIdxB]?.value ?? 0
      return { proj: project(i, spotIdxB, v), base: project(i, spotIdxB, 0) }
    })
    const curtainBPath =
      curtainB.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ') +
      ' ' +
      curtainB.slice().reverse().map((s) => `L ${s.base.x.toFixed(1)} ${s.base.y.toFixed(1)}`).join(' ') + ' Z'
    const curtainBTop = curtainB.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.proj.x.toFixed(1)} ${s.proj.y.toFixed(1)}`).join(' ')

    // Spot intersection dot
    const spotAB = project(spotIdxA, spotIdxB, grid[spotIdxA][spotIdxB]?.value ?? 0)
    const spotABValue = grid[spotIdxA][spotIdxB]?.value ?? 0

    // Axis tick labels for priceA (rows) at front edge (j=0)
    const tickIdxA = [0, Math.floor((nA - 1) / 2), nA - 1]
    const tickIdxB = [0, Math.floor((nB - 1) / 2), nB - 1]

    // Axis rail labels
    const railAStart = project(0,      0, 0)
    const railAEnd   = project(nA - 1, 0, 0)
    const railBStart = project(0,      0,      0)
    const railBEnd   = project(0, nB - 1, 0)

    return {
      W, H, c00, c10, c01, c11, zTop, zBot,
      quads, bWires, aWires,
      curtainAPath, curtainATop, curtainBPath, curtainBTop,
      spotAB, spotABValue,
      tickIdxA, tickIdxB,
      railAStart, railAEnd, railBStart, railBEnd,
      project, pricesA, pricesB, maxAbs,
      nA, nB, tickerA, tickerB,
    }
  }, [data, yaw, pitch])

  if (!geometry) return null

  const {
    W, H, c00, c10, c01, c11, zTop, zBot,
    quads, bWires, aWires,
    curtainAPath, curtainATop, curtainBPath, curtainBTop,
    spotAB, spotABValue,
    tickIdxA, tickIdxB,
    pricesA, pricesB, maxAbs,
    nA, nB, project, tickerA, tickerB,
  } = geometry

  const yawDeg   = ((yaw   * 180) / Math.PI).toFixed(0)
  const pitchDeg = ((pitch * 180) / Math.PI).toFixed(0)

  return (
    <section className="heatmap-panel">
      <div className="heatmap-header">
        <div className="heatmap-header-text">
          <h2>
            3D P/L Surface —{' '}
            <span className="ticker-chip ticker-chip--heading ticker-chip--sm">{tickerA}</span>
            {' × '}
            <span className="ticker-chip ticker-chip--heading ticker-chip--sm">{tickerB}</span>
          </h2>
          <p>X-axis: {tickerA} price · Z-axis: {tickerB} price · Y-axis: combined P/L · Day {daysElapsed}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span className="insight-badge pos">+${data.maxAbs.toFixed(0)}</span>
          <span className="insight-badge neg">−${data.maxAbs.toFixed(0)}</span>
          <span className="insight-badge accent">
            {spotABValue >= 0 ? '+' : '−'}${Math.abs(spotABValue).toFixed(0)} at both spots
          </span>
          <span className="insight-badge neutral">{yawDeg}° · {pitchDeg}°</span>
          <button type="button" className="insight-reset-btn" onClick={resetView}>Reset</button>
          <button
            type="button"
            className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
              <path d="M0 0L5 6L10 0z" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <>
          <svg
            className={`insight-chart insight-chart--tall surface-svg${dragging ? ' surface-svg--grabbing' : ''}`}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`3D aggregate P/L surface for ${tickerA} × ${tickerB} — drag to rotate`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={resetView}
          >
            <defs>
              <linearGradient id="agg-curtain-a-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="rgba(245,181,68,0.35)" />
                <stop offset="100%" stopColor="rgba(245,181,68,0.05)" />
              </linearGradient>
              <linearGradient id="agg-curtain-b-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="rgba(139,92,246,0.30)" />
                <stop offset="100%" stopColor="rgba(139,92,246,0.05)" />
              </linearGradient>
            </defs>

            <polygon
              points={`${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`}
              className="surface-baseplane"
            />
            <line x1={zTop.x} y1={zTop.y} x2={zBot.x} y2={zBot.y} className="surface-axis" />
            <line x1={c00.x} y1={c00.y} x2={c01.x} y2={c01.y} className="surface-axis" />
            <line x1={c00.x} y1={c00.y} x2={c10.x} y2={c10.y} className="surface-axis" />

            {quads.map((q) => (
              <polygon key={q.key} points={q.points} fill={q.fill} className="surface-cell" />
            ))}
            {bWires.map((w) => (
              <polyline key={w.key} points={w.points} className="surface-wire surface-wire-price" />
            ))}
            {aWires.map((w) => (
              <polyline key={w.key} points={w.points} className="surface-wire" />
            ))}

            <path d={curtainAPath} fill="url(#agg-curtain-a-grad)" className="surface-curtain" />
            <path d={curtainATop} className="surface-spot-ridge" />
            <path d={curtainBPath} fill="url(#agg-curtain-b-grad)" className="surface-curtain" />
            <path d={curtainBTop} fill="none" stroke="rgba(139,92,246,0.8)" strokeWidth="1.5" />

            <circle cx={spotAB.x} cy={spotAB.y} r={5} className="surface-spot-dot" />
            <text x={spotAB.x + 8} y={spotAB.y - 8} textAnchor="start" className="insight-marker-label insight-marker-accent">
              {spotABValue >= 0 ? '+' : '−'}${Math.abs(spotABValue).toFixed(0)}
            </text>

            {tickIdxA.map((i) => {
              const p = project(i, 0, 0)
              return (
                <g key={`ta-${i}`}>
                  <circle cx={p.x} cy={p.y} r={2} className="surface-tick-dot" />
                  <text x={p.x} y={p.y + 16} textAnchor="middle" className="insight-marker-label">${pricesA[i].toFixed(0)}</text>
                </g>
              )
            })}
            {tickIdxB.map((j) => {
              const p = project(nA - 1, j, 0)
              return (
                <g key={`tb-${j}`}>
                  <circle cx={p.x} cy={p.y} r={2} className="surface-tick-dot" />
                  <text x={p.x + 8} y={p.y + 4} textAnchor="start" className="insight-marker-label">${pricesB[j].toFixed(0)}</text>
                </g>
              )
            })}

            <text x={zTop.x - 8} y={zTop.y + 3} textAnchor="end" className="insight-y-label">+${maxAbs.toFixed(0)}</text>
            <text x={c00.x  - 8} y={c00.y  + 3} textAnchor="end" className="insight-y-label">$0</text>
            <text x={zBot.x - 8} y={zBot.y + 3} textAnchor="end" className="insight-y-label">−${maxAbs.toFixed(0)}</text>

            <text x={(c00.x + c10.x) / 2} y={Math.max(c00.y, c10.y) + 40} textAnchor="middle"
              className="insight-marker-label" style={{ fill: 'rgba(245,181,68,0.9)', fontWeight: 600 }}>
              {tickerA} →
            </text>
            <text x={(c00.x + c01.x) / 2 - 10} y={(c00.y + c01.y) / 2 + 4} textAnchor="middle"
              className="insight-marker-label" style={{ fill: 'rgba(139,92,246,0.9)', fontWeight: 600 }}>
              {tickerB} →
            </text>

            {!dragging && (
              <text x={W - 16} y={H - 12} textAnchor="end" className="surface-hint">
                drag to rotate · double-click to reset
              </text>
            )}
          </svg>
          <p className="insight-caption">
            Amber curtain = {tickerA} at its reference price across all {tickerB} values.
            Violet curtain = {tickerB} at its reference price across all {tickerA} values.
            Gold dot = both at their reference prices simultaneously.
          </p>
        </>
      )}
    </section>
  )
}

// ─────────────────────────── Main AggregateView ──────────────────────────────

export function AggregateView({ groups, moveRangePercent }) {
  const gA = groups[0]
  const gB = groups[1]

  // Flat, direct state — no intermediate memos so every change rerenders immediately
  const [refA,  setRefA]  = useState(gA.spot ?? 0)
  const [refB,  setRefB]  = useState(gB.spot ?? 0)
  const [rangeA, setRangeA] = useState(moveRangePercent)
  const [rangeB, setRangeB] = useState(moveRangePercent)
  const [daysElapsed, setDaysElapsed] = useState(0)

  const maxDTE = useMemo(() => {
    const allDays = groups.flatMap(g => g.heatmap?.dayLevels ?? [0])
    return Math.max(1, ...allDays)
  }, [groups])

  const dayLabel = gA.heatmap?.dayLabels?.[daysElapsed] ?? ''

  // Single memo with 6 flat deps — recomputes instantly on any slider move
  const aggData = useMemo(() => buildAggregateHeatmap({
    groups: [
      { ...gA, refSpot: refA },
      { ...gB, refSpot: refB },
    ],
    daysElapsed,
    moveRangePercentA: rangeA,
    moveRangePercentB: rangeB,
  }), [gA, gB, refA, refB, rangeA, rangeB, daysElapsed])

  const pctA = gA.spot ? ((refA - gA.spot) / gA.spot * 100) : 0
  const pctB = gB.spot ? ((refB - gB.spot) / gB.spot * 100) : 0

  return (
    <div className="agg-view">

      {/* ── Parameters ── */}
      <section className="heatmap-panel">
        <div className="heatmap-header">
          <div className="heatmap-header-text">
            <h2>Aggregate Parameters</h2>
            <p>Each underlying's reference price and range are independent</p>
          </div>
        </div>
        <div className="agg-params-grid">

          {/* Ticker A */}
          <div className="agg-param-block">
            <div className="agg-param-header">
              <span className="ticker-chip ticker-chip--heading">{gA.ticker}</span>
              <span className="agg-axis-pill">Y-axis · rows</span>
            </div>
            <label className="field">
              <span className="label-row">Reference price</span>
              <div className="agg-input-group">
                <input
                  type="number" step="0.01" min="0.01"
                  value={refA}
                  onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setRefA(v) }}
                  className="agg-number-input"
                />
                <span className={`agg-pct${pctA >= 0 ? ' pos' : ' neg'}`}>
                  {pctA >= 0 ? '+' : ''}{pctA.toFixed(1)}%
                </span>
              </div>
            </label>
            <label className="field">
              <span className="label-row">Range ±%</span>
              <input
                type="number" step="1" min="5" max="200"
                value={rangeA}
                onChange={e => { const v = parseFloat(e.target.value); if (v >= 5) setRangeA(v) }}
                className="agg-number-input agg-number-input--sm"
              />
            </label>
          </div>

          {/* Ticker B */}
          <div className="agg-param-block">
            <div className="agg-param-header">
              <span className="ticker-chip ticker-chip--heading">{gB.ticker}</span>
              <span className="agg-axis-pill agg-axis-pill--b">X-axis · cols</span>
            </div>
            <label className="field">
              <span className="label-row">Reference price</span>
              <div className="agg-input-group">
                <input
                  type="number" step="0.01" min="0.01"
                  value={refB}
                  onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setRefB(v) }}
                  className="agg-number-input"
                />
                <span className={`agg-pct${pctB >= 0 ? ' pos' : ' neg'}`}>
                  {pctB >= 0 ? '+' : ''}{pctB.toFixed(1)}%
                </span>
              </div>
            </label>
            <label className="field">
              <span className="label-row">Range ±%</span>
              <input
                type="number" step="1" min="5" max="200"
                value={rangeB}
                onChange={e => { const v = parseFloat(e.target.value); if (v >= 5) setRangeB(v) }}
                className="agg-number-input agg-number-input--sm"
              />
            </label>
          </div>

        </div>
      </section>

      {/* ── Sticky slider bar — always visible above charts ── */}
      <div className="agg-slider-bar">
        <span className="label-row" style={{ whiteSpace: 'nowrap' }}>Days elapsed</span>
        <input
          type="range"
          min={0}
          max={maxDTE}
          step={1}
          value={daysElapsed}
          onChange={e => setDaysElapsed(Number(e.target.value))}
          className="agg-slider"
          aria-label="Days elapsed"
        />
        <span className="insight-badge neutral" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          Day {daysElapsed}{dayLabel ? ` — ${dayLabel}` : ''}
        </span>
        <span className="agg-slider-endpoints">
          <span>Today</span>
          <span>+{maxDTE}d</span>
        </span>
      </div>

      {/* ── 2D Heatmap ── */}
      <AggregateHeatmap data={aggData} tickerA={gA.ticker} tickerB={gB.ticker} />

      {/* ── 3D Surface ── */}
      <AggregateSurface data={aggData} daysElapsed={daysElapsed} />

    </div>
  )
}

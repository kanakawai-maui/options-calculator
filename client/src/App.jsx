import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useOptionsStore } from './store/optionsStore'
import { useAuth } from './AuthContext'
import { buildHeatmap } from './utils/optionsMath'
import { TickerSearch, ExpirationPicker, StrikePicker } from './components/Pickers'
import { PositionBuilder } from './components/PositionBuilder'
import { ScenarioManager } from './components/ScenarioManager'
import { PositionPnLPanel } from './components/PositionPnLPanel'
import { Insights, ChainInsights } from './components/Insights'
import { AggregateView } from './components/AggregateView'
import { GreeksPanel } from './components/GreeksPanel'
import { TickerScreener } from './components/TickerScreener'
import { PanelEmptyState } from './components/EmptyState'
import './components/EmptyState.css'

function Tip({ text, placement = 'top' }) {
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const btnRef = useRef(null)

  const handleMouseEnter = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const bubbleWidth = 220
      const margin = 8
      const centerX = rect.left + rect.width / 2
      let off = 0
      const leftEdge = centerX - bubbleWidth / 2
      const rightEdge = centerX + bubbleWidth / 2
      if (leftEdge < margin) {
        off = margin - leftEdge
      } else if (rightEdge > window.innerWidth - margin) {
        off = window.innerWidth - margin - rightEdge
      }
      setOffset(off)
    }
    setOpen(true)
  }

  return (
    <span className="tip-wrap">
      <button
        ref={btnRef}
        type="button"
        className="tip"
        aria-label="Show help"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span
          className={`tip-bubble tip-bubble--${placement}`}
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

// Fallback: pure time-based check (no holiday awareness)
function checkMarketOpenByTime() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  const minutes = et.getHours() * 60 + et.getMinutes()
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

// Fetch SPY chart meta via the backend proxy — currentTradingPeriod.regular
// reflects the actual market calendar including holidays. Called through our
// own server because Yahoo doesn't send CORS headers to browsers.
const API_BASE = import.meta.env.VITE_API_BASE_URL ??
  (location.hostname === 'localhost' ? 'http://localhost:4000/api' : '/api')

async function fetchMarketOpen() {
  try {
    const res = await fetch(`${API_BASE}/market-status`)
    if (!res.ok) return checkMarketOpenByTime()
    const { start, end } = await res.json()
    if (!start || !end) return checkMarketOpenByTime()
    const nowSec = Math.floor(Date.now() / 1000)
    return nowSec >= start && nowSec < end
  } catch {
    return checkMarketOpenByTime()
  }
}

function useMarketOpen() {
  const [open, setOpen] = useState(null) // null = still loading
  useEffect(() => {
    let cancelled = false
    async function check() {
      const result = await fetchMarketOpen()
      if (!cancelled) setOpen(result)
    }
    check()
    const id = setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])
  return open
}

const DEFAULT_SECTION_ORDER = ['chain-insights', 'greeks', 'pnl', 'insights']
const LS_SECTION_ORDER_KEY = 'ops_section_order'

function useSectionOrder() {
  const [order, setOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_SECTION_ORDER_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (
          Array.isArray(parsed) &&
          parsed.length === DEFAULT_SECTION_ORDER.length &&
          DEFAULT_SECTION_ORDER.every((id) => parsed.includes(id))
        ) {
          return parsed
        }
      }
    } catch {}
    return DEFAULT_SECTION_ORDER
  })

  function updateOrder(newOrder) {
    setOrder(newOrder)
    try {
      localStorage.setItem(LS_SECTION_ORDER_KEY, JSON.stringify(newOrder))
    } catch {}
  }

  return [order, updateOrder]
}

function App() {
  const [
    localMoveRange,
    setLocalMoveRange,
  ] = useState(String(30))
  const { user, loading: authLoading, signIn, signOut } = useAuth()
  const [screenerOpen, setScreenerOpen] = useState(false)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(true)
  // Mobile-only tab. On desktop the sidebar + main-column layout is used and
  // this value is ignored. 'setup' = Contract Selector / Position / Scenarios,
  // 'analysis' = the output sections.
  const [mobileTab, setMobileTab] = useState('setup')
  const SIDEBAR_BREAKPOINT = 1200
  const SIDEBAR_MIN = 320
  const SIDEBAR_MAX = 900
  const SIDEBAR_DEFAULT = 420
  const LS_SIDEBAR_WIDTH_KEY = 'ops_sidebar_width'
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= SIDEBAR_BREAKPOINT)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= SIDEBAR_BREAKPOINT)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(LS_SIDEBAR_WIDTH_KEY))
      if (Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) return saved
    } catch {}
    return SIDEBAR_DEFAULT
  })

  // Keep isDesktop in sync with window width; auto open/close sidebar
  // unless the user has manually toggled it.
  const sidebarManualRef = useRef(false)
  useEffect(() => {
    function handleResize() {
      const large = window.innerWidth >= SIDEBAR_BREAKPOINT
      setIsDesktop(large)
      if (!sidebarManualRef.current) {
        setSidebarOpen(large)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Drag-to-resize the sidebar
  const resizeDragRef = useRef(null)
  const startResizeDrag = useCallback((e) => {
    e.preventDefault()
    resizeDragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    function onMove(ev) {
      if (!resizeDragRef.current) return
      const maxW = Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.5))
      const next = Math.min(maxW, Math.max(SIDEBAR_MIN, resizeDragRef.current.startWidth + ev.clientX - resizeDragRef.current.startX))
      setSidebarWidth(next)
    }
    function onUp() {
      resizeDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem(LS_SIDEBAR_WIDTH_KEY, String(sidebarWidth))
      } catch {}
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // Persist whenever sidebar width changes (covers state updates after drag ends)
  useEffect(() => {
    try {
      localStorage.setItem(LS_SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {}
  }, [sidebarWidth])

  const {
    ticker,
    positionSide,
    optionType,
    quantity,
    moveRangePercent,
    expirationDate,
    strike,
    loading,
    error,
    spotPrice,
    expirations,
    contracts,
    selectedContract,
    legs,
    chainData,
    setTicker,
    setPositionSide,
    setOptionType,
    setQuantity,
    setMoveRangePercent,
    setExpirationDate,
    setStrike,
    fetchChain,
    addCurrentLeg,
  } = useOptionsStore()

  // When legs are present use the full position; otherwise preview the single-leg selection
  const activelegs = useMemo(() => {
    if (legs.length > 0) return legs
    if (!selectedContract?.strike || !selectedContract?.markPrice) return []
    return [
      {
        id: 'preview',
        ticker: (ticker || '').trim().toUpperCase(),
        spotPriceAtAdd: spotPrice ?? null,
        optionType,
        positionSide,
        quantity,
        strike: selectedContract.strike,
        markPrice: selectedContract.markPrice,
        impliedVolatility: selectedContract.impliedVolatility || 0.25,
        expiration: selectedContract.expiration,
      },
    ]
  }, [legs, selectedContract, optionType, positionSide, quantity, ticker, spotPrice])

  // Unique tickers currently in the working position (order = first appearance)
  const positionTickers = useMemo(() => {
    const seen = []
    for (const leg of activelegs) {
      const t = (leg.ticker || '').toUpperCase()
      if (t && !seen.includes(t)) seen.push(t)
    }
    return seen
  }, [activelegs])
  const canAggregate = positionTickers.length === 2
  const [aggregateView, setAggregateView] = useState(false)

  // Preview mode: user has selected a contract but not yet added it as a leg.
  // The activelegs useMemo silently promotes the selection into a phantom leg;
  // this flag lets us surface the state so users know to click "+ Add to Position".
  const isPreviewMode = legs.length === 0 && activelegs.length > 0

  const [sectionOrder, updateSectionOrder] = useSectionOrder()
  const dragItemIdx = useRef(null)
  const dragOverItemIdx = useRef(null)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Auto-dismiss aggregate view if position no longer has exactly 2 underlyings
  useEffect(() => {
    if (!canAggregate) setAggregateView(false)
  }, [canAggregate])

  // Group legs by underlying so each ticker gets its own aggregate P/L chart.
  // Spot price: prefer the live quote for the currently-loaded ticker; for
  // other underlyings fall back to the leg's captured spot-at-add.
  const positionGroups = useMemo(() => {
    const upperCurrent = (ticker || '').trim().toUpperCase()
    const groups = new Map()
    for (const leg of activelegs) {
      const t = (leg.ticker || '').toUpperCase() || upperCurrent || '—'
      if (!groups.has(t)) {
        groups.set(t, { ticker: t, legs: [], spot: null })
      }
      const g = groups.get(t)
      g.legs.push(leg)
      if (!g.spot && leg.spotPriceAtAdd) g.spot = leg.spotPriceAtAdd
    }
    if (upperCurrent && groups.has(upperCurrent) && spotPrice) {
      groups.get(upperCurrent).spot = spotPrice
    }
    return Array.from(groups.values()).map((g) => ({
      ...g,
      heatmap: buildHeatmap({
        spotPrice: g.spot,
        legs: g.legs,
        moveRangePercent,
      }),
    }))
  }, [activelegs, ticker, spotPrice, moveRangePercent])

  useEffect(() => {
    setLocalMoveRange(String(moveRangePercent))
  }, [moveRangePercent])

  useEffect(() => {
    const symbol = ticker.trim()
    if (!symbol) return
    const timeoutId = setTimeout(() => fetchChain(), 350)
    return () => clearTimeout(timeoutId)
  }, [ticker, fetchChain])

  const marketOpen = useMarketOpen()

  const fmtUsd = (n) =>
    n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(2)}`
  const fmtPct = (n) =>
    n == null || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`

  function handleSectionDragStart(e, id, idx) {
    dragItemIdx.current = idx
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleSectionDragEnter(e, id, idx) {
    e.preventDefault()
    dragOverItemIdx.current = idx
    setDragOverId(id)
  }

  function handleSectionDragOver(e) {
    e.preventDefault()
  }

  function handleSectionDrop() {
    const from = dragItemIdx.current
    const to = dragOverItemIdx.current
    if (from != null && to != null && from !== to) {
      const newOrder = [...sectionOrder]
      const [moved] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, moved)
      updateSectionOrder(newOrder)
    }
    dragItemIdx.current = null
    dragOverItemIdx.current = null
    setDraggingId(null)
    setDragOverId(null)
  }

  function handleSectionDragEnd() {
    dragItemIdx.current = null
    dragOverItemIdx.current = null
    setDraggingId(null)
    setDragOverId(null)
  }

  const sections = {
    'chain-insights': (dragHandle) => (
      <ChainInsights
        chainData={chainData}
        spotPrice={spotPrice ?? null}
        activelegs={positionGroups.find((g) => g.ticker === (ticker || '').toUpperCase())?.legs ?? []}
        ticker={(ticker || '').toUpperCase()}
        dragHandle={dragHandle}
      />
    ),
    'greeks': (dragHandle) => positionGroups.map((group, i) =>
      group.spot && group.legs.length > 0 ? (
        <GreeksPanel
          key={group.ticker}
          ticker={group.ticker}
          spotPrice={group.spot}
          activelegs={group.legs}
          moveRangePercent={moveRangePercent}
          dragHandle={i === 0 ? dragHandle : null}
        />
      ) : null,
    ),
    'pnl': (dragHandle) => (
      <>
        {canAggregate && (
          <div className="view-toggle">
            <button
              type="button"
              className={`view-toggle-btn${!aggregateView ? ' view-toggle-btn--active' : ''}`}
              onClick={() => setAggregateView(false)}
            >
              Individual
            </button>
            <button
              type="button"
              className={`view-toggle-btn${aggregateView ? ' view-toggle-btn--active' : ''}`}
              onClick={() => { setAggregateView(true) }}
            >
              Aggregate
            </button>
          </div>
        )}
        {!aggregateView && positionGroups.map((group, i) => (
          <PositionPnLPanel
            key={group.ticker}
            ticker={group.ticker}
            spotPrice={group.spot}
            heatmap={group.heatmap}
            legs={group.legs}
            headingSuffix={legs.length > 0 ? ' Position P/L (USD)' : ' P/L Heatmap (USD)'}
            showTickerBadge={positionGroups.length > 1}
            dragHandle={i === 0 ? dragHandle : null}
          />
        ))}
        {aggregateView && canAggregate && (
          <AggregateView
            groups={positionGroups}
            moveRangePercent={moveRangePercent}
          />
        )}
      </>
    ),
    'insights': (dragHandle) => (
      <Insights
        groups={positionGroups}
        aggregateMode={aggregateView}
        dragHandle={dragHandle}
      />
    ),
  }

  const configPanels = (
    <>
      <section className="controls-panel">
        <div className="controls-panel-header">
          <span className="controls-panel-title">Contract Selector</span>
          <button
            type="button"
            className={`panel-collapse-btn${controlsOpen ? '' : ' collapsed'}`}
            onClick={() => setControlsOpen((o) => !o)}
            aria-expanded={controlsOpen}
            aria-label={controlsOpen ? 'Collapse contract selector' : 'Expand contract selector'}
          >
            <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
              <path d="M0 0L5 6L10 0z" />
            </svg>
          </button>
        </div>
        {controlsOpen && (
          <>
            <div className="controls-grid">
              <div className="field field--full">
                <span className="label-row">
                  Ticker
                  <Tip
                    placement="bottom"
                    text="Search by ticker symbol (AAPL) or company name. Select a result to load live chains automatically. Use the Screener to filter by IV, skew, liquidity, and positioning across a universe of tickers."
                  />
                </span>
                <div className="ticker-row">
                  <TickerSearch value={ticker} onSelect={setTicker} />
                  <button
                    type="button"
                    className="ts-open-btn"
                    onClick={() => setScreenerOpen(true)}
                    title="Screen tickers by IV, skew, liquidity, and more"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    Screener
                  </button>
                </div>
              </div>

              <label className="field">
                <span className="label-row">
                  Option Side
                  <Tip text="Call: profits when the stock price rises above the strike. Put: profits when the stock falls below the strike." />
                </span>
                <select value={optionType} onChange={(event) => setOptionType(event.target.value)}>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </label>

              <label className="field">
                <span className="label-row">
                  Trade Side
                  <Tip text="Buy (Long): pay a premium upfront; profit potential is large (calls have uncapped upside, puts are capped at the strike price). Sell (Short): collect premium upfront, but loss can be substantial if the trade moves against you." />
                </span>
                <select value={positionSide} onChange={(event) => setPositionSide(event.target.value)}>
                  <option value="buy">Buy (Long)</option>
                  <option value="sell">Sell (Short)</option>
                </select>
              </label>

              <div className="field">
                <span className="label-row">
                  Expiration
                  <Tip text="The date the option contract expires. Longer expirations carry more extrinsic (time) value. Weekly = ≤7d, 2-Week = 8–14d, Monthly = 15–45d, Quarterly = 46–100d, LEAPS = 100d+." />
                </span>
                <ExpirationPicker expirations={expirations} value={expirationDate ?? ''} onChange={setExpirationDate} />
              </div>

              <div className="field">
                <span className="label-row">
                  Strike
                  <Tip text="The per-share price at which the option can be exercised; each contract covers 100 shares. ITM (in-the-money) options have intrinsic value. OTM options need the underlying to move past the strike and recover the premium paid to profit." />
                </span>
                <StrikePicker contracts={contracts} optionType={optionType} spotPrice={spotPrice} value={strike} onChange={setStrike} />
              </div>

              <label className="field">
                <span className="label-row">
                  Contracts
                  <Tip text="Each standard equity option contract covers 100 shares. The P/L values in the heatmap scale linearly with contract count." />
                </span>
                <input type="number" min="1" max="50" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
              </label>

              <label className="field">
                <span className="label-row">
                  Chart Range ±%
                  <Tip text="Controls the visible price range on the P/L, Greeks, and heatmap charts. For example 30 means ±30% around the current spot price. This is a display setting only — it does not affect probability or P/L math." />
                </span>
                <input
                  type="number" min="5" max="200" step="1"
                  value={localMoveRange}
                  onChange={(event) => setLocalMoveRange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const parsed = Number(event.target.value)
                      if (Number.isFinite(parsed) && parsed >= 5) {
                        setMoveRangePercent(event.target.value)
                      } else {
                        setLocalMoveRange(String(moveRangePercent))
                      }
                      event.target.blur()
                    }
                  }}
                  onBlur={(event) => {
                    const parsed = Number(event.target.value)
                    if (Number.isFinite(parsed) && parsed >= 5) {
                      setMoveRangePercent(event.target.value)
                    } else {
                      setLocalMoveRange(String(moveRangePercent))
                    }
                  }}
                />
              </label>
            </div>

            <div className="meta">
              <div className="meta-item">
                <span className="meta-label">Spot</span>
                <span className="meta-value">{fmtUsd(spotPrice)}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Premium</span>
                <span className="meta-value">{fmtUsd(selectedContract?.markPrice)}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Implied Vol</span>
                <span className="meta-value">{fmtPct(selectedContract?.impliedVolatility)}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Contracts</span>
                <span className="meta-value">{quantity}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Rate</span>
                <span className="meta-value" title="Risk-free rate used in Black-Scholes pricing">5.00%</span>
              </div>
            </div>

            <div className="cs-add-row">
              <button
                type="button"
                className="cs-add-btn"
                disabled={!selectedContract?.markPrice}
                onClick={() => addCurrentLeg()}
                title={
                  selectedContract?.markPrice
                    ? 'Add this contract as a leg to your position'
                    : 'Select a contract first'
                }
              >
                + Add to Position
              </button>
              {selectedContract?.markPrice ? (
                <p className="cs-add-hint">
                  Will add{' '}
                  <strong>
                    {positionSide === 'buy' ? 'Long' : 'Short'}{' '}
                    {optionType === 'call' ? 'Call' : 'Put'} ${selectedContract.strike}
                  </strong>{' '}
                  @ ${selectedContract.markPrice?.toFixed(2)}
                </p>
              ) : (
                <p className="cs-add-hint cs-add-hint--muted">
                  Pick an expiration and strike, then click{' '}
                  <strong>Add to Position</strong>.
                </p>
              )}
            </div>

            {error ? <p className="error">{error}</p> : null}
          </>
        )}
      </section>

      <PositionBuilder />

      <ScenarioManager />
    </>
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          {isDesktop && (
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => { sidebarManualRef.current = true; setSidebarOpen((o) => !o) }}
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
              aria-expanded={sidebarOpen}
            >
              <svg viewBox="0 0 16 12" width="16" height="12" fill="currentColor" aria-hidden="true">
                <rect y="0" width="16" height="2" rx="1" />
                <rect y="5" width="16" height="2" rx="1" />
                <rect y="10" width="16" height="2" rx="1" />
              </svg>
            </button>
          )}
          <a href="/home" className="app-brand" title="Go to home page">
            <span className="hero-mark">OPS</span>
            <h1>Options Calculator</h1>
          </a>
        </div>
        <div className="hero-status">
          <span
            className={`status-dot ${
              marketOpen === null ? '' : marketOpen ? 'open' : 'closed'
            }`}
            aria-hidden="true"
          />
          <span>
            {marketOpen === null
              ? 'Connecting…'
              : marketOpen
              ? 'Market Open'
              : 'Market Closed'}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-dim)' }}>·</span>
          <span>{loading ? 'Updating…' : 'Live'}</span>
        </div>
        {/* Sign in with Google disabled */}
      </header>

      <div className="app-body">
        {isDesktop && (
          <>
            <div
              className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay--visible' : ''}`}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <aside
              className={`sidebar${sidebarOpen ? '' : ' sidebar--closed'}`}
              style={sidebarOpen ? { width: sidebarWidth } : undefined}
            >
              <div className="sidebar-inner" style={{ minWidth: sidebarWidth }}>
                <div
                  className="sidebar-resize-handle"
                  onMouseDown={startResizeDrag}
                  aria-hidden="true"
                />
                {configPanels}
              </div>
            </aside>
          </>
        )}

        <main className="main-content">
          <div className="layout">
            {!isDesktop && (
              <div className="mobile-tabs" role="tablist" aria-label="Main sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === 'setup'}
                  className={`mobile-tab${mobileTab === 'setup' ? ' mobile-tab--active' : ''}`}
                  onClick={() => setMobileTab('setup')}
                >
                  Setup
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === 'analysis'}
                  className={`mobile-tab${mobileTab === 'analysis' ? ' mobile-tab--active' : ''}`}
                  onClick={() => setMobileTab('analysis')}
                >
                  Analysis
                </button>
                <button
                  type="button"
                  className="mobile-tab mobile-tab--screener"
                  onClick={() => setScreenerOpen(true)}
                  title="Open ticker screener"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Screener
                </button>
              </div>
            )}
            {!isDesktop && mobileTab === 'setup' && configPanels}
            {(isDesktop || mobileTab === 'analysis') && (() => {
              // Output-area gate: show a friendly placeholder if we can't yet
              // render any of the analysis panels. Panels themselves also
              // guard, but a single top-level state prevents a blank column.
              const trimmedTicker = (ticker || '').trim()
              if (!trimmedTicker) {
                return (
                  <PanelEmptyState
                    title="Pick a ticker to get started"
                    hint="Search a symbol (like AAPL) or open the Screener to filter across a universe of tickers by IV, skew, and liquidity."
                    action={{
                      label: 'Open Screener',
                      onClick: () => setScreenerOpen(true),
                    }}
                  />
                )
              }
              if (error) {
                return (
                  <PanelEmptyState
                    variant="error"
                    title="Couldn't load option chain"
                    hint={error}
                    action={{ label: 'Retry', onClick: () => fetchChain() }}
                  />
                )
              }
              if (loading && (!chainData || !spotPrice)) {
                return <PanelEmptyState variant="loading" />
              }
              return null
            })()}
            {(isDesktop || mobileTab === 'analysis') && isPreviewMode && (
              <div className="preview-banner" role="status">
                <span className="preview-banner-badge">Preview</span>
                <span className="preview-banner-text">
                  Showing a single-contract preview. Click{' '}
                  <strong>+ Add to Position</strong> to lock it in and build a
                  multi-leg strategy.
                </span>
                <button
                  type="button"
                  className="preview-banner-cta"
                  onClick={() => addCurrentLeg()}
                >
                  Add to Position
                </button>
              </div>
            )}
            {(isDesktop || mobileTab === 'analysis') && ticker && !error && sectionOrder.map((id, idx) => {
              const dragHandle = (
                <div
                  className="drag-handle"
                  draggable
                  onDragStart={(e) => handleSectionDragStart(e, id, idx)}
                  onDragEnd={handleSectionDragEnd}
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  <svg viewBox="0 0 8 12" width="8" height="12" fill="currentColor" aria-hidden="true">
                    <circle cx="2" cy="2" r="1.5" />
                    <circle cx="6" cy="2" r="1.5" />
                    <circle cx="2" cy="6" r="1.5" />
                    <circle cx="6" cy="6" r="1.5" />
                    <circle cx="2" cy="10" r="1.5" />
                    <circle cx="6" cy="10" r="1.5" />
                  </svg>
                </div>
              )
              return (
                <div
                  key={id}
                  className={[
                    'draggable-section',
                    draggingId === id ? 'draggable-section--dragging' : '',
                    dragOverId === id && draggingId !== id ? 'draggable-section--over' : '',
                  ].filter(Boolean).join(' ')}
                  onDragEnter={(e) => handleSectionDragEnter(e, id, idx)}
                  onDragOver={handleSectionDragOver}
                  onDrop={handleSectionDrop}
                >
                  {sections[id](dragHandle)}
                </div>
              )
            })}

          <footer className="app-footer">
            <a href="/about">About</a>
            <span aria-hidden="true" style={{ color: 'var(--text-dim)' }}>·</span>
            <a href="/legal">Legal</a>
          </footer>
          </div>
        </main>
      </div>

      <TickerScreener
        open={screenerOpen}
        onClose={() => setScreenerOpen(false)}
        onSelect={setTicker}
        user={user}
        onSignIn={signIn}
      />

      {false && (
        <div className="auth-gate-overlay" role="dialog" aria-modal="true" aria-label="Premium feature">
          <div className="auth-gate-backdrop" onClick={() => setShowAuthPrompt(false)} />
          <div className="auth-gate-dialog">
            <button
              type="button"
              className="auth-gate-close"
              onClick={() => setShowAuthPrompt(false)}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="auth-gate-icon" aria-hidden="true">🔒</div>
            <h2 className="auth-gate-title">Premium Feature</h2>
            <p className="auth-gate-body">
              Aggregate View is available to signed-in users. Sign in with Google
              to unlock it — it's free.
            </p>
            <button
              type="button"
              className="auth-btn auth-btn--in auth-gate-cta"
              onClick={async () => { await signIn(); setShowAuthPrompt(false); setAggregateView(true) }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              Sign in with Google
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

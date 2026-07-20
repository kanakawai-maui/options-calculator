import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useOptionsStore } from './store/optionsStore'
import { buildHeatmap } from './utils/optionsMath'
import { TickerSearch, ExpirationPicker, StrikePicker } from './components/Pickers'
import { PositionBuilder } from './components/PositionBuilder'
import { PositionPnLPanel } from './components/PositionPnLPanel'
import { Insights, ChainInsights } from './components/Insights'
import { TickerScreener } from './components/TickerScreener'
import { Legal } from './components/Legal'
import './components/Legal.css'

function Tip({ text }) {
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
          className="tip-bubble"
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

function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash
}

function App() {
  const [
    localMoveRange,
    setLocalMoveRange,
  ] = useState(String(30))
  const [screenerOpen, setScreenerOpen] = useState(false)

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
  const hasMixedTickers = positionTickers.length > 1

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
  const hash = useHash()

  if (hash === '#/legal') return <Legal />

  const fmtUsd = (n) =>
    n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(2)}`
  const fmtPct = (n) =>
    n == null || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`

  return (
    <main className="layout">
      <header className="hero">
        <div className="hero-title">
          <span className="hero-mark">OPS</span>
          <h1>Options Calculator</h1>
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
      </header>

      <section className="controls-panel">
        <div className="controls-grid">
          <div className="field field--full">
            <span className="label-row">
              Ticker
              <Tip text="Search by ticker symbol (AAPL) or company name. Select a result to load live chains automatically. Use the Screener to filter by IV, skew, liquidity, and positioning across a universe of tickers." />
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
            <select
              value={optionType}
              onChange={(event) => setOptionType(event.target.value)}
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </label>

          <label className="field">
            <span className="label-row">
              Trade Side
              <Tip text="Buy (Long): pay a premium upfront, profit is theoretically unlimited. Sell (Short): collect premium upfront, loss can be large if the trade moves against you." />
            </span>
            <select
              value={positionSide}
              onChange={(event) => setPositionSide(event.target.value)}
            >
              <option value="buy">Buy (Long)</option>
              <option value="sell">Sell (Short)</option>
            </select>
          </label>

          <div className="field">
            <span className="label-row">
              Expiration
              <Tip text="The date the option contract expires. Longer expirations carry more time value (theta). Weekly = ≤7d, Monthly = 8-45d, LEAPS = 100d+." />
            </span>
            <ExpirationPicker
              expirations={expirations}
              value={expirationDate ?? ''}
              onChange={setExpirationDate}
            />
          </div>

          <div className="field">
            <span className="label-row">
              Strike
              <Tip text="Strike price for 100 shares. ITM (in-the-money) has intrinsic value. OTM needs to move past the strike before expiry to profit." />
            </span>
            <StrikePicker
              contracts={contracts}
              optionType={optionType}
              spotPrice={spotPrice}
              value={strike}
              onChange={setStrike}
            />
          </div>

          <label className="field">
            <span className="label-row">
              Contracts
              <Tip text="Each standard equity option contract covers 100 shares. The P/L values in the heatmap scale linearly with contract count." />
            </span>
            <input
              type="number"
              min="1"
              max="50"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span className="label-row">
              Expected Move ±%
              <Tip text="Sets the price range displayed in the P/L graph and heatmap. For example 30 means ±30% around the current spot price." />
            </span>
            <input
              type="number"
              min="5"
              max="200"
              step="1"
              value={localMoveRange}
              onChange={(event) => setLocalMoveRange(event.target.value)}
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
            <span className="meta-value">
              {fmtUsd(selectedContract?.markPrice)}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Implied Vol</span>
            <span className="meta-value">
              {fmtPct(selectedContract?.impliedVolatility)}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Contracts</span>
            <span className="meta-value">{quantity}</span>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <PositionBuilder />

      <ChainInsights
        chainData={chainData}
        spotPrice={spotPrice ?? null}
        activelegs={positionGroups.find((g) => g.ticker === (ticker || '').toUpperCase())?.legs ?? []}
        ticker={(ticker || '').toUpperCase()}
      />

      {positionGroups.map((group) => (
        <PositionPnLPanel
          key={group.ticker}
          ticker={group.ticker}
          spotPrice={group.spot}
          heatmap={group.heatmap}
          headingSuffix={legs.length > 0 ? ' Position P/L (USD)' : ' P/L Heatmap (USD)'}
          showTickerBadge={positionGroups.length > 1}
        />
      ))}

      <Insights
        groups={positionGroups}
      />

      <TickerScreener
        open={screenerOpen}
        onClose={() => setScreenerOpen(false)}
        onSelect={setTicker}
      />

      <footer className="app-footer">
        <a href="#/legal">Legal</a>
      </footer>
    </main>
  )
}

export default App

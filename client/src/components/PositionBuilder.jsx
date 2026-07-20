import { useState } from 'react'
import { useOptionsStore } from '../store/optionsStore'
import { blackScholes } from '../utils/optionsMath'
import './PositionBuilder.css'

const STRATEGIES = [
  {
    id: 'long-straddle',
    label: 'Long Straddle',
    desc: 'Buy ATM call + buy ATM put — profits from large moves either direction',
    group: 'Volatility',
  },
  {
    id: 'short-straddle',
    label: 'Short Straddle',
    desc: 'Sell ATM call + sell ATM put — collects premium when price stays flat',
    group: 'Volatility',
  },
  {
    id: 'long-strangle',
    label: 'Long Strangle',
    desc: 'Buy OTM call + buy OTM put — cheaper than straddle, needs bigger move',
    group: 'Volatility',
  },
  {
    id: 'short-strangle',
    label: 'Short Strangle',
    desc: 'Sell OTM call + sell OTM put — wider profit zone than short straddle',
    group: 'Volatility',
  },
  {
    id: 'iron-condor',
    label: 'Iron Condor',
    desc: 'Sell OTM call & put, buy further OTM wings — defined-risk range strategy',
    group: 'Condors',
  },
  {
    id: 'iron-butterfly',
    label: 'Iron Butterfly',
    desc: 'Sell ATM call & put, buy OTM wings — higher premium, narrower profit zone',
    group: 'Condors',
  },
  {
    id: 'bull-call-spread',
    label: 'Bull Call Spread',
    desc: 'Buy ATM call + sell OTM call — debit spread, profits when stock rises',
    group: 'Spreads',
  },
  {
    id: 'bear-put-spread',
    label: 'Bear Put Spread',
    desc: 'Buy ATM put + sell OTM put — debit spread, profits when stock falls',
    group: 'Spreads',
  },
  {
    id: 'bull-put-spread',
    label: 'Bull Put Spread',
    desc: 'Sell ATM put + buy OTM put — credit spread, profits when stock stays up',
    group: 'Spreads',
  },
  {
    id: 'bear-call-spread',
    label: 'Bear Call Spread',
    desc: 'Sell ATM call + buy OTM call — credit spread, profits when stock stays down',
    group: 'Spreads',
  },
  {
    id: 'call-calendar',
    label: 'Call Calendar',
    desc: 'Sell near-term ATM call + buy far-term ATM call — profits from time decay and low movement',
    group: 'Calendar',
  },
  {
    id: 'put-calendar',
    label: 'Put Calendar',
    desc: 'Sell near-term ATM put + buy far-term ATM put — profits from time decay and low movement',
    group: 'Calendar',
  },
]

const GROUPS = ['Volatility', 'Condors', 'Spreads', 'Calendar']

function formatExpDate(exp) {
  if (!exp) return '--'
  return new Date(Number(exp) * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })
}

function legLabel(leg) {
  const side = leg.positionSide === 'buy' ? 'Long' : 'Short'
  const type = leg.optionType === 'call' ? 'Call' : 'Put'
  return `${side} ${type}`
}

/**
 * Per-leg payoff-at-expiration mini chart.
 * Green fill = profit region, red fill = loss region.
 * Dotted vertical = strike; warm dot = current spot.
 */
function LegPayoffMini({ leg, spotPrice }) {
  const width = 96
  const height = 34
  const padX = 3
  const padY = 4

  const center = spotPrice || leg.strike
  const range = Math.max(center * 0.35, leg.strike * 0.35)
  const minPrice = Math.max(center - range, 0.01)
  const maxPrice = center + range

  const dir = leg.positionSide === 'sell' ? -1 : 1
  const N = 41
  const points = []
  let minPnl = Infinity
  let maxPnl = -Infinity
  for (let i = 0; i < N; i++) {
    const p = minPrice + ((maxPrice - minPrice) * i) / (N - 1)
    const intrinsic =
      leg.optionType === 'call'
        ? Math.max(p - leg.strike, 0)
        : Math.max(leg.strike - p, 0)
    const pnl = (intrinsic - leg.markPrice) * dir
    points.push({ p, pnl })
    if (pnl < minPnl) minPnl = pnl
    if (pnl > maxPnl) maxPnl = pnl
  }

  // Symmetric y-range so the zero line sits mid-chart when possible.
  const absMax = Math.max(Math.abs(minPnl), Math.abs(maxPnl), leg.markPrice, 0.01)
  const yMin = -absMax
  const yMax = absMax

  const innerW = width - 2 * padX
  const innerH = height - 2 * padY
  const xToPx = (p) => padX + ((p - minPrice) / (maxPrice - minPrice)) * innerW
  const yToPx = (v) => padY + (1 - (v - yMin) / (yMax - yMin)) * innerH

  const zeroY = yToPx(0)
  const strikeX = xToPx(leg.strike)
  const spotX = spotPrice ? xToPx(spotPrice) : null

  const linePts = points
    .map((pt) => `${xToPx(pt.p).toFixed(1)},${yToPx(pt.pnl).toFixed(1)}`)
    .join(' L ')
  const linePath = `M ${linePts}`
  const areaPath =
    `M ${xToPx(points[0].p).toFixed(1)},${zeroY.toFixed(1)} ` +
    `L ${linePts} ` +
    `L ${xToPx(points[points.length - 1].p).toFixed(1)},${zeroY.toFixed(1)} Z`

  const clipPosId = `pb-mini-pos-${leg.id}`
  const clipNegId = `pb-mini-neg-${leg.id}`

  return (
    <svg
      className="leg-mini-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${legLabel(leg)} $${leg.strike} payoff shape at expiration`}
    >
      <defs>
        <clipPath id={clipPosId}>
          <rect x="0" y="0" width={width} height={zeroY} />
        </clipPath>
        <clipPath id={clipNegId}>
          <rect x="0" y={zeroY} width={width} height={height - zeroY} />
        </clipPath>
      </defs>
      <line
        x1={padX}
        x2={width - padX}
        y1={zeroY}
        y2={zeroY}
        className="leg-mini-zero"
      />
      {strikeX >= padX && strikeX <= width - padX && (
        <line
          x1={strikeX}
          x2={strikeX}
          y1={padY}
          y2={height - padY}
          className="leg-mini-strike"
        />
      )}
      <path d={areaPath} className="leg-mini-area pos" clipPath={`url(#${clipPosId})`} />
      <path d={areaPath} className="leg-mini-area neg" clipPath={`url(#${clipNegId})`} />
      <path d={linePath} className="leg-mini-line" />
      {spotX !== null && spotX >= padX && spotX <= width - padX && (
        <circle cx={spotX} cy={zeroY} r={1.8} className="leg-mini-spot" />
      )}
    </svg>
  )
}

export function PositionBuilder() {
  const {
    legs,
    selectedContract,
    optionType,
    positionSide,
    ticker,
    addCurrentLeg,
    removeLeg,
    resetLegs,
    updateLeg,
    applyStrategy,
    chainData,
    spotPrice,
    expirations,
  } = useOptionsStore()

  // Re-price a leg when strike or expiry changes.
  // Uses live chain mark when the leg's (new) expiry matches the loaded chain;
  // falls back to Black-Scholes otherwise.
  function repriceForLeg(leg, newStrike, newExpiration) {
    const strike = newStrike ?? leg.strike
    const expiration = newExpiration ?? leg.expiration
    const contracts = leg.optionType === 'call' ? chainData?.calls ?? [] : chainData?.puts ?? []
    const loadedExp = contracts[0]?.expiration ?? null
    if (expiration === loadedExp) {
      const match = contracts.find((c) => c.strike === strike)
      if (match) {
        const m = match.mark > 0 ? match.mark
          : (match.bid > 0 && match.ask > 0) ? (match.bid + match.ask) / 2
          : match.lastPrice > 0 ? match.lastPrice : null
        if (m) return {
          markPrice: Math.max(0.01, Math.round(m * 100) / 100),
          impliedVolatility: match.impliedVolatility || leg.impliedVolatility,
        }
      }
    }
    const iv = Math.max(leg.impliedVolatility || 0.25, 0.05)
    const nowSec = Date.now() / 1000
    const timeYears = Math.max((expiration - nowSec) / (365 * 86400), 1 / 365)
    const mark = blackScholes({ stockPrice: spotPrice, strike, timeYears, volatility: iv, rate: 0.05, optionType: leg.optionType })
    return { markPrice: Math.max(0.01, Math.round(mark * 100) / 100) }
  }

  // Nearest available strike to a target price for a given option type.
  function atmStrike(optionType) {
    const contracts = optionType === 'call' ? chainData?.calls ?? [] : chainData?.puts ?? []
    if (!contracts.length || !spotPrice) return null
    return contracts.reduce((best, c) =>
      Math.abs(c.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? c : best
    ).strike
  }

  const hasChain = !!(chainData && spotPrice)
  const canAddLeg = !!(selectedContract?.markPrice)

  // Net premium: positive = credit received, negative = debit paid
  const netPremium = legs.reduce((sum, leg) => {
    const sign = leg.positionSide === 'sell' ? 1 : -1
    return sum + sign * leg.markPrice * 100 * leg.quantity
  }, 0)

  // Unique tickers across all legs (order = first appearance)
  const positionTickers = (() => {
    const seen = []
    for (const leg of legs) {
      const t = (leg.ticker || '').toUpperCase()
      if (t && !seen.includes(t)) seen.push(t)
    }
    return seen
  })()
  const hasMixedTickers = positionTickers.length > 1
  const [open, setOpen] = useState(true)

  return (
    <section className="position-builder">
      <div className="pb-header">
        <div className="pb-header-text">
          <div className="pb-title-row">
            <h2 className="pb-title">Position Builder</h2>
            {positionTickers.length > 0 && (
              <div className="pb-tickers" aria-label="Tickers in position">
                {positionTickers.map((t) => (
                  <span key={t} className="ticker-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {legs.length > 0 && (
              <span className={`pb-net-badge ${netPremium >= 0 ? 'credit' : 'debit'}`}>
                Net {netPremium >= 0 ? 'Credit' : 'Debit'}: ${Math.abs(netPremium).toFixed(2)}
              </span>
            )}
          </div>
          <p className="pb-subtitle">
            Apply a strategy template or manually add calls/puts to build a multi-leg position.
          </p>
        </div>
        <button
          type="button"
          className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse position builder' : 'Expand position builder'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>

      {open && (
      <>
      {/* Strategy templates */}
      <div className="pb-strategies">
        <div className="pb-section-label">Quick Strategies</div>
        {!hasChain && (
          <p className="pb-no-chain">Load a ticker and option chain first to enable strategies.</p>
        )}
        <div className="strategy-groups">
          {GROUPS.map((group) => (
            <div key={group} className="strategy-group">
              <span className="strategy-group-label">{group}</span>
              <div className="strategy-btn-row">
                {STRATEGIES.filter((s) => s.group === group).map((s) => (
                  <button
                    key={s.id}
                    className="strategy-btn"
                    title={s.desc}
                    disabled={!hasChain}
                    onClick={() => applyStrategy(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Manual leg controls */}
      <div className="pb-actions">
        <div className="pb-section-label">Build Manually</div>
        <div className="pb-action-row">
          <button
            className="pb-add-btn"
            disabled={!canAddLeg}
            onClick={addCurrentLeg}
            title={canAddLeg ? 'Add the currently selected contract as a leg' : 'Select a contract first'}
          >
            + Add Current Leg
          </button>
          <button
            className="pb-reset-btn"
            disabled={legs.length === 0}
            onClick={resetLegs}
          >
            ✕ Reset Position
          </button>
        </div>
        {canAddLeg && (
          <p className="pb-add-hint">
            Will add:{' '}
            {ticker && (
              <span className="ticker-chip ticker-chip--inline">
                {ticker.toUpperCase()}
              </span>
            )}{' '}
            <strong>
              {positionSide === 'buy' ? 'Long' : 'Short'}{' '}
              {optionType === 'call' ? 'Call' : 'Put'} ${selectedContract.strike}
            </strong>{' '}
            @ ${selectedContract.markPrice?.toFixed(2)}
          </p>
        )}
      </div>

      {/* Current legs table */}
      {legs.length > 0 && (
        <div className="pb-legs">
          <div className="pb-section-label pb-section-label--row">
            <span>
              Current Position ({legs.length} leg{legs.length !== 1 ? 's' : ''})
            </span>
            {positionTickers.length > 0 && (
              <span className="pb-legs-tickers">
                {hasMixedTickers ? ' across' : ' on'}{' '}
                {positionTickers.map((t, idx) => (
                  <span key={t}>
                    {idx > 0 && <span className="pb-legs-tickers-sep">·</span>}
                    <span className="ticker-chip ticker-chip--sm">{t}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="legs-scroll">
            <table className="legs-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Strike</th>
                  <th>Premium</th>
                  <th>Qty</th>
                  <th>Expiry</th>
                  <th>Payoff</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg, i) => (
                  <tr key={leg.id}>
                    <td>
                      <span className="ticker-chip ticker-chip--table">
                        {(leg.ticker || '—').toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`leg-badge side-${leg.positionSide}`}>
                        {leg.positionSide === 'buy' ? 'Long' : 'Short'}
                      </span>
                    </td>
                    <td>
                      <span className={`leg-badge type-${leg.optionType}`}>
                        {leg.optionType === 'call' ? 'Call' : 'Put'}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const contracts = leg.optionType === 'call' ? chainData?.calls ?? [] : chainData?.puts ?? []
                        const strikes = contracts.map((c) => c.strike)
                        const inList = strikes.includes(leg.strike)
                        return (
                          <select
                            className="leg-cell-select"
                            value={leg.strike}
                            onChange={(e) => {
                              const newStrike = Number(e.target.value)
                              updateLeg(leg.id, { strike: newStrike, ...repriceForLeg(leg, newStrike) })
                            }}
                            aria-label={`Strike for leg ${i + 1}`}
                          >
                            {!inList && <option value={leg.strike}>${leg.strike}</option>}
                            {strikes.map((s) => (
                              <option key={s} value={s}>${s % 1 === 0 ? s : s.toFixed(2)}</option>
                            ))}
                          </select>
                        )
                      })()}
                    </td>
                    <td>${leg.markPrice.toFixed(2)}</td>
                    <td>
                      <input
                        type="number"
                        className="leg-qty-input"
                        value={leg.quantity}
                        min={1}
                        step={1}
                        onChange={(e) => {
                          const q = Math.max(1, parseInt(e.target.value) || 1)
                          updateLeg(leg.id, { quantity: q })
                        }}
                        aria-label={`Quantity for leg ${i + 1}`}
                      />
                    </td>
                    <td>
                      <select
                        className="leg-cell-select"
                        value={leg.expiration}
                        onChange={(e) => {
                          const newExp = Number(e.target.value)
                          const newStrike = atmStrike(leg.optionType) ?? leg.strike
                          updateLeg(leg.id, { expiration: newExp, strike: newStrike, ...repriceForLeg(leg, newStrike, newExp) })
                        }}
                        aria-label={`Expiry for leg ${i + 1}`}
                      >
                        {expirations.map((exp) => (
                          <option key={exp} value={Number(exp)}>{formatExpDate(exp)}</option>
                        ))}
                        {!expirations.some((e) => Number(e) === leg.expiration) && (
                          <option value={leg.expiration}>{formatExpDate(leg.expiration)}</option>
                        )}
                      </select>
                    </td>
                    <td className="leg-payoff-cell">
                      <LegPayoffMini leg={leg} spotPrice={leg.spotPriceAtAdd ?? spotPrice} />
                    </td>
                    <td>
                      <button
                        className="leg-remove-btn"
                        onClick={() => removeLeg(leg.id)}
                        aria-label={`Remove leg ${i + 1}: ${legLabel(leg)} $${leg.strike}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="legs-total-label">
                    Net {netPremium >= 0 ? 'Credit Received' : 'Debit Paid'} (position cost × 100 shares/contract)
                  </td>
                  <td className={`legs-total-value ${netPremium >= 0 ? 'credit' : 'debit'}`}>
                    ${Math.abs(netPremium).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      </>
      )}
    </section>
  )
}

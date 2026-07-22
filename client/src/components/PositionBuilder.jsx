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
    traits: { direction: 'either', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Volatile', expect: 'Expects a sharp move in either direction before expiry. Time decay works against you if the stock stays flat.' },
  },
  {
    id: 'short-straddle',
    label: 'Short Straddle',
    desc: 'Sell ATM call + sell ATM put — collects premium when price stays flat',
    group: 'Volatility',
    traits: { direction: 'sideways', risk: 'undefined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay near the strike through expiry. Profits from time decay and falling implied volatility.' },
  },
  {
    id: 'long-strangle',
    label: 'Long Strangle',
    desc: 'Buy OTM call + buy OTM put — cheaper than straddle, needs bigger move',
    group: 'Volatility',
    traits: { direction: 'either', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Volatile', expect: 'Expects a large move in either direction. Cheaper than a straddle but needs a bigger move to break even.' },
  },
  {
    id: 'short-strangle',
    label: 'Short Strangle',
    desc: 'Sell OTM call + sell OTM put — wider profit zone than short straddle',
    group: 'Volatility',
    traits: { direction: 'sideways', risk: 'undefined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay within the range between the two strikes. Wider profit zone than a short straddle.' },
  },
  {
    id: 'iron-condor',
    label: 'Iron Condor',
    desc: 'Sell OTM call & put, buy further OTM wings — defined-risk range strategy',
    group: 'Condors',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay between the two short strikes at expiry. Profits from low volatility and time decay.' },
  },
  {
    id: 'iron-butterfly',
    label: 'Iron Butterfly',
    desc: 'Sell ATM call & put, buy OTM wings — higher premium, narrower profit zone',
    group: 'Condors',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to pin near the ATM strike at expiry. Higher max profit than iron condor but profit zone is narrower.' },
  },
  {
    id: 'bull-call-spread',
    label: 'Bull Call Spread',
    desc: 'Buy ATM call + sell OTM call — debit spread, profits when stock rises',
    group: 'Spreads',
    traits: { direction: 'up', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Bullish', expect: 'Expects a moderate rise in stock price. Profits between the two strikes; gain is capped at the short call.' },
  },
  {
    id: 'bear-put-spread',
    label: 'Bear Put Spread',
    desc: 'Buy ATM put + sell OTM put — debit spread, profits when stock falls',
    group: 'Spreads',
    traits: { direction: 'down', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Bearish', expect: 'Expects a moderate decline in stock price. Profits between the two strikes; gain is capped at the short put.' },
  },
  {
    id: 'bull-put-spread',
    label: 'Bull Put Spread',
    desc: 'Sell ATM put + buy OTM put — credit spread, profits when stock stays up',
    group: 'Spreads',
    traits: { direction: 'up', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Bullish', expect: 'Expects the stock to stay above the short put strike. Collects credit upfront; keeps full credit if stock closes above.' },
  },
  {
    id: 'bear-call-spread',
    label: 'Bear Call Spread',
    desc: 'Sell ATM call + buy OTM call — credit spread, profits when stock stays down',
    group: 'Spreads',
    traits: { direction: 'down', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Bearish', expect: 'Expects the stock to stay below the short call strike. Collects credit upfront; keeps full credit if stock closes below.' },
  },
  {
    id: 'call-calendar',
    label: 'Call Calendar',
    desc: 'Sell near-term ATM call + buy far-term ATM call — profits from time decay and low movement',
    group: 'Calendar',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'long' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay near the strike through the near-term expiry, then possibly trend slowly higher.' },
  },
  {
    id: 'put-calendar',
    label: 'Put Calendar',
    desc: 'Sell near-term ATM put + buy far-term ATM put — profits from time decay and low movement',
    group: 'Calendar',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'long' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay near the strike through the near-term expiry. Time decay differential between the two legs drives profit.' },
  },
  {
    id: 'covered-call',
    label: 'Covered Call',
    desc: 'Long 100 shares + short OTM call — collects income premium, caps upside',
    group: 'Stock',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay flat to slightly rise, staying below the short call strike. Generates income on a long stock position.' },
  },
  {
    id: 'protective-put',
    label: 'Protective Put',
    desc: 'Long 100 shares + long OTM put — insures against downside while keeping upside',
    group: 'Stock',
    traits: { direction: 'up', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Bullish', expect: 'Expects the stock to rise but hedges against a sharp drop. The put acts as portfolio insurance on the long stock position.' },
  },
  {
    id: 'collar',
    label: 'Collar',
    desc: 'Long 100 shares + short OTM call + long OTM put — bounded upside and downside',
    group: 'Stock',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Accepts capped upside in exchange for downside protection. Ideal when holding stock and wanting to reduce risk at minimal cost.' },
  },
  {
    id: 'cash-secured-put',
    label: 'Cash-Secured Put',
    desc: 'Short OTM put with cash collateral — collects premium, acquires stock if assigned',
    group: 'Stock',
    traits: { direction: 'sideways', risk: 'defined', timeframe: 'short' },
    tip: { sentiment: 'Neutral', expect: 'Expects the stock to stay flat or rise above the short put strike. Willing to buy stock at a lower effective cost if assigned.' },
  },
]

const GROUPS = ['Volatility', 'Condors', 'Spreads', 'Calendar', 'Stock']

const GROUP_INFO = {
  Volatility:
    'Expects a large price move in either direction (long straddle/strangle) or flat, range-bound price with low volatility (short straddle/strangle).',
  Condors:
    'Expects price to stay within a defined range and remain relatively flat. Profits from low volatility and time decay eroding both short strikes.',
  Spreads:
    'Expects a clear directional move — bull spreads profit when price rises, bear spreads profit when price falls. Defined risk on both sides.',
  Calendar:
    'Expects price to stay near current levels. Profits from near-term time decay (theta) while the longer-dated long leg retains value.',
  Stock:
    'Covered calls and cash-secured puts expect flat to slightly rising prices. Protective puts guard against declines while keeping upside. Collars bound both ends.',
}

const SENTIMENT_COLOR = {
  Bullish: 'var(--pos)',
  Bearish: 'var(--neg)',
  Neutral: 'var(--text-muted)',
  Volatile: 'var(--accent-warm)',
}

const FINDER_GROUPS = [
  {
    id: 'direction',
    label: 'Direction',
    options: [
      { id: 'up', label: 'Up' },
      { id: 'down', label: 'Down' },
      { id: 'sideways', label: 'Sideways' },
      { id: 'either', label: 'Big move (either)' },
    ],
  },
  {
    id: 'risk',
    label: 'Risk',
    options: [
      { id: 'defined', label: 'Defined' },
      { id: 'undefined', label: 'Not Defined' },
    ],
  },
  {
    id: 'timeframe',
    label: 'Timeframe',
    options: [
      { id: 'short', label: 'Short (<30d)' },
      { id: 'long', label: 'Long (30d+)' },
    ],
  },
]

function StrategyBtn({ s, dim, disabled, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <span
      className="strategy-btn-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`strategy-btn${dim ? ' strategy-btn--dim' : ''}`}
        disabled={disabled}
        onClick={onClick}
      >
        {s.label}
      </button>
      {hovered && s.tip && (
        <span className="strategy-tooltip" role="tooltip">
          <span
            className="strategy-tooltip-sentiment"
            style={{ color: SENTIMENT_COLOR[s.tip.sentiment] ?? 'var(--text-muted)' }}
          >
            {s.tip.sentiment}
          </span>
          <span className="strategy-tooltip-expect">{s.tip.expect}</span>
        </span>
      )}
    </span>
  )
}

function GroupInfoTip({ text }) {
  const [visible, setVisible] = useState(false)
  return (
    <span
      className="group-info-tip"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      tabIndex={0}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      role="button"
      aria-label="Strategy group info"
    >
      <span className="group-info-icon">?</span>
      {visible && (
        <span className="group-info-tooltip" role="tooltip">{text}</span>
      )}
    </span>
  )
}

function formatExpDate(exp) {
  if (!exp) return '--'
  return new Date(Number(exp) * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })
}

function legLabel(leg) {
  if (leg.optionType === 'stock') {
    return leg.positionSide === 'buy' ? 'Long Stock' : 'Short Stock'
  }
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

  const center = spotPrice || leg.strike || leg.markPrice
  const range = Math.max(center * 0.35, (leg.strike ?? leg.markPrice) * 0.35)
  const minPrice = Math.max(center - range, 0.01)
  const maxPrice = center + range

  const dir = leg.positionSide === 'sell' ? -1 : 1
  const N = 41
  const points = []
  let minPnl = Infinity
  let maxPnl = -Infinity
  for (let i = 0; i < N; i++) {
    const p = minPrice + ((maxPrice - minPrice) * i) / (N - 1)
    let pnl
    if (leg.optionType === 'stock') {
      pnl = (p - leg.markPrice) * dir
    } else {
      const intrinsic =
        leg.optionType === 'call'
          ? Math.max(p - leg.strike, 0)
          : Math.max(leg.strike - p, 0)
      pnl = (intrinsic - leg.markPrice) * dir
    }
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
      aria-label={leg.optionType === 'stock' ? `${legLabel(leg)} payoff shape` : `${legLabel(leg)} $${leg.strike} payoff shape at expiration`}
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
    addStockLeg,
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

  // Net premium: positive = credit received, negative = debit paid (options only; stock is separate)
  const netPremium = legs.reduce((sum, leg) => {
    if (leg.optionType === 'stock') return sum
    const sign = leg.positionSide === 'sell' ? 1 : -1
    return sum + sign * leg.markPrice * 100 * leg.quantity
  }, 0)
  const hasStockLegs = legs.some(leg => leg.optionType === 'stock')

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
  // Strategy Finder filter state — each key is a FINDER_GROUPS id.
  // A null value means "any" for that dimension.
  const [finder, setFinder] = useState({ direction: null, risk: null, timeframe: null })
  const finderActive = Object.values(finder).some((v) => v != null)
  const strategyMatches = (s) => {
    if (!finderActive) return true
    return Object.entries(finder).every(([k, v]) => v == null || s.traits?.[k] === v)
  }
  const clearFinder = () => setFinder({ direction: null, risk: null, timeframe: null })

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
              <span className={`pb-net-badge ${netPremium >= 0 ? 'credit' : 'debit'}`}
                title={hasStockLegs ? 'Options legs only — stock cost basis excluded' : undefined}
              >
                {hasStockLegs ? 'Options Net' : `Net ${netPremium >= 0 ? 'Credit' : 'Debit'}`}: ${Math.abs(netPremium).toFixed(2)}
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
        <div className="pb-section-label pb-section-label--row">
          <span>Quick Strategies</span>
          {finderActive && (
            <button
              type="button"
              className="pb-finder-clear"
              onClick={clearFinder}
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="pb-finder" role="group" aria-label="Strategy finder">
          <span className="pb-finder-lead">Find by:</span>
          {FINDER_GROUPS.map((g) => (
            <div key={g.id} className="pb-finder-group" aria-label={g.label}>
              <span className="pb-finder-group-label">{g.label}</span>
              <div className="pb-finder-chips">
                {g.options.map((opt) => {
                  const active = finder[g.id] === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pb-finder-chip${active ? ' pb-finder-chip--active' : ''}`}
                      onClick={() => setFinder((f) => ({ ...f, [g.id]: active ? null : opt.id }))}
                      aria-pressed={active}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {!hasChain && (
          <p className="pb-no-chain">Load a ticker and option chain first to enable strategies.</p>
        )}
        <div className="strategy-groups">
          {GROUPS.map((group) => (
            <div key={group} className="strategy-group">
              <span className="strategy-group-label">
                {group}
                {GROUP_INFO[group] && <GroupInfoTip text={GROUP_INFO[group]} />}
              </span>
              <div className="strategy-btn-row">
                {STRATEGIES.filter((s) => s.group === group).map((s) => {
                  const dim = finderActive && !strategyMatches(s)
                  return (
                    <StrategyBtn
                      key={s.id}
                      s={s}
                      dim={dim}
                      disabled={!hasChain}
                      onClick={() => applyStrategy(s.id)}
                    />
                  )
                })}
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
            className="pb-add-btn pb-add-stock-btn"
            disabled={!spotPrice}
            onClick={() => addStockLeg('buy')}
            title={spotPrice ? `Add long 100 shares of ${ticker || 'stock'} @ $${spotPrice?.toFixed(2)}` : 'Load a ticker first'}
          >
            + Long Stock
          </button>
          <button
            className="pb-add-btn pb-add-stock-btn pb-add-stock-short"
            disabled={!spotPrice}
            onClick={() => addStockLeg('sell')}
            title={spotPrice ? `Add short 100 shares of ${ticker || 'stock'} @ $${spotPrice?.toFixed(2)}` : 'Load a ticker first'}
          >
            + Short Stock
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
      {legs.length > 0 && (() => {
        const optionLegs = legs.filter((l) => l.optionType !== 'stock')
        const stockLegs  = legs.filter((l) => l.optionType === 'stock')
        return (
        <>
        {optionLegs.length > 0 && (
        <div className="pb-legs">
          <div className="pb-section-label pb-section-label--row">
            <span>
              Options Legs ({optionLegs.length} leg{optionLegs.length !== 1 ? 's' : ''})
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
                  <th>IV</th>
                  <th>Qty</th>
                  <th>Expiry</th>
                  <th>Payoff</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {optionLegs.map((leg, i) => (
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
                      <span className="leg-iv-cell">
                        <input
                          type="number"
                          className="leg-iv-input"
                          value={((leg.impliedVolatility || 0.25) * 100).toFixed(1)}
                          min={0.1}
                          max={999}
                          step={0.1}
                          onChange={(e) => {
                            const iv = Math.max(0.001, parseFloat(e.target.value) || 0.25) / 100
                            updateLeg(leg.id, { impliedVolatility: iv })
                          }}
                          aria-label={`IV for leg ${i + 1}`}
                        />
                        <span className="leg-iv-suffix">%</span>
                      </span>
                    </td>
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
                  <td colSpan={5} className="legs-total-label">
                    Net {netPremium >= 0 ? 'Credit' : 'Debit'} (x 100 shares/contract)
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

        {/* Stock positions grid */}
        {stockLegs.length > 0 && (
        <div className="pb-stock-grid">
          <div className="pb-section-label">
            Stock Positions ({stockLegs.length})
          </div>
          <div className="legs-scroll">
            <table className="legs-table stock-legs-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Side</th>
                  <th>Shares</th>
                  <th>Entry</th>
                  <th>Current</th>
                  <th>Unrealised P/L</th>
                  <th>Payoff</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stockLegs.map((leg) => {
                  const dir = leg.positionSide === 'buy' ? 1 : -1
                  const shares = leg.quantity * 100
                  const current = spotPrice ?? leg.markPrice
                  const pnl = (current - leg.markPrice) * shares * dir
                  const pnlPct = leg.markPrice > 0
                    ? ((current - leg.markPrice) / leg.markPrice) * 100 * dir
                    : 0
                  const pnlSign = pnl >= 0 ? 'pos' : 'neg'
                  return (
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
                      <td className="stock-shares-cell">{shares.toLocaleString()}</td>
                      <td className="stock-price-cell">${leg.markPrice.toFixed(2)}</td>
                      <td className="stock-price-cell">
                        {spotPrice ? `$${spotPrice.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <span className={`stock-pnl-cell stock-pnl-${pnlSign}`}>
                          {spotPrice ? (
                            <>
                              {pnl >= 0 ? '+' : ''}${pnl.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              <span className="stock-pnl-pct">
                                {' '}({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                              </span>
                            </>
                          ) : '—'}
                        </span>
                      </td>
                      <td className="leg-payoff-cell">
                        <LegPayoffMini leg={leg} spotPrice={leg.spotPriceAtAdd ?? spotPrice} />
                      </td>
                      <td>
                        <button
                          className="leg-remove-btn"
                          onClick={() => removeLeg(leg.id)}
                          aria-label={`Remove ${legLabel(leg)} position`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="legs-total-label">
                    Total stock position cost (entry × shares)
                  </td>
                  <td className="legs-total-value">
                    ${stockLegs.reduce((s, l) => s + l.markPrice * l.quantity * 100, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        )}
        </>
        )
      })()}
      </>
      )}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './TickerScreener.css'
import { DataAgeBadge } from './Pickers'

const API_BASE = import.meta.env.VITE_API_BASE_URL ??
  (location.hostname === 'localhost' ? 'http://localhost:4000/api' : '/api')

// A curated set of option-liquid tickers to screen by default. Server has
// its own default, but we mirror it here so users see what will run.
const DEFAULT_UNIVERSE = [
  'AAPL','MSFT','NVDA','GOOG','AMZN','META','TSLA','AVGO','NFLX','AMD',
  'PLTR','SOFI','COIN','MARA','RIOT','GME','SMCI','ARM','MU','INTC',
  'CRWD','SHOP','UBER','BABA',
  'SPY','QQQ','IWM','DIA',
  'JPM','BAC','F',
  'XOM','CVX','GLD','SLV','TLT','HYG',
]

const UNIVERSE_PRESETS = {
  popular: {
    label: 'Popular (default)',
    tickers: DEFAULT_UNIVERSE,
  },
  megacap: {
    label: 'Mega-cap tech',
    tickers: ['AAPL','MSFT','NVDA','GOOG','AMZN','META','TSLA','AVGO','NFLX','AMD','TSM','ORCL','CRM'],
  },
  highIV: {
    label: 'High-IV retail favorites',
    tickers: ['PLTR','SOFI','COIN','MARA','RIOT','GME','SMCI','ARM','MU','INTC','CRWD','SHOP','BABA','TSLA','NVDA'],
  },
  etfs: {
    label: 'Index / sector ETFs',
    tickers: ['SPY','QQQ','IWM','DIA','XLE','XLF','XLK','XLV','XLU','GLD','SLV','TLT','HYG','USO'],
  },
  custom: {
    label: 'Custom list',
    tickers: [],
  },
}

// ─── Filter definitions ─────────────────────────────────────────────────────

const FILTER_DEFAULTS = {
  atmIVMin: '',
  atmIVMax: '',
  skewMin: '',
  skewMax: '',
  minVolume: '',
  minOI: '',
  maxSpreadPct: '',
  pcRatioMin: '',
  pcRatioMax: '',
}

function passesFilters(row, f) {
  const iv = (row.atmIV ?? 0) * 100
  const skew = (row.ivSkew ?? 0) * 100
  const spread = (row.avgSpreadPct ?? 0) * 100
  const pc = row.putCallOI ?? 0

  if (f.atmIVMin !== '' && iv < Number(f.atmIVMin)) return false
  if (f.atmIVMax !== '' && iv > Number(f.atmIVMax)) return false
  if (f.skewMin !== '' && skew < Number(f.skewMin)) return false
  if (f.skewMax !== '' && skew > Number(f.skewMax)) return false
  if (f.minVolume !== '' && (row.totalVolume ?? 0) < Number(f.minVolume)) return false
  if (f.minOI !== '' && (row.totalOI ?? 0) < Number(f.minOI)) return false
  if (f.maxSpreadPct !== '' && row.avgSpreadPct != null && spread > Number(f.maxSpreadPct))
    return false
  if (f.pcRatioMin !== '' && pc < Number(f.pcRatioMin)) return false
  if (f.pcRatioMax !== '' && pc > Number(f.pcRatioMax)) return false
  return true
}

// ─── Sortable columns ──────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'price', label: 'Price', align: 'right', fmt: (v) => (v != null ? `$${v.toFixed(2)}` : '—') },
  { key: 'changePct', label: '%Chg', align: 'right', fmt: (v) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'), colorSign: true },
  { key: 'dte', label: 'DTE', align: 'right', fmt: (v) => (v != null ? `${v}d` : '—') },
  { key: 'atmIV', label: 'ATM IV', align: 'right', fmt: (v) => (v != null ? `${(v * 100).toFixed(1)}%` : '—') },
  { key: 'ivSkew', label: 'Skew', align: 'right', fmt: (v) => (v != null ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—'), colorSignInverse: true },
  { key: 'totalVolume', label: 'Volume', align: 'right', fmt: (v) => (v != null ? v.toLocaleString() : '—') },
  { key: 'totalOI', label: 'OI', align: 'right', fmt: (v) => (v != null ? v.toLocaleString() : '—') },
  { key: 'putCallOI', label: 'P/C', align: 'right', fmt: (v) => (v != null ? v.toFixed(2) : '—') },
  { key: 'avgSpreadPct', label: 'Spread', align: 'right', fmt: (v) => (v != null ? `${(v * 100).toFixed(1)}%` : '—') },
  { key: 'maxPainPct', label: 'Max Pain', align: 'right', fmt: (v, row) => (v != null ? `$${row.maxPain?.toFixed(0)} · ${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—') },
]

// ─── Component ──────────────────────────────────────────────────────────────

export function TickerScreener({ open, onClose, onSelect }) {
  const [presetKey, setPresetKey] = useState('popular')
  const [customText, setCustomText] = useState('')
  const [targetDTE, setTargetDTE] = useState(30)
  const [filters, setFilters] = useState(FILTER_DEFAULTS)
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(false)
  const [runInfo, setRunInfo] = useState(null)
  const [sortKey, setSortKey] = useState('totalVolume')
  const [sortDir, setSortDir] = useState('desc')

  const dialogRef = useRef(null)

  // Reset when opening for the first time
  useEffect(() => {
    if (!open) return
    if (rows.length === 0 && !loading) {
      // Auto-run the default screen when opened
      runScreen()
    }
    // Trap focus into modal
    setTimeout(() => dialogRef.current?.focus(), 0)
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const activeTickers = useMemo(() => {
    if (presetKey === 'custom') {
      return customText
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    }
    return UNIVERSE_PRESETS[presetKey].tickers
  }, [presetKey, customText])

  const runScreen = useCallback(async () => {
    if (activeTickers.length === 0) {
      setErrors([{ symbol: '—', message: 'Enter at least one ticker.' }])
      return
    }
    setLoading(true)
    setErrors([])
    try {
      const res = await fetch(`${API_BASE}/screener`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: activeTickers, targetDTE: Number(targetDTE) || 30 }),
      })
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()
      setRows(data.rows || [])
      setErrors(data.errors || [])
      setRunInfo({
        at: new Date(),
        count: (data.rows || []).length,
        errorCount: (data.errors || []).length,
      })
    } catch (err) {
      setErrors([{ symbol: '—', message: err.message || 'Screener failed' }])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeTickers, targetDTE])

  const filtered = useMemo(() => rows.filter((r) => passesFilters(r, filters)), [rows, filters])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  const resetFilters = () => setFilters(FILTER_DEFAULTS)

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }))

  if (!open) return null

  return (
    <div className="ts-overlay" role="dialog" aria-modal="true" aria-label="Ticker screener">
      <div className="ts-backdrop" onClick={onClose} />
      <div className="ts-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="ts-coming-soon-overlay" aria-hidden="true">
          <div className="ts-coming-soon-badge">
            <span className="ts-coming-soon-icon">🚧</span>
            <span className="ts-coming-soon-title">Coming Soon</span>
            <span className="ts-coming-soon-sub">The screener is under active development.</span>
          </div>
        </div>
        <header className="ts-header">
          <div className="ts-title-block">
            <h2>Advanced Ticker Screener</h2>
            <p className="ts-subtitle">
              Scan option chains for liquidity, IV, skew, and positioning — click any row to load it.
            </p>
          </div>
          <button type="button" className="ts-close" onClick={onClose} aria-label="Close screener">
            ✕
          </button>
        </header>

        <div className="ts-body">
          {/* ── Universe & run controls ───────────────────────────────── */}
          <section className="ts-section">
            <div className="ts-section-title">Universe</div>
            <div className="ts-universe-row">
              <label className="ts-field">
                <span>Preset</span>
                <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                  {Object.entries(UNIVERSE_PRESETS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ts-field ts-field--dte">
                <span>Target DTE</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={targetDTE}
                  onChange={(e) => setTargetDTE(e.target.value)}
                />
              </label>

              <div className="ts-field ts-field--grow">
                <span>
                  {presetKey === 'custom'
                    ? 'Tickers (comma or space separated)'
                    : `Tickers in universe (${activeTickers.length})`}
                </span>
                {presetKey === 'custom' ? (
                  <textarea
                    className="ts-custom-input"
                    placeholder="AAPL, NVDA, SPY, TSLA…"
                    rows={2}
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value.toUpperCase())}
                  />
                ) : (
                  <div className="ts-ticker-chips">
                    {activeTickers.map((t) => (
                      <span key={t} className="ts-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="ts-run-btn"
                onClick={runScreen}
                disabled={loading || activeTickers.length === 0}
              >
                {loading ? 'Scanning…' : 'Run Screen'}
              </button>
            </div>
          </section>

          {/* ── Filters ────────────────────────────────────────────────── */}
          <section className="ts-section">
            <div className="ts-section-title-row">
              <div className="ts-section-title">Filters</div>
              <button type="button" className="ts-link" onClick={resetFilters}>
                Reset
              </button>
            </div>
            <div className="ts-filters-grid">
              <RangeFilter
                label="ATM IV %"
                min={filters.atmIVMin}
                max={filters.atmIVMax}
                onMin={(v) => setFilter('atmIVMin', v)}
                onMax={(v) => setFilter('atmIVMax', v)}
                hint="Implied volatility of the nearest-to-spot options"
              />
              <RangeFilter
                label="IV Skew %"
                min={filters.skewMin}
                max={filters.skewMax}
                onMin={(v) => setFilter('skewMin', v)}
                onMax={(v) => setFilter('skewMax', v)}
                hint="OTM put IV minus OTM call IV; positive = fear priced in"
              />
              <RangeFilter
                label="P/C Ratio"
                min={filters.pcRatioMin}
                max={filters.pcRatioMax}
                onMin={(v) => setFilter('pcRatioMin', v)}
                onMax={(v) => setFilter('pcRatioMax', v)}
                hint="Put OI / Call OI. >1 = bearish positioning"
              />
              <SingleFilter
                label="Min Volume"
                value={filters.minVolume}
                onChange={(v) => setFilter('minVolume', v)}
                placeholder="e.g. 1000"
                hint="Total call+put volume on the chosen expiration"
              />
              <SingleFilter
                label="Min Open Interest"
                value={filters.minOI}
                onChange={(v) => setFilter('minOI', v)}
                placeholder="e.g. 5000"
                hint="Total call+put OI on the chosen expiration"
              />
              <SingleFilter
                label="Max Spread %"
                value={filters.maxSpreadPct}
                onChange={(v) => setFilter('maxSpreadPct', v)}
                placeholder="e.g. 5"
                hint="Average bid-ask spread on the 10 strikes near spot"
              />
            </div>
          </section>

          {/* ── Results ─────────────────────────────────────────────────── */}
          <section className="ts-section ts-results-section">
            <div className="ts-section-title-row">
              <div className="ts-section-title">
                Results{' '}
                {runInfo ? (
                  <span className="ts-run-meta">
                    · {sorted.length} of {rows.length} match
                    {runInfo.errorCount > 0 ? ` · ${runInfo.errorCount} failed` : ''}
                  </span>
                ) : null}
              </div>
              {loading && <span className="ts-loading">Fetching chains…</span>}
            </div>

            <div className="ts-table-wrap">
              <table className="ts-table">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`ts-th ts-th--${col.align}${sortKey === col.key ? ' active' : ''}`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {sortKey === col.key ? (
                          <span className="ts-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className="ts-empty">
                        {rows.length === 0
                          ? 'Run a screen to see candidates.'
                          : 'No tickers match the current filters.'}
                      </td>
                    </tr>
                  ) : null}
                  {sorted.map((row) => (
                    <tr
                      key={row.symbol}
                      className="ts-row"
                      onClick={() => {
                        onSelect(row.symbol)
                        onClose()
                      }}
                      title={`Load ${row.symbol} into main picker`}
                    >
                      {COLUMNS.map((col) => {
                        const raw = row[col.key]
                        const text = col.fmt ? col.fmt(raw, row) : raw ?? '—'
                        let cls = `ts-td ts-td--${col.align}`
                        if (col.colorSign && typeof raw === 'number') {
                          cls += raw >= 0 ? ' ts-pos' : ' ts-neg'
                        }
                        if (col.colorSignInverse && typeof raw === 'number') {
                          cls += raw >= 0 ? ' ts-neg' : ' ts-pos'
                        }
                        return (
                          <td key={col.key} className={cls}>
                            {col.key === 'symbol' ? (
                              <div className="ts-symbol-cell">
                                <span className="ts-symbol">{row.symbol}</span>
                                {row.name && row.name !== row.symbol ? (
                                  <span className="ts-symbol-name">{row.name}</span>
                                ) : null}
                                {row.cachedAt ? (
                                  <DataAgeBadge cachedAt={row.cachedAt} source={row.source} />
                                ) : null}
                              </div>
                            ) : (
                              text
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errors.length > 0 ? (
              <details className="ts-errors">
                <summary>{errors.length} ticker(s) failed to load</summary>
                <ul>
                  {errors.map((e) => (
                    <li key={`${e.symbol}-${e.message}`}>
                      <strong>{e.symbol}</strong>: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}

function RangeFilter({ label, min, max, onMin, onMax, hint }) {
  return (
    <div className="ts-filter">
      <div className="ts-filter-label">
        {label}
        {hint ? <span className="ts-filter-hint" title={hint}>?</span> : null}
      </div>
      <div className="ts-filter-inputs">
        <input
          type="number"
          value={min}
          onChange={(e) => onMin(e.target.value)}
          placeholder="min"
          step="any"
        />
        <span className="ts-filter-sep">–</span>
        <input
          type="number"
          value={max}
          onChange={(e) => onMax(e.target.value)}
          placeholder="max"
          step="any"
        />
      </div>
    </div>
  )
}

function SingleFilter({ label, value, onChange, placeholder, hint }) {
  return (
    <div className="ts-filter">
      <div className="ts-filter-label">
        {label}
        {hint ? <span className="ts-filter-hint" title={hint}>?</span> : null}
      </div>
      <div className="ts-filter-inputs">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          step="any"
        />
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import './Pickers.css'
import { useOptionsStore } from '../store/optionsStore'

const API_BASE = import.meta.env.VITE_API_BASE_URL ??
  (location.hostname === 'localhost' ? 'http://localhost:4000/api' : '/api')

const POPULAR_TICKERS = [
  { symbol: 'AAPL',  name: 'Apple Inc.',               exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',           exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.',              exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'TSLA',  name: 'Tesla Inc.',                exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'META',  name: 'Meta Platforms Inc.',       exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'GOOG',  name: 'Alphabet Inc.',             exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',           exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'AMD',   name: 'Advanced Micro Devices',    exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'PLTR',  name: 'Palantir Technologies',     exchange: 'NYSE',   quoteType: 'EQUITY' },
  { symbol: 'SOFI',  name: 'SoFi Technologies',         exchange: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'SPY',   name: 'SPDR S&P 500 ETF',          exchange: 'NYSE',   quoteType: 'ETF'    },
  { symbol: 'QQQ',   name: 'Invesco QQQ ETF',           exchange: 'NASDAQ', quoteType: 'ETF'    },
]

function badgeClass(quoteType) {
  const map = { EQUITY: 'equity', ETF: 'etf', INDEX: 'index', MUTUALFUND: 'mutualfund' }
  return map[(quoteType ?? '').toUpperCase()] ?? 'equity'
}

// ─── DataAgeBadge ─────────────────────────────────────────────────────────────

function formatAge(cachedAt) {
  if (!cachedAt) return null
  const ageSec = Math.floor(Date.now() / 1000) - cachedAt
  if (ageSec < 60) return { label: `${ageSec}s ago`, cls: 'fresh' }
  if (ageSec < 3600) return { label: `${Math.floor(ageSec / 60)}m ago`, cls: ageSec < 900 ? 'fresh' : 'stale' }
  if (ageSec < 86400) return { label: `${Math.floor(ageSec / 3600)}h ago`, cls: 'old' }
  return { label: `${Math.floor(ageSec / 86400)}d ago`, cls: 'old' }
}

export function DataAgeBadge({ cachedAt, source }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])
  if (!cachedAt) return null
  const age = formatAge(cachedAt)
  if (!age) return null
  const isDemo = source === 'demo'
  return (
    <span className={`data-age-badge ${isDemo ? 'demo' : age.cls}`} title={isDemo ? 'Synthetic demo data' : `Cached at ${new Date(cachedAt * 1000).toLocaleTimeString()}`}>
      {isDemo ? 'demo' : age.label}
    </span>
  )
}

function useOutsideClick(ref, cb) {
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) cb()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [ref, cb])
}

// ─── TickerSearch ─────────────────────────────────────────────────────────────

export function TickerSearch({ value, onSelect }) {
  // editing = true  → show text input
  // editing = false → show selected card trigger
  const [editing, setEditing] = useState(!value)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Rich info for the selected ticker (for card display)
  const [selectedInfo, setSelectedInfo] = useState(() => {
    if (!value) return null
    return POPULAR_TICKERS.find((t) => t.symbol === value) ?? { symbol: value }
  })
  const inputRef = useRef(null)
  const ref = useRef(null)
  const { chainCachedAt, chainSource } = useOptionsStore()

  // Sync when value changes externally (e.g. store reset)
  useEffect(() => {
    if (value) {
      setEditing(false)
      setSelectedInfo((prev) =>
        prev?.symbol === value
          ? prev
          : POPULAR_TICKERS.find((t) => t.symbol === value) ?? { symbol: value },
      )
    } else {
      setEditing(true)
      setSelectedInfo(null)
    }
  }, [value])

  const close = () => {
    setOpen(false)
    setResults([])
    setQuery('')
    if (value) setEditing(false)
  }

  useOutsideClick(ref, close)

  // Debounced search
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const id = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.results || [])
        }
      } catch (_) {
        setResults([])
      } finally {
        setBusy(false)
      }
    }, 300)
    return () => clearTimeout(id)
  }, [query])

  const enterEdit = () => {
    setEditing(true)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSelect = (result) => {
    const symbol = typeof result === 'string' ? result : result.symbol
    const info =
      typeof result === 'string'
        ? POPULAR_TICKERS.find((t) => t.symbol === result) ?? { symbol: result }
        : result
    setSelectedInfo(info)
    setQuery('')
    setResults([])
    setOpen(false)
    setEditing(false)
    onSelect(symbol)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') close()
    if (e.key === 'Enter') {
      e.preventDefault()
      const sym = query.trim().toUpperCase()
      if (sym) handleSelect(sym)
    }
  }

  // What to show in the dropdown
  const hasQuery = Boolean(query.trim())
  const dropItems = hasQuery ? results : POPULAR_TICKERS

  return (
    <div className="pk-wrap" ref={ref}>
      {/* ── Selected card trigger (not editing) ── */}
      {!editing && selectedInfo ? (
        <button
          type="button"
          className="pk-trigger selected-ticker-trigger"
          onClick={enterEdit}
          aria-label="Change ticker"
        >
          <div className="stl-body">
            <span className="tc-symbol">{selectedInfo.symbol}</span>
            {selectedInfo.name && <span className="stl-name">{selectedInfo.name}</span>}
          </div>
          <div className="stl-right">
            <DataAgeBadge cachedAt={chainCachedAt} source={chainSource} />
            <span className="pt-chevron stl-edit" aria-hidden="true">✎</span>
          </div>
        </button>
      ) : (
        /* ── Search input ── */
        <div className={`pk-ticker-input-box${busy ? ' busy' : ''}`}>
          <input
            ref={inputRef}
            className="pk-input"
            value={query}
            placeholder="Ticker or company name…"
            maxLength={10}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase())
              setOpen(true)
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            aria-label="Search ticker symbol or company name"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          {busy && <span className="pk-busy" aria-hidden="true" />}
        </div>
      )}

      {/* ── Dropdown ── */}
      {open && (
        <div className="pk-dropdown ticker-dropdown" role="listbox">
          {!hasQuery && <div className="tk-section-header">Popular</div>}
          {dropItems.length === 0 && hasQuery && !busy && (
            <div className="tk-no-results">No results — press ↵ to use "{query}"</div>
          )}
          {dropItems.map((r) => {
            const isSelected = r.symbol === value
            return (
              <button
                key={r.symbol}
                className={`pk-card ticker-card${isSelected ? ' selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(r)}
              >
                <div className="tc-row1">
                  <span className="tc-symbol">{r.symbol}</span>
                  {isSelected && <span className="tc-check">✓</span>}
                </div>
                <span className="tc-name">{r.name}</span>
                <div className="tc-meta">
                  {r.exchange && <span className="tc-badge exchange">{r.exchange}</span>}
                  <span className={`tc-badge type ${badgeClass(r.quoteType)}`}>{r.quoteType}</span>
                </div>
              </button>
            )
          })}
          {!hasQuery && (
            <div className="tk-type-hint">Or type any ticker and press ↵</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ExpirationPicker ─────────────────────────────────────────────────────────

function daysFromNow(unixSeconds) {
  const now = Date.now() / 1000
  return Math.max(0, Math.round((Number(unixSeconds) - now) / 86400))
}

function expiryTag(unixSeconds) {
  const days = daysFromNow(unixSeconds)
  if (days <= 7) return { label: 'Weekly', cls: 'weekly' }
  if (days <= 14) return { label: '2-Week', cls: 'biweekly' }
  if (days <= 45) return { label: 'Monthly', cls: 'monthly' }
  if (days <= 100) return { label: 'Quarterly', cls: 'quarterly' }
  return { label: 'LEAPS', cls: 'leaps' }
}

export function ExpirationPicker({ expirations, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutsideClick(ref, () => setOpen(false))

  const selectedDays = value ? daysFromNow(value) : null
  const selectedTag = value ? expiryTag(value) : null
  const selectedLabel = value
    ? new Date(Number(value) * 1000).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : expirations.length === 0
      ? 'Loading…'
      : 'Select expiration'

  return (
    <div className="pk-wrap" ref={ref}>
      <button
        type="button"
        className={`pk-trigger${open ? ' open' : ''}${!value ? ' placeholder' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={expirations.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pt-label">{selectedLabel}</span>
        {selectedTag && (
          <span className={`er-tag ${selectedTag.cls}`}>{selectedTag.label}</span>
        )}
        {selectedDays !== null && <span className="pt-days">{selectedDays}d</span>}
        <span className="pt-chevron" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="pk-dropdown exp-dropdown" role="listbox">
          {expirations.map((expiry) => {
            const days = daysFromNow(expiry)
            const tag = expiryTag(expiry)
            const date = new Date(Number(expiry) * 1000)
            const isSelected = expiry === value
            return (
              <button
                key={expiry}
                className={`pk-card exp-row${isSelected ? ' selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(expiry)
                  setOpen(false)
                }}
              >
                <span className="er-date">
                  {date.toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span className="er-days">{days}d</span>
                <span className={`er-tag ${tag.cls}`}>{tag.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── StrikePicker ─────────────────────────────────────────────────────────────

function depthClass(strike, spot, itm) {
  if (!spot) return itm ? 'near-itm' : 'near-otm'
  const pct = Math.abs(strike - spot) / spot
  if (pct < 0.005) return 'atm'
  if (itm) return pct > 0.12 ? 'deep-itm' : pct > 0.05 ? 'mod-itm' : 'near-itm'
  return pct > 0.12 ? 'deep-otm' : pct > 0.05 ? 'mod-otm' : 'near-otm'
}

export function StrikePicker({ contracts, optionType, spotPrice, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const listRef = useRef(null)
  useOutsideClick(ref, () => setOpen(false))

  const selected = contracts.find((c) => c.strike === value)
  const label = selected ? `$${selected.strike.toFixed(2)}` : contracts.length === 0 ? 'Loading…' : 'Select strike'

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('.selected')
    if (el) el.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className="pk-wrap" ref={ref}>
      <button
        type="button"
        className={`pk-trigger${open ? ' open' : ''}${!selected ? ' placeholder' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={contracts.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pt-label">{label}</span>
        {selected && (
          <span className={`pt-days ${selected.inTheMoney ? 'itm' : 'otm'}`}>
            {selected.inTheMoney ? 'ITM' : 'OTM'}
          </span>
        )}
        <span className="pt-chevron" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={`pk-dropdown strike-dropdown ${optionType}`} ref={listRef} role="listbox">
          <div className="sk-header">
            <span>Strike</span>
            <span>IV</span>
            <span>Bid / Ask</span>
            <span>Volume</span>
          </div>
          {contracts.map((c) => {
            const depth = depthClass(c.strike, spotPrice, c.inTheMoney)
            const isSelected = c.strike === value
            return (
              <button
                key={c.contractSymbol}
                className={`pk-card strike-row ${optionType} ${depth}${isSelected ? ' selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(c.strike)
                  setOpen(false)
                }}
              >
                <span className="sr-strike">
                  ${c.strike.toFixed(2)}
                  <span className={`sr-badge ${c.inTheMoney ? 'itm' : 'otm'}`}>
                    {c.inTheMoney ? 'ITM' : 'OTM'}
                  </span>
                </span>
                <span className="sr-iv">
                  {c.impliedVolatility
                    ? `${(c.impliedVolatility * 100).toFixed(0)}%`
                    : '—'}
                </span>
                <span className="sr-spread">
                  {c.bid > 0 && c.ask > 0
                    ? `${c.bid.toFixed(2)} / ${c.ask.toFixed(2)}`
                    : '—'}
                </span>
                <span className="sr-vol">{c.volume > 0 ? c.volume.toLocaleString() : '—'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

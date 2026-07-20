import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { blackScholes } from '../utils/optionsMath'

// ─── Scenario persistence (localStorage, survives across sessions) ──────────

const SCENARIOS_KEY = 'ai-options-scenarios'

function loadScenarios() {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistScenarios(scenarios) {
  try {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios))
  } catch {
    // quota exceeded or private-browsing restriction — silently ignore
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ??
  (location.hostname === 'localhost' ? 'http://localhost:4000/api' : '/api')

function getMarkPrice(contract) {
  if (!contract) return null
  if (typeof contract.mark === 'number' && contract.mark > 0) return contract.mark
  if (
    typeof contract.bid === 'number' &&
    typeof contract.ask === 'number' &&
    contract.bid > 0 &&
    contract.ask > 0
  ) {
    return (contract.bid + contract.ask) / 2
  }
  if (typeof contract.lastPrice === 'number' && contract.lastPrice > 0) {
    return contract.lastPrice
  }
  return null
}

export const useOptionsStore = create(
  persist(
    (set, get) => ({
  ticker: 'AAPL',
  positionSide: 'buy',
  optionType: 'call',
  quantity: 1,
  moveRangePercent: 30,
  expirationDate: '',
  strike: null,
  spotPrice: null,
  loading: false,
  error: null,
  expirations: [],
  contracts: [],
  selectedContract: null,
  legs: [],
  chainData: null,
  chainCachedAt: null,   // unix seconds when the active chain data was last fetched/cached
  chainSource: null,     // 'live' | 'cache' | 'demo'
  scenarios: loadScenarios(),

  setTicker: (ticker) =>
    set({
      ticker,
      error: null,
      expirations: [],
      expirationDate: '',
      contracts: [],
      strike: null,
      selectedContract: null,
      spotPrice: null,
      chainData: null,
      chainCachedAt: null,
      chainSource: null,
    }),
  setPositionSide: (positionSide) => {
    set({ positionSide })
    get().selectContractsForCurrentType()
  },
  setOptionType: (optionType) => {
    set({ optionType, error: null })
    get().selectContractsForCurrentType()
  },
  setQuantity: (quantity) => set({ quantity: Math.max(1, quantity || 1) }),
  setMoveRangePercent: (moveRangePercent) =>
    set({
      moveRangePercent: Math.max(5, Math.min(200, Number(moveRangePercent) || 30)),
    }),
  setExpirationDate: async (expirationDate) => {
    set({ expirationDate, error: null })
    await get().fetchChain(expirationDate)
  },
  setStrike: (strike) => {
    const { contracts } = get()
    const found = contracts.find((item) => item.strike === strike) ?? null
    const selectedContract = found ? { ...found, markPrice: getMarkPrice(found) } : null
    set({ strike, selectedContract })
  },

  selectContractsForCurrentType: () => {
    const { chainData, optionType, spotPrice } = get()
    if (!chainData) return

    const contracts = optionType === 'call' ? chainData.calls ?? [] : chainData.puts ?? []
    const nearest =
      contracts.length > 0
        ? contracts.reduce((acc, contract) => {
            if (!acc) return contract
            const currentDistance = Math.abs(contract.strike - spotPrice)
            const previousDistance = Math.abs(acc.strike - spotPrice)
            return currentDistance < previousDistance ? contract : acc
          }, null)
        : null

    const selected =
      contracts.find((item) => item.strike === get().strike) ?? nearest ?? contracts[0] ?? null

    const selectedContract = selected
      ? {
          ...selected,
          markPrice: getMarkPrice(selected),
        }
      : null

    set({
      contracts,
      strike: selectedContract?.strike ?? null,
      selectedContract,
    })
  },

  fetchChain: async (forcedExpiration) => {
    const { ticker, expirationDate } = get()
    const symbol = ticker.trim().toUpperCase()

    if (!symbol) {
      set({ error: 'Enter a ticker symbol first.' })
      return
    }

    set({ loading: true, error: null })

    try {
      const expiry = forcedExpiration ?? expirationDate
      const query = new URLSearchParams({ ticker: symbol })
      if (expiry) {
        query.set('expiration', String(expiry))
      }

      const response = await fetch(`${API_BASE}/option-chain?${query.toString()}`)
      if (!response.ok) {
        throw new Error(`API error ${response.status}`)
      }

      const payload = await response.json()

      const dates = (payload.expirationDates ?? []).map(String)

      // Auto-pick the expiration closest to ~30 days out as the default
      const nowSec = Date.now() / 1000
      const targetSec = nowSec + 30 * 86400
      const reasonableExpiration =
        dates.length > 0
          ? dates.reduce((best, exp) =>
              Math.abs(Number(exp) - targetSec) < Math.abs(Number(best) - targetSec) ? exp : best,
            )
          : null

      // Prefer the expiration the server actually fetched chain data for —
      // this prevents a mismatch between the displayed date and the chain data.
      // Fall back to client-computed ~30d default if the server didn't echo one.
      const nextExpiration = String(
        payload.selectedExpiration ?? forcedExpiration ?? reasonableExpiration ?? dates[0] ?? '',
      )

      set({
        ticker: symbol,
        spotPrice: payload.quote?.regularMarketPrice ?? null,
        expirations: dates,
        expirationDate: nextExpiration,
        chainData: payload.optionChain ?? null,
        chainCachedAt: payload.cachedAt ?? null,
        chainSource: payload.source?.includes('cache') ? 'cache'
          : payload.source?.includes('Demo') ? 'demo' : 'live',
      })

      // Fire-and-forget access tracking to CF Worker
      const cacheWorkerUrl = import.meta.env.VITE_CACHE_WORKER_URL
      if (cacheWorkerUrl) {
        fetch(`${cacheWorkerUrl.replace(/\/$/, '')}/access/${symbol}`, { method: 'POST' })
          .catch(() => {})
      }

      get().selectContractsForCurrentType()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? `Failed to load option chain: ${error.message}`
            : 'Failed to load option chain.',
      })
    } finally {
      set({ loading: false })
    }
  },

  // ─── Position / Legs ───────────────────────────────────────────────────────

  addCurrentLeg: () => {
    const { selectedContract, optionType, positionSide, quantity, ticker, spotPrice } = get()
    if (!selectedContract?.strike || !selectedContract?.markPrice) return false
    const leg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ticker: (ticker || '').trim().toUpperCase(),
      spotPriceAtAdd: spotPrice ?? null,
      optionType,
      positionSide,
      quantity,
      strike: selectedContract.strike,
      markPrice: selectedContract.markPrice,
      impliedVolatility: selectedContract.impliedVolatility || 0.25,
      expiration: selectedContract.expiration,
    }
    set((state) => ({ legs: [...state.legs, leg] }))
    return true
  },

  removeLeg: (id) => set((state) => ({ legs: state.legs.filter((l) => l.id !== id) })),

  resetLegs: () => set({ legs: [] }),

  updateLeg: (id, changes) =>
    set((state) => ({
      legs: state.legs.map((l) => (l.id === id ? { ...l, ...changes } : l)),
    })),

  // ─── Scenarios ─────────────────────────────────────────────────────────────

  saveScenario: (name) => {
    const { ticker, optionType, positionSide, quantity, moveRangePercent, expirationDate, strike, legs } = get()
    const scenario = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: (name || '').trim() || 'Untitled',
      savedAt: Date.now(),
      ticker,
      optionType,
      positionSide,
      quantity,
      moveRangePercent,
      expirationDate,
      strike,
      legs,
    }
    const scenarios = [...get().scenarios, scenario]
    persistScenarios(scenarios)
    set({ scenarios })
  },

  loadScenario: (id) => {
    const scenario = get().scenarios.find((s) => s.id === id)
    if (!scenario) return
    set({
      ticker: scenario.ticker,
      optionType: scenario.optionType,
      positionSide: scenario.positionSide,
      quantity: scenario.quantity,
      moveRangePercent: scenario.moveRangePercent,
      expirationDate: scenario.expirationDate,
      strike: scenario.strike,
      legs: scenario.legs,
      // Clear live chain data so App.jsx's useEffect re-fetches for the restored ticker
      error: null,
      expirations: [],
      contracts: [],
      selectedContract: null,
      spotPrice: null,
      chainData: null,
      chainCachedAt: null,
      chainSource: null,
    })
  },

  deleteScenario: (id) => {
    const scenarios = get().scenarios.filter((s) => s.id !== id)
    persistScenarios(scenarios)
    set({ scenarios })
  },

  renameScenario: (id, name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const scenarios = get().scenarios.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
    persistScenarios(scenarios)
    set({ scenarios })
  },

  applyStrategy: (strategyName) => {
    const { chainData, spotPrice, ticker } = get()
    if (!chainData || !spotPrice) return

    const symbol = (ticker || '').trim().toUpperCase()
    const calls = chainData.calls ?? []
    const puts = chainData.puts ?? []

    function nearest(contracts, target) {
      if (!contracts.length) return null
      return contracts.reduce((best, c) => {
        if (!best) return c
        return Math.abs(c.strike - target) < Math.abs(best.strike - target) ? c : best
      }, null)
    }

    function nearestAbove(contracts, target) {
      const above = contracts.filter((c) => c.strike >= target)
      if (!above.length) return nearest(contracts, target)
      return above.reduce((best, c) => (c.strike < best.strike ? c : best))
    }

    function nearestBelow(contracts, target) {
      const below = contracts.filter((c) => c.strike <= target)
      if (!below.length) return nearest(contracts, target)
      return below.reduce((best, c) => (c.strike > best.strike ? c : best))
    }

    function makeLeg(contract, optionType, positionSide, quantity = 1) {
      if (!contract) return null
      const mark = getMarkPrice(contract)
      if (!mark) return null
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ticker: symbol,
        spotPriceAtAdd: spotPrice,
        optionType,
        positionSide,
        quantity,
        strike: contract.strike,
        markPrice: mark,
        impliedVolatility: contract.impliedVolatility || 0.25,
        expiration: contract.expiration,
      }
    }

    const atmCall = nearest(calls, spotPrice)
    const atmPut = nearest(puts, spotPrice)
    const otmC1 = nearestAbove(calls, spotPrice * 1.03)
    const otmC2 = nearestAbove(calls, spotPrice * 1.06)
    const otmP1 = nearestBelow(puts, spotPrice * 0.97)
    const otmP2 = nearestBelow(puts, spotPrice * 0.94)
    const otmCW = nearestAbove(calls, spotPrice * 1.05)
    const otmPW = nearestBelow(puts, spotPrice * 0.95)

    // Calendar spreads: sell near-term (~30 DTE) ATM, buy far-term (~60 DTE) ATM.
    // Target meaningful time between legs so theta decay differential is real.
    const nowSec = Date.now() / 1000
    const { expirations: allExps } = get()
    const sortedExps = [...allExps].map(Number).filter(Boolean).sort((a, b) => a - b)

    // Pick the expiration closest to a target DTE, with a minimum DTE floor.
    function pickExp(targetDays, minDays = 0, excludeExp = null) {
      const targetSec = nowSec + targetDays * 86400
      const minSec = nowSec + minDays * 86400
      const candidates = sortedExps.filter((e) => e >= minSec && e !== excludeExp)
      if (!candidates.length) return sortedExps.find((e) => e !== excludeExp) ?? Math.round(nowSec + targetDays * 86400)
      return candidates.reduce((best, e) =>
        Math.abs(e - targetSec) < Math.abs(best - targetSec) ? e : best
      )
    }

    // Near leg: closest to 30 DTE, at least 14 days out
    const nearExp = pickExp(30, 14)
    // Far leg: closest to 60 DTE, must be at least 21 days after near leg
    const nearDays = Math.round((nearExp - nowSec) / 86400)
    const farExp = pickExp(nearDays + 30, nearDays + 21, nearExp)
    // Expiration whose contracts we actually loaded — use live mark for that one, BS for others
    const loadedExp = atmCall?.expiration ?? null

    function makeCalendarLeg(contract, optionType, positionSide, expiration) {
      if (!contract) return null
      const iv = Math.max(contract.impliedVolatility || 0.25, 0.05)
      const timeYears = Math.max((expiration - nowSec) / (365 * 86400), 1 / 365)
      const mark = expiration === loadedExp
        ? getMarkPrice(contract)
        : blackScholes({ stockPrice: spotPrice, strike: contract.strike, timeYears, volatility: iv, rate: 0.05, optionType })
      if (!mark || mark <= 0) return null
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ticker: symbol,
        spotPriceAtAdd: spotPrice,
        optionType,
        positionSide,
        quantity: 1,
        strike: contract.strike,
        markPrice: Math.max(0.01, Math.round(mark * 100) / 100),
        impliedVolatility: iv,
        expiration,
      }
    }

    const strategies = {
      'long-straddle':    [makeLeg(atmCall, 'call', 'buy'), makeLeg(atmPut, 'put', 'buy')],
      'short-straddle':   [makeLeg(atmCall, 'call', 'sell'), makeLeg(atmPut, 'put', 'sell')],
      'long-strangle':    [makeLeg(otmC1, 'call', 'buy'), makeLeg(otmP1, 'put', 'buy')],
      'short-strangle':   [makeLeg(otmC1, 'call', 'sell'), makeLeg(otmP1, 'put', 'sell')],
      'bull-call-spread': [makeLeg(atmCall, 'call', 'buy'), makeLeg(otmCW, 'call', 'sell')],
      'bear-put-spread':  [makeLeg(atmPut, 'put', 'buy'), makeLeg(otmPW, 'put', 'sell')],
      'bull-put-spread':  [makeLeg(otmPW, 'put', 'buy'), makeLeg(atmPut, 'put', 'sell')],
      'bear-call-spread': [makeLeg(atmCall, 'call', 'sell'), makeLeg(otmCW, 'call', 'buy')],
      'iron-condor': [
        makeLeg(otmC1, 'call', 'sell'),
        makeLeg(otmC2, 'call', 'buy'),
        makeLeg(otmP1, 'put', 'sell'),
        makeLeg(otmP2, 'put', 'buy'),
      ],
      'iron-butterfly': [
        makeLeg(atmCall, 'call', 'sell'),
        makeLeg(atmPut, 'put', 'sell'),
        makeLeg(otmCW, 'call', 'buy'),
        makeLeg(otmPW, 'put', 'buy'),
      ],
      'call-calendar': [
        makeCalendarLeg(atmCall, 'call', 'sell', nearExp),
        makeCalendarLeg(atmCall, 'call', 'buy',  farExp),
      ],
      'put-calendar': [
        makeCalendarLeg(atmPut, 'put', 'sell', nearExp),
        makeCalendarLeg(atmPut, 'put', 'buy',  farExp),
      ],
    }

    const newLegs = (strategies[strategyName] ?? []).filter(Boolean)
    set({ legs: newLegs })
  },
  }),
  {
    name: 'ai-options-state',
    storage: createJSONStorage(() => sessionStorage),
    partialize: (state) => ({
      ticker: state.ticker,
      positionSide: state.positionSide,
      optionType: state.optionType,
      quantity: state.quantity,
      moveRangePercent: state.moveRangePercent,
      expirationDate: state.expirationDate,
      strike: state.strike,
      legs: state.legs,
    }),
  }
))

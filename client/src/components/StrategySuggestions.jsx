import { useMemo, useState } from 'react'
import { useOptionsStore } from '../store/optionsStore'
import './StrategySuggestions.css'

const RATE = 0.05

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function nearest(arr, target) {
  if (!arr.length) return null
  return arr.reduce((b, c) => (Math.abs(c.strike - target) < Math.abs(b.strike - target) ? c : b))
}

function findAt(arr, target, tolerance = 0.05) {
  return arr.find((c) => Math.abs(c.strike - target) / target <= tolerance) ?? nearest(arr, target)
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/* ─── Signal computation ──────────────────────────────────────────────────── */

function computeSignals(chainData, spotPrice) {
  if (!chainData || !spotPrice) return null

  const calls = (chainData.calls ?? []).filter((c) => c.strike > 0 && c.impliedVolatility > 0)
  const puts = (chainData.puts ?? []).filter((p) => p.strike > 0 && p.impliedVolatility > 0)
  if (calls.length < 2 || puts.length < 2) return null

  // --- ATM IV (average of 2 nearest calls + 2 nearest puts) ---
  const sortedCalls = [...calls].sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))
  const sortedPuts = [...puts].sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))
  const atmSample = [
    ...sortedCalls.slice(0, 2).map((c) => c.impliedVolatility),
    ...sortedPuts.slice(0, 2).map((p) => p.impliedVolatility),
  ]
  const atmIv = atmSample.reduce((s, v) => s + v, 0) / atmSample.length

  // --- Skew: OTM put IV (at ~90% spot) vs OTM call IV (at ~110% spot) ---
  const otmPut = findAt(puts, spotPrice * 0.9)
  const otmCall = findAt(calls, spotPrice * 1.1)
  const skew = otmPut && otmCall ? otmPut.impliedVolatility - otmCall.impliedVolatility : 0

  // --- ATM put/call IV ratio ---
  const atmCall = nearest(calls, spotPrice)
  const atmPut = nearest(puts, spotPrice)
  const atmPcIvRatio = atmCall && atmPut && atmCall.impliedVolatility > 0
    ? atmPut.impliedVolatility / atmCall.impliedVolatility
    : 1

  // --- Put/Call OI ratio ---
  const totalCallOi = calls.reduce((s, c) => s + (c.openInterest || 0), 0)
  const totalPutOi = puts.reduce((s, p) => s + (p.openInterest || 0), 0)
  const pcRatio = totalCallOi > 0 ? totalPutOi / totalCallOi : 1

  // --- Max Pain ---
  const allStrikes = Array.from(new Set([...calls.map((c) => c.strike), ...puts.map((p) => p.strike)])).sort((a, b) => a - b)
  const callMap = new Map(calls.map((c) => [c.strike, c.openInterest || 0]))
  const putMap = new Map(puts.map((p) => [p.strike, p.openInterest || 0]))
  let maxPain = spotPrice
  let minLoss = Infinity
  for (const K of allStrikes) {
    let loss = 0
    for (const s of allStrikes) {
      loss += (callMap.get(s) ?? 0) * Math.max(K - s, 0)
      loss += (putMap.get(s) ?? 0) * Math.max(s - K, 0)
    }
    if (loss < minLoss) { minLoss = loss; maxPain = K }
  }
  const spotVsMaxPain = (spotPrice - maxPain) / spotPrice

  // --- DTE of loaded chain (estimate from ATM call expiration) ---
  const expSec = Number(atmCall?.expiration ?? 0)
  const nowSec = Date.now() / 1000
  const dte = expSec > nowSec ? Math.round((expSec - nowSec) / 86400) : 30

  // --- Put-Call Parity arbitrage scan ---
  // C - P = S - K * e^(-rT) for options with the same strike
  const T = Math.max(dte / 365, 1 / 365)
  const arb = []
  for (const K of allStrikes) {
    const call = calls.find((c) => c.strike === K)
    const put = puts.find((p) => p.strike === K)
    if (!call || !put) continue
    const callMid = call.mark || (call.bid + call.ask) / 2 || call.lastPrice || 0
    const putMid = put.mark || (put.bid + put.ask) / 2 || put.lastPrice || 0
    if (callMid <= 0 || putMid <= 0) continue
    const theoretical = spotPrice - K * Math.exp(-RATE * T)
    const actual = callMid - putMid
    const deviation = actual - theoretical
    const threshold = Math.max(0.25, spotPrice * 0.002) // dynamic threshold
    if (Math.abs(deviation) > threshold) {
      arb.push({
        strike: K,
        deviation,
        direction: deviation > 0 ? 'calls-rich' : 'puts-rich',
        callMid,
        putMid,
        theoretical,
      })
    }
  }
  // Keep top 3 worst violations
  arb.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
  const topArb = arb.slice(0, 3)

  return { atmIv, skew, pcRatio, spotVsMaxPain, dte, maxPain, atmPcIvRatio, arb: topArb }
}

/* ─── Strategy definitions ────────────────────────────────────────────────── */

const STRATEGIES = [
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    type: 'neutral',
    risk: 'Defined',
    legs: 4,
    description: 'Sell OTM call + put spreads. Profit if the stock stays in a range until expiration.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.2) / 0.35) * 35, 0, 35)
      s += clamp(20 - Math.abs(skew) * 250, 0, 20)
      if (pcRatio >= 0.7 && pcRatio <= 1.5) s += 15
      s += clamp(15 - Math.abs(spotVsMaxPain) * 200, 0, 15)
      if (dte >= 20 && dte <= 55) s += 15
      else if (dte > 10) s += 6
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, pcRatio, spotVsMaxPain }) {
      const r = []
      if (atmIv >= 0.3) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% (elevated)`, type: 'pos' })
      if (Math.abs(skew) <= 0.06) r.push({ label: 'Balanced skew', type: 'neutral' })
      else r.push({ label: skew > 0 ? 'Put-heavy skew — widen lower wing' : 'Call-heavy skew — widen upper wing', type: 'warn' })
      if (pcRatio >= 0.7 && pcRatio <= 1.5) r.push({ label: `Neutral P/C ${pcRatio.toFixed(2)}`, type: 'neutral' })
      if (Math.abs(spotVsMaxPain) < 0.025) r.push({ label: 'Spot near max pain', type: 'neutral' })
      return r
    },
  },
  {
    id: 'short-straddle',
    name: 'Short Straddle',
    type: 'neutral',
    risk: 'Unlimited',
    legs: 2,
    description: 'Sell ATM call + put. Profit from IV crush or minimal price movement.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.3) / 0.3) * 40, 0, 40)
      s += clamp(20 - Math.abs(skew) * 300, 0, 20)
      s += clamp(20 - Math.abs(spotVsMaxPain) * 300, 0, 20)
      if (pcRatio >= 0.8 && pcRatio <= 1.2) s += 10
      if (dte >= 15 && dte <= 40) s += 10
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, spotVsMaxPain }) {
      const r = []
      if (atmIv >= 0.35) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% (crush potential)`, type: 'pos' })
      if (Math.abs(skew) <= 0.04) r.push({ label: 'Symmetric skew', type: 'neutral' })
      if (Math.abs(spotVsMaxPain) < 0.015) r.push({ label: 'At max pain', type: 'pos' })
      if (atmIv >= 0.5) r.push({ label: 'Extreme IV — high premium collected', type: 'pos' })
      return r
    },
  },
  {
    id: 'short-strangle',
    name: 'Short Strangle',
    type: 'neutral',
    risk: 'Unlimited',
    legs: 2,
    description: 'Sell OTM call + OTM put. Wider range than straddle, lower premium.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.28) / 0.3) * 35, 0, 35)
      s += clamp(18 - Math.abs(skew) * 200, 0, 18)
      if (pcRatio >= 0.7 && pcRatio <= 1.4) s += 15
      s += clamp(15 - Math.abs(spotVsMaxPain) * 150, 0, 15)
      if (dte >= 15 && dte <= 50) s += 17
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, dte, pcRatio }) {
      const r = []
      if (atmIv >= 0.3) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% elevated`, type: 'pos' })
      if (dte >= 20 && dte <= 45) r.push({ label: `${dte}d DTE — theta-rich`, type: 'pos' })
      if (pcRatio >= 0.7 && pcRatio <= 1.4) r.push({ label: 'Neutral positioning', type: 'neutral' })
      return r
    },
  },
  {
    id: 'iron-butterfly',
    name: 'Iron Butterfly',
    type: 'neutral',
    risk: 'Defined',
    legs: 4,
    description: 'Sell ATM straddle + buy OTM wings. Maximum credit at the strike, defined risk.',
    score({ atmIv, skew, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.3) / 0.3) * 35, 0, 35)
      s += clamp(20 - Math.abs(skew) * 250, 0, 20)
      s += clamp(25 - Math.abs(spotVsMaxPain) * 400, 0, 25)
      if (dte >= 15 && dte <= 40) s += 20
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, spotVsMaxPain }) {
      const r = []
      if (atmIv >= 0.35) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% (high credit)`, type: 'pos' })
      if (Math.abs(spotVsMaxPain) < 0.01) r.push({ label: 'Spot at max pain', type: 'pos' })
      if (Math.abs(skew) <= 0.04) r.push({ label: 'Low skew — symmetric wings', type: 'neutral' })
      return r
    },
  },
  {
    id: 'long-straddle',
    name: 'Long Straddle',
    type: 'volatility',
    risk: 'Premium paid',
    legs: 2,
    description: 'Buy ATM call + put. Profits from a large move in either direction.',
    score({ atmIv, skew, dte }) {
      let s = 0
      s += clamp(((0.3 - atmIv) / 0.25) * 40, 0, 40)
      s += clamp(20 - Math.abs(skew) * 200, 0, 20)
      if (dte >= 20 && dte <= 60) s += 20
      else if (dte > 60) s += 12
      s += clamp((0.2 - atmIv) * 100, 0, 20) // bonus for very low IV
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, dte }) {
      const r = []
      if (atmIv < 0.2) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — cheap options`, type: 'pos' })
      else if (atmIv < 0.28) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — moderate`, type: 'neutral' })
      else r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — options expensive`, type: 'neg' })
      if (dte >= 20 && dte <= 60) r.push({ label: `${dte}d DTE — good runway`, type: 'neutral' })
      r.push({ label: 'Needs large move to profit', type: 'warn' })
      return r
    },
  },
  {
    id: 'long-strangle',
    name: 'Long Strangle',
    type: 'volatility',
    risk: 'Premium paid',
    legs: 2,
    description: 'Buy OTM call + OTM put. Lower cost than straddle, needs bigger move.',
    score({ atmIv, dte }) {
      let s = 0
      s += clamp(((0.28 - atmIv) / 0.23) * 40, 0, 40)
      if (dte >= 25 && dte <= 70) s += 25
      else if (dte > 70) s += 15
      s += clamp((0.22 - atmIv) * 150, 0, 20)
      s += 15 // always somewhat valid as a speculative play
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, dte }) {
      const r = []
      if (atmIv < 0.22) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — cheap wings`, type: 'pos' })
      if (dte >= 25 && dte <= 70) r.push({ label: `${dte}d DTE — good runway`, type: 'neutral' })
      r.push({ label: 'Lower cost than straddle', type: 'neutral' })
      return r
    },
  },
  {
    id: 'bull-call-spread',
    name: 'Bull Call Spread',
    type: 'bullish',
    risk: 'Defined',
    legs: 2,
    description: 'Buy ATM call, sell OTM call. Capped upside profit with lower cost than naked long.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      if (atmIv >= 0.15 && atmIv <= 0.45) s += 20
      if (skew < 0) s += clamp(Math.abs(skew) * 200, 0, 20) // call skew = bullish sentiment
      if (pcRatio < 0.9) s += clamp((0.9 - pcRatio) * 100, 0, 25)
      if (spotVsMaxPain < -0.02) s += clamp(Math.abs(spotVsMaxPain) * 200, 0, 20)
      if (dte >= 20 && dte <= 60) s += 15
      return Math.round(Math.min(s, 100))
    },
    signals({ skew, pcRatio, spotVsMaxPain }) {
      const r = []
      if (pcRatio < 0.9) r.push({ label: `P/C ${pcRatio.toFixed(2)} — bullish bias`, type: 'pos' })
      if (skew < 0) r.push({ label: 'Call-side demand elevated', type: 'pos' })
      if (spotVsMaxPain < -0.03) r.push({ label: `${(Math.abs(spotVsMaxPain) * 100).toFixed(1)}% below max pain`, type: 'pos' })
      else if (spotVsMaxPain < 0) r.push({ label: 'Spot below max pain', type: 'neutral' })
      return r
    },
  },
  {
    id: 'bear-put-spread',
    name: 'Bear Put Spread',
    type: 'bearish',
    risk: 'Defined',
    legs: 2,
    description: 'Buy ATM put, sell OTM put. Capped downside profit with lower cost than naked long.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      if (atmIv >= 0.15 && atmIv <= 0.5) s += 20
      if (skew > 0.03) s += clamp(skew * 300, 0, 20) // put skew = bearish
      if (pcRatio > 1.1) s += clamp((pcRatio - 1.0) * 60, 0, 25)
      if (spotVsMaxPain > 0.02) s += clamp(spotVsMaxPain * 200, 0, 20)
      if (dte >= 20 && dte <= 60) s += 15
      return Math.round(Math.min(s, 100))
    },
    signals({ skew, pcRatio, spotVsMaxPain }) {
      const r = []
      if (pcRatio > 1.1) r.push({ label: `P/C ${pcRatio.toFixed(2)} — bearish bias`, type: 'neg' })
      if (skew > 0.03) r.push({ label: `Put skew +${(skew * 100).toFixed(1)}%`, type: 'neg' })
      if (spotVsMaxPain > 0.03) r.push({ label: `${(spotVsMaxPain * 100).toFixed(1)}% above max pain`, type: 'neg' })
      return r
    },
  },
  {
    id: 'bull-put-spread',
    name: 'Bull Put Spread',
    type: 'bullish',
    risk: 'Defined',
    legs: 2,
    description: 'Sell ATM put, buy OTM put for protection. Collect premium while defining risk.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.2) / 0.35) * 30, 0, 30)
      if (pcRatio < 1.1) s += clamp((1.1 - pcRatio) * 50, 0, 20)
      if (spotVsMaxPain <= 0) s += clamp(Math.abs(spotVsMaxPain) * 150, 0, 20)
      if (dte >= 15 && dte <= 50) s += 15
      if (skew > 0.03) s += clamp(skew * 200, 0, 15) // expensive puts = more premium collected
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, pcRatio }) {
      const r = []
      if (atmIv >= 0.28) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — rich put premium`, type: 'pos' })
      if (skew > 0.03) r.push({ label: `Put skew ${(skew * 100).toFixed(1)}% — collect more`, type: 'pos' })
      if (pcRatio < 0.9) r.push({ label: 'Bullish market positioning', type: 'pos' })
      return r
    },
  },
  {
    id: 'bear-call-spread',
    name: 'Bear Call Spread',
    type: 'bearish',
    risk: 'Defined',
    legs: 2,
    description: 'Sell ATM call, buy OTM call for protection. Collect premium with a bearish outlook.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.2) / 0.35) * 30, 0, 30)
      if (pcRatio > 1.1) s += clamp((pcRatio - 1.0) * 50, 0, 20)
      if (spotVsMaxPain >= 0) s += clamp(spotVsMaxPain * 150, 0, 20)
      if (dte >= 15 && dte <= 50) s += 15
      if (skew < -0.02) s += clamp(Math.abs(skew) * 200, 0, 15) // expensive calls
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, pcRatio, spotVsMaxPain }) {
      const r = []
      if (atmIv >= 0.28) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% elevated`, type: 'pos' })
      if (pcRatio > 1.1) r.push({ label: `P/C ${pcRatio.toFixed(2)} — bearish OI`, type: 'neg' })
      if (spotVsMaxPain > 0.02) r.push({ label: `Stock above max pain`, type: 'neg' })
      return r
    },
  },
  {
    id: 'call-calendar',
    name: 'Call Calendar',
    type: 'neutral',
    risk: 'Defined',
    legs: 2,
    description: 'Sell near-term call, buy same-strike far-term call. Profit from near-term theta decay.',
    score({ atmIv, skew, dte }) {
      let s = 0
      if (atmIv >= 0.15 && atmIv <= 0.45) s += 25
      s += clamp(20 - Math.abs(skew) * 200, 0, 20)
      if (dte >= 15 && dte <= 45) s += 25 // near-leg ideal window
      else if (dte > 45) s += 12
      s += 20 // calendars are versatile
      if (atmIv >= 0.2 && atmIv <= 0.35) s += 10
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, dte, skew }) {
      const r = []
      if (Math.abs(skew) <= 0.05) r.push({ label: 'Neutral skew — symmetric entry', type: 'neutral' })
      if (dte >= 15 && dte <= 45) r.push({ label: `Near leg ${dte}d — fast theta decay`, type: 'pos' })
      if (atmIv >= 0.2 && atmIv <= 0.35) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — vol crush risk moderate`, type: 'neutral' })
      return r
    },
  },
  {
    id: 'put-calendar',
    name: 'Put Calendar',
    type: 'neutral',
    risk: 'Defined',
    legs: 2,
    description: 'Sell near-term put, buy far-term put. Profit from theta decay with slight bearish tilt.',
    score({ atmIv, skew, pcRatio, dte }) {
      let s = 0
      if (atmIv >= 0.15 && atmIv <= 0.45) s += 25
      if (skew > 0.02) s += clamp(skew * 300, 0, 15) // put skew helps near-term sell
      if (pcRatio > 1.0) s += clamp((pcRatio - 1.0) * 30, 0, 10)
      if (dte >= 15 && dte <= 45) s += 25
      else if (dte > 45) s += 12
      s += 15
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, dte }) {
      const r = []
      if (skew > 0.02) r.push({ label: `Put skew +${(skew * 100).toFixed(1)}% — sell near put richly`, type: 'pos' })
      if (dte >= 15 && dte <= 45) r.push({ label: `Near leg ${dte}d — fast theta decay`, type: 'pos' })
      if (atmIv <= 0.35) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — far leg cheap`, type: 'neutral' })
      return r
    },
  },
  {
    id: 'covered-call',
    name: 'Covered Call',
    type: 'bullish',
    risk: 'Stock downside',
    legs: 2,
    description: 'Long stock + sell OTM call. Collect premium to reduce cost basis. Common income strategy.',
    score({ atmIv, skew, pcRatio, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.15) / 0.35) * 35, 0, 35)
      if (pcRatio < 1.1) s += clamp((1.1 - pcRatio) * 40, 0, 15)
      if (dte >= 15 && dte <= 45) s += 20
      if (skew < 0) s += clamp(Math.abs(skew) * 150, 0, 15) // expensive calls = more premium
      s += 15 // covered call always somewhat applicable
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, dte, skew }) {
      const r = []
      if (atmIv >= 0.28) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — rich call premium`, type: 'pos' })
      if (skew < 0) r.push({ label: 'Call-side skew — higher premium', type: 'pos' })
      if (dte >= 20 && dte <= 45) r.push({ label: `${dte}d DTE — theta sweet spot`, type: 'neutral' })
      r.push({ label: 'Reduces cost basis on long stock', type: 'neutral' })
      return r
    },
  },
  {
    id: 'cash-secured-put',
    name: 'Cash-Secured Put',
    type: 'bullish',
    risk: 'Downside to $0',
    legs: 1,
    description: 'Sell OTM put secured by cash. Acquire stock at a discount or keep the premium.',
    score({ atmIv, skew, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((atmIv - 0.2) / 0.4) * 35, 0, 35)
      if (skew > 0.03) s += clamp(skew * 200, 0, 15) // rich puts = more premium
      if (pcRatio > 1.0) s += clamp((pcRatio - 1.0) * 40, 0, 15)
      if (spotVsMaxPain >= -0.05 && spotVsMaxPain <= 0.05) s += 15
      if (dte >= 15 && dte <= 45) s += 20
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, skew, dte }) {
      const r = []
      if (atmIv >= 0.28) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — rich put premium`, type: 'pos' })
      if (skew > 0.03) r.push({ label: `Put skew ${(skew * 100).toFixed(1)}% — collect more`, type: 'pos' })
      if (dte >= 20 && dte <= 45) r.push({ label: `${dte}d DTE — theta-rich`, type: 'neutral' })
      r.push({ label: 'Obligation to buy stock if assigned', type: 'warn' })
      return r
    },
  },
  {
    id: 'protective-put',
    name: 'Protective Put',
    type: 'bearish',
    risk: 'Premium paid',
    legs: 2,
    description: 'Long stock + buy OTM put. Insurance against a significant decline.',
    score({ atmIv, pcRatio, spotVsMaxPain, dte }) {
      let s = 0
      s += clamp(((0.35 - atmIv) / 0.3) * 30, 0, 30) // cheap puts = good time to buy
      if (pcRatio > 1.0) s += clamp((pcRatio - 1.0) * 40, 0, 15)
      if (spotVsMaxPain > 0.05) s += 20 // stock well above max pain = downside risk
      if (dte >= 30 && dte <= 90) s += 20
      s += 15 // protective put is always defensively sound
      return Math.round(Math.min(s, 100))
    },
    signals({ atmIv, pcRatio, spotVsMaxPain }) {
      const r = []
      if (atmIv < 0.25) r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — cheap insurance`, type: 'pos' })
      else r.push({ label: `IV ${(atmIv * 100).toFixed(0)}% — puts are expensive`, type: 'warn' })
      if (spotVsMaxPain > 0.05) r.push({ label: `${(spotVsMaxPain * 100).toFixed(1)}% above max pain`, type: 'neg' })
      if (pcRatio > 1.0) r.push({ label: 'Bearish OI positioning', type: 'neg' })
      return r
    },
  },
]

/* ─── Score label ─────────────────────────────────────────────────────────── */

function scoreLabel(score) {
  if (score >= 75) return { label: 'Strong fit', cls: 'ss-score--strong' }
  if (score >= 50) return { label: 'Good fit', cls: 'ss-score--good' }
  if (score >= 30) return { label: 'Moderate', cls: 'ss-score--moderate' }
  return { label: 'Weak', cls: 'ss-score--weak' }
}

/* ─── Strategy card ───────────────────────────────────────────────────────── */

const TYPE_META = {
  neutral:    { label: 'Neutral',    cls: 'ss-type--neutral' },
  bullish:    { label: 'Bullish',    cls: 'ss-type--bullish' },
  bearish:    { label: 'Bearish',    cls: 'ss-type--bearish' },
  volatility: { label: 'Volatility', cls: 'ss-type--vol' },
}

const SIGNAL_TYPE_CLS = {
  pos: 'ss-signal--pos',
  neg: 'ss-signal--neg',
  warn: 'ss-signal--warn',
  neutral: 'ss-signal--neutral',
}

function StrategyCard({ strategy, scored, onApply, canApply }) {
  const { label: scoreStr, cls: scoreCls } = scoreLabel(scored)
  const typeMeta = TYPE_META[strategy.type] ?? TYPE_META.neutral
  const signals = strategy.signals(strategy._params)

  return (
    <div className={`ss-card ${scoreCls}`}>
      <div className="ss-card-top">
        <div className="ss-card-name-row">
          <span className="ss-card-name">{strategy.name}</span>
          <span className={`ss-type-badge ${typeMeta.cls}`}>{typeMeta.label}</span>
          <span className={`ss-score-badge ${scoreCls}`}>{scored}/100</span>
        </div>
        <div className="ss-score-bar-track">
          <div className="ss-score-bar-fill" style={{ width: `${scored}%` }} />
        </div>
        <p className="ss-card-desc">{strategy.description}</p>
        <div className="ss-meta-row">
          <span className="ss-meta-item">
            <span className="ss-meta-label">Risk</span>
            <span className="ss-meta-value">{strategy.risk}</span>
          </span>
          <span className="ss-meta-item">
            <span className="ss-meta-label">Legs</span>
            <span className="ss-meta-value">{strategy.legs}</span>
          </span>
        </div>
      </div>
      <div className="ss-signals">
        {signals.map((s, i) => (
          <span key={i} className={`ss-signal ${SIGNAL_TYPE_CLS[s.type] ?? SIGNAL_TYPE_CLS.neutral}`}>
            {s.label}
          </span>
        ))}
      </div>
      {canApply && (
        <button
          type="button"
          className="ss-apply-btn"
          onClick={() => onApply(strategy.id)}
        >
          Build position
        </button>
      )}
    </div>
  )
}

/* ─── Arbitrage panel ─────────────────────────────────────────────────────── */

function ArbitrageAlerts({ arb, spotPrice }) {
  if (!arb.length) return null

  return (
    <div className="ss-arb-panel">
      <div className="ss-arb-header">
        <span className="ss-arb-title">Put-Call Parity Signals</span>
        <span className="ss-arb-hint">
          C − P ≈ S − PV(K). Deviations may reflect liquidity gaps or tradeable edges.
        </span>
      </div>
      <div className="ss-arb-list">
        {arb.map((a) => (
          <div key={a.strike} className="ss-arb-row">
            <span className="ss-arb-strike">${a.strike.toFixed(0)}</span>
            <span className={`ss-arb-dir ${a.direction === 'calls-rich' ? 'ss-arb-dir--calls' : 'ss-arb-dir--puts'}`}>
              {a.direction === 'calls-rich' ? 'Calls rich' : 'Puts rich'}
            </span>
            <span className="ss-arb-vals">
              C${a.callMid.toFixed(2)} · P${a.putMid.toFixed(2)} · theory {a.theoretical >= 0 ? '+' : ''}${a.theoretical.toFixed(2)}
            </span>
            <span className={`ss-arb-dev ${a.deviation > 0 ? 'ss-arb-dev--pos' : 'ss-arb-dev--neg'}`}>
              {a.deviation >= 0 ? '+' : ''}${a.deviation.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Summary chips ───────────────────────────────────────────────────────── */

function ivLabel(iv) {
  if (iv > 0.5) return { text: 'Extreme', cls: 'ss-chip--neg' }
  if (iv > 0.35) return { text: 'High', cls: 'ss-chip--warn' }
  if (iv > 0.2) return { text: 'Moderate', cls: 'ss-chip--neutral' }
  return { text: 'Low', cls: 'ss-chip--pos' }
}

function skewLabel(skew) {
  if (skew > 0.08) return { text: 'Heavy put skew', cls: 'ss-chip--neg' }
  if (skew > 0.03) return { text: 'Put skew', cls: 'ss-chip--warn' }
  if (skew < -0.03) return { text: 'Call skew', cls: 'ss-chip--pos' }
  return { text: 'Balanced', cls: 'ss-chip--neutral' }
}

function pcLabel(pcRatio) {
  if (pcRatio > 1.4) return { text: `P/C ${pcRatio.toFixed(2)} (very bearish)`, cls: 'ss-chip--neg' }
  if (pcRatio > 1.1) return { text: `P/C ${pcRatio.toFixed(2)} (bearish)`, cls: 'ss-chip--warn' }
  if (pcRatio < 0.7) return { text: `P/C ${pcRatio.toFixed(2)} (bullish)`, cls: 'ss-chip--pos' }
  if (pcRatio < 0.9) return { text: `P/C ${pcRatio.toFixed(2)} (mildly bullish)`, cls: 'ss-chip--neutral' }
  return { text: `P/C ${pcRatio.toFixed(2)} (neutral)`, cls: 'ss-chip--neutral' }
}

/* ─── Main component ──────────────────────────────────────────────────────── */

export function StrategySuggestions({ chainData, spotPrice, activelegs, ticker, dragHandle }) {
  const applyStrategy = useOptionsStore((s) => s.applyStrategy)
  const resetLegs = useOptionsStore((s) => s.resetLegs)
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const signals = useMemo(() => computeSignals(chainData, spotPrice), [chainData, spotPrice])

  const scored = useMemo(() => {
    if (!signals) return []
    const params = {
      atmIv: signals.atmIv,
      skew: signals.skew,
      pcRatio: signals.pcRatio,
      spotVsMaxPain: signals.spotVsMaxPain,
      dte: signals.dte,
    }
    return STRATEGIES.map((def) => ({
      ...def,
      _params: params,
      _score: def.score(params),
    })).sort((a, b) => b._score - a._score)
  }, [signals])

  const visible = showAll ? scored : scored.slice(0, 5)
  const canApply = chainData && spotPrice

  function handleApply(id) {
    resetLegs()
    applyStrategy(id)
  }

  if (!chainData || !spotPrice) {
    return (
      <div className="ss-outer">
        <div className="ss-header">
          <span className="ss-title">Strategy Suggestions</span>
        </div>
        <p className="ss-empty">Load a ticker to get strategy suggestions.</p>
      </div>
    )
  }

  if (!signals) {
    return (
      <div className="ss-outer">
        <div className="ss-header">
          <span className="ss-title">Strategy Suggestions</span>
        </div>
        <p className="ss-empty">Insufficient chain data for analysis.</p>
      </div>
    )
  }

  const iv = ivLabel(signals.atmIv)
  const sk = skewLabel(signals.skew)
  const pc = pcLabel(signals.pcRatio)
  const maxPainDiff = signals.spotVsMaxPain
  const maxPainPct = (maxPainDiff * 100).toFixed(1)

  return (
    <div className="ss-outer">
      <div className="ss-header">
        {dragHandle}
        <span className="ss-title">Strategy Suggestions</span>
        <button
          type="button"
          className={`panel-collapse-btn${collapsed ? ' collapsed' : ''}`}
          onClick={() => setCollapsed((o) => !o)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand suggestions' : 'Collapse suggestions'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Summary chips */}
          <div className="ss-chips">
            <span className={`ss-chip ${iv.cls}`}>
              IV {(signals.atmIv * 100).toFixed(0)}% — {iv.text}
            </span>
            <span className={`ss-chip ${sk.cls}`}>{sk.text}</span>
            <span className={`ss-chip ${pc.cls}`}>{pc.text}</span>
            <span className="ss-chip ss-chip--neutral">
              Max pain ${signals.maxPain.toFixed(0)}
              {' '}({maxPainDiff >= 0 ? '+' : ''}{maxPainPct}%)
            </span>
            <span className="ss-chip ss-chip--neutral">
              {signals.dte}d DTE
            </span>
          </div>

          {/* Arbitrage alerts */}
          <ArbitrageAlerts arb={signals.arb} spotPrice={spotPrice} />

          {/* Strategy cards */}
          <div className="ss-grid">
            {visible.map((s) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                scored={s._score}
                onApply={handleApply}
                canApply={canApply}
              />
            ))}
          </div>

          {scored.length > 5 && (
            <button
              type="button"
              className="ss-show-more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show all ${scored.length} strategies`}
            </button>
          )}

          <p className="ss-disclaimer">
            Scores are based on IV level, volatility skew, put/call OI ratio, and max pain.
            Not financial advice — always validate with your own analysis before trading.
          </p>
        </>
      )}
    </div>
  )
}

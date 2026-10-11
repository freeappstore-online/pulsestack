import { dateRange, daysBetween, enabledBlocks, isWeekend, type DateKey } from '../lib/dates'
import type { BlockId, EnergyEntry, EnergyLevel, TimeBlock } from '../types'

// Rolling energy matrix (CLAUDE.md §5). Pure: `today` is always passed in.

export const MATRIX_DAYS = 14
export const HALF_LIFE_DAYS = 7
export const MIN_WEEKEND_SAMPLES = 4

export type Confidence = 'learning' | 'low' | 'ok'

export interface ScoreStat {
  score: number
  n: number
}

export interface BlockStats {
  block: BlockId
  /** Exponentially weighted mean level (half-life 7 days), null when n = 0. */
  score: number | null
  n: number
  /** Population SD of the raw levels, null when n < 2. */
  sd: number | null
  counts: Record<EnergyLevel, number>
  confidence: Confidence
  /** Present only when the block has ≥ 4 weekend samples (then both halves are computed). */
  split: { weekday: ScoreStat | null; weekend: ScoreStat } | null
}

export interface MatrixRow {
  date: DateKey
  cells: Partial<Record<BlockId, EnergyLevel | null>>
}

export interface EnergyMatrix {
  today: DateKey
  days: DateKey[]
  blocks: BlockId[]
  rows: MatrixRow[]
  stats: Partial<Record<BlockId, BlockStats>>
}

export function confidenceFor(n: number): Confidence {
  if (n < 4) return 'learning'
  if (n < 7) return 'low'
  return 'ok'
}

export function atLeastLow(c: Confidence | undefined): boolean {
  return c === 'low' || c === 'ok'
}

interface Sample {
  age: number
  level: EnergyLevel
  weekend: boolean
}

function ewMean(samples: Sample[]): number | null {
  if (samples.length === 0) return null
  let num = 0
  let den = 0
  for (const s of samples) {
    const w = Math.pow(0.5, s.age / HALF_LIFE_DAYS)
    num += w * s.level
    den += w
  }
  // Rounded so float noise (2.4999999…) can't flip a threshold comparison.
  return Math.round((num / den) * 1e6) / 1e6
}

function sd(levels: number[]): number | null {
  if (levels.length < 2) return null
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length
  return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length)
}

/** Latest entry per (date, block); entries after `today` are ignored. */
export function indexEnergy(energy: EnergyEntry[], today?: DateKey): Map<string, EnergyEntry> {
  const map = new Map<string, EnergyEntry>()
  for (const e of energy) {
    if (today && e.date > today) continue
    const k = `${e.date}|${e.block}`
    const prev = map.get(k)
    if (!prev || Date.parse(e.loggedAt) >= Date.parse(prev.loggedAt)) map.set(k, e)
  }
  return map
}

export function buildMatrix(energy: EnergyEntry[], blocks: TimeBlock[], today: DateKey, days = MATRIX_DAYS): EnergyMatrix {
  const blockIds = enabledBlocks(blocks).map((b) => b.id)
  const dates = dateRange(today, days)
  const index = indexEnergy(energy, today)

  const rows: MatrixRow[] = dates.map((date) => {
    const cells: MatrixRow['cells'] = {}
    for (const b of blockIds) cells[b] = index.get(`${date}|${b}`)?.level ?? null
    return { date, cells }
  })

  const stats: EnergyMatrix['stats'] = {}
  for (const b of blockIds) {
    const samples: Sample[] = []
    for (const row of rows) {
      const level = row.cells[b]
      if (level != null) samples.push({ age: daysBetween(row.date, today), level, weekend: isWeekend(row.date) })
    }
    const counts: Record<EnergyLevel, number> = { 1: 0, 2: 0, 3: 0 }
    for (const s of samples) counts[s.level]++
    const weekendSamples = samples.filter((s) => s.weekend)
    let split: BlockStats['split'] = null
    if (weekendSamples.length >= MIN_WEEKEND_SAMPLES) {
      const weekdaySamples = samples.filter((s) => !s.weekend)
      split = {
        weekend: { score: ewMean(weekendSamples)!, n: weekendSamples.length },
        weekday: weekdaySamples.length > 0 ? { score: ewMean(weekdaySamples)!, n: weekdaySamples.length } : null,
      }
    }
    stats[b] = {
      block: b,
      score: ewMean(samples),
      n: samples.length,
      sd: sd(samples.map((s) => s.level)),
      counts,
      confidence: confidenceFor(samples.length),
      split,
    }
  }

  return { today, days: dates, blocks: blockIds, rows, stats }
}

export interface EffectiveScore {
  score: number | null
  n: number
  basis: 'all' | 'weekday' | 'weekend'
}

/**
 * The score to use when planning for `target`. With a weekday/weekend split,
 * use the half matching the target day; a weekday half with fewer than 4
 * samples falls back to the overall score (decision.md D-013).
 */
export function effectiveScore(stats: BlockStats | undefined, target: DateKey): EffectiveScore {
  if (!stats) return { score: null, n: 0, basis: 'all' }
  if (stats.split) {
    if (isWeekend(target)) return { ...stats.split.weekend, basis: 'weekend' }
    const wd = stats.split.weekday
    if (wd && wd.n >= MIN_WEEKEND_SAMPLES) return { ...wd, basis: 'weekday' }
  }
  return { score: stats.score, n: stats.n, basis: 'all' }
}

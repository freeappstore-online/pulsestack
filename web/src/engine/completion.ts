import { addDaysToKey, type DateKey } from '../lib/dates'
import type { BlockId, CompletionEntry, EnergyEntry, EnergyLevel } from '../types'
import { indexEnergy } from './matrix'

// Completion by block and by energy (CLAUDE.md §5).

/** How far back completion history counts for recommendations (decision.md D-014). */
export const COMPLETION_WINDOW_DAYS = 28

export interface RateStat {
  done: number
  partial: number
  skipped: number
  attempts: number
  /** Beta(1,1)-smoothed: (done + 0.5·partial + 1) / (attempts + 2). */
  rate: number
}

export interface CompletionStats {
  byHabit: Record<string, RateStat>
  byHabitBlock: Record<string, Partial<Record<BlockId, RateStat>>>
  /** Keyed by the energy level logged in the same (date, block); unrated attempts are left out. */
  byHabitEnergy: Record<string, Partial<Record<EnergyLevel, RateStat>>>
}

export function emptyRate(): RateStat {
  return { done: 0, partial: 0, skipped: 0, attempts: 0, rate: 0.5 }
}

function add(stat: RateStat, status: CompletionEntry['status']): void {
  stat[status === 'done' ? 'done' : status === 'partial' ? 'partial' : 'skipped']++
  stat.attempts++
  stat.rate = (stat.done + 0.5 * stat.partial + 1) / (stat.attempts + 2)
}

/** Completions with `windowStart <= date <= today`. */
export function inWindow(completions: CompletionEntry[], today: DateKey, days: number): CompletionEntry[] {
  const start = addDaysToKey(today, -(days - 1))
  return completions.filter((c) => c.date >= start && c.date <= today)
}

export function completionStats(
  completions: CompletionEntry[],
  energy: EnergyEntry[],
  today: DateKey,
  windowDays = COMPLETION_WINDOW_DAYS,
): CompletionStats {
  const energyIndex = indexEnergy(energy, today)
  const out: CompletionStats = { byHabit: {}, byHabitBlock: {}, byHabitEnergy: {} }
  for (const c of inWindow(completions, today, windowDays)) {
    add((out.byHabit[c.habitId] ??= emptyRate()), c.status)
    const blocks = (out.byHabitBlock[c.habitId] ??= {})
    add((blocks[c.block] ??= emptyRate()), c.status)
    const level = energyIndex.get(`${c.date}|${c.block}`)?.level
    if (level) {
      const levels = (out.byHabitEnergy[c.habitId] ??= {})
      add((levels[level] ??= emptyRate()), c.status)
    }
  }
  return out
}

/** Unsmoothed share for display ("7 of 9"), null without attempts. */
export function rawRate(s: RateStat | undefined): number | null {
  if (!s || s.attempts === 0) return null
  return (s.done + 0.5 * s.partial) / s.attempts
}

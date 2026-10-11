// Test fixtures shared by the engine/storage test suites. Not imported by the app.
import { dateRange, type DateKey } from '../lib/dates'
import {
  DEFAULT_BLOCKS,
  defaultSettings,
  type AppData,
  type BlockId,
  type CompletionEntry,
  type CompletionStatus,
  type EnergyEntry,
  type EnergyLevel,
  type Habit,
} from '../types'

/** A Friday. */
export const TODAY: DateKey = '2026-10-09'

export const BLOCKS = DEFAULT_BLOCKS.map((b) => ({ ...b }))

export function energyDays(
  end: DateKey,
  days: number,
  fn: (date: DateKey, block: BlockId, i: number) => EnergyLevel | null,
  blocks: BlockId[] = BLOCKS.map((b) => b.id),
): EnergyEntry[] {
  const out: EnergyEntry[] = []
  dateRange(end, days).forEach((date, i) => {
    for (const block of blocks) {
      const level = fn(date, block, i)
      if (level) out.push({ date, block, level, loggedAt: `${date}T12:00:00.000Z` })
    }
  })
  return out
}

/** Morning high, afternoon low, everything else medium — a classic profile. */
export const classicProfile = (_d: DateKey, b: BlockId): EnergyLevel => (b === 'morning' ? 3 : b === 'afternoon' ? 1 : 2)

let seq = 0
export function habit(p: Partial<Habit> & { name: string }): Habit {
  return {
    id: p.id ?? `h${++seq}`,
    category: 'deep-focus',
    demand: 'high',
    targetPerWeek: 5,
    createdAt: '2026-01-01T09:00:00.000Z',
    ...p,
  }
}

export function completion(date: DateKey, habitId: string, block: BlockId, status: CompletionStatus = 'done'): CompletionEntry {
  return { date, habitId, block, status, loggedAt: `${date}T12:00:00.000Z` }
}

export function completionsOn(
  dates: DateKey[],
  habitId: string,
  block: BlockId,
  status: CompletionStatus = 'done',
): CompletionEntry[] {
  return dates.map((d) => completion(d, habitId, block, status))
}

export function appData(p: Partial<AppData> = {}): AppData {
  return {
    habits: [],
    energy: [],
    completions: [],
    feedback: [],
    settings: defaultSettings('2026-01-01T09:00:00.000Z'),
    ...p,
  }
}

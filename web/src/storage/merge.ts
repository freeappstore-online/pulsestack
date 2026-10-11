import type { AppData, CompletionEntry, EnergyEntry, Habit, RecFeedback } from '../types'

// Import = merge, never replace (CLAUDE.md §4). Rows are matched on their
// natural keys; on conflict the more recently written row wins, so importing an
// old backup over newer local data never rolls anything back (decision.md D-009).

export interface MergeCounts {
  added: number
  updated: number
  unchanged: number
}

export interface ImportReport {
  habits: MergeCounts
  energy: MergeCounts
  completions: MergeCounts
  feedback: MergeCounts
  /** Rows in the file that failed validation and were not imported. */
  rejected: number
  /** True when the local install was empty, so the file's settings were adopted. */
  settingsAdopted: boolean
}

export function mergeByKey<T>(
  current: T[],
  incoming: T[],
  key: (t: T) => string,
  isNewer: (incoming: T, existing: T) => boolean,
): { items: T[]; counts: MergeCounts } {
  const map = new Map<string, T>()
  for (const c of current) map.set(key(c), c)
  const counts: MergeCounts = { added: 0, updated: 0, unchanged: 0 }
  for (const inc of incoming) {
    const k = key(inc)
    const existing = map.get(k)
    if (existing === undefined) {
      map.set(k, inc)
      counts.added++
    } else if (isNewer(inc, existing)) {
      map.set(k, inc)
      counts.updated++
    } else {
      counts.unchanged++
    }
  }
  return { items: [...map.values()], counts }
}

export const energyKey = (e: EnergyEntry) => `${e.date}|${e.block}`
export const completionKey = (c: CompletionEntry) => `${c.date}|${c.habitId}`
const feedbackKey = (f: RecFeedback) => `${f.habitId}|${f.suggestedBlock}|${f.action}|${f.at}`
const habitStamp = (h: Habit) => h.updatedAt ?? h.archivedAt ?? h.createdAt

export function isEmptyInstall(d: AppData): boolean {
  return d.habits.length === 0 && d.energy.length === 0 && d.completions.length === 0
}

export function mergeData(current: AppData, incoming: AppData, rejected: number): { data: AppData; report: ImportReport } {
  const habits = mergeByKey(current.habits, incoming.habits, (h) => h.id, (a, b) => later(habitStamp(a), habitStamp(b)))
  const energy = mergeByKey(current.energy, incoming.energy, energyKey, (a, b) => later(a.loggedAt, b.loggedAt))
  const completions = mergeByKey(current.completions, incoming.completions, completionKey, (a, b) => later(a.loggedAt, b.loggedAt))
  const feedback = mergeByKey(current.feedback, incoming.feedback, feedbackKey, () => false)
  const settingsAdopted = isEmptyInstall(current)
  const settings = settingsAdopted
    ? { ...incoming.settings, firstUsedAt: earliest(current.settings.firstUsedAt, incoming.settings.firstUsedAt) }
    : current.settings
  return {
    data: { habits: habits.items, energy: energy.items, completions: completions.items, feedback: feedback.items, settings },
    report: {
      habits: habits.counts,
      energy: energy.counts,
      completions: completions.counts,
      feedback: feedback.counts,
      rejected,
      settingsAdopted,
    },
  }
}

// Compare as instants, not strings: imported files may carry other UTC offsets.
const later = (a: string, b: string) => Date.parse(a) > Date.parse(b)
const earliest = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b)

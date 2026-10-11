import { addDays, differenceInCalendarDays, format } from 'date-fns'
import type { BlockId, TimeBlock } from '../types'

// Local calendar dates as YYYY-MM-DD strings (CLAUDE.md §3).
// Never use toISOString() for dates: it is UTC, so a 23:30 log in New York
// (04:30 UTC) would land on tomorrow.
// Arithmetic goes through noon local time so DST shifts (±1h) can never push
// a date across midnight.

export type DateKey = string

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function toDateKey(d: Date): DateKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isDateKey(s: unknown): s is DateKey {
  if (typeof s !== 'string') return false
  const m = KEY_RE.exec(s)
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return toDateKey(d) === s
}

/** Noon local time on that date. */
export function fromDateKey(key: DateKey): Date {
  const m = KEY_RE.exec(key)
  if (!m) throw new Error(`Invalid date key: ${key}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
}

export function addDaysToKey(key: DateKey, n: number): DateKey {
  return toDateKey(addDays(fromDateKey(key), n))
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: DateKey, b: DateKey): number {
  return differenceInCalendarDays(fromDateKey(b), fromDateKey(a))
}

/** Oldest first, ending at `end` inclusive. */
export function dateRange(end: DateKey, days: number): DateKey[] {
  const out: DateKey[] = []
  for (let i = days - 1; i >= 0; i--) out.push(addDaysToKey(end, -i))
  return out
}

export function isWeekend(key: DateKey): boolean {
  const dow = fromDateKey(key).getDay()
  return dow === 0 || dow === 6
}

export function formatDayShort(key: DateKey): string {
  return format(fromDateKey(key), 'EEE d MMM')
}

export function enabledBlocks(blocks: TimeBlock[]): TimeBlock[] {
  return blocks.filter((b) => b.enabled).sort((a, b) => a.startHour - b.startHour)
}

/** The enabled block containing this hour, or null if the hour falls in a gap. */
export function blockForHour(hour: number, blocks: TimeBlock[]): BlockId | null {
  const b = enabledBlocks(blocks).find((x) => hour >= x.startHour && hour < x.endHour)
  return b ? b.id : null
}

/**
 * The (date, block) slot a log made at `now` belongs to.
 *
 * - Inside a block → that block, today.
 * - Before the first block of the day (e.g. 01:30 with blocks starting at 05:00)
 *   → the last block of the *previous* date: you are still in last night.
 * - In a gap between blocks → the most recent block that has started.
 * See decision.md D-010.
 */
export function slotAt(now: Date, blocks: TimeBlock[]): { date: DateKey; block: BlockId } | null {
  const list = enabledBlocks(blocks)
  if (list.length === 0) return null
  const hour = now.getHours()
  const today = toDateKey(now)
  const started = list.filter((b) => b.startHour <= hour)
  if (started.length === 0) {
    return { date: addDaysToKey(today, -1), block: list[list.length - 1].id }
  }
  return { date: today, block: started[started.length - 1].id }
}

export function blockLabel(id: BlockId, blocks: TimeBlock[]): string {
  return blocks.find((b) => b.id === id)?.label ?? id
}

export function formatHour(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00`
}

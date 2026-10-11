import type { AppData } from '../types'
import { daysBetween, toDateKey, type DateKey } from './dates'

export const EXPORT_REMINDER_DAYS = 30
export const FIRST_EXPORT_AFTER_DAYS = 14

/** Monthly backup nudge: first after 14 days of use, then 30 days after each export. */
export function exportDue(data: AppData, today: DateKey): boolean {
  if (data.energy.length === 0 && data.completions.length === 0) return false
  const { lastExportAt, firstUsedAt } = data.settings
  if (lastExportAt) return daysBetween(toDateKey(new Date(lastExportAt)), today) >= EXPORT_REMINDER_DAYS
  return daysBetween(toDateKey(new Date(firstUsedAt)), today) >= FIRST_EXPORT_AFTER_DAYS
}

export function exportFilename(today: DateKey): string {
  return `pulsestack-backup-${today}.json`
}

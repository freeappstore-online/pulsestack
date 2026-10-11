import { useEffect, useRef } from 'react'
import { blockLabel } from '../lib/dates'
import { showLocalNotification } from '../lib/platform'
import { useApp } from './appStore'
import type { ActiveSlot } from './useEngine'

/**
 * Best-effort check-in reminder (CLAUDE.md §7): while the app is open, when a
 * new block starts and it has no energy rating yet, show one local
 * notification. No background reminders: FAS has no push backend.
 */
export function useReminders(slot: ActiveSlot) {
  const enabled = useApp((s) => s.data.settings.remindersEnabled)
  const energy = useApp((s) => s.data.energy)
  const blocks = useApp((s) => s.data.settings.blocks)
  const lastNotified = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !slot.block) return
    const key = `${slot.day}|${slot.block}`
    if (lastNotified.current === null) {
      // Don't notify for the block the app was opened in; the in-app nudge covers that.
      lastNotified.current = key
      return
    }
    if (lastNotified.current === key) return
    lastNotified.current = key
    if (energy.some((e) => e.date === slot.day && e.block === slot.block)) return
    void showLocalNotification('PulseStack check-in', `${blockLabel(slot.block, blocks)} has started. How is your energy?`)
  }, [enabled, slot.day, slot.block, energy, blocks])
}

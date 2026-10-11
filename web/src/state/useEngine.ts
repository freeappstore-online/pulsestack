import { useEffect, useMemo, useState } from 'react'
import { classifyBlocks } from '../engine/classify'
import { completionStats } from '../engine/completion'
import { buildMatrix } from '../engine/matrix'
import { recommend } from '../engine/recommend'
import { slotAt, toDateKey, type DateKey } from '../lib/dates'
import type { BlockId } from '../types'
import { useApp } from './appStore'

/** The current time, refreshed every minute and when the tab becomes visible again. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, intervalMs)
    const onVis = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])
  return now
}

export interface ActiveSlot {
  /** The day being logged: yesterday between midnight and the first block (decision.md D-010). */
  day: DateKey
  block: BlockId | null
}

export function useActiveSlot(now: Date): ActiveSlot {
  const blocks = useApp((s) => s.data.settings.blocks)
  return useMemo(() => {
    const slot = slotAt(now, blocks)
    return slot ? { day: slot.date, block: slot.block } : { day: toDateKey(now), block: null }
    // Recompute when the minute changes enough to matter: hour or date.
  }, [blocks, now.getHours(), toDateKey(now)])
}

/** All engine outputs for `day`, memoised on the data. */
export function useEngine(day: DateKey) {
  const data = useApp((s) => s.data)
  return useMemo(() => {
    const matrix = buildMatrix(data.energy, data.settings.blocks, day)
    const classification = classifyBlocks(matrix, day)
    const stats = completionStats(data.completions, data.energy, day)
    const recs = recommend({
      habits: data.habits,
      completions: data.completions,
      feedback: data.feedback,
      matrix,
      classification,
      stats,
      capacityHighPerBlock: data.settings.capacityHighPerBlock,
      today: day,
    })
    return { matrix, classification, stats, ...recs }
  }, [data, day])
}

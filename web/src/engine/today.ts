import { addDaysToKey, enabledBlocks, fromDateKey, type DateKey } from '../lib/dates'
import { DEMAND_LEVEL, type BlockId, type CompletionEntry, type CompletionStatus, type Habit, type TimeBlock } from '../types'
import { effectiveScore, type EnergyMatrix } from './matrix'
import type { RecommendResult, AssignmentSource } from './recommend'

// Today ordering (CLAUDE.md §5).

export interface TodayItem {
  habit: Habit
  block: BlockId | null
  source: AssignmentSource | null
  /** Today's logged status, if any. */
  status: CompletionStatus | null
  /** done + 0.5·partial since Monday (inclusive of today). */
  thisWeek: number
}

export interface OrderTodayInput {
  habits: Habit[]
  assignments: RecommendResult['assignments']
  matrix: EnergyMatrix
  blocks: TimeBlock[]
  currentBlock: BlockId | null
  completions: CompletionEntry[]
  today: DateKey
}

export function weekStart(today: DateKey): DateKey {
  const dow = fromDateKey(today).getDay() // 0 = Sunday
  return addDaysToKey(today, -((dow + 6) % 7))
}

/**
 * 1. Not yet logged today before already-logged.
 * 2. Habits with a pinned/recommended block, in block order starting at the
 *    current block (current → later today → earlier, i.e. missed).
 * 3. Then unassigned habits, best demand-to-energy match for the current block
 *    first (decision.md D-015).
 */
export function orderToday(input: OrderTodayInput): TodayItem[] {
  const { habits, assignments, matrix, blocks, currentBlock, completions, today } = input
  const order = enabledBlocks(blocks).map((b) => b.id)
  const curIdx = currentBlock ? Math.max(0, order.indexOf(currentBlock)) : 0
  const blockRank = (b: BlockId) => {
    const i = order.indexOf(b)
    if (i < 0) return order.length * 2
    return i >= curIdx ? i - curIdx : order.length + i
  }
  const curScore = (currentBlock && effectiveScore(matrix.stats[currentBlock], today).score) ?? 2

  const monday = weekStart(today)
  const todayStatus = new Map<string, CompletionStatus>()
  const week = new Map<string, number>()
  for (const c of completions) {
    if (c.date === today) todayStatus.set(c.habitId, c.status)
    if (c.date >= monday && c.date <= today && c.status !== 'skipped') {
      week.set(c.habitId, (week.get(c.habitId) ?? 0) + (c.status === 'done' ? 1 : 0.5))
    }
  }

  const items: TodayItem[] = habits
    .filter((h) => !h.archivedAt)
    .map((h) => ({
      habit: h,
      block: assignments[h.id]?.block ?? null,
      source: assignments[h.id]?.source ?? null,
      status: todayStatus.get(h.id) ?? null,
      thisWeek: week.get(h.id) ?? 0,
    }))

  return items.sort((a, b) => {
    const loggedA = a.status ? 1 : 0
    const loggedB = b.status ? 1 : 0
    if (loggedA !== loggedB) return loggedA - loggedB
    if (a.block && !b.block) return -1
    if (!a.block && b.block) return 1
    if (a.block && b.block && a.block !== b.block) return blockRank(a.block) - blockRank(b.block)
    const fitA = Math.abs(DEMAND_LEVEL[a.habit.demand] - curScore)
    const fitB = Math.abs(DEMAND_LEVEL[b.habit.demand] - curScore)
    return fitA - fitB || a.habit.name.localeCompare(b.habit.name)
  })
}

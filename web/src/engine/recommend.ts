import { daysBetween, toDateKey, type DateKey } from '../lib/dates'
import type { BlockId, CompletionEntry, Demand, Habit, RecFeedback } from '../types'
import type { Classification } from './classify'
import { COMPLETION_WINDOW_DAYS, inWindow, type CompletionStats, type RateStat } from './completion'
import { atLeastLow, effectiveScore, type EnergyMatrix, type EffectiveScore } from './matrix'

// Greedy schedule recommendations (CLAUDE.md §5).

export const MIN_SCORE_GAP = 0.5
export const DISMISS_SUPPRESS_DAYS = 7
export const DISMISS_LIMIT = 3

export interface BlockEvidence extends EffectiveScore {
  block: BlockId
  /** Days in the 14-day window rated at all / High / Low in this block (all days, not just one half of a split). */
  days: number
  highDays: number
  lowDays: number
}

export type RecReason = 'high-demand-to-peak' | 'low-demand-to-trough' | 'out-of-trough'

export interface Recommendation {
  id: string
  habitId: string
  /** `move`: the habit has a usual block and should change; `place`: no history yet. */
  kind: 'move' | 'place'
  from?: BlockId
  to: BlockId
  reason: RecReason
  evidence: {
    to: BlockEvidence
    from?: BlockEvidence
    completionTo?: RateStat
    completionFrom?: RateStat
  }
}

export type AssignmentSource = 'pinned' | 'suggested' | 'usual'

export interface RecommendInput {
  habits: Habit[]
  completions: CompletionEntry[]
  feedback: RecFeedback[]
  matrix: EnergyMatrix
  classification: Classification
  stats: CompletionStats
  capacityHighPerBlock: number
  today: DateKey
}

export interface RecommendResult {
  recommendations: Recommendation[]
  /** Where each active habit belongs today, used by orderToday. */
  assignments: Record<string, { block: BlockId; source: AssignmentSource }>
}

const DEMAND_ORDER: Record<Demand, number> = { high: 0, medium: 1, low: 2 }

/** Most frequent block of the habit's done/partial completions in the window; ties → most recent. */
export function usualBlock(habitId: string, completions: CompletionEntry[], today: DateKey): BlockId | undefined {
  const counts = new Map<BlockId, { n: number; last: string }>()
  for (const c of inWindow(completions, today, COMPLETION_WINDOW_DAYS)) {
    if (c.habitId !== habitId || c.status === 'skipped') continue
    const cur = counts.get(c.block) ?? { n: 0, last: '' }
    cur.n++
    if (c.date > cur.last) cur.last = c.date
    counts.set(c.block, cur)
  }
  let best: BlockId | undefined
  let bestVal = { n: 0, last: '' }
  for (const [block, v] of counts) {
    if (v.n > bestVal.n || (v.n === bestVal.n && v.last > bestVal.last)) {
      best = block
      bestVal = v
    }
  }
  return best
}

/** The block the user has committed to: the latest accepted suggestion, else their usual block. */
export function plannedBlock(
  habit: Habit,
  feedback: RecFeedback[],
  completions: CompletionEntry[],
  today: DateKey,
): { block: BlockId; source: 'suggested' | 'usual' } | undefined {
  const accepted = feedback
    .filter((f) => f.habitId === habit.id && f.action === 'accepted')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  if (accepted) return { block: accepted.suggestedBlock, source: 'suggested' }
  const usual = usualBlock(habit.id, completions, today)
  return usual ? { block: usual, source: 'usual' } : undefined
}

/** Dismissed within 7 days, or dismissed 3+ times ever → do not suggest (habit, block). */
export function isSuppressed(habitId: string, block: BlockId, feedback: RecFeedback[], today: DateKey): boolean {
  const dismissals = feedback.filter((f) => f.habitId === habitId && f.suggestedBlock === block && f.action === 'dismissed')
  if (dismissals.length >= DISMISS_LIMIT) return true
  return dismissals.some((f) => daysBetween(toDateKey(new Date(f.at)), today) < DISMISS_SUPPRESS_DAYS)
}

function evidenceFor(matrix: EnergyMatrix, block: BlockId, today: DateKey): BlockEvidence {
  const stats = matrix.stats[block]
  return {
    block,
    ...effectiveScore(stats, today),
    days: stats?.n ?? 0,
    highDays: stats?.counts[3] ?? 0,
    lowDays: stats?.counts[1] ?? 0,
  }
}

export function recommend(input: RecommendInput): RecommendResult {
  const { habits, completions, feedback, matrix, classification, stats, capacityHighPerBlock, today } = input
  const active = habits.filter((h) => !h.archivedAt)
  const assignments: RecommendResult['assignments'] = {}
  const recommendations: Recommendation[] = []
  const highLoad = new Map<BlockId, number>()
  const bump = (b: BlockId, d: number) => highLoad.set(b, (highLoad.get(b) ?? 0) + d)
  const hasRoom = (b: BlockId) => (highLoad.get(b) ?? 0) < capacityHighPerBlock
  const score = (b: BlockId) => effectiveScore(matrix.stats[b], today).score ?? 0
  const eligible = (b: BlockId) => atLeastLow(matrix.stats[b]?.confidence)

  // Pinned habits never move, but their high-demand load still counts.
  for (const h of active) {
    if (!h.pinnedBlock) continue
    assignments[h.id] = { block: h.pinnedBlock, source: 'pinned' }
    if (h.demand === 'high') bump(h.pinnedBlock, 1)
  }

  const unpinned = active
    .filter((h) => !h.pinnedBlock)
    .sort((a, b) => DEMAND_ORDER[a.demand] - DEMAND_ORDER[b.demand] || a.createdAt.localeCompare(b.createdAt))

  for (const h of unpinned) {
    const planned = plannedBlock(h, feedback, completions, today)
    const wantsTrough = h.demand === 'low' || h.category === 'restorative'
    const isHigh = h.demand === 'high' && !wantsTrough
    const cls = (b: BlockId | undefined) => (b ? classification.byBlock[b] : undefined)
    const allowed = (b: BlockId) => !isSuppressed(h.id, b, feedback, today)

    let target: BlockId | undefined
    let reason: RecReason | undefined
    if (isHigh) {
      if (planned && cls(planned.block) === 'peak' && hasRoom(planned.block)) target = planned.block
      else target = classification.peaks.find((b) => hasRoom(b) && allowed(b))
      reason = 'high-demand-to-peak'
    } else if (wantsTrough) {
      if (planned && cls(planned.block) === 'trough') target = planned.block
      else target = [...classification.troughs].reverse().find(allowed) // lowest score first
      reason = 'low-demand-to-trough'
    } else if (planned && cls(planned.block) === 'trough') {
      // Medium demand: only worth moving when it currently sits in a trough.
      target = classification.ranked.map((r) => r.block).find((b) => cls(b) !== 'trough' && allowed(b))
      reason = 'out-of-trough'
    }

    const keepPlanned = () => {
      if (!planned) return
      assignments[h.id] = { block: planned.block, source: planned.source }
      if (isHigh) bump(planned.block, 1)
    }

    if (!target || !reason || (planned && target === planned.block)) {
      keepPlanned()
      continue
    }

    const toEv = evidenceFor(matrix, target, today)
    const habitBlocks = stats.byHabitBlock[h.id] ?? {}

    if (!planned) {
      // No history: a placement suggestion, still gated on the target's confidence.
      if (!eligible(target)) continue
      assignments[h.id] = { block: target, source: 'suggested' }
      if (isHigh) bump(target, 1)
      recommendations.push({ id: `${h.id}:${target}`, habitId: h.id, kind: 'place', to: target, reason, evidence: { to: toEv } })
      continue
    }

    // A move needs: both blocks confident, a real score gap in the right
    // direction, and no evidence the habit does worse in the new block.
    const from = planned.block
    const gap = wantsTrough ? score(from) - score(target) : score(target) - score(from)
    const cTo = habitBlocks[target]
    const cFrom = habitBlocks[from]
    const completionOk = !(cTo && cFrom && cTo.attempts > 0 && cFrom.attempts > 0) || cTo.rate >= cFrom.rate
    if (!eligible(from) || !eligible(target) || gap < MIN_SCORE_GAP || !completionOk) {
      keepPlanned()
      continue
    }

    assignments[h.id] = { block: target, source: 'suggested' }
    if (isHigh) bump(target, 1)
    recommendations.push({
      id: `${h.id}:${target}`,
      habitId: h.id,
      kind: 'move',
      from,
      to: target,
      reason,
      evidence: { to: toEv, from: evidenceFor(matrix, from, today), completionTo: cTo, completionFrom: cFrom },
    })
  }

  return { recommendations, assignments }
}

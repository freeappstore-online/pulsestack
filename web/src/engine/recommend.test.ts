import { describe, expect, it } from 'vitest'
import { addDaysToKey, dateRange } from '../lib/dates'
import type { BlockId, CompletionEntry, EnergyLevel, Habit, RecFeedback } from '../types'
import { classifyBlocks } from './classify'
import { completionStats } from './completion'
import { BLOCKS, TODAY, classicProfile, completionsOn, energyDays, habit } from './fixtures'
import { buildMatrix } from './matrix'
import { isSuppressed, plannedBlock, recommend } from './recommend'

function run(opts: {
  habits: Habit[]
  completions?: CompletionEntry[]
  feedback?: RecFeedback[]
  profile?: (d: string, b: BlockId, i: number) => EnergyLevel | null
  days?: number
  capacity?: number
}) {
  const energy = energyDays(TODAY, opts.days ?? 14, opts.profile ?? classicProfile)
  const matrix = buildMatrix(energy, BLOCKS, TODAY)
  const completions = opts.completions ?? []
  return recommend({
    habits: opts.habits,
    completions,
    feedback: opts.feedback ?? [],
    matrix,
    classification: classifyBlocks(matrix),
    stats: completionStats(completions, energy, TODAY),
    capacityHighPerBlock: opts.capacity ?? 2,
    today: TODAY,
  })
}

const last = (n: number) => dateRange(TODAY, n)
const at = (daysAgo: number) => `${addDaysToKey(TODAY, -daysAgo)}T10:00:00.000Z`

describe('recommend', () => {
  it('moves a high-demand habit from a neutral block to the peak, with evidence', () => {
    const study = habit({ id: 'study', name: 'Study' })
    const r = run({ habits: [study], completions: completionsOn(last(8), 'study', 'evening') })
    expect(r.recommendations).toHaveLength(1)
    const rec = r.recommendations[0]
    expect(rec).toMatchObject({ kind: 'move', habitId: 'study', from: 'evening', to: 'morning', reason: 'high-demand-to-peak' })
    // TODAY is a Friday and the window holds 4 weekend days, so the weekday half is used.
    expect(rec.evidence.to).toMatchObject({ block: 'morning', score: 3, n: 10, basis: 'weekday', days: 14, highDays: 14 })
    expect(rec.evidence.from).toMatchObject({ block: 'evening', score: 2 })
    expect(rec.evidence.completionFrom!.attempts).toBe(8)
    expect(r.assignments.study).toEqual({ block: 'morning', source: 'suggested' })
  })

  it('suggests nothing on day 1 (every block still learning)', () => {
    const r = run({ habits: [habit({ id: 'x', name: 'X' })], days: 2 })
    expect(r.recommendations).toEqual([])
  })

  it('requires a score gap of at least 0.5', () => {
    // Morning 2.4 vs evening 2.0 → gap 0.4, but morning is top-ranked (a peak).
    const profile = (_d: string, b: BlockId, i: number): EnergyLevel => (b === 'morning' ? (i % 5 < 2 ? 3 : 2) : b === 'afternoon' ? 1 : 2)
    const r = run({ habits: [habit({ id: 's', name: 'S' })], completions: completionsOn(last(8), 's', 'evening'), profile })
    expect(r.recommendations).toEqual([])
    expect(r.assignments.s).toEqual({ block: 'evening', source: 'usual' })
  })

  it('does not move when the source block is still learning', () => {
    const profile = (_d: string, b: BlockId, i: number): EnergyLevel | null => (b === 'evening' && i < 11 ? null : classicProfile(_d, b))
    const r = run({ habits: [habit({ id: 's', name: 'S' })], completions: completionsOn(last(8), 's', 'evening'), profile })
    expect(r.recommendations).toEqual([])
  })

  it('does not move when the habit completes worse in the target block', () => {
    const cs = [
      ...completionsOn(last(10).slice(0, 6), 's', 'evening', 'done'),
      ...completionsOn(last(10).slice(6), 's', 'morning', 'skipped'),
    ]
    const r = run({ habits: [habit({ id: 's', name: 'S' })], completions: cs })
    expect(r.recommendations).toEqual([])
  })

  it('respects per-block capacity for high-demand habits, counting pinned ones', () => {
    const pinned = habit({ id: 'p', name: 'Pinned', pinnedBlock: 'morning', createdAt: '2026-01-01T00:00:00Z' })
    const habits = [pinned, habit({ id: 'a', name: 'A', createdAt: '2026-01-02T00:00:00Z' }), habit({ id: 'b', name: 'B', createdAt: '2026-01-03T00:00:00Z' })]
    const cs = [...completionsOn(last(8), 'a', 'evening'), ...completionsOn(last(8), 'b', 'evening')]
    const r = run({ habits, completions: cs, capacity: 2 })
    expect(r.assignments.p).toEqual({ block: 'morning', source: 'pinned' })
    expect(r.recommendations.map((x) => x.habitId)).toEqual(['a']) // morning now full
    expect(r.assignments.b).toEqual({ block: 'evening', source: 'usual' })
  })

  it('never recommends moving a pinned habit', () => {
    const r = run({ habits: [habit({ id: 'p', name: 'P', pinnedBlock: 'evening' })], completions: completionsOn(last(8), 'p', 'evening') })
    expect(r.recommendations).toEqual([])
  })

  it('sends low-demand and restorative habits to troughs', () => {
    const habits = [
      habit({ id: 'admin', name: 'Inbox', demand: 'low', category: 'admin' }),
      habit({ id: 'walk', name: 'Walk', demand: 'medium', category: 'restorative' }),
    ]
    const cs = [...completionsOn(last(8), 'admin', 'morning'), ...completionsOn(last(8), 'walk', 'morning')]
    const r = run({ habits, completions: cs })
    expect(r.recommendations.map((x) => [x.habitId, x.from, x.to, x.reason])).toEqual([
      ['walk', 'morning', 'afternoon', 'low-demand-to-trough'],
      ['admin', 'morning', 'afternoon', 'low-demand-to-trough'],
    ])
  })

  it('moves a medium habit only when it sits in a trough', () => {
    const habits = [habit({ id: 'm', name: 'M', demand: 'medium', category: 'creative' })]
    expect(run({ habits, completions: completionsOn(last(8), 'm', 'evening') }).recommendations).toEqual([])
    const r = run({ habits, completions: completionsOn(last(8), 'm', 'afternoon') })
    expect(r.recommendations[0]).toMatchObject({ from: 'afternoon', to: 'morning', reason: 'out-of-trough' })
  })

  it('places a habit with no history, as a "place" suggestion', () => {
    const r = run({ habits: [habit({ id: 'new', name: 'New' })] })
    expect(r.recommendations[0]).toMatchObject({ kind: 'place', to: 'morning' })
    expect(r.recommendations[0].from).toBeUndefined()
  })

  it('an accepted suggestion becomes the plan: no repeat suggestion', () => {
    const fb: RecFeedback[] = [{ habitId: 's', suggestedBlock: 'morning', action: 'accepted', at: at(1) }]
    const r = run({ habits: [habit({ id: 's', name: 'S' })], completions: completionsOn(last(8), 's', 'evening'), feedback: fb })
    expect(r.recommendations).toEqual([])
    expect(r.assignments.s).toEqual({ block: 'morning', source: 'suggested' })
  })

  it('a dismissal suppresses the (habit, block) for 7 days', () => {
    const habits = [habit({ id: 's', name: 'S' })]
    const cs = completionsOn(last(8), 's', 'evening')
    const recent: RecFeedback[] = [{ habitId: 's', suggestedBlock: 'morning', action: 'dismissed', at: at(6) }]
    expect(run({ habits, completions: cs, feedback: recent }).recommendations).toEqual([])
    const old: RecFeedback[] = [{ habitId: 's', suggestedBlock: 'morning', action: 'dismissed', at: at(7) }]
    expect(run({ habits, completions: cs, feedback: old }).recommendations).toHaveLength(1)
  })

  it('three dismissals stop that suggestion for good', () => {
    const fb: RecFeedback[] = [30, 20, 10].map((d) => ({ habitId: 's', suggestedBlock: 'morning', action: 'dismissed', at: at(d) }))
    expect(isSuppressed('s', 'morning', fb, TODAY)).toBe(true)
    expect(isSuppressed('s', 'evening', fb, TODAY)).toBe(false)
    expect(isSuppressed('other', 'morning', fb, TODAY)).toBe(false)
  })

  it('plannedBlock prefers the latest accepted suggestion over usual block', () => {
    const h = habit({ id: 's', name: 'S' })
    const cs = completionsOn(last(5), 's', 'evening')
    expect(plannedBlock(h, [], cs, TODAY)).toEqual({ block: 'evening', source: 'usual' })
    const fb: RecFeedback[] = [
      { habitId: 's', suggestedBlock: 'midday', action: 'accepted', at: at(9) },
      { habitId: 's', suggestedBlock: 'morning', action: 'accepted', at: at(2) },
    ]
    expect(plannedBlock(h, fb, cs, TODAY)).toEqual({ block: 'morning', source: 'suggested' })
  })

  it('ignores archived habits', () => {
    const r = run({ habits: [habit({ id: 'z', name: 'Z', archivedAt: '2026-09-01T00:00:00Z' })] })
    expect(r.recommendations).toEqual([])
    expect(r.assignments.z).toBeUndefined()
  })
})

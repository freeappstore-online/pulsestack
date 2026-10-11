import { describe, expect, it } from 'vitest'
import { addDaysToKey, dateRange, daysBetween, isWeekend } from '../lib/dates'
import type { AppData, CompletionEntry } from '../types'
import { CAUSAL_WORDS, templateNarrative } from '../summary/templateNarrative'
import { BLOCKS, TODAY, appData, classicProfile, completion, energyDays, habit } from './fixtures'
import { computeFacts, firstActivityDate } from './summary'

const START = '2026-06-01'
const totalDays = daysBetween(START, TODAY) + 1 // 131

/**
 * ~4 months of use. First two weeks: Study in the evening on alternate days,
 * Read 2.5 times a week. Since then: Study in the (peak) morning on weekdays,
 * Read most days.
 */
function longHistory(): AppData {
  const study = habit({ id: 'study', name: 'Study', createdAt: `${START}T08:00:00.000Z` })
  const read = habit({ id: 'read', name: 'Read', demand: 'medium', category: 'learning', targetPerWeek: 5, createdAt: `${START}T08:00:00.000Z` })
  const completions: CompletionEntry[] = []
  dateRange(TODAY, totalDays).forEach((d, i) => {
    if (i < 14) {
      if (i % 2 === 0) completions.push(completion(d, 'study', 'evening'))
      if (i % 3 === 0) completions.push(completion(d, 'read', 'night')) // 5 sessions
    } else {
      if (!isWeekend(d)) completions.push(completion(d, 'study', 'morning'))
      if (i % 7 !== 3) completions.push(completion(d, 'read', 'night', i % 5 === 0 ? 'partial' : 'done'))
    }
  })
  return appData({ habits: [study, read], completions, energy: energyDays(TODAY, totalDays, classicProfile) })
}

describe('computeFacts', () => {
  const data = longHistory()
  const f = computeFacts(data, TODAY, 30)

  it('defines period, previous period and the first-14-days baseline', () => {
    expect(firstActivityDate(data)).toBe(START)
    expect(f.period).toEqual({ start: '2026-09-10', end: TODAY, days: 30 })
    expect(f.previous).toEqual({ start: '2026-08-11', end: '2026-09-09', days: 30 })
    expect(f.baseline).toEqual({ start: START, end: '2026-06-14', days: 14 })
  })

  it('completion rate is target-based, capped per habit, with deltas in points', () => {
    expect(f.completion.rate.value).not.toBeNull()
    expect(f.completion.rate.value!).toBeGreaterThan(f.completion.baselineRate.value!)
    expect(f.completion.rate.value!).toBeLessThanOrEqual(100)
    expect(f.completion.deltaVsBaselinePts).toBeCloseTo(f.completion.rate.value! - f.completion.baselineRate.value!, 5)
  })

  it('reports learning sessions per week vs the first two weeks', () => {
    const learning = f.categories.find((c) => c.category === 'learning')!
    expect(learning.baselinePerWeek.value).toBe(2.5)
    expect(learning.perWeek.value!).toBeGreaterThan(5)
    expect(learning.changeVsBaselinePct!).toBeGreaterThan(100)
  })

  it('alignment: share of high-demand sessions in peak blocks, then vs now', () => {
    expect(f.alignment.current.value).toBe(100)
    // Baseline sessions happened before any block was confident (or in the evening): 0%.
    expect(f.alignment.baseline.value ?? 0).toBe(0)
  })

  it('energy profile: best and worst block', () => {
    expect(f.energy.best!.block).toBe('morning')
    expect(f.energy.worst!.block).toBe('afternoon')
    expect(f.energy.daysLogged).toBe(30)
  })

  it('consistency and streaks', () => {
    expect(f.consistency.activeDays).toBeGreaterThanOrEqual(27)
    expect(f.consistency.longestStreak).toBeGreaterThanOrEqual(6)
    expect(f.consistency.currentStreak).toBeGreaterThanOrEqual(1)
  })

  it('90-day period works too', () => {
    const f90 = computeFacts(data, TODAY, 90)
    expect(f90.period.start).toBe(addDaysToKey(TODAY, -89))
    expect(f90.baseline).not.toBeNull()
  })

  it('suppresses statistics with fewer than 5 events', () => {
    const sparse = appData({
      habits: [habit({ id: 'a', name: 'A', createdAt: '2026-10-01T08:00:00Z' })],
      completions: [completion(TODAY, 'a', 'morning'), completion(addDaysToKey(TODAY, -1), 'a', 'morning')],
    })
    const s = computeFacts(sparse, TODAY, 30)
    expect(s.completion.rate).toEqual({ value: null, n: 2 })
    expect(s.consistency.rate.value).toBeNull()
    expect(s.alignment.current.value).toBeNull()
  })

  it('no baseline when the first two weeks overlap the period', () => {
    const young = appData({ energy: energyDays(TODAY, 20, classicProfile) })
    expect(computeFacts(young, TODAY, 30).baseline).toBeNull()
  })

  it('empty data does not throw', () => {
    const e = computeFacts(appData(), TODAY, 90)
    expect(e.baseline).toBeNull()
    expect(e.completion.rate.value).toBeNull()
    expect(e.energy.best).toBeNull()
  })

  it('compares sessions/week before vs after an accepted move', () => {
    const d = longHistory()
    d.feedback = [{ habitId: 'study', suggestedBlock: 'morning', action: 'accepted', at: `${addDaysToKey(TODAY, -20)}T10:00:00.000Z` }]
    const r = computeFacts(d, TODAY, 30).recs
    expect(r).toMatchObject({ accepted: 1, dismissed: 0, moves: 1 })
    expect(r.after.value).not.toBeNull()
  })
})

/** Every number a narrative sentence uses must exist in the facts (CLAUDE.md §8 contract). */
function numbersIn(x: unknown, out = new Set<number>()): Set<number> {
  if (typeof x === 'number') {
    out.add(Math.abs(x))
    out.add(Math.round(Math.abs(x) * 10) / 10)
  } else if (Array.isArray(x)) x.forEach((v) => numbersIn(v, out))
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => numbersIn(v, out))
  return out
}

describe('templateNarrative', () => {
  const facts = computeFacts(longHistory(), TODAY, 30)
  const n = templateNarrative(facts, BLOCKS)

  it('picks 3–5 sentences, most notable first', () => {
    expect(n.insufficient).toBe(false)
    expect(n.sentences.length).toBeGreaterThanOrEqual(3)
    expect(n.sentences.length).toBeLessThanOrEqual(5)
    expect(n.sentences.map((s) => s.key)).toContain('category-learning')
  })

  it('never uses causal language', () => {
    for (const s of n.sentences) expect(s.text).not.toMatch(CAUSAL_WORDS)
    expect('PulseStack boosted your learning').toMatch(CAUSAL_WORDS)
  })

  it('states the period and sample size next to every claim', () => {
    for (const s of n.sentences) {
      expect(s.basis).toMatch(/^Last 30 days \(/)
      expect(s.basis).toMatch(/\d+ (logged check-off|session|high-demand session|rating|check-off)s?/)
    }
  })

  it('uses only numbers present in the facts', () => {
    const allowed = numbersIn(facts)
    allowed.add(3) // "average x of 3"
    for (const s of n.sentences) {
      for (const m of s.text.match(/\d+(\.\d+)?/g) ?? []) expect(allowed, `${m} in "${s.text}"`).toContain(Number(m))
    }
  })

  it('says nothing when there is not enough data', () => {
    const empty = templateNarrative(computeFacts(appData(), TODAY, 30), BLOCKS)
    expect(empty).toEqual({ sentences: [], insufficient: true })
  })
})

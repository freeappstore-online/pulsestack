import { describe, expect, it } from 'vitest'
import { BLOCKS, TODAY, classicProfile, energyDays } from './fixtures'
import { buildMatrix, confidenceFor, effectiveScore } from './matrix'
import { addDaysToKey } from '../lib/dates'

describe('buildMatrix', () => {
  it('empty data: 14 rows of nulls, every block still learning', () => {
    const m = buildMatrix([], BLOCKS, TODAY)
    expect(m.days).toHaveLength(14)
    expect(m.days[13]).toBe(TODAY)
    expect(m.rows.every((r) => Object.values(r.cells).every((c) => c === null))).toBe(true)
    for (const b of m.blocks) {
      expect(m.stats[b]).toMatchObject({ score: null, n: 0, sd: null, confidence: 'learning', split: null })
    }
  })

  it('sparse data (2 samples) stays in learning', () => {
    const energy = energyDays(TODAY, 2, () => 3, ['morning'])
    const s = buildMatrix(energy, BLOCKS, TODAY).stats.morning!
    expect(s.n).toBe(2)
    expect(s.confidence).toBe('learning')
    expect(s.score).toBe(3)
  })

  it('confidence bands: <4 learning, 4–6 low, ≥7 ok', () => {
    expect([3, 4, 6, 7].map(confidenceFor)).toEqual(['learning', 'low', 'low', 'ok'])
  })

  it('full 14 days of a constant profile', () => {
    const m = buildMatrix(energyDays(TODAY, 14, classicProfile), BLOCKS, TODAY)
    expect(m.stats.morning).toMatchObject({ score: 3, n: 14, sd: 0, confidence: 'ok' })
    expect(m.stats.afternoon!.score).toBe(1)
    expect(m.stats.morning!.counts).toEqual({ 1: 0, 2: 0, 3: 14 })
  })

  it('weights recent days more (half-life 7 days)', () => {
    // Last 7 days High, the 7 before Low: plain mean 2, weighted mean higher.
    const energy = energyDays(TODAY, 14, (_d, _b, i) => (i >= 7 ? 3 : 1), ['morning'])
    const s = buildMatrix(energy, BLOCKS, TODAY).stats.morning!
    expect(s.score!).toBeGreaterThan(2.3)
    expect(s.sd).toBe(1)
  })

  it('a sample exactly one half-life old counts half', () => {
    const energy = [
      { date: TODAY, block: 'morning' as const, level: 3 as const, loggedAt: '2026-10-09T10:00:00Z' },
      { date: addDaysToKey(TODAY, -7), block: 'morning' as const, level: 1 as const, loggedAt: '2026-10-02T10:00:00Z' },
    ]
    // (1·3 + 0.5·1) / 1.5
    expect(buildMatrix(energy, BLOCKS, TODAY).stats.morning!.score).toBeCloseTo(3.5 / 1.5, 5)
  })

  it('ignores entries outside the window and in the future', () => {
    const energy = [
      ...energyDays(addDaysToKey(TODAY, -20), 3, () => 1, ['morning']),
      ...energyDays(addDaysToKey(TODAY, 3), 3, () => 1, ['morning']),
    ]
    expect(buildMatrix(energy, BLOCKS, TODAY).stats.morning!.n).toBe(0)
  })

  it('re-logging the same (date, block) keeps the latest entry', () => {
    const energy = [
      { date: TODAY, block: 'morning' as const, level: 1 as const, loggedAt: '2026-10-09T09:00:00Z' },
      { date: TODAY, block: 'morning' as const, level: 3 as const, loggedAt: '2026-10-09T09:05:00Z' },
    ]
    const m = buildMatrix(energy, BLOCKS, TODAY)
    expect(m.rows[13].cells.morning).toBe(3)
    expect(m.stats.morning!.n).toBe(1)
  })

  it('leaves out disabled blocks', () => {
    const blocks = BLOCKS.map((b) => (b.id === 'early' ? { ...b, enabled: false } : b))
    const m = buildMatrix([], blocks, TODAY)
    expect(m.blocks).not.toContain('early')
    expect(m.stats.early).toBeUndefined()
  })

  it('splits weekday/weekend once a block has 4 weekend samples', () => {
    // 14 days ending Fri 9 Oct contain 4 weekend days (26/27 Sep, 3/4 Oct).
    const energy = energyDays(TODAY, 14, (d) => (['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04'].includes(d) ? 1 : 3), [
      'morning',
    ])
    const s = buildMatrix(energy, BLOCKS, TODAY).stats.morning!
    expect(s.split).not.toBeNull()
    expect(s.split!.weekend).toEqual({ score: 1, n: 4 })
    expect(s.split!.weekday!.score).toBe(3)
    expect(effectiveScore(s, '2026-10-10')).toEqual({ score: 1, n: 4, basis: 'weekend' })
    expect(effectiveScore(s, TODAY)).toEqual({ score: 3, n: 10, basis: 'weekday' })
  })

  it('no split with only 3 weekend samples', () => {
    const energy = energyDays(TODAY, 14, (d) => (d === '2026-10-04' ? null : 2), ['morning'])
    const s = buildMatrix(energy, BLOCKS, TODAY).stats.morning!
    expect(s.split).toBeNull()
    expect(effectiveScore(s, '2026-10-10').basis).toBe('all')
  })

  it('handles a window crossing the DST change', () => {
    const today = '2026-11-05'
    const m = buildMatrix(energyDays(today, 14, () => 2), BLOCKS, today)
    expect(m.days).toContain('2026-11-01')
    expect(new Set(m.days).size).toBe(14)
    expect(m.stats.morning!.n).toBe(14)
  })
})

import { describe, expect, it } from 'vitest'
import { addDaysToKey, dateRange } from '../lib/dates'
import { completionStats, rawRate } from './completion'
import { TODAY, completion, energyDays } from './fixtures'

describe('completionStats', () => {
  it('smooths with a Beta(1,1) prior', () => {
    const cs = [
      completion(TODAY, 'a', 'morning', 'done'),
      completion(addDaysToKey(TODAY, -1), 'a', 'morning', 'partial'),
      completion(addDaysToKey(TODAY, -2), 'a', 'morning', 'skipped'),
    ]
    const s = completionStats(cs, [], TODAY).byHabitBlock.a.morning!
    expect(s).toMatchObject({ done: 1, partial: 1, skipped: 1, attempts: 3 })
    expect(s.rate).toBeCloseTo((1 + 0.5 + 1) / (3 + 2), 10)
    expect(rawRate(s)).toBeCloseTo(0.5, 10)
  })

  it('no data → no stats (and the prior alone would be 0.5)', () => {
    const s = completionStats([], [], TODAY)
    expect(s.byHabit).toEqual({})
    expect(rawRate(undefined)).toBeNull()
  })

  it('splits by the energy logged in the same (date, block)', () => {
    const days = dateRange(TODAY, 6)
    const energy = energyDays(TODAY, 6, (_d, _b, i) => (i < 3 ? 1 : 3), ['evening'])
    const cs = days.map((d, i) => completion(d, 'a', 'evening', i < 3 ? 'skipped' : 'done'))
    cs.push(completion(TODAY, 'b', 'night', 'done')) // no energy logged for night → unrated
    const s = completionStats(cs, energy, TODAY)
    expect(s.byHabitEnergy.a[1]).toMatchObject({ done: 0, skipped: 3 })
    expect(s.byHabitEnergy.a[3]).toMatchObject({ done: 3, skipped: 0 })
    expect(s.byHabitEnergy.b).toBeUndefined()
    expect(s.byHabit.b.attempts).toBe(1)
  })

  it('only counts the last 28 days by default', () => {
    const cs = [completion(addDaysToKey(TODAY, -27), 'a', 'morning'), completion(addDaysToKey(TODAY, -28), 'a', 'morning')]
    expect(completionStats(cs, [], TODAY).byHabit.a.attempts).toBe(1)
  })
})

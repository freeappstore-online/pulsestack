import { describe, expect, it } from 'vitest'
import { BLOCKS, TODAY, classicProfile, energyDays } from './fixtures'
import { classifyBlocks } from './classify'
import { buildMatrix } from './matrix'
import type { BlockId, EnergyLevel } from '../types'

const classify = (fn: (d: string, b: BlockId, i: number) => EnergyLevel | null, days = 14) =>
  classifyBlocks(buildMatrix(energyDays(TODAY, days, fn), BLOCKS, TODAY))

describe('classifyBlocks', () => {
  it('everything is learning with no data', () => {
    const c = classifyBlocks(buildMatrix([], BLOCKS, TODAY))
    expect(c.peaks).toEqual([])
    expect(c.troughs).toEqual([])
    expect(Object.values(c.byBlock).every((x) => x === 'learning')).toBe(true)
  })

  it('classic profile: morning peak, afternoon trough, rest neutral', () => {
    const c = classify(classicProfile)
    expect(c.peaks).toEqual(['morning'])
    expect(c.troughs).toEqual(['afternoon'])
    expect(c.byBlock.evening).toBe('neutral')
  })

  it('a flat profile has no peak or trough', () => {
    const c = classify(() => 2)
    expect(c.peaks).toEqual([])
    expect(c.troughs).toEqual([])
  })

  it('rank fills in a peak and trough when nothing crosses a threshold', () => {
    const c = classify((_d, b) => (b === 'midday' ? 3 : b === 'night' ? 1 : 2), 14)
    expect(c.peaks).toContain('midday')
    expect(c.troughs).toContain('night')
    const mild = classify((_d, b, i) => (b === 'midday' && i % 2 === 0 ? 3 : 2))
    expect(mild.peaks).toEqual(['midday'])
    expect(mild.byBlock.midday).toBe('peak')
    // The other five blocks tie at 2.0, so none is singled out as a trough.
    expect(mild.troughs).toEqual([])
  })

  it('blocks below confidence low are excluded (3 samples)', () => {
    const c = classify((_d, b) => (b === 'morning' ? 3 : null), 3)
    expect(c.byBlock.morning).toBe('learning')
    expect(c.peaks).toEqual([])
  })

  it('ties on score are broken by more samples', () => {
    // morning: 7×High; evening: 5×High → both 3.0; morning ranks first.
    const c = classify((_d, b, i) => (b === 'morning' && i >= 7 ? 3 : b === 'evening' && i >= 9 ? 3 : b === 'night' && i >= 7 ? 1 : null))
    expect(c.ranked[0].block).toBe('morning')
    expect(c.ranked[1].block).toBe('evening')
  })
})

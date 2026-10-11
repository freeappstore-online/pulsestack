import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCKS } from '../types'
import { addDaysToKey, blockForHour, dateRange, daysBetween, isDateKey, isWeekend, slotAt, toDateKey } from './dates'

// vitest.config.ts pins TZ=America/New_York (DST on 8 Mar and 1 Nov 2026).

describe('local date keys', () => {
  it('runs in a DST zone (guards the config)', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(240)
  })

  it('keys a 23:30 log on the local date, not the UTC date', () => {
    const lateNight = new Date(2026, 9, 6, 23, 30) // 03:30 UTC on 7 Oct
    expect(lateNight.toISOString().slice(0, 10)).toBe('2026-10-07')
    expect(toDateKey(lateNight)).toBe('2026-10-06')
  })

  it('adds days across the spring-forward and fall-back DST changes', () => {
    expect(addDaysToKey('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToKey('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDaysToKey('2026-03-09', -2)).toBe('2026-03-07')
  })

  it('counts calendar days across DST as whole days', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2)
  })

  it('builds ranges oldest first and crosses month/year ends', () => {
    expect(dateRange('2027-01-02', 4)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('validates keys strictly', () => {
    expect(isDateKey('2026-10-09')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('2026-2-3')).toBe(false)
    expect(isDateKey(20261009)).toBe(false)
  })

  it('knows weekends', () => {
    expect(isWeekend('2026-10-10')).toBe(true) // Saturday
    expect(isWeekend('2026-10-11')).toBe(true) // Sunday
    expect(isWeekend('2026-10-09')).toBe(false) // Friday
  })
})

describe('blocks and slots', () => {
  it('finds the block for an hour', () => {
    expect(blockForHour(9, DEFAULT_BLOCKS)).toBe('morning')
    expect(blockForHour(23, DEFAULT_BLOCKS)).toBe('night')
    expect(blockForHour(3, DEFAULT_BLOCKS)).toBeNull()
  })

  it('maps 01:30 to last night of the previous date', () => {
    expect(slotAt(new Date(2026, 9, 7, 1, 30), DEFAULT_BLOCKS)).toEqual({ date: '2026-10-06', block: 'night' })
  })

  it('maps a time inside a block to that block today', () => {
    expect(slotAt(new Date(2026, 9, 7, 15, 0), DEFAULT_BLOCKS)).toEqual({ date: '2026-10-07', block: 'afternoon' })
  })

  it('maps a gap to the most recent block that started', () => {
    const blocks = DEFAULT_BLOCKS.map((b) => (b.id === 'midday' ? { ...b, enabled: false } : b))
    expect(slotAt(new Date(2026, 9, 7, 12, 0), blocks)).toEqual({ date: '2026-10-07', block: 'morning' })
  })

  it('returns null when every block is disabled', () => {
    expect(slotAt(new Date(), DEFAULT_BLOCKS.map((b) => ({ ...b, enabled: false })))).toBeNull()
  })
})

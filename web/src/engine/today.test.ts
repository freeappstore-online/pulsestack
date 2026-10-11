import { describe, expect, it } from 'vitest'
import { BLOCKS, TODAY, classicProfile, completion, energyDays, habit } from './fixtures'
import { buildMatrix } from './matrix'
import { orderToday, weekStart } from './today'

const matrix = buildMatrix(energyDays(TODAY, 14, classicProfile), BLOCKS, TODAY)

describe('orderToday', () => {
  const habits = [
    habit({ id: 'deep', name: 'Deep work' }),
    habit({ id: 'read', name: 'Read', demand: 'low', category: 'learning' }),
    habit({ id: 'gym', name: 'Gym', demand: 'medium', category: 'physical' }),
    habit({ id: 'eve', name: 'Journal', demand: 'low', category: 'restorative' }),
    habit({ id: 'mid', name: 'Calls', demand: 'medium', category: 'social' }),
  ]
  const assignments = {
    deep: { block: 'morning' as const, source: 'suggested' as const },
    eve: { block: 'evening' as const, source: 'pinned' as const },
    mid: { block: 'midday' as const, source: 'usual' as const },
  }

  it('assigned habits first, from the current block onward, then by demand fit', () => {
    const items = orderToday({ habits, assignments, matrix, blocks: BLOCKS, currentBlock: 'midday', completions: [], today: TODAY })
    // midday (current) → evening (later) → morning (earlier) → unassigned.
    // Midday score is 2, so the medium-demand Gym fits better than low-demand Read.
    expect(items.map((i) => i.habit.id)).toEqual(['mid', 'eve', 'deep', 'gym', 'read'])
  })

  it('already-logged habits sink to the bottom', () => {
    const cs = [completion(TODAY, 'mid', 'midday', 'done')]
    const items = orderToday({ habits, assignments, matrix, blocks: BLOCKS, currentBlock: 'midday', completions: cs, today: TODAY })
    expect(items[items.length - 1]).toMatchObject({ habit: { id: 'mid' }, status: 'done' })
  })

  it('counts this week from Monday (done = 1, partial = ½, skipped = 0)', () => {
    expect(weekStart(TODAY)).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday belongs to the week before
    const cs = [
      completion('2026-10-04', 'gym', 'evening'), // previous week
      completion('2026-10-05', 'gym', 'evening'),
      completion('2026-10-06', 'gym', 'evening', 'partial'),
      completion('2026-10-07', 'gym', 'evening', 'skipped'),
    ]
    const items = orderToday({ habits, assignments: {}, matrix, blocks: BLOCKS, currentBlock: 'morning', completions: cs, today: TODAY })
    expect(items.find((i) => i.habit.id === 'gym')!.thisWeek).toBe(1.5)
  })

  it('excludes archived habits', () => {
    const items = orderToday({
      habits: [habit({ id: 'old', name: 'Old', archivedAt: '2026-01-02T00:00:00Z' })],
      assignments: {},
      matrix,
      blocks: BLOCKS,
      currentBlock: null,
      completions: [],
      today: TODAY,
    })
    expect(items).toEqual([])
  })
})

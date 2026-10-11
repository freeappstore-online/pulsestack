import { describe, expect, it } from 'vitest'
import { addDaysToKey } from '../lib/dates'
import { TODAY, appData, completion, energyDays, habit } from '../engine/fixtures'
import { KEY_PREFIX, StorageError, createMemoryStorage, createStore } from './store'
import { SCHEMA_VERSION } from './schema'

const NOW = '2026-10-09T12:00:00.000Z'

function fresh() {
  const storage = createMemoryStorage()
  return { storage, store: createStore(storage, 'localStorage') }
}

describe('Store: load/save', () => {
  it('first launch returns defaults and writes schemaVersion', () => {
    const { storage, store } = fresh()
    const r = store.load(TODAY, NOW)
    expect(r.firstLaunch).toBe(true)
    expect(r.data.habits).toEqual([])
    expect(r.data.settings.blocks).toHaveLength(6)
    expect(JSON.parse(storage.getItem(`${KEY_PREFIX}meta`)!)).toEqual({ schemaVersion: SCHEMA_VERSION })
  })

  it('round-trips data under pulsestack:v1: keys', () => {
    const { storage, store } = fresh()
    store.load(TODAY, NOW)
    const h = habit({ id: 'a', name: 'A' })
    store.save({ habits: [h], energy: energyDays(TODAY, 3, () => 2, ['morning']) })
    expect(storage.getItem(`${KEY_PREFIX}habits`)).toContain('"A"')
    const r = store.load(TODAY, NOW)
    expect(r.firstLaunch).toBe(false)
    expect(r.data.habits).toEqual([h])
    expect(r.data.energy).toHaveLength(3)
  })

  it('prunes raw logs older than 400 days on load', () => {
    const { store } = fresh()
    store.load(TODAY, NOW)
    store.save({ completions: [completion(addDaysToKey(TODAY, -401), 'a', 'morning'), completion(addDaysToKey(TODAY, -400), 'a', 'morning')] })
    const r = store.load(TODAY, NOW)
    expect(r.pruned).toBe(1)
    expect(r.data.completions).toHaveLength(1)
  })

  it('backs up corrupt JSON instead of discarding it', () => {
    const { storage, store } = fresh()
    storage.setItem(`${KEY_PREFIX}energy`, '{not json')
    const r = store.load(TODAY, NOW)
    expect(r.corruptKeys).toEqual(['energy'])
    expect(r.data.energy).toEqual([])
    expect(storage.getItem(`${KEY_PREFIX}backup:energy:${NOW}`)).toBe('{not json')
  })

  it('counts invalid rows, backs them up once, and keeps the valid ones', () => {
    const { storage, store } = fresh()
    storage.setItem(`${KEY_PREFIX}energy`, JSON.stringify([...energyDays(TODAY, 2, () => 3, ['morning']), { date: 'nope', level: 9 }]))
    const r = store.load(TODAY, NOW)
    expect(r.rejected).toBe(1)
    expect(r.data.energy).toHaveLength(2)
    const backups = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((k) => k.includes('backup:'))
    expect(backups()).toHaveLength(1)
    store.load(TODAY, '2026-10-09T13:00:00.000Z')
    expect(backups()).toHaveLength(1) // cleaned on first load, not re-backed-up
  })

  it('opens data from a newer schema read-only', () => {
    const { storage, store } = fresh()
    storage.setItem(`${KEY_PREFIX}meta`, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }))
    storage.setItem(`${KEY_PREFIX}habits`, '[]')
    const r = store.load(TODAY, NOW)
    expect(r.readOnly).toBe(true)
    expect(() => store.save({ habits: [] })).toThrow(StorageError)
  })

  it('maps quota errors to a clear StorageError', () => {
    const storage = createMemoryStorage()
    const store = createStore(
      {
        ...storage,
        getItem: storage.getItem,
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
      } as Storage,
      'localStorage',
    )
    try {
      store.save({ habits: [] })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError)
      expect((e as StorageError).kind).toBe('quota')
    }
  })

  it('wipe removes every pulsestack key and nothing else', () => {
    const { storage, store } = fresh()
    store.load(TODAY, NOW)
    storage.setItem('stores-theme', 'dark')
    store.wipe()
    expect(storage.length).toBe(1)
    expect(storage.getItem('stores-theme')).toBe('dark')
  })
})

describe('Store: export/import', () => {
  it('export → import into an empty install restores everything, settings included', () => {
    const a = fresh()
    const loaded = a.store.load(TODAY, NOW).data
    const data = { ...loaded, habits: [habit({ id: 'a', name: 'A' })], energy: energyDays(TODAY, 3, () => 2), settings: { ...loaded.settings, capacityHighPerBlock: 3 } }
    const json = a.store.exportJSON(data, NOW)
    expect(JSON.parse(json)).toMatchObject({ app: 'pulsestack', schemaVersion: SCHEMA_VERSION, exportedAt: NOW })

    const b = fresh()
    const empty = b.store.load(TODAY, NOW).data
    const { data: merged, report } = b.store.importJSON(empty, json)
    expect(merged.habits).toHaveLength(1)
    expect(merged.energy).toHaveLength(18)
    expect(merged.settings.capacityHighPerBlock).toBe(3)
    expect(report).toMatchObject({ settingsAdopted: true, rejected: 0, energy: { added: 18, updated: 0, unchanged: 0 } })
    expect(b.store.load(TODAY, NOW).data.energy).toHaveLength(18) // persisted
  })

  it('merges by (date, block) / (date, habitId); the newer log wins, an old backup never rolls back', () => {
    const { store } = fresh()
    const base = store.load(TODAY, NOW).data
    const current = {
      ...base,
      habits: [habit({ id: 'a', name: 'A' })],
      energy: [{ date: TODAY, block: 'morning' as const, level: 3 as const, loggedAt: '2026-10-09T10:00:00Z' }],
      completions: [completion(TODAY, 'a', 'morning', 'done')],
    }
    const oldBackup = {
      ...base,
      energy: [
        { date: TODAY, block: 'morning' as const, level: 1 as const, loggedAt: '2026-10-09T08:00:00Z' }, // older
        { date: TODAY, block: 'evening' as const, level: 2 as const, loggedAt: '2026-10-09T08:00:00Z' }, // new key
      ],
      completions: [{ ...completion(TODAY, 'a', 'morning', 'skipped'), loggedAt: '2026-10-09T13:00:00Z' }], // newer
    }
    const { data, report } = store.importJSON(current, store.exportJSON(oldBackup, NOW))
    expect(data.energy.find((e) => e.block === 'morning')!.level).toBe(3)
    expect(data.energy).toHaveLength(2)
    expect(data.completions[0].status).toBe('skipped')
    expect(report.energy).toEqual({ added: 1, updated: 0, unchanged: 1 })
    expect(report.completions).toEqual({ added: 0, updated: 1, unchanged: 0 })
    expect(report.settingsAdopted).toBe(false)
  })

  it('reports invalid rows instead of dropping them silently', () => {
    const { store } = fresh()
    const base = store.load(TODAY, NOW).data
    const file = JSON.stringify({
      app: 'pulsestack',
      schemaVersion: 1,
      exportedAt: NOW,
      data: { ...appData(), energy: [{ date: TODAY, block: 'morning', level: 2, loggedAt: NOW }, { date: TODAY, block: 'lunch', level: 2, loggedAt: NOW }] },
    })
    const { report } = store.importJSON(base, file)
    expect(report.rejected).toBe(1)
    expect(report.energy.added).toBe(1)
  })

  it('rejects files that are not PulseStack exports, or from a newer version', () => {
    const { store } = fresh()
    const base = store.load(TODAY, NOW).data
    expect(() => store.importJSON(base, 'not json')).toThrow(/not valid JSON/)
    expect(() => store.importJSON(base, '{"hello":1}')).toThrow(/not a PulseStack export/)
    expect(() => store.importJSON(base, JSON.stringify({ app: 'pulsestack', schemaVersion: 99, data: {} }))).toThrow(/newer PulseStack/)
  })
})

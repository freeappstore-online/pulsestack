import { addDaysToKey, type DateKey } from '../lib/dates'
import { defaultSettings, type AppData } from '../types'
import { mergeData, type ImportReport } from './merge'
import {
  SCHEMA_VERSION,
  NewerSchemaError,
  isExportFile,
  migrate,
  parseCompletion,
  parseEnergy,
  parseFeedback,
  parseHabit,
  parseList,
  parseSettings,
  type ExportFile,
} from './schema'

// The only module that knows where data lives (CLAUDE.md §4). Everything else
// talks to the `Store` interface, so moving to IndexedDB later means writing a
// second implementation of this file, nothing more.

export const KEY_PREFIX = 'pulsestack:v1:'
export const RETENTION_DAYS = 400

/** Keys under KEY_PREFIX. `summaries` is reserved for cached summaries (decision.md D-007). */
const DATA_KEYS = ['habits', 'energy', 'completions', 'feedback', 'settings'] as const
type DataKey = (typeof DATA_KEYS)[number]
const META_KEY = 'meta'

export type StorageErrorKind = 'quota' | 'unavailable' | 'read-only' | 'invalid-import'

export class StorageError extends Error {
  readonly kind: StorageErrorKind
  constructor(kind: StorageErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface LoadResult {
  data: AppData
  firstLaunch: boolean
  /** Raw rows removed because they are older than RETENTION_DAYS. */
  pruned: number
  /** Keys whose stored JSON could not be parsed; the raw text was backed up, not deleted. */
  corruptKeys: string[]
  /** Rows that failed validation on load (backed up with the corrupt copy). */
  rejected: number
  /** Stored data came from a newer schema: we show it but refuse to overwrite it. */
  readOnly: boolean
}

export interface Store {
  /** 'memory' means storage is unavailable (e.g. blocked); nothing survives a reload. */
  readonly kind: 'localStorage' | 'memory'
  load(today: DateKey, nowIso: string): LoadResult
  save(patch: Partial<AppData>): void
  exportJSON(data: AppData, nowIso: string): string
  importJSON(current: AppData, json: string): { data: AppData; report: ImportReport }
  wipe(): void
}

/** Minimal Storage used when localStorage is unavailable, and by tests. */
export function createMemoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

/** localStorage if usable, else an in-memory stand-in. Never throws. */
export function openBrowserStore(): Store {
  try {
    const ls = window.localStorage
    const probe = `${KEY_PREFIX}probe`
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return createStore(ls, 'localStorage')
  } catch {
    return createStore(createMemoryStorage(), 'memory')
  }
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)
  )
}

export function pruneOld(data: AppData, today: DateKey, retentionDays = RETENTION_DAYS): { data: AppData; pruned: number } {
  const cutoff = addDaysToKey(today, -retentionDays)
  const cutoffMs = Date.parse(`${cutoff}T00:00:00`)
  const energy = data.energy.filter((e) => e.date >= cutoff)
  const completions = data.completions.filter((c) => c.date >= cutoff)
  const feedback = data.feedback.filter((f) => Date.parse(f.at) >= cutoffMs)
  const pruned =
    data.energy.length - energy.length + (data.completions.length - completions.length) + (data.feedback.length - feedback.length)
  return { data: { ...data, energy, completions, feedback }, pruned }
}

export function createStore(storage: Storage, kind: Store['kind']): Store {
  let readOnly = false
  const k = (key: string) => KEY_PREFIX + key

  function backup(key: string, raw: string, nowIso: string) {
    try {
      storage.setItem(k(`backup:${key}:${nowIso}`), raw)
    } catch {
      // Backing up is best-effort; the caller still reports the problem.
    }
  }

  function write(key: string, value: unknown) {
    if (readOnly) throw new StorageError('read-only', 'This data was saved by a newer version of PulseStack. Reload the app to update before making changes.')
    try {
      storage.setItem(k(key), JSON.stringify(value))
    } catch (e) {
      if (isQuotaError(e)) throw new StorageError('quota', 'Storage is full. Export your data, then free space in your browser settings.')
      throw new StorageError('unavailable', 'Could not save: browser storage is unavailable (private mode or blocked site data).')
    }
  }

  const store: Store = {
    kind,

    load(today, nowIso) {
      const corruptKeys: string[] = []
      const rawValues: Partial<Record<DataKey, unknown>> = {}
      let firstLaunch = true

      for (const key of DATA_KEYS) {
        let raw: string | null = null
        try {
          raw = storage.getItem(k(key))
        } catch {
          raw = null
        }
        if (raw === null) continue
        firstLaunch = false
        try {
          rawValues[key] = JSON.parse(raw)
        } catch {
          corruptKeys.push(key)
          backup(key, raw, nowIso)
        }
      }

      let version = SCHEMA_VERSION
      try {
        const meta = storage.getItem(k(META_KEY))
        if (meta) version = Number((JSON.parse(meta) as { schemaVersion?: unknown }).schemaVersion) || SCHEMA_VERSION
      } catch {
        // Unreadable meta: assume current schema; row validation below still protects us.
      }

      let payload: Record<string, unknown> = rawValues
      readOnly = false
      try {
        payload = migrate(rawValues, version)
      } catch (e) {
        if (e instanceof NewerSchemaError) readOnly = true
        else throw e
      }

      const habits = parseList(payload.habits, parseHabit)
      const energy = parseList(payload.energy, parseEnergy)
      const completions = parseList(payload.completions, parseCompletion)
      const feedback = parseList(payload.feedback, parseFeedback)
      const rejected = habits.rejected + energy.rejected + completions.rejected + feedback.rejected
      if (rejected > 0) {
        // Keep an untouched copy of anything we could not read.
        for (const key of DATA_KEYS) if (rawValues[key] !== undefined) backup(key, JSON.stringify(rawValues[key]), nowIso)
      }

      const settings = parseSettings(payload.settings, defaultSettings(nowIso))
      const loaded: AppData = {
        habits: habits.items,
        energy: energy.items,
        completions: completions.items,
        feedback: feedback.items,
        settings,
      }
      const { data, pruned } = pruneOld(loaded, today)

      // Rewrite when something changed, so a backed-up bad row is cleaned once
      // instead of being backed up again on every launch.
      const dirty = firstLaunch || pruned > 0 || version !== SCHEMA_VERSION || rejected > 0 || corruptKeys.length > 0
      if (!readOnly && dirty) {
        try {
          for (const key of DATA_KEYS) write(key, data[key])
          write(META_KEY, { schemaVersion: SCHEMA_VERSION })
        } catch {
          // Surfaced on the first real save; loading must still succeed.
        }
      }

      return { data, firstLaunch, pruned, corruptKeys, rejected, readOnly }
    },

    save(patch) {
      for (const key of DATA_KEYS) {
        if (patch[key] !== undefined) write(key, patch[key])
      }
    },

    exportJSON(data, nowIso) {
      const file: ExportFile = { app: 'pulsestack', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso, data }
      return JSON.stringify(file, null, 2)
    },

    importJSON(current, json) {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        throw new StorageError('invalid-import', 'That file is not valid JSON.')
      }
      if (!isExportFile(parsed)) throw new StorageError('invalid-import', 'That file is not a PulseStack export.')
      let payload: Record<string, unknown>
      try {
        payload = migrate(parsed.data, parsed.schemaVersion)
      } catch (e) {
        throw new StorageError('invalid-import', e instanceof Error ? e.message : 'Unsupported export version.')
      }
      const habits = parseList(payload.habits, parseHabit)
      const energy = parseList(payload.energy, parseEnergy)
      const completions = parseList(payload.completions, parseCompletion)
      const feedback = parseList(payload.feedback, parseFeedback)
      const incoming: AppData = {
        habits: habits.items,
        energy: energy.items,
        completions: completions.items,
        feedback: feedback.items,
        settings: parseSettings(payload.settings, current.settings),
      }
      const rejected = habits.rejected + energy.rejected + completions.rejected + feedback.rejected
      const result = mergeData(current, incoming, rejected)
      store.save(result.data)
      return result
    },

    wipe() {
      const doomed: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(KEY_PREFIX)) doomed.push(key)
      }
      for (const key of doomed) storage.removeItem(key)
      readOnly = false
    },
  }
  return store
}

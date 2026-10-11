import { create } from 'zustand'
import { toDateKey, type DateKey } from '../lib/dates'
import { newId } from '../lib/id'
import { openBrowserStore, StorageError, type Store } from '../storage/store'
import type { ImportReport } from '../storage/merge'
import {
  defaultSettings,
  type AppData,
  type BlockId,
  type CompletionStatus,
  type EnergyLevel,
  type Habit,
  type RecFeedback,
  type Settings,
} from '../types'

// UI state: the loaded AppData plus actions. Every action writes through the
// Store; storage failures never throw into React — they land in `error`, which
// <StorageNotices> turns into a toast (CLAUDE.md §4: try/catch + clear message).

export interface Notice {
  id: number
  message: string
  variant: 'info' | 'success' | 'error'
}

export type HabitInput = Pick<Habit, 'name' | 'category' | 'demand' | 'targetPerWeek' | 'pinnedBlock'> & { id?: string }

interface AppState {
  ready: boolean
  data: AppData
  storeKind: Store['kind']
  readOnly: boolean
  firstLaunch: boolean
  notices: Notice[]
  persisted: boolean | null

  init(): void
  logEnergy(date: DateKey, block: BlockId, level: EnergyLevel): void
  setCompletion(date: DateKey, habitId: string, block: BlockId, status: CompletionStatus | null): void
  saveHabit(input: HabitInput): Habit
  setArchived(id: string, archived: boolean): void
  giveFeedback(habitId: string, block: BlockId, action: RecFeedback['action']): void
  updateSettings(patch: Partial<Settings>): void
  importJSON(json: string): ImportReport
  exportJSON(): string
  wipe(): void
  setPersisted(v: boolean | null): void
  dismissNotice(id: number): void
}

let store: Store | null = null
let noticeSeq = 0
const nowIso = () => new Date().toISOString()

const emptyData = (): AppData => ({
  habits: [],
  energy: [],
  completions: [],
  feedback: [],
  settings: defaultSettings(nowIso()),
})

export const useApp = create<AppState>((set, get) => {
  const notify = (message: string, variant: Notice['variant'] = 'info') =>
    set((s) => ({ notices: [...s.notices, { id: ++noticeSeq, message, variant }] }))

  /** Apply in memory, then persist. A failed write keeps the change for this session and says so. */
  const commit = (patch: Partial<AppData>) => {
    set((s) => ({ data: { ...s.data, ...patch } }))
    try {
      store?.save(patch)
    } catch (e) {
      notify(e instanceof StorageError ? e.message : 'Could not save your change.', 'error')
    }
  }

  return {
    ready: false,
    data: emptyData(),
    storeKind: 'localStorage',
    readOnly: false,
    firstLaunch: false,
    notices: [],
    persisted: null,

    init() {
      if (get().ready) return
      store = openBrowserStore()
      try {
        const r = store.load(toDateKey(new Date()), nowIso())
        set({ ready: true, data: r.data, storeKind: store.kind, readOnly: r.readOnly, firstLaunch: r.firstLaunch })
        if (store.kind === 'memory') notify('Browser storage is unavailable (private mode?). Nothing you log will be kept after you close this tab.', 'error')
        if (r.readOnly) notify('This data was saved by a newer version of PulseStack. Reload to update; changes are paused until then.', 'error')
        if (r.corruptKeys.length || r.rejected) notify(`Some saved data could not be read (${r.corruptKeys.length + r.rejected} item(s)). A backup copy was kept.`, 'error')
      } catch {
        set({ ready: true, storeKind: store.kind })
        notify('Could not read your saved data.', 'error')
      }
    },

    logEnergy(date, block, level) {
      const energy = get().data.energy.filter((e) => !(e.date === date && e.block === block))
      energy.push({ date, block, level, loggedAt: nowIso() })
      commit({ energy })
    },

    setCompletion(date, habitId, block, status) {
      // One completion per (date, habit): replace, or remove when status is null.
      const completions = get().data.completions.filter((c) => !(c.date === date && c.habitId === habitId))
      if (status) completions.push({ date, habitId, block, status, loggedAt: nowIso() })
      commit({ completions })
    },

    saveHabit(input) {
      const habits = get().data.habits
      const existing = input.id ? habits.find((h) => h.id === input.id) : undefined
      const now = nowIso()
      const habit: Habit = {
        ...(existing ?? { id: newId(), createdAt: now }),
        name: input.name.trim(),
        category: input.category,
        demand: input.demand,
        targetPerWeek: input.targetPerWeek,
        updatedAt: now,
      }
      if (input.pinnedBlock) habit.pinnedBlock = input.pinnedBlock
      else delete habit.pinnedBlock
      commit({ habits: existing ? habits.map((h) => (h.id === habit.id ? habit : h)) : [...habits, habit] })
      return habit
    },

    setArchived(id, archived) {
      const now = nowIso()
      const habits = get().data.habits.map((h) => {
        if (h.id !== id) return h
        const next: Habit = { ...h, updatedAt: now }
        if (archived) next.archivedAt = now
        else delete next.archivedAt
        return next
      })
      commit({ habits })
    },

    giveFeedback(habitId, block, action) {
      commit({ feedback: [...get().data.feedback, { habitId, suggestedBlock: block, action, at: nowIso() }] })
    },

    updateSettings(patch) {
      commit({ settings: { ...get().data.settings, ...patch } })
    },

    importJSON(json) {
      if (!store) throw new StorageError('unavailable', 'Storage is not ready yet.')
      const { data, report } = store.importJSON(get().data, json)
      set({ data })
      return report
    },

    exportJSON() {
      const json = (store ?? openBrowserStore()).exportJSON(get().data, nowIso())
      get().updateSettings({ lastExportAt: nowIso() })
      return json
    },

    wipe() {
      try {
        store?.wipe()
      } catch {
        notify('Could not clear browser storage.', 'error')
        return
      }
      store = null
      set({ ready: false, data: emptyData(), notices: [] })
      get().init()
    },

    setPersisted(v) {
      set({ persisted: v })
    },

    dismissNotice(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
    },
  }
})

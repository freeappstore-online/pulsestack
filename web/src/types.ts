// PulseStack domain model (CLAUDE.md §3). Shared by storage, engine and UI.

export type EnergyLevel = 1 | 2 | 3 // 1 = Low, 2 = Medium, 3 = High
export type BlockId = 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'

export const BLOCK_IDS: readonly BlockId[] = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night']

export interface TimeBlock {
  id: BlockId
  label: string
  startHour: number // inclusive, 0–23
  endHour: number // exclusive, 1–24
  enabled: boolean
}

export type Demand = 'high' | 'medium' | 'low'
export type Category = 'deep-focus' | 'learning' | 'creative' | 'physical' | 'admin' | 'social' | 'restorative'

export const DEMANDS: readonly Demand[] = ['high', 'medium', 'low']
export const CATEGORIES: readonly Category[] = [
  'deep-focus',
  'learning',
  'creative',
  'physical',
  'admin',
  'social',
  'restorative',
]

export interface Habit {
  id: string
  name: string
  category: Category
  demand: Demand
  pinnedBlock?: BlockId // user override: never move
  targetPerWeek: number // 1–7
  createdAt: string
  archivedAt?: string
  /** Last edit time. Optional extension used to resolve import conflicts (decision.md D-009). */
  updatedAt?: string
}

/** `date` is a local calendar date, YYYY-MM-DD. */
export interface EnergyEntry {
  date: string
  block: BlockId
  level: EnergyLevel
  loggedAt: string
}

export type CompletionStatus = 'done' | 'partial' | 'skipped'

export interface CompletionEntry {
  date: string
  habitId: string
  block: BlockId
  status: CompletionStatus
  loggedAt: string
}

export interface RecFeedback {
  habitId: string
  suggestedBlock: BlockId
  action: 'accepted' | 'dismissed'
  at: string
}

export interface Settings {
  blocks: TimeBlock[]
  /** Max high-demand habits the recommender assigns to one block. */
  capacityHighPerBlock: number
  /** Notification API reminders while the app is open (best-effort, §7). */
  remindersEnabled: boolean
  /** ISO timestamp of the first launch. */
  firstUsedAt: string
  lastExportAt?: string
  persistRequestedAt?: string
  installPromptDismissedAt?: string
}

export interface AppData {
  habits: Habit[]
  energy: EnergyEntry[]
  completions: CompletionEntry[]
  feedback: RecFeedback[]
  settings: Settings
}

export const DEFAULT_BLOCKS: TimeBlock[] = [
  { id: 'early', label: 'Early', startHour: 5, endHour: 8, enabled: true },
  { id: 'morning', label: 'Morning', startHour: 8, endHour: 11, enabled: true },
  { id: 'midday', label: 'Midday', startHour: 11, endHour: 14, enabled: true },
  { id: 'afternoon', label: 'Afternoon', startHour: 14, endHour: 17, enabled: true },
  { id: 'evening', label: 'Evening', startHour: 17, endHour: 21, enabled: true },
  { id: 'night', label: 'Night', startHour: 21, endHour: 24, enabled: true },
]

export function defaultSettings(nowIso: string): Settings {
  return {
    blocks: DEFAULT_BLOCKS.map((b) => ({ ...b })),
    capacityHighPerBlock: 2,
    remindersEnabled: false,
    firstUsedAt: nowIso,
  }
}

export const ENERGY_LABEL: Record<EnergyLevel, string> = { 1: 'Low', 2: 'Medium', 3: 'High' }
export const ENERGY_SHORT: Record<EnergyLevel, string> = { 1: 'L', 2: 'M', 3: 'H' }
export const DEMAND_LEVEL: Record<Demand, EnergyLevel> = { low: 1, medium: 2, high: 3 }

export const CATEGORY_LABEL: Record<Category, string> = {
  'deep-focus': 'Deep focus',
  learning: 'Learning',
  creative: 'Creative',
  physical: 'Physical',
  admin: 'Admin',
  social: 'Social',
  restorative: 'Restorative',
}

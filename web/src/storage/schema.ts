import { isDateKey } from '../lib/dates'
import {
  BLOCK_IDS,
  CATEGORIES,
  DEMANDS,
  type AppData,
  type BlockId,
  type CompletionEntry,
  type EnergyEntry,
  type Habit,
  type RecFeedback,
  type Settings,
  type TimeBlock,
} from '../types'

// Runtime validation for everything that crosses a trust boundary: data read
// back from localStorage and, above all, imported JSON files. Each entry is
// validated on its own so one bad row never sinks a whole import; invalid
// rows are counted and reported, never silently dropped (decision.md D-008).

export const SCHEMA_VERSION = 1

type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isIso = (x: unknown): x is string => isStr(x) && !Number.isNaN(Date.parse(x))
const isBlockId = (x: unknown): x is BlockId => isStr(x) && (BLOCK_IDS as readonly string[]).includes(x)
const isInt = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max

export function parseHabit(x: unknown): Habit | null {
  if (!isObj(x)) return null
  const { id, name, category, demand, pinnedBlock, targetPerWeek, createdAt, archivedAt, updatedAt } = x
  if (!isStr(id) || id.length === 0 || id.length > 64) return null
  if (!isStr(name) || name.trim().length === 0 || name.length > 80) return null
  if (!isStr(category) || !(CATEGORIES as readonly string[]).includes(category)) return null
  if (!isStr(demand) || !(DEMANDS as readonly string[]).includes(demand)) return null
  if (pinnedBlock !== undefined && !isBlockId(pinnedBlock)) return null
  if (!isInt(targetPerWeek, 1, 7)) return null
  if (!isIso(createdAt)) return null
  if (archivedAt !== undefined && !isIso(archivedAt)) return null
  if (updatedAt !== undefined && !isIso(updatedAt)) return null
  const h: Habit = { id, name: name.trim(), category: category as Habit['category'], demand: demand as Habit['demand'], targetPerWeek, createdAt }
  if (pinnedBlock !== undefined) h.pinnedBlock = pinnedBlock
  if (archivedAt !== undefined) h.archivedAt = archivedAt
  if (updatedAt !== undefined) h.updatedAt = updatedAt
  return h
}

export function parseEnergy(x: unknown): EnergyEntry | null {
  if (!isObj(x)) return null
  const { date, block, level, loggedAt } = x
  if (!isDateKey(date) || !isBlockId(block) || !isInt(level, 1, 3) || !isIso(loggedAt)) return null
  return { date, block, level: level as EnergyEntry['level'], loggedAt }
}

export function parseCompletion(x: unknown): CompletionEntry | null {
  if (!isObj(x)) return null
  const { date, habitId, block, status, loggedAt } = x
  if (!isDateKey(date) || !isStr(habitId) || !isBlockId(block) || !isIso(loggedAt)) return null
  if (status !== 'done' && status !== 'partial' && status !== 'skipped') return null
  return { date, habitId, block, status, loggedAt }
}

export function parseFeedback(x: unknown): RecFeedback | null {
  if (!isObj(x)) return null
  const { habitId, suggestedBlock, action, at } = x
  if (!isStr(habitId) || !isBlockId(suggestedBlock) || !isIso(at)) return null
  if (action !== 'accepted' && action !== 'dismissed') return null
  return { habitId, suggestedBlock, action, at }
}

function parseBlock(x: unknown): TimeBlock | null {
  if (!isObj(x)) return null
  const { id, label, startHour, endHour, enabled } = x
  if (!isBlockId(id) || !isStr(label) || !isInt(startHour, 0, 23) || !isInt(endHour, 1, 24)) return null
  if (endHour <= startHour || typeof enabled !== 'boolean') return null
  return { id, label: label.slice(0, 24), startHour, endHour, enabled }
}

/** Blocks must cover each BlockId exactly once and must not overlap when enabled. */
export function validateBlocks(blocks: TimeBlock[]): string | null {
  const ids = new Set(blocks.map((b) => b.id))
  if (ids.size !== BLOCK_IDS.length || blocks.length !== BLOCK_IDS.length) return 'Every time block must appear exactly once.'
  for (const b of blocks) {
    if (b.endHour <= b.startHour) return `${b.label}: end must be after start.`
  }
  const on = blocks.filter((b) => b.enabled).sort((a, b) => a.startHour - b.startHour)
  if (on.length === 0) return 'Enable at least one time block.'
  for (let i = 1; i < on.length; i++) {
    if (on[i].startHour < on[i - 1].endHour) return `${on[i - 1].label} and ${on[i].label} overlap.`
  }
  return null
}

export function parseSettings(x: unknown, fallback: Settings): Settings {
  if (!isObj(x)) return fallback
  const out: Settings = { ...fallback }
  if (Array.isArray(x.blocks)) {
    const blocks = x.blocks.map(parseBlock).filter((b): b is TimeBlock => b !== null)
    if (validateBlocks(blocks) === null) out.blocks = blocks
  }
  if (isInt(x.capacityHighPerBlock, 1, 6)) out.capacityHighPerBlock = x.capacityHighPerBlock
  if (typeof x.remindersEnabled === 'boolean') out.remindersEnabled = x.remindersEnabled
  if (isIso(x.firstUsedAt)) out.firstUsedAt = x.firstUsedAt
  if (isIso(x.lastExportAt)) out.lastExportAt = x.lastExportAt
  if (isIso(x.persistRequestedAt)) out.persistRequestedAt = x.persistRequestedAt
  if (isIso(x.installPromptDismissedAt)) out.installPromptDismissedAt = x.installPromptDismissedAt
  return out
}

export function parseList<T>(raw: unknown, parse: (x: unknown) => T | null): { items: T[]; rejected: number } {
  if (!Array.isArray(raw)) return { items: [], rejected: raw === undefined || raw === null ? 0 : 1 }
  const items: T[] = []
  let rejected = 0
  for (const x of raw) {
    const v = parse(x)
    if (v) items.push(v)
    else rejected++
  }
  return { items, rejected }
}

// ── Migrations ────────────────────────────────────────────────────────────
// MIGRATIONS[n] upgrades a version-n payload to version n+1. Version 1 is the
// first shipped schema, so the table is empty; the path exists from day one so
// the first real change is a one-function addition (CLAUDE.md §4).

type Payload = Record<string, unknown>
const MIGRATIONS: Record<number, (p: Payload) => Payload> = {}

export class NewerSchemaError extends Error {
  readonly found: number
  constructor(found: number) {
    super(`Data was written by a newer PulseStack (schema v${found}); this version understands v${SCHEMA_VERSION}.`)
    this.found = found
  }
}

export function migrate(payload: Payload, fromVersion: number): Payload {
  if (fromVersion > SCHEMA_VERSION) throw new NewerSchemaError(fromVersion)
  let p = payload
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) throw new Error(`No migration from schema v${v}`)
    p = step(p)
  }
  return p
}

// ── Export file format ────────────────────────────────────────────────────

export interface ExportFile {
  app: 'pulsestack'
  schemaVersion: number
  exportedAt: string
  data: AppData
}

export function isExportFile(x: unknown): x is { app: string; schemaVersion: number; data: Obj } {
  return isObj(x) && x.app === 'pulsestack' && typeof x.schemaVersion === 'number' && isObj(x.data)
}

import { addDaysToKey, daysBetween, toDateKey, type DateKey } from '../lib/dates'
import { CATEGORIES, type AppData, type BlockId, type Category, type CompletionEntry } from '../types'
import { classifyBlocks } from './classify'
import { buildMatrix } from './matrix'

// Deterministic facts for the Insights screen (CLAUDE.md §6). Every number the
// UI or narrative shows comes from here. A statistic resting on fewer than
// MIN_EVENTS events is reported with value = null ("not enough data yet").

export const MIN_EVENTS = 5
export const BASELINE_DAYS = 14

export interface Period {
  start: DateKey
  end: DateKey
  days: number
}

/** `value` is null when there were fewer than MIN_EVENTS underlying events. */
export interface Metric {
  value: number | null
  n: number
}

export interface CategoryFacts {
  category: Category
  sessions: number
  perWeek: Metric
  baselinePerWeek: Metric
  previousPerWeek: Metric
  /** Relative change of sessions/week vs the first 14 days, in %. */
  changeVsBaselinePct: number | null
}

export interface BlockEnergy {
  block: BlockId
  mean: number
  n: number
  sd: number | null
}

export interface SummaryFacts {
  period: Period
  previous: Period
  /** The user's first 14 days; null when there is no history before this period. */
  baseline: Period | null
  completion: {
    /** % of weekly targets met (capped per habit), 0–100. */
    rate: Metric
    previousRate: Metric
    baselineRate: Metric
    deltaVsPreviousPts: number | null
    deltaVsBaselinePts: number | null
    sessions: number
  }
  categories: CategoryFacts[]
  alignment: {
    /** % of high-demand sessions done in a block that was a peak on that day. */
    current: Metric
    previous: Metric
    baseline: Metric
    deltaVsBaselinePts: number | null
  }
  energy: {
    entries: number
    daysLogged: number
    byBlock: BlockEnergy[]
    best: BlockEnergy | null
    worst: BlockEnergy | null
    sd: number | null
  }
  consistency: {
    activeDays: number
    /** activeDays / period days, 0–100. */
    rate: Metric
    currentStreak: number
    longestStreak: number
  }
  recs: {
    accepted: number
    dismissed: number
    /** Sessions/week for accepted moves, in the 14 days before vs after accepting. */
    before: Metric
    after: Metric
    moves: number
  }
}

export function periodEnding(end: DateKey, days: number): Period {
  return { start: addDaysToKey(end, -(days - 1)), end, days }
}

const inPeriod = (date: DateKey, p: Period) => date >= p.start && date <= p.end
const metric = (value: number, n: number): Metric => ({ value: n >= MIN_EVENTS ? value : null, n })
const sessionValue = (c: CompletionEntry) => (c.status === 'done' ? 1 : c.status === 'partial' ? 0.5 : 0)
const round1 = (x: number) => Math.round(x * 10) / 10
const delta = (a: Metric, b: Metric) => (a.value !== null && b.value !== null ? round1(a.value - b.value) : null)

/** First local date with any energy or completion log. */
export function firstActivityDate(data: AppData): DateKey | null {
  let first: DateKey | null = null
  for (const e of data.energy) if (!first || e.date < first) first = e.date
  for (const c of data.completions) if (!first || c.date < first) first = c.date
  return first
}

function completionRate(data: AppData, p: Period): Metric {
  let expected = 0
  let met = 0
  let events = 0
  for (const h of data.habits) {
    const created = toDateKey(new Date(h.createdAt))
    const archived = h.archivedAt ? toDateKey(new Date(h.archivedAt)) : null
    const start = created > p.start ? created : p.start
    const end = archived && archived < p.end ? archived : p.end
    if (end < start) continue
    const activeDays = daysBetween(start, end) + 1
    const exp = (h.targetPerWeek / 7) * activeDays
    let sessions = 0
    for (const c of data.completions) {
      if (c.habitId !== h.id || !inPeriod(c.date, p)) continue
      events++
      sessions += sessionValue(c)
    }
    expected += exp
    met += Math.min(sessions, exp)
  }
  return metric(expected > 0 ? round1((met / expected) * 100) : 0, events)
}

function sessionsPerWeek(data: AppData, p: Period, category: Category): Metric {
  const ids = new Set(data.habits.filter((h) => h.category === category).map((h) => h.id))
  let sessions = 0
  for (const c of data.completions) if (ids.has(c.habitId) && inPeriod(c.date, p)) sessions += sessionValue(c)
  return metric(round1(sessions / (p.days / 7)), Math.floor(sessions))
}

function alignment(data: AppData, p: Period, peakCache: Map<DateKey, Set<BlockId> | null>): Metric {
  const high = new Set(data.habits.filter((h) => h.demand === 'high').map((h) => h.id))
  let inPeak = 0
  let total = 0
  for (const c of data.completions) {
    if (!high.has(c.habitId) || !inPeriod(c.date, p) || c.status === 'skipped') continue
    let peaks = peakCache.get(c.date)
    if (peaks === undefined) {
      // Peaks as they stood on that day (14-day window ending that day).
      const cls = classifyBlocks(buildMatrix(data.energy, data.settings.blocks, c.date))
      peaks = cls.ranked.length > 0 ? new Set(cls.peaks) : null
      peakCache.set(c.date, peaks)
    }
    if (peaks === null) continue // no confident blocks yet that day: not counted either way
    total++
    if (peaks.has(c.block)) inPeak++
  }
  return metric(total > 0 ? round1((inPeak / total) * 100) : 0, total)
}

function streaks(activeDates: Set<DateKey>, p: Period, today: DateKey) {
  let longest = 0
  let run = 0
  for (let d = p.start; d <= p.end; d = addDaysToKey(d, 1)) {
    run = activeDates.has(d) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  // Current streak counts back from today, or from yesterday if today has no session yet.
  let cur = 0
  let d = activeDates.has(today) ? today : addDaysToKey(today, -1)
  while (activeDates.has(d)) {
    cur++
    d = addDaysToKey(d, -1)
  }
  return { longest, current: cur }
}

function recFacts(data: AppData, p: Period, today: DateKey): SummaryFacts['recs'] {
  const inP = data.feedback.filter((f) => inPeriod(toDateKey(new Date(f.at)), p))
  const accepted = inP.filter((f) => f.action === 'accepted')
  let beforeSum = 0
  let afterSum = 0
  let events = 0
  let moves = 0
  for (const f of accepted) {
    const day = toDateKey(new Date(f.at))
    const observed = Math.min(14, daysBetween(day, today))
    if (observed < 7) continue // too soon to compare
    moves++
    const before = { start: addDaysToKey(day, -14), end: addDaysToKey(day, -1), days: 14 }
    const after = { start: addDaysToKey(day, 1), end: addDaysToKey(day, observed), days: observed }
    for (const c of data.completions) {
      if (c.habitId !== f.habitId) continue
      if (inPeriod(c.date, before)) {
        beforeSum += sessionValue(c) / 2 // per week over 14 days
        events++
      } else if (inPeriod(c.date, after)) {
        afterSum += sessionValue(c) / (observed / 7)
        events++
      }
    }
  }
  return {
    accepted: accepted.length,
    dismissed: inP.length - accepted.length,
    moves,
    before: metric(moves ? round1(beforeSum / moves) : 0, events),
    after: metric(moves ? round1(afterSum / moves) : 0, events),
  }
}

function energyFacts(data: AppData, p: Period): SummaryFacts['energy'] {
  const entries = data.energy.filter((e) => inPeriod(e.date, p))
  const byBlockMap = new Map<BlockId, number[]>()
  for (const e of entries) {
    const list = byBlockMap.get(e.block) ?? []
    list.push(e.level)
    byBlockMap.set(e.block, list)
  }
  const sdOf = (xs: number[]) => {
    if (xs.length < 2) return null
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.round(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) * 100) / 100
  }
  const order = data.settings.blocks.map((b) => b.id)
  const byBlock: BlockEnergy[] = [...byBlockMap.entries()]
    .map(([block, xs]) => ({ block, mean: round1(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length, sd: sdOf(xs) }))
    .sort((a, b) => order.indexOf(a.block) - order.indexOf(b.block))
  const ranked = byBlock.filter((b) => b.n >= MIN_EVENTS).sort((a, b) => b.mean - a.mean || b.n - a.n)
  const best = ranked.length >= 2 ? ranked[0] : null
  const worst = ranked.length >= 2 && ranked[ranked.length - 1].mean < ranked[0].mean ? ranked[ranked.length - 1] : null
  return {
    entries: entries.length,
    daysLogged: new Set(entries.map((e) => e.date)).size,
    byBlock,
    best,
    worst,
    sd: entries.length >= MIN_EVENTS ? sdOf(entries.map((e) => e.level)) : null,
  }
}

export function computeFacts(data: AppData, today: DateKey, periodDays: 30 | 90): SummaryFacts {
  const period = periodEnding(today, periodDays)
  const previous = periodEnding(addDaysToKey(period.start, -1), periodDays)
  const first = firstActivityDate(data)
  // Baseline only when it ends before this period starts; otherwise the
  // comparison would partly be against itself (decision.md D-016).
  const baselineEnd = first ? addDaysToKey(first, BASELINE_DAYS - 1) : null
  const baseline: Period | null =
    first && baselineEnd && baselineEnd < period.start ? { start: first, end: baselineEnd, days: BASELINE_DAYS } : null
  const none: Metric = { value: null, n: 0 }

  const rate = completionRate(data, period)
  const previousRate = completionRate(data, previous)
  const baselineRate = baseline ? completionRate(data, baseline) : none

  const categories: CategoryFacts[] = CATEGORIES.filter((cat) => data.habits.some((h) => h.category === cat)).map((category) => {
    const perWeek = sessionsPerWeek(data, period, category)
    const baselinePerWeek = baseline ? sessionsPerWeek(data, baseline, category) : none
    const previousPerWeek = sessionsPerWeek(data, previous, category)
    const ids = new Set(data.habits.filter((h) => h.category === category).map((h) => h.id))
    const sessions = data.completions.filter((c) => ids.has(c.habitId) && inPeriod(c.date, period)).reduce((a, c) => a + sessionValue(c), 0)
    const changeVsBaselinePct =
      perWeek.value !== null && baselinePerWeek.value !== null && baselinePerWeek.value > 0
        ? Math.round(((perWeek.value - baselinePerWeek.value) / baselinePerWeek.value) * 100)
        : null
    return { category, sessions, perWeek, baselinePerWeek, previousPerWeek, changeVsBaselinePct }
  })

  const peakCache = new Map<DateKey, Set<BlockId> | null>()
  const alignCurrent = alignment(data, period, peakCache)
  const alignPrevious = alignment(data, previous, peakCache)
  const alignBaseline = baseline ? alignment(data, baseline, peakCache) : none

  const periodCompletions = data.completions.filter((c) => inPeriod(c.date, period))
  const activeDates = new Set(data.completions.filter((c) => c.status !== 'skipped').map((c) => c.date))
  const activeDays = [...activeDates].filter((d) => inPeriod(d, period)).length
  const { longest, current } = streaks(activeDates, period, today)

  return {
    period,
    previous,
    baseline,
    completion: {
      rate,
      previousRate,
      baselineRate,
      deltaVsPreviousPts: delta(rate, previousRate),
      deltaVsBaselinePts: delta(rate, baselineRate),
      sessions: periodCompletions.reduce((a, c) => a + sessionValue(c), 0),
    },
    categories,
    alignment: {
      current: alignCurrent,
      previous: alignPrevious,
      baseline: alignBaseline,
      deltaVsBaselinePts: delta(alignCurrent, alignBaseline),
    },
    energy: energyFacts(data, period),
    consistency: {
      activeDays,
      rate: metric(round1((activeDays / period.days) * 100), periodCompletions.length),
      currentStreak: current,
      longestStreak: longest,
    },
    recs: recFacts(data, period, today),
  }
}

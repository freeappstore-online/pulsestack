import { format } from 'date-fns'
import { blockLabel, fromDateKey } from '../lib/dates'
import { CATEGORY_LABEL, type TimeBlock } from '../types'
import type { Period, SummaryFacts } from '../engine/summary'

// Template narrative (CLAUDE.md §6): picks the 3–5 most notable facts and
// renders them from fixed templates. Wording rules: describe, never claim
// cause; every sentence carries its period, comparison and sample size.

export interface NarrativeSentence {
  key: string
  text: string
  /** "Last 30 days (10 Sep – 9 Oct) vs first 14 days (…) · 42 logged sessions" */
  basis: string
}

export interface Narrative {
  sentences: NarrativeSentence[]
  /** True when no fact had enough data; the UI shows a "keep logging" message instead. */
  insufficient: boolean
}

/** Notability thresholds: smaller changes are not worth a sentence. */
export const THRESHOLDS = { ratePts: 5, categoryPct: 15, alignmentPts: 10 }

/** Words the narrative must never use (also checked in tests). */
export const CAUSAL_WORDS = /\b(because of|boost(ed|s)?|caused?|thanks to|due to|made you|helped you)\b/i

interface Candidate extends NarrativeSentence {
  weight: number
}

const fmtDate = (k: string) => format(fromDateKey(k), 'd MMM')
const range = (p: Period) => `${fmtDate(p.start)} – ${fmtDate(p.end)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const signed = (x: number, up: string, down: string) => `${Math.abs(x)} ${x >= 0 ? up : down}`
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

export function templateNarrative(f: SummaryFacts, blocks: TimeBlock[], max = 5): Narrative {
  const label = `Last ${f.period.days} days (${range(f.period)})`
  const vsBase = f.baseline ? `first 14 days (${range(f.baseline)})` : ''
  const vsPrev = `previous ${f.period.days} days (${range(f.previous)})`
  const out: Candidate[] = []

  // Overall completion vs baseline, else vs previous period.
  const c = f.completion
  if (c.rate.value !== null && c.deltaVsBaselinePts !== null && Math.abs(c.deltaVsBaselinePts) >= THRESHOLDS.ratePts) {
    out.push({
      key: 'completion-baseline',
      weight: Math.abs(c.deltaVsBaselinePts) / THRESHOLDS.ratePts,
      text: `You met ${num(c.rate.value)}% of your weekly habit targets, ${signed(c.deltaVsBaselinePts, 'points higher', 'points lower')} than in your first two weeks (${num(c.baselineRate.value!)}%).`,
      basis: `${label} vs ${vsBase} · ${plural(c.rate.n, 'logged check-off')}`,
    })
  } else if (c.rate.value !== null && c.deltaVsPreviousPts !== null && Math.abs(c.deltaVsPreviousPts) >= THRESHOLDS.ratePts) {
    out.push({
      key: 'completion-previous',
      weight: Math.abs(c.deltaVsPreviousPts) / THRESHOLDS.ratePts,
      text: `You met ${num(c.rate.value)}% of your weekly habit targets, ${signed(c.deltaVsPreviousPts, 'points higher', 'points lower')} than the period before (${num(c.previousRate.value!)}%).`,
      basis: `${label} vs ${vsPrev} · ${plural(c.rate.n, 'logged check-off')}`,
    })
  } else if (c.rate.value !== null) {
    out.push({
      key: 'completion',
      weight: 0.6,
      text: `You met ${num(c.rate.value)}% of your weekly habit targets.`,
      basis: `${label} · ${plural(c.rate.n, 'logged check-off')}`,
    })
  }

  // Category session counts vs the first two weeks.
  for (const cat of f.categories) {
    if (cat.changeVsBaselinePct === null || Math.abs(cat.changeVsBaselinePct) < THRESHOLDS.categoryPct) continue
    const name = CATEGORY_LABEL[cat.category].toLowerCase()
    const boost = cat.category === 'deep-focus' || cat.category === 'learning' ? 1.25 : 1
    out.push({
      key: `category-${cat.category}`,
      weight: (Math.abs(cat.changeVsBaselinePct) / THRESHOLDS.categoryPct) * boost,
      text: `You completed ${Math.abs(cat.changeVsBaselinePct)}% ${cat.changeVsBaselinePct >= 0 ? 'more' : 'fewer'} ${name} sessions per week than in your first two weeks (${num(cat.perWeek.value!)} vs ${num(cat.baselinePerWeek.value!)} a week).`,
      basis: `${label} vs ${vsBase} · ${plural(cat.perWeek.n, 'session')} vs ${plural(cat.baselinePerWeek.n, 'session')}`,
    })
  }

  // Alignment of demanding work with peak blocks.
  const a = f.alignment
  if (a.current.value !== null) {
    const changed = a.deltaVsBaselinePts !== null && Math.abs(a.deltaVsBaselinePts) >= THRESHOLDS.alignmentPts
    out.push({
      key: 'alignment',
      weight: changed ? Math.abs(a.deltaVsBaselinePts!) / THRESHOLDS.alignmentPts : 0.8,
      text: changed
        ? `${num(a.current.value)}% of your high-energy-demand sessions happened in your peak blocks, ${signed(a.deltaVsBaselinePts!, 'points more', 'points fewer')} than in your first two weeks (${num(a.baseline.value!)}%).`
        : `${num(a.current.value)}% of your high-energy-demand sessions happened in your peak blocks.`,
      basis: `${label}${changed ? ` vs ${vsBase}` : ''} · ${plural(a.current.n, 'high-demand session')}`,
    })
  }

  // Energy profile.
  const e = f.energy
  if (e.best && e.worst) {
    out.push({
      key: 'energy',
      weight: 0.9,
      text: `${blockLabel(e.best.block, blocks)} was your highest-energy block (average ${num(e.best.mean)} of 3) and ${blockLabel(e.worst.block, blocks)} your lowest (${num(e.worst.mean)}).`,
      basis: `${label} · ${e.best.n === e.worst.n ? `${plural(e.best.n, 'rating')} each` : `${e.best.n} and ${plural(e.worst.n, 'rating')}`} · ${plural(e.daysLogged, 'day')} logged`,
    })
  }

  // Consistency and streaks.
  const k = f.consistency
  if (k.rate.value !== null) {
    out.push({
      key: 'consistency',
      weight: 0.7,
      text: `You checked off at least one habit on ${k.activeDays} of ${f.period.days} days; your longest run was ${plural(k.longestStreak, 'day')}${k.currentStreak > 1 ? ` and you are on a ${k.currentStreak}-day run now` : ''}.`,
      basis: `${label} · ${plural(k.rate.n, 'logged check-off')}`,
    })
  }

  // Accepted suggestions: before vs after, described, not credited.
  const r = f.recs
  if (r.moves > 0 && r.before.value !== null && r.after.value !== null) {
    const diff = r.after.value - r.before.value
    out.push({
      key: 'recs',
      weight: Math.abs(diff) >= 0.5 ? 1.1 : 0.5,
      text: `For the ${plural(r.moves, 'habit')} you moved to a suggested block, you averaged ${num(r.after.value)} sessions a week afterwards vs ${num(r.before.value)} in the two weeks before.`,
      basis: `${label} · ${plural(r.accepted, 'suggestion')} accepted, ${r.dismissed} dismissed · ${plural(r.after.n, 'check-off')}`,
    })
  }

  const sentences = out
    .sort((x, y) => y.weight - x.weight)
    .slice(0, max)
    .map(({ key, text, basis }) => ({ key, text, basis }))
  return { sentences, insufficient: sentences.length === 0 }
}

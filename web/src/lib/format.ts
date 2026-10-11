import { rawRate, type RateStat } from '../engine/completion'
import type { Recommendation } from '../engine/recommend'
import { blockLabel } from './dates'
import type { TimeBlock } from '../types'

export const pct = (x: number) => `${Math.round(x * 100)}%`
export const score1 = (x: number | null) => (x === null ? '–' : x.toFixed(1))

function rateText(s: RateStat | undefined): string | null {
  const r = rawRate(s)
  if (r === null || !s) return null
  return `${pct(r)} of ${s.attempts} logged times`
}

/**
 * The evidence line under a recommendation, e.g.
 * "Morning: High on 9 of 12 logged days (avg 2.6 of 3). Evening averages 2.0 over 11 logged days.
 *  You finished Study 78% of 9 logged times in Morning vs 41% of 12 logged times in Evening."
 */
export function evidenceLines(rec: Recommendation, habitName: string, blocks: TimeBlock[]): string[] {
  const to = rec.evidence.to
  const toName = blockLabel(rec.to, blocks)
  const basis = to.basis === 'all' ? '' : `${to.basis} `
  const lines: string[] = []
  const levelWord = rec.reason === 'low-demand-to-trough' ? 'Low' : 'High'
  const levelDays = rec.reason === 'low-demand-to-trough' ? to.lowDays : to.highDays
  lines.push(`${toName}: ${levelWord} on ${levelDays} of ${to.days} logged days (${basis}avg ${score1(to.score)} of 3).`)
  if (rec.from && rec.evidence.from) {
    const f = rec.evidence.from
    const fBasis = f.basis === 'all' ? '' : ` on ${f.basis}s`
    lines.push(`${blockLabel(rec.from, blocks)} averages ${score1(f.score)}${fBasis} (${f.days} logged days).`)
  }
  const cTo = rateText(rec.evidence.completionTo)
  const cFrom = rateText(rec.evidence.completionFrom)
  if (cTo && cFrom && rec.from) {
    lines.push(`You finished ${habitName} ${cTo} in ${toName} vs ${cFrom} in ${blockLabel(rec.from, blocks)}.`)
  } else if (cFrom && rec.from) {
    lines.push(`You finished ${habitName} ${cFrom} in ${blockLabel(rec.from, blocks)}; no history in ${toName} yet.`)
  }
  return lines
}

export function recTitle(rec: Recommendation, habitName: string, blocks: TimeBlock[]): string {
  const to = blockLabel(rec.to, blocks)
  return rec.kind === 'move' && rec.from ? `Move ${habitName} from ${blockLabel(rec.from, blocks)} to ${to}` : `Try ${habitName} in ${to}`
}

export const REASON_TEXT: Record<Recommendation['reason'], string> = {
  'high-demand-to-peak': 'High-demand habit → one of your peak blocks',
  'low-demand-to-trough': 'Low-demand habit → a lower-energy block, keeping peaks free',
  'out-of-trough': 'Currently in your lowest-energy block',
}

import type { DateKey } from '../lib/dates'
import type { BlockId } from '../types'
import { atLeastLow, effectiveScore, type EnergyMatrix } from './matrix'

// Peak and trough windows (CLAUDE.md §5).

export const PEAK_THRESHOLD = 2.5
export const TROUGH_THRESHOLD = 1.5

export type BlockClass = 'peak' | 'trough' | 'neutral' | 'learning'

export interface RankedBlock {
  block: BlockId
  score: number
  n: number
}

export interface Classification {
  target: DateKey
  byBlock: Partial<Record<BlockId, BlockClass>>
  /** Eligible blocks (confidence ≥ low), best first; ties broken by more samples. */
  ranked: RankedBlock[]
  peaks: BlockId[]
  troughs: BlockId[]
}

/**
 * Thresholds decide first (≥ 2.5 peak, ≤ 1.5 trough). Rank then fills in: the
 * top-ranked block is a peak and the bottom-ranked a trough, but only when
 * that score is unique, so a flat profile (every block 2.0) or a tie yields no
 * fake peak or trough (decision.md D-012).
 */
export function classifyBlocks(matrix: EnergyMatrix, target: DateKey = matrix.today): Classification {
  const byBlock: Classification['byBlock'] = {}
  const ranked: RankedBlock[] = []
  for (const b of matrix.blocks) {
    const stats = matrix.stats[b]
    if (!stats || !atLeastLow(stats.confidence)) {
      byBlock[b] = 'learning'
      continue
    }
    const eff = effectiveScore(stats, target)
    if (eff.score === null) {
      byBlock[b] = 'learning'
      continue
    }
    ranked.push({ block: b, score: eff.score, n: eff.n })
  }
  ranked.sort((a, b) => b.score - a.score || b.n - a.n)

  for (const r of ranked) {
    byBlock[r.block] = r.score >= PEAK_THRESHOLD ? 'peak' : r.score <= TROUGH_THRESHOLD ? 'trough' : 'neutral'
  }
  if (ranked.length >= 2) {
    const top = ranked[0]
    const bottom = ranked[ranked.length - 1]
    // Only a *unique* top/bottom score earns a rank-based label; with ties the
    // choice would be arbitrary.
    if (top.score > ranked[1].score && byBlock[top.block] === 'neutral') byBlock[top.block] = 'peak'
    if (bottom.score < ranked[ranked.length - 2].score && byBlock[bottom.block] === 'neutral') byBlock[bottom.block] = 'trough'
  }

  return {
    target,
    byBlock,
    ranked,
    peaks: ranked.filter((r) => byBlock[r.block] === 'peak').map((r) => r.block),
    troughs: ranked.filter((r) => byBlock[r.block] === 'trough').map((r) => r.block),
  }
}

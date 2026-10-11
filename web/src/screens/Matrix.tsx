import { useMemo } from 'react'
import { Badge, Card, PageHeader, ProgressBar } from '@freeappstore/sdk/ui'
import type { BlockClass } from '../engine/classify'
import type { Confidence } from '../engine/matrix'
import { score1 } from '../lib/format'
import { blockLabel, formatDayShort } from '../lib/dates'
import { useApp } from '../state/appStore'
import { useEngine, type ActiveSlot } from '../state/useEngine'
import { ENERGY_LABEL, ENERGY_SHORT, type BlockId } from '../types'

const CLASS_BADGE: Record<BlockClass, { text: string; variant: 'success' | 'danger' | 'default' | 'warning' }> = {
  peak: { text: 'Peak', variant: 'success' },
  trough: { text: 'Dip', variant: 'danger' },
  neutral: { text: 'Steady', variant: 'default' },
  learning: { text: 'Still learning', variant: 'warning' },
}

const CONFIDENCE_TEXT: Record<Confidence, string> = {
  learning: 'needs 4+ ratings',
  low: 'low confidence',
  ok: 'good confidence',
}

export default function Matrix({ slot }: { slot: ActiveSlot }) {
  const blocks = useApp((s) => s.data.settings.blocks)
  const completions = useApp((s) => s.data.completions)
  const { matrix, classification } = useEngine(slot.day)

  // Habits done (or partly) per (date, block): the completion overlay.
  const doneCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of completions) {
      if (c.status === 'skipped') continue
      const k = `${c.date}|${c.block}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [completions])

  const rows = [...matrix.rows].reverse() // newest first
  const short = (b: BlockId) => blockLabel(b, blocks).slice(0, 3)

  return (
    <>
      <PageHeader title="Energy matrix" description="Your last 14 days, by time block. Newest at the top." />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--muted)]" aria-hidden="true">
        {([3, 2, 1] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="ps-cell w-6" data-level={l}>
              {ENERGY_SHORT[l]}
            </span>
            {ENERGY_LABEL[l]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="ps-cell w-6" />
          Not rated
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="ps-cell w-6">
            <span className="ps-cell-dot" />
          </span>
          Habit done
        </span>
      </div>

      <Card padding="0.75rem">
        <table className="w-full table-fixed border-separate" style={{ borderSpacing: 4 }}>
          <caption className="sr-only">Energy ratings for the last 14 days. Rows are days, columns are time blocks.</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[4.5rem] text-left text-xs font-semibold text-[var(--muted)]">
                <span className="sr-only">Day</span>
              </th>
              {matrix.blocks.map((b) => (
                <th key={b} scope="col" className="text-center text-[0.7rem] font-semibold text-[var(--muted)]">
                  <abbr title={blockLabel(b, blocks)} className="no-underline">
                    {short(b)}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <th scope="row" className="whitespace-nowrap text-left text-[0.7rem] font-medium text-[var(--muted)]">
                  {formatDayShort(row.date).replace(/ \w+$/, '')}
                </th>
                {matrix.blocks.map((b) => {
                  const level = row.cells[b] ?? null
                  const done = doneCount.get(`${row.date}|${b}`) ?? 0
                  const label = `${formatDayShort(row.date)}, ${blockLabel(b, blocks)}: ${level ? `${ENERGY_LABEL[level]} energy` : 'not rated'}${done ? `, ${done} habit${done > 1 ? 's' : ''} done` : ''}`
                  return (
                    <td key={b} className="p-0">
                      <div className="ps-cell" data-level={level ?? undefined} role="img" aria-label={label} title={label}>
                        <span aria-hidden="true">{level ? ENERGY_SHORT[level] : ''}</span>
                        {done > 0 && <span className="ps-cell-dot" aria-hidden="true" />}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 className="ps-section-title">By time block</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {matrix.blocks.map((b) => {
          const s = matrix.stats[b]!
          const cls = classification.byBlock[b] ?? 'learning'
          const badge = CLASS_BADGE[cls]
          return (
            <Card key={b}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">{blockLabel(b, blocks)}</h3>
                <Badge variant={badge.variant}>{badge.text}</Badge>
              </div>
              <p className="mt-1 text-sm">
                Average <strong>{score1(s.score)}</strong> of 3{' '}
                <span className="text-[var(--muted)]">
                  · {s.n} rating{s.n === 1 ? '' : 's'} · {CONFIDENCE_TEXT[s.confidence]}
                </span>
              </p>
              <div className="mt-2" aria-hidden="true">
                <ProgressBar value={s.score ?? 0} max={3} color={cls === 'trough' ? 'var(--danger)' : cls === 'peak' ? 'var(--success)' : 'var(--accent)'} height={6} />
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                High {s.counts[3]} · Medium {s.counts[2]} · Low {s.counts[1]}
                {s.sd !== null && ` · spread ±${s.sd.toFixed(1)}`}
                {s.split && ` · weekdays ${score1(s.split.weekday?.score ?? null)}, weekends ${score1(s.split.weekend.score)}`}
              </p>
            </Card>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">
        Averages weight recent days more (a rating loses half its weight after 7 days). A block needs 4 ratings before it can be called a peak or a dip.
      </p>
    </>
  )
}

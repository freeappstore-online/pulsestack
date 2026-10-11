import { useMemo, useState } from 'react'
import { Card, EmptyState, PageHeader, Tabs } from '@freeappstore/sdk/ui'
import { Lightbulb } from 'lucide-react'
import { RecommendationCard } from '../components/RecommendationCard'
import { computeFacts, type Metric, type SummaryFacts } from '../engine/summary'
import { blockLabel, enabledBlocks, formatDayShort } from '../lib/dates'
import { useApp } from '../state/appStore'
import { useEngine, type ActiveSlot } from '../state/useEngine'
import { templateNarrative } from '../summary/templateNarrative'
import { CATEGORY_LABEL, type TimeBlock } from '../types'

const NOT_ENOUGH = 'not enough data yet'

export default function Insights({ slot }: { slot: ActiveSlot }) {
  const data = useApp((s) => s.data)
  const { recommendations, matrix } = useEngine(slot.day)
  const [period, setPeriod] = useState<30 | 90>(30)
  const facts = useMemo(() => computeFacts(data, slot.day, period), [data, slot.day, period])
  const narrative = useMemo(() => templateNarrative(facts, data.settings.blocks), [facts, data.settings.blocks])
  const blocks = data.settings.blocks

  const learning = enabledBlocks(blocks)
    .map((b) => ({ b, n: matrix.stats[b.id]?.n ?? 0 }))
    .filter((x) => x.n < 4)

  return (
    <>
      <PageHeader title="Insights" description="Patterns in what you logged, with the numbers behind them." />

      <h2 className="ps-section-title">Suggestions</h2>
      {recommendations.length > 0 ? (
        <div className="flex flex-col gap-2">
          {recommendations.map((r) => (
            <RecommendationCard key={r.id} rec={r} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Lightbulb size={28} aria-hidden="true" />}
          title="No suggestions right now"
          message={
            data.habits.filter((h) => !h.archivedAt).length === 0
              ? 'Add a few habits and rate your energy for a week or two.'
              : learning.length > 0
                ? `Still learning: ${learning.map((x) => `${x.b.label} (${x.n} of 4 ratings)`).join(', ')}. Suggestions appear once blocks have enough ratings and a clear difference.`
                : 'Your habits already sit in blocks that suit them, or the differences are too small (under half a level) to be worth a move.'
          }
        />
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="ps-section-title !m-0">Summary</h2>
        <Tabs
          tabs={[
            { key: '30', label: 'Last 30 days' },
            { key: '90', label: 'Last 90 days' },
          ]}
          active={String(period)}
          onChange={(k) => setPeriod(k === '90' ? 90 : 30)}
        />
      </div>
      <div className="mt-3">
        <Card>
          {narrative.insufficient ? (
            <p className="text-sm text-[var(--muted)]">
              Not enough data yet for a summary of the last {period} days. Each statistic needs at least 5 logged events. Keep logging; it fills in on its own.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {narrative.sentences.map((s) => (
                <li key={s.key}>
                  <p className="text-[0.95rem]">{s.text}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{s.basis}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
            These describe your own self-reported ratings and check-offs. They show patterns and changes, not what caused them.
          </p>
        </Card>
      </div>

      <h2 className="ps-section-title">The numbers</h2>
      <FactsTable facts={facts} blocks={blocks} />
    </>
  )
}

const show = (m: Metric, unit = '') => (m.value === null ? NOT_ENOUGH : `${m.value}${unit}`)
const signed = (x: number | null, unit: string) => (x === null ? '–' : `${x > 0 ? '+' : ''}${x}${unit}`)

function FactsTable({ facts: f, blocks }: { facts: SummaryFacts; blocks: TimeBlock[] }) {
  const rows: [string, string, string?][] = [
    ['Period', `${formatDayShort(f.period.start)} – ${formatDayShort(f.period.end)}`],
    ['Baseline (first 14 days)', f.baseline ? `${formatDayShort(f.baseline.start)} – ${formatDayShort(f.baseline.end)}` : 'not available yet (needs history before this period)'],
    ['Weekly targets met', show(f.completion.rate, '%'), `${f.completion.rate.n} check-offs`],
    ['… previous period', show(f.completion.previousRate, '%'), `change ${signed(f.completion.deltaVsPreviousPts, ' pts')}`],
    ['… first 14 days', show(f.completion.baselineRate, '%'), `change ${signed(f.completion.deltaVsBaselinePts, ' pts')}`],
    ...f.categories.map(
      (c): [string, string, string] => [
        `${CATEGORY_LABEL[c.category]} sessions / week`,
        show(c.perWeek),
        `first 14 days: ${show(c.baselinePerWeek)}${c.changeVsBaselinePct !== null ? ` (${signed(c.changeVsBaselinePct, '%')})` : ''}`,
      ],
    ),
    ['High-demand sessions in peak blocks', show(f.alignment.current, '%'), `${f.alignment.current.n} sessions · first 14 days: ${show(f.alignment.baseline, '%')}`],
    ['Days with a check-off', `${f.consistency.activeDays} of ${f.period.days}`, show(f.consistency.rate, '%')],
    ['Streaks', `longest ${f.consistency.longestStreak} · current ${f.consistency.currentStreak}`],
    ['Energy: days logged', `${f.energy.daysLogged}`, `${f.energy.entries} ratings${f.energy.sd !== null ? ` · spread ±${f.energy.sd}` : ''}`],
    ...f.energy.byBlock.map((b): [string, string, string] => [`Energy: ${blockLabel(b.block, blocks)}`, `${b.mean} of 3`, `${b.n} ratings${b.sd !== null ? ` · ±${b.sd}` : ''}`]),
    ['Suggestions', `${f.recs.accepted} accepted · ${f.recs.dismissed} dismissed`],
    ['Sessions/week after a move', f.recs.moves ? `${show(f.recs.after)} after vs ${show(f.recs.before)} before` : 'no accepted moves old enough yet (7+ days)'],
  ]
  return (
    <Card padding="0.25rem 0.75rem">
      <dl className="divide-y divide-[var(--line)]">
        {rows.map(([k, v, extra]) => (
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
            <dt className="text-sm text-[var(--muted)]">{k}</dt>
            <dd className="text-right text-sm">
              <span className="font-semibold">{v}</span>
              {extra && <span className="block text-xs text-[var(--muted)]">{extra}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

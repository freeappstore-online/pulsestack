import { useMemo, useState } from 'react'
import { Badge, Card, EmptyState, Modal, PageHeader, useToast } from '@freeappstore/sdk/ui'
import { Check, CircleDashed, Ellipsis, Lightbulb, ListPlus, Pin, Save, Sparkles } from 'lucide-react'
import { EnergyPicker } from '../components/EnergyPicker'
import { HabitForm } from '../components/HabitForm'
import { InstallPrompt } from '../components/InstallPrompt'
import { Segmented } from '../components/Segmented'
import { orderToday, type TodayItem } from '../engine/today'
import { exportDue } from '../lib/backup'
import { blockLabel, enabledBlocks, formatDayShort, toDateKey } from '../lib/dates'
import { useApp } from '../state/appStore'
import { useEngine, type ActiveSlot } from '../state/useEngine'
import { useExportAction } from '../state/useExportAction'
import { CATEGORY_LABEL, ENERGY_LABEL, ENERGY_SHORT, type BlockId, type CompletionStatus, type EnergyLevel } from '../types'

interface Props {
  now: Date
  slot: ActiveSlot
  navigate: (href: string) => void
}

export default function Today({ now, slot, navigate }: Props) {
  const data = useApp((s) => s.data)
  const logEnergy = useApp((s) => s.logEnergy)
  const toast = useToast()
  const engine = useEngine(slot.day)
  const doExport = useExportAction()
  const [targetBlock, setTargetBlock] = useState<BlockId | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TodayItem | null>(null)

  const blocks = enabledBlocks(data.settings.blocks)
  const ratingBlock = targetBlock ?? slot.block ?? blocks[0]?.id ?? null
  const levelFor = (b: BlockId) => data.energy.find((e) => e.date === slot.day && e.block === b)?.level ?? null
  const currentLevel = ratingBlock ? levelFor(ratingBlock) : null
  const isLateNight = slot.day !== toDateKey(now)

  const items = useMemo(
    () =>
      orderToday({
        habits: data.habits,
        assignments: engine.assignments,
        matrix: engine.matrix,
        blocks: data.settings.blocks,
        currentBlock: slot.block,
        completions: data.completions,
        today: slot.day,
      }),
    [data.habits, data.completions, data.settings.blocks, engine, slot],
  )

  const onPick = (level: EnergyLevel) => {
    if (!ratingBlock) return
    logEnergy(slot.day, ratingBlock, level)
    toast.show(`Logged: ${blockLabel(ratingBlock, data.settings.blocks)} ${ENERGY_LABEL[level]}`, { variant: 'success' })
  }

  const needsCheckIn = slot.block !== null && levelFor(slot.block) === null
  const recCount = engine.recommendations.length

  return (
    <>
      <PageHeader
        title="Today"
        description={`${formatDayShort(slot.day)}${isLateNight ? ' (late night: still counts for this day)' : ''}`}
      />

      {blocks.length === 0 ? (
        <EmptyState title="No time blocks" message="Turn on at least one time block in Settings to start logging." />
      ) : (
        <Card>
          <h2 className="text-base font-bold" id="energy-heading">
            {ratingBlock ? `${blockLabel(ratingBlock, data.settings.blocks)} energy` : 'Energy'}
          </h2>
          <p className="mb-3 text-sm text-[var(--muted)]" aria-live="polite">
            {ratingBlock === slot.block && needsCheckIn
              ? `How’s your energy right now? You haven’t rated ${blockLabel(slot.block!, data.settings.blocks)} yet.`
              : currentLevel
                ? `Rated ${ENERGY_LABEL[currentLevel]}. Tap another level to change it.`
                : 'Not rated yet.'}
          </p>
          <EnergyPicker label={`Energy for ${ratingBlock ? blockLabel(ratingBlock, data.settings.blocks) : ''}`} value={currentLevel} onPick={onPick} />

          <div className="mt-4">
            <p className="ps-label">Rate another block today</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose block to rate">
              {blocks.map((b) => {
                const lvl = levelFor(b.id)
                const selected = b.id === ratingBlock
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`ps-btn ps-btn-sm ${selected ? 'ps-btn-primary' : ''}`}
                    aria-pressed={selected}
                    aria-label={`${b.label}${b.id === slot.block ? ' (now)' : ''}: ${lvl ? `${ENERGY_LABEL[lvl]} energy` : 'not rated'}`}
                    onClick={() => setTargetBlock(b.id === slot.block ? null : b.id)}
                  >
                    {b.label}
                    <span aria-hidden="true" className="opacity-80">
                      {lvl ? ENERGY_SHORT[lvl] : '–'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </Card>
      )}

      {recCount > 0 && (
        <div className="mt-3">
          <Card onClick={() => navigate('/insights')}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb size={18} aria-hidden="true" className="text-[var(--accent)]" />
              {recCount === 1 ? '1 schedule suggestion' : `${recCount} schedule suggestions`}, with the numbers behind them →
            </span>
          </Card>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        <InstallPrompt />
        {exportDue(data, toDateKey(now)) && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm">
                <strong>Back up your log.</strong>{' '}
                <span className="text-[var(--muted)]">It lives only in this browser; a monthly export keeps it safe.</span>
              </p>
              <button type="button" className="ps-btn ps-btn-sm" onClick={doExport}>
                <Save size={16} aria-hidden="true" /> Export
              </button>
            </div>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="ps-section-title">Habits</h2>
        {items.length > 0 && (
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm mt-3" onClick={() => setAdding(true)}>
            <ListPlus size={16} aria-hidden="true" /> Add
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={28} aria-hidden="true" />}
          title="No habits yet"
          message="Add the habits you want to fit around your energy. Rating your energy works without any."
          action={
            <button type="button" className="ps-btn ps-btn-primary" onClick={() => setAdding(true)}>
              Add a habit
            </button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Today’s habits">
          {items.map((item) => (
            <HabitRow key={item.habit.id} item={item} slot={slot} onMore={() => setEditing(item)} />
          ))}
        </ul>
      )}

      {adding && <HabitForm open onClose={() => setAdding(false)} />}
      {editing && <CompletionModal item={editing} slot={slot} onClose={() => setEditing(null)} />}
    </>
  )
}

const STATUS_TEXT: Record<CompletionStatus, string> = { done: 'Done', partial: 'Partly done', skipped: 'Skipped' }

function HabitRow({ item, slot, onMore }: { item: TodayItem; slot: ActiveSlot; onMore: () => void }) {
  const blocks = useApp((s) => s.data.settings.blocks)
  const setCompletion = useApp((s) => s.setCompletion)
  const toast = useToast()
  const { habit, status, block, source, thisWeek } = item
  const logBlock = slot.block ?? block ?? enabledBlocks(blocks)[0]?.id ?? 'morning'

  const toggle = () => {
    if (status) {
      setCompletion(slot.day, habit.id, logBlock, null)
      toast.show(`${habit.name}: cleared`)
    } else {
      setCompletion(slot.day, habit.id, logBlock, 'done')
      toast.show(`${habit.name}: done`, { variant: 'success' })
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-[0.75rem] border border-[var(--line)] bg-[var(--panel)] p-1.5 pr-1">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={status !== null}
        aria-label={status ? `${habit.name}: ${STATUS_TEXT[status]}. Tap to clear` : `Mark ${habit.name} done`}
        className="ps-btn ps-icon-btn shrink-0"
        style={status === 'done' ? { background: 'var(--energy-high)', borderColor: 'var(--success)' } : undefined}
      >
        {status === 'done' ? (
          <Check size={20} aria-hidden="true" />
        ) : status ? (
          <span aria-hidden="true" className="text-xs font-bold">
            {status === 'partial' ? '½' : '–'}
          </span>
        ) : (
          <CircleDashed size={20} aria-hidden="true" className="text-[var(--muted)]" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[0.95rem] font-semibold ${status === 'skipped' ? 'line-through opacity-60' : ''}`}>{habit.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
          {block && (
            <span className="inline-flex items-center gap-1">
              {source === 'pinned' ? <Pin size={12} aria-label="Pinned" /> : source === 'suggested' ? <Sparkles size={12} aria-label="Suggested" /> : null}
              {blockLabel(block, blocks)}
            </span>
          )}
          <span>{CATEGORY_LABEL[habit.category]}</span>
          <span>
            {Number.isInteger(thisWeek) ? thisWeek : thisWeek.toFixed(1)}/{habit.targetPerWeek} this week
          </span>
        </p>
      </div>
      {status && status !== 'done' && <Badge variant={status === 'partial' ? 'warning' : 'default'}>{STATUS_TEXT[status]}</Badge>}
      <button type="button" className="ps-btn ps-btn-ghost ps-icon-btn shrink-0" aria-label={`More options for ${habit.name}`} onClick={onMore}>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </li>
  )
}

function CompletionModal({ item, slot, onClose }: { item: TodayItem; slot: ActiveSlot; onClose: () => void }) {
  const blocks = useApp((s) => s.data.settings.blocks)
  const existing = useApp((s) => s.data.completions.find((c) => c.date === slot.day && c.habitId === item.habit.id))
  const setCompletion = useApp((s) => s.setCompletion)
  const toast = useToast()
  const [status, setStatus] = useState<CompletionStatus | 'none'>(existing?.status ?? 'done')
  // Default block: the one containing "now" (CLAUDE.md §3), changeable.
  const [block, setBlock] = useState<BlockId>(existing?.block ?? slot.block ?? item.block ?? enabledBlocks(blocks)[0]?.id ?? 'morning')

  const save = () => {
    setCompletion(slot.day, item.habit.id, block, status === 'none' ? null : status)
    toast.show(status === 'none' ? `${item.habit.name}: cleared` : `${item.habit.name}: ${STATUS_TEXT[status].toLowerCase()}`, { variant: 'success' })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={item.habit.name} maxWidth={420}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="ps-label" aria-hidden="true">
            Status for {formatDayShort(slot.day)}
          </span>
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            className="grid grid-cols-2 gap-2 ps-seg"
            options={[
              { value: 'done', label: 'Done' },
              { value: 'partial', label: 'Partly' },
              { value: 'skipped', label: 'Skipped' },
              { value: 'none', label: 'Not logged' },
            ]}
          />
        </div>
        <div>
          <label className="ps-label" htmlFor="completion-block">
            Time block
          </label>
          <select id="completion-block" className="ps-select" value={block} onChange={(e) => setBlock(e.target.value as BlockId)}>
            {enabledBlocks(blocks).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="ps-btn ps-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ps-btn ps-btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

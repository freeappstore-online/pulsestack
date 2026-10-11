import { useState, type FormEvent } from 'react'
import { Modal, useToast } from '@freeappstore/sdk/ui'
import { enabledBlocks } from '../lib/dates'
import { useApp } from '../state/appStore'
import { CATEGORIES, CATEGORY_LABEL, type BlockId, type Category, type Demand, type Habit } from '../types'
import { Segmented } from './Segmented'

interface Props {
  open: boolean
  habit?: Habit
  onClose: () => void
}

const DEMAND_OPTIONS: { value: Demand; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

/** Create/edit a habit. Mount with a `key` per habit so the form resets. */
export function HabitForm({ open, habit, onClose }: Props) {
  const saveHabit = useApp((s) => s.saveHabit)
  const setArchived = useApp((s) => s.setArchived)
  const blocks = useApp((s) => s.data.settings.blocks)
  const toast = useToast()
  const [name, setName] = useState(habit?.name ?? '')
  const [category, setCategory] = useState<Category>(habit?.category ?? 'deep-focus')
  const [demand, setDemand] = useState<Demand>(habit?.demand ?? 'high')
  const [target, setTarget] = useState(habit?.targetPerWeek ?? 5)
  const [pinned, setPinned] = useState<BlockId | ''>(habit?.pinnedBlock ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the habit a name.')
      return
    }
    saveHabit({ id: habit?.id, name, category, demand, targetPerWeek: target, pinnedBlock: pinned || undefined })
    toast.show(habit ? 'Habit updated' : 'Habit added', { variant: 'success' })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={habit ? 'Edit habit' : 'New habit'} maxWidth={480}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <label className="ps-label" htmlFor="habit-name">
            Name
          </label>
          <input
            id="habit-name"
            className="ps-input"
            value={name}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'habit-name-error' : undefined}
            placeholder="e.g. Study Spanish"
          />
          {error && (
            <p id="habit-name-error" className="mt-1 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>

        <div>
          <label className="ps-label" htmlFor="habit-category">
            Category
          </label>
          <select id="habit-category" className="ps-select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="ps-label" aria-hidden="true">
            Energy it needs
          </span>
          <Segmented label="Energy it needs" value={demand} onChange={setDemand} options={DEMAND_OPTIONS} />
          <p className="mt-1 text-xs text-[var(--muted)]">High-demand habits are suggested for your peak blocks; low-demand ones for your dips.</p>
        </div>

        <div>
          <label className="ps-label" htmlFor="habit-target">
            Times per week: {target}
          </label>
          <input
            id="habit-target"
            type="range"
            min={1}
            max={7}
            step={1}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
            style={{ minHeight: 44 }}
          />
        </div>

        <div>
          <label className="ps-label" htmlFor="habit-pin">
            Pin to a time block (optional)
          </label>
          <select id="habit-pin" className="ps-select" value={pinned} onChange={(e) => setPinned(e.target.value as BlockId | '')}>
            <option value="">Not pinned: let PulseStack suggest</option>
            {enabledBlocks(blocks).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">Pinned habits are never moved.</p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {habit && !habit.archivedAt && (
            <button
              type="button"
              className="ps-btn ps-btn-danger mr-auto"
              onClick={() => {
                setArchived(habit.id, true)
                toast.show(`${habit.name} archived. Its history is kept.`, { variant: 'success' })
                onClose()
              }}
            >
              Archive
            </button>
          )}
          <button type="button" className="ps-btn ps-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ps-btn ps-btn-primary">
            {habit ? 'Save' : 'Add habit'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

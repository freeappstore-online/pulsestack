import { useState } from 'react'
import { ConfirmDialog, EmptyState, ListRow, PageHeader, Tabs, useToast } from '@freeappstore/sdk/ui'
import { Archive, ArchiveRestore, Pin, Plus } from 'lucide-react'
import { HabitForm } from '../components/HabitForm'
import { blockLabel } from '../lib/dates'
import { useApp } from '../state/appStore'
import { CATEGORY_LABEL, type Habit } from '../types'

const DEMAND_TEXT = { high: 'High demand', medium: 'Medium demand', low: 'Low demand' } as const

export default function Habits() {
  const habits = useApp((s) => s.data.habits)
  const blocks = useApp((s) => s.data.settings.blocks)
  const setArchived = useApp((s) => s.setArchived)
  const toast = useToast()
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)
  const [confirm, setConfirm] = useState<Habit | null>(null)

  const list = habits.filter((h) => (tab === 'active' ? !h.archivedAt : h.archivedAt)).sort((a, b) => a.name.localeCompare(b.name))
  const subtitle = (h: Habit) =>
    [CATEGORY_LABEL[h.category], DEMAND_TEXT[h.demand], `${h.targetPerWeek}×/week`, h.pinnedBlock && `Pinned: ${blockLabel(h.pinnedBlock, blocks)}`]
      .filter(Boolean)
      .join(' · ')

  const toggleArchive = (h: Habit) => {
    const archiving = !h.archivedAt
    setArchived(h.id, archiving)
    toast.show(archiving ? `${h.name} archived. Its history is kept.` : `${h.name} restored`, { variant: 'success' })
    setConfirm(null)
  }

  return (
    <>
      <PageHeader
        title="Habits"
        description="What you want to fit around your energy."
        actions={
          <button type="button" className="ps-btn ps-btn-primary" onClick={() => setEditing('new')}>
            <Plus size={18} aria-hidden="true" /> New habit
          </button>
        }
      />
      <div className="mb-3">
        <Tabs
          tabs={[
            { key: 'active', label: `Active (${habits.filter((h) => !h.archivedAt).length})` },
            { key: 'archived', label: `Archived (${habits.filter((h) => h.archivedAt).length})` },
          ]}
          active={tab}
          onChange={(k) => setTab(k as 'active' | 'archived')}
        />
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={tab === 'active' ? 'No habits yet' : 'Nothing archived'}
          message={
            tab === 'active'
              ? 'Add a habit and say how much energy it takes. PulseStack will learn when it fits best.'
              : 'Archived habits keep their history and can be restored at any time.'
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-[var(--panel)]">
          {list.map((h) => (
            <li key={h.id}>
              <ListRow
                title={h.name}
                subtitle={subtitle(h)}
                icon={h.pinnedBlock ? <Pin size={16} aria-hidden="true" /> : undefined}
                trailing={tab === 'archived' ? <ArchiveRestore size={18} aria-hidden="true" /> : <span className="text-xs text-[var(--muted)]">Edit</span>}
                onClick={() => (tab === 'archived' ? setConfirm(h) : setEditing(h))}
              />
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <HabitForm key={editing === 'new' ? 'new' : editing.id} open habit={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {tab === 'active' && list.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Archive size={14} aria-hidden="true" /> To archive a habit, open it and choose Archive.
        </p>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.archivedAt ? 'Restore habit?' : 'Archive habit?'}
        message={confirm?.archivedAt ? `${confirm.name} will appear on Today again.` : `${confirm?.name ?? ''} will be hidden from Today. Its history is kept.`}
        confirmLabel={confirm?.archivedAt ? 'Restore' : 'Archive'}
        onConfirm={() => confirm && toggleArchive(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}

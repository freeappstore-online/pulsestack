import { Badge, Card, useToast } from '@freeappstore/sdk/ui'
import { Check, Pin, X } from 'lucide-react'
import type { Recommendation } from '../engine/recommend'
import { REASON_TEXT, evidenceLines, recTitle } from '../lib/format'
import { blockLabel } from '../lib/dates'
import { useApp } from '../state/appStore'

/** A suggestion with the numbers it rests on, and Accept / Dismiss (CLAUDE.md §1.3, §1.5). */
export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const habit = useApp((s) => s.data.habits.find((h) => h.id === rec.habitId))
  const blocks = useApp((s) => s.data.settings.blocks)
  const giveFeedback = useApp((s) => s.giveFeedback)
  const saveHabit = useApp((s) => s.saveHabit)
  const toast = useToast()
  if (!habit) return null

  const accept = () => {
    giveFeedback(rec.habitId, rec.to, 'accepted')
    toast.show(`${habit.name} planned for ${blockLabel(rec.to, blocks)}`, { variant: 'success' })
  }
  const pin = () => {
    giveFeedback(rec.habitId, rec.to, 'accepted')
    saveHabit({ ...habit, pinnedBlock: rec.to })
    toast.show(`${habit.name} pinned to ${blockLabel(rec.to, blocks)}`, { variant: 'success' })
  }
  const dismiss = () => {
    giveFeedback(rec.habitId, rec.to, 'dismissed')
    toast.show('Dismissed. You won’t see this suggestion for a week.')
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent">{rec.kind === 'move' ? 'Suggested move' : 'Suggested block'}</Badge>
        <span className="text-xs text-[var(--muted)]">{REASON_TEXT[rec.reason]}</span>
      </div>
      <h3 className="mt-2 text-base font-bold">{recTitle(rec, habit.name, blocks)}</h3>
      <ul className="mt-1 space-y-1 text-sm text-[var(--muted)]">
        {evidenceLines(rec, habit.name, blocks).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-[var(--muted)]">Based on your own ratings and check-offs over the last 14 days. It’s a suggestion, not a rule.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="ps-btn ps-btn-primary ps-btn-sm" onClick={accept}>
          <Check size={16} aria-hidden="true" /> Accept
        </button>
        <button type="button" className="ps-btn ps-btn-sm" onClick={pin}>
          <Pin size={16} aria-hidden="true" /> Pin here
        </button>
        <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={dismiss}>
          <X size={16} aria-hidden="true" /> Dismiss
        </button>
      </div>
    </Card>
  )
}

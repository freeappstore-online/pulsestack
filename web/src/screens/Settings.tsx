import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Badge, Card, ConfirmDialog, PageHeader, useToast } from '@freeappstore/sdk/ui'
import { Download, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Segmented } from '../components/Segmented'
import { exportDue } from '../lib/backup'
import { formatHour, toDateKey } from '../lib/dates'
import { isPersisted, notificationsSupported, requestPersistence, storageEstimate } from '../lib/platform'
import { useApp } from '../state/appStore'
import { useExportAction } from '../state/useExportAction'
import { StorageError } from '../storage/store'
import { validateBlocks } from '../storage/schema'
import type { ImportReport } from '../storage/merge'
import type { TimeBlock } from '../types'

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <BlocksSection />
      <PlanningSection />
      <RemindersSection />
      <DataSection />
      <AboutSection />
    </>
  )
}

const HOURS = Array.from({ length: 25 }, (_, i) => i)

function BlocksSection() {
  const saved = useApp((s) => s.data.settings.blocks)
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useToast()
  const [draft, setDraft] = useState<TimeBlock[]>(saved)
  useEffect(() => setDraft(saved), [saved])
  const error = validateBlocks(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const patch = (i: number, p: Partial<TimeBlock>) => setDraft((d) => d.map((b, j) => (j === i ? { ...b, ...p } : b)))

  return (
    <section aria-labelledby="blocks-h">
      <h2 id="blocks-h" className="ps-section-title">
        Time blocks
      </h2>
      <Card>
        <p className="mb-3 text-sm text-[var(--muted)]">Your day split into blocks you rate. Turn off blocks you’re asleep or unavailable for.</p>
        <ul className="flex flex-col gap-3">
          {draft.map((b, i) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-[44px] min-w-[7.5rem] flex-1 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={b.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                {b.label}
              </label>
              <span className="flex items-center gap-1 text-sm">
                <select
                  className="ps-select !w-auto"
                  aria-label={`${b.label} start`}
                  value={b.startHour}
                  disabled={!b.enabled}
                  onChange={(e) => patch(i, { startHour: Number(e.target.value) })}
                >
                  {HOURS.slice(0, 24).map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">–</span>
                <select
                  className="ps-select !w-auto"
                  aria-label={`${b.label} end`}
                  value={b.endHour}
                  disabled={!b.enabled}
                  onChange={(e) => patch(i, { endHour: Number(e.target.value) })}
                >
                  {HOURS.slice(1).map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? '24:00' : formatHour(h)}
                    </option>
                  ))}
                </select>
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="ps-btn ps-btn-primary"
            disabled={!dirty || error !== null}
            onClick={() => {
              updateSettings({ blocks: draft })
              toast.show('Time blocks saved', { variant: 'success' })
            }}
          >
            Save blocks
          </button>
          {dirty && (
            <button type="button" className="ps-btn ps-btn-ghost" onClick={() => setDraft(saved)}>
              Undo changes
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Changing hours doesn’t move past ratings; they stay with the block they were logged in.</p>
      </Card>
    </section>
  )
}

function PlanningSection() {
  const cap = useApp((s) => s.data.settings.capacityHighPerBlock)
  const updateSettings = useApp((s) => s.updateSettings)
  return (
    <section aria-labelledby="plan-h">
      <h2 id="plan-h" className="ps-section-title">
        Suggestions
      </h2>
      <Card>
        <p className="ps-label" aria-hidden="true">
          High-demand habits per block
        </p>
        <Segmented
          label="High-demand habits per block"
          value={cap}
          onChange={(v) => updateSettings({ capacityHighPerBlock: v })}
          options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
        />
        <p className="mt-2 text-xs text-[var(--muted)]">The most demanding habits PulseStack will suggest for the same peak block.</p>
      </Card>
    </section>
  )
}

function RemindersSection() {
  const enabled = useApp((s) => s.data.settings.remindersEnabled)
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useToast()
  const supported = notificationsSupported()
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied')

  const toggle = async (on: boolean) => {
    if (on && supported && Notification.permission === 'default') {
      const p = await Notification.requestPermission()
      setPermission(p)
      if (p !== 'granted') {
        toast.show('Notifications are blocked; the in-app reminder still works.', { variant: 'error' })
        return
      }
    }
    updateSettings({ remindersEnabled: on })
  }

  return (
    <section aria-labelledby="rem-h">
      <h2 id="rem-h" className="ps-section-title">
        Reminders
      </h2>
      <Card>
        <p className="text-sm">Today always nudges you when the current block hasn’t been rated.</p>
        <label className="mt-3 flex min-h-[44px] items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={enabled && permission === 'granted'}
            disabled={!supported || permission === 'denied'}
            onChange={(e) => void toggle(e.target.checked)}
          />
          Notify me when a new block starts
        </label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {!supported
            ? 'This browser doesn’t support notifications.'
            : permission === 'denied'
              ? 'Notifications are blocked for this site in your browser settings.'
              : 'Only while PulseStack is open (or installed and running). There are no background reminders: nothing runs on a server.'}
        </p>
      </Card>
    </section>
  )
}

function reportText(r: ImportReport): string {
  const added = r.habits.added + r.energy.added + r.completions.added + r.feedback.added
  const updated = r.habits.updated + r.energy.updated + r.completions.updated
  const parts = [`${added} added`, `${updated} updated`]
  if (r.rejected) parts.push(`${r.rejected} invalid row${r.rejected > 1 ? 's' : ''} skipped`)
  return `Imported: ${parts.join(', ')}.`
}

function DataSection() {
  const data = useApp((s) => s.data)
  const storeKind = useApp((s) => s.storeKind)
  const persisted = useApp((s) => s.persisted)
  const setPersisted = useApp((s) => s.setPersisted)
  const importJSON = useApp((s) => s.importJSON)
  const wipe = useApp((s) => s.wipe)
  const toast = useToast()
  const doExport = useExportAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [lastReport, setLastReport] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  useEffect(() => {
    void isPersisted().then(setPersisted)
    void storageEstimate().then(setEstimate)
  }, [setPersisted, data])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const report = importJSON(await file.text())
      const text = reportText(report)
      setLastReport(text + (report.settingsAdopted ? ' Settings from the file were applied.' : ' Your current settings were kept.'))
      toast.show(text, { variant: 'success' })
    } catch (err) {
      toast.show(err instanceof StorageError ? err.message : 'Could not import that file.', { variant: 'error' })
    }
  }

  const askPersist = async () => {
    const r = await requestPersistence()
    setPersisted(r)
    toast.show(r ? 'The browser will keep PulseStack’s data.' : 'The browser declined. Installing the app usually helps.', { variant: r ? 'success' : 'info' })
  }

  const lastExport = data.settings.lastExportAt
  const counts = `${data.habits.length} habits · ${data.energy.length} energy ratings · ${data.completions.length} check-offs`

  return (
    <section aria-labelledby="data-h">
      <h2 id="data-h" className="ps-section-title">
        Your data
      </h2>
      <Card>
        <p className="flex items-start gap-2 text-sm">
          <ShieldCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--success)]" />
          <span>
            Stored only in this browser on this device. Nothing is uploaded.
            <span className="block text-xs text-[var(--muted)]">{counts}</span>
          </span>
        </p>
        {storeKind === 'memory' && (
          <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
            Browser storage is unavailable (private browsing or blocked site data). Nothing will be kept after this tab closes. Export before leaving.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            Persistent storage{' '}
            <Badge variant={persisted ? 'success' : persisted === false ? 'warning' : 'default'}>
              {persisted ? 'Granted' : persisted === false ? 'Not granted' : 'Not supported'}
            </Badge>
            <span className="block text-xs text-[var(--muted)]">
              {persisted ? 'The browser won’t clear this data to free space.' : 'The browser may clear this data if space runs low or the site goes unused.'}
              {estimate && estimate.usage > 0 && ` Using ${(estimate.usage / 1024).toFixed(0)} KB.`}
            </span>
          </div>
          {persisted === false && (
            <button type="button" className="ps-btn ps-btn-sm" onClick={() => void askPersist()}>
              Ask to keep data
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <p className="text-sm font-semibold">Backup</p>
          <p className="text-xs text-[var(--muted)]">
            {lastExport ? `Last exported ${toDateKey(new Date(lastExport))}.` : 'Never exported.'}{' '}
            {exportDue(data, toDateKey(new Date())) && <strong className="text-[var(--warning)]">A fresh backup is due. </strong>}
            Export about once a month. Importing merges with what’s here: newer entries win, nothing is deleted.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="ps-btn" onClick={doExport}>
              <Download size={16} aria-hidden="true" /> Export JSON
            </button>
            <button type="button" className="ps-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Import JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />
          </div>
          {lastReport && (
            <p className="mt-2 text-xs text-[var(--muted)]" aria-live="polite">
              {lastReport}
            </p>
          )}
        </div>

        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <button type="button" className="ps-btn ps-btn-danger" onClick={() => setConfirmWipe(true)}>
            <Trash2 size={16} aria-hidden="true" /> Delete all data
          </button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmWipe}
        variant="danger"
        title="Delete all PulseStack data?"
        message="This removes every habit, rating, check-off and setting from this browser. It can’t be undone. Export first if you might want it back."
        confirmLabel="Delete everything"
        onCancel={() => setConfirmWipe(false)}
        onConfirm={() => {
          wipe()
          setConfirmWipe(false)
          toast.show('All data deleted', { variant: 'success' })
        }}
      />
    </section>
  )
}

function AboutSection() {
  return (
    <section aria-labelledby="about-h">
      <h2 id="about-h" className="ps-section-title">
        About
      </h2>
      <Card>
        <p className="text-sm">
          <strong>PulseStack</strong> learns when your energy is high and low, and suggests when to do each habit.
        </p>
        <p className="mt-2 text-sm">
          <strong>No account needed; your data never leaves this device.</strong> The Sign in button in the top bar belongs to the FreeAppStore platform. Signing in does
          nothing for PulseStack: your habits are never synced or uploaded.
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Suggestions come from simple, transparent rules applied to what you log. PulseStack describes patterns; it can’t tell you what caused them, and it isn’t medical advice.
        </p>
        <p className="mt-3 text-sm">
          Free and open source (MIT), no tracking. Part of{' '}
          <a href="https://freeappstore.online" className="font-semibold text-[var(--accent)] underline" target="_blank" rel="noopener">
            FreeAppStore
          </a>
          .
        </p>
      </Card>
    </section>
  )
}

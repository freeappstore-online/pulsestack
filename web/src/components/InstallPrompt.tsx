import { useEffect, useState } from 'react'
import { Card, useStandalone } from '@freeappstore/sdk/ui'
import { Smartphone } from 'lucide-react'
import { daysBetween, toDateKey } from '../lib/dates'
import { canPromptInstall, isIos, onInstallAvailabilityChange, promptInstall } from '../lib/platform'
import { useApp } from '../state/appStore'

/** Distinct days with any log before we ask (decision.md D-017). */
export const INSTALL_AFTER_DAYS = 3
const SNOOZE_DAYS = 14

/**
 * "Install PulseStack" card. Installing to the home screen is the best defence
 * against Safari evicting the data of sites you haven't visited in a while.
 */
export function InstallPrompt() {
  const standalone = useStandalone()
  const energy = useApp((s) => s.data.energy)
  const completions = useApp((s) => s.data.completions)
  const dismissedAt = useApp((s) => s.data.settings.installPromptDismissedAt)
  const updateSettings = useApp((s) => s.updateSettings)
  const [available, setAvailable] = useState(canPromptInstall)
  useEffect(() => onInstallAvailabilityChange(() => setAvailable(canPromptInstall())), [])

  const today = toDateKey(new Date())
  const usedDays = new Set([...energy.map((e) => e.date), ...completions.map((c) => c.date)]).size
  const snoozed = dismissedAt ? daysBetween(toDateKey(new Date(dismissedAt)), today) < SNOOZE_DAYS : false
  const ios = isIos()
  if (standalone || snoozed || usedDays < INSTALL_AFTER_DAYS || (!available && !ios)) return null

  const later = () => updateSettings({ installPromptDismissedAt: new Date().toISOString() })

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Smartphone size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <h2 className="text-base font-bold">Keep your data safe: install PulseStack</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Your log lives only in this browser. Installed apps are far less likely to have their data cleared by the browser.
            {ios && ' On iPhone/iPad: tap Share, then “Add to Home Screen”.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {available && (
              <button type="button" className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => void promptInstall()}>
                Install
              </button>
            )}
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={later}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

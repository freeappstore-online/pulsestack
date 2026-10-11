import { lazy, useEffect, useState } from 'react'
import { BuildInfo, type NavItem, Shell } from '@freeappstore/sdk/ui'
import { CalendarCheck, Grid3x3, Lightbulb, ListChecks, Settings as SettingsIcon } from 'lucide-react'
import { StorageNotices } from './components/StorageNotices'
import { fas } from './fas'
import { requestPersistence } from './lib/platform'
import Habits from './screens/Habits'
import Settings from './screens/Settings'
import Today from './screens/Today'
import { useApp } from './state/appStore'
import { useActiveSlot, useNow } from './state/useEngine'
import { useReminders } from './state/useReminders'

// Matrix and Insights are lazy so the main chunk stays small (CLAUDE.md §2).
const Matrix = lazy(() => import('./screens/Matrix'))
const Insights = lazy(() => import('./screens/Insights'))

const icon = (I: typeof CalendarCheck) => <I size={16} aria-hidden="true" />

const NAV: NavItem[] = [
  { label: 'Today', href: '/', title: 'PulseStack', icon: icon(CalendarCheck) },
  { label: 'Matrix', href: '/matrix', title: 'Energy matrix — PulseStack', icon: icon(Grid3x3) },
  { label: 'Habits', href: '/habits', title: 'Habits — PulseStack', icon: icon(ListChecks) },
  { label: 'Insights', href: '/insights', title: 'Insights — PulseStack', icon: icon(Lightbulb) },
  { label: 'Settings', href: '/settings', title: 'Settings — PulseStack', icon: icon(SettingsIcon) },
]
const KNOWN = new Set(NAV.map((n) => n.href))

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const now = useNow()
  const slot = useActiveSlot(now)
  useReminders(slot)

  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Load local data, then (first launch only) ask the browser to persist it (CLAUDE.md §4).
  useEffect(() => {
    init()
    const { data, setPersisted, updateSettings } = useApp.getState()
    if (!data.settings.persistRequestedAt) {
      void requestPersistence().then((r) => {
        setPersisted(r)
        updateSettings({ persistRequestedAt: new Date().toISOString() })
      })
    }
  }, [init])

  const navigate = (href: string) => {
    window.history.pushState(null, '', href)
    setPath(href)
  }

  const route = KNOWN.has(path) ? path : '/'

  return (
    <Shell app={fas} appName="PulseStack" nav={NAV} onNavigate={navigate}>
      <StorageNotices />
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-8 sm:pt-8">
        {!ready ? null : route === '/matrix' ? (
          <Matrix slot={slot} />
        ) : route === '/habits' ? (
          <Habits />
        ) : route === '/insights' ? (
          <Insights slot={slot} />
        ) : route === '/settings' ? (
          <Settings />
        ) : (
          <Today now={now} slot={slot} navigate={navigate} />
        )}
      </div>
      <BuildInfo />
    </Shell>
  )
}

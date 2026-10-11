// Browser capabilities used for data safety (CLAUDE.md §4) and reminders (§7).
// Everything is feature-detected; nothing here makes a network request.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredInstall: BeforeInstallPromptEvent | null = null
const installListeners = new Set<() => void>()

/** Call once at startup, before React renders, so the early event isn't missed. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstall = e as BeforeInstallPromptEvent
    installListeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    installListeners.forEach((l) => l())
  })
}

export function canPromptInstall(): boolean {
  return deferredInstall !== null
}

export function onInstallAvailabilityChange(l: () => void): () => void {
  installListeners.add(l)
  return () => installListeners.delete(l)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredInstall) return false
  const ev = deferredInstall
  deferredInstall = null
  await ev.prompt()
  const { outcome } = await ev.userChoice
  installListeners.forEach((l) => l())
  return outcome === 'accepted'
}

/** iOS Safari never fires beforeinstallprompt; it needs Share → Add to Home Screen. */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** `navigator.storage.persist()` where supported. null = API not available. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const e = await navigator.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Shows a notification while the app is open. Prefers the service worker (required on Android Chrome). */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, { body, icon: '/icon-192.png', tag: 'pulsestack-checkin' })
      return
    }
  } catch {
    // fall through to the page-level API
  }
  try {
    new Notification(title, { body, icon: '/icon-192.png', tag: 'pulsestack-checkin' })
  } catch {
    // Some browsers only allow SW notifications; nothing more we can do.
  }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

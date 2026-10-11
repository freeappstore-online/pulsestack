import { useEffect } from 'react'
import { useToast } from '@freeappstore/sdk/ui'
import { useApp } from '../state/appStore'

/** Turns store notices (storage errors, load problems) into Shell toasts. Renders nothing. */
export function StorageNotices() {
  const notices = useApp((s) => s.notices)
  const dismiss = useApp((s) => s.dismissNotice)
  const toast = useToast()
  useEffect(() => {
    for (const n of notices) {
      // Errors stay until dismissed: a failed save must not flash past unseen.
      toast.show(n.message, { variant: n.variant, duration: n.variant === 'error' ? 0 : 4000 })
      dismiss(n.id)
    }
  }, [notices, dismiss, toast])
  return null
}

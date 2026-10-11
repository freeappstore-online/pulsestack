import { useToast } from '@freeappstore/sdk/ui'
import { exportFilename } from '../lib/backup'
import { toDateKey } from '../lib/dates'
import { downloadText } from '../lib/platform'
import { useApp } from './appStore'

/** Download a JSON backup and record the export time. */
export function useExportAction() {
  const exportJSON = useApp((s) => s.exportJSON)
  const toast = useToast()
  return () => {
    try {
      downloadText(exportFilename(toDateKey(new Date())), exportJSON())
      toast.show('Exported. Keep the file somewhere safe.', { variant: 'success' })
    } catch {
      toast.show('Export failed. Please try again.', { variant: 'error' })
    }
  }
}

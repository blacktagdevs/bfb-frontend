import type { KeyboardEvent } from 'react'

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'

/**
 * Keyboard handling for a modal dialog, as on the exchange's other dialogs: Escape cancels
 * (unless it is busy) and Tab stays inside the dialog.
 */
export function onDialogKeyDown(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null, { busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  if (event.key === 'Escape' && !busy) {
    event.preventDefault()
    onCancel()
  } else if (event.key === 'Tab') {
    const focusable = Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}

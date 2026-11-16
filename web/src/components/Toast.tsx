import { useEffect } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { scheduleToastDismiss } from '../utils/toastTimer'

export type ToastKind = 'success' | 'error' | 'info'
export type ToastMessage = { id: number; kind: ToastKind; text: string }

export function Toast({ message, onClose }: { message: ToastMessage | null; onClose: (id: number) => void }) {
  useEffect(() => {
    if (!message) return
    return scheduleToastDismiss(message.id, onClose)
  }, [message, onClose])

  if (!message) return null
  return createPortal(
    <div className={`app-toast app-toast--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span>
      <button type="button" onClick={() => onClose(message.id)} aria-label="Cerrar aviso" title="Cerrar aviso">
        <X size={16} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}

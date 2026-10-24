import { useEffect, useRef } from 'react'

/** Modal confirmation. Focus starts on Cancel, Tab stays inside, Escape cancels. */
export default function ConfirmDialog({ title, children, confirmLabel, busy, error, onConfirm, onCancel }) {
  const box = useRef(null)
  const cancel = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !busy) {
      onCancel()
    } else if (e.key === 'Tab') {
      const items = box.current.querySelectorAll('button:not([disabled])')
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={onKeyDown}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={box}
      >
        <h2 id="confirm-title">{title}</h2>
        {children}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
          <button type="button" className="button secondary" onClick={onCancel} ref={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

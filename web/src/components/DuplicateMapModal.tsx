import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Folder, X } from 'lucide-react'
import { CARPETAS, type Carpeta } from '../types/workspace'

interface DuplicateMapModalProps {
  /** Nombre del mapa que se va a clonar (para el texto de ayuda). */
  sourceName: string
  defaultName: string
  defaultFolder: Carpeta
  onConfirm: (nombre: string, carpeta: Carpeta) => void
  onCancel: () => void
}

const MAX_NAME = 60

export function DuplicateMapModal({
  sourceName,
  defaultName,
  defaultFolder,
  onConfirm,
  onCancel,
}: DuplicateMapModalProps) {
  const [nombre, setNombre] = useState(defaultName)
  const [carpeta, setCarpeta] = useState<Carpeta>(defaultFolder)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const inputId = useId()

  const trimmed = nombre.trim()

  useEffect(() => {
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (trimmed) onConfirm(trimmed, carpeta)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            Duplicar mapa
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <p className="modal__hint">
          Se clonará la configuración actual de <strong>{sourceName}</strong> (vista y opacidad) en una
          copia editable.
        </p>

        <label className="field" htmlFor={inputId}>
          <span className="field__label">Nombre de la copia</span>
          <input
            id={inputId}
            ref={inputRef}
            className="field__input"
            value={nombre}
            maxLength={MAX_NAME}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Copia 3 - Cañón del Sumidero"
            required
          />
        </label>

        <fieldset className="field">
          <legend className="field__label">Carpeta</legend>
          <div className="folder-options">
            {CARPETAS.map((c) => (
              <label key={c} className={`folder-option ${carpeta === c ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="carpeta"
                  value={c}
                  checked={carpeta === c}
                  onChange={() => setCarpeta(c)}
                />
                <Folder size={16} aria-hidden="true" />
                {c}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={!trimmed}>
            Crear copia
          </button>
        </div>
      </form>
    </div>
  )
}

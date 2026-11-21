import { useId, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Circle } from 'lucide-react'
import { useTranslation } from '../../i18n/useTranslation'

interface FieldProps {
  label: ReactNode
  /** Plain-language help with units; linked to the control through aria-describedby. */
  hint?: ReactNode
  control: (aria: { 'aria-describedby'?: string }) => ReactNode
}

/** A labelled form control with an optional help line below it. */
export function FloodField({ label, hint, control }: FieldProps) {
  const hintId = useId()
  return (
    <div className="ws-rain-field">
      <label className="ws-rain-field__row">
        <span className="ws-rain-field__label">{label}</span>
        {control(hint ? { 'aria-describedby': hintId } : {})}
      </label>
      {hint && <small id={hintId} className="ws-rain-field__hint">{hint}</small>}
    </div>
  )
}

interface CheckProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
}

/** Checkbox with its text as the label. */
export function FloodCheck({ checked, onChange, children, disabled }: CheckProps) {
  return (
    <label className="ws-rain-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

interface StepProps {
  step: number | string
  icon: ReactNode
  title: string
  /** Undefined hides the completion badge. */
  done?: boolean
  className?: string
  children: ReactNode
}

/** Numbered card of one step of the flood form, with a complete / pending badge. */
export function FloodStep({ step, icon, title, done, className = '', children }: StepProps) {
  const { t } = useTranslation()
  return (
    <section className={`ws-rain-card ws-rain-step ${className}`}>
      <div className="ws-rain-card__head">
        <span className="ws-rain-step__num" aria-hidden="true">{step}</span>
        {icon}
        <h3>{title}</h3>
        {done !== undefined && (
          <span className={`ws-rain-step__state ${done ? 'is-done' : ''}`}>
            {done ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
            {done ? t('Completo', 'Complete') : t('Pendiente', 'Pending')}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

interface CollapsibleProps {
  title: ReactNode
  icon?: ReactNode
  /** Short state shown next to the title while collapsed (e.g. "values missing"). */
  badge?: ReactNode
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}

/** Disclosure button plus region; the content stays in the DOM and is hidden while collapsed. */
export function FloodCollapsible({ title, icon, badge, defaultOpen = false, className = '', children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  const regionId = useId()
  return (
    <div className={`ws-rain-collapsible ${className}`}>
      <button type="button" className="ws-rain-collapsible__toggle" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(o => !o)}>
        <span className="ws-rain-collapsible__title">{icon}{title}</span>
        <span className="ws-rain-collapsible__meta">{badge}{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</span>
      </button>
      <div id={regionId} className="ws-rain-collapsible__body" hidden={!open}>{children}</div>
    </div>
  )
}

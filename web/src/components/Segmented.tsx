import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: ReactNode
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string
  className?: string
  data?: Record<string, string>
}

interface Props<T extends string | number> {
  label: string
  options: SegmentedOption<T>[]
  value: T | null
  onChange: (v: T) => void
  className?: string
  /** Each button's class (defaults to the .ps-seg button style). */
  buttonClassName?: string
}

/** Radio group as a row of buttons; arrow keys move between options. */
export function Segmented<T extends string | number>({ label, options, value, onChange, className, buttonClassName }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = (i + d + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].value)
  }
  const focusIdx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div role="radiogroup" aria-label={label} className={className ?? 'ps-seg'}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === focusIdx ? 0 : -1}
          className={o.className ?? buttonClassName}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
          {...Object.fromEntries(Object.entries(o.data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

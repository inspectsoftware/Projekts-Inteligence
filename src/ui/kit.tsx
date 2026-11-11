import type { ComponentProps, ReactNode } from 'react'

/** Floating chrome surface. The map shows through faintly behind it. */
export function Panel({ className = '', ...rest }: ComponentProps<'div'>) {
  return <div className={`pointer-events-auto border border-line bg-ink-900/85 backdrop-blur-md ${className}`} {...rest} />
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1.5 flex items-center gap-2 text-[10px] font-medium tracking-[0.22em] text-fg-mute uppercase">
      {children}
      <span className="h-px flex-1 bg-line" />
    </h2>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: readonly { id: T; label: string; hint: string }[]
  onChange(value: T): void
}

/** One-of-many switch, laid out as equal cells. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    // Pills in a tray: the one chosen light on dark (dark on light by day), the others plain text.
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-ink-800 p-1">
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={`truncate rounded-full px-2 py-1.5 font-sans text-xs font-medium transition-colors ${
              active ? 'bg-fg-strong text-ink-900' : 'text-fg-dim hover:bg-ink-700 hover:text-fg-strong'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

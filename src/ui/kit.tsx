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
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-px bg-line p-px">
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
            className={`px-1 py-1.5 text-[10px] tracking-[0.16em] uppercase transition-colors ${
              active ? 'bg-accent/15 text-accent' : 'bg-ink-850 text-fg-dim hover:bg-ink-700 hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

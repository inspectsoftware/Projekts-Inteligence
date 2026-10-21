import type { ReactNode } from 'react'
import { t } from '../i18n'
import { type Control, hold, release, useWalk } from '../map/walk'
import { Panel } from './kit'

/** Held down like a key, for a mouse or a finger. */
function HoldButton({ control, title, children }: { control: Control; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Captured, so the release arrives even when the pointer has wandered off the button.
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        hold(control)
      }}
      onLostPointerCapture={() => release(control)}
      // From the keyboard, held for as long as Space or Enter is.
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault()
          hold(control)
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release(control)
      }}
      onBlur={() => release(control)}
      // A long press on a phone would otherwise open a menu.
      onContextMenu={(event) => event.preventDefault()}
      className="grid h-8 w-8 touch-none place-items-center bg-ink-850 text-fg-dim transition-colors select-none hover:bg-ink-700 hover:text-accent active:text-accent"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** The keys, and buttons for the same moves, while the visitor walks at street level. */
export function WalkPanel() {
  const walking = useWalk((s) => s.walking)
  const leave = useWalk((s) => s.leave)
  if (!walking) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-23 z-10 flex justify-center px-3 max-md:bottom-29">
      <Panel className="flex items-center gap-3 p-1.5 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap text-fg-mute uppercase">
        <p className="pl-1.5 max-lg:hidden">{t('WASD move · QE turn · RF up/down · Shift faster · drag to look · Esc leave')}</p>
        <div className="grid grid-cols-4 gap-px border border-line bg-line">
          <HoldButton control="turnLeft" title={t('Turn left')}>
            <path d="M12 13V8.5A3.5 3.5 0 0 0 8.5 5H4M6.5 2.5L4 5l2.5 2.5" />
          </HoldButton>
          <HoldButton control="forward" title={t('Forward')}>
            <path d="M4 10l4-4 4 4" />
          </HoldButton>
          <HoldButton control="turnRight" title={t('Turn right')}>
            <path d="M4 13V8.5A3.5 3.5 0 0 1 7.5 5H12M9.5 2.5L12 5 9.5 7.5" />
          </HoldButton>
          <HoldButton control="up" title={t('Rise')}>
            <path d="M8 11V3M5 6l3-3 3 3M3 13.5h10" />
          </HoldButton>
          <HoldButton control="left" title={t('Step left')}>
            <path d="M10 4L6 8l4 4" />
          </HoldButton>
          <HoldButton control="back" title={t('Back')}>
            <path d="M4 6l4 4 4-4" />
          </HoldButton>
          <HoldButton control="right" title={t('Step right')}>
            <path d="M6 4l4 4-4 4" />
          </HoldButton>
          <HoldButton control="down" title={t('Sink')}>
            <path d="M8 2v8M5 7l3 3 3-3M3 13.5h10" />
          </HoldButton>
        </div>
        <button
          type="button"
          onClick={leave}
          className="h-8 border border-line bg-ink-850 px-3 tracking-[0.16em] text-fg-dim uppercase transition-colors hover:bg-ink-700 hover:text-accent"
        >
          {t('Leave')}
        </button>
      </Panel>
    </div>
  )
}

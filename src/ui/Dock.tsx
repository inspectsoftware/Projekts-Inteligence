import { type ReactNode, useState } from 'react'
import { t } from '../i18n'
import { useRewind } from '../state/rewind'
import { useUi } from '../state/ui'
import { useWindows } from '../state/windows'
import { POLITICS_HREF } from './politics'
import { BADGE_TEXT, WINDOWS, type WindowDef, toggleWindow, useShownWindows, useWindowBadge } from './windows/registry'

const BUTTON = 'relative grid h-11 min-w-11 shrink-0 place-items-center content-center gap-0.5 px-1 transition-colors'

function DockIcon({ path, children }: { path: string; children: ReactNode }) {
  return (
    <>
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d={path} />
      </svg>
      <span className="text-[8px] leading-none tracking-[0.08em] whitespace-nowrap uppercase">{children}</span>
    </>
  )
}

/** `open`: the window is on screen. `front`: it is the one in front of all the others. */
function DockButton({ def, open, front }: { def: WindowDef; open: boolean; front: boolean }) {
  const badge = useWindowBadge(def)
  // A badge with a tone colours the whole button, so an alert is seen while its window is closed.
  const tone = badge?.tone ? BADGE_TEXT[badge.tone] : front ? 'text-accent' : open ? 'text-fg' : 'text-fg-dim hover:text-fg'

  return (
    <button
      type="button"
      aria-pressed={open}
      // The label replaces the button's text for a screen reader, so the count has to be in it.
      aria-label={badge ? `${def.title}, ${badge.text}` : def.title}
      title={def.title}
      // As on the Windows taskbar: a window that is open but behind others comes to the front, and only the one in front closes.
      onClick={() => (open && !front ? useWindows.getState().focus(def.id) : toggleWindow(def))}
      className={`${BUTTON} ${tone} ${front ? 'bg-accent/12 hover:bg-accent/20' : open ? 'bg-ink-700/50 hover:bg-ink-700' : 'hover:bg-ink-700'}`}
    >
      <DockIcon path={def.icon}>{def.short}</DockIcon>
      {badge && <span className="absolute top-1 right-1 text-[8px] leading-none tabular-nums">{badge.text}</span>}
      {/* The mark under a running program: short while the window is open, long and lit while it is in front. */}
      {open && (
        <i aria-hidden="true" className={`absolute bottom-0.5 left-1/2 h-0.5 -translate-x-1/2 rounded-full transition-all ${front ? 'w-4 bg-accent' : 'w-1.5 bg-fg-mute'}`} />
      )}
    </button>
  )
}

/**
 * The launcher, a taskbar along the bottom edge: one button per window, marked while that window
 * is on screen, and the layout's own buttons at the right end. On a narrow screen it scrolls
 * sideways. The developer windows have buttons only in developer mode.
 */
export function Dock() {
  const shown = useShownWindows()
  const order = useWindows((s) => s.order)
  const resetLayout = useWindows((s) => s.resetLayout)
  const saveLayout = useWindows((s) => s.saveLayout)
  const developer = useUi((s) => s.developer)
  const rewindOpen = useRewind((s) => s.open)
  const rewound = useRewind((s) => s.at !== null)
  const [saved, setSaved] = useState(false)
  const save = () => {
    saveLayout()
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  // Never raised windows count as furthest back, as they are drawn.
  const front = shown.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).at(-1)
  const button = (def: WindowDef) => <DockButton key={def.id} def={def} open={shown.includes(def)} front={def === front} />
  const listed = WINDOWS.filter((def) => !def.hideInDock && (!def.developer || developer))

  return (
    <nav
      aria-label={t('Windows')}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-11 border-t border-line bg-ink-900/90 font-mono backdrop-blur-md"
    >
      <div className="flex min-w-0 flex-1 justify-center-safe overflow-x-auto [scrollbar-width:none]">
        {listed.map(button)}
        <a href={POLITICS_HREF} title={t('Baltic politics, as published')} className={`${BUTTON} ml-1 border-l border-line text-fg-dim hover:bg-ink-700 hover:text-fg`}>
          <DockIcon path="M2 13.5h12M3.5 13.5v-6M6.5 13.5v-6M9.5 13.5v-6M12.5 13.5v-6M2 7.5l6-5 6 5z">{t('dock::Polit')}</DockIcon>
        </a>
      </div>
      <div className="flex shrink-0 border-l border-line">
        <button
          type="button"
          aria-pressed={rewindOpen}
          title={t('Wind the aircraft, ships and GPS interference back over the last six hours')}
          onClick={() => useRewind.getState().setOpen(!rewindOpen)}
          className={`${BUTTON} hover:bg-ink-700 ${rewound ? 'text-warn' : rewindOpen ? 'text-accent' : 'text-fg-mute hover:text-fg'}`}
        >
          <DockIcon path="M8 3.5a4.5 4.5 0 11-4.5 4.5M3.5 4v4h4M8 5.5V8l2 1.5">{t('dock::Rewind')}</DockIcon>
        </button>
        <button
          type="button"
          title={t('Save this window layout for the next visit. Without it the page opens with no windows')}
          aria-label={t('Save window layout')}
          onClick={save}
          className={`${BUTTON} hover:bg-ink-700 ${saved ? 'text-ok' : 'text-fg-mute hover:text-fg'}`}
        >
          <DockIcon path="M3 2.5h8l2 2v9H3zM5.5 2.5v4h5v-4M5.5 13.5v-4h5v4">{saved ? t('Saved') : t('dock::Save')}</DockIcon>
        </button>
        <button
          type="button"
          title={t('Close every window and forget the saved layout')}
          aria-label={t('Reset window layout')}
          onClick={resetLayout}
          className={`${BUTTON} text-fg-mute hover:bg-ink-700 hover:text-fg`}
        >
          <DockIcon path="M13 8a5 5 0 11-1.5-3.5M13 2.5V5h-2.5">{t('Reset')}</DockIcon>
        </button>
      </div>
    </nav>
  )
}

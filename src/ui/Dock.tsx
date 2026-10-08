import type { ReactNode } from 'react'
import { t } from '../i18n'
import { useWindows } from '../state/windows'
import { POLITICS_HREF } from './politics'
import { BADGE_TEXT, WINDOWS, type WindowDef, toggleWindow, useShownWindows, useWindowBadge } from './windows/registry'

// In the rail a button takes the rail's width, which is a pixel short of w-11 because of the border.
const BUTTON = 'relative grid h-10 w-11 shrink-0 place-items-center content-center gap-0.5 transition-colors md:w-auto'

function DockIcon({ path, children }: { path: string; children: ReactNode }) {
  return (
    <>
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d={path} />
      </svg>
      <span className="text-[8px] leading-none tracking-[0.08em] uppercase">{children}</span>
    </>
  )
}

function DockButton({ def, pressed }: { def: WindowDef; pressed: boolean }) {
  const badge = useWindowBadge(def)
  // A badge with a tone colours the whole button, so an alert is seen while its window is closed.
  const tone = badge?.tone ? BADGE_TEXT[badge.tone] : pressed ? 'text-accent' : 'text-fg-dim hover:text-fg'

  return (
    <button
      type="button"
      aria-pressed={pressed}
      // The label replaces the button's text for a screen reader, so the count has to be in it.
      aria-label={badge ? `${def.title}, ${badge.text}` : def.title}
      title={def.title}
      onClick={() => toggleWindow(def)}
      className={`${BUTTON} ${tone} ${pressed ? 'bg-accent/15' : 'hover:bg-ink-700'}`}
    >
      <DockIcon path={def.icon}>{def.short}</DockIcon>
      {badge && <span className="absolute top-0.5 right-1 text-[8px] leading-none tabular-nums">{badge.text}</span>}
    </button>
  )
}

/**
 * The launcher: one button per window, pressed while that window is on screen. A rail down the
 * left edge, or on a narrow screen a strip under the top bar that scrolls sideways.
 */
export function Dock() {
  const shown = useShownWindows()
  const resetLayout = useWindows((s) => s.resetLayout)

  return (
    <nav
      aria-label={t('Windows')}
      className="pointer-events-auto absolute top-10 left-0 z-20 flex [scrollbar-width:none] border-line bg-ink-900/90 font-mono backdrop-blur-md max-md:right-0 max-md:overflow-x-auto max-md:border-b md:bottom-0 md:w-11 md:flex-col md:overflow-y-auto md:border-r"
    >
      {WINDOWS.filter((def) => !def.hideInDock).map((def) => (
        <DockButton key={def.id} def={def} pressed={shown.includes(def)} />
      ))}
      <a href={POLITICS_HREF} title={t('Baltic politics, as published')} className={`${BUTTON} text-fg-dim hover:bg-ink-700 hover:text-fg`}>
        <DockIcon path="M2 13.5h12M3.5 13.5v-6M6.5 13.5v-6M9.5 13.5v-6M12.5 13.5v-6M2 7.5l6-5 6 5z">{t('dock::Polit')}</DockIcon>
      </a>
      <button
        type="button"
        title={t('Reset window layout')}
        aria-label={t('Reset window layout')}
        onClick={resetLayout}
        className={`${BUTTON} text-fg-mute hover:bg-ink-700 hover:text-fg max-md:ml-auto md:mt-auto`}
      >
        <DockIcon path="M13 8a5 5 0 11-1.5-3.5M13 2.5V5h-2.5">{t('Reset')}</DockIcon>
      </button>
    </nav>
  )
}

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { useRewind } from '../state/rewind'
import { useUi } from '../state/ui'
import { useWindows } from '../state/windows'
import { POLITICS_HREF } from './politics'
import { BADGE_TEXT, WINDOWS, type WindowDef, toggleWindow, useShownWindows, useWindowBadge } from './windows/registry'

/** The windows a newcomer reaches for, in the bar itself. Every other one is under "More". */
const PRIMARY = ['layers', 'transport', 'intel', 'cctv', 'tv', 'radio', 'chat']

/** Shadow shared by everything that floats over the map. */
export const FLOAT_SHADOW = 'shadow-[0_4px_20px_rgb(0_0_0/0.14)]'

export function Icon({ path, className = 'h-[18px] w-[18px]' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/** A button's name, sliding out to its right while the pointer is on it (the button carries `group`). */
export function HoverName({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute top-1/2 left-full z-30 ml-1.5 -translate-x-2 -translate-y-1/2 rounded-full border border-line bg-ink-900 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-fg-strong opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 ${FLOAT_SHADOW}`}
    >
      {children}
    </span>
  )
}

/**
 * One window in the bar. Closed: an icon. Open: a light pill with the icon and the window's name,
 * so what is on screen reads at a glance. A badge (a count, an alert) rides on the icon's corner.
 */
function NavButton({ def, open, front }: { def: WindowDef; open: boolean; front: boolean }) {
  const badge = useWindowBadge(def)
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={badge ? `${def.title}, ${badge.text}` : def.title}
      // As on a taskbar: a window that is open but behind others comes to the front, and only the one in front closes.
      onClick={() => (open && !front ? useWindows.getState().focus(def.id) : toggleWindow(def))}
      className={`group relative flex h-9 shrink-0 items-center gap-2 rounded-full text-sm font-medium transition-colors ${
        open ? 'bg-fg-strong px-3.5 text-ink-900' : 'w-9 justify-center text-fg-dim hover:bg-ink-700 hover:text-fg-strong'
      }`}
    >
      <Icon path={def.icon} />
      {open && <span className="whitespace-nowrap">{def.title}</span>}
      {/*
        Closed, its name slides out to the right on hover, over its neighbours. It takes no pointer,
        so moving on to the next icon still reaches that icon, and its own name slides out instead.
      */}
      {!open && <HoverName>{def.title}</HoverName>}
      {badge && (
        <span
          className={`absolute -top-1 -right-1 min-w-4 rounded-full bg-ink-900 px-1 text-center text-[10px] leading-4 font-semibold tabular-nums ring-1 ring-line ${badge.tone ? BADGE_TEXT[badge.tone] : 'text-fg-dim'}`}
        >
          {badge.text}
        </span>
      )}
    </button>
  )
}

function MenuRow({ icon, label, active, onClick, href }: { icon: string; label: ReactNode; active?: boolean; onClick?(): void; href?: string }) {
  const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
    active ? 'bg-ink-700 text-fg-strong' : 'text-fg hover:bg-ink-700'
  }`
  const body = (
    <>
      <Icon path={icon} className="h-4 w-4 text-fg-dim" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-fg-strong" />}
    </>
  )
  return href ? (
    <a href={href} className={className} role="menuitem">
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className} role="menuitem">
      {body}
    </button>
  )
}

function MoreMenu({ windows, shown, onClose }: { windows: readonly WindowDef[]; shown: readonly WindowDef[]; onClose(): void }) {
  const rewindOpen = useRewind((s) => s.open)
  const { resetLayout, saveLayout } = useWindows.getState()
  const pick = (action: () => void) => () => {
    action()
    onClose()
  }
  return (
    <div role="menu" aria-label={t('More')} className={`absolute top-full right-0 mt-2 w-64 rounded-2xl border border-line bg-ink-900 p-1.5 ${FLOAT_SHADOW}`}>
      {windows.map((def) => (
        <MenuRow key={def.id} icon={def.icon} label={def.title} active={shown.includes(def)} onClick={pick(() => toggleWindow(def))} />
      ))}
      <MenuRow
        icon="M8 3.5a4.5 4.5 0 11-4.5 4.5M3.5 4v4h4M8 5.5V8l2 1.5"
        label={t('Rewind')}
        active={rewindOpen}
        onClick={pick(() => useRewind.getState().setOpen(!rewindOpen))}
      />
      <MenuRow icon="M2 13.5h12M3.5 13.5v-6M6.5 13.5v-6M9.5 13.5v-6M12.5 13.5v-6M2 7.5l6-5 6 5z" label={t('Baltic politics, as published')} href={POLITICS_HREF} />
      <div className="mx-2 my-1 h-px bg-line" />
      <MenuRow icon="M3 2.5h8l2 2v9H3zM5.5 2.5v4h5v-4M5.5 13.5v-4h5v4" label={t('Save window layout')} onClick={pick(saveLayout)} />
      <MenuRow icon="M13 8a5 5 0 11-1.5-3.5M13 2.5V5h-2.5" label={t('Reset window layout')} onClick={pick(resetLayout)} />
    </div>
  )
}

/**
 * The launcher on a wide screen: a floating pill at the top centre with the windows most people
 * open and everything else in one menu at its end. Phones keep the taskbar (Dock).
 */
export function NavBar() {
  const shown = useShownWindows()
  const order = useWindows((s) => s.order)
  const developer = useUi((s) => s.developer)
  const [more, setMore] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!more) return
    const onPointer = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMore(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMore(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [more])

  const front = shown.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).at(-1)
  const listed = WINDOWS.filter((def) => !def.hideInDock && (!def.developer || developer))
  const primary = PRIMARY.flatMap((id) => listed.filter((def) => def.id === id))
  const rest = listed.filter((def) => !PRIMARY.includes(def.id))
  const restOpen = rest.some((def) => shown.includes(def))

  return (
    <nav
      aria-label={t('Windows')}
      className={`pointer-events-auto absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-ink-900 p-1 max-md:hidden ${FLOAT_SHADOW}`}
    >
      {primary.map((def) => (
        <NavButton key={def.id} def={def} open={shown.includes(def)} front={def === front} />
      ))}
      <span className="mx-0.5 h-5 w-px bg-line" />
      <div ref={moreRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={more}
          aria-label={t('More')}
          onClick={() => setMore(!more)}
          className={`group relative grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-ink-700 hover:text-fg-strong ${more ? 'bg-ink-700 text-fg-strong' : 'text-fg-dim'}`}
        >
          <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="12.5" cy="8" r="1.25" />
          </svg>
          {restOpen && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-fg-strong" />}
          {!more && <HoverName>{t('More')}</HoverName>}
        </button>
        {more && <MoreMenu windows={rest} shown={shown} onClose={() => setMore(false)} />}
      </div>
    </nav>
  )
}

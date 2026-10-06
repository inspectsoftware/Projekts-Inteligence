import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef } from 'react'
import { t } from '../../i18n'
import { prefersReducedMotion } from '../../map/camera'
import { useWindows } from '../../state/windows'
import { Panel } from '../kit'
import {
  type Bounds,
  CHROME,
  type Guide,
  MARGIN,
  type Placement,
  type Rect,
  type Size,
  clamp,
  resolve,
  snap,
  toPlacement,
  usableBounds,
} from './geometry'
import { BADGE_TEXT, type WindowDef, closeWindow, useWindowBadge } from './registry'

/** Overshoots, then settles: a released window reads as pulled the last few pixels by a magnet. */
const SPRING: KeyframeAnimationOptions = { duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }

/** No window is ever bigger than the usable area. */
const MAX_WIDTH = `calc(100% - ${CHROME.dock + 2 * MARGIN}px)`
const MAX_HEIGHT = `calc(100% - ${CHROME.top + CHROME.hud + 2 * MARGIN}px)`

const ARROWS: Record<string, readonly [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** The same anchor, measured from the top edge instead of the bottom one. */
const FROM_TOP: Partial<Record<Placement['corner'], Placement['corner']>> = { bl: 'tl', br: 'tr', bc: 'tc' }

const HEADER_BUTTON = 'grid h-6 w-6 shrink-0 place-items-center text-sm leading-none text-fg-mute transition-colors hover:text-fg'

const viewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight })

/** Where layout has the element, whatever transform a drag or the settle animation has on it. */
const rectOf = (el: HTMLElement): Rect => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })

/**
 * The usable area for a window over these columns. The credits are drawn above the windows in
 * the bottom right corner and stand taller than the HUD row, so a window that reaches into their
 * columns rests on their top edge: under them its corner could be neither clicked nor resized.
 */
function boundsOver(x: number, w: number): Bounds {
  const bounds = usableBounds(viewport())
  const credits = document.querySelector<HTMLElement>('[data-snap="credits"]')
  // No offsetParent while hidden, as the credits are on a screen too small for them.
  if (!credits?.offsetParent || x + w <= credits.offsetLeft) return bounds
  return { ...bounds, bottom: Math.min(bounds.bottom, credits.offsetTop - MARGIN) }
}

/** The size nearest to the one asked for that a window standing at `from` may take. */
function sizeWithin(from: Rect, w: number, h: number, { min, max }: NonNullable<WindowDef['resizable']>): Size {
  const width = Math.max(min.w, Math.min(w, max.w, usableBounds(viewport()).right - from.x))
  return { w: width, h: Math.max(min.h, Math.min(h, max.h, boundsOver(from.x, width).bottom - from.y)) }
}

/** Draws the magnets in reach as hairlines over the layer. With `flash` they fade out by themselves: the lock-on. */
function showGuides(layer: HTMLElement, guides: readonly Guide[], flash: boolean): void {
  for (const axis of ['x', 'y'] as const) {
    const line = layer.querySelector<HTMLElement>(`[data-guide="${axis}"]`)!
    const guide = guides.find((candidate) => candidate.axis === axis)
    line.hidden = !guide
    line.toggleAttribute('data-flash', flash)
    if (guide) line.style[axis === 'x' ? 'left' : 'top'] = `${guide.at}px`
  }
}

/**
 * Follows one pointer from press to release. Moves are painted at most once per frame and never
 * go through React. A press that travels 3px or less is a click: nothing is painted or finished.
 * While it lasts the window carries data-busy, which the stylesheet and the layout both read.
 * Returns what drops the gesture without finishing it, for a window that goes away half way.
 */
function track(
  event: ReactPointerEvent<HTMLElement>,
  el: HTMLElement,
  gesture: 'drag' | 'resize',
  paint: (dx: number, dy: number) => void,
  done: (dx: number, dy: number) => void,
): () => void {
  const handle = event.currentTarget
  const { clientX, clientY, pointerId } = event
  let dx = 0
  let dy = 0
  let frame = 0
  // Captured, so the gesture survives the pointer outrunning the handle.
  handle.setPointerCapture(pointerId)

  const onMove = (move: PointerEvent) => {
    // A second finger on the same handle is not part of this gesture.
    if (move.pointerId !== pointerId) return
    dx = move.clientX - clientX
    dy = move.clientY - clientY
    if (!el.dataset.busy && Math.hypot(dx, dy) <= 3) return
    el.dataset.busy = gesture
    frame ||= requestAnimationFrame(() => {
      frame = 0
      paint(dx, dy)
    })
  }
  const stop = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onEnd)
    handle.removeEventListener('pointercancel', onEnd)
    cancelAnimationFrame(frame)
  }
  const onEnd = (end: PointerEvent) => {
    if (end.pointerId !== pointerId) return
    stop()
    if (!el.dataset.busy) return
    delete el.dataset.busy
    done(dx, dy)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onEnd)
  handle.addEventListener('pointercancel', onEnd)
  return stop
}

/**
 * The frame every window sits in: a header to drag it by, collapse and close, an optional resize
 * grip, and the body from the registry. On a narrow screen (`sheet`) it is pinned above the HUD
 * instead and cannot be moved.
 */
export function Window({ def, sheet }: { def: WindowDef; sheet: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Drops the gesture under way. Only a window that goes away needs it: a gesture otherwise ends itself.
  const abort = useRef<(() => void) | null>(null)
  const stored = useWindows((s) => s.windows[def.id])
  const z = useWindows((s) => s.order.indexOf(def.id))
  const focus = useWindows((s) => s.focus)
  const badge = useWindowBadge(def)

  const placement = stored?.placement ?? def.placement
  const size = stored?.size ?? { w: def.width, h: def.height }
  const collapsed = !sheet && (stored?.collapsed ?? false)
  const Body = def.component

  // The corner placement is turned into a position here, and again whenever the viewport or
  // the window's own size changes, so it stays docked where it was put and inside the bounds.
  useLayoutEffect(() => {
    const el = ref.current!
    if (sheet) {
      // A sheet is placed by its classes: drop what the floating layout wrote.
      el.style.left = el.style.top = ''
      return
    }
    const layout = () => {
      // A drag or a resize owns the element until it lets go.
      if (el.dataset.busy) return
      const box = { w: el.offsetWidth, h: el.offsetHeight }
      const at = clamp({ ...resolve(placement, box, viewport()), ...box }, usableBounds(viewport()))
      el.style.left = `${at.x}px`
      el.style.top = `${at.y}px`
    }
    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(el)
    window.addEventListener('resize', layout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', layout)
    }
  }, [placement, sheet])

  // Esc closes the Inspector even in mid-drag, and a window that is gone never sees the release.
  useLayoutEffect(() => {
    const el = ref.current!
    return () => {
      if (el.dataset.busy) abort.current?.()
    }
  }, [])

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    // A sheet stays put, and the buttons in the header are for pressing.
    if (sheet || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return
    const el = ref.current!
    const layer = el.parentElement!
    const start = rectOf(el)
    const bounds = usableBounds(viewport())
    // The other windows, and fixed chrome that asks to be snapped to, as they stand when the drag starts.
    const others = [...document.querySelectorAll<HTMLElement>('[data-window], [data-snap]')]
      .filter((other) => other !== el)
      .map(rectOf)
    const slotAt = (dx: number, dy: number) => {
      const rect = { ...start, x: start.x + dx, y: start.y + dy }
      // Sideways first: how low it may go depends on the columns it comes to rest over.
      return snap(rect, others, boundsOver(snap(rect, others, bounds).x, rect.w))
    }

    // A settle still in flight would fight the transform the drag is about to write.
    for (const animation of el.getAnimations()) animation.cancel()
    showGuides(layer, [], false)
    const stop = track(
      event,
      el,
      'drag',
      (dx, dy) => {
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        showGuides(layer, slotAt(dx, dy).guides, false)
      },
      (dx, dy) => {
        const slot = slotAt(dx, dy)
        el.style.transform = ''
        el.style.left = `${slot.x}px`
        el.style.top = `${slot.y}px`
        if (!prefersReducedMotion()) {
          // Already in its slot as far as layout goes; only the picture travels there from the release point.
          const from = `translate3d(${start.x + dx - slot.x}px, ${start.y + dy - slot.y}px, 0)`
          el.animate({ transform: [from, 'none'] }, SPRING)
        }
        showGuides(layer, slot.guides, true)
        useWindows.getState().place(def.id, toPlacement({ ...start, x: slot.x, y: slot.y }, viewport()))
      },
    )
    abort.current = () => {
      stop()
      showGuides(layer, [], false)
    }
  }

  const commitSize = (from: Rect, next: Size) => {
    const { resize, place } = useWindows.getState()
    resize(def.id, next)
    // Placed again from its top-left: docked right or bottom, it would otherwise jump to keep its old far edge.
    place(def.id, toPlacement({ ...from, ...next }, viewport()))
  }

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    const limits = def.resizable
    if (!limits || !event.isPrimary || event.button !== 0) return
    const el = ref.current!
    const start = rectOf(el)
    const sizeTo = (dx: number, dy: number): Size => {
      const next = sizeWithin(start, start.w + dx, start.h + dy, limits)
      el.style.width = `${next.w}px`
      el.style.height = `${next.h}px`
      return next
    }
    // Painted once more on release: the last frame may never have run, and React only writes a size that changed.
    abort.current = track(event, el, 'resize', sizeTo, (dx, dy) => commitSize(start, sizeTo(dx, dy)))
  }

  const nudge = (event: KeyboardEvent<HTMLElement>) => {
    const step = ARROWS[event.key]
    // Arrow keys pressed on a header button are not meant for the window.
    if (!step || sheet || event.target !== event.currentTarget) return
    event.preventDefault()
    const rect = rectOf(ref.current!)
    const by = event.shiftKey ? 32 : 8
    const [dx, dy] = [step[0] * by, step[1] * by]
    if (event.altKey) {
      // With Alt held the arrows move the bottom right corner instead: the grip, for the keyboard.
      if (def.resizable && !collapsed) commitSize(rect, sizeWithin(rect, rect.w + dx, rect.h + dy, def.resizable))
      return
    }
    const to = { ...rect, x: rect.x + dx, y: rect.y + dy }
    useWindows.getState().place(def.id, toPlacement({ ...to, ...clamp(to, boundsOver(to.x, to.w)) }, viewport()))
  }

  const toggleCollapsed = () => {
    const { place, setCollapsed } = useWindows.getState()
    // Hung from its top edge first: docked to the bottom, the header would jump away from the
    // pointer as the body folds or unfolds.
    const corner = FROM_TOP[placement.corner]
    if (corner) place(def.id, { corner, dx: placement.dx, dy: ref.current!.offsetTop })
    setCollapsed(def.id, !collapsed)
  }

  return (
    <Panel
      ref={ref}
      role="group"
      aria-label={def.title}
      data-window={def.id}
      onPointerDownCapture={() => focus(def.id)}
      className={`window absolute flex flex-col font-mono ${sheet ? 'inset-x-0 bottom-16 max-h-[60%]' : ''}`}
      style={
        sheet
          ? undefined
          : {
              zIndex: z + 1,
              width: size.w,
              maxWidth: MAX_WIDTH,
              height: def.resizable && !collapsed ? size.h : undefined,
              maxHeight: def.resizable ? MAX_HEIGHT : `min(${def.height}px, ${MAX_HEIGHT})`,
            }
      }
    >
      <header
        role="toolbar"
        aria-label={
          sheet
            ? def.title
            : def.resizable
              ? t('{title}: arrow keys move this window, with Alt they resize it', { title: def.title })
              : t('{title}: arrow keys move this window', { title: def.title })
        }
        tabIndex={sheet ? undefined : 0}
        onPointerDown={startDrag}
        onKeyDown={nudge}
        className={`flex h-7 shrink-0 items-center pl-3 select-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent ${
          sheet ? '' : 'cursor-grab touch-none'
        }`}
      >
        <h2 className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.22em] text-fg-mute uppercase">
          {def.title}
        </h2>
        {badge && (
          <span className={`px-1.5 text-[10px] tabular-nums ${badge.tone ? BADGE_TEXT[badge.tone] : 'text-fg-dim'}`}>
            {badge.text}
          </span>
        )}
        {!sheet && (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('Expand {title}', { title: def.title }) : t('Collapse {title}', { title: def.title })}
            title={collapsed ? t('Expand') : t('Collapse')}
            onClick={toggleCollapsed}
            className={HEADER_BUTTON}
          >
            {collapsed ? '+' : '−'}
          </button>
        )}
        <button
          type="button"
          aria-label={t('Close {title}', { title: def.title })}
          title={t('Close')}
          onClick={() => closeWindow(def)}
          className={HEADER_BUTTON}
        >
          ×
        </button>
      </header>
      {/* Hidden rather than unmounted when collapsed, so a body keeps its tab, its scroll and its stream. */}
      <div hidden={collapsed} className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-line">
        <Body />
      </div>
      {def.resizable && !sheet && !collapsed && (
        <i
          aria-hidden="true"
          onPointerDown={startResize}
          className="absolute right-0.5 bottom-0.5 h-3 w-3 cursor-nwse-resize touch-none border-r-2 border-b-2 border-line-strong select-none hover:border-accent"
        />
      )}
    </Panel>
  )
}

/**
 * Where a window sits and where the magnets pull it on release.
 * Plain numbers in screen pixels and no DOM, so all of it can be tested.
 */

export interface Size {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export type Rect = Point & Size

/** Edges of the area windows may occupy. */
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

/**
 * A position kept as a distance from a viewport corner, so a window docked on the right
 * stays on the right when the browser is resized. The two centred anchors are for registry
 * defaults only: a window the user has moved is always stored against a corner.
 */
export interface Placement {
  corner: Corner | 'tc' | 'bc'
  dx: number
  dy: number
}

/** A magnet that took hold: a vertical line at x (axis 'x') or a horizontal one at y. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
}

export interface SnapOptions {
  /** How close an edge must come before a magnet takes it. */
  threshold: number
  /** Space left between two windows snapped side by side. */
  gap: number
  /** What a position rounds to when no magnet is in reach. */
  grid: number
}

/** Fixed chrome that windows keep clear of: the top bar, the dock rail and the HUD row. */
export const CHROME = { top: 40, dock: 44, hud: 44 }
export const MARGIN = 12

const SNAP: SnapOptions = { threshold: 28, gap: 8, grid: 8 }

/** The usable area: below the top bar, right of the dock and above the HUD, with a margin all round. */
export function usableBounds(viewport: Size): Bounds {
  return {
    left: CHROME.dock + MARGIN,
    top: CHROME.top + MARGIN,
    right: viewport.w - MARGIN,
    bottom: viewport.h - CHROME.hud - MARGIN,
  }
}

export function resolve(placement: Placement, size: Size, viewport: Size): Point {
  const [v, h] = placement.corner
  const centred = Math.round((viewport.w - size.w) / 2) + placement.dx
  return {
    x: h === 'l' ? placement.dx : h === 'r' ? viewport.w - placement.dx - size.w : centred,
    y: v === 't' ? placement.dy : viewport.h - placement.dy - size.h,
  }
}

/** The inverse of resolve(), against whichever corner the rect is nearest to. */
export function toPlacement(rect: Rect, viewport: Size): Placement {
  const right = viewport.w - rect.x - rect.w
  const bottom = viewport.h - rect.y - rect.h
  const h = rect.x <= right ? 'l' : 'r'
  const v = rect.y <= bottom ? 't' : 'b'
  return { corner: `${v}${h}`, dx: h === 'l' ? rect.x : right, dy: v === 't' ? rect.y : bottom }
}

/** With a range too small to fit, the low end wins: that is the side the header is on. */
function within(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi))
}

/** Pulls a rect back inside the bounds, so its header can always be grabbed again. */
export function clamp(rect: Rect, bounds: Bounds): Point {
  return {
    x: within(rect.x, bounds.left, bounds.right - rect.w),
    y: within(rect.y, bounds.top, bounds.bottom - rect.h),
  }
}

/** One axis of snap(): the nearest magnet in reach, otherwise the grid. */
function snapAxis(
  start: number,
  length: number,
  lo: number,
  hi: number,
  others: readonly (readonly [start: number, length: number])[],
  { threshold, gap, grid }: SnapOptions,
): { at: number; guide: number | null } {
  const max = hi - length
  // Each magnet: where the window would start, and where the line it locks to is drawn.
  const magnets: [number, number][] = [
    [lo, lo],
    [max, hi],
  ]
  for (const [from, size] of others) {
    const to = from + size
    // Aligned with the other window's two edges, then sitting just past each of them.
    magnets.push([from, from], [to - length, to], [to + gap, to + gap], [from - gap - length, from - gap])
  }

  let best: [number, number] | null = null
  for (const magnet of magnets) {
    // A slot that would leave the window out of bounds is no slot at all.
    if (within(magnet[0], lo, max) !== magnet[0]) continue
    const reach = Math.abs(magnet[0] - start)
    if (reach <= threshold && (!best || reach < Math.abs(best[0] - start))) best = magnet
  }
  if (best) return { at: best[0], guide: best[1] }
  return { at: within(lo + Math.round((start - lo) / grid) * grid, lo, max), guide: null }
}

/**
 * Where a dragged window comes to rest. Each axis on its own: pulled to the nearest edge of the
 * bounds or of another window when one is within reach, rounded to the grid when none is, and
 * never left outside the bounds. `guides` are the magnets that took hold, for the UI to flash.
 */
export function snap(
  rect: Rect,
  others: readonly Rect[],
  bounds: Bounds,
  options: Partial<SnapOptions> = {},
): Point & { guides: Guide[] } {
  const tuned = { ...SNAP, ...options }
  const x = snapAxis(rect.x, rect.w, bounds.left, bounds.right, others.map((other) => [other.x, other.w]), tuned)
  const y = snapAxis(rect.y, rect.h, bounds.top, bounds.bottom, others.map((other) => [other.y, other.h]), tuned)
  const guides: Guide[] = []
  if (x.guide !== null) guides.push({ axis: 'x', at: x.guide })
  if (y.guide !== null) guides.push({ axis: 'y', at: y.guide })
  return { x: x.at, y: y.at, guides }
}

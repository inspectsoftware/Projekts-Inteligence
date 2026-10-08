import { describe, expect, it, vi } from 'vitest'
import { savedLayout, useWindows } from '../../src/state/windows'
import { type Rect, clamp, resolve, snap, toPlacement, usableBounds } from '../../src/ui/windows/geometry'

const viewport = { w: 1440, h: 900 }
const bounds = usableBounds(viewport)
const win = (x: number, y: number, w = 240, h = 200): Rect => ({ x, y, w, h })

describe('window snapping', () => {
  it('keeps the top bar, the dock and the HUD clear', () => {
    expect(bounds).toEqual({ left: 56, top: 52, right: 1428, bottom: 844 })
  })

  it('pulls a window to the edge of the usable area', () => {
    expect(snap(win(70, 404), [], bounds)).toEqual({ x: 56, y: 404, guides: [{ axis: 'x', at: 56 }] })
    expect(snap(win(1168, 659), [], bounds)).toEqual({
      x: 1188,
      y: 644,
      guides: [
        { axis: 'x', at: 1428 },
        { axis: 'y', at: 844 },
      ],
    })
  })

  it('parks a window beside another one, a gap apart', () => {
    const layers = win(56, 52, 240, 520)
    expect(snap(win(310, 60, 288, 300), [layers], bounds)).toMatchObject({ x: 304, y: 52 })
    expect(snap(win(60, 590, 240, 100), [layers], bounds)).toEqual({
      x: 56,
      y: 580,
      guides: [
        { axis: 'x', at: 56 },
        { axis: 'y', at: 580 },
      ],
    })
  })

  it('lines a window up with the edges of another one', () => {
    const other = win(400, 200, 300, 200)
    expect(snap(win(410, 500, 200, 100), [other], bounds)).toEqual({ x: 400, y: 500, guides: [{ axis: 'x', at: 400 }] })
    expect(snap(win(515, 500, 200, 100), [other], bounds)).toEqual({ x: 500, y: 500, guides: [{ axis: 'x', at: 700 }] })
    expect(snap(win(900, 310, 200, 100), [other], bounds)).toMatchObject({ y: 300, guides: [{ axis: 'y', at: 400 }] })
  })

  it('takes the nearest magnet when several are in reach', () => {
    expect(snap(win(310, 300), [win(56, 52), win(320, 600)], bounds).x).toBe(304)
    expect(snap(win(316, 300), [win(56, 52), win(320, 600)], bounds).x).toBe(320)
  })

  it('falls back to the grid when no magnet is in reach', () => {
    expect(snap(win(605, 303), [], bounds)).toEqual({ x: 608, y: 300, guides: [] })
    expect(snap(win(96, 404), [], bounds, { threshold: 10 }).x).toBe(96)
  })

  it('never leaves a window outside the usable area', () => {
    expect(snap(win(-400, 2000), [], bounds)).toEqual({ x: 56, y: 644, guides: [] })
    // The slot past a window that already touches the right edge is out of bounds, so it is not offered.
    expect(snap(win(1200, 300), [win(1188, 52)], bounds).x).toBe(1188)
    expect(clamp(win(-500, 5000), bounds)).toEqual({ x: 56, y: 644 })
    // Too big to fit: the corner the header is in stays reachable.
    expect(clamp(win(900, 700, 2000, 1000), bounds)).toEqual({ x: 56, y: 52 })
  })
})

describe('window placement', () => {
  it('round-trips through the nearest corner', () => {
    const cases = [
      [win(100, 80), 'tl'],
      [win(1100, 80), 'tr'],
      [win(100, 600), 'bl'],
      [win(1100, 600), 'br'],
    ] as const
    for (const [rect, corner] of cases) {
      const placement = toPlacement(rect, viewport)
      expect(placement.corner).toBe(corner)
      expect(resolve(placement, rect, viewport)).toEqual({ x: rect.x, y: rect.y })
    }
  })

  it('keeps a window docked on the right on the right when the viewport grows', () => {
    const docked = win(1188, 52)
    const placement = toPlacement(docked, viewport)
    expect(placement).toEqual({ corner: 'tr', dx: 12, dy: 52 })
    expect(resolve(placement, docked, { w: 1920, h: 1080 })).toEqual({ x: 1668, y: 52 })
  })

  it('centres a default placement whatever the width', () => {
    expect(resolve({ corner: 'tc', dx: 0, dy: 52 }, { w: 416, h: 100 }, viewport)).toEqual({ x: 512, y: 52 })
    expect(resolve({ corner: 'bc', dx: -120, dy: 56 }, { w: 352, h: 62 }, viewport)).toEqual({ x: 424, y: 782 })
  })
})

describe('window layout', () => {
  it('is kept for the next visit only when saved, and forgotten on reset', () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    const { open, place, saveLayout, resetLayout } = useWindows.getState()
    open('intel')
    place('intel', { corner: 'br', dx: 20, dy: 20 })
    // Opening and moving alone leave nothing behind.
    expect(savedLayout()).toEqual({ windows: {}, order: [] })

    saveLayout()
    expect(savedLayout()).toEqual({ windows: { intel: { open: true, placement: { corner: 'br', dx: 20, dy: 20 } } }, order: ['intel'] })

    resetLayout()
    expect(useWindows.getState().windows).toEqual({})
    expect(savedLayout()).toEqual({ windows: {}, order: [] })
    vi.unstubAllGlobals()
  })
})

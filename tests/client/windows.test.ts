import { describe, expect, it, vi } from 'vitest'
import { savedLayout, useWindows } from '../../src/state/windows'
import { type Rect, clamp, resizeRect, resolve, snap, toPlacement, usableBounds } from '../../src/ui/windows/geometry'

const viewport = { w: 1440, h: 900 }
const bounds = usableBounds(viewport)
const win = (x: number, y: number, w = 240, h = 200): Rect => ({ x, y, w, h })

describe('window snapping', () => {
  it('keeps the top bar, the taskbar and the HUD row clear', () => {
    expect(bounds).toEqual({ left: 12, top: 52, right: 1428, bottom: 800 })
  })

  it('pulls a window to the edge of the usable area', () => {
    expect(snap(win(26, 404), [], bounds)).toEqual({ x: 12, y: 404, guides: [{ axis: 'x', at: 12 }] })
    expect(snap(win(1168, 615), [], bounds)).toEqual({
      x: 1188,
      y: 600,
      guides: [
        { axis: 'x', at: 1428 },
        { axis: 'y', at: 800 },
      ],
    })
  })

  it('parks a window beside another one, a gap apart', () => {
    const layers = win(12, 52, 240, 520)
    expect(snap(win(266, 60, 288, 300), [layers], bounds)).toMatchObject({ x: 260, y: 52 })
    expect(snap(win(16, 590, 240, 100), [layers], bounds)).toEqual({
      x: 12,
      y: 580,
      guides: [
        { axis: 'x', at: 12 },
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
    expect(snap(win(264, 300), [win(12, 52), win(270, 600)], bounds).x).toBe(260)
    expect(snap(win(268, 300), [win(12, 52), win(270, 600)], bounds).x).toBe(270)
  })

  it('falls back to the grid when no magnet is in reach', () => {
    expect(snap(win(605, 303), [], bounds)).toEqual({ x: 604, y: 300, guides: [] })
    expect(snap(win(52, 404), [], bounds, { threshold: 10 }).x).toBe(52)
  })

  it('never leaves a window outside the usable area', () => {
    expect(snap(win(-400, 2000), [], bounds)).toEqual({ x: 12, y: 600, guides: [] })
    // The slot past a window that already touches the right edge is out of bounds, so it is not offered.
    expect(snap(win(1200, 300), [win(1188, 52)], bounds).x).toBe(1188)
    expect(clamp(win(-500, 5000), bounds)).toEqual({ x: 12, y: 600 })
    // Too big to fit: the corner the header is in stays reachable.
    expect(clamp(win(900, 700, 2000, 1000), bounds)).toEqual({ x: 12, y: 52 })
  })
})

describe('window resizing', () => {
  const limits = { min: { w: 200, h: 120 }, max: { w: 600, h: 500 } }
  const start = win(400, 300, 300, 200)
  const within = () => bounds

  it('moves the dragged corner and keeps the opposite one where it was', () => {
    expect(resizeRect(start, 'br', 40, 30, limits, within)).toEqual({ x: 400, y: 300, w: 340, h: 230 })
    expect(resizeRect(start, 'tl', -40, -30, limits, within)).toEqual({ x: 360, y: 270, w: 340, h: 230 })
    expect(resizeRect(start, 'tr', 40, -30, limits, within)).toEqual({ x: 400, y: 270, w: 340, h: 230 })
    expect(resizeRect(start, 'bl', -40, 30, limits, within)).toEqual({ x: 360, y: 300, w: 340, h: 230 })
  })

  it('stops at the smallest and largest size, the far corner still in place', () => {
    expect(resizeRect(start, 'tl', 500, 500, limits, within)).toEqual({ x: 500, y: 380, w: 200, h: 120 })
    expect(resizeRect(start, 'br', 900, 900, limits, within)).toMatchObject({ w: 600, h: 500 })
  })

  it('never takes an edge past the usable area', () => {
    // Up and left only as far as the top bar and the margin; down only to the HUD row.
    expect(resizeRect(start, 'tl', -2000, -2000, { ...limits, max: { w: 2000, h: 2000 } }, within)).toEqual({ x: 12, y: 52, w: 688, h: 448 })
    expect(resizeRect(start, 'br', 0, 2000, { ...limits, max: { w: 2000, h: 2000 } }, within)).toMatchObject({ y: 300, h: 500 })
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

  it('brings a resized window back at its size and place on the next visit, saved or not, until reset', async () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    const nextVisit = async () => {
      vi.resetModules()
      return (await import('../../src/state/windows')).useWindows.getState()
    }
    const placement = { corner: 'tl', dx: 200, dy: 260 } as const
    useWindows.getState().resize('tv', { w: 600, h: 400 }, placement)
    useWindows.getState().close('tv')
    expect((await nextVisit()).windows).toEqual({ tv: { size: { w: 600, h: 400 }, placement } })

    // What an earlier build kept is a bare size, and still read.
    kept.set('pwh-window-sizes', JSON.stringify({ tv: { w: 500, h: 300 } }))
    expect((await nextVisit()).windows).toEqual({ tv: { size: { w: 500, h: 300 } } })

    const second = await nextVisit()
    second.resetLayout()
    expect((await nextVisit()).windows).toEqual({})
    vi.unstubAllGlobals()
  })
})

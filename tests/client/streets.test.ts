import { describe, expect, it } from 'vitest'
import { hatchImage, metres, PAINT_ZOOM, STREETS_PALETTES, STREETS_SOURCE, STREETS_ZOOM, streetsLayers, tilesInView } from '../../src/map/streets'

describe('streets lane by lane on the map', () => {
  it('fetches the z15 tiles a view reaches into, and none for a view too wide', () => {
    // A few hundred metres of central Rīga: one tile or a few.
    const few = tilesInView([24.1, 56.948, 24.108, 56.952])
    expect(few.length).toBeGreaterThan(0)
    expect(few.length).toBeLessThanOrEqual(4)
    for (const [x, y] of few) {
      expect(x).toBe(Math.floor(((24.1 + 180) / 360) * 2 ** 15) + (x - few[0][0]))
      expect(y).toBeGreaterThan(0)
    }
    expect(tilesInView([23.5, 56.5, 24.5, 57.2])).toEqual([])
  })

  it('draws the asphalt, then what lies on it, then the paint; a bridge after the ground, its shadow first', () => {
    const ids = streetsLayers('light').map((l) => l.id)
    const at = (id: string) => ids.indexOf(id)
    expect(at('streets-tunnel')).toBe(0)
    expect(ids.some((id) => id.startsWith('streets-sidewalk'))).toBe(false)
    expect(at('streets-island')).toBeGreaterThan(at('streets-asphalt'))
    expect(at('streets-lane-short')).toBeGreaterThan(at('streets-island'))
    expect(at('streets-arrows')).toBeGreaterThan(at('streets-lane-short'))
    expect(at('streets-bridge-shadow')).toBeGreaterThan(at('streets-arrows'))
    expect(at('streets-asphalt-bridge')).toBe(at('streets-bridge-shadow') + 1)
    expect(new Set(ids).size).toBe(ids.length)
    for (const layer of streetsLayers('dark')) {
      expect((layer as { source: string }).source).toBe(STREETS_SOURCE)
      // The asphalt from STREETS_ZOOM; the paint, as on a detailed city map, only closer in.
      expect(layer.minzoom).toBeGreaterThanOrEqual(STREETS_ZOOM)
    }
    expect(streetsLayers('light').find((l) => l.id === 'streets-lane-short')!.minzoom).toBe(PAINT_ZOOM)
  })

  it('gives each theme its own asphalt and paint', () => {
    const colour = (theme: 'light' | 'dark') => (streetsLayers(theme).find((l) => l.id === 'streets-asphalt')!.paint as Record<string, unknown>)['fill-color']
    expect(colour('light')).toBe(STREETS_PALETTES.light.asphalt)
    expect(colour('dark')).toBe(STREETS_PALETTES.dark.asphalt)
    expect(STREETS_PALETTES.light.asphalt).not.toBe(STREETS_PALETTES.dark.asphalt)
  })

  it('draws paint as wide as it is on the road: twice as wide a zoom closer in', () => {
    const stops = (metres(0.15) as unknown[]).slice(3) as number[]
    const at = (z: number) => stops[stops.indexOf(z) + 1]
    expect(at(19) / at(18)).toBeCloseTo(2, 6)
    // About 6 px a metre at zoom 18 in the Baltic states.
    expect(at(18) / 0.15).toBeGreaterThan(5)
    expect(at(18) / 0.15).toBeLessThan(7)
    expect((metres(0.15, 1).slice(3) as number[])[1]).toBe(1)
  })

  it('hatches in the theme’s paint over its asphalt, and greens a grass island', () => {
    const paint = (theme: 'light' | 'dark', id: string) => streetsLayers(theme).find((l) => l.id === id)!.paint as Record<string, unknown>
    expect(paint('dark', 'streets-hatch')['fill-pattern']).toBe('streets-hatch-dark')
    expect(JSON.stringify(paint('light', 'streets-island')['fill-color'])).toContain(STREETS_PALETTES.light.grass)
    const { width, height, data } = hatchImage(STREETS_PALETTES.light)
    expect(data.length).toBe(width * height * 4)
    const pixels = new Set(Array.from({ length: width * height }, (_, i) => Array.from(data.slice(i * 4, i * 4 + 3), (v) => v.toString(16).padStart(2, '0')).join('')))
    expect([...pixels].sort()).toEqual(['b4b4b4', 'ffffff'])
  })
})

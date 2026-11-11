import { describe, expect, it } from 'vitest'
import { hatchImage, STREETS_PALETTES, STREETS_SOURCE, STREETS_ZOOM, streetsLayers, tilesInView } from '../../src/map/streets'

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

  it('stacks pavements, asphalt, paint, hatching and islands, then a bridge over them', () => {
    const ids = streetsLayers('light').map((l) => l.id)
    expect(ids).toEqual([
      'streets-pavement',
      'streets-asphalt',
      'streets-paint',
      'streets-hatch',
      'streets-hatch-edge',
      'streets-island',
      'streets-island-kerb',
      'streets-bridge-casing',
      'streets-pavement-bridge',
      'streets-asphalt-bridge',
      'streets-paint-bridge',
    ])
    for (const layer of streetsLayers('dark')) {
      expect((layer as { source: string }).source).toBe(STREETS_SOURCE)
      expect(layer.minzoom).toBe(STREETS_ZOOM)
    }
  })

  it('colours a lane by what it is for, in each theme', () => {
    const colour = (theme: 'light' | 'dark') => JSON.stringify((streetsLayers(theme).find((l) => l.id === 'streets-asphalt')!.paint as Record<string, unknown>)['fill-color'])
    expect(colour('light')).toContain(STREETS_PALETTES.light.bus)
    expect(colour('light')).toContain(STREETS_PALETTES.light.asphalt)
    expect(colour('dark')).toContain(STREETS_PALETTES.dark.asphalt)
    expect(STREETS_PALETTES.light.asphalt).not.toBe(STREETS_PALETTES.dark.asphalt)
  })

  it('hatches in the theme’s paint over its asphalt, and greens a grass island', () => {
    const paint = (theme: 'light' | 'dark', id: string) => streetsLayers(theme).find((l) => l.id === id)!.paint as Record<string, unknown>
    expect(paint('dark', 'streets-hatch')['fill-pattern']).toBe('streets-hatch-dark')
    expect(JSON.stringify(paint('light', 'streets-island')['fill-color'])).toContain(STREETS_PALETTES.light.grass)
    const { width, height, data } = hatchImage(STREETS_PALETTES.light)
    expect(data.length).toBe(width * height * 4)
    const pixels = new Set(Array.from({ length: width * height }, (_, i) => Array.from(data.slice(i * 4, i * 4 + 3), (v) => v.toString(16).padStart(2, '0')).join('')))
    expect([...pixels].sort()).toEqual(['a3a8b0', 'ffffff'])
  })
})

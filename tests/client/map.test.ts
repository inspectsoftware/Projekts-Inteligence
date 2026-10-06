import type { FeatureCollection, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { buildCsp } from '../../shared/csp'
import { formatLat, formatLon, formatMgrs, scaleBar } from '../../src/lib/coords'
import { RASTER_BASES, gibsDate } from '../../src/map/basemaps'
import { buildMask } from '../../src/map/spotlight'
import { buildStyle } from '../../src/map/style'

/** Every absolute URL anywhere inside a JSON-like value. */
function urlsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) found.push(value)
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) urlsIn(child, found)
  }
  return found
}

describe('content security policy', () => {
  it('allows every origin the map loads from', () => {
    const now = new Date('2026-10-06T08:00:00Z')
    const urls = [...urlsIn(buildStyle()), ...Object.values(RASTER_BASES).map((base) => base.tiles(now))]
    expect(urls.length).toBeGreaterThan(3)

    const connectSrc = buildCsp()
      .split('; ')
      .find((directive) => directive.startsWith('connect-src '))!
      .split(' ')
    for (const url of urls) expect(connectSrc, url).toContain(new URL(url).origin)
  })
})

describe('basemaps', () => {
  it("asks GIBS for yesterday's UTC date", () => {
    expect(gibsDate(new Date('2026-10-06T00:30:00Z'))).toBe('2026-10-05')
    expect(RASTER_BASES.daily.tiles(new Date('2026-03-01T12:00:00Z'))).toContain('/2026-02-28/')
  })
})

describe('coordinates', () => {
  it('formats MGRS for both UTM zones Latvia spans', () => {
    expect(formatMgrs(24.1052, 56.9496)).toBe('35V LD 23939 15504')
    expect(formatMgrs(21.01, 55.7)).toBe('34U EG 00628 72691')
  })

  it('does not attempt MGRS at the poles', () => {
    expect(formatMgrs(0, 89)).toBe('—')
  })

  it('formats latitude and longitude with hemispheres', () => {
    expect(formatLat(56.9496)).toBe('56.94960° N')
    expect(formatLon(24.1052)).toBe('024.10520° E')
    expect(formatLon(-3.5)).toBe('003.50000° W')
  })

  it('picks a round scale bar that fits', () => {
    const bar = scaleBar(56.9, 6.5, 110)
    expect(bar.px).toBeLessThanOrEqual(110)
    expect(bar.px).toBeGreaterThan(40)
    expect(bar.label).toMatch(/^(1|2|5)0* (km|m)$/)
  })
})

describe('spotlight mask', () => {
  it('covers the world with the country cut out', () => {
    const ring = [
      [21, 56],
      [28, 56],
      [28, 58],
      [21, 58],
      [21, 56],
    ]
    const lake = [
      [24, 57],
      [24.1, 57],
      [24.1, 57.1],
      [24, 57],
    ]
    const border: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring, lake] } }],
    }
    const mask = buildMask(border)
    // World ring plus one hole: the lake inside the country must not become a second hole.
    expect(mask.geometry.coordinates).toHaveLength(2)
    expect(mask.geometry.coordinates[0][0]).toEqual([-180, -85])
    expect(mask.geometry.coordinates[1]).toBe(ring)
  })
})

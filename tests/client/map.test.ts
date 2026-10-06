import { readFileSync } from 'node:fs'
import type { FeatureCollection, Polygon } from 'geojson'
import type { Map, RequestParameters } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCsp } from '../../shared/csp'
import { BROWSER_ORIGINS, LITHUANIA_ENABLED, LITHUANIA_ORIGIN, RADAR_INDEX_URL, TILE_ORIGINS } from '../../shared/origins'
import { formatLat, formatLon, formatMgrs, scaleBar } from '../../src/lib/coords'
import { applyZoomCeiling } from '../../src/map/baseMode'
import { BASE_MODES, MAX_ZOOM, ORTHO_LITHUANIA, RASTER_BASES, clampZoom, gibsDate, zoomCeiling } from '../../src/map/basemaps'
import {
  CLIP_SCHEME,
  MARGIN,
  NAVY,
  TRIM_SCHEME,
  WHITE,
  borderRings,
  dropFill,
  estoniaTileUrl,
  latviaTileUrl,
  loadLatviaTile,
  placeTile,
  setClipBorder,
  toWorld,
} from '../../src/map/orthoClip'
import { PATIENT_SCHEME, patientUrl } from '../../src/map/patientTiles'
import { buildMask } from '../../src/map/spotlight'
import { FIRST_LAYER_OVER_PHOTOS, FIRST_OVERLAY_LAYER, IMAGERY_TEXT_COLOR, buildStyle } from '../../src/map/style'

afterEach(() => vi.unstubAllGlobals())

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
    // Two templates name a protocol of ours; what the browser really asks for is behind it.
    const behind: Record<string, string> = {
      [`${CLIP_SCHEME}://{z}/{x}/{y}`]: latviaTileUrl(14, 9289, 5023),
      [`${TRIM_SCHEME}://{z}/{x}/{y}`]: estoniaTileUrl(18, 149097, 76939),
    }
    const urls = [
      ...urlsIn(buildStyle()),
      ...Object.values(RASTER_BASES)
        .flatMap((base) => base.sources)
        .map((source) => source.tiles(now))
        .map((tiles) => behind[tiles] ?? (tiles.startsWith(PATIENT_SCHEME) ? patientUrl(tiles) : tiles)),
      RADAR_INDEX_URL,
      `${TILE_ORIGINS.rainViewerTiles}/v2/radar/abc123/256/6/36/19/2/1_1.png`,
    ]
    // Nor is anything allowed that the map does not load from.
    expect(new Set(urls.map((url) => new URL(url).origin))).toEqual(new Set(BROWSER_ORIGINS))

    // Tiles are fetched and then decoded, but a browser may also load one as a plain image.
    for (const name of ['connect-src', 'img-src']) {
      const allowed = buildCsp()
        .split('; ')
        .find((directive) => directive.startsWith(`${name} `))!
        .split(' ')
      for (const url of urls) {
        expect(url.startsWith('https://'), url).toBe(true)
        expect(allowed, `${name} ${url}`).toContain(new URL(url).origin)
      }
    }
  })

  it('allows the Lithuanian service exactly while its layer is switched on', () => {
    expect(new URL(ORTHO_LITHUANIA.tiles(new Date())).origin).toBe(LITHUANIA_ORIGIN)
    expect(buildCsp().includes(LITHUANIA_ORIGIN)).toBe(LITHUANIA_ENABLED)
    expect(RASTER_BASES.imagery.sources.includes(ORTHO_LITHUANIA)).toBe(LITHUANIA_ENABLED)
  })
})

describe('basemaps', () => {
  it("asks GIBS for yesterday's UTC date", () => {
    expect(gibsDate(new Date('2026-10-06T00:30:00Z'))).toBe('2026-10-05')
    expect(RASTER_BASES.daily.sources[0].tiles(new Date('2026-03-01T12:00:00Z'))).toContain('/2026-02-28/')
  })

  it('stacks the orthophotos in the order that hides their edges', () => {
    // Estonia under Latvia (its navy edge), Lithuania on top (its own clean cut), and only when switched on.
    const ids = RASTER_BASES.imagery.sources.map((source) => source.id)
    expect(ids).toEqual(['eox', 'ee', 'lv', ...(LITHUANIA_ENABLED ? ['lt'] : [])])
  })

  it('lays only the air photos over the drawn streets', () => {
    const over = Object.values(RASTER_BASES).flatMap((base) => base.sources.filter((source) => source.coversStreets).map((source) => source.id))
    expect(over).toEqual(['ee', 'lv', ...(LITHUANIA_ENABLED ? ['lt'] : [])])
    expect(ORTHO_LITHUANIA.coversStreets).toBe(true)
  })

  it('stops each base two levels past its sharpest tiles, and never past the map limit', () => {
    expect(BASE_MODES.map((mode) => zoomCeiling(mode.id))).toEqual([MAX_ZOOM, MAX_ZOOM, 13, 10, 9])
    expect(MAX_ZOOM).toBe(19)
  })

  it('pulls a shared link back to the ceiling of the base it opens on', () => {
    expect(clampZoom(22, 'night')).toBe(9)
    expect(clampZoom(22, 'imagery')).toBe(19)
    expect(clampZoom(6.5, 'night')).toBe(6.5)
  })
})

describe('street-level style', () => {
  const layers = buildStyle().layers

  it('starts house numbers and places at level 16, where stretched tiles still carry them', () => {
    for (const id of ['label-housenumber', 'label-poi']) expect(layers.find((layer) => layer.id === id)?.minzoom, id).toBe(16)
  })

  it('switches label colours on real layers, starting from what the dark style gives them', () => {
    for (const [id, dark] of IMAGERY_TEXT_COLOR) {
      const layer = layers.find((candidate) => candidate.id === id)
      expect((layer?.paint as Record<string, unknown> | undefined)?.['text-color'], id).toEqual(dark)
    }
  })

  it('puts every drawn street and runway under the air photos, and every label and border over them', () => {
    const order = layers.map((layer) => layer.id)
    const under = order.slice(order.indexOf(FIRST_OVERLAY_LAYER), order.indexOf(FIRST_LAYER_OVER_PHOTOS))
    const covered = (id: string) => id.startsWith('road-') || id.startsWith('aeroway-')
    expect(order.filter(covered).every((id) => under.includes(id))).toBe(true)
    expect(under.filter((id) => id.startsWith('road-'))).toHaveLength(6)
    expect(under.some((id) => id.startsWith('label-') || id.startsWith('boundary-'))).toBe(false)
  })
})

describe('zoom ceiling', () => {
  /** A map 18 levels deep that records what is asked of it. */
  function fakeMap() {
    const asked: string[] = []
    let landed: (() => void) | undefined
    const map = {
      getZoom: () => 18,
      setMaxZoom: (zoom: number) => asked.push(`limit ${zoom}`),
      stop: () => asked.push('stop'),
      once: (_type: string, listener: () => void) => (landed = listener),
      off: () => (landed = undefined),
      easeTo: ({ zoom }: { zoom: number }) => asked.push(`ease ${zoom}`),
    }
    return { map: map as unknown as Map, asked, land: () => landed?.() }
  }

  it('eases a deeper camera out first, and sets the limit when it lands', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const { map, asked, land } = fakeMap()
    const cancel = applyZoomCeiling(map, 9)
    expect(asked).toEqual(['stop', 'ease 9'])
    land()
    cancel()
    expect(asked).toEqual(['stop', 'ease 9', 'limit 9'])
  })

  it('stops its own flight when the base changes again before it lands', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const { map, asked, land } = fakeMap()
    applyZoomCeiling(map, 9)()
    // The listener is gone, so the stop cannot set the old limit after all.
    land()
    expect(asked).toEqual(['stop', 'ease 9', 'stop'])
    // The base that follows allows the zoom the camera is at: no flight, nothing to stop.
    applyZoomCeiling(map, 19)()
    expect(asked.slice(3)).toEqual(['limit 19'])
  })
})

describe('orthophoto clip', () => {
  // A right triangle over the top-left half of the world: (0,0), (1,0), (0,1).
  const triangle: [number, number][][] = [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ]

  it('tells tiles inside, outside and on the border apart', () => {
    expect(placeTile(triangle, 3, 1, 1)).toBe('inside')
    expect(placeTile(triangle, 3, 0, 0)).toBe('edge')
    // The long side runs through this tile without ending in it.
    expect(placeTile(triangle, 3, 3, 4)).toBe('edge')
    // Its bounding box overlaps that of the long side, but the side passes well clear of it.
    expect(placeTile(triangle, 3, 7, 7)).toBe('outside')
    expect(placeTile([], 3, 1, 1)).toBe('outside')
  })

  it('counts a tile just outside the border as on it, up to the margin', () => {
    // The top side of the triangle, moved down to lie just under one row of level 18 tiles.
    const lowered = (by: number) => [triangle[0].map(([x, y]): [number, number] => [x, y + by])]
    const size = 1 / 2 ** 18
    expect(placeTile(lowered(size + MARGIN * 0.9), 18, 1000, 0)).toBe('edge')
    expect(placeTile(lowered(size + MARGIN * 1.1), 18, 1000, 0)).toBe('outside')
  })

  it('places real tiles against the border the app ships', () => {
    const rings = borderRings(JSON.parse(readFileSync(new URL('../../public/data/lv-border.json', import.meta.url), 'utf8')))
    const place = (lon: number, lat: number, z: number) => {
      const [x, y] = toWorld(lon, lat).map((v) => Math.floor(v * 2 ** z))
      return placeTile(rings, z, x, y)
    }
    expect(place(24.105, 56.949, 18)).toBe('inside') // Rīga old town
    expect(place(26.0227, 57.7745, 16)).toBe('edge') // the Valka / Valga crossing
    expect(place(23.6, 57.5, 14)).toBe('outside') // Gulf of Rīga
    expect(place(24.7536, 59.437, 14)).toBe('outside') // Tallinn
    expect(place(25.2797, 54.6872, 14)).toBe('outside') // Vilnius
  })

  it('projects longitude and latitude onto the tile grid', () => {
    // The Rīga tile the service was checked with: level 19, column 297249, row 160757.
    expect(toWorld(24.105, 56.949).map((v) => Math.floor(v * 2 ** 19))).toEqual([297249, 160757])
  })

  it('hands on an empty tile only where the service has none, and an error when it fails', async () => {
    setClipBorder(JSON.parse(readFileSync(new URL('../../public/data/lv-border.json', import.meta.url), 'utf8')))
    const load = (url: string, status?: number) => {
      // No answer set up means the service must not be asked at all.
      vi.stubGlobal('fetch', () => (status ? Promise.resolve(new Response(status === 200 ? 'photo' : null, { status })) : Promise.reject(new Error('asked'))))
      return loadLatviaTile({ url } as RequestParameters, new AbortController())
    }
    const riga = `${CLIP_SCHEME}://18/148624/80378`
    expect(((await load(`${CLIP_SCHEME}://14/9266/4977`)).data as ArrayBuffer).byteLength).toBe(0) // Gulf of Rīga
    expect(((await load(riga, 400)).data as ArrayBuffer).byteLength).toBe(0)
    expect(((await load(riga, 200)).data as ArrayBuffer).byteLength).toBe(5)
    // An empty tile would be kept as the answer; an error is asked about again.
    await expect(load(riga, 503)).rejects.toThrow('503')
    await expect(load(riga, 429)).rejects.toThrow('429')
  })
})

describe('blank fill', () => {
  /** A square tile, 8 blocks a side, of one grey, with rectangles painted on it. */
  function tile(ground: number) {
    const size = 64
    const rgba = new Uint8ClampedArray(size * size * 4)
    const rect = (x0: number, y0: number, x1: number, y1: number, pixel: readonly number[]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set(pixel.length === 4 ? pixel : [...pixel, 255], (y * size + x) * 4)
    }
    rect(0, 0, size, size, [ground, ground, ground])
    return { rgba, size, rect, alpha: (x: number, y: number) => rgba[(y * size + x) * 4 + 3] }
  }
  const white = [255, 255, 255]

  it('takes out fill behind the edge of a photo, tinge and ringing included', () => {
    const { rgba, size, rect, alpha } = tile(40)
    rect(0, 0, 24, size, white)
    rect(16, 0, 24, size, [253, 255, 255]) // the block next to the photo, tinged by it
    rect(24, 3, 25, 4, [215, 215, 215]) // ringing on the photo's side of the edge
    rect(0, 56, 4, size, [0, 0, 0, 0]) // the border has already cut half of a block away
    rect(50, 30, 51, 31, white) // a white van, deep in the photo

    expect(dropFill(rgba, size, WHITE)).toBe(true)
    expect([alpha(0, 0), alpha(20, 10), alpha(6, 60)]).toEqual([0, 0, 0])
    expect([alpha(24, 3), alpha(25, 3)]).toEqual([0, 255])
    expect(alpha(50, 30)).toBe(255)
  })

  it('takes out a pocket of fill on one side of a tile, and leaves glare on a white roof there alone', () => {
    // Three blocks by three of pure white on the left rim: fill where forest surrounds it,
    // the burnt-out middle of a roof where roof does.
    const pocket = tile(40)
    pocket.rect(0, 24, 24, 48, white)
    expect(dropFill(pocket.rgba, pocket.size, WHITE)).toBe(true)
    expect(pocket.alpha(10, 30)).toBe(0)

    const roof = tile(40)
    roof.rect(0, 16, 40, 56, [245, 245, 245])
    roof.rect(0, 24, 24, 48, white)
    expect(dropFill(roof.rgba, roof.size, WHITE)).toBe(false)
    expect(roof.rgba.every((value, i) => i % 4 !== 3 || value === 255)).toBe(true)
  })

  it('leaves alone a roof burnt out from side to side, which is tinged far from any photo', () => {
    const { rgba, size, rect } = tile(40)
    rect(0, 0, size, 40, [255, 253, 255])
    expect(dropFill(rgba, size, WHITE)).toBe(false)
  })

  it('takes out Estonian navy and leaves sea of nearly the same colour', () => {
    const { rgba, size, rect, alpha } = tile(0)
    rect(0, 0, size, size, [29, 48, 79])
    expect(dropFill(new Uint8ClampedArray(rgba), size, NAVY)).toBe(false)

    rect(40, 0, size, size, [34, 55, 70])
    rect(32, 0, 40, size, [40, 58, 64]) // navy tinged by the photo beside it
    expect(dropFill(rgba, size, NAVY)).toBe(true)
    expect([alpha(60, 5), alpha(35, 5), alpha(20, 5)]).toEqual([0, 0, 255])
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

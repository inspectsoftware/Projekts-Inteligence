import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { AddProtocolAction } from 'maplibre-gl'
import { pointInRing } from '../../shared/geo/pip'
import { TILE_ORIGINS } from '../../shared/origins'

/**
 * Latvia's orthophoto service paints whatever it has no photo for opaque white: the open sea, and
 * a rectangle that reaches into Lithuania, Estonia and Russia. Its tiles therefore come through a
 * protocol of our own, which cuts them to the national border before the map sees them.
 */
export const CLIP_SCHEME = 'lvclip'

/**
 * Estonia's paints navy instead, in every tile that is only partly photo: a band one tile wide
 * along the edge of its coverage, out at sea and a few kilometres past its land border. There is
 * no outline to cut those to, so its tiles come through a second protocol that only takes the navy out.
 */
export const TRIM_SCHEME = 'eetrim'

// The path carries a public token and the host has moved once already, so it is written only here.
const SERVICE = `${TILE_ORIGINS.lvmGeo}/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8`

export function latviaTileUrl(z: number, x: number, y: number): string {
  return `${SERVICE}&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`
}

export function estoniaTileUrl(z: number, x: number, y: number): string {
  return `${TILE_ORIGINS.maaamet}/tm/wmts/1.0.0/foto/default/GMC/${z}/${y}/${x}.jpg`
}

/** A ring in world units: fractions of the Web Mercator square, measured from its top-left corner. */
type Ring = readonly (readonly [number, number])[]

export function toWorld(lon: number, lat: number): [number, number] {
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2]
}

/** Outer rings only: a lake inside the country is photographed like the land around it. */
export function borderRings(border: FeatureCollection<Polygon | MultiPolygon>): Ring[] {
  return border.features.flatMap(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    return polygons.map(([outer]) => outer.map(([lon, lat]) => toWorld(lon, lat)))
  })
}

/**
 * The border the app ships is simplified and strays from the real one by a few hundred metres,
 * both ways. So the cut is made this far outside it, which keeps beaches and harbour moles sharp,
 * and every tile this close to it is also checked for blank fill, which the cut then leaves in
 * places all the way round: off the capes, and inside the border wherever the photo ends short
 * of it. About 500 m at Latvia's latitude, in world units.
 */
export const MARGIN = 500 / (40_075_017 * Math.cos((57 * Math.PI) / 180))

/** Whether the segment a-b touches the box. */
function segmentMeetsBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return false
  // Their bounding boxes overlap, so the segment misses only if all four corners lie on one side of it.
  const side = (px: number, py: number) => Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax))
  const first = side(x0, y0)
  return first === 0 || side(x1, y0) !== first || side(x1, y1) !== first || side(x0, y1) !== first
}

/**
 * Where a tile lies relative to the border. Only an 'edge' tile needs the canvas: an 'inside' one
 * is passed on as it arrives, and an 'outside' one is never downloaded.
 */
export function placeTile(rings: readonly Ring[], z: number, x: number, y: number): 'inside' | 'outside' | 'edge' {
  const n = 2 ** z
  const x0 = x / n - MARGIN
  const y0 = y / n - MARGIN
  const x1 = (x + 1) / n + MARGIN
  const y1 = (y + 1) / n + MARGIN
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      if (segmentMeetsBox(ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], x0, y0, x1, y1)) return 'edge'
    }
  }
  // No border anywhere near: the whole tile is on whichever side its centre is.
  return rings.some((ring) => pointInRing((x + 0.5) / n, (y + 0.5) / n, ring)) ? 'inside' : 'outside'
}

/** JPEG stores brightness in blocks of this many pixels, and colour in squares of twice as many. */
const BLOCK = 8

/**
 * What a service paints where it has no photo, told pixel by pixel. Because colour is stored more
 * coarsely than brightness, a block of fill beside the photo keeps its exact brightness and takes
 * on a tinge.
 */
export interface Fill {
  /** Fill with nothing but fill around it. */
  exact(r: number, g: number, b: number): boolean
  /** Fill in a block that is all fill, tinged or not. */
  flat(r: number, g: number, b: number): boolean
  /** What may be fill in a block the fill shares with the photo, where everything rings. */
  near(r: number, g: number, b: number): boolean
  /** What a look-alike lies in, if there is one: the rest of the white roof around a patch of glare. */
  setting?(r: number, g: number, b: number): boolean
}

// Measured on some 3000 border tiles. White at full brightness always leaves one channel at the
// limit, whatever the tinge does to the other two, and no photo does that over a whole block
// unless it is burnt out.
export const WHITE: Fill = {
  exact: (r, g, b) => Math.min(r, g, b) >= 254,
  flat: (r, g, b) => Math.max(r, g, b) >= 254 && Math.min(r, g, b) >= 243,
  near: (r, g, b) => Math.min(r, g, b) >= 200,
  setting: (r, g, b) => Math.min(r, g, b) >= 230,
}

// Navy, unlike white, is a colour the photo has too: the sea in Estonia's own pictures comes within
// a few levels of it, in blocks just as flat. So only the exact colour counts as a block of fill,
// and the tinged blocks beside the photo go as its neighbours.
const navy = (by: number) => (r: number, g: number, b: number) => Math.abs(r - 34) <= by && Math.abs(g - 55) <= by && Math.abs(b - 70) <= by
export const NAVY: Fill = { exact: navy(2), flat: navy(2), near: navy(20) }

const PHOTO = 0
const PURE = 1
const TINGED = 2

/**
 * Makes blank fill transparent, and says whether it found any. Fill is what lies beyond the edge
 * of the photo, so it is looked for as patches of blank blocks on the rim of the tile. Colour alone
 * cannot tell such a patch from the glare on a white roof, which is burnt out to the same white,
 * so two more things are asked of it: that it is tinged only where the photo is close enough to
 * tinge it, and that it is not ringed by more roof.
 * Within two blocks of fill, as far as the tinge reaches, anything close to it in colour goes too.
 * ponytail: glare that passes for fill on both counts still goes, and fill that reaches less than
 * a block into a tile from the next one stays, as a pale dash on the seam. The cure for both is to
 * judge a tile with a gutter of its neighbours' pixels around it.
 */
export function dropFill(rgba: Uint8ClampedArray, size: number, fill: Fill): boolean {
  const n = size / BLOCK
  /** Offset of pixel p of block b. */
  const at = (b: number, p: number) => (((b / n) | 0) * BLOCK + ((p / BLOCK) | 0)) * size * 4 + ((b % n) * BLOCK + (p % BLOCK)) * 4
  /** Whether every pixel of a block that is still there passes. A pixel already cut away says nothing either way. */
  const all = (b: number, test: Fill['flat']) => {
    for (let p = 0; p < BLOCK * BLOCK; p++) {
      const i = at(b, p)
      if (rgba[i + 3] !== 0 && !test(rgba[i], rgba[i + 1], rgba[i + 2])) return false
    }
    return true
  }
  // A block half outside the border and fill for the rest counts as fill, and the part cut away
  // counts too, which carries a patch along the cut.
  const kind = Uint8Array.from({ length: n * n }, (_, b) => (!all(b, fill.flat) ? PHOTO : all(b, fill.exact) ? PURE : TINGED))
  /** The sides of the tile a block lies on, one bit each. */
  const sides = (b: number) => (b % n === 0 ? 1 : 0) | (b % n === n - 1 ? 2 : 0) | (b < n ? 4 : 0) | (b >= n * n - n ? 8 : 0)
  /** The blocks within `reach` of block b that are photo. */
  const photoBy = (b: number, reach: number) => {
    const found: number[] = []
    for (let y = Math.max(((b / n) | 0) - reach, 0); y <= Math.min(((b / n) | 0) + reach, n - 1); y++) {
      for (let x = Math.max((b % n) - reach, 0); x <= Math.min((b % n) + reach, n - 1); x++) if (kind[y * n + x] === PHOTO) found.push(y * n + x)
    }
    return found
  }

  /** Whether a patch of blank blocks, touching these sides of the tile, is fill and not glare. */
  const isFill = (patch: readonly number[], touched: number) => {
    // A tinge comes from a photo in the same square of colour or the next, two blocks away at most.
    // Glare is tinged all over.
    if (patch.some((b) => kind[b] === TINGED && photoBy(b, 2).length === 0)) return false
    if (!fill.setting) return true
    const shore = new Set(patch.flatMap((b) => photoBy(b, 1)))
    let alike = 0
    for (const b of shore) if (all(b, fill.setting)) alike++
    // The edge of a photo mostly crosses a tile from side to side, so a patch on one side only is
    // suspect from the start: a sixth of its shore being roof condemns it. Otherwise it takes half.
    return alike * ((touched & (touched - 1)) === 0 ? 6 : 2) <= shore.size
  }

  // Per block: 1 once it has been in a patch, 2 if that patch was fill.
  const fate = new Uint8Array(n * n)
  let found = false
  for (let seed = 0; seed < n * n; seed++) {
    if (sides(seed) === 0 || fate[seed] !== 0 || kind[seed] === PHOTO) continue
    const patch = [seed]
    let touched = 0
    fate[seed] = 1
    for (let k = 0; k < patch.length; k++) {
      const b = patch[k]
      touched |= sides(b)
      for (const next of [b % n > 0 ? b - 1 : -1, b % n < n - 1 ? b + 1 : -1, b - n, b + n]) {
        if (next < 0 || next >= n * n || fate[next] !== 0 || kind[next] === PHOTO) continue
        fate[next] = 1
        patch.push(next)
      }
    }
    if (!isFill(patch, touched)) continue
    for (const b of patch) fate[b] = 2
    found = true
  }
  if (!found) return false

  for (let b = 0; b < n * n; b++) {
    const bx = b % n
    const by = (b / n) | 0
    let beside = false
    for (let y = Math.max(by - 2, 0); y <= Math.min(by + 2, n - 1); y++) {
      for (let x = Math.max(bx - 2, 0); x <= Math.min(bx + 2, n - 1); x++) beside ||= fate[y * n + x] === 2
    }
    if (!beside) continue
    for (let p = 0; p < BLOCK * BLOCK; p++) {
      const i = at(b, p)
      if (fate[b] === 2 || fill.near(rgba[i], rgba[i + 1], rgba[i + 2])) rgba[i + 3] = 0
    }
  }
  return true
}

/** A canvas whose pixels are read back, which is cheapest when it never leaves main memory. */
function surface(size: number): OffscreenCanvasRenderingContext2D {
  return new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!
}

/**
 * Keeps the part of a border tile that is inside Latvia, or within the margin of it, and is a photo.
 * ponytail: OffscreenCanvas, so Safari older than 16.4 shows no Latvian photo along the border itself.
 */
function clipTile(image: ImageBitmap, rings: readonly Ring[], z: number, x: number, y: number): ImageBitmap {
  const size = image.width
  const g = surface(size)
  // The country goes down first, in this tile's pixels; the photo then lands only where it was drawn.
  const scale = size * 2 ** z
  g.beginPath()
  for (const ring of rings) {
    ring.forEach(([wx, wy], i) => {
      const px = wx * scale - x * size
      const py = wy * scale - y * size
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    })
    g.closePath()
  }
  g.fill()
  g.lineWidth = 2 * MARGIN * scale
  g.lineJoin = 'round'
  g.stroke()
  g.globalCompositeOperation = 'source-in'
  g.drawImage(image, 0, 0)

  const pixels = g.getImageData(0, 0, size, size)
  if (dropFill(pixels.data, size, WHITE)) g.putImageData(pixels, 0, 0)
  return g.canvas.transferToImageBitmap()
}

/** Takes the navy out of an Estonian tile. One without any, which is nearly all of them, is handed back as it came. */
function trimTile(image: ImageBitmap): ImageBitmap {
  const size = image.width
  const g = surface(size)
  g.drawImage(image, 0, 0)
  const pixels = g.getImageData(0, 0, size, size)
  if (!dropFill(pixels.data, size, NAVY)) return image
  g.putImageData(pixels, 0, 0)
  return g.canvas.transferToImageBitmap()
}

// Empty until the border has loaded. With no rings every tile counts as outside, so nothing is shown unclipped.
let rings: readonly Ring[] = []

export function setClipBorder(border: FeatureCollection<Polygon | MultiPolygon>): void {
  rings = borderRings(border)
}

// An empty body is the map library's own way of hearing "nothing here": it draws a transparent tile.
const NOTHING = new ArrayBuffer(0)

/** The z, x and y of `scheme://z/x/y`. */
function tileOf(url: string): number[] {
  return url.slice(url.indexOf('://') + 3).split('/').map(Number)
}

/**
 * A service having a bad moment must not leave a hole for good, which an empty tile would: the
 * map keeps those. An error it does not keep, so it shows what lies below and asks again later.
 */
function refused(res: Response): Error {
  return new Error(`Orthophoto tile refused with HTTP ${res.status}: ${res.url}`)
}

/** Answers `lvclip://z/x/y`. Runs once per tile, never per frame. */
export const loadLatviaTile: AddProtocolAction = async ({ url }, abort) => {
  const [z, x, y] = tileOf(url)
  const place = placeTile(rings, z, x, y)
  if (place === 'outside') return { data: NOTHING }
  const res = await fetch(latviaTileUrl(z, x, y), { signal: abort.signal })
  // The service answers 400 beyond its own grid, which only just contains the country.
  if (res.status === 400) return { data: NOTHING }
  if (!res.ok) throw refused(res)
  if (place === 'inside') return { data: await res.arrayBuffer() }
  return { data: clipTile(await createImageBitmap(await res.blob()), rings, z, x, y) }
}

/** Answers `eetrim://z/x/y`, likewise once per tile. */
export const loadEstoniaTile: AddProtocolAction = async ({ url }, abort) => {
  const [z, x, y] = tileOf(url)
  const res = await fetch(estoniaTileUrl(z, x, y), { signal: abort.signal })
  if (!res.ok) throw refused(res)
  const blob = await res.blob()
  // Beyond its photo the service sends a small transparent PNG, with nothing in it to look for.
  // Nor is there a way to look without OffscreenCanvas: Safari older than 16.4 keeps the navy.
  if (blob.type !== 'image/jpeg' || typeof OffscreenCanvas === 'undefined') return { data: await blob.arrayBuffer() }
  return { data: trimTile(await createImageBitmap(blob)) }
}

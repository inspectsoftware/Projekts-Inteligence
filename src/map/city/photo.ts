import type { Map as MapLibreMap } from 'maplibre-gl'
import { type LngLat, cameraDistanceMetres, cameraGround, moveMetres, offsetMetres } from './sources'
import type { CityJob } from './types'

/**
 * The air photos Sat 3D lays on the roofs, kept for the whole city at once rather than per piece:
 * neighbouring pieces then never disagree, and no photo is fetched or stored twice.
 *
 * One texture array, one layer per zoom level, finest first. Each layer is a square of tile slots
 * that follows the camera like a window: tile x, y always lives in slot x mod size, y mod size, so
 * when the window moves only the slots it leaves behind are emptied and filled again. The shader
 * picks the level whose pixels best match the screen's, and where a slot is still empty the next
 * coarser level shows through.
 */
export const PHOTO_LEVELS = [18, 17, 16, 15] as const
const TILE = 256
const EARTH = 40_075_016.686
const DEGREE = Math.PI / 180

/** Photos asked for at once: Latvia's photo service speaks HTTP/1.1, and the map needs its six connections too. */
const IN_FLIGHT = 4
/** How long a photo that failed waits before it is asked for again. */
const RETRY_MS = 30_000

interface Slot {
  /** The tile the slot holds or is waiting for, as `z/x/y`, and its column and row. */
  tile: string | null
  x: number
  y: number
  state: 'empty' | 'loading' | 'ready'
  /** Not asked for again before this time, after a failure. */
  retryAt: number
}

function tileAt(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(lat * DEGREE) + 1 / Math.cos(lat * DEGREE)) / Math.PI) / 2) * n]
}

function tileCentre(z: number, x: number, y: number): LngLat {
  const n = 2 ** z
  return { lng: ((x + 0.5) / n) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / DEGREE }
}

export class PhotoCache {
  /** Slots along each side of a level's window. */
  readonly size: number
  texture: WebGLTexture | null = null
  /** Per level: the west and north tile of the window. */
  private windows: [number, number][] = PHOTO_LEVELS.map(() => [Number.NaN, Number.NaN])
  private slots: Slot[][]
  private uploads: { level: number; slot: number; picture: ImageBitmap | null }[] = []
  /** Per level: slots emptied by a move whose old photo is still in the texture. */
  private clearing: number[] = PHOTO_LEVELS.map(() => 0)
  private readonly zeros: Uint8Array

  constructor(coarse: boolean) {
    // 2048 px a side and four levels: 64 MiB on a desktop; a phone gets a quarter of that.
    this.size = coarse ? 4 : 8
    this.slots = PHOTO_LEVELS.map(() => Array.from({ length: this.size * this.size }, (): Slot => ({ tile: null, x: 0, y: 0, state: 'empty', retryAt: 0 })))
    this.zeros = new Uint8Array(TILE * TILE * 4)
  }

  /** Makes the texture. WebGL hands it over cleared, so every slot starts out transparent. */
  create(gl: WebGL2RenderingContext): void {
    const side = this.size * TILE
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, side, side, PHOTO_LEVELS.length)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // Repeating, so the window's slots run on seamlessly where it wraps round.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
  }

  /** Lets go of the texture and of every photo asked for or waiting; `cancel` calls off those still on their way. */
  dispose(gl: WebGL2RenderingContext, cancel: (id: string) => void): void {
    gl.deleteTexture(this.texture)
    this.texture = null
    for (const level of this.slots) {
      for (const slot of level) {
        if (slot.state === 'loading' && slot.tile) cancel(`p:${slot.tile}`)
        slot.tile = null
        slot.state = 'empty'
      }
    }
    for (const upload of this.uploads) upload.picture?.close()
    this.uploads = []
    this.clearing = PHOTO_LEVELS.map(() => 0)
    this.windows = PHOTO_LEVELS.map(() => [Number.NaN, Number.NaN])
  }

  /**
   * Moves each level's window with the camera, empties the slots it leaves, and asks for the photos
   * in front of the camera that are still missing, nearest first relative to each level's reach.
   */
  update(map: MapLibreMap, post: (job: CityJob) => void, cancel: (id: string) => void): void {
    const { at, forward } = cameraGround(map)
    const pitch = map.getPitch()
    const ahead = Math.hypot(...offsetMetres(at, map.getCenter()))
    // How high the camera is: from above, even the tile under it is that far away.
    const altitude = cameraDistanceMetres(map) * Math.cos(pitch * DEGREE)
    // A device pixel covers this many metres for each metre of distance. A level serves out to where
    // its own pixels are that large, which is where the shader stops choosing it; each coarser one
    // serves twice as far.
    const spread = (2 * Math.tan((map.getVerticalFieldOfView() * DEGREE) / 2)) / Math.max(1, map.getCanvas().clientHeight * window.devicePixelRatio)
    const now = Date.now()
    const want: { level: number; slot: Slot; priority: number }[] = []

    PHOTO_LEVELS.forEach((z, level) => {
      const tileMetres = (EARTH * Math.cos(at.lat * DEGREE)) / 2 ** z
      const half = (this.size / 2) * tileMetres
      // Looking along a street, most of what shows lies ahead; from above, around the centre.
      const shift = pitch > 60 ? 0.6 * half : Math.min(ahead, 0.6 * half)
      const middle = moveMetres(at, forward[0] * shift, forward[1] * shift)
      const [tx, ty] = tileAt(middle.lng, middle.lat, z)
      const x0 = Math.round(tx - this.size / 2)
      const y0 = Math.round(ty - this.size / 2)
      const window = this.windows[level]
      if (window[0] !== x0 || window[1] !== y0) {
        this.windows[level] = [x0, y0]
        // Each slot now belongs to the one tile of the window that falls on it.
        this.slots[level].forEach((slot, index) => {
          const sx = index % this.size
          const sy = Math.floor(index / this.size)
          const x = x0 + ((((sx - x0) % this.size) + this.size) % this.size)
          const y = y0 + ((((sy - y0) % this.size) + this.size) % this.size)
          const tile = `${z}/${x}/${y}`
          if (slot.tile === tile) return
          if (slot.state === 'loading' && slot.tile) cancel(`p:${slot.tile}`)
          if (slot.state === 'ready') {
            // The old place's photo stays in the texture until it is cleared: the level is not
            // shown meanwhile, or the new roofs would wear the old place's.
            this.uploads.push({ level, slot: index, picture: null })
            this.clearing[level]++
          }
          Object.assign(slot, { tile, x, y, state: 'empty', retryAt: 0 })
        })
      }

      const reach = tileMetres / (TILE * spread)
      for (const slot of this.slots[level]) {
        if (slot.state !== 'empty' || !slot.tile || slot.retryAt > now) continue
        const [east, north] = offsetMetres(at, tileCentre(z, slot.x, slot.y))
        // Behind the camera, and no nearer than a tile: never seen.
        if (pitch > 30 && east * forward[0] + north * forward[1] < -tileMetres) continue
        const distance = Math.hypot(Math.max(0, Math.hypot(east, north) - tileMetres * 0.71), altitude)
        // Past where this level's pixels shrink below the screen's: a coarser level serves there.
        if (level < PHOTO_LEVELS.length - 1 && distance > reach) continue
        want.push({ level, slot, priority: distance / reach })
      }
    })

    let free = IN_FLIGHT
    for (const level of this.slots) for (const slot of level) if (slot.state === 'loading') free--
    for (const { level, slot } of want.sort((a, b) => a.priority - b.priority)) {
      if (free <= 0) break
      slot.state = 'loading'
      post({ kind: 'photo', id: `p:${slot.tile}`, z: PHOTO_LEVELS[level], x: slot.x, y: slot.y })
      free--
    }
  }

  /** A photo has come back, or the news that there is none. Kept only if its slot still wants it. */
  receive(id: string, picture: ImageBitmap | null, failed: boolean): void {
    const tile = id.slice(2)
    const level = PHOTO_LEVELS.indexOf(Number(tile.split('/')[0]) as (typeof PHOTO_LEVELS)[number])
    const index = this.slots[level]?.findIndex((slot) => slot.tile === tile) ?? -1
    const slot = index >= 0 ? this.slots[level][index] : null
    if (!slot || slot.state !== 'loading') {
      picture?.close()
      return
    }
    // A failure is not kept: the slot is asked for again once a while has passed.
    if (failed) {
      slot.state = 'empty'
      slot.retryAt = Date.now() + RETRY_MS
      return
    }
    slot.state = 'ready'
    if (picture) this.uploads.push({ level, slot: index, picture })
  }

  /** Puts waiting photos into their slots, a few per frame so no frame stalls. Called while drawing. */
  upload(gl: WebGL2RenderingContext): boolean {
    if (!this.texture || !this.uploads.length) return false
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    // Clearing first: until a level's old photos are gone, the level is not shown at all.
    this.uploads.sort((a, b) => Number(!!a.picture) - Number(!!b.picture))
    for (const { level, slot, picture } of this.uploads.splice(0, 16)) {
      const x = (slot % this.size) * TILE
      const y = Math.floor(slot / this.size) * TILE
      if (picture) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, level, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, picture)
        picture.close()
      } else {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, level, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.zeros)
        this.clearing[level]--
      }
    }
    return this.uploads.length > 0
  }

  /**
   * Where a piece sits in each level's window, for the shader: per level, the texture coordinate of
   * the piece's origin, and the window's north-west corner in tiles from that origin. Worked out
   * here in doubles, since in the shader's floats a whole-world coordinate is only good to metres.
   */
  placement(origin: [number, number]): Float32Array {
    const out = new Float32Array(PHOTO_LEVELS.length * 4)
    PHOTO_LEVELS.forEach((z, level) => {
      const n = 2 ** z
      const ox = origin[0] * n
      const oy = origin[1] * n
      const [x0, y0] = this.windows[level]
      out[level * 4] = (((ox / this.size) % 1) + 1) % 1
      out[level * 4 + 1] = (((oy / this.size) % 1) + 1) % 1
      // No window yet, or one still holding another place's photos: out of reach, so nothing is sampled.
      const hidden = Number.isNaN(x0) || this.clearing[level] > 0
      out[level * 4 + 2] = hidden ? 1e9 : x0 - ox
      out[level * 4 + 3] = hidden ? 1e9 : y0 - oy
    })
    return out
  }
}

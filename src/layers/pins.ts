import type { Color } from '@deck.gl/core'
import { IconLayer } from '@deck.gl/layers'

/**
 * A pin over each vehicle that says what it is, as a city map's transport layer has: a disc in the
 * kind's colour with a white pictogram (bus, trolleybus, tram, minibus, train) and a point at the
 * vehicle. Upright to the camera, so it reads however the map is tilted; picked as its vehicle is.
 */
export type PinKind = 'bus' | 'trolleybus' | 'tram' | 'minibus' | 'train'

/** 24-unit pictograms, drawn white, their holes cut (even-odd). */
const GLYPH: Record<PinKind, string> = {
  bus: 'M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-1 1.7V20h-2.5v-2h-9v2H5v-2.3A2 2 0 0 1 4 16V5a2 2 0 0 1 2-2zm0 3v5h12V6zm1 8.2a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zm7.4 0a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0z',
  trolleybus:
    'M7.6 1.2l3.2 4.3H9.3L6.3 2zm4.6 0l3.2 4.3h-1.5L10.9 2zM6 6h12a2 2 0 0 1 2 2v9a2 2 0 0 1-1 1.7V21h-2.5v-2h-9v2H5v-2.3A2 2 0 0 1 4 17V8a2 2 0 0 1 2-2zm0 2.5v4h12v-4zm1 7a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0zm7.6 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z',
  tram: 'M9 1h6v1.5h-2.2L12 5h3.5A2.5 2.5 0 0 1 18 7.5V17a2.5 2.5 0 0 1-2 2.45L17.5 22H15l-1.2-2.5h-3.6L9 22H6.5L8 19.45A2.5 2.5 0 0 1 6 17V7.5A2.5 2.5 0 0 1 8.5 5H11l.8-2.5H9zM8 8v4.5h8V8zm.8 7.5a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0zm4 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z',
  minibus: 'M3.5 7a2 2 0 0 1 2-2H15l4.5 4.5V16a2 2 0 0 1-2 2h-.4a2.3 2.3 0 0 1-4.5 0H9.4a2.3 2.3 0 0 1-4.5 0h-.4a2 2 0 0 1-1-.3zm2 .2v3.6h4V7.2zm6 0v3.6h5.6l-3.4-3.6z',
  train:
    'M7.5 3h9A2.5 2.5 0 0 1 19 5.5V15a3 3 0 0 1-2.4 2.9l2 3.1h-2.4l-1.9-3h-4.6l-1.9 3H5.4l2-3.1A3 3 0 0 1 5 15V5.5A2.5 2.5 0 0 1 7.5 3zM7 6v5h10V6zm.6 8.6a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0zm6 0a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0z',
}

/** A pin in the atlas, CSS pixels: a disc this wide with its point below it. */
const W = 24
const H = 31
const RATIO = 2

/** Each kind's colour, as its vehicles are drawn (transit.ts, trains.ts). */
export const KIND_COLORS: Record<PinKind, Color> = {
  bus: [255, 196, 96],
  trolleybus: [126, 200, 255],
  tram: [255, 128, 170],
  minibus: [214, 214, 130],
  train: [124, 255, 178],
}

let atlas: { canvas: HTMLCanvasElement; mapping: Record<string, { x: number; y: number; width: number; height: number; anchorY: number; mask: false }> } | null = null
function drawAtlas(colors: Record<PinKind, Color>): NonNullable<typeof atlas> {
  const kinds = Object.keys(GLYPH) as PinKind[]
  const canvas = document.createElement('canvas')
  canvas.width = W * RATIO * kinds.length
  canvas.height = H * RATIO
  const ctx = canvas.getContext('2d')!
  const mapping: NonNullable<typeof atlas>['mapping'] = {}
  kinds.forEach((kind, i) => {
    ctx.save()
    ctx.translate(i * W * RATIO, 0)
    ctx.scale(RATIO, RATIO)
    const [r, g, b] = colors[kind]
    const c = W / 2
    const pin = new Path2D()
    // The disc and the point under it, one outline.
    pin.arc(c, c, c - 1.5, Math.PI * 0.72, Math.PI * 2.28)
    pin.lineTo(c, H - 1)
    pin.closePath()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 2
    ctx.shadowOffsetY = 0.8
    ctx.fillStyle = '#ffffff'
    ctx.fill(pin)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.beginPath()
    ctx.arc(c, c, c - 3.2, 0, Math.PI * 2)
    ctx.fill()
    const scale = (W * 0.56) / 24
    ctx.translate(c - 12 * scale, c - 12 * scale)
    ctx.scale(scale, scale)
    // Dark on the lighter kinds' colours, white on the darker: either reads on its disc.
    ctx.fillStyle = 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1b1f24' : '#ffffff'
    ctx.fill(new Path2D(GLYPH[kind]), 'evenodd')
    ctx.restore()
    mapping[kind] = { x: i * W * RATIO, y: 0, width: W * RATIO, height: H * RATIO, anchorY: H * RATIO, mask: false }
  })
  return { canvas, mapping }
}

/** The pins' atlas, drawn once. */
function pinAtlas(): NonNullable<typeof atlas> {
  atlas ??= drawAtlas(KIND_COLORS)
  return atlas
}

/**
 * Further out than this a vehicle is its pin; from here in, the vehicle itself (its icon, or in 3D),
 * never both: a pin says what it is while it is too small to see, the vehicle once it is not.
 */
export const PIN_ZOOM = 12

/** A pin's height in pixels: small with a country on screen, larger over one town. */
export const pinPx = (zoom: number): number => Math.round(Math.min(19, Math.max(13, 13 + (zoom - 9) * 2)))

/** Every vehicle's pin, standing on where it is drawn. */
export function pinLayer<T extends { id: string }>(
  id: string,
  data: readonly T[],
  zoom: number,
  now: number,
  kindOf: (item: T) => PinKind,
  positionOf: (item: T) => [number, number],
): IconLayer<T> {
  const { canvas, mapping } = pinAtlas()
  return new IconLayer<T>({
    id,
    data: zoom >= PIN_ZOOM ? [] : (data as T[]),
    iconAtlas: canvas as unknown as string,
    iconMapping: mapping,
    getIcon: kindOf,
    getPosition: positionOf,
    getSize: pinPx(zoom),
    sizeUnits: 'pixels',
    billboard: true,
    pickable: true,
    updateTriggers: { getPosition: now },
  })
}

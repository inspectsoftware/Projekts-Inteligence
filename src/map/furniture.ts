import { type CustomLayerInterface, type CustomRenderMethodInput, type GeoJSONFeature, type Map as MapLibreMap, MercatorCoordinate } from 'maplibre-gl'
import { OWN_SOURCE } from './ownStyle'
import type { MapTheme } from './style'

/**
 * Street furniture standing in 3D close in: OSM's traffic lights, each a pole at the kerb with its
 * red, amber and green lamps turned to the traffic it is for (a crossing's on both kerbs, turned
 * across), and its stops, each a shelter of glass with a roof and a bench, its back to the road,
 * and a pole with the stop's plate. Read from our own tiles (layers traffic_signal, stop and road,
 * scripts/tiles/baltic.yml), each set along the nearest street. Drawn by the map itself, in the same
 * depth as the city, so a house hides what stands behind it. At street level everything is its own
 * size; further out it is drawn larger, else it would be a speck. Zebras are painted by the streets
 * lane by lane (map/streets.ts), across the carriageway as it is built.
 *
 * The lamps are shown in their colours, all three: no traffic light's state is published.
 */
export const FURNITURE_LAYER = 'street-furniture'
const MIN_ZOOM = 16

/** How much larger than life: the lights more, being so slight. */
const growLights = (zoom: number) => 1.6 * Math.max(1, 2 ** ((18 - zoom) * 0.8))
const growStops = (zoom: number) => Math.max(1, 2 ** ((17 - zoom) * 0.8))

/** Kinds of part: shaded and grown as a light, shaded and grown as a stop, a lamp (lit, not shaded), flat on the road (never grown). */
const LIGHT = 0
const STOP = 1
const LAMP = 2
const FLAT = 3

type Rgba = readonly [number, number, number, number]
const hex = (h: string, a = 255): Rgba => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16), a]
const POLE = hex('#4a5058')
const HOUSING = hex('#262a30')
const RED = hex('#ff3b30')
const AMBER = hex('#ffc400')
const GREEN = hex('#2fd05a')
const FRAME = hex('#66707b')
const ROOF = hex('#55616d')
const GLASS = hex('#b4d4ea', 110)
const BENCH = hex('#9c7c5b')
const PLATE: Record<string, Rgba> = { bus: hex('#1a73d7'), tram: hex('#d6372b') }

/** A box in a part's own frame, metres: x along where it faces, y to its left, z up. */
type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Rgba, kind: number]

/** A road's traffic light facing +x: pole, housing, and its lamps on the front, red at the top. */
const ROAD_LIGHT: Box[] = [
  [-0.06, 0.06, -0.06, 0.06, 0, 3.3, POLE, LIGHT],
  [-0.12, 0.12, -0.17, 0.17, 2.3, 3.35, HOUSING, LIGHT],
  [0.12, 0.17, -0.11, 0.11, 3.05, 3.27, RED, LAMP],
  [0.12, 0.17, -0.11, 0.11, 2.72, 2.94, AMBER, LAMP],
  [0.12, 0.17, -0.11, 0.11, 2.39, 2.61, GREEN, LAMP],
]
/** A crossing's light facing +x: lower, two lamps. */
const CROSSING_LIGHT: Box[] = [
  [-0.05, 0.05, -0.05, 0.05, 0, 2.6, POLE, LIGHT],
  [-0.1, 0.1, -0.13, 0.13, 1.85, 2.55, HOUSING, LIGHT],
  [0.1, 0.15, -0.09, 0.09, 2.24, 2.46, RED, LAMP],
  [0.1, 0.15, -0.09, 0.09, 1.94, 2.16, GREEN, LAMP],
]
/** A shelter along x, its back at +y, away from the road. */
const SHELTER: Box[] = [
  [-2, -1.92, -0.72, -0.64, 0, 2.5, FRAME, STOP],
  [1.92, 2, -0.72, -0.64, 0, 2.5, FRAME, STOP],
  [-2, -1.92, 0.64, 0.72, 0, 2.5, FRAME, STOP],
  [1.92, 2, 0.64, 0.72, 0, 2.5, FRAME, STOP],
  [-2.1, 2.1, -0.85, 0.85, 2.48, 2.62, ROOF, STOP],
  [-1.2, 1.2, 0.3, 0.64, 0.42, 0.5, BENCH, STOP],
]
const SHELTER_GLASS: Box[] = [
  [-1.92, 1.92, 0.66, 0.7, 0.12, 2.46, GLASS, STOP],
  [-1.98, -1.94, -0.5, 0.66, 0.12, 2.46, GLASS, STOP],
  [1.94, 1.98, -0.5, 0.66, 0.12, 2.46, GLASS, STOP],
]
/** The stop's pole, beside the shelter on the road's side, its plate facing the road. */
const signPole = (mode: string): Box[] => [
  [2.5, 2.56, -0.83, -0.77, 0, 2.7, POLE, STOP],
  [2.33, 2.73, -0.9, -0.84, 2.15, 2.65, PLATE[mode] ?? PLATE.bus, STOP],
]

const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_grow;
in vec3 a_anchor;
in vec3 a_offset;
in vec4 a_color;
in float a_kind;
out vec3 v_pos;
out vec4 v_color;
out float v_lamp;

void main() {
  float grow = a_kind == ${STOP}.0 ? u_grow.y : a_kind == ${FLAT}.0 ? 1.0 : u_grow.x;
  v_pos = a_anchor + a_offset * grow;
  v_color = a_color;
  v_lamp = a_kind == ${LAMP}.0 ? 1.0 : 0.0;
  gl_Position = u_matrix * vec4(v_pos, 1.0);
}
`
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_sun;
uniform float u_ambient;
uniform float u_diffuse;
in vec3 v_pos;
in vec4 v_color;
in float v_lamp;
out vec4 fragColor;

void main() {
  // Lit flat, the face's normal from how the position changes across the screen (as the city is).
  vec3 n = normalize(cross(dFdx(v_pos), dFdy(v_pos)));
  float light = u_ambient * (0.8 + 0.2 * n.z) + u_diffuse * max(dot(n, u_sun), 0.0);
  vec3 color = v_lamp > 0.5 ? v_color.rgb : v_color.rgb * light;
  fragColor = vec4(color * v_color.a, v_color.a);
}
`

/** Towards the sun, as the city has it: from the south-south-west, 35° up. */
const SUN = (() => {
  const azimuth = 210 * (Math.PI / 180)
  const elevation = 35 * (Math.PI / 180)
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)]
})()
const LIGHTING: Record<MapTheme, [ambient: number, diffuse: number]> = { light: [0.95, 0.25], dark: [0.6, 0.3] }

const ROAD_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'busway', 'service'])

/** A street's piece near the furniture: its ends in metres east and north of the origin, and its half width. */
interface Segment {
  ax: number
  ay: number
  bx: number
  by: number
  half: number
  /** Driven only the way it is drawn, a to b. */
  oneway?: boolean
}

/** A street leaving a junction: which way (radians from east), half its width, and whether any traffic comes in along it. */
interface Arm {
  angle: number
  half: number
  incoming: boolean
}

/**
 * The streets meeting at (x, y): every segment with an end there, each way once (a street comes in
 * every tile it crosses). A point where fewer than three meet is no junction.
 */
export function armsAt(segments: readonly Segment[], x: number, y: number, within = 1.5): Arm[] {
  const arms: Arm[] = []
  for (const s of segments) {
    const atA = Math.hypot(s.ax - x, s.ay - y) < within
    const atB = Math.hypot(s.bx - x, s.by - y) < within
    if (atA === atB) continue
    const angle = atA ? Math.atan2(s.by - s.ay, s.bx - s.ax) : Math.atan2(s.ay - s.by, s.ax - s.bx)
    // A one-way street drawn away from the junction only leaves it.
    const incoming = !s.oneway || atB
    if (arms.some((arm) => Math.abs(Math.atan2(Math.sin(arm.angle - angle), Math.cos(arm.angle - angle))) < 0.17)) continue
    arms.push({ angle, half: s.half, incoming })
  }
  return arms
}

/** Half a road's width, metres: its lanes', else what a road of its kind usually has (as ownStyle.ts draws it). */
export function halfWidth(props: Record<string, unknown>): number {
  const cls = String(props.class ?? '')
  const oneWay = props.oneway === 'yes' || props.oneway === '1' || props.oneway === '-1' || cls.startsWith('motorway')
  const major = cls.startsWith('motorway') || cls.startsWith('trunk') || cls.startsWith('primary')
  const lanes = Number(props.lanes) || (oneWay ? (major ? 2 : 1) : major ? 4 : 2)
  return (lanes * 3.2 + 0.8) / 2
}

/** The nearest segment to (x, y): it, the point on it, and the distance. */
export function nearest(segments: readonly Segment[], x: number, y: number): { segment: Segment; px: number; py: number; distance: number } | null {
  let best: { segment: Segment; px: number; py: number; distance: number } | null = null
  for (const segment of segments) {
    const dx = segment.bx - segment.ax
    const dy = segment.by - segment.ay
    const length2 = dx * dx + dy * dy
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (y - segment.ay) * dy) / length2)) : 0
    const px = segment.ax + dx * t
    const py = segment.ay + dy * t
    const distance = Math.hypot(x - px, y - py)
    if (!best || distance < best.distance) best = { segment, px, py, distance }
  }
  return best
}

/** Where one part stands: its foot (metres from the origin, and the ground's height) and which way its +x faces, radians from east. */
interface Placement {
  x: number
  y: number
  z: number
  facing: number
  boxes: readonly Box[]
}

/**
 * Where the furniture stands, worked out from the tiles' points and the streets beside them; in
 * metres east and north of `toMetres`'s origin.
 */
export function placeFurniture(
  signals: readonly { x: number; y: number; kind: string; direction: string }[],
  stops: readonly { x: number; y: number; mode: string; shelter: string; name?: string }[],
  segments: readonly Segment[],
): Placement[] {
  const out: Placement[] = []
  for (const signal of signals) {
    const arms = signal.kind === 'crossing' ? [] : armsAt(segments, signal.x, signal.y)
    if (arms.length >= 3) {
      // Mapped on the junction itself: a light for each street that comes in, at the right-hand kerb
      // of its traffic, back from the corner as far as the widest street there is wide, facing the cars.
      const setback = Math.max(...arms.map((arm) => arm.half)) + 1
      for (const arm of arms) {
        if (!arm.incoming) continue
        const [c, sn] = [Math.cos(arm.angle), Math.sin(arm.angle)]
        // Coming in, the traffic heads the other way: its right is this arm's left.
        const kerb = arm.half + 0.7
        out.push({ x: signal.x + c * setback - sn * kerb, y: signal.y + sn * setback + c * kerb, z: 0, facing: arm.angle, boxes: ROAD_LIGHT })
      }
      continue
    }
    const near = nearest(segments, signal.x, signal.y)
    if (!near || near.distance > 25) continue
    const { segment } = near
    const along = Math.atan2(segment.by - segment.ay, segment.bx - segment.ax)
    // The kerbs either side of where the light is mapped, the road's middle.
    const kerb = segment.half + 0.7
    const side = (sign: number) => ({ x: near.px - Math.sin(along) * kerb * sign, y: near.py + Math.cos(along) * kerb * sign })
    if (signal.kind === 'crossing') {
      // Each kerb's light faces the other kerb, where those crossing towards it stand.
      for (const sign of [1, -1]) out.push({ ...side(sign), z: 0, facing: along - (sign * Math.PI) / 2, boxes: CROSSING_LIGHT })
      continue
    }
    // Traffic keeps right: going the way the street is drawn, its light stands on the right kerb,
    // facing back at it; the other way, the left kerb.
    // Unsaid (or both): each way the street is driven.
    const forward = signal.direction !== 'backward'
    const backward = signal.direction === 'backward' || (signal.direction !== 'forward' && !segment.oneway)
    if (forward) out.push({ ...side(-1), z: 0, facing: along + Math.PI, boxes: ROAD_LIGHT })
    if (backward) out.push({ ...side(1), z: 0, facing: along, boxes: ROAD_LIGHT })
  }
  // A pole is never on a road: one that lands on another street (a junction mapped as several
  // points, a street's lights set beside a crossing one) moves back towards the traffic it faces
  // until it is clear, or is left out. Two of the same within 3 m are one.
  const onRoad = (x: number, y: number) => segments.some((segment) => (nearest([segment], x, y)?.distance ?? Infinity) < segment.half + 0.3)
  const lights: Placement[] = []
  for (const light of out.splice(0)) {
    if (light.boxes === ROAD_LIGHT) {
      const [c, sn] = [Math.cos(light.facing), Math.sin(light.facing)]
      let step = 0
      while (step <= 20 && onRoad(light.x + c * step, light.y + sn * step)) step++
      if (step > 20) continue
      light.x += c * step
      light.y += sn * step
    }
    const twin = lights.some((other) => other.boxes === light.boxes && Math.hypot(other.x - light.x, other.y - light.y) < 3 && Math.cos(other.facing - light.facing) > 0.85)
    if (!twin) lights.push(light)
  }
  out.push(...lights)
  // A stop is often mapped twice, its pole and its platform: one shelter for the same name within 25 m.
  const kept: { x: number; y: number; name: string }[] = []
  for (const stop of stops) {
    const name = stop.name ?? ''
    if (kept.some((other) => Math.hypot(other.x - stop.x, other.y - stop.y) < (name && other.name === name ? 25 : 6))) continue
    kept.push({ x: stop.x, y: stop.y, name })
    const near = nearest(segments, stop.x, stop.y)
    if (!near || near.distance > 40) continue
    const { segment } = near
    const along = Math.atan2(segment.by - segment.ay, segment.bx - segment.ax)
    // Which side of the street the stop is on: +1 left of the way it is drawn, -1 right.
    const left = (segment.bx - segment.ax) * (stop.y - segment.ay) - (segment.by - segment.ay) * (stop.x - segment.ax) >= 0 ? 1 : -1
    // Mapped on the road itself: set on its right kerb. Else where it is, but never on the road.
    const away = near.distance < segment.half + 1 ? (near.distance < 0.5 ? -1 : left) : left
    const off = Math.max(near.distance, segment.half + 1.6)
    const x = near.px - Math.sin(along) * off * away
    const y = near.py + Math.cos(along) * off * away
    // Its +y, the shelter's back, away from the road: +x runs along the street so that left is away.
    const facing = away === 1 ? along : along + Math.PI
    const boxes = stop.shelter === 'no' ? signPole(stop.mode) : [...SHELTER, ...signPole(stop.mode), ...SHELTER_GLASS]
    out.push({ x, y, z: 0, facing, boxes })
  }
  return out
}

/** The triangles of the placed parts: anchor, offset (before growing), colour, kind; the see-through ones last. */
export function furnitureMesh(placements: readonly Placement[]): { anchors: Float32Array; offsets: Float32Array; colors: Uint8Array; kinds: Float32Array; opaque: number; count: number } {
  const solid: [Placement, Box][] = []
  const glass: [Placement, Box][] = []
  for (const placement of placements) for (const box of placement.boxes) (box[6][3] < 255 ? glass : solid).push([placement, box])
  const all = [...solid, ...glass]
  // A box without its bottom: five faces of two triangles.
  const count = all.length * 30
  const anchors = new Float32Array(count * 3)
  const offsets = new Float32Array(count * 3)
  const colors = new Uint8Array(count * 4)
  const kinds = new Float32Array(count)
  let v = 0
  for (const [{ x, y, z, facing }, [x0, x1, y0, y1, z0, z1, color, kind]] of all) {
    const cos = Math.cos(facing)
    const sin = Math.sin(facing)
    const corner = (cx: number, cy: number, cz: number) => {
      anchors.set([x, y, z], v * 3)
      offsets.set([cx * cos - cy * sin, cx * sin + cy * cos, cz], v * 3)
      colors.set(color, v * 4)
      kinds[v] = kind
      v++
    }
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      for (const p of [a, b, c, a, c, d]) corner(p[0], p[1], p[2])
    }
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
    quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1])
    quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1])
  }
  return { anchors, offsets, colors, kinds, opaque: solid.length * 30, count }
}

function lines(feature: GeoJSONFeature): number[][][] {
  const g = feature.geometry
  if (g.type === 'LineString') return [g.coordinates]
  if (g.type === 'MultiLineString') return g.coordinates
  return []
}

class FurnitureLayer implements CustomLayerInterface {
  readonly id = FURNITURE_LAYER
  readonly type = 'custom'
  readonly renderingMode = '3d'
  private map: MapLibreMap | null = null
  private program: WebGLProgram | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private buffers: WebGLBuffer[] = []
  private vao: WebGLVertexArrayObject | null = null
  private opaque = 0
  private count = 0
  private pending: ReturnType<typeof furnitureMesh> | null = null
  /** Mercator x, y of the metres' origin, and Mercator units to a metre there. */
  private origin: [number, number, number] = [0, 0, 1]
  private timer = 0
  private theme: MapTheme = 'light'
  private readonly refresh = () => {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.rebuild(), 250)
  }
  // A tile of ours has come in: placed again a moment after the last of a batch. (Not on 'idle':
  // with the traffic moving, the map is never idle.)
  private readonly onData = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId === OWN_SOURCE && e.tile) this.refresh()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    const program = gl.createProgram()!
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`[furniture] shader: ${gl.getShaderInfoLog(shader)}`)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    this.program = program
    for (const name of ['u_matrix', 'u_grow', 'u_sun', 'u_ambient', 'u_diffuse']) this.uniforms[name] = gl.getUniformLocation(program, name)
    this.buffers = [0, 1, 2, 3].map(() => gl.createBuffer()!)
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    const attribute = (name: string, buffer: WebGLBuffer, size: number, type: number, normalized: boolean) => {
      const at = gl.getAttribLocation(program, name)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(at)
      gl.vertexAttribPointer(at, size, type, normalized, 0, 0)
    }
    attribute('a_anchor', this.buffers[0], 3, gl.FLOAT, false)
    attribute('a_offset', this.buffers[1], 3, gl.FLOAT, false)
    attribute('a_color', this.buffers[2], 4, gl.UNSIGNED_BYTE, true)
    attribute('a_kind', this.buffers[3], 1, gl.FLOAT, false)
    gl.bindVertexArray(null)
    map.on('moveend', this.refresh)
    map.on('sourcedata', this.onData)
    this.refresh()
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    clearTimeout(this.timer)
    map.off('moveend', this.refresh)
    map.off('sourcedata', this.onData)
    for (const buffer of this.buffers) gl.deleteBuffer(buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    this.map = null
  }

  setTheme(theme: MapTheme): void {
    this.theme = theme
    this.map?.triggerRepaint()
  }

  /** What stands in view now, from the tiles the map has. */
  private rebuild(): void {
    const map = this.map
    if (!map) return
    if (map.getZoom() < MIN_ZOOM - 0.5 || !map.getSource(OWN_SOURCE)) {
      this.pending = furnitureMesh([])
      map.triggerRepaint()
      return
    }
    const centre = map.getCenter()
    const o = MercatorCoordinate.fromLngLat(centre, 0)
    const unit = o.meterInMercatorCoordinateUnits()
    this.origin = [o.x, o.y, unit]
    const toMetres = ([lon, lat]: number[]): [number, number] => {
      const m = MercatorCoordinate.fromLngLat({ lng: lon, lat }, 0)
      return [(m.x - o.x) / unit, (o.y - m.y) / unit]
    }
    const bounds = map.getBounds()
    const inView = ([lon, lat]: number[]) => lon >= bounds.getWest() - 0.002 && lon <= bounds.getEast() + 0.002 && lat >= bounds.getSouth() - 0.001 && lat <= bounds.getNorth() + 0.001
    const seen = new Set<string>()
    const points = (layer: string) =>
      map.querySourceFeatures(OWN_SOURCE, { sourceLayer: layer }).filter((f) => {
        if (f.geometry.type !== 'Point') return false
        const c = f.geometry.coordinates
        const key = `${layer}|${c[0].toFixed(6)}|${c[1].toFixed(6)}`
        if (!inView(c) || seen.has(key)) return false
        seen.add(key)
        return true
      })
    const segments: Segment[] = []
    for (const road of map.querySourceFeatures(OWN_SOURCE, { sourceLayer: 'road' })) {
      if (!ROAD_CLASSES.has(String(road.properties.class)) || road.properties.tunnel) continue
      const half = halfWidth(road.properties)
      for (const line of lines(road)) {
        if (!line.some(inView)) continue
        for (let i = 1; i < line.length; i++) {
          const [ax, ay] = toMetres(line[i - 1])
          const [bx, by] = toMetres(line[i])
          segments.push({ ax, ay, bx, by, half, oneway: road.properties.oneway === 'yes' || road.properties.oneway === '1' })
        }
      }
    }
    const signals = points('traffic_signal').map((f) => {
      const [x, y] = toMetres((f.geometry as GeoJSON.Point).coordinates)
      return { x, y, kind: String(f.properties.kind ?? 'road'), direction: String(f.properties.direction ?? '') }
    })
    const stops = points('stop').map((f) => {
      const [x, y] = toMetres((f.geometry as GeoJSON.Point).coordinates)
      return { x, y, mode: String(f.properties.mode ?? 'bus'), shelter: String(f.properties.shelter ?? ''), name: String(f.properties.name ?? '') }
    })
    const placements = placeFurniture(signals, stops, segments)
    // Stood on the ground the relief raises, where it is on.
    if (map.getTerrain()) {
      for (const p of placements) {
        const at = new MercatorCoordinate(o.x + p.x * unit, o.y - p.y * unit).toLngLat()
        p.z = map.queryTerrainElevation(at) ?? 0
      }
    }
    this.pending = furnitureMesh(placements)
    map.triggerRepaint()
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const map = this.map
    if (!map || !this.program) return
    if (this.pending) {
      const mesh = this.pending
      this.pending = null
      for (const [buffer, data] of [
        [this.buffers[0], mesh.anchors],
        [this.buffers[1], mesh.offsets],
        [this.buffers[2], mesh.colors],
        [this.buffers[3], mesh.kinds],
      ] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      }
      this.opaque = mesh.opaque
      this.count = mesh.count
    }
    const zoom = map.getZoom()
    if (!this.count || zoom < MIN_ZOOM - 0.5) return
    const [ox, oy, s] = this.origin
    const main = args.defaultProjectionData.mainMatrix
    // Metres east, north and up from the origin, into Mercator, then onto the screen.
    const local = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, ox, oy, 0, 1]
    const matrix = new Float32Array(16)
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += main[k * 4 + row] * local[column * 4 + k]
        matrix[column * 4 + row] = sum
      }
    }
    const u = this.uniforms
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(u.u_matrix, false, matrix)
    gl.uniform2f(u.u_grow, growLights(zoom), growStops(zoom))
    gl.uniform3fv(u.u_sun, SUN)
    const [ambient, diffuse] = LIGHTING[this.theme]
    gl.uniform1f(u.u_ambient, ambient)
    gl.uniform1f(u.u_diffuse, diffuse)
    gl.bindVertexArray(this.vao)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(true)
    gl.drawArrays(gl.TRIANGLES, 0, this.opaque)
    // The glass after, seen through, and hiding nothing behind it.
    gl.depthMask(false)
    gl.drawArrays(gl.TRIANGLES, this.opaque, this.count - this.opaque)
    gl.depthMask(true)
    gl.bindVertexArray(null)
  }
}

// The map holds this module's layer: swapped in place while developing, the module would lose hold
// of it (theme and opacity would no longer reach it), so a change reloads the page instead.
import.meta.hot?.accept(() => window.location.reload())

let layer: FurnitureLayer | null = null

export function addFurniture(map: MapLibreMap, before: string): void {
  if (map.getLayer(FURNITURE_LAYER)) return
  layer = new FurnitureLayer()
  map.addLayer(layer, map.getLayer(before) ? before : undefined)
}

export function setFurnitureTheme(theme: MapTheme): void {
  layer?.setTheme(theme)
}

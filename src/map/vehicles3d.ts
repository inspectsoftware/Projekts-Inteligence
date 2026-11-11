import type { Color } from '@deck.gl/core'
import { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap, MercatorCoordinate } from 'maplibre-gl'
import type { TransitVehicle } from '../../shared/adapters/transit'
import { KIND_COLORS, type PinKind } from '../layers/pins'
import { onLane } from '../layers/transit'
import { serverNow } from '../runtime/clock'
import { getEntities } from '../runtime/entityStore'
import { isLayerOn, useLayers } from '../state/layers'
import { headingAt, positionAt } from './motion'
import type { MapTheme } from './style'
import { vehiclesIn3d } from './threeD'

/**
 * Buses, trolleybuses, trams, minibuses and trains standing on the streets in 3D, close in with the
 * map tilted: each kind its own model in its own colour, at its real size, where its icon would be
 * (in its lane, gliding between its fixes) and turned the way it goes. Drawn by the map itself, in
 * the same depth as the city, so a house hides the bus behind it. One model a kind, drawn for every
 * vehicle of the kind at once.
 */
export const VEHICLES_3D_LAYER = 'vehicles-3d'

type Rgba = readonly [number, number, number, number]
const shade = ([r, g, b]: Color, k: number, a = 255): Rgba => [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k), a]
const GLASS: Rgba = [38, 50, 62, 255]
const TYRE: Rgba = [28, 30, 33, 255]
const DARK: Rgba = [58, 62, 68, 255]

/** A box, metres: x along the vehicle (front +), y to its left, z up. */
type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Rgba]

/** A rigid body this long and wide: its shell, a band of windows round it, windscreens, roof and wheels. */
function body(x0: number, x1: number, width: number, height: number, color: Color, wheelsAt: number[], front = true, back = true): Box[] {
  const w = width / 2
  const out: Box[] = [
    [x0, x1, -w, w, 0.32, height, shade(color, 1)],
    // The windows a hair proud of the shell, so they show on its sides.
    [x0 + 0.5, x1 - 0.5, -w - 0.02, w + 0.02, height * 0.43, height * 0.8, GLASS],
    [x0 + 0.3, x1 - 0.3, -w + 0.15, w - 0.15, height, height + 0.12, shade(color, 1.12)],
  ]
  if (front) out.push([x1 - 0.02, x1 + 0.03, -w + 0.12, w - 0.12, height * 0.3, height * 0.85, GLASS])
  if (back) out.push([x0 - 0.03, x0 + 0.02, -w + 0.3, w - 0.3, height * 0.5, height * 0.8, GLASS])
  for (const x of wheelsAt) {
    out.push([x - 0.5, x + 0.5, -w - 0.03, -w + 0.3, 0, 0.95, TYRE])
    out.push([x - 0.5, x + 0.5, w - 0.3, w + 0.03, 0, 0.95, TYRE])
  }
  return out
}

/** What is drawn: a rigid vehicle whole, an articulated one section by section. */
type Model = 'bus' | 'trolleybus' | 'minibus' | 'tram-end' | 'tram-mid' | 'train-car'
const MODELS: Model[] = ['bus', 'trolleybus', 'minibus', 'tram-end', 'tram-mid', 'train-car']

/**
 * Each kind's parts and where along the vehicle each one's middle is, metres ahead of its own
 * middle: a tram's three sections and a train's three cars follow the line round a bend each on its
 * own, rather than cutting across the pavement as one rigid box would.
 */
export const PARTS: Record<PinKind, { model: Model; at: number }[]> = {
  bus: [{ model: 'bus', at: 0 }],
  trolleybus: [{ model: 'trolleybus', at: 0 }],
  minibus: [{ model: 'minibus', at: 0 }],
  tram: [
    { model: 'tram-end', at: 10.1 },
    { model: 'tram-mid', at: 0 },
    { model: 'tram-end', at: -10.1 },
  ],
  train: [
    { model: 'train-car', at: 25.3 },
    { model: 'train-car', at: 0 },
    { model: 'train-car', at: -25.3 },
  ],
}

/** Each model, centred on its own middle. */
function model(kind: Model): Box[] {
  switch (kind) {
    case 'tram-end':
      return body(-4.8, 4.8, 2.5, 3.35, KIND_COLORS.tram, [-3, 3])
    case 'tram-mid':
      return [
        ...body(-4.8, 4.8, 2.5, 3.35, KIND_COLORS.tram, [-3, 3], false, false),
        // The joints to the sections either side, and the pantograph.
        [4.8, 5.1, -1.05, 1.05, 0.6, 3.0, DARK],
        [-5.1, -4.8, -1.05, 1.05, 0.6, 3.0, DARK],
        [-1, 1, -0.7, 0.7, 3.47, 3.6, DARK],
        [-0.15, 0.15, -0.6, 0.6, 3.6, 4.2, DARK],
        [-0.8, 0.8, -0.65, 0.65, 4.2, 4.28, DARK],
      ]
    case 'train-car':
      return [...body(-12.3, 12.3, 3.0, 4.1, KIND_COLORS.train, [-9.8, -7.8, 7.8, 9.8]), [12.3, 12.65, -1.2, 1.2, 0.8, 3.6, DARK], [-12.65, -12.3, -1.2, 1.2, 0.8, 3.6, DARK]]
    default:
      return rigid(kind)
  }
}

function rigid(kind: 'bus' | 'trolleybus' | 'minibus'): Box[] {
  const c = KIND_COLORS[kind]
  switch (kind) {
    case 'bus':
      return body(-6, 6, 2.55, 3.0, c, [-3.9, 3.9])
    case 'minibus':
      return body(-3.5, 3.5, 2.05, 2.55, c, [-2.4, 2.4])
    case 'trolleybus':
      return [
        ...body(-6, 6, 2.55, 3.0, c, [-3.9, 3.9]),
        // Its two poles up to the wires, from a frame at the back of the roof.
        [-4.8, -4.2, -0.5, 0.5, 3.12, 3.45, DARK],
        [-4.6, 3.2, -0.42, -0.34, 3.85, 3.95, DARK],
        [-4.6, 3.2, 0.34, 0.42, 3.85, 3.95, DARK],
        [-4.6, -4.4, -0.42, 0.42, 3.45, 3.95, DARK],
      ]
  }
}

/** A model's triangles: positions and colours, each box without its bottom. */
export function modelMesh(boxes: readonly Box[]): { positions: Float32Array; colors: Uint8Array; count: number } {
  const count = boxes.length * 30
  const positions = new Float32Array(count * 3)
  const colors = new Uint8Array(count * 4)
  let v = 0
  for (const [x0, x1, y0, y1, z0, z1, color] of boxes) {
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      for (const p of [a, b, c, a, c, d]) {
        positions.set(p, v * 3)
        colors.set(color, v * 4)
        v++
      }
    }
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
    quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1])
    quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1])
  }
  return { positions, colors, count }
}


const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec3 a_pos;
in vec4 a_color;
// Where the vehicle is, metres east, north and up of the origin, and which way it faces (radians from east).
in vec4 a_place;
out vec3 v_pos;
out vec4 v_color;

void main() {
  float c = cos(a_place.w);
  float s = sin(a_place.w);
  v_pos = vec3(a_place.x + a_pos.x * c - a_pos.y * s, a_place.y + a_pos.x * s + a_pos.y * c, a_place.z + a_pos.z);
  v_color = a_color;
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
out vec4 fragColor;

void main() {
  // Lit flat, as the city and the street furniture are.
  vec3 n = normalize(cross(dFdx(v_pos), dFdy(v_pos)));
  float light = u_ambient * (0.8 + 0.2 * n.z) + u_diffuse * max(dot(n, u_sun), 0.0);
  fragColor = vec4(v_color.rgb * light, 1.0);
}
`

const SUN = (() => {
  const azimuth = 210 * (Math.PI / 180)
  const elevation = 35 * (Math.PI / 180)
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)]
})()
const LIGHTING: Record<MapTheme, [ambient: number, diffuse: number]> = { light: [0.88, 0.28], dark: [0.62, 0.32] }

/** A vehicle to draw: its kind, where it is, which way it is heading (degrees from north, clockwise) and the route ahead of it. */
interface Pose {
  id: string
  kind: PinKind
  lon: number
  lat: number
  trk: number
  ahead?: [number, number][]
}

/**
 * Where a part `at` metres ahead of a vehicle's middle stands and which way it faces, along the
 * line through where it has been (`behind`, oldest first, ending where it is now) and where it is
 * going (`ahead`, from where it is now): x, y and the angle from east. Off either end, straight on
 * from the last stretch. Exported for tests.
 */
export function alongPath(behind: readonly [number, number][], ahead: readonly [number, number][], at: number): [number, number, number] {
  const line = [...behind, ...ahead.slice(1)]
  const step = at >= 0 ? 1 : -1
  let i = behind.length - 1
  let [x, y] = line[i]
  let left = Math.abs(at)
  // The stretch it ends on, as the two points either end in the way of travel.
  let from = line[Math.max(0, i - 1)]
  let to = line[Math.min(line.length - 1, i + 1)]
  while (left > 0) {
    const j = i + step
    if (j < 0 || j >= line.length) break
    const d = Math.hypot(line[j][0] - x, line[j][1] - y)
    from = step > 0 ? line[i] : line[j]
    to = step > 0 ? line[j] : line[i]
    if (d >= left) {
      const t = left / d
      x += (line[j][0] - x) * t
      y += (line[j][1] - y) * t
      left = 0
      break
    }
    left -= d
    ;[x, y] = line[j]
    i = j
  }
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  // Run out of line: on, straight, by what is left.
  return [x + Math.cos(angle) * left * step, y + Math.sin(angle) * left * step, angle]
}

/** The vehicles of the layers that are on, where each is now. */
function poses(now: number): Pose[] {
  const { visible, hiddenModes } = useLayers.getState()
  const out: Pose[] = []
  if (isLayerOn(visible, 'transit', true)) {
    for (const vehicle of getEntities('transit') as TransitVehicle[]) {
      if (hiddenModes[vehicle.props.mode]) continue
      const [lon, lat] = onLane(vehicle, now)
      out.push({ id: vehicle.id, kind: vehicle.props.mode, lon, lat, trk: headingAt(vehicle, now) ?? 0, ahead: vehicle.props.ahead })
    }
  }
  if (isLayerOn(visible, 'trains', true)) {
    for (const train of getEntities('trains')) {
      const [lon, lat] = positionAt(train, now)
      out.push({ id: train.id, kind: 'train', lon, lat, trk: headingAt(train, now) ?? train.trk ?? 0 })
    }
  }
  return out
}

interface KindMesh {
  vao: WebGLVertexArrayObject
  places: WebGLBuffer
  count: number
}

class VehiclesLayer implements CustomLayerInterface {
  readonly id = VEHICLES_3D_LAYER
  readonly type = 'custom'
  readonly renderingMode = '3d'
  private map: MapLibreMap | null = null
  private program: WebGLProgram | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private meshes = new Map<Model, KindMesh>()
  /** Where each articulated vehicle has been lately, lon, lat, oldest first: its sections follow it. */
  private trails = new Map<string, { points: [number, number][]; seen: number }>()
  private buffers: WebGLBuffer[] = []
  theme: MapTheme = 'light'

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
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`[vehicles3d] shader: ${gl.getShaderInfoLog(shader)}`)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    this.program = program
    for (const name of ['u_matrix', 'u_sun', 'u_ambient', 'u_diffuse']) this.uniforms[name] = gl.getUniformLocation(program, name)
    const at = (name: string) => gl.getAttribLocation(program, name)
    for (const kind of MODELS) {
      const mesh = modelMesh(model(kind))
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      const buffer = (data: ArrayBufferView | null, location: number, size: number, type: number, normalized: boolean, divisor: number) => {
        const b = gl.createBuffer()!
        this.buffers.push(b)
        gl.bindBuffer(gl.ARRAY_BUFFER, b)
        if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, size, type, normalized, 0, 0)
        gl.vertexAttribDivisor(location, divisor)
        return b
      }
      buffer(mesh.positions, at('a_pos'), 3, gl.FLOAT, false, 0)
      buffer(mesh.colors, at('a_color'), 4, gl.UNSIGNED_BYTE, true, 0)
      const places = buffer(null, at('a_place'), 4, gl.FLOAT, false, 1)
      this.meshes.set(kind, { vao, places, count: mesh.count })
    }
    gl.bindVertexArray(null)
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    for (const mesh of this.meshes.values()) gl.deleteVertexArray(mesh.vao)
    for (const b of this.buffers) gl.deleteBuffer(b)
    gl.deleteProgram(this.program)
    this.map = null
  }

  /** Keeps where an articulated vehicle has been, its last 80 m, for its sections to follow. */
  private remember(pose: Pose, now: number): void {
    let trail = this.trails.get(pose.id)
    if (!trail) {
      trail = { points: [], seen: now }
      this.trails.set(pose.id, trail)
    }
    trail.seen = now
    const last = trail.points.at(-1)
    const k = Math.cos((pose.lat * Math.PI) / 180)
    const metres = last ? Math.hypot((pose.lon - last[0]) * 111_320 * k, (pose.lat - last[1]) * 110_540) : Infinity
    if (metres < 1) return
    // A jump (a fix far off, a trip begun anew) is no path to follow: it starts again from here.
    if (metres > 60) trail.points = []
    trail.points.push([pose.lon, pose.lat])
    let length = 0
    for (let i = trail.points.length - 1; i > 0; i--) {
      const [a, b] = [trail.points[i], trail.points[i - 1]]
      length += Math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_540)
      if (length > 80) {
        trail.points = trail.points.slice(i - 1)
        break
      }
    }
  }

  /** The route ahead from where the vehicle is now: its points beyond the stretch it is on. */
  private aheadOf(route: [number, number][], here: [number, number]): [number, number][] {
    let best = 1
    let bestD = Infinity
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1]
      const [bx, by] = route[i]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((here[0] - ax) * dx + (here[1] - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(here[0] - (ax + dx * t), here[1] - (ay + dy * t))
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return route.slice(best)
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const map = this.map
    if (!map || !this.program || !vehiclesIn3d(map.getZoom(), map.getPitch())) return
    const now = serverNow()
    const centre = map.getCenter()
    const o = MercatorCoordinate.fromLngLat(centre, 0)
    const unit = o.meterInMercatorCoordinateUnits()
    const bounds = map.getBounds()
    const [w, e, s, n] = [bounds.getWest() - 0.003, bounds.getEast() + 0.003, bounds.getSouth() - 0.002, bounds.getNorth() + 0.002]
    const terrain = !!map.getTerrain()
    const toMetres = ([lon, lat]: [number, number]): [number, number] => {
      const m = MercatorCoordinate.fromLngLat({ lng: lon, lat }, 0)
      return [(m.x - o.x) / unit, (o.y - m.y) / unit]
    }
    // Each model's parts in view: x, y, z and the way each faces.
    const places = new Map<Model, number[]>(MODELS.map((kind) => [kind, []]))
    for (const pose of poses(now)) {
      const parts = PARTS[pose.kind]
      const articulated = parts.length > 1
      if (articulated) this.remember(pose, now)
      if (pose.lon < w || pose.lon > e || pose.lat < s || pose.lat > n) continue
      const z = terrain ? (map.queryTerrainElevation({ lng: pose.lon, lat: pose.lat }) ?? 0) : 0
      const here = toMetres([pose.lon, pose.lat])
      const facing = ((90 - pose.trk) * Math.PI) / 180
      if (!articulated) {
        places.get(parts[0].model)!.push(here[0], here[1], z, facing)
        continue
      }
      // Its sections along where it has been and where it is going; straight on where neither is known.
      const behind = (this.trails.get(pose.id)?.points ?? []).map(toMetres)
      const last = behind.at(-1)
      if (!last || Math.hypot(last[0] - here[0], last[1] - here[1]) > 0.5) behind.push(here)
      if (behind.length < 2) behind.unshift([here[0] - Math.cos(facing), here[1] - Math.sin(facing)])
      const route = pose.ahead && pose.ahead.length >= 2 ? this.aheadOf(pose.ahead.map(toMetres), here) : []
      const ahead: [number, number][] = route.length ? [here, ...route] : [here, [here[0] + Math.cos(facing), here[1] + Math.sin(facing)]]
      for (const part of parts) {
        const [x, y, angle] = alongPath(behind, ahead, part.at)
        places.get(part.model)!.push(x, y, z, angle)
      }
    }
    for (const [id, trail] of this.trails) if (now - trail.seen > 120_000) this.trails.delete(id)
    const local = [unit, 0, 0, 0, 0, -unit, 0, 0, 0, 0, unit, 0, o.x, o.y, 0, 1]
    const main = args.defaultProjectionData.mainMatrix
    const matrix = new Float32Array(16)
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += main[k * 4 + row] * local[column * 4 + k]
        matrix[column * 4 + row] = sum
      }
    }
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uniforms.u_matrix, false, matrix)
    gl.uniform3fv(this.uniforms.u_sun, SUN)
    const [ambient, diffuse] = LIGHTING[this.theme]
    gl.uniform1f(this.uniforms.u_ambient, ambient)
    gl.uniform1f(this.uniforms.u_diffuse, diffuse)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    for (const kind of MODELS) {
      const list = places.get(kind)!
      if (!list.length) continue
      const mesh = this.meshes.get(kind)!
      gl.bindVertexArray(mesh.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.places)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, list.length / 4)
    }
    gl.bindVertexArray(null)
    gl.enable(gl.BLEND)
  }
}

let layer: VehiclesLayer | null = null

export function addVehicles3d(map: MapLibreMap, before: string): void {
  if (map.getLayer(VEHICLES_3D_LAYER)) return
  layer = new VehiclesLayer()
  map.addLayer(layer, map.getLayer(before) ? before : undefined)
}

export function setVehicles3dTheme(theme: MapTheme): void {
  if (layer) layer.theme = theme
}

// The map holds this module's layer: swapped in place while developing, the module would lose hold
// of it, so a change reloads the page instead.
import.meta.hot?.accept(() => window.location.reload())

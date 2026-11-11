import { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap, MercatorCoordinate } from 'maplibre-gl'
import { TREE_INDICES, TREE_STRIDE, UNIT_TREE, treeLook } from './city/layer'
import { TREE_FRAGMENT, TREE_VERTEX } from './city/shaders'
import { OWN_SOURCE } from './ownStyle'
import type { MapTheme } from './style'

/**
 * Trees from OpenStreetMap, in 3D like the city's own (city/layer.ts, with its model and shading),
 * where the city's tree survey does not reach: Rīga's covers its outer districts, not its centre,
 * and other towns have none. Each tree as tall as mapped, else 8 to 14 m, its crown shaped by
 * where it stands.
 */
export const OSM_TREES_LAYER = 'osm-trees'
const MIN_ZOOM = 15.5

/** Where the city's own trees are (public/data/city-3d.json): no OSM tree is drawn there as well. */
let surveyed: [number, number, number, number][] = []
void fetch('/data/city-3d.json')
  .then((res) => res.json())
  .then((catalogue: { trees?: { bbox: [number, number, number, number] }[] }) => {
    surveyed = (catalogue.trees ?? []).map((t) => t.bbox)
  })
  .catch(() => undefined)

/** A tree's height, metres: as mapped, else one of its own between 8 and 14 m by where it stands. Exported for tests. */
export function treeHeight(tagged: unknown, lon: number, lat: number): number {
  const mapped = Number.parseFloat(String(tagged ?? ''))
  if (Number.isFinite(mapped) && mapped > 2 && mapped < 45) return mapped
  const seed = Math.abs(Math.sin(lon * 12_345.678 + lat * 98_765.432)) % 1
  return 8 + 6 * seed
}

const SUN = (() => {
  const azimuth = 210 * (Math.PI / 180)
  const elevation = 35 * (Math.PI / 180)
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)]
})()
const rgb = (hex: string) => [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255]

class OsmTreesLayer implements CustomLayerInterface {
  readonly id = OSM_TREES_LAYER
  readonly type = 'custom'
  readonly renderingMode = '3d'
  private map: MapLibreMap | null = null
  private program: WebGLProgram | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private vao: WebGLVertexArrayObject | null = null
  private buffers: WebGLBuffer[] = []
  private trees: WebGLBuffer | null = null
  private count = 0
  private pending: Float32Array | null = null
  private origin: [number, number, number] = [0, 0, 1]
  private timer = 0
  theme: MapTheme = 'light'
  private readonly refresh = () => {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.rebuild(), 300)
  }
  private readonly onData = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId === OWN_SOURCE && e.tile) this.refresh()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    const program = gl.createProgram()!
    for (const [type, source] of [
      [gl.VERTEX_SHADER, TREE_VERTEX],
      [gl.FRAGMENT_SHADER, TREE_FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`[osm trees] shader: ${gl.getShaderInfoLog(shader)}`)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    this.program = program
    for (const name of ['u_matrix', 'u_sun', 'u_fogColor', 'u_fog', 'u_opacity', 'u_ambient', 'u_diffuse', 'u_shade', 'u_leaf', 'u_bark']) this.uniforms[name] = gl.getUniformLocation(program, name)
    const at = (name: string) => gl.getAttribLocation(program, name)
    // Out of whatever vertex array the map may have bound, before an index buffer is bound.
    gl.bindVertexArray(null)
    const unit = gl.createBuffer()!
    const index = gl.createBuffer()!
    this.trees = gl.createBuffer()!
    this.buffers = [unit, index, this.trees]
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, TREE_INDICES, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, unit)
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_TREE, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(at('a_shape'))
    gl.vertexAttribPointer(at('a_shape'), 4, gl.FLOAT, false, TREE_STRIDE * 4, 0)
    gl.enableVertexAttribArray(at('a_normal'))
    gl.vertexAttribPointer(at('a_normal'), 3, gl.FLOAT, false, TREE_STRIDE * 4, 16)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trees)
    gl.enableVertexAttribArray(at('a_tree'))
    gl.vertexAttribPointer(at('a_tree'), 3, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(at('a_tree'), 1)
    gl.bindVertexArray(null)
    map.on('moveend', this.refresh)
    map.on('sourcedata', this.onData)
    this.refresh()
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    clearTimeout(this.timer)
    map.off('moveend', this.refresh)
    map.off('sourcedata', this.onData)
    for (const b of this.buffers) gl.deleteBuffer(b)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    this.map = null
  }

  private rebuild(): void {
    const map = this.map
    if (!map) return
    if (map.getZoom() < MIN_ZOOM - 0.5 || !map.getSource(OWN_SOURCE)) {
      this.pending = new Float32Array(0)
      return
    }
    const o = MercatorCoordinate.fromLngLat(map.getCenter(), 0)
    const unit = o.meterInMercatorCoordinateUnits()
    this.origin = [o.x, o.y, unit]
    const bounds = map.getBounds()
    const [w, e, s, n] = [bounds.getWest() - 0.002, bounds.getEast() + 0.002, bounds.getSouth() - 0.001, bounds.getNorth() + 0.001]
    const out: number[] = []
    const seen = new Set<string>()
    for (const f of map.querySourceFeatures(OWN_SOURCE, { sourceLayer: 'tree' })) {
      if (f.geometry.type !== 'Point') continue
      const [lon, lat] = f.geometry.coordinates
      if (lon < w || lon > e || lat < s || lat > n) continue
      if (surveyed.some(([a, b, c, d]) => lon >= a && lon <= c && lat >= b && lat <= d)) continue
      const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
      if (seen.has(key)) continue
      seen.add(key)
      const m = MercatorCoordinate.fromLngLat({ lng: lon, lat }, 0)
      out.push((m.x - o.x) / unit, (o.y - m.y) / unit, treeHeight(f.properties.height, lon, lat))
    }
    this.pending = Float32Array.from(out)
    map.triggerRepaint()
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const map = this.map
    if (!map || !this.program) return
    if (this.pending) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trees)
      gl.bufferData(gl.ARRAY_BUFFER, this.pending, gl.STATIC_DRAW)
      this.count = this.pending.length / 3
      this.pending = null
    }
    if (!this.count || map.getZoom() < MIN_ZOOM - 0.5) return
    const [ox, oy, s] = this.origin
    const local = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, ox, oy, 0, 1]
    const main = args.defaultProjectionData.mainMatrix
    const matrix = new Float32Array(16)
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += main[k * 4 + row] * local[column * 4 + k]
        matrix[column * 4 + row] = sum
      }
    }
    const look = treeLook(this.theme)
    const u = this.uniforms
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(u.u_matrix, false, matrix)
    gl.uniform3fv(u.u_sun, SUN)
    gl.uniform3fv(u.u_fogColor, [1, 1, 1])
    // No haze: these are near the camera only.
    gl.uniform2f(u.u_fog, 1e9, 2e9)
    gl.uniform1f(u.u_opacity, 1)
    gl.uniform1f(u.u_ambient, look.ambient)
    gl.uniform1f(u.u_diffuse, look.diffuse)
    gl.uniform1f(u.u_shade, look.shade)
    gl.uniform3fv(u.u_leaf, rgb(look.leaf))
    gl.uniform3fv(u.u_bark, rgb(look.bark))
    gl.bindVertexArray(this.vao)
    gl.vertexAttrib1f(gl.getAttribLocation(this.program, 'a_ground'), 0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.drawElementsInstanced(gl.TRIANGLES, TREE_INDICES.length, gl.UNSIGNED_SHORT, 0, this.count)
    gl.bindVertexArray(null)
  }
}

let layer: OsmTreesLayer | null = null

export function addOsmTrees(map: MapLibreMap, before: string): void {
  if (map.getLayer(OSM_TREES_LAYER)) return
  layer = new OsmTreesLayer()
  map.addLayer(layer, map.getLayer(before) ? before : undefined)
}

export function setOsmTreesTheme(theme: MapTheme): void {
  if (layer) {
    layer.theme = theme
  }
}

// The map holds this module's layer: a change reloads the page rather than losing hold of it.
import.meta.hot?.accept(() => window.location.reload())

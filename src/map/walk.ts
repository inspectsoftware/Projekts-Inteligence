import type { Map, MapMovementEvent } from 'maplibre-gl'
import { create } from 'zustand'
import { advance } from '../../shared/geo/sphere'
import { useSelection } from '../state/selection'
import { useUi } from '../state/ui'
import { zoomCeiling } from './basemaps'
import { applyZoomCeiling } from './baseMode'
import { prefersReducedMotion } from './camera'
import { getMap } from './instance'

const RAD = Math.PI / 180
/** The Earth's circumference as MapLibre measures it, from its own mean radius. */
const CIRCUMFERENCE = 2 * Math.PI * 6_371_008.8

/** How high the eye starts above the ground, and the lowest it goes: a standing adult's. */
export const EYE_HEIGHT = 1.7
const TOP_HEIGHT = 400
/** As deep as MapLibre zooms at all. Each level halves the distance from the eye to the point it looks at. */
const WALK_ZOOM = 24
/**
 * As far up as the walker may look. From 89.25° on MapLibre gives up on the point the camera looks
 * at and puts it 10 km off: the zoom falls to that of a whole city and the buildings disappear.
 */
const TOP_PITCH = 88
const START_PITCH = 84
/** Metres a second on foot and up or down, and how much faster with Shift held. */
const WALK_SPEED = 6
const CLIMB_SPEED = 3
const FAST = 4
/** Degrees a second. */
const TURN_SPEED = 90

/** Something the walker can hold down, from the keyboard or a button on the panel. */
export type Control = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight' | 'up' | 'down' | 'fast'

// By physical key, so WASD stays where it is on a Latvian, Lithuanian, Estonian or Russian layout.
const KEYS: Record<string, Control> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyQ: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyE: 'turnRight',
  ArrowRight: 'turnRight',
  KeyR: 'up',
  PageUp: 'up',
  KeyF: 'down',
  PageDown: 'down',
  ShiftLeft: 'fast',
  ShiftRight: 'fast',
}

/** Where the eye ends up after `forward` metres along `bearing` and `right` metres to its right. */
export function stepEye(lon: number, lat: number, bearing: number, forward: number, right: number): [number, number] {
  return advance(lon, lat, bearing + Math.atan2(right, forward) / RAD, Math.hypot(forward, right))
}

/**
 * The lowest the walker may look, as a pitch in degrees, with the eye `height` metres above the
 * point the camera looks at. MapLibre places its camera by that point, height / cos(pitch) metres
 * ahead, and a zoom at which that distance is 1.5 canvas heights (its field of view). Looking
 * further down brings the point closer and the zoom deeper than MapLibre goes, and it would then
 * lift the eye instead.
 */
export function minWalkPitch(height: number, lat: number, canvasHeight: number, maxZoom = WALK_ZOOM): number {
  // At zoom z one metre is 512 * 2^z / (circumference * cos(lat)) pixels.
  const nearest = (1.5 * canvasHeight * CIRCUMFERENCE * Math.cos(lat * RAD)) / (512 * 2 ** maxZoom)
  return Math.min(TOP_PITCH, Math.acos(Math.min(1, height / nearest)) / RAD)
}

interface Eye {
  lon: number
  lat: number
  /** Metres above the ground under it. */
  height: number
  bearing: number
  pitch: number
}

// Marks the camera moves made here, so any other one can be told apart and end the walk.
const WALKING = { walk: true }

const held = new Set<Control>()
let frame = 0
let lastFrame = 0
let walk: { map: Map; eye: Eye; end(overview: boolean): void } | null = null

/** The camera for an eye, standing on the ground under it when the relief is on. */
function cameraFor(map: Map, eye: Eye) {
  const ground = map.queryTerrainElevation([eye.lon, eye.lat]) ?? 0
  // MapLibre measures the eye from the level of the point it looks at, and gives up on an eye at or
  // under it. Walking up a steep street gets there, so the eye is kept just above that level.
  const level = map.getCenterElevation()
  const altitude = Math.max(ground + eye.height, level + 0.5)
  eye.pitch = Math.max(eye.pitch, minWalkPitch(altitude - level, eye.lat, map.getCanvas().clientHeight))
  return map.calculateCameraOptionsFromCameraLngLatAltRotation([eye.lon, eye.lat], altitude, eye.bearing, eye.pitch)
}

function place(map: Map, eye: Eye): void {
  map.jumpTo(cameraFor(map, eye), WALKING)
}

/** One frame of held controls. Timed by the clock, not by key repeat, so the pace is the same on every machine. */
function step(time: number): void {
  frame = 0
  if (!walk || held.size === 0) return
  // A tab in the background gets no frames: coming back is not one long leap.
  const dt = Math.min(0.1, Math.max(0, time - lastFrame) / 1000)
  lastFrame = time
  const { map, eye } = walk
  const axis = (plus: Control, minus: Control) => Number(held.has(plus)) - Number(held.has(minus))
  const boost = held.has('fast') ? FAST : 1
  const forward = axis('forward', 'back') * WALK_SPEED * boost * dt
  const right = axis('right', 'left') * WALK_SPEED * boost * dt
  const turn = axis('turnRight', 'turnLeft') * TURN_SPEED * dt
  const height = Math.min(TOP_HEIGHT, Math.max(EYE_HEIGHT, eye.height + axis('up', 'down') * CLIMB_SPEED * boost * dt))
  if (forward || right || turn || height !== eye.height) {
    if (forward || right) [eye.lon, eye.lat] = stepEye(eye.lon, eye.lat, eye.bearing, forward, right)
    eye.bearing += turn
    eye.height = height
    place(map, eye)
  }
  frame = requestAnimationFrame(step)
}

/** Starts holding a control. The panel's buttons and the keys both come through here. */
export function hold(control: Control): void {
  if (!walk) return
  held.add(control)
  if (!frame) {
    lastFrame = performance.now()
    frame = requestAnimationFrame(step)
  }
}

export function release(control: Control): void {
  held.delete(control)
}

function typing(event: Event): boolean {
  const target = event.target
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
}

/** Steps down into the map at its centre, and sets up what ends the walk again. */
function begin(map: Map): void {
  // Ends a camera still easing out of the last walk, which puts back what that walk changed first.
  map.stop()
  // Following something would pull the camera away from the walker on every tick.
  useSelection.getState().follow(null)
  const { lng, lat } = map.getCenter()
  const eye: Eye = { lon: lng, lat, height: EYE_HEIGHT, bearing: map.getBearing(), pitch: START_PITCH }
  const maxPitch = map.getMaxPitch()
  map.setMaxZoom(WALK_ZOOM)
  map.setMaxPitch(TOP_PITCH)
  const handlers = [
    map.dragPan,
    map.dragRotate,
    map.scrollZoom,
    map.boxZoom,
    map.doubleClickZoom,
    map.keyboard,
    map.touchZoomRotate,
    map.touchPitch,
  ].filter((handler) => handler.isEnabled())
  for (const handler of handlers) handler.disable()
  map.easeTo({ ...cameraFor(map, eye), duration: prefersReducedMotion() ? 0 : 1200, essential: true }, WALKING)

  const container = map.getCanvasContainer()
  // Without its own gesture handlers the map no longer claims touches, and a dragging finger would
  // scroll or zoom the page instead of looking around.
  container.style.touchAction = 'none'

  // Dragging looks around. A click that barely moves is still a click on whatever is under it.
  let drag: { id: number; x: number; y: number; looking: boolean } | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (drag || event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, looking: false }
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.looking && Math.hypot(dx, dy) <= 3) return
    drag.x = event.clientX
    drag.y = event.clientY
    drag.looking = true
    eye.bearing += dx * 0.25
    // Kept above the lowest look by cameraFor.
    eye.pitch = Math.min(TOP_PITCH, eye.pitch - dy * 0.2)
    place(map, eye)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === drag?.id) drag = null
  }
  // The wheel walks: 3 m for a notch of 100 px, or of three lines.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 33 : event.deltaY
    ;[eye.lon, eye.lat] = stepEye(eye.lon, eye.lat, eye.bearing, -pixels * 0.03, 0)
    place(map, eye)
  }
  // After the page's own handlers, so a key a focused control has used (a window moved with the
  // arrows) is left to it.
  const onKeyDown = (event: KeyboardEvent) => {
    const control = KEYS[event.code]
    if (!control || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event)) return
    event.preventDefault()
    hold(control)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    const control = KEYS[event.code]
    if (control) release(control)
  }
  // Caught on its way down, so the Inspector does not take the same Escape as "clear the selection".
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || typing(event)) return
    event.stopPropagation()
    finish(true)
  }
  // Keys let go of while the page is not looking would otherwise stay held.
  const onBlur = () => held.clear()
  // Any other camera move (a view, a search result, a link to another view, the base's zoom
  // limit) takes the camera: the walk ends there. A flight is caught by its animation, a jump by
  // the camera no longer being where the walk last left it. A resize starts before it changes either.
  let last = { lng: Number.NaN, lat: Number.NaN, zoom: Number.NaN }
  const onMoveEnd = (event: MapMovementEvent & { walk?: boolean }) => {
    if (!event.walk) return
    const { lng, lat } = map.getCenter()
    last = { lng, lat, zoom: map.getZoom() }
  }
  const onMoveStart = (event: MapMovementEvent & { walk?: boolean }) => {
    if (event.walk) return
    const { lng, lat } = map.getCenter()
    if (map.isMoving() || lng !== last.lng || lat !== last.lat || map.getZoom() !== last.zoom) finish(false)
  }
  // A resize keeps the zoom, and so moves the eye up or down with the canvas height: put it back.
  const onResize = () => place(map, eye)
  // Someone followed after all.
  const stopWatchingFollow = useSelection.subscribe((state) => {
    if (state.followId) finish(false)
  })

  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('keydown', onEscape, true)
  window.addEventListener('blur', onBlur)
  map.on('movestart', onMoveStart)
  map.on('moveend', onMoveEnd)
  map.on('resize', onResize)

  walk = {
    map,
    eye,
    end: (overview) => {
      cancelAnimationFrame(frame)
      frame = 0
      held.clear()
      container.style.touchAction = ''
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('blur', onBlur)
      map.off('movestart', onMoveStart)
      map.off('moveend', onMoveEnd)
      map.off('resize', onResize)
      stopWatchingFollow()

      const ceiling = zoomCeiling(useUi.getState().base)
      // Put back once the camera is out. The base may have changed meanwhile, and a flight that took
      // the camera may have left it deeper than the base allows: it eases out rather than jumps.
      const restore = () => {
        for (const handler of handlers) handler.enable()
        map.setMaxPitch(maxPitch)
        applyZoomCeiling(map, zoomCeiling(useUi.getState().base))
      }
      if (overview) {
        map.stop()
        map.once('moveend', restore)
        map.easeTo({
          center: [eye.lon, eye.lat],
          zoom: Math.min(17.5, ceiling),
          pitch: 60,
          bearing: eye.bearing,
          duration: prefersReducedMotion() ? 0 : 1200,
          essential: true,
        })
      } else if (map.isMoving()) map.once('moveend', restore)
      else restore()
    },
  }
}

function finish(overview: boolean): void {
  if (!walk) return
  const { end } = walk
  walk = null
  end(overview)
  useWalk.setState({ walking: false })
}

interface WalkState {
  walking: boolean
  enter(): void
  leave(): void
}

/** Street level: the visitor stands in the map and walks about. Not remembered between visits. */
export const useWalk = create<WalkState>()(() => ({
  walking: false,
  enter: () => {
    const map = getMap()
    if (!map || walk) return
    begin(map)
    useWalk.setState({ walking: true })
  },
  leave: () => finish(true),
}))

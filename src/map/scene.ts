import { MapLibreOverlay } from '@deck.gl/maplibre'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Entity } from '../../shared/entity'
import { LAYERS } from '../layers/registry'
import type { LayerContext } from '../layers/types'
import { startAlerts } from '../runtime/alertRunner'
import { fetchFeedList } from '../runtime/api'
import { serverNow } from '../runtime/clock'
import { getEntity, subscribeEntities } from '../runtime/entityStore'
import { acquireFeed } from '../runtime/poller'
import { useFeeds } from '../state/feeds'
import { isLayerOn, useLayers } from '../state/layers'
import { useSelection } from '../state/selection'
import { positionAt } from './motion'

const LABEL_FONT_PROBE = '500 11px "JetBrains Mono Variable"'

/** Redraw rate for moving objects. At country scale a jet covers less than a pixel per second. */
function tickIntervalMs(zoom: number): number {
  if (zoom < 7) return 250
  if (zoom < 10) return 80
  return 33
}

/**
 * Draws every live layer on a deck.gl canvas laid over the map, and keeps it moving.
 * Overlaid rather than interleaved: redrawing the moving objects many times a second
 * then never forces the basemap to repaint.
 */
export function startScene(map: MapLibreMap): () => void {
  let fontsReady = false
  let dirty = true
  let lastDraw = 0
  let frame = 0
  let stopped = false

  const overlay = new MapLibreOverlay({
    interleaved: false,
    layers: [],
    pickingRadius: 8,
    onClick: (info) => {
      useSelection.getState().select((info.object as Entity | undefined)?.id ?? null)
    },
    onHover: (info) => {
      const id = (info.object as Entity | undefined)?.id ?? null
      useSelection.getState().hover(id)
      map.getCanvas().style.cursor = id ? 'pointer' : ''
    },
  })
  map.addControl(overlay)

  // Poll exactly the feeds that visible layers need.
  const held = new Map<string, (() => void)[]>()
  const syncFeeds = () => {
    const { visible } = useLayers.getState()
    for (const layer of LAYERS) {
      const on = isLayerOn(visible, layer.id, layer.defaultOn)
      const releases = held.get(layer.id)
      if (on && !releases) {
        held.set(layer.id, layer.feeds.map(acquireFeed))
        layer.native?.show(map)
      } else if (!on && releases) {
        for (const release of releases) release()
        held.delete(layer.id)
        layer.native?.hide()
        layer.dispose?.()
      }
    }
  }

  const draw = () => {
    const { visible } = useLayers.getState()
    const { selectedId, hoveredId, followId } = useSelection.getState()
    const ctx: LayerContext = { now: serverNow(), zoom: map.getZoom(), selectedId, hoveredId, fontsReady }

    const followed = followId ? getEntity(followId) : undefined
    if (followed && !map.isMoving()) map.setCenter(positionAt(followed, ctx.now))

    const shown = LAYERS.filter((layer) => isLayerOn(visible, layer.id, layer.defaultOn))
    for (const layer of shown) layer.update?.(ctx.now)
    overlay.setProps({ layers: shown.flatMap((layer) => layer.build(ctx)) })
  }

  const loop = (time: number) => {
    if (stopped) return
    frame = requestAnimationFrame(loop)
    if (document.hidden) return
    if (!dirty && time - lastDraw < tickIntervalMs(map.getZoom())) return
    dirty = false
    lastDraw = time
    draw()
  }
  const invalidate = () => {
    dirty = true
  }

  const unsubscribe = [
    useLayers.subscribe(() => {
      syncFeeds()
      invalidate()
    }),
    useSelection.subscribe(invalidate),
    subscribeEntities(invalidate),
  ]
  // The user taking the wheel ends "follow".
  const stopFollowing = () => useSelection.getState().follow(null)
  map.on('dragstart', stopFollowing)

  syncFeeds()
  const stopAlerts = startAlerts()
  frame = requestAnimationFrame(loop)

  void document.fonts.load(LABEL_FONT_PROBE).then(() => {
    fontsReady = true
    invalidate()
  })
  fetchFeedList()
    .then((list) => useFeeds.getState().seed(list.feeds))
    .catch(() => {
      // The layer list still works from per-feed polling; titles and credits arrive with the next try.
    })

  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    stopAlerts()
    for (const off of unsubscribe) off()
    map.off('dragstart', stopFollowing)
    for (const releases of held.values()) for (const release of releases) release()
    held.clear()
    for (const layer of LAYERS) {
      layer.native?.hide()
      layer.dispose?.()
    }
    map.removeControl(overlay)
  }
}

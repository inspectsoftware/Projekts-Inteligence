import type { Map as MapLibreMap, RasterTileSource } from 'maplibre-gl'
import { RADAR_INDEX_URL } from '../../shared/origins'
import { type RadarFrame, useRadar } from '../state/radar'

/**
 * Precipitation radar from RainViewer: the last two hours in ten-minute scans.
 * Drawn by the map itself (raster tiles), under the place labels.
 */
const OPACITY = 0.72
const REFRESH_MS = 5 * 60 * 1000
const FRAME_MS = 650
/** RainViewer serves real data up to zoom 7; beyond that the map stretches those tiles. */
const MAX_ZOOM = 7
/** Colour scheme 2 (universal blue), smoothed, with snow shown. */
const TILE_OPTIONS = '2/1_1.png'
const BEFORE_LAYER = 'label-water'

const BUFFERS = ['radar-a', 'radar-b'] as const
type Buffer = (typeof BUFFERS)[number]

interface Index {
  host: string
  radar?: { past?: { time: number; path: string }[] }
}

async function loadFrames(signal: AbortSignal): Promise<RadarFrame[]> {
  const res = await fetch(RADAR_INDEX_URL, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const index = (await res.json()) as Index
  return (index.radar?.past ?? []).map((frame) => ({
    time: frame.time,
    tiles: `${index.host}${frame.path}/256/{z}/{x}/{y}/${TILE_OPTIONS}`,
  }))
}

/** Adds the radar to the map and keeps it in step with the radar store. Returns a function that removes it. */
export function showRadar(map: MapLibreMap): () => void {
  const abort = new AbortController()
  // Two stacked layers: the next scan loads in the hidden one, then they swap, so stepping never blanks the map.
  let front: Buffer = 'radar-a'
  let shown: string | null = null
  let pending: (() => void) | null = null

  /** Points a buffer at a scan, creating its source and layer on first use (a source may not start without tiles). */
  const load = (id: Buffer, tiles: string) => {
    const source = map.getSource(id) as RasterTileSource | undefined
    if (source) {
      source.setTiles([tiles])
      // Barely visible rather than invisible, or the map would not bother loading its tiles.
      map.setPaintProperty(id, 'raster-opacity', 0.01)
      return
    }
    map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: MAX_ZOOM })
    map.addLayer(
      { id, type: 'raster', source: id, paint: { 'raster-opacity': 0.01, 'raster-fade-duration': 0 } },
      map.getLayer(BEFORE_LAYER) ? BEFORE_LAYER : undefined,
    )
  }

  const display = (frame: RadarFrame | undefined) => {
    if (!frame || frame.tiles === shown) return
    shown = frame.tiles
    const back: Buffer = front === 'radar-a' ? 'radar-b' : 'radar-a'
    if (pending) map.off('idle', pending)

    load(back, frame.tiles)
    pending = () => {
      pending = null
      map.setPaintProperty(back, 'raster-opacity', OPACITY)
      if (map.getLayer(front)) map.setPaintProperty(front, 'raster-opacity', 0)
      front = back
    }
    map.once('idle', pending)
  }

  const refresh = () => {
    loadFrames(abort.signal)
      .then((frames) => useRadar.getState().setFrames(frames))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) useRadar.getState().setError(err instanceof Error ? err.message : String(err))
      })
  }

  const unsubscribe = useRadar.subscribe((state) => display(state.frames[state.index]))
  const refreshTimer = setInterval(refresh, REFRESH_MS)
  const playTimer = setInterval(() => {
    const { playing, frames, index, setIndex } = useRadar.getState()
    if (playing && frames.length > 1 && !document.hidden) setIndex((index + 1) % frames.length)
  }, FRAME_MS)
  refresh()

  return () => {
    abort.abort()
    unsubscribe()
    clearInterval(refreshTimer)
    clearInterval(playTimer)
    if (pending) map.off('idle', pending)
    for (const id of BUFFERS) {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
    useRadar.getState().setPlaying(false)
  }
}

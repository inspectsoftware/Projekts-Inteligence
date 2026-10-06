import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import { useUi } from '../state/ui'
import { finishBoot } from '../ui/boot'
import { applyBaseMode } from './baseMode'
import { INTRO_START, runIntro } from './camera'
import { setMap, setMapFailure, useMap, useMapFailure } from './instance'
import { startScene } from './scene'
import { addSpotlight } from './spotlight'
import { buildStyle } from './style'

// MapLibre 6 is ESM-only: under a bundler its worker has to be given as a URL.
setWorkerUrl(workerUrl)

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const vision = useUi((s) => s.vision)
  const base = useUi((s) => s.base)
  const map = useMap()
  const error = useMapFailure()

  useEffect(() => {
    let created: MapLibreMap
    try {
      created = new MapLibreMap({
        container: containerRef.current!,
        style: buildStyle(),
        center: INTRO_START.center,
        zoom: INTRO_START.zoom,
        minZoom: 3,
        maxPitch: 70,
        attributionControl: false,
        renderWorldCopies: false,
        canvasContextAttributes: { antialias: true },
      })
    } catch (err) {
      // Thrown when the browser cannot give us WebGL2.
      setMapFailure(err instanceof Error ? err.message : String(err))
      finishBoot()
      return () => setMapFailure(null)
    }

    let cancelled = false
    let stopScene: (() => void) | undefined
    // Never leave the boot screen up if the style or tiles cannot be reached.
    const bootTimeout = setTimeout(finishBoot, 8000)

    created.once('load', () => {
      void (async () => {
        try {
          const res = await fetch('/data/lv-border.json')
          const border = (await res.json()) as FeatureCollection<Polygon | MultiPolygon>
          if (cancelled) return
          addSpotlight(created, border)
        } catch (err) {
          console.error('[map] border overlay failed to load:', err)
        }
        if (cancelled) return
        setMap(created)
        stopScene = startScene(created)
        finishBoot()
        runIntro(created)
      })()
    })

    return () => {
      cancelled = true
      clearTimeout(bootTimeout)
      stopScene?.()
      setMap(null)
      created.remove()
    }
  }, [])

  useEffect(() => {
    if (map) applyBaseMode(map, base)
  }, [map, base])

  return (
    <div className="map-stage" data-vision={vision}>
      <div ref={containerRef} className="map-canvas" />
      <div className="fx fx-noise" aria-hidden="true" />
      <div className="fx fx-scanlines" aria-hidden="true" />
      <div className="fx fx-vignette" aria-hidden="true" />
      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center font-mono text-xs tracking-widest text-danger uppercase">
          <p>
            Map unavailable: this browser could not start WebGL2.
            <span className="mt-2 block text-fg-mute normal-case">{error}</span>
          </p>
        </div>
      )}
    </div>
  )
}

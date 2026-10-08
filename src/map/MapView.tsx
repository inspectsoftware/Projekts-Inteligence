import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import { AOI_BBOX, inBBox } from '../../shared/region'
import { t } from '../i18n'
import { setBorder } from '../runtime/border'
import { useRecent, useTheme, useUi } from '../state/ui'
import { whatIsHere } from '../runtime/place'
import { finishBoot } from '../ui/boot'
import { applyBaseMode, applyZoomCeiling, rasterId } from './baseMode'
import { ORTHO_LITHUANIA, clampZoom, recentEnd, zoomCeiling } from './basemaps'
import { INTRO_START, runIntro } from './camera'
import { setMap, setMapFailure, useMap, useMapFailure } from './instance'
import { CLIP_SCHEME, TRIM_SCHEME, loadEstoniaTile, loadLatviaTile, setClipBorder } from './orthoClip'
import { PATIENT_SCHEME, loadPatientTile } from './patientTiles'
import { applyRelief } from './relief'
import { startScene } from './scene'
import { addSpotlight } from './spotlight'
import { applyMapTheme, buildStyle } from './style'
import { WORLD_SCHEME, loadWorldOrthoTile } from './worldOrtho'
import { readUrlView, writeUrlView } from './urlView'

// MapLibre 6 is ESM-only: under a bundler its worker has to be given as a URL.
setWorkerUrl(workerUrl)
// Latvia's orthophoto tiles are cut to the national border on their way in, and Estonia's lose
// the navy their service fills the edge of its coverage with.
addProtocol(CLIP_SCHEME, loadLatviaTile)
addProtocol(TRIM_SCHEME, loadEstoniaTile)
addProtocol(PATIENT_SCHEME, loadPatientTile)
addProtocol(WORLD_SCHEME, loadWorldOrthoTile)

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const vision = useUi((s) => s.vision)
  const base = useUi((s) => s.base)
  const relief = useUi((s) => s.relief)
  const theme = useTheme()
  const back = useRecent((s) => s.back)
  const map = useMap()
  const error = useMapFailure()

  // Ahead of the effect that owns the map: cleanups run in this order, and this one may still
  // have a flight to stop, which a map already removed must not be asked to do.
  useEffect(() => {
    if (!map) return
    applyBaseMode(map, base, base === 'recent' ? recentEnd(new Date(), back) : new Date())
    return applyZoomCeiling(map, zoomCeiling(base))
  }, [map, base, back])

  // After the one above, every time it runs: a new base hides the buildings and buries the shading.
  useEffect(() => {
    if (map) applyRelief(map, relief, base !== 'dark')
  }, [map, base, back, relief])

  // Last of the three: it colours what the two above have just put on the map. Over imagery the
  // map keeps its dark lettering whatever the theme, since that is what reads on a photo.
  useEffect(() => {
    if (map) applyMapTheme(map, base === 'dark' ? theme : 'dark', base !== 'dark')
  }, [map, base, back, relief, theme])

  useEffect(() => {
    // Someone following a shared link wants that view, not the opening fly-in.
    const urlView = readUrlView()
    // The base the visitor left on decides how deep the map may open; a link from deeper is pulled back.
    const startBase = useUi.getState().base
    let created: MapLibreMap
    try {
      created = new MapLibreMap({
        container: containerRef.current!,
        style: buildStyle(),
        center: urlView?.center ?? INTRO_START.center,
        zoom: clampZoom(urlView?.zoom ?? INTRO_START.zoom, startBase),
        bearing: urlView?.bearing ?? 0,
        pitch: urlView?.pitch ?? 0,
        minZoom: 1.5,
        maxZoom: zoomCeiling(startBase),
        maxPitch: 70,
        attributionControl: false,
        renderWorldCopies: false,
        canvasContextAttributes: { antialias: true },
      })
    } catch (err) {
      // Thrown when the browser cannot give us WebGL2.
      setMapFailure(`${t('This browser could not start WebGL2.')} ${err instanceof Error ? err.message : String(err)}`)
      finishBoot()
      return () => setMapFailure(null)
    }

    // Lithuania's service answers 500 for tiles inside its box but past its border, where the layers
    // below simply show through. That is not worth a console line a tile; everything else still is.
    created.on('error', (event) => {
      if ((event as { sourceId?: string }).sourceId !== rasterId(ORTHO_LITHUANIA.id)) console.error(event.error)
    })

    let cancelled = false
    let stopScene: (() => void) | undefined
    // Never leave the boot screen up if the style or tiles cannot be reached.
    const bootTimeout = setTimeout(finishBoot, 8000)

    // A link to another view opened in this same tab only changes the fragment: go there.
    const followLink = () => {
      const view = readUrlView()
      if (view) created.jumpTo(view)
    }
    window.addEventListener('hashchange', followLink)

    // A lost graphics context (driver reset, memory pressure) leaves the overlay canvas dead for
    // good. Starting over is the cure; a second loss within a minute means it would only loop.
    const container = containerRef.current!
    const onContextLost = () => {
      let recent = false
      try {
        recent = Date.now() - Number(sessionStorage.getItem('pwh-gl-lost')) < 60_000
        sessionStorage.setItem('pwh-gl-lost', String(Date.now()))
      } catch {
        // Storage can be switched off; then the page is simply not reloaded automatically.
        recent = true
      }
      if (recent) setMapFailure(t('The graphics context was lost. Reload the page to try again.'))
      else window.location.reload()
    }
    // The event does not bubble, so it is caught on its way down to whichever canvas lost it.
    container.addEventListener('webglcontextlost', onContextLost, true)

    created.once('load', () => {
      void (async () => {
        try {
          const res = await fetch('/data/lv-border.json')
          const border = (await res.json()) as FeatureCollection<Polygon | MultiPolygon>
          if (cancelled) return
          addSpotlight(created, border)
          setBorder(border)
          setClipBorder(border)
        } catch (err) {
          console.error('[map] border overlay failed to load:', err)
        }
        if (cancelled) return
        setMap(created)
        stopScene = startScene(created)
        finishBoot()
        if (!urlView) runIntro(created)
        created.on('contextmenu', (event) => whatIsHere(created, event.lngLat.lng, event.lngLat.lat))
        created.on('moveend', () => {
          const { lng, lat } = created.getCenter()
          // The shade that sets Latvia apart would only darken a map of somewhere else.
          if (created.getLayer('lv-mask')) created.setLayoutProperty('lv-mask', 'visibility', inBBox(lng, lat, AOI_BBOX) ? 'visible' : 'none')
          writeUrlView({ center: [lng, lat], zoom: created.getZoom(), bearing: created.getBearing(), pitch: created.getPitch() })
        })
      })()
    })

    return () => {
      cancelled = true
      clearTimeout(bootTimeout)
      window.removeEventListener('hashchange', followLink)
      container.removeEventListener('webglcontextlost', onContextLost, true)
      stopScene?.()
      setMap(null)
      created.remove()
    }
  }, [])

  return (
    <div className="map-stage" data-vision={vision}>
      <div ref={containerRef} className="map-canvas" />
      <div className="fx fx-noise" aria-hidden="true" />
      <div className="fx fx-scanlines" aria-hidden="true" />
      <div className="fx fx-vignette" aria-hidden="true" />
      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center font-mono text-xs tracking-widest text-danger uppercase">
          <p>
            {t('Map unavailable')}
            <span className="mt-2 block text-fg-mute normal-case">{error}</span>
          </p>
        </div>
      )}
    </div>
  )
}

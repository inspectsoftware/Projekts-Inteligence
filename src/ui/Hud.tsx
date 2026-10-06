import type { MapMouseEvent } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { formatLat, formatLon, formatMgrs, scaleBar } from '../lib/coords'
import { useMap } from '../map/instance'
import { Panel } from './kit'

/**
 * Cursor position and camera state. These change on every mouse move and frame,
 * so they are written straight to the DOM instead of going through React state.
 */
export function Hud() {
  const map = useMap()
  const modeRef = useRef<HTMLSpanElement>(null)
  const latLonRef = useRef<HTMLSpanElement>(null)
  const mgrsRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const bearingRef = useRef<HTMLSpanElement>(null)
  const pitchRef = useRef<HTMLSpanElement>(null)
  const scaleBarRef = useRef<HTMLSpanElement>(null)
  const scaleLabelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!map) return
    let cursor: { lng: number; lat: number } | null = null

    const paintPosition = () => {
      const at = cursor ?? map.getCenter()
      modeRef.current!.textContent = cursor ? 'CUR' : 'CTR'
      latLonRef.current!.textContent = `${formatLat(at.lat)}  ${formatLon(at.lng)}`
      mgrsRef.current!.textContent = formatMgrs(at.lng, at.lat)
    }
    const paintCamera = () => {
      const center = map.getCenter()
      const zoom = map.getZoom()
      const bearing = (map.getBearing() + 360) % 360
      zoomRef.current!.textContent = zoom.toFixed(2)
      bearingRef.current!.textContent = `${Math.round(bearing).toString().padStart(3, '0')}°`
      pitchRef.current!.textContent = `${Math.round(map.getPitch()).toString().padStart(2, '0')}°`
      const scale = scaleBar(center.lat, zoom)
      scaleBarRef.current!.style.width = `${scale.px.toFixed(0)}px`
      scaleLabelRef.current!.textContent = scale.label
      if (!cursor) paintPosition()
    }
    const onMouseMove = (event: MapMouseEvent) => {
      cursor = event.lngLat
      paintPosition()
    }
    const onMouseOut = () => {
      cursor = null
      paintPosition()
    }

    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    map.on('move', paintCamera)
    paintCamera()
    paintPosition()

    return () => {
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      map.off('move', paintCamera)
    }
  }, [map])

  const label = 'text-fg-mute'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <Panel className="flex items-center gap-x-4 gap-y-1 px-3 py-1.5 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap text-fg tabular-nums max-md:flex-wrap max-md:justify-center">
        <span>
          <span ref={modeRef} className={`mr-2 ${label}`}>
            CTR
          </span>
          <span ref={latLonRef}>—</span>
        </span>
        <span>
          <span className={`mr-2 ${label}`}>MGRS</span>
          <span ref={mgrsRef}>—</span>
        </span>
        <span className="max-sm:hidden">
          <span className={`mr-2 ${label}`}>Z</span>
          <span ref={zoomRef}>—</span>
        </span>
        <span className="max-sm:hidden">
          <span className={`mr-2 ${label}`}>BRG</span>
          <span ref={bearingRef}>—</span>
        </span>
        <span className="max-sm:hidden">
          <span className={`mr-2 ${label}`}>TILT</span>
          <span ref={pitchRef}>—</span>
        </span>
        <span className="flex items-center gap-2 max-lg:hidden">
          <span ref={scaleBarRef} className="block h-1.5 border-x border-b border-fg-dim" />
          <span ref={scaleLabelRef} className={label}>
            —
          </span>
        </span>
      </Panel>
    </div>
  )
}

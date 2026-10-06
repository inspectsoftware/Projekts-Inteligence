import type { ReactNode } from 'react'
import { flyHome } from '../map/camera'
import { useMap } from '../map/instance'

function MapButton({ title, onClick, children }: { title: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center bg-ink-850 text-fg-dim transition-colors hover:bg-ink-700 hover:text-accent"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** Zoom, north-up and home, for mouse users without a wheel and for touch. */
export function MapButtons() {
  const map = useMap()
  if (!map) return null

  return (
    <div className="pointer-events-auto absolute top-13 right-3 z-10 grid gap-px border border-line bg-line">
      <MapButton title="Zoom in" onClick={() => map.zoomIn()}>
        <path d="M8 3v10M3 8h10" />
      </MapButton>
      <MapButton title="Zoom out" onClick={() => map.zoomOut()}>
        <path d="M3 8h10" />
      </MapButton>
      <MapButton title="North up, flat" onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 600 })}>
        <path d="M8 2l3.5 11L8 10.5 4.5 13 8 2z" />
      </MapButton>
      <MapButton title="Latvia overview" onClick={() => flyHome(map)}>
        <path d="M2.5 8L8 3l5.5 5M4 7v6h8V7" />
      </MapButton>
    </div>
  )
}

import type { ReactNode } from 'react'
import { t } from '../i18n'
import { flyHome } from '../map/camera'
import { useMap } from '../map/instance'
import { useUi } from '../state/ui'

function MapButton({ title, onClick, pressed, children }: { title: string; onClick(): void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center bg-ink-850 transition-colors hover:bg-ink-700 hover:text-accent ${pressed ? 'text-accent' : 'text-fg-dim'}`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** Zoom, north-up and home, for mouse users without a wheel. Phones pinch, and find home in the Views window. */
export function MapButtons() {
  const map = useMap()
  const relief = useUi((s) => s.relief)
  const setRelief = useUi((s) => s.setRelief)
  if (!map) return null

  const toggleRelief = () => {
    setRelief(!relief)
    // Relief seen from straight above is only shading: tilt the first look at it.
    if (!relief && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 })
  }

  return (
    // data-snap: a dragged window is drawn to these edges as it is to another window's.
    <div data-snap className="pointer-events-auto absolute top-13 right-3 z-10 grid gap-px border border-line bg-line max-md:hidden">
      <MapButton title={t('Zoom in')} onClick={() => map.zoomIn()}>
        <path d="M8 3v10M3 8h10" />
      </MapButton>
      <MapButton title={t('Zoom out')} onClick={() => map.zoomOut()}>
        <path d="M3 8h10" />
      </MapButton>
      <MapButton title={t('North up, flat')} onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 600 })}>
        <path d="M8 2l3.5 11L8 10.5 4.5 13 8 2z" />
      </MapButton>
      <MapButton title={t('3D terrain and buildings')} onClick={toggleRelief} pressed={relief}>
        <path d="M1.5 13l4.5-8 3 5 2-3 3.5 6z" />
      </MapButton>
      <MapButton title={t('Latvia overview')} onClick={() => flyHome(map)}>
        <path d="M2.5 8L8 3l5.5 5M4 7v6h8V7" />
      </MapButton>
    </div>
  )
}

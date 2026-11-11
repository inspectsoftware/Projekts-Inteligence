import type { ReactNode } from 'react'
import { t } from '../i18n'
import { flyHome } from '../map/camera'
import { useMap } from '../map/instance'
import { useUi } from '../state/ui'

/** Every button not in the zoom pill is a circle of its own on a wide screen. */
const ROUND = 'md:[&>button]:rounded-full md:[&>button]:border md:[&>button]:border-line md:[&>button]:shadow-[0_2px_12px_rgb(0_0_0/0.12)]'

function MapButton({ title, onClick, pressed, children }: { title: string; onClick(): void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center bg-ink-850 transition-colors hover:bg-ink-700 hover:text-accent md:h-10 md:w-10 md:bg-ink-900 ${pressed ? 'text-accent' : 'text-fg-dim'}`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 md:h-[18px] md:w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** Zoom, north-up and home, for mouse users without a wheel, and on a phone the one way home. */
export function MapButtons() {
  const map = useMap()
  const relief = useUi((s) => s.relief)
  const setRelief = useUi((s) => s.setRelief)
  if (!map) return null

  const toggleRelief = () => {
    setRelief(!relief)
    // Relief seen from straight above is only shading: tilt the first look at it. Turning it off
    // lays the map flat again, or the tilted buildings would still look like 3D left on.
    if (!relief && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 })
    if (relief && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 800 })
  }

  return (
    // data-snap: a dragged window is drawn to these edges as it is to another window's.
    // On a wide screen: round buttons at mid-height on the right, zoom in and out sharing one pill.
    <div
      data-snap
      className={`pointer-events-auto absolute top-13 right-3 z-10 grid gap-px border border-line bg-line md:top-1/2 md:-translate-y-1/2 md:gap-2 md:border-0 md:bg-transparent ${ROUND}`}
    >
      <div className="grid gap-px bg-line md:overflow-hidden md:rounded-full md:border md:border-line md:shadow-[0_2px_12px_rgb(0_0_0/0.12)]">
        <MapButton title={t('Zoom in')} onClick={() => map.zoomIn()}>
          <path d="M8 3v10M3 8h10" />
        </MapButton>
        <MapButton title={t('Zoom out')} onClick={() => map.zoomOut()}>
          <path d="M3 8h10" />
        </MapButton>
      </div>
      <MapButton title={t('North up, flat')} onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 600 })}>
        <path d="M8 2l3.5 11L8 10.5 4.5 13 8 2z" />
      </MapButton>
      <MapButton title={t('3D terrain and buildings')} onClick={toggleRelief} pressed={relief}>
        <path d="M1.5 13l4.5-8 3 5 2-3 3.5 6z" />
      </MapButton>
      {/* Street level (map/walk.ts) is set aside for now: its button comes back here when it is ready. */}
      <MapButton title={t('Baltic overview')} onClick={() => flyHome(map)}>
        <path d="M2.5 8L8 3l5.5 5M4 7v6h8V7" />
      </MapButton>
    </div>
  )
}

import { BASEMAP_ATTRIBUTION } from '../../shared/origins'
import { RASTER_BASES } from '../map/basemaps'
import { useUi } from '../state/ui'

/** Credits for whatever is on screen. Required by the data licences, so always visible. */
export function Attribution() {
  const base = useUi((s) => s.base)
  const credits = base === 'dark' ? BASEMAP_ATTRIBUTION : [...BASEMAP_ATTRIBUTION, RASTER_BASES[base].attribution]

  return (
    <p className="pointer-events-auto absolute right-3 bottom-3 z-10 max-w-[38ch] bg-ink-900/70 px-1.5 py-0.5 text-right text-[9px] leading-snug text-fg-mute max-xl:hidden">
      {credits.map((credit, index) => (
        <span key={credit.href}>
          {index > 0 && ' · '}
          <a href={credit.href} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
            {credit.label}
          </a>
        </span>
      ))}
    </p>
  )
}

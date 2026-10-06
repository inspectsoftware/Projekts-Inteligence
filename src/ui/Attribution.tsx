import { type Attribution as Credit, BASEMAP_ATTRIBUTION } from '../../shared/origins'
import { LAYERS } from '../layers/registry'
import { RASTER_BASES } from '../map/basemaps'
import { useFeeds } from '../state/feeds'
import { isLayerOn, useLayers } from '../state/layers'
import { useUi } from '../state/ui'

/**
 * Credits for whatever is on screen. Required by the data licences, so always there: spelled out
 * in the corner of a wide screen, one press away on a narrow one.
 */
export function Attribution() {
  const base = useUi((s) => s.base)
  const visible = useLayers((s) => s.visible)
  const feeds = useFeeds((s) => s.feeds)

  const credits: Credit[] = [...BASEMAP_ATTRIBUTION]
  // The whole stack is credited, including orthophotos that only come in when zoomed closer.
  if (base !== 'dark') credits.push(...RASTER_BASES[base].sources.map((source) => source.attribution))
  for (const layer of LAYERS) {
    if (!isLayerOn(visible, layer.id, layer.defaultOn)) continue
    credits.push(...(layer.attribution ?? []))
    for (const feed of layer.feeds) credits.push(...(feeds[feed]?.attribution ?? []))
  }
  const unique = credits.filter((credit, index) => credits.findIndex((other) => other.href === credit.href) === index)

  const links = unique.map((credit, index) => (
    <span key={credit.href}>
      {index > 0 && ' · '}
      <a href={credit.href} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
        {credit.label}
      </a>
    </span>
  ))

  return (
    <>
      <p data-snap="credits" className="pointer-events-auto absolute right-3 bottom-3 z-10 max-w-[38ch] bg-ink-900/70 px-1.5 py-0.5 text-right text-[9px] leading-snug text-fg-mute max-xl:hidden">
        {links}
      </p>
      {/* Below that width the corner belongs to the windows and the HUD, so the list folds into
          a button the size of a map's usual "i". It carries no data-snap: no window makes room for it. */}
      <details className="pointer-events-auto absolute right-3 bottom-3 z-10 text-[9px] text-fg-mute xl:hidden">
        <summary
          aria-label="Map data credits"
          title="Map data credits"
          className="grid h-6 w-6 cursor-pointer list-none place-items-center border border-line bg-ink-900/90 text-[11px] text-fg-dim hover:text-fg [&::-webkit-details-marker]:hidden"
        >
          ©
        </summary>
        <p className="absolute right-0 bottom-7 max-h-[50vh] w-[min(38ch,calc(100vw-1.5rem))] overflow-y-auto border border-line bg-ink-900/95 px-1.5 py-1 text-right leading-snug">
          {links}
        </p>
      </details>
    </>
  )
}

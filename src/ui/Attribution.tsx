import { type Attribution as Credit, BASEMAP_ATTRIBUTION } from '../../shared/origins'
import { LAYERS } from '../layers/registry'
import { RASTER_BASES } from '../map/basemaps'
import { useFeeds } from '../state/feeds'
import { isLayerOn, useLayers } from '../state/layers'
import { useUi } from '../state/ui'

/** Credits for whatever is on screen. Required by the data licences, so always visible. */
export function Attribution() {
  const base = useUi((s) => s.base)
  const visible = useLayers((s) => s.visible)
  const feeds = useFeeds((s) => s.feeds)

  const credits: Credit[] = [...BASEMAP_ATTRIBUTION]
  if (base !== 'dark') credits.push(RASTER_BASES[base].attribution)
  for (const layer of LAYERS) {
    if (!isLayerOn(visible, layer.id, layer.defaultOn)) continue
    credits.push(...(layer.attribution ?? []))
    for (const feed of layer.feeds) credits.push(...(feeds[feed]?.attribution ?? []))
  }
  const unique = credits.filter((credit, index) => credits.findIndex((other) => other.href === credit.href) === index)

  return (
    <p className="pointer-events-auto absolute right-3 bottom-3 z-10 max-w-[38ch] bg-ink-900/70 px-1.5 py-0.5 text-right text-[9px] leading-snug text-fg-mute max-xl:hidden">
      {unique.map((credit, index) => (
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

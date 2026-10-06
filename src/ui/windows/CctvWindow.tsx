import { useMemo, useRef, useState } from 'react'
import { lvRoadCams } from '../../../shared/adapters/cams'
import type { Camera } from '../../../shared/adapters/roads'
import type { CamCountry } from '../../../shared/feeds'
import { t } from '../../i18n'
import { useFeed } from '../../runtime/useFeed'
import { useFeeds } from '../../state/feeds'
import { Segmented } from '../kit'
import { CamTile } from './cctv/CamTile'
import { CamView } from './cctv/CamView'
import { useInView } from './cctv/hooks'
import { pickCams } from './cctv/pick'
import { useCctv } from './cctv/store'

/** The most pictures the grid ever loads and renews at once, however many cameras a filter lets through. */
const PAGE = 24

const SETS = [
  { id: 'views', label: t('Views'), hint: t('City, port and landscape cameras') },
  { id: 'roads', label: t('Roads'), hint: t('Roadside and junction cameras, several hundred of them') },
] as const

const COUNTRIES: readonly { id: CamCountry | 'all'; label: string; hint: string }[] = [
  { id: 'all', label: t('All'), hint: t('All three countries') },
  { id: 'LV', label: 'LV', hint: t('Latvia') },
  { id: 'EE', label: 'EE', hint: t('Estonia') },
  { id: 'LT', label: 'LT', hint: t('Lithuania') },
]

const PAGER_BUTTON = 'px-1 text-fg-dim transition-colors hover:text-accent disabled:opacity-40 disabled:hover:text-fg-dim'

function Cameras() {
  const cams = useFeed('cams', 'cams')?.cams
  // Latvia's state road cameras have a feed and a map layer of their own; here they join the other road cameras.
  const lvRoads = useFeed('cameras', 'entities')?.entities
  const failed = useFeeds((s) => s.feeds.cams?.status === 'error')
  const roads = useCctv((s) => s.roads)
  const country = useCctv((s) => s.country)
  const query = useCctv((s) => s.query)
  const page = useCctv((s) => s.page)
  const openId = useCctv((s) => s.openId)
  const setFilter = useCctv((s) => s.setFilter)
  const setPage = useCctv((s) => s.setPage)
  const open = useCctv((s) => s.open)
  const back = useCctv((s) => s.back)

  const all = useMemo(() => [...(cams ?? []), ...lvRoadCams((lvRoads ?? []) as Camera[])], [cams, lvRoads])
  const shown = useMemo(() => pickCams(all, { roads, country, query }), [all, roads, country, query])
  const listed = openId ? all.find((cam) => cam.id === openId) : undefined
  // A camera drops out of the list for a minute whenever its lookup fails. The one being watched stays as it was.
  const [last, setLast] = useState(listed)
  if (listed && listed !== last) setLast(listed)
  const large = listed ?? (last?.id === openId ? last : undefined)

  if (!cams) {
    return <p className="p-3 text-[11px] text-fg-mute">{failed ? t('The cameras cannot be reached right now') : t('Finding the cameras that are live')}</p>
  }
  if (large) return <CamView cam={large} />
  if (openId) {
    // Remembered from last time and not listed now. Said so: a grid here would turn into this camera, unasked, once it is back.
    return (
      <div className="grid justify-items-start gap-2 p-3">
        <p className="text-[11px] text-fg-mute">{t('This camera is not available right now')}</p>
        <button type="button" onClick={back} className={`text-[10px] tracking-[0.16em] uppercase ${PAGER_BUTTON}`}>
          {t('‹ Grid')}
        </button>
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const at = Math.min(page, pages - 1)

  return (
    <>
      <div className="grid shrink-0 gap-1.5 border-b border-line p-2">
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <Segmented label={t('Kind of camera')} value={roads ? 'roads' : 'views'} options={SETS} onChange={(id) => setFilter({ roads: id === 'roads' })} />
          </div>
          <div className="min-w-0 flex-[1.6]">
            <Segmented label={t('Country')} value={country} options={COUNTRIES} onChange={(id) => setFilter({ country: id })} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setFilter({ query: event.target.value })}
            placeholder={t('Filter by name or place')}
            aria-label={t('Filter cameras by name or place')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border border-line bg-ink-850 px-2 py-1 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />
          <span role="status" className="shrink-0 text-[10px] tracking-[0.12em] text-fg-mute uppercase tabular-nums">
            {t('Cameras: {n}', { n: shown.length })}
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="p-3 text-[11px] text-fg-mute">{t('No camera matches')}</p>
      ) : (
        // A new page starts scrolled to its top.
        <ul key={`${roads}|${at}`} className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] content-start gap-1 overflow-y-auto p-1">
          {shown.slice(at * PAGE, (at + 1) * PAGE).map((cam) => (
            <li key={cam.id}>
              <CamTile cam={cam} onOpen={() => open(cam.id)} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label={t('Pages of cameras')} className="flex shrink-0 items-center justify-between border-t border-line px-2 py-1 text-[10px] tracking-[0.16em] uppercase">
          <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className={PAGER_BUTTON}>
            {t('‹ Prev')}
          </button>
          <span className="text-fg-mute tabular-nums">
            {at + 1} / {pages}
          </span>
          <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className={PAGER_BUTTON}>
            {t('Next ›')}
          </button>
        </nav>
      )}
    </>
  )
}

/**
 * Officially published live cameras: a grid of stills, and one camera large on a click.
 * Everything inside goes away while the window is collapsed, so no list is polled, no still
 * renewed and no stream played for a window nobody is looking into.
 */
export function CctvWindow() {
  const root = useRef<HTMLDivElement>(null)
  const inView = useInView(root)
  return (
    <div ref={root} className="flex min-h-24 flex-1 flex-col">
      {inView && <Cameras />}
    </div>
  )
}

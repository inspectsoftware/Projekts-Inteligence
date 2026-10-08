import type { FeedId } from '../../../shared/feeds'
import { t } from '../../i18n'
import { formatAge } from '../../lib/format'
import { useNow } from '../../runtime/useNow'
import { useFeeds } from '../../state/feeds'
import { STATUS_DOT, STATUS_TEXT } from '../feedStatus'

/** When each source last delivered, newest first. Only what has been read at least once is listed. */
export function SyncWindow() {
  const feeds = useFeeds((s) => s.feeds)
  const now = useNow(1000)
  const rows = (Object.keys(feeds) as FeedId[])
    .map((id) => ({ id, ...feeds[id]! }))
    .filter((feed) => feed.updatedAt !== null)
    .sort((a, b) => b.updatedAt! - a.updatedAt!)

  if (rows.length === 0) return <p className="p-3 text-[11px] text-fg-mute">{t('Waiting for data…')}</p>
  return (
    <div className="p-3 text-[11px]">
      <p className="mb-2 text-fg">
        {t('Map last updated')} <span className="text-accent tabular-nums">{formatAge(now - rows[0].updatedAt!)}</span>
      </p>
      <ul className="divide-y divide-line/50">
        {rows.map((feed) => (
          <li key={feed.id} className="flex items-center gap-2 py-1" title={feed.error ?? STATUS_TEXT[feed.status]}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[feed.status]}`} />
            <span className="min-w-0 flex-1 truncate tracking-[0.1em] text-fg-dim uppercase">{feed.title || feed.id}</span>
            <span className="shrink-0 text-fg-mute tabular-nums">{formatAge(now - feed.updatedAt!)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

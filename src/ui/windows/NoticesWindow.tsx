import { useState } from 'react'
import type { Notice } from '../../../shared/feeds'
import { locale, t } from '../../i18n'
import { formatAge } from '../../lib/format'
import { useFeed } from '../../runtime/useFeed'
import { useNow } from '../../runtime/useNow'
import { useFeeds } from '../../state/feeds'
import { Segmented } from '../kit'

const TABS = [
  { id: 'emergency', label: t('Emergency'), hint: t('Warnings to the public: evacuations, sirens, declared emergencies, severe weather') },
  { id: 'missing', label: t('Missing'), hint: t('Public appeals to help find missing people') },
] as const
type Tab = Notice['kind']

const SENT = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** A log of public alerts and appeals, newest first, each with who sent it and a link to their own words. */
export function NoticesWindow() {
  const [tab, setTab] = useState<Tab>('emergency')
  const feed = useFeed('notices', 'notices')
  const updatedAt = useFeeds((s) => s.feeds.notices?.updatedAt)
  const now = useNow(15_000)
  const rows = (feed?.items ?? []).filter((notice) => notice.kind === tab)

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px]">
      <div className="shrink-0 px-3 pt-2">
        <Segmented<Tab> label={t('Kind of alert')} value={tab} options={TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {rows.length === 0 && <p className="text-fg-mute">{feed ? t('Nothing in the last two weeks.') : t('Waiting for data…')}</p>}
        <ul className="divide-y divide-line/50">
          {rows.map((notice) => (
            <li key={notice.id} className="py-1.5">
              <p className="flex items-baseline gap-2 text-[9.5px] tracking-[0.12em] uppercase">
                <span className={notice.official ? 'text-ok' : 'text-fg-dim'} title={t('Sent by')}>
                  {notice.issuer}
                </span>
                <time dateTime={new Date(notice.at).toISOString()} className="ml-auto shrink-0 text-fg-mute tabular-nums">
                  {SENT.format(notice.at)}
                </time>
              </p>
              <a href={notice.link} lang={notice.lang} target="_blank" rel="noreferrer noopener" className="mt-0.5 block font-sans text-xs text-fg hover:text-accent">
                {notice.title}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-fg-mute">
          {tab === 'missing'
            ? t('Latvia has no AMBER Alert system and the police publish no feed, so these are appeals picked out of the headlines by keyword. Headline and link only; an appeal is dropped after two weeks.')
            : t('The Baltic states publish no machine-readable alert feed. These are orange and red weather warnings, and headlines picked out by keyword: not every one is an alert, and an alert can be missed.')}{' '}
          {updatedAt ? `${t('Last update')} ${formatAge(now - updatedAt)}.` : ''}
        </p>
      </div>
    </div>
  )
}

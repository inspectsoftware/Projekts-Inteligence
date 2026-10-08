import { useEffect, useState } from 'react'
import type { PoliticsItem } from '../../shared/feeds'
import { APP } from '../../shared/meta'
import { locale, t } from '../i18n'
import { formatAge } from '../lib/format'
import { fold } from '../lib/search'
import { useFeed } from '../runtime/useFeed'
import { useNow } from '../runtime/useNow'
import { useFeeds } from '../state/feeds'
import { finishBoot } from './boot'
import { Segmented } from './kit'

type Country = 'all' | PoliticsItem['country']
const COUNTRIES: readonly { id: Country; label: string; hint: string }[] = [
  { id: 'all', label: t('All'), hint: t('Every headline') },
  { id: 'LV', label: 'LV', hint: t('Latvian publishers') },
  { id: 'LT', label: 'LT', hint: t('Lithuanian publishers') },
  { id: 'EE', label: 'EE', hint: t('Estonian publishers') },
  { id: 'INT', label: 'INT', hint: t('Publishers covering the wider region') },
]

const clock = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Baltic politics as it is published: every headline, newest first, with its publisher and a link.
 * Nothing is rated, summarised or hidden; the filters only narrow what is already there.
 */
export function PoliticsPage() {
  const feed = useFeed('politics', 'politics')
  const updatedAt = useFeeds((s) => s.feeds.politics?.updatedAt)
  const status = useFeeds((s) => s.feeds.politics?.status)
  const now = useNow(1000)
  const [country, setCountry] = useState<Country>('all')
  const [officialOnly, setOfficialOnly] = useState(false)
  const [query, setQuery] = useState('')

  // The map takes the opening screen down when it is ready; here there is no map to wait for.
  useEffect(finishBoot, [])

  const wanted = fold(query.trim())
  const rows = (feed?.items ?? []).filter(
    (item) =>
      (country === 'all' || item.country === country) &&
      (!officialOnly || item.official) &&
      (!wanted || fold(`${item.title} ${item.publisher}`).includes(wanted)),
  )

  return (
    <div className="flex h-full flex-col bg-ink-950 font-mono text-[11px] text-fg-dim">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-ink-900 px-3 tracking-[0.14em] uppercase">
        <a href="/" className="font-semibold tracking-[0.3em] whitespace-nowrap text-fg-strong hover:text-accent">
          {APP.codename}
        </a>
        <h1 className="whitespace-nowrap text-fg">{t('Baltic politics')}</h1>
        <a href="/" className="ml-auto border border-line px-2 py-0.5 text-[10px] text-fg-mute hover:border-line-strong hover:text-fg">
          {t('Back to the map')}
        </a>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-2">
          <p className="font-sans text-xs leading-relaxed text-fg-dim">
            {t('Every political headline from the publishers read, newest first, in the publisher’s own words. Nothing is rated, summarised or left out.')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="min-w-56 flex-1">
              <Segmented<Country> label={t('Country')} value={country} options={COUNTRIES} onChange={setCountry} />
            </div>
            <button
              type="button"
              aria-pressed={officialOnly}
              title={t('Only what governments, parliaments and ministries published themselves')}
              onClick={() => setOfficialOnly(!officialOnly)}
              className={`border border-line px-2 py-1.5 text-[10px] tracking-[0.16em] uppercase hover:text-fg ${officialOnly ? 'bg-accent/15 text-accent' : 'bg-ink-850 text-fg-dim'}`}
            >
              {t('Official only')}
            </button>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Filter by word or publisher')}
              aria-label={t('Filter by word or publisher')}
              spellCheck={false}
              className="min-w-40 flex-1 border border-line bg-ink-850 px-2 py-1.5 text-fg placeholder:text-fg-mute focus:border-line-strong focus:outline-none"
            />
          </div>
          <p className="mt-2 flex gap-3 text-[10px] tracking-[0.12em] uppercase" aria-live="polite">
            <span className={status === 'error' ? 'text-danger' : status === 'stale' ? 'text-warn' : 'text-ok'}>
              {t('Last update')} {updatedAt ? formatAge(now - updatedAt) : '–'}
            </span>
            <span className="text-fg-mute">{t('{n} headlines', { n: rows.length })}</span>
          </p>
        </div>

        {rows.length > 0 ? (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((item) => (
              <li key={item.link} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-line/50 px-3 py-2 max-sm:grid-cols-1">
                <time dateTime={new Date(item.at).toISOString()} className="text-fg-mute tabular-nums">
                  {clock.format(item.at)}
                </time>
                <div className="min-w-0">
                  <a href={item.link} lang={item.lang} target="_blank" rel="noreferrer noopener" className="font-sans text-sm text-fg hover:text-accent">
                    {item.title}
                  </a>
                  <p className="mt-0.5 text-[10px] tracking-[0.12em] uppercase">
                    <span className={item.official ? 'text-ok' : 'text-fg-dim'}>{item.publisher}</span>
                    {item.official && <span className="ml-2 text-fg-mute">{t('official')}</span>}
                    <span className="ml-2 text-fg-mute">{item.country}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-3 text-fg-mute">{feed ? t('No headline matches these filters') : t('Waiting for data…')}</p>
        )}
      </div>
    </div>
  )
}

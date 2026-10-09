import { useEffect, useState } from 'react'
import { RADIO_CREDIT, type RadioBy, type RadioResponse, type RadioStation } from '../../../shared/radio'
import { t } from '../../i18n'
import { Segmented } from '../kit'

const BY = [
  { id: 'name', label: t('Name'), hint: t('Stations whose name has these words') },
  { id: 'country', label: t('Country'), hint: t('Stations in a country, by its English name') },
  { id: 'tag', label: t('Genre'), hint: t('Stations tagged with a genre, such as jazz or news') },
] as const

type Found = { state: 'idle' | 'searching' | 'failed' } | { state: 'done'; stations: RadioStation[] }

/** Looks for stations a moment after the typing stops. */
function useStations(by: RadioBy, query: string): Found {
  // The answer and the search it answers: one for an earlier search is not shown.
  const [answer, setAnswer] = useState<{ key: string; found: Found } | null>(null)
  const asked = query.trim()
  const key = `${by}:${asked}`

  useEffect(() => {
    if (asked.length < 2) return
    const setFound = (found: Found) => setAnswer({ key, found })
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/radio?${new URLSearchParams({ by, q: asked })}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<RadioResponse>) : Promise.reject(new Error(String(res.status)))))
        .then((body) => setFound({ state: 'done', stations: body.stations }))
        .catch(() => {
          if (!controller.signal.aborted) setFound({ state: 'failed' })
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [by, asked, key])

  if (asked.length < 2) return { state: 'idle' }
  return answer?.key === key ? answer.found : { state: 'searching' }
}

/** Radio stations anywhere in the world, found by name, country or genre, and played straight from the broadcaster. */
export function RadioWindow() {
  const [by, setBy] = useState<RadioBy>('name')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<RadioStation | null>(null)
  const [silent, setSilent] = useState(false)
  const found = useStations(by, query)

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px]">
      <div className="grid shrink-0 gap-1.5 border-b border-line p-2">
        <Segmented<RadioBy> label={t('Search by')} value={by} options={BY} onChange={setBy} />
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={60}
            placeholder={t('Search radio stations worldwide')}
            aria-label={t('Search radio stations worldwide')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border border-line bg-ink-850 px-2 py-1 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />
          {found.state === 'done' && (
            <span role="status" className="shrink-0 text-[10px] tracking-[0.12em] text-fg-mute uppercase tabular-nums">
              {t('Stations: {n}', { n: found.stations.length })}
            </span>
          )}
        </div>
        {playing && (
          <div className="grid gap-1">
            <p className="truncate text-[10px] tracking-[0.12em] text-accent uppercase">{playing.name}</p>
            {/* Remounted per station, so the old stream is dropped at once. */}
            <audio key={playing.id} src={playing.url} controls autoPlay onError={() => setSilent(true)} className="scheme-dark h-8 w-full" />
            {silent && (
              <p role="alert" className="text-[10px] text-warn">
                {t('This station cannot be played right now')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {found.state !== 'done' ? (
          <p className="p-3 text-fg-mute">
            {found.state === 'searching' ? t('Searching…') : found.state === 'failed' ? t('The station list cannot be reached right now') : t('Type at least two letters.')}
          </p>
        ) : found.stations.length === 0 ? (
          <p className="p-3 text-fg-mute">{t('No station matches')}</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {found.stations.map((station) => (
              <li key={station.id}>
                <button
                  type="button"
                  aria-pressed={station.id === playing?.id}
                  onClick={() => {
                    setSilent(false)
                    setPlaying(station)
                  }}
                  className={`block w-full px-3 py-1.5 text-left transition-colors ${station.id === playing?.id ? 'bg-accent/15' : 'hover:bg-ink-700'}`}
                >
                  <span className="block truncate font-sans text-xs text-fg">{station.name}</span>
                  <span className="block truncate text-[9.5px] tracking-[0.12em] text-fg-mute uppercase">
                    {[station.country, station.codec && `${station.codec}${station.bitrate ? ` ${station.bitrate}` : ''}`, ...station.tags].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="p-3 text-[10px] text-fg-mute">
          {t('Station list')}:{' '}
          <a href={RADIO_CREDIT.href} target="_blank" rel="noreferrer noopener" className="underline decoration-line-strong underline-offset-2 hover:text-accent">
            {RADIO_CREDIT.label}
          </a>
          . {t('The sound comes straight from the broadcaster and stops when this window is closed.')}
        </p>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { LEVEL_NAMES, regionLevel } from '../../../shared/escalation'
import type { EscalationLevel, IntelBrief, NewsItem } from '../../../shared/feeds'
import { lang, t } from '../../i18n'
import { formatAge } from '../../lib/format'
import { useFeed } from '../../runtime/useFeed'
import { useNow } from '../../runtime/useNow'
import { useFeeds } from '../../state/feeds'
import { type IntelCountry, type IntelSort, useIntel } from '../../state/intel'
import { Segmented } from '../kit'
import { type Row, rowsFor, sourcesOf } from './intel'

/** Colours by level: calm, noted, raised, then three weights of alarm. A routine headline's own badge and bar stay quiet. */
const TONE = [
  { text: 'text-ok', fill: 'bg-fg-mute', badge: 'border-line-strong text-fg-mute' },
  { text: 'text-accent', fill: 'bg-accent', badge: 'border-accent/50 text-accent' },
  { text: 'text-warn', fill: 'bg-warn', badge: 'border-warn/60 text-warn' },
  { text: 'text-danger', fill: 'bg-danger', badge: 'border-danger/70 text-danger' },
  { text: 'text-danger', fill: 'bg-danger', badge: 'border-danger/70 bg-danger/15 text-danger' },
  { text: 'text-danger', fill: 'bg-danger animate-pulse', badge: 'border-danger bg-danger text-ink-950' },
] as const

const LEVELS: readonly EscalationLevel[] = [0, 1, 2, 3, 4, 5]
const COUNTRIES = ['LV', 'LT', 'EE'] as const

const SORTS: readonly { id: IntelSort; label: string }[] = [
  { id: 'importance', label: t('Importance') },
  { id: 'latest', label: t('Latest') },
]

const FILTERS: readonly { id: IntelCountry; label: string; hint: string }[] = [
  { id: 'all', label: t('All'), hint: t('Every headline') },
  { id: 'LV', label: 'LV', hint: t('Headlines about Latvia') },
  { id: 'LT', label: 'LT', hint: t('Headlines about Lithuania') },
  { id: 'EE', label: 'EE', hint: t('Headlines about Estonia') },
]

const CHROME = 'text-[9.5px] tracking-[0.12em] uppercase'
/** A native menu dressed like the switches beside it: it holds six options in the room of one. */
const MENU = 'scheme-dark flex-1 border border-line bg-ink-850 px-1 py-1.5 text-[10px] tracking-[0.08em] text-fg-dim uppercase hover:text-fg'

function LevelBadge({ level }: { level: EscalationLevel }) {
  return (
    <span title={t(LEVEL_NAMES[level])} className={`shrink-0 border px-1 ${CHROME} ${TONE[level].badge}`}>
      L{level}
    </span>
  )
}

function Gauge({ level }: { level: EscalationLevel | null }) {
  return (
    <span
      role="meter"
      aria-label={t('Escalation level')}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={level ?? undefined}
      aria-valuetext={level === null ? t('Not known yet') : `${level}, ${t(LEVEL_NAMES[level])}`}
      className="flex shrink-0 gap-0.5"
    >
      {LEVELS.slice(1).map((step) => (
        <i key={step} className={`h-2.5 w-1.5 ${level !== null && step <= level ? TONE[level].fill : 'bg-line-strong'}`} />
      ))}
    </span>
  )
}

/** The rest of the brief: the developments it rests on, each with the headlines behind it, and a line per country. */
function Detail({ brief, items }: { brief: IntelBrief; items: readonly NewsItem[] }) {
  const own = brief.i18n?.[lang]
  return (
    <>
      <ul className="mt-2 grid gap-1.5">
        {brief.points.map((point, index) => (
          <li key={index} className="flex items-baseline gap-2">
            <LevelBadge level={point.level} />
            <p className="min-w-0 font-sans text-xs leading-relaxed text-fg">
              {own?.points[index] ?? point.text}
              {sourcesOf(point.links, items).map((item) => (
                <a
                  key={item.link}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-1.5 text-[10px] whitespace-nowrap text-fg-mute underline decoration-line-strong underline-offset-2 hover:text-accent"
                >
                  {item.publisher}
                </a>
              ))}
            </p>
          </li>
        ))}
      </ul>
      <dl className="mt-2 grid gap-1">
        {COUNTRIES.map((iso) => (
          <div key={iso} className="flex items-baseline gap-2">
            <dt className={`w-5 shrink-0 text-fg-mute ${CHROME}`}>{iso}</dt>
            <dd className="min-w-0 font-sans text-xs leading-relaxed text-fg-dim">{own?.countries[iso] ?? brief.countries[iso]?.text}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/**
 * The top of the window: the level, and the brief written about it. It takes up the same room
 * whether the brief has arrived or not, so the list underneath never moves when it does. The
 * whole summary, the key points and the per-country notes open on request.
 */
function Reading({ brief, items, now }: { brief: IntelBrief | undefined; items: readonly NewsItem[] | undefined; now: number }) {
  const [open, setOpen] = useState(false)
  const readAt = useFeeds((s) => s.feeds.news?.updatedAt)
  const level = brief?.level ?? (items ? regionLevel(items, now) : null)
  const ai = brief?.mode === 'ai'
  const writtenAt = brief?.generatedAt ?? readAt
  // The brief in the reader's language where the server wrote one, in English where it did not.
  const text = brief?.i18n?.[lang] ?? brief

  return (
    <section className="border-b border-line px-3 pt-2.5 pb-2">
      <div className="flex items-center gap-2">
        <Gauge level={level} />
        <h3 className={`min-w-0 flex-1 truncate text-[11px] tracking-[0.1em] uppercase ${level === null ? 'text-fg-mute' : TONE[level].text}`}>
          {level === null ? t('Standing by') : `L${level} ${t(LEVEL_NAMES[level])}`}
        </h3>
        <button
          type="button"
          aria-expanded={open}
          title={t('The whole brief: key points, and a line for each country')}
          disabled={!brief}
          onClick={() => setOpen(!open)}
          className={`shrink-0 text-fg-dim transition-colors hover:text-accent disabled:opacity-40 ${CHROME}`}
        >
          {open ? t('Less') : t('More')}
        </button>
      </div>

      <p className="mt-1.5 line-clamp-2 min-h-[2lh] font-sans text-xs font-medium text-fg">
        {text ? text.headline : items ? t('No brief has been written yet') : t('Waiting for data…')}
      </p>
      <p className={`mt-1 min-h-[2lh] font-sans text-xs leading-relaxed text-fg-dim ${open ? '' : 'line-clamp-2'}`}>
        {text ? text.summary : items ? t('Until one arrives, the level is worked out here from the rated headlines below.') : ''}
      </p>

      {open && brief && <Detail brief={brief} items={items ?? []} />}

      {/* One line whatever it says: wrapping here would move the list when the brief swaps "Rules" for "AI". */}
      <div className={`mt-1.5 flex items-center gap-3 ${CHROME}`}>
        {COUNTRIES.map((iso) => {
          const own = brief?.countries[iso]?.level ?? (items ? regionLevel(items, now, iso) : null)
          return (
            <span key={iso} className="shrink-0 text-fg-mute">
              {iso} <span className={own === null ? '' : TONE[own].text}>{own === null ? '–' : `L${own}`}</span>
            </span>
          )
        })}
        <span className="ml-auto min-w-0 truncate text-fg-mute">
          <span
            title={ai ? t('Written by a language model from these headlines') : t('Worked out by keyword rules, without a language model')}
            className={`mr-1.5 border px-1 ${ai ? 'border-accent/50 text-accent' : 'border-line-strong text-fg-dim'}`}
          >
            {ai ? t('AI') : t('Rules')}
          </span>
          {writtenAt ? formatAge(now - writtenAt) : '–'}
        </span>
      </div>
    </section>
  )
}

function Headline({ row, now }: { row: Row; now: number }) {
  // A tag in plain words is the text the translators were given (TAG_WORDS).
  const notes = [...row.tags.map((tag) => t(tag.replaceAll('_', ' '))), ...(row.corroboration > 0 ? [t('also reported by {n}', { n: row.corroboration })] : [])]
  return (
    <li className="border-b border-line/50 px-3 py-2 last:border-0">
      <div className={`flex items-center gap-2 ${CHROME}`}>
        <LevelBadge level={row.escalation} />
        <span title={t('Importance, 0 to 100')} className="w-6 shrink-0 text-right text-fg tabular-nums">
          {row.importance}
        </span>
        <span className="h-0.5 min-w-4 flex-1 bg-line">
          <span className={`block h-full ${TONE[row.escalation].fill}`} style={{ width: `${row.importance}%` }} />
        </span>
        <span className="max-w-[40%] truncate text-fg-dim">{row.publisher}</span>
        <span className="shrink-0 text-fg-mute tabular-nums">{formatAge(now - row.at)}</span>
      </div>
      <a href={row.link} lang={row.lang} target="_blank" rel="noreferrer noopener" className="mt-1 block font-sans text-xs text-fg hover:text-accent">
        {row.title}
      </a>
      {row.summary && (
        <p className="mt-0.5 font-sans text-xs leading-relaxed text-fg-dim">
          {/* Marked, so a model's sentence is never taken for the publisher's. */}
          <span title={t('Summary written by a language model')} className={`mr-1.5 border border-accent/50 px-1 font-mono text-accent ${CHROME}`}>
            {t('AI')}
          </span>
          {row.summary}
        </p>
      )}
      {notes.length > 0 && <p className={`mt-1 text-fg-mute ${CHROME}`}>{notes.join(' · ')}</p>}
    </li>
  )
}

/** The region's level and brief, then every headline behind them, ranked. The body of the Intel feed window. */
export function IntelWindow() {
  const news = useFeed('news', 'news')
  const brief = useFeed('brief', 'brief')
  const now = useNow(60_000)
  const { sort, country, minLevel, setSort, setCountry, setMinLevel } = useIntel()
  const rows = rowsFor(news?.items ?? [], brief?.ratings, { sort, country, minLevel })

  return (
    <div className="text-[11px]">
      <Reading brief={brief} items={news?.items} now={now} />
      {/* Stays in reach while the list scrolls. One row where there is room; the two menus drop below it in a narrow window. */}
      <div className="sticky top-0 z-10 flex flex-wrap gap-1.5 border-b border-line bg-ink-900 px-3 py-1.5">
        <div className="min-w-32 flex-1">
          <Segmented<IntelCountry> label={t('Country')} value={country} options={FILTERS} onChange={setCountry} />
        </div>
        <div className="flex flex-1 gap-1.5">
          <select aria-label={t('Order')} title={t('Order')} value={sort} onChange={(event) => setSort(event.target.value as IntelSort)} className={MENU}>
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Lowest level shown')}
            title={t('Lowest level shown')}
            value={minLevel}
            onChange={(event) => setMinLevel(Number(event.target.value) as EscalationLevel)}
            className={MENU}
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {`L${level}${level < 5 ? '+' : ''}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul>
          {rows.map((row) => (
            <Headline key={row.link} row={row} now={now} />
          ))}
        </ul>
      ) : (
        <p className="p-3 text-fg-mute">{news ? t('No headline matches these filters') : t('Waiting for data…')}</p>
      )}
    </div>
  )
}

import { type ReactNode, Suspense, use } from 'react'
import {
  COUNTRY_CODES,
  type CountryCode,
  type CountryFact,
  type CountryFile,
  type ForceNote,
  formatFact,
  formatYear,
} from '../../../shared/countries'
import { lang, locale, t } from '../../i18n'
import { formatAge } from '../../lib/format'
import { useFeed } from '../../runtime/useFeed'
import { useNow } from '../../runtime/useNow'
import { COUNTRY_TABS, type CountryTab, useCountry } from '../../state/country'
import { SectionTitle, Segmented } from '../kit'

const names = new Intl.DisplayNames([locale], { type: 'region' })
const COUNTRIES = COUNTRY_CODES.map((id) => ({ id, label: id, hint: names.of(id) ?? id }))

const SECTIONS = [
  { id: 'overview', title: t('Overview') },
  { id: 'defence', title: t('Defence') },
  { id: 'military', title: t('Military') },
  { id: 'economy', title: t('Economy') },
  { id: 'risks', title: t('Risks') },
] as const

let facts: Promise<CountryFile | null> | undefined

/**
 * The fact file is some 90 kB that nobody needs until one of the figure tabs is opened,
 * so it is its own chunk, fetched then and once.
 */
function loadFacts(): Promise<CountryFile | null> {
  facts ??= import('../../../shared/data/countries.json').then(
    (module): CountryFile => module.default,
    () => null,
  )
  return facts
}

const Note = ({ children }: { children: ReactNode }) => <p className="py-2 text-fg-mute">{children}</p>

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-line-strong underline-offset-2 hover:text-accent">
      {children}
    </a>
  )
}

function Brief({ country }: { country: CountryCode }) {
  const payload = useFeed('country-briefs', 'country-briefs')
  const now = useNow(60_000)
  const brief = payload?.briefs[country]
  // With a model the first writing after a restart takes a minute or two; without one it is immediate.
  if (!payload || !brief) return <Note>{t('Writing the briefs… The figures are in the other tabs meanwhile.')}</Note>
  const ai = (brief.mode ?? payload.mode) === 'ai'
  // In the reader's language where the server wrote it, in English where it did not.
  const text = brief.i18n?.[lang] ?? brief

  return (
    <>
      <p className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[10px] text-fg-mute">
        <span
          title={ai ? t('Written by a language model') : t('Written by template, without a language model')}
          className={`border px-1 tracking-[0.16em] uppercase ${ai ? 'border-accent/50 text-accent' : 'border-line-strong text-fg-dim'}`}
        >
          {ai ? t('AI') : t('Rules')}
        </span>
        <span>{formatAge(now - payload.generatedAt)}</span>
        <span>{t('Written from the cited figures in the other tabs.')}</span>
      </p>
      {SECTIONS.map(({ id, title }) => (
        <section key={id} className="mb-3 last:mb-0">
          <SectionTitle>{title}</SectionTitle>
          {text[id].split('\n\n').map((paragraph) => (
            <p key={paragraph} className="mb-1.5 font-sans text-xs leading-relaxed text-fg">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </>
  )
}

function FactRow({ fact }: { fact: CountryFact }) {
  return (
    <li className="border-b border-line/50 py-1.5 last:border-0">
      {/* A long value, a head of government with a footnote say, wraps onto a line of its own. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {/* The labels the countries share are translated (FACT_WORDS); one written for a single country stays as the file has it. */}
        <span className="text-fg-dim">{t(fact.label)}</span>
        <span className="ml-auto text-right text-fg tabular-nums">
          {formatFact(fact, t)}
          {fact.rank !== undefined && ` · ${t('rank {rank}', { rank: fact.rank })}`}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-fg-mute">
        {formatYear(fact.year, t)} · <Source href={fact.url}>{fact.source}</Source>
      </div>
    </li>
  )
}

function ForceRow({ note }: { note: ForceNote }) {
  return (
    <li className="border-b border-line/50 py-2 last:border-0">
      <h3 className="text-[10px] tracking-[0.12em] text-fg-dim uppercase">{t(note.label)}</h3>
      <p className="mt-1 font-sans text-xs leading-relaxed text-fg">{note.text}</p>
      <div className="mt-1 text-[10px] text-fg-mute">
        {t('As of {date}', { date: note.asOf })} · <Source href={note.url}>{new URL(note.url).hostname.replace(/^www\./, '')}</Source>
      </div>
    </li>
  )
}

function Facts({ country, tab }: { country: CountryCode; tab: Exclude<CountryTab, 'brief'> }) {
  const file = use(loadFacts())
  const profile = file?.countries[country]
  if (!file || !profile) return <Note>{t('The figures could not be loaded. Reload the page to try again.')}</Note>
  if (tab === 'forces' && profile.forces.length === 0) return <Note>{t('No sourced entries are held for {name}.', { name: names.of(country) ?? profile.name })}</Note>

  return (
    <>
      <ul>
        {tab === 'forces'
          ? profile.forces.map((note) => <ForceRow key={note.label} note={note} />)
          : profile[tab === 'economy' ? 'facts' : 'defence'].map((fact) => <FactRow key={fact.key} fact={fact} />)}
      </ul>
      <p className="mt-2 text-[10px] text-fg-mute">
        {t('Collected by hand on {date}; each row links to where its figure came from.', { date: file.generatedAt.slice(0, 10) })}
      </p>
    </>
  )
}

/** One country at a time: a written brief, and the sourced figures it is written from. */
export function CountryWindow() {
  const country = useCountry((s) => s.country)
  const tab = useCountry((s) => s.tab)
  const setCountry = useCountry((s) => s.setCountry)
  const setTab = useCountry((s) => s.setTab)

  return (
    <>
      <div className="grid shrink-0 gap-2 px-3 pt-3">
        <Segmented<CountryCode> label={t('Country')} value={country} options={COUNTRIES} onChange={setCountry} />
        <Segmented<CountryTab> label={t('Section')} value={tab} options={COUNTRY_TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 overflow-y-auto p-3 text-[11px]">
        {tab === 'brief' ? (
          <Brief country={country} />
        ) : (
          <Suspense fallback={<Note>{t('Loading the figures…')}</Note>}>
            <Facts country={country} tab={tab} />
          </Suspense>
        )}
      </div>
    </>
  )
}

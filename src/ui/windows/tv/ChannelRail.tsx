import { type Air, airOf, linkOf } from '../../../../shared/adapters/tv'
import type { TvNow } from '../../../../shared/feeds'
import { BALTIC_TIME, TV_CHANNELS, type TvChannel, type TvCountry } from '../../../../shared/media/tv'
import { useNow } from '../../../runtime/useNow'
import { SectionTitle } from '../../kit'
import { useTv } from './store'

const COUNTRIES: readonly (readonly [TvCountry, string])[] = [
  ['LV', 'Latvia'],
  ['LT', 'Lithuania'],
  ['EE', 'Estonia'],
  ['INT', 'International'],
]

const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: BALTIC_TIME, hour: '2-digit', minute: '2-digit', hour12: false })

/** The dot and the colour of the tag for each state. A hollow dot is a channel that is not known to be on. */
const LOOK: Record<Air, { dot: string; tag: string }> = {
  live: { dot: 'bg-ok', tag: 'text-ok' },
  next: { dot: 'bg-accent', tag: 'text-accent' },
  today: { dot: 'bg-accent', tag: 'text-accent' },
  off: { dot: 'border border-line-strong', tag: 'text-fg-mute' },
  unknown: { dot: 'border border-line-strong', tag: 'text-fg-mute' },
  link: { dot: '', tag: 'text-fg-mute' },
}

/** The few letters shown beside a channel, and the same in full for the tooltip and for screen readers. */
function describe(channel: TvChannel, air: Air, now: TvNow | undefined): { tag: string; say: string } {
  switch (air) {
    case 'live':
      return channel.schedule ? { tag: 'On air', say: 'on air now' } : { tag: '24/7', say: 'on air round the clock' }
    case 'next': {
      const at = TIME.format(now!.from)
      return { tag: at, say: `starts at ${at}, Riga time` }
    }
    case 'today':
      return { tag: 'Today', say: 'a broadcast is listed for today' }
    case 'off':
      return { tag: 'Off air', say: now?.videoId ? 'not on air; the latest broadcast is shown' : 'not on air' }
    case 'unknown':
      return { tag: 'Sched', say: 'on a schedule; whether it is on air right now is not known' }
    case 'link':
      return { tag: 'Site ↗', say: 'opens the broadcaster’s own site in a new tab' }
  }
}

const ROW = 'flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-ink-700'

/** The channels by country, each with what is known about it right now. A channel without a player is a link out. */
export function ChannelRail({ lookups, selected }: { lookups: ReadonlyMap<string, TvNow>; selected: string | undefined }) {
  const watch = useTv((s) => s.watch)
  // Often enough for a bulletin to turn from its start time into "on air" by itself.
  const clock = useNow(30_000)

  const row = (channel: TvChannel) => {
    const now = lookups.get(channel.id)
    const air = airOf(channel, now, clock)
    const { tag, say } = describe(channel, air, now)
    const label = `${channel.name} (${channel.lang.toUpperCase()}): ${say}`
    const parts = (
      <>
        <i aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${LOOK[air].dot}`} />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        <span className={`shrink-0 text-[9px] tracking-[0.12em] uppercase ${LOOK[air].tag}`}>{tag}</span>
      </>
    )
    if (air === 'link') {
      return (
        <a href={linkOf(channel, now)} target="_blank" rel="noreferrer noopener" title={label} aria-label={label} className={`${ROW} text-fg-dim hover:text-fg`}>
          {parts}
        </a>
      )
    }
    const current = channel.id === selected
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-current={current || undefined}
        onClick={() => watch(channel.id)}
        className={`${ROW} ${current ? 'bg-accent/12 text-accent' : 'text-fg'}`}
      >
        {parts}
      </button>
    )
  }

  return (
    <nav
      aria-label="Channels"
      className="order-first min-h-0 w-[40%] max-w-44 shrink-0 overflow-y-auto border-r border-line p-2 max-md:portrait:order-none max-md:portrait:w-auto max-md:portrait:max-w-none max-md:portrait:flex-1 max-md:portrait:border-t max-md:portrait:border-r-0"
    >
      {COUNTRIES.map(([country, name]) => (
        <section key={country} className="mb-2 last:mb-0">
          <SectionTitle>{name}</SectionTitle>
          <ul>
            {TV_CHANNELS.filter((channel) => channel.country === country).map((channel) => (
              <li key={channel.id}>{row(channel)}</li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

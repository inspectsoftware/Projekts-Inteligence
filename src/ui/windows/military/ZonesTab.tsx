import { isCurrent, zoneState } from '../../../../shared/adapters/zones'
import type { FeedId, Zone } from '../../../../shared/feeds'
import { showZone } from '../../../layers/zones'
import { useFeed } from '../../../runtime/useFeed'
import { useNow } from '../../../runtime/useNow'
import { SectionTitle } from '../../kit'
import { Credits } from './parts'

const RIGA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Sources with no licence to reuse their data, or no feed at all: a link is all that can be offered. */
const ELSEWHERE = [
  { href: 'https://gpsjam.org', label: 'gpsjam.org', what: 'yesterday’s GPS interference, mapped from aircraft reports' },
  { href: 'https://www.navtex.lv', label: 'navtex.lv', what: 'NAVTEX broadcasts as received in Latvia, unedited' },
  { href: 'https://notice.lja.lv/map_changes.php', label: 'Notices to Mariners', what: 'Latvia’s own, from the Maritime Administration, monthly' },
] as const

const ROW = 'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-1 py-1 text-left transition-colors hover:bg-ink-700'

/** When, in a few words. Only a zone known to apply at this moment gets an "until". */
function when(zone: Zone, now: number): string {
  switch (zoneState(zone, now)) {
    case 'active':
      return zone.to === null ? 'until withdrawn' : `until ${RIGA_TIME.format(zone.to)}`
    case 'pending':
      return `from ${RIGA_TIME.format(zone.from!)}`
    case 'idle':
      return 'outside its hours'
    case 'unsure':
      return 'see notice for times'
  }
}

function ZoneRow({ zone, now }: { zone: Zone; now: number }) {
  const head = (
    <>
      <span className="truncate text-fg">
        {zone.title}
        <span className={`ml-2 text-[9.5px] tracking-[0.12em] uppercase ${zone.military ? 'text-mil' : 'text-fg-mute'}`}>{zone.type}</span>
      </span>
      <span className={`text-right text-[10px] whitespace-nowrap ${zoneState(zone, now) === 'active' ? 'text-warn' : 'text-fg-dim'}`}>
        {when(zone, now)}
      </span>
      <span className="col-span-2 truncate text-[10px] text-fg-dim">{zone.issuer}</span>
    </>
  )
  // A notice that names no place has nowhere to fly to: it opens where it stands instead.
  if (!zone.point) {
    return (
      <li>
        <details>
          <summary title="Read the notice" className={`${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            {head}
          </summary>
          <p className="px-1 pb-2 text-[10px] whitespace-pre-line text-fg-dim">{zone.text}</p>
        </details>
      </li>
    )
  }
  return (
    <li>
      <button type="button" onClick={() => showZone(zone)} title="Show on the map" className={ROW}>
        {head}
      </button>
    </li>
  )
}

const Rows = ({ zones, now }: { zones: Zone[]; now: number }) => (
  <ul className="divide-y divide-line/50">
    {zones.map((zone) => (
      <ZoneRow key={zone.id} zone={zone} now={now} />
    ))}
  </ul>
)

function Section({ title, feed, empty, now }: { title: string; feed: FeedId; empty: string; now: number }) {
  // Polled for as long as the tab is shown, whether or not the layer is on.
  const payload = useFeed(feed, 'zones')
  // The feed is some minutes old: what has run out since is dropped here.
  const zones = payload?.zones.filter((zone) => isCurrent(zone, now)) ?? []
  // The feed lists military ones first, in the order they take effect; what is in force goes ahead of what is coming.
  const inForce = (zone: Zone) => zoneState(zone, now) === 'active'
  const first = (list: Zone[]) => [...list.filter(inForce), ...list.filter((zone) => !inForce(zone))]
  const military = first(zones.filter((zone) => zone.military))
  const routine = first(zones.filter((zone) => !zone.military))

  return (
    <section className="mb-3">
      <SectionTitle>{title}</SectionTitle>
      {!payload ? (
        <p className="text-fg-mute">Waiting for data…</p>
      ) : (
        <>
          {military.length === 0 ? <p className="text-fg-mute">{empty}</p> : <Rows zones={military} now={now} />}
          {routine.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer px-1 py-1 text-[10px] tracking-[0.12em] text-fg-mute uppercase hover:text-fg">
                {routine.length} routine
              </summary>
              <Rows zones={routine} now={now} />
            </details>
          )}
        </>
      )}
      <Credits feed={feed} />
    </section>
  )
}

/** What is announced: exercise and firing areas at sea, airspace closed by NOTAM. In force now, or starting within two days. */
export function ZonesTab() {
  const now = useNow(60_000)
  return (
    <>
      <Section title="At sea" feed="navwarn" empty="No exercise, firing or danger area is announced." now={now} />
      <Section title="In the air" feed="airspace" empty="No military airspace is activated." now={now} />
      <p className="text-[10px] text-fg-mute">
        Times are Rīga time. The Baltic’s sea warnings come through Sweden, Russian exercise areas included; airspace covers Latvia and
        Estonia only, as Lithuania publishes nothing this site can read. Not for navigation or flight planning.
      </p>
      <ul className="mt-2 text-[10px] text-fg-mute">
        {ELSEWHERE.map((link) => (
          <li key={link.href}>
            <a href={link.href} target="_blank" rel="noreferrer noopener" className="text-fg-dim underline decoration-line-strong underline-offset-2 hover:text-accent">
              {link.label} ↗
            </a>{' '}
            {link.what}
          </li>
        ))}
      </ul>
    </>
  )
}

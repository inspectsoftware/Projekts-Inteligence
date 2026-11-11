import { useEffect, useRef } from 'react'
import { locale, t } from '../i18n'
import { useTrip } from '../runtime/trip'
import { useNow } from '../runtime/useNow'

const CLOCK = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false })

function delayText(delay: number): string {
  const minutes = Math.round(Math.abs(delay) / 60)
  if (minutes === 0) return t('On time')
  return delay > 0 ? t('{n} min late', { n: minutes }) : t('{n} min early', { n: minutes })
}

/**
 * The selected vehicle's trip, stop by stop, as a stop's display shows it: the stops already
 * passed with their timetable time, the ones ahead with how many minutes until it gets there.
 * Under the Inspector's facts, for buses, trams and trains whose timetable is known.
 */
export function TripTimeline({ id }: { id: string }) {
  const { id: asked, answer, status } = useTrip()
  const now = useNow(15_000)
  const nextRef = useRef<HTMLLIElement>(null)
  const next = answer?.next

  // Brings the next stop into view when the card opens and as the vehicle moves on.
  useEffect(() => {
    nextRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [id, next])

  if (asked !== id) return null
  if (status === 'loading') return <p className="px-3 py-3 font-sans text-xs text-fg-mute">{t('Finding its trip in the timetable…')}</p>
  if (!answer) return status === 'none' ? <p className="px-3 py-3 font-sans text-xs text-fg-mute">{t('No timetable trip for this vehicle')}</p> : null

  const late = answer.delay > 60 ? 'text-warn' : 'text-ok'
  return (
    <section className="border-t border-line font-sans">
      <header className="flex items-baseline justify-between gap-3 px-3 pt-3 pb-1">
        <h3 className="text-sm font-semibold text-fg-strong">
          {answer.route && <span className="mr-1.5">{answer.route}</span>}
          {t('To {stop}', { stop: answer.headsign })}
        </h3>
        <span className={`shrink-0 text-xs ${late}`}>{delayText(answer.delay)}</span>
      </header>
      {answer.name && answer.name !== answer.headsign && <p className="px-3 pb-2 text-xs text-fg-mute">{answer.name}</p>}
      <ol className="px-3 pb-3">
        {answer.stops.map((stop, i) => {
          const passed = i < answer.next
          const minutes = Math.round((stop.at + answer.delay * 1000 - now) / 60_000)
          const last = i === answer.stops.length - 1
          return (
            <li key={`${i}-${stop.name}`} ref={i === answer.next ? nextRef : undefined} className="relative flex items-center gap-3 py-1.5 pl-6 text-[13px]">
              {/* The line through the stops, and each stop's ring on it. */}
              {!last && <i aria-hidden="true" className={`absolute top-1/2 left-[7px] h-full w-0.5 ${i < answer.next - 1 ? 'bg-line-strong' : 'bg-accent/60'}`} />}
              <i
                aria-hidden="true"
                className={`absolute top-1/2 left-0.5 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-ink-900 ${
                  passed ? 'border-line-strong' : i === answer.next ? 'border-accent bg-accent' : 'border-accent'
                }`}
              />
              <span className={`min-w-0 flex-1 truncate ${passed ? 'text-fg-mute' : i === answer.next ? 'font-semibold text-fg-strong' : 'text-fg'}`}>{stop.name}</span>
              <span className={`shrink-0 tabular-nums ${passed ? 'text-fg-mute' : 'text-ok'}`}>
                {passed ? CLOCK.format(stop.at) : minutes <= 0 ? t('now') : t('in {n} min', { n: minutes })}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

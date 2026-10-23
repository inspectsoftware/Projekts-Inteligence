import { useEffect, useRef, useState } from 'react'
import { HISTORY_FEEDS, type HistoryFeedId, type HistoryIndex } from '../../shared/history'
import { msg } from '../../shared/i18n'
import { locale, t } from '../i18n'
import { fetchHistoryFrame, fetchHistoryIndex } from '../runtime/api'
import { useNow } from '../runtime/useNow'
import { frameTime, useRewind } from '../state/rewind'

const STEP_MS = 60_000
/** Dragged this close to the right end, the map goes back to live. */
const LIVE_WITHIN_MS = 90_000
/** Dragging asks for frames once it stops for this long, not on every pixel. */
const SETTLE_MS = 200
/** Playing shows one recorded minute this often: six hours in three minutes. */
const PLAY_TICK_MS = 500
/** Frames further apart than this have a gap between them: nobody was watching. */
const GAP_MS = 3 * STEP_MS

const TIME = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false })

/** The graph's lines: what an analyst would look for a spike in, one feed each. */
const SERIES: { id: HistoryFeedId; colour: string; peak: string }[] = [
  { id: 'aircraft-mil', colour: 'var(--color-mil)', peak: msg('Most military aircraft: {n} at {time}') },
  { id: 'gps-hex', colour: 'var(--color-danger)', peak: msg('Most heavily jammed GPS cells: {n} at {time}') },
  { id: 'ships', colour: 'var(--color-accent)', peak: msg('Most military or sanctioned ships: {n} at {time}') },
]

/** Every recorded minute, oldest first: the feeds' frames are made milliseconds apart, so one per minute. */
function minutes(index: HistoryIndex | null): number[] {
  const all = HISTORY_FEEDS.flatMap((id) => index?.feeds[id] ?? []).sort((a, b) => a - b)
  return all.filter((time, i) => i === 0 || time - all[i - 1] >= STEP_MS / 2)
}

/** One feed's activity as an SVG path over 0..100 × 0..100, broken where nobody was watching. */
function path(times: number[], values: number[], start: number, span: number): string {
  const top = Math.max(1, ...values)
  return times
    .map((time, i) => {
      const x = (((time - start) / span) * 100).toFixed(2)
      const y = (100 - (values[i] / top) * 90).toFixed(1)
      return `${i === 0 || time - times[i - 1] > GAP_MS ? 'M' : 'L'}${x} ${y}`
    })
    .join('')
}

/**
 * The bar above the taskbar that winds the aircraft, ships and GPS interference back over the
 * hours the server has kept. Behind the slider, a graph of each feed's activity, with its peak
 * marked to jump to; Play runs the record forward. At the right end the map is live again.
 */
export function RewindBar() {
  const open = useRewind((s) => s.open)
  const at = useRewind((s) => s.at)
  const index = useRewind((s) => s.index)
  const now = useNow(STEP_MS)
  const [draft, setDraft] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const load = () => void fetchHistoryIndex(controller.signal).then(useRewind.getState().setIndex, () => {})
    load()
    const timer = setInterval(load, STEP_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
      setPlaying(false)
    }
  }, [open])

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current)
  }, [])

  // Each minute's frames are fetched before the map moves on to them, so a slow line slows the
  // playing down rather than skipping frames it never had time to draw.
  useEffect(() => {
    if (!playing) return
    const controller = new AbortController()
    void (async () => {
      while (!controller.signal.aborted) {
        const tick = performance.now()
        const { at: from, index: known } = useRewind.getState()
        const all = minutes(known)
        const next = from === null ? all[0] : all.find((time) => time > from)
        if (next === undefined) {
          setPlaying(false)
          useRewind.getState().setAt(null)
          return
        }
        await Promise.all(HISTORY_FEEDS.map((id) => fetchHistoryFrame(id, frameTime(known, id, next), controller.signal).catch(() => undefined)))
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, PLAY_TICK_MS - (performance.now() - tick))))
        if (!controller.signal.aborted) useRewind.getState().setAt(next)
      }
    })()
    return () => controller.abort()
  }, [playing])

  if (!open) return null

  const times = minutes(index)
  const start = times[0] ?? now
  // A whole number of steps from the start, or the slider's right end is a value it cannot take.
  const span = Math.max(1, Math.ceil((Math.max(now, ...times) - start) / STEP_MS)) * STEP_MS
  const end = start + span
  const shown = draft ?? at ?? end
  const live = at === null && draft === null

  const goTo = (value: number | null) => {
    if (settle.current) clearTimeout(settle.current)
    setDraft(null)
    useRewind.getState().setAt(value)
  }
  const pick = (value: number) => {
    setPlaying(false)
    setDraft(value)
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => goTo(value >= end - LIVE_WITHIN_MS ? null : value), SETTLE_MS)
  }

  const peaks = SERIES.flatMap(({ id, colour, peak }) => {
    const values = index?.activity[id] ?? []
    const top = Math.max(0, ...values)
    if (top === 0) return []
    const time = index!.feeds[id][values.indexOf(top)]
    return [{ id, colour, time, title: t(peak, { n: top, time: TIME.format(time) }) }]
  })

  return (
    <div
      role="group"
      aria-label={t('Rewind')}
      className="pointer-events-auto absolute inset-x-0 bottom-11 z-20 flex h-12 items-center gap-3 border-t border-line bg-ink-900/90 px-4 font-mono text-xs backdrop-blur-md"
    >
      <button
        type="button"
        disabled={times.length === 0}
        aria-pressed={playing}
        title={playing ? t('Pause') : t('Play')}
        aria-label={playing ? t('Pause') : t('Play')}
        onClick={() => setPlaying(!playing)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded border border-line text-fg-dim enabled:hover:bg-ink-700 enabled:hover:text-fg disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d={playing ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M5 3l8 5-8 5z'} />
        </svg>
      </button>
      <span className={`w-12 shrink-0 tabular-nums ${live ? 'text-ok' : 'text-warn'}`}>{live ? t('Live') : TIME.format(shown)}</span>
      {times.length === 0 ? (
        <span className="min-w-0 flex-1 truncate text-fg-mute">{t('Nothing recorded yet: the server keeps a frame a minute while someone is watching')}</span>
      ) : (
        <div className="relative h-full min-w-0 flex-1">
          {/* Each feed's activity, scaled to its own peak; a break in the lines is time nobody was watching. */}
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-1 h-7 w-full">
            {SERIES.map(({ id, colour }) => (
              <path
                key={id}
                d={path(index?.feeds[id] ?? [], index?.activity[id] ?? [], start, span)}
                fill="none"
                stroke={colour}
                strokeOpacity={0.7}
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {peaks.map(({ id, colour, time, title }) => (
            <button
              key={id}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => {
                setPlaying(false)
                goTo(time)
              }}
              className="absolute top-0 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-ink-900 hover:scale-150"
              style={{ left: `${((time - start) / span) * 100}%`, background: colour }}
            />
          ))}
          <input
            type="range"
            aria-label={t('Rewind time')}
            aria-valuetext={live ? t('Live') : TIME.format(shown)}
            min={start}
            max={end}
            step={STEP_MS}
            value={Math.min(end, Math.max(start, shown))}
            onChange={(event) => pick(Number(event.target.value))}
            className="absolute inset-x-0 bottom-0.5 w-full accent-[var(--color-accent)]"
          />
        </div>
      )}
      <span className="shrink-0 tabular-nums text-fg-mute max-sm:hidden">{TIME.format(start)}–{TIME.format(end)}</span>
      <button
        type="button"
        disabled={live}
        onClick={() => {
          setPlaying(false)
          goTo(null)
        }}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-fg-dim enabled:hover:bg-ink-700 enabled:hover:text-fg disabled:opacity-40"
      >
        {t('Back to live')}
      </button>
    </div>
  )
}

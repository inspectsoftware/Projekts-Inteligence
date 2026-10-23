import { useEffect, useRef, useState } from 'react'
import { HISTORY_FEEDS } from '../../shared/history'
import { locale, t } from '../i18n'
import { fetchHistoryIndex } from '../runtime/api'
import { useNow } from '../runtime/useNow'
import { useRewind } from '../state/rewind'

const STEP_MS = 60_000
/** Dragged this close to the right end, the map goes back to live. */
const LIVE_WITHIN_MS = 90_000
/** Dragging asks for frames once it stops for this long, not on every pixel. */
const SETTLE_MS = 200

const TIME = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * The bar above the taskbar that winds the aircraft, ships and GPS interference back over the
 * hours the server has kept. Dragged to the right end, or with Live pressed, the map is live again.
 */
export function RewindBar() {
  const open = useRewind((s) => s.open)
  const at = useRewind((s) => s.at)
  const index = useRewind((s) => s.index)
  const now = useNow(STEP_MS)
  const [draft, setDraft] = useState<number | null>(null)
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
    }
  }, [open])

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current)
  }, [])

  if (!open) return null

  const times = HISTORY_FEEDS.flatMap((id) => index?.feeds[id] ?? [])
  const start = times.length > 0 ? Math.min(...times) : now
  // A whole number of steps from the start, or the slider's right end is a value it cannot take.
  const span = Math.max(1, Math.ceil((Math.max(now, ...times) - start) / STEP_MS)) * STEP_MS
  const end = start + span
  const shown = draft ?? at ?? end
  const live = at === null && draft === null

  const pick = (value: number) => {
    setDraft(value)
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      setDraft(null)
      useRewind.getState().setAt(value >= end - LIVE_WITHIN_MS ? null : value)
    }, SETTLE_MS)
  }

  return (
    <div
      role="group"
      aria-label={t('Rewind')}
      className="pointer-events-auto absolute inset-x-0 bottom-11 z-20 flex h-10 items-center gap-3 border-t border-line bg-ink-900/90 px-4 font-mono text-xs backdrop-blur-md"
    >
      <span className={`w-12 shrink-0 tabular-nums ${live ? 'text-ok' : 'text-warn'}`}>{live ? t('Live') : TIME.format(shown)}</span>
      {times.length === 0 ? (
        <span className="min-w-0 flex-1 truncate text-fg-mute">{t('Nothing recorded yet: the server keeps a frame a minute while someone is watching')}</span>
      ) : (
        <div className="relative min-w-0 flex-1">
          {/* Where there are frames: the gaps are times nobody was watching. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2">
            {times.map((time) => (
              <i key={time} className="absolute h-1 w-px bg-accent/50" style={{ left: `${((time - start) / span) * 100}%` }} />
            ))}
          </div>
          <input
            type="range"
            aria-label={t('Rewind time')}
            aria-valuetext={live ? t('Live') : TIME.format(shown)}
            min={start}
            max={end}
            step={STEP_MS}
            value={Math.min(end, Math.max(start, shown))}
            onChange={(event) => pick(Number(event.target.value))}
            className="relative w-full accent-[var(--color-accent)]"
          />
        </div>
      )}
      <span className="shrink-0 tabular-nums text-fg-mute max-sm:hidden">{TIME.format(start)}–{TIME.format(end)}</span>
      <button
        type="button"
        disabled={live}
        onClick={() => {
          setDraft(null)
          useRewind.getState().setAt(null)
        }}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-fg-dim enabled:hover:bg-ink-700 enabled:hover:text-fg disabled:opacity-40"
      >
        {t('Back to live')}
      </button>
    </div>
  )
}

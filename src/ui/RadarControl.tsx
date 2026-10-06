import { locale, t } from '../i18n'
import { useRadar } from '../state/radar'

const TIME = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false })

/** Timeline for the rain radar: step through the last two hours, or play them as a loop. The body of the Radar window. */
export function RadarControl() {
  const frames = useRadar((s) => s.frames)
  const index = useRadar((s) => s.index)
  const playing = useRadar((s) => s.playing)
  const error = useRadar((s) => s.error)
  const setIndex = useRadar((s) => s.setIndex)
  const setPlaying = useRadar((s) => s.setPlaying)

  const frame = frames[index]
  const latest = index === frames.length - 1

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-[10.5px] tracking-[0.12em] text-fg-dim uppercase">
      {frames.length === 0 ? (
        <span className={error ? 'text-danger' : ''}>{error ? t('Unavailable') : t('Loading')}</span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-pressed={playing}
            className={`px-1.5 py-0.5 transition-colors hover:text-accent ${playing ? 'text-accent' : ''}`}
          >
            {playing ? t('Pause') : t('Play')}
          </button>
          <input
            type="range"
            aria-label={t('Radar scan')}
            min={0}
            max={frames.length - 1}
            value={index}
            onChange={(event) => {
              setPlaying(false)
              setIndex(Number(event.target.value))
            }}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
          />
          <span className="w-24 shrink-0 text-right text-fg tabular-nums">
            {frame ? TIME.format(frame.time * 1000) : '–'}
            <span className={`ml-2 ${latest ? 'text-ok' : 'text-fg-mute'}`}>{latest ? t('Latest') : t('Past')}</span>
          </span>
        </>
      )}
    </div>
  )
}

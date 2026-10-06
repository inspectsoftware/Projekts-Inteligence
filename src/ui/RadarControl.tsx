import { isLayerOn, useLayers } from '../state/layers'
import { useRadar } from '../state/radar'
import { Panel } from './kit'

const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false })

/** Timeline for the rain radar: step through the last two hours, or play them as a loop. */
export function RadarControl() {
  const on = useLayers((s) => isLayerOn(s.visible, 'radar', false))
  const frames = useRadar((s) => s.frames)
  const index = useRadar((s) => s.index)
  const playing = useRadar((s) => s.playing)
  const error = useRadar((s) => s.error)
  const setIndex = useRadar((s) => s.setIndex)
  const setPlaying = useRadar((s) => s.setPlaying)

  if (!on) return null
  const frame = frames[index]
  const latest = index === frames.length - 1

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 flex justify-center px-3 max-md:bottom-24">
      <Panel className="flex items-center gap-3 px-3 py-1.5 font-mono text-[10.5px] tracking-[0.12em] text-fg-dim uppercase">
        <span className="text-fg-mute">Radar</span>
        {frames.length === 0 ? (
          <span className={error ? 'text-danger' : ''}>{error ? 'Unavailable' : 'Loading'}</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              aria-pressed={playing}
              className={`px-1.5 py-0.5 transition-colors hover:text-accent ${playing ? 'text-accent' : ''}`}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              aria-label="Radar scan"
              min={0}
              max={frames.length - 1}
              value={index}
              onChange={(event) => {
                setPlaying(false)
                setIndex(Number(event.target.value))
              }}
              className="h-1 w-40 cursor-pointer accent-accent"
            />
            <span className="w-24 text-right text-fg tabular-nums">
              {frame ? TIME.format(frame.time * 1000) : '–'}
              <span className={`ml-2 ${latest ? 'text-ok' : 'text-fg-mute'}`}>{latest ? 'Latest' : 'Past'}</span>
            </span>
          </>
        )}
      </Panel>
    </div>
  )
}

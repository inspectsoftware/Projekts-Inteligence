import { type ReactNode, useEffect, useRef, useState } from 'react'
import { pictureOf } from '../../../../shared/adapters/cams'
import type { Cam } from '../../../../shared/feeds'
import { useMap } from '../../../map/instance'
import { getEntity } from '../../../runtime/entityStore'
import { useSelection } from '../../../state/selection'
import { EmbedFrame } from '../../media/EmbedFrame'
import { HlsVideo } from '../../media/HlsVideo'
import { useOnScreen, useTicker } from './hooks'
import { useCctv } from './store'

const FOOT_BUTTON =
  'border border-line bg-ink-850 px-2 py-1 text-[10px] tracking-[0.16em] text-fg-dim uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40'

/** An endless video file. It is let go of when the element leaves the page: otherwise the download runs on until the element is collected. */
function EndlessVideo({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current!
    video.src = src
    return () => {
      video.removeAttribute('src')
      video.load()
    }
  }, [src])
  return <video ref={ref} muted autoPlay playsInline controls aria-label={title} className="h-full w-full object-contain" />
}

/** One camera, large: a still that renews itself in place, or a player that starts once the visitor has asked for it. */
export function CamView({ cam }: { cam: Cam }) {
  const map = useMap()
  const armed = useCctv((s) => s.armed)
  const arm = useCctv((s) => s.arm)
  const back = useCctv((s) => s.back)
  const select = useSelection((s) => s.select)
  const frame = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(frame)
  const still = cam.kind === 'still'
  // A poster stops renewing once its player runs: nobody sees it any more.
  const picture = pictureOf(cam, useTicker(still || !armed ? cam.refreshS : undefined, onScreen))
  const [broken, setBroken] = useState<string | null>(null)
  const label = `${cam.name}, ${cam.place}`

  const showOnMap = () => {
    if (!map || cam.lon === undefined || cam.lat === undefined) return
    // Selects its dot too, if the layer that draws it is on. Road cameras are dots of their own layer.
    const dot = cam.id.startsWith('camera:') ? cam.id : `webcam:${cam.id}`
    if (getEntity(dot)) select(dot)
    map.flyTo({ center: [cam.lon, cam.lat], zoom: Math.max(map.getZoom(), 12), duration: 1400 })
  }

  let media: ReactNode
  if (still) {
    media =
      picture !== broken ? (
        <img src={picture!} alt={label} onError={() => setBroken(picture)} className="h-full w-full object-contain" />
      ) : (
        <p className="grid h-full place-items-center text-[10px] tracking-[0.2em] text-fg-mute uppercase">No picture right now</p>
      )
  } else if (!armed) {
    media = (
      <button type="button" onClick={arm} aria-label={`Play ${label}`} className="group relative grid h-full w-full place-items-center text-fg-dim hover:text-accent">
        {picture && <img src={picture} alt="" className="absolute inset-0 h-full w-full object-contain opacity-60" />}
        <span className="relative border border-line-strong bg-ink-900/80 px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase group-hover:border-accent">Play</span>
      </button>
    )
  } else if (!onScreen) {
    // No player in a hidden tab or out of view: a stream left running would download all afternoon. It starts again when looked at.
    media = null
  } else if (cam.kind === 'hls') {
    media = <HlsVideo src={cam.src} title={label} poster={picture ?? undefined} />
  } else if (cam.kind === 'video') {
    media = <EndlessVideo src={cam.src} title={label} />
  } else {
    // The click that armed the player was the visitor asking for it.
    media = <EmbedFrame src={cam.src} title={label} eager />
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <button type="button" onClick={back} className={FOOT_BUTTON}>
          ‹ Grid
        </button>
        <h3 className="min-w-0 flex-1 truncate text-[11px] tracking-[0.08em] text-fg" title={cam.name}>
          {cam.name}
        </h3>
        <span className="shrink-0 text-[9.5px] tracking-[0.14em] text-fg-mute uppercase">
          {cam.place} · {cam.country}
        </span>
      </header>
      {/* In a window the frame takes the room that is left; in the phone sheet, which has no height of its own, a 16:9 box. */}
      <div ref={frame} className="relative min-h-0 flex-1 bg-ink-950 max-md:aspect-video max-md:flex-none">
        <div className="absolute inset-0">{media}</div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2 py-1.5 text-[10px] tracking-[0.06em]">
        {/^https?:\/\//.test(cam.page) ? (
          <a href={cam.page} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-fg-dim underline decoration-line-strong underline-offset-2 hover:text-accent">
            {cam.credit} ↗
          </a>
        ) : (
          <span className="min-w-0 truncate text-fg-dim">{cam.credit}</span>
        )}
        {cam.approx && <span className="tracking-[0.14em] text-warn uppercase">Approximate position</span>}
        <button
          type="button"
          disabled={!map || cam.lon === undefined}
          title={cam.lon === undefined ? 'Its publisher gives no position' : 'Fly the map to this camera'}
          onClick={showOnMap}
          className={`ml-auto ${FOOT_BUTTON}`}
        >
          Show on map
        </button>
      </footer>
    </>
  )
}

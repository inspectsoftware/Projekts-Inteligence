import { useRef, useState } from 'react'
import { pictureOf } from '../../../../shared/adapters/cams'
import type { Cam } from '../../../../shared/feeds'
import { useOnScreen, useTicker } from './hooks'

/** "10 s", "5 min": how often a still is replaced. */
const pace = (seconds: number) => (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`)

/** One camera in the grid: its latest still, renewed at the camera's own pace while the tile is on screen. */
export function CamTile({ cam, onOpen }: { cam: Cam; onOpen(): void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const picture = pictureOf(cam, useTicker(cam.refreshS, useOnScreen(ref)))
  // Remembered per frame, so a camera that was down is tried again with the next one.
  const [broken, setBroken] = useState<string | null>(null)
  const live = cam.kind !== 'still'

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      title={`${cam.name}, ${cam.place}`}
      className="group relative block aspect-video w-full overflow-hidden border border-line bg-ink-950 text-left hover:border-accent"
    >
      {picture && picture !== broken ? (
        <img src={picture} alt="" loading="lazy" decoding="async" onError={() => setBroken(picture)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center pb-6 text-[9.5px] tracking-[0.2em] text-fg-mute uppercase">
          {picture ? 'No picture' : 'Stream only'}
        </span>
      )}
      <span className={`absolute top-1 left-1 bg-ink-950/75 px-1 text-[9px] tracking-[0.16em] uppercase ${live ? 'text-accent' : 'text-fg-dim'}`}>
        {live ? 'Live' : cam.refreshS ? `Every ${pace(cam.refreshS)}` : 'Still'}
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-ink-950/75 px-1.5 py-1">
        <span className="block truncate text-[10px] tracking-[0.06em] text-fg group-hover:text-accent">{cam.name}</span>
        <span className="block truncate text-[9px] tracking-[0.14em] text-fg-mute uppercase">
          {/* A road camera's place is only its country again. Its publisher is named instead: Lithuania's terms ask for that wherever a photo shows. */}
          {cam.road ? cam.credit : `${cam.place} · ${cam.country}`}
        </span>
      </span>
    </button>
  )
}

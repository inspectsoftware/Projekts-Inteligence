import type Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'

interface HlsVideoProps {
  /** Playlist URL. Its origin has to be listed in MEDIA_ORIGINS (shared/origins.ts). */
  src: string
  /** What is playing, for screen readers. */
  title: string
  /** A still to show until the first frame arrives. */
  poster?: string
}

/** A live HLS stream: muted, started at once, with the browser's own controls. Mount it only once the visitor asks. */
export function HlsVideo({ src, title, poster }: HlsVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const video = ref.current!
    // An iPhone has no Media Source Extensions and plays HLS by itself. Everywhere else hls.js
    // does it, and is only fetched now that a stream has been asked for.
    if (!('MediaSource' in window || 'ManagedMediaSource' in window)) {
      video.src = src
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    let player: Hls | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let gone = false
    import('hls.js')
      .then(({ default: Hls }) => {
        if (gone) return
        // Never fetch a 4K rendition to fill a tile-sized frame.
        const hls = new Hls({ capLevelToPlayerSize: true })
        player = hls
        hls.on(Hls.Events.FRAG_BUFFERED, () => setNote(null))
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError()
          // Camera links drop now and then: ask again from the start rather than give up.
          setNote('No signal: trying again')
          clearTimeout(retry)
          retry = setTimeout(() => hls.loadSource(src), 5000)
        })
        hls.loadSource(src)
        hls.attachMedia(video)
      })
      .catch(() => setNote('The player could not be loaded'))
    return () => {
      gone = true
      clearTimeout(retry)
      player?.destroy()
    }
  }, [src])

  return (
    <div className="relative h-full min-h-0 w-full bg-ink-950">
      <video ref={ref} muted autoPlay playsInline controls poster={poster} aria-label={title} className="block h-full w-full object-contain" />
      {note && (
        <p role="status" className="pointer-events-none absolute top-2 left-2 border border-warn/60 bg-ink-900/85 px-1.5 py-px text-[9.5px] tracking-[0.16em] text-warn uppercase">
          {note}
        </p>
      )}
    </div>
  )
}

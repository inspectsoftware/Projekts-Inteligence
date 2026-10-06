import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { t } from '../../i18n'

const YOUTUBE = 'https://www.youtube-nocookie.com'

interface EmbedFrameProps {
  /** Player URL. Its origin has to be listed in FRAME_ORIGINS (shared/origins.ts). */
  src: string
  /** What is playing, for screen readers and the play button. */
  title: string
  /** A still to show until the visitor asks for the player. */
  poster?: string
  /** Load the player straight away instead of waiting for a click. */
  eager?: boolean
  /**
   * Called with the player's error code when a YouTube player says it cannot play: 150 for a
   * video that is gone or may not be embedded, and for a channel address that finds no stream.
   * Other players do not report, so for them it is never called.
   */
  onError?(code: number): void
}

/**
 * A third-party player in an iframe, loaded only once the visitor asks for it: until then
 * the other site sets no cookies and sees no request from this page.
 */
export function EmbedFrame({ src, title, poster, eager = false, onError }: EmbedFrameProps) {
  const [wanted, setWanted] = useState<string | null>(eager ? src : null)
  // A new source in the same frame (another channel) waits for its own click again.
  const active = wanted === src || eager
  const frame = useRef<HTMLIFrameElement>(null)
  // YouTube's player reports to the page by postMessage once asked to, so no script of its runs here.
  const listens = active && onError !== undefined && src.startsWith(`${YOUTUBE}/`)
  const report = useEffectEvent((code: number) => onError?.(code))

  useEffect(() => {
    const el = frame.current
    if (!listens || !el) return
    const hello = () => el.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'embed', channel: 'widget' }), YOUTUBE)
    let again: ReturnType<typeof setTimeout> | undefined
    const onLoad = () => {
      hello()
      // Once more a moment later: the player's own script may not have been up for the first.
      clearTimeout(again)
      again = setTimeout(hello, 1500)
    }
    const onMessage = (event: MessageEvent) => {
      // Any window can post to this one. Only the player in this very frame is believed.
      if (event.origin !== YOUTUBE || event.source !== el.contentWindow) return
      try {
        const message = JSON.parse(event.data) as { event?: unknown; info?: unknown } | null
        if (message?.event === 'onError') report(Number(message.info))
      } catch {
        // Not one of the player's messages.
      }
    }
    el.addEventListener('load', onLoad)
    window.addEventListener('message', onMessage)
    return () => {
      clearTimeout(again)
      el.removeEventListener('load', onLoad)
      window.removeEventListener('message', onMessage)
    }
  }, [listens, src])

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setWanted(src)}
        aria-label={t('Play {title}', { title })}
        className="group relative grid h-full min-h-0 w-full place-items-center overflow-hidden bg-ink-950 text-fg-dim hover:text-accent"
      >
        {poster && <img src={poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
        <span className="relative border border-line-strong bg-ink-900/80 px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase group-hover:border-accent">
          {t('Play')}
        </span>
      </button>
    )
  }
  return (
    <iframe
      ref={frame}
      // The player stays silent unless its address asks for the messages and names the page they go to.
      src={listens ? `${src}${src.includes('?') ? '&' : '?'}enablejsapi=1&origin=${encodeURIComponent(location.origin)}` : src}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      // YouTube refuses to play without a referrer.
      referrerPolicy="strict-origin-when-cross-origin"
      className="block h-full min-h-0 w-full border-0 bg-ink-950"
    />
  )
}

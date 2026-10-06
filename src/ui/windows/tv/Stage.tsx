import { type ReactNode, useEffect, useState } from 'react'
import { linkOf, playersOf } from '../../../../shared/adapters/tv'
import type { TvNow } from '../../../../shared/feeds'
import type { TvChannel } from '../../../../shared/media/tv'
import { t } from '../../../i18n'
import { EmbedFrame } from '../../media/EmbedFrame'
import { HlsVideo } from '../../media/HlsVideo'
import { useTv } from './store'

interface StageProps {
  channel: TvChannel
  /** What the feed found for this channel, if it has answered about it. */
  now: TvNow | undefined
}

const LINK = 'underline decoration-line-strong underline-offset-2 hover:text-accent'
const NOTE = 'grid h-full place-items-center p-3 text-center text-[11px] leading-snug text-fg-dim'

/** Said once per visit, under the first player that starts. */
let soundNoted = false

function SoundNote() {
  const [shown, setShown] = useState(!soundNoted)
  useEffect(() => {
    soundNoted = true
    const timer = setTimeout(() => setShown(false), 6000)
    return () => clearTimeout(timer)
  }, [])
  if (!shown) return null
  return (
    <p role="status" className="text-[9.5px] tracking-[0.16em] text-accent uppercase">
      {t('Sound is off: turn it on in the player')}
    </p>
  )
}

/**
 * The picture area, and under it what is in it and whose it is. The credit is the broadcaster's own
 * page, always there. Nothing of ours is drawn over the picture: YouTube's terms and Saeima's both
 * want a player left as it is, so the word about the sound (`muted`) goes underneath too.
 */
function Frame({ channel, now, muted = false, children }: StageProps & { muted?: boolean; children: ReactNode }) {
  return (
    <>
      {/* Beside the rail the picture takes the room that is left. Stacked on it, in the upright phone sheet, nothing gives it a height: there it is a 16:9 box. */}
      <div className="relative min-h-0 flex-1 bg-ink-950 max-md:portrait:aspect-video max-md:portrait:max-h-[36vh] max-md:portrait:flex-none">
        <div className="absolute inset-0">{children}</div>
      </div>
      <footer className="shrink-0 border-t border-line px-2 py-1.5 text-[10px] tracking-[0.06em]">
        {muted && <SoundNote />}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="min-w-0 truncate text-[11px] text-fg">{channel.name}</h3>
          <span className="text-[9.5px] tracking-[0.14em] text-fg-mute uppercase">{channel.lang}</span>
          <span className="min-w-0 flex-1 truncate text-fg-dim" title={now?.title}>
            {now?.title}
          </span>
          <a href={linkOf(channel, now)} target="_blank" rel="noreferrer noopener" className={`max-w-full truncate text-fg-dim ${LINK}`}>
            {channel.credit} ↗
          </a>
        </div>
        {channel.schedule && (
          <p className="truncate text-fg-mute" title={t(channel.schedule)}>
            {t(channel.schedule)}
          </p>
        )}
      </footer>
    </>
  )
}

/** A channel's players, one after another until one does not report that it cannot play. After the last, the way out. */
function Playing({ channel, now: latest }: StageProps) {
  // Held as it was when the visitor asked: a later refresh of the feed must not swap the stream under a viewer.
  const [now] = useState(latest)
  const [step, setStep] = useState(0)
  const player = playersOf(channel, now)[step]

  if (!player) {
    return (
      <Frame channel={channel} now={now}>
        <div className={NOTE}>
          <div>
            <p>
              {channel.schedule
                ? t('Not on air right now, or this broadcast may not be shown on other sites.')
                : t('This stream has moved, or may no longer be shown on other sites.')}
            </p>
            <a href={linkOf(channel, now)} target="_blank" rel="noreferrer noopener" className={`mt-2 inline-block text-accent ${LINK}`}>
              {t('Watch at {credit} ↗', { credit: channel.credit })}
            </a>
          </div>
        </div>
      </Frame>
    )
  }
  return (
    // Muted only where the silent start is ours to ask for: LRT's own page decides for itself.
    <Frame channel={channel} now={now} muted={player.kind !== 'iframe'}>
      {player.kind === 'hls' ? (
        <HlsVideo src={player.src} title={channel.name} />
      ) : (
        // Keyed, so each player gets a frame of its own and a late report from the one before is not heard.
        <EmbedFrame key={player.src} src={player.src} title={channel.name} eager onError={() => setStep(step + 1)} />
      )}
    </Frame>
  )
}

/**
 * The chosen channel: a poster until the visitor asks for it, then its player. `waiting` is true
 * until the feed has answered or failed.
 */
export function Stage({ channel, now, waiting }: StageProps & { waiting: boolean }) {
  const plays = useTv((s) => s.plays)
  const watch = useTv((s) => s.watch)
  const players = playersOf(channel, now)
  // Started before the feed has said which video it is, a bulletin would be looked for at an address that seldom finds it.
  const pending = waiting && (channel.kind === 'yt-feed' || channel.kind === 'yt-video')

  if ((plays > 0 && !pending) || players.length === 0) {
    // Asking again for the channel already here starts it afresh, with what the feed says by then.
    return <Playing key={`${channel.id} ${plays}`} channel={channel} now={now} />
  }
  return (
    <Frame channel={channel} now={now}>
      {plays > 0 ? (
        <p className={NOTE}>{t('Finding the broadcast…')}</p>
      ) : (
        <button type="button" onClick={() => watch(channel.id)} aria-label={t('Play {name}', { name: channel.name })} className="group relative grid h-full w-full place-items-center text-fg-dim hover:text-accent">
          {players[0].poster && <img src={players[0].poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
          <span className="relative border border-line-strong bg-ink-900/80 px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase group-hover:border-accent">{t('Play')}</span>
        </button>
      )}
    </Frame>
  )
}

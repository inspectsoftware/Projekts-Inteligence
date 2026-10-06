import { useMemo } from 'react'
import { TV_CHANNELS } from '../../../shared/media/tv'
import { useFeed } from '../../runtime/useFeed'
import { useFeeds } from '../../state/feeds'
import { ChannelRail } from './tv/ChannelRail'
import { Stage } from './tv/Stage'
import { useTv } from './tv/store'

/**
 * Live television and official streams from the region's broadcasters: the channels by country,
 * and one player. Nothing of a third party loads until a channel is asked for, and closing the
 * window takes the player away with it.
 */
export function TvWindow() {
  const payload = useFeed('tv', 'tv')
  const failed = useFeeds((s) => s.feeds.tv?.status === 'error')
  const channelId = useTv((s) => s.channelId)
  const lookups = useMemo(() => new Map(payload?.channels.map((now) => [now.id, now] as const)), [payload])
  // A channel remembered from an earlier visit may have left the list since.
  const channel = TV_CHANNELS.find((candidate) => candidate.id === channelId)

  return (
    // Rail and picture side by side, except in the sheet of a phone held upright, where the picture
    // sits on top of the rail. Sideways that sheet is too low to stack them: the rail would be left a single row.
    <div className="flex min-h-0 flex-1 max-md:portrait:flex-col">
      {channel ? (
        <section aria-label={channel.name} className="flex min-w-0 flex-1 flex-col max-md:portrait:flex-none">
          <Stage channel={channel} now={lookups.get(channel.id)} waiting={!payload && !failed} />
        </section>
      ) : (
        <p className="grid flex-1 place-items-center p-3 text-[10px] tracking-[0.2em] text-fg-mute uppercase max-md:portrait:hidden">Choose a channel</p>
      )}
      <ChannelRail lookups={lookups} selected={channel?.id} />
    </div>
  )
}

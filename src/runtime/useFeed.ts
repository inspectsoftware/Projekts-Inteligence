import { useEffect, useSyncExternalStore } from 'react'
import type { FeedId, FeedPayload } from '../../shared/feeds'
import { getPayload, subscribeEntities } from './entityStore'
import { acquireFeed } from './poller'

/** Polls a feed for as long as the component showing it is mounted, and returns its latest payload. */
export function useFeed<S extends FeedPayload['shape']>(id: FeedId, shape: S) {
  useEffect(() => acquireFeed(id), [id])
  return useSyncExternalStore(subscribeEntities, () => getPayload(id, shape))
}

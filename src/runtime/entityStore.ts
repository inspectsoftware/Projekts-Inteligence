import { useSyncExternalStore } from 'react'
import type { Entity } from '../../shared/entity'
import type { FeedBody, FeedId } from '../../shared/feeds'
import { serverNow } from './clock'
import { recordTrails } from './trails'

/**
 * Live entities, kept outside React. Feeds deliver hundreds of moving objects every
 * few seconds; the map scene reads them imperatively, and only the few components
 * that show a single entity subscribe.
 */
interface FeedSlot {
  /** Same array identity until the next snapshot, so the map layers can tell "nothing changed". */
  entities: Entity[]
  updatedAt: number
  version: number
}

const EMPTY: Entity[] = []
const slots = new Map<FeedId, FeedSlot>()
const byId = new Map<string, Entity>()
const listeners = new Set<() => void>()

export function ingest(body: FeedBody): void {
  const previous = slots.get(body.id)
  if (previous) for (const entity of previous.entities) byId.delete(entity.id)

  const { entities } = body.payload
  for (const entity of entities) byId.set(entity.id, entity)
  slots.set(body.id, { entities, updatedAt: body.updatedAt, version: (previous?.version ?? 0) + 1 })
  recordTrails(entities, serverNow())

  for (const listener of listeners) listener()
}

/** Drops a feed's entities, for example when its layer is switched off. */
export function clearFeed(id: FeedId): void {
  const slot = slots.get(id)
  if (!slot) return
  for (const entity of slot.entities) byId.delete(entity.id)
  slots.delete(id)
  for (const listener of listeners) listener()
}

export function getEntities(id: FeedId): Entity[] {
  return slots.get(id)?.entities ?? EMPTY
}

export function getEntity(id: string): Entity | undefined {
  return byId.get(id)
}

export function subscribeEntities(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The entity with this id, re-rendering whenever a new snapshot replaces it. */
export function useEntity(id: string | null): Entity | undefined {
  return useSyncExternalStore(subscribeEntities, () => (id ? byId.get(id) : undefined))
}

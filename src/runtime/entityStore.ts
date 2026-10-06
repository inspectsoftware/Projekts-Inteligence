import { useSyncExternalStore } from 'react'
import type { Entity } from '../../shared/entity'
import type { FeedBody, FeedId, FeedPayload, PayloadOf } from '../../shared/feeds'
import { serverNow } from './clock'
import { recordTrails } from './trails'

/**
 * Live data, kept outside React. Feeds deliver hundreds of moving objects every few
 * seconds; the map scene reads them imperatively, and only the few components that
 * show a single entity subscribe.
 */
const EMPTY: Entity[] = []

/** Latest payload per feed, whatever its shape. */
const payloads = new Map<FeedId, FeedPayload>()
/**
 * Entity lists by slot: a feed id for feeds that deliver entities, or a layer's own
 * key for entities worked out in the browser (satellite positions). Each list keeps
 * its array identity until it is replaced, so layers can tell "nothing changed".
 */
const slots = new Map<string, Entity[]>()
const byId = new Map<string, Entity>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function replaceSlot(slot: string, entities: Entity[]): void {
  for (const entity of slots.get(slot) ?? EMPTY) byId.delete(entity.id)
  for (const entity of entities) byId.set(entity.id, entity)
  slots.set(slot, entities)
}

export function ingest(body: FeedBody): void {
  payloads.set(body.id, body.payload)
  if (body.payload.shape === 'entities') {
    replaceSlot(body.id, body.payload.entities)
    recordTrails(body.payload.entities, serverNow())
  }
  notify()
}

/** Publishes entities a layer computed itself, so selection and the inspector treat them like any other. */
export function publishEntities(slot: string, entities: Entity[]): void {
  replaceSlot(slot, entities)
  notify()
}

/** Drops everything a feed delivered, for example when its layer is switched off. */
export function clearFeed(id: FeedId): void {
  if (!payloads.has(id) && !slots.has(id)) return
  payloads.delete(id)
  replaceSlot(id, EMPTY)
  slots.delete(id)
  notify()
}

export function getEntities(slot: string): Entity[] {
  return slots.get(slot) ?? EMPTY
}

export function getEntity(id: string): Entity | undefined {
  return byId.get(id)
}

/** The feed's latest payload, if it has the expected shape. */
export function getPayload<S extends FeedPayload['shape']>(id: FeedId, shape: S): PayloadOf<S> | undefined {
  const payload = payloads.get(id)
  return payload?.shape === shape ? (payload as PayloadOf<S>) : undefined
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

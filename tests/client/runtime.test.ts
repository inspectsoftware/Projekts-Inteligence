import { describe, expect, it, vi } from 'vitest'
import type { Entity } from '../../shared/entity'
import type { FeedBody } from '../../shared/feeds'
import { haversine } from '../../shared/geo/sphere'
import { positionAt } from '../../src/map/motion'
import { observeServerTime, serverNow } from '../../src/runtime/clock'
import { clearFeed, getEntities, getEntity, ingest, subscribeEntities } from '../../src/runtime/entityStore'
import { getTrail, recordTrails } from '../../src/runtime/trails'

const aircraft = (id: string, patch: Partial<Entity> = {}): Entity => ({
  id: `aircraft:${id}`,
  kind: 'aircraft',
  lon: 24,
  lat: 57,
  ts: 1_000_000,
  flags: 0,
  props: {},
  ...patch,
})

const body = (entities: Entity[], updatedAt = 1): FeedBody => ({
  id: 'aircraft',
  updatedAt,
  payload: { shape: 'entities', entities },
})

describe('dead reckoning', () => {
  const jet = aircraft('a', { spd: 250, trk: 90 })

  it('carries a moving entity forward along its course', () => {
    const [lon, lat] = positionAt(jet, jet.ts + 10_000)
    expect(lat).toBeCloseTo(57, 4)
    expect(lon).toBeGreaterThan(24)
    expect(haversine(24, 57, lon, lat)).toBeCloseTo(2500, -1)
  })

  it('heads the right way for each compass direction', () => {
    const at = (trk: number) => positionAt(aircraft('b', { spd: 100, trk }), 1_010_000)
    expect(at(0)[1]).toBeGreaterThan(57)
    expect(at(180)[1]).toBeLessThan(57)
    expect(at(270)[0]).toBeLessThan(24)
  })

  it('stops projecting a target that has gone quiet', () => {
    const soon = positionAt(jet, jet.ts + 25_000)
    const muchLater = positionAt(jet, jet.ts + 600_000)
    expect(muchLater).toEqual(soon)
  })

  it('never moves a position backwards or a parked entity at all', () => {
    expect(positionAt(jet, jet.ts - 5000)).toEqual([24, 57])
    expect(positionAt(aircraft('c', { spd: 0.2, trk: 90 }), jet.ts + 10_000)).toEqual([24, 57])
    expect(positionAt(aircraft('d'), jet.ts + 10_000)).toEqual([24, 57])
    // A bus is not carried on along its heading: the street turns before its next report.
    expect(positionAt({ ...aircraft('e', { spd: 12, trk: 240 }), kind: 'transit' }, jet.ts + 10_000)).toEqual([24, 57])
  })
})

describe('entity store', () => {
  it('replaces a feed snapshot as a whole and notifies once', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeEntities(listener)

    ingest(body([aircraft('one'), aircraft('two')]))
    expect(getEntities('aircraft')).toHaveLength(2)
    expect(getEntity('aircraft:one')).toBeDefined()
    expect(listener).toHaveBeenCalledTimes(1)

    ingest(body([aircraft('two')], 2))
    expect(getEntity('aircraft:one')).toBeUndefined()
    expect(getEntity('aircraft:two')).toBeDefined()

    clearFeed('aircraft')
    expect(getEntities('aircraft')).toHaveLength(0)
    expect(getEntity('aircraft:two')).toBeUndefined()

    unsubscribe()
    ingest(body([aircraft('three')], 3))
    expect(listener).toHaveBeenCalledTimes(3)
    clearFeed('aircraft')
  })

  it('keeps the same array between snapshots so layers can skip unchanged data', () => {
    ingest(body([aircraft('one')]))
    expect(getEntities('aircraft')).toBe(getEntities('aircraft'))
    clearFeed('aircraft')
  })
})

describe('trails', () => {
  it('adds a point only when the entity has really moved', () => {
    recordTrails([aircraft('t', { lon: 24, lat: 57 })], 0)
    recordTrails([aircraft('t', { lon: 24.0001, lat: 57 })], 10_000)
    expect(getTrail('aircraft:t')!.path).toHaveLength(1)

    recordTrails([aircraft('t', { lon: 24.05, lat: 57 })], 20_000)
    expect(getTrail('aircraft:t')!.path).toEqual([
      [24, 57],
      [24.05, 57],
    ])
  })

  it('forgets entities that stopped appearing', () => {
    recordTrails([aircraft('gone')], 0)
    recordTrails([aircraft('here')], 4 * 60 * 1000)
    expect(getTrail('aircraft:gone')).toBeUndefined()
    expect(getTrail('aircraft:here')).toBeDefined()
  })
})

describe('server clock', () => {
  it('follows the server even when the local clock is far off', () => {
    const sent = performance.now()
    const serverTime = Date.now() + 64_000
    observeServerTime(serverTime, sent, sent + 20)
    expect(Math.abs(serverNow() - serverTime)).toBeLessThan(1000)
  })
})

describe('buses and trains between fixes', () => {
  const bus = (lon: number, ts: number, trk = 90) => ({ ...aircraft('glide-bus', { spd: 8, trk }), kind: 'transit' as const, lon, lat: 57, ts })
  const metresEast = (lon: number) => (lon - 24) * 111_320 * Math.cos((57 * Math.PI) / 180)

  it('glides from where it is drawn to the new fix, and never past it', () => {
    positionAt(bus(24, 1000), 1000)
    // The next fix, about 60 m east.
    const next = bus(24.001, 7000)
    expect(positionAt(next, 7000)[0]).toBeCloseTo(24, 6)
    expect(metresEast(positionAt(next, 10_000)[0])).toBeGreaterThan(20)
    expect(metresEast(positionAt(next, 10_000)[0])).toBeLessThan(45)
    // 60 m at its 8 m/s: there 7.5 s after the fix arrived.
    expect(positionAt(next, 12_000)[0]).toBeLessThan(24.001)
    expect(positionAt(next, 14_600)[0]).toBeCloseTo(24.001, 6)
    expect(positionAt(next, 60_000)[0]).toBeCloseTo(24.001, 6)
  })

  it('stays put when the GPS wavers a few metres back at a stop', () => {
    const back = bus(24.0008, 15_000)
    expect(positionAt(back, 15_000)[0]).toBeCloseTo(24.001, 6)
    expect(positionAt(back, 30_000)[0]).toBeCloseTo(24.001, 6)
  })

  it('appears at once where it is seen again after a long gap', () => {
    expect(positionAt(bus(24.1, 40_000), 40_000)[0]).toBeCloseTo(24.1, 6)
  })
})

describe('a feed that moves its vehicles only now and then', () => {
  // No speed in the feed (as in Rīga's): the pace comes from how long the vehicle took.
  const tram = (lon: number, ts: number) => ({ ...aircraft('slow-tram'), kind: 'transit' as const, lon, lat: 57, ts, trk: 90 })

  it('takes as long over the way as the vehicle did, not the whole way in one refresh', () => {
    positionAt(tram(24, 0), 0)
    // The same fix for half a minute of refreshes, then 300 m on.
    for (const ts of [6000, 12_000, 18_000, 24_000]) positionAt(tram(24, ts), ts)
    const on = tram(24.005, 30_000)
    positionAt(on, 30_000)
    // Six seconds later it is nowhere near there yet; half a minute later it is.
    expect(positionAt(on, 36_000)[0]).toBeLessThan(24.001)
    expect(positionAt(on, 60_000)[0]).toBeCloseTo(24.005, 6)
  })
})

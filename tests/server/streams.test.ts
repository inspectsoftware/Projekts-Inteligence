import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedCache } from '../../server/core/cache'
import type { DiskStore, StoredSnapshot } from '../../server/core/disk'
import { LazyStream, type SocketLike } from '../../server/core/stream'
import type { FeedDef } from '../../server/feeds/types'
import { mergeElements, normaliseElements } from '../../shared/adapters/satellites'
import { type RawTrain, type TrainFixes, normaliseTrains } from '../../shared/adapters/trains'
import type { FeedPayload } from '../../shared/feeds'

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as T

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket implements SocketLike {
  closed = false
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    ;(this.listeners[type] ??= []).push(listener)
  }
  close(): void {
    this.closed = true
  }
  emit(type: 'message' | 'close' | 'error', data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T09:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LazyStream', () => {
  function setup() {
    const sockets: FakeSocket[] = []
    const messages: string[] = []
    const stream = new LazyStream({
      name: 'The test feed',
      url: 'wss://example.org/ws',
      idleCloseMs: 60_000,
      // Frames starting with "meta" stand for greetings that carry nothing servable.
      onMessage: (raw) => {
        messages.push(raw)
        return !raw.startsWith('meta')
      },
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    return { stream, sockets, messages }
  }

  it('connects on first demand and resolves once data arrives', async () => {
    const { stream, sockets, messages } = setup()
    expect(sockets).toHaveLength(0)

    const ready = stream.ready(5000)
    expect(sockets).toHaveLength(1)
    sockets[0].emit('message', 'hello')
    await ready
    expect(messages).toEqual(['hello'])
    expect(stream.connected).toBe(true)

    // A second caller shares the same connection.
    await stream.ready(5000)
    expect(sockets).toHaveLength(1)
  })

  it('is not ready until a frame with usable data has arrived', async () => {
    const { stream, sockets } = setup()
    let ready = false
    const pending = stream.ready(5000).then(() => (ready = true))

    sockets[0].emit('message', 'meta: station list')
    await vi.advanceTimersByTimeAsync(0)
    expect(ready).toBe(false)
    expect(stream.connected).toBe(false)

    sockets[0].emit('message', 'data')
    await pending
    expect(ready).toBe(true)
  })

  it('gives up waiting when the upstream stays silent', async () => {
    const { stream } = setup()
    const ready = stream.ready(5000)
    const outcome = expect(ready).rejects.toThrow('The test feed sent nothing in time')
    await vi.advanceTimersByTimeAsync(5001)
    await outcome
  })

  it('closes the upstream once nobody has asked for a while', async () => {
    const { stream, sockets } = setup()
    const ready = stream.ready(5000)
    sockets[0].emit('message', 'x')
    await ready

    await vi.advanceTimersByTimeAsync(30_000)
    await stream.ready(5000) // still wanted
    await vi.advanceTimersByTimeAsync(45_000)
    expect(sockets[0].closed).toBe(false)

    await vi.advanceTimersByTimeAsync(90_000)
    expect(sockets[0].closed).toBe(true)
    expect(stream.connected).toBe(false)
  })

  it('reconnects after a drop, but not in a tight loop', async () => {
    const { stream, sockets } = setup()
    const first = stream.ready(5000)
    sockets[0].emit('message', 'x')
    await first

    sockets[0].emit('close')
    expect(stream.connected).toBe(false)
    await expect(stream.ready(100)).rejects.toThrow('reconnecting')
    expect(sockets).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2500)
    const again = stream.ready(5000)
    expect(sockets).toHaveLength(2)
    sockets[1].emit('message', 'y')
    await again
  })

  it('ignores binary frames', async () => {
    const { stream, sockets, messages } = setup()
    const ready = stream.ready(5000)
    sockets[0].emit('message', new Uint8Array([1, 2, 3]))
    sockets[0].emit('message', 'text')
    await ready
    expect(messages).toEqual(['text'])
  })
})

describe('normaliseTrains', () => {
  const frame = fixture<{ data: RawTrain[] }>('trains.vivi.json')
  const T0 = Date.parse('2026-10-06T09:00:00Z')

  it('turns each running train into an entity', () => {
    const trains = normaliseTrains(frame.data, T0, new Map())
    expect(trains).toHaveLength(frame.data.length)
    const train = trains.find((t) => t.props.number === '801')!
    expect(train).toMatchObject({ id: 'train:801', kind: 'train', label: '801', ts: T0 })
    expect(train.props).toMatchObject({ route: 'Daugavpils - Rīga', gps: true, stopped: false })
    // Latitude first in the feed, longitude first here.
    expect(train.lat).toBeGreaterThan(55.6)
    expect(train.lat).toBeLessThan(58.1)
    expect(train.lon).toBeGreaterThan(20.9)
    expect(train.lon).toBeLessThan(28.3)
    expect(train.props.nextStopTime).toMatch(/^\d{2}:\d{2}$/)
  })

  it('says when a position comes from the timetable rather than GPS', () => {
    const trains = normaliseTrains(frame.data, T0, new Map())
    expect(trains.find((t) => t.props.number === '874')!.props.gps).toBe(false)
  })

  it('works out speed and heading from successive frames', () => {
    const fixes: TrainFixes = new Map()
    const at = (lon: number, lat: number): RawTrain[] => [
      { name: 'Test', returnValue: { train: '1', position: [lat, lon], isGpsActive: true } },
    ]
    expect(normaliseTrains(at(24, 57), T0, fixes)[0]).toMatchObject({ spd: 0 })
    expect(normaliseTrains(at(24, 57), T0, fixes)[0].trk).toBeUndefined()

    // 10 s later, about 250 m due north: 25 m/s heading 000.
    const [moved] = normaliseTrains(at(24, 57.00225), T0 + 10_000, fixes)
    expect(moved.spd).toBeCloseTo(25, 0)
    expect(moved.trk).toBeCloseTo(0, 0)

    // Too soon after the last baseline: keep the previous estimate instead of a noisy one.
    const [soon] = normaliseTrains(at(24, 57.0024), T0 + 12_000, fixes)
    expect(soon.spd).toBeCloseTo(25, 0)
  })

  it('treats an impossible jump as a glitch, not as motion', () => {
    const fixes: TrainFixes = new Map()
    const at = (lat: number): RawTrain[] => [{ returnValue: { train: '2', position: [lat, 24] } }]
    normaliseTrains(at(57), T0, fixes)
    const [jumped] = normaliseTrains(at(57.5), T0 + 10_000, fixes)
    expect(jumped.spd).toBe(0)
  })

  it('drops finished trains, bad positions, and trains that left the feed', () => {
    const fixes: TrainFixes = new Map()
    normaliseTrains([{ returnValue: { train: '3', position: [57, 24] } }], T0, fixes)
    expect(fixes.has('3')).toBe(true)

    const out = normaliseTrains(
      [
        { returnValue: { train: '4', position: [57, 24], finished: true } },
        { returnValue: { train: '5', position: ['x', 24] } },
        { returnValue: { position: [57, 24] } },
      ],
      T0 + 5000,
      fixes,
    )
    expect(out).toHaveLength(0)
    expect(fixes.size).toBe(0)
  })
})

describe('satellite elements', () => {
  const raw = fixture<Record<string, unknown>[]>('satellites.celestrak.json')

  it('keeps what orbit propagation needs and tags the group', () => {
    const sats = normaliseElements(raw, 'stations')
    expect(sats).toHaveLength(raw.length)
    const iss = sats.find((sat) => sat.NORAD_CAT_ID === 25544)!
    expect(iss).toMatchObject({ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', GROUP: 'stations' })
    expect(iss.MEAN_MOTION).toBeGreaterThan(15)
    expect(Object.keys(iss)).not.toContain('CLASSIFICATION_TYPE')
  })

  it('drops incomplete records and anything that is not a list', () => {
    expect(normaliseElements([{ OBJECT_NAME: 'BROKEN', EPOCH: '2026-10-06T00:00:00' }], 'weather')).toEqual([])
    expect(normaliseElements({ error: 'rate limited' }, 'weather')).toEqual([])
    expect(normaliseElements('GP data has not updated', 'weather')).toEqual([])
  })

  it('lists a satellite once even when two groups carry it', () => {
    const stations = normaliseElements(raw.slice(0, 2), 'stations')
    const weather = normaliseElements(raw.slice(1, 4), 'weather')
    const merged = mergeElements([stations, weather])
    expect(merged).toHaveLength(4)
    expect(merged.find((sat) => sat.NORAD_CAT_ID === stations[1].NORAD_CAT_ID)!.GROUP).toBe('stations')
  })
})

describe('FeedCache persistence', () => {
  const payload: FeedPayload = {
    shape: 'elements',
    sats: normaliseElements(fixture('satellites.celestrak.json'), 'stations'),
  }
  const def = (load: FeedDef['load']): FeedDef => ({
    id: 'satellites',
    title: 'Satellites',
    origins: [],
    ttlMs: 2 * 3600_000,
    staleMs: 72 * 3600_000,
    persist: true,
    attribution: [],
    load,
  })
  const memoryDisk = (initial?: StoredSnapshot) => {
    const files = new Map<string, StoredSnapshot>()
    if (initial) files.set('satellites', initial)
    const disk: DiskStore = {
      read: async (id) => files.get(id) ?? null,
      write: async (id, snapshot) => void files.set(id, snapshot),
    }
    return { disk, files }
  }

  it('saves a fresh copy to disk', async () => {
    const { disk, files } = memoryDisk()
    const cache = new FeedCache({ disk, log: () => {} })
    const hit = await cache.get(def(async () => payload))
    await vi.advanceTimersByTimeAsync(0)
    expect(hit.snapshot.count).toBe(payload.sats.length)
    expect(files.get('satellites')?.payload).toEqual(payload)
  })

  it('starts from the disk copy after a restart instead of calling the upstream', async () => {
    const { disk } = memoryDisk({ updatedAt: Date.now() - 30 * 60_000, payload })
    const load = vi.fn(async () => payload)
    const hit = await new FeedCache({ disk, log: () => {} }).get(def(load))
    expect(load).not.toHaveBeenCalled()
    expect(hit.stale).toBe(false)
    expect(hit.snapshot.updatedAt).toBe(Date.now() - 30 * 60_000)
  })

  it('serves an older disk copy at once and refreshes behind it', async () => {
    const { disk } = memoryDisk({ updatedAt: Date.now() - 5 * 3600_000, payload })
    const load = vi.fn(async () => payload)
    const cache = new FeedCache({ disk, log: () => {} })
    const hit = await cache.get(def(load))
    expect(hit.stale).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect((await cache.get(def(load))).stale).toBe(false)
  })

  it('ignores a disk copy that is too old to show', async () => {
    const { disk } = memoryDisk({ updatedAt: Date.now() - 80 * 3600_000, payload })
    const load = vi.fn(async () => payload)
    const hit = await new FeedCache({ disk, log: () => {} }).get(def(load))
    expect(load).toHaveBeenCalledTimes(1)
    expect(hit.stale).toBe(false)
  })
})

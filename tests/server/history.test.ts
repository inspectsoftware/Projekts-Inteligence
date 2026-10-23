import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Snapshot } from '../../server/core/cache'
import { History } from '../../server/core/history'
import { Flag } from '../../shared/entity'
import { activity } from '../../shared/history'

const MIN = 60_000
const snap = (at: number) => new Snapshot('aircraft', { shape: 'entities', entities: [] }, at, 0)

describe('History', () => {
  it('keeps a frame a minute for the span, and answers with the newest at or before a time', () => {
    const history = new History(MIN, 10 * MIN)
    for (let at = 0; at <= 20 * MIN; at += 10_000) history.record('aircraft', snap(at))
    history.record('news', snap(0))

    const times = history.times('aircraft')
    expect(times).toEqual(Array.from({ length: 11 }, (_, i) => (10 + i) * MIN))
    expect(history.frame('aircraft', 15.5 * MIN)?.at).toBe(15 * MIN)
    expect(history.frame('aircraft', 0)?.at).toBe(10 * MIN)
    expect(history.frame('ships', 0)).toBeUndefined()
    const body = JSON.parse(gunzipSync(history.frame('aircraft', 20 * MIN)!.gzip).toString()) as { updatedAt: number }
    expect(body.updatedAt).toBe(20 * MIN)
  })
})

describe('activity', () => {
  it('counts what a spike would be made of', () => {
    const plane = (flags: number) => ({ id: `aircraft:${flags}`, kind: 'aircraft' as const, lon: 24, lat: 57, ts: 0, flags, props: {} })
    expect(activity({ shape: 'entities', entities: [plane(0), plane(Flag.MIL), plane(Flag.MIL | Flag.EMERGENCY)] })).toBe(2)
    const cell = (good: number, bad: number) => ({ id: `${good}-${bad}`, boundary: [], good, bad })
    expect(activity({ shape: 'cells', windowStart: 0, cells: [cell(10, 0), cell(5, 5), cell(1, 0)] })).toBe(1)
  })
})

describe('History on disk', () => {
  it('reads back what an earlier process kept, and forgets what is past the span', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwh-history-'))
    try {
      const before = new History(MIN, 10 * MIN, dir, 0)
      for (let at = 0; at <= 5 * MIN; at += MIN) before.record('aircraft', snap(at))
      // The writes are not waited for by record(); give them a moment.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const after = new History(MIN, 10 * MIN, dir, 13 * MIN)
      expect(after.times('aircraft')).toEqual([3 * MIN, 4 * MIN, 5 * MIN])
      expect(after.frame('aircraft', 4 * MIN)?.gzip.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

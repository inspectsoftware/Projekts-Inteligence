import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Snapshot } from '../../server/core/cache'
import { History } from '../../server/core/history'

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

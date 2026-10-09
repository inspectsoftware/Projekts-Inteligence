import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'
import { createRoom, ownerFrom } from '../../server/http/room'
import type { ChatResponse } from '../../shared/room'

const id = (n: number) => n.toString(16).padStart(32, '0')

function clocked() {
  const clock = { at: 1_700_000_000_000 }
  return { clock, room: createRoom(() => clock.at) }
}

describe('room', () => {
  it('counts each browser once, and only while it keeps calling', () => {
    const { clock, room } = clocked()
    room.touch(id(1))
    room.touch(id(1))
    room.touch(id(2))
    expect(room.online()).toBe(2)

    clock.at += 60_000
    room.touch(id(2))
    clock.at += 40_000
    expect(room.online()).toBe(1)
  })

  it('gives every visitor a name of their own and keeps it for a returning one', () => {
    const { clock, room } = clocked()
    // A stuck dice: every roll but the last lands on a name already taken.
    let rolls = 0
    const stuck = createRoom(() => clock.at, () => (rolls++ < 9 ? 0 : 0.5))
    expect(stuck.touch(id(1))).not.toBe(stuck.touch(id(2)))

    const names = new Set(Array.from({ length: 2000 }, (_, n) => room.touch(id(n))))
    expect(names.size).toBe(2000)
    const mine = room.touch(id(7))
    clock.at += 3600_000
    expect(room.touch(id(7))).toBe(mine)
  })

  it('keeps the last hundred messages and hands out only the new ones', () => {
    const { clock, room } = clocked()
    let tenth = 0
    for (let n = 1; n <= 130; n++) {
      clock.at += 2000
      const posted = room.post(id(1), `message ${n}`)
      if (n === 120 && 'message' in posted) tenth = posted.message.seq
    }
    expect(room.since(0)).toHaveLength(100)
    expect(room.since(0)[0].text).toBe('message 31')
    expect(room.since(tenth).map((message) => message.text)).toHaveLength(10)
  })

  it('turns away empty, oversized and hurried messages', () => {
    const { clock, room } = clocked()
    expect(room.post(id(1), ' \n\t ')).toEqual({ refused: 'empty' })
    expect(room.post(id(1), 'x'.repeat(281))).toEqual({ refused: 'too_long' })
    expect(room.post(id(1), ' line one\nline two ')).toMatchObject({ message: { text: 'line one line two' } })
    expect(room.post(id(1), 'again')).toEqual({ refused: 'too_fast' })
    expect(room.post(id(2), 'someone else')).toHaveProperty('message')
    clock.at += 2000
    expect(room.post(id(1), 'again')).toHaveProperty('message')
  })
})

describe('owner', () => {
  it('marks what the owner writes, under the name they chose, and nobody else', () => {
    const owner = ownerFrom({ CHAT_OWNER_IDS: ` ${id(1)}, not-an-id ,${id(4)}`, CHAT_OWNER_NAME: 'Overlord' })
    expect([...owner.ids]).toEqual([id(1), id(4)])
    const room = createRoom(() => 0, Math.random, owner)
    expect(room.touch(id(1))).toBe('Overlord')
    expect(room.touch(id(4))).toBe('Overlord')
    expect(room.post(id(1), 'kneel')).toMatchObject({ message: { name: 'Overlord', owner: true } })
    const other = room.post(id(2), 'hello @overlord')
    expect(other).toMatchObject({ message: { to: ['Overlord'] } })
    expect('message' in other && other.message.owner).toBeUndefined()
  })

  it('has no owner unless told, and refuses a name that could be drawn for someone else', () => {
    expect(ownerFrom({}).ids.size).toBe(0)
    expect(ownerFrom({ CHAT_OWNER_NAME: 'SwiftFox07' }).name).toBeUndefined()
    expect(ownerFrom({ CHAT_OWNER_NAME: '<b>x</b>' }).name).toBeUndefined()
  })
})

describe('pings', () => {
  it('calls on the writer of a message that is answered, and on anyone named with an @', () => {
    const { clock, room } = clocked()
    const [ann, ben, cat] = [1, 2, 3].map((n) => room.touch(id(n)))
    const first = room.post(id(1), 'anyone here?')
    if (!('message' in first)) throw new Error('refused')
    expect(first.message.to).toBeUndefined()
    expect(room.pinged(id(1))).toBe(0)

    const answer = room.post(id(2), `yes, and @${cat.toLowerCase()} too. not @nobody, not @${ben}`, first.message.seq)
    expect(answer).toMatchObject({ message: { reply: { seq: first.message.seq, name: ann, text: 'anyone here?' }, to: [ann, cat] } })
    const seq = 'message' in answer ? answer.message.seq : 0
    expect(room.pinged(id(1))).toBe(seq)
    expect(room.pinged(id(3))).toBe(seq)
    expect(room.pinged(id(2))).toBe(0)
    expect(room.pinged(id(9))).toBe(0)

    clock.at += 2000
    expect(room.post(id(1), 'answering one that is gone', 12345)).toMatchObject({ message: { text: 'answering one that is gone' } })
    expect(room.since(seq)[0].reply).toBeUndefined()
  })
})

describe('room api', () => {
  const as = (visitor: string, extra: RequestInit = {}) => ({ ...extra, headers: { 'X-Visitor': visitor, 'Content-Type': 'application/json' } })
  const say = (text: string) => ({ method: 'POST', body: JSON.stringify({ text }) })

  it('asks who is calling', async () => {
    const app = createApp({ clientDir: null })
    expect((await app.request('/api/presence')).status).toBe(400)
    expect((await app.request('/api/chat', as('not-an-id'))).status).toBe(400)
    expect((await app.request('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })).status).toBe(400)
    expect((await app.request('/api/chat', as(id(1), { method: 'POST', body: 'not json' }))).status).toBe(400)
  })

  it('counts visitors and carries a message from one to another without naming the sender\'s id', async () => {
    const app = createApp({ clientDir: null })
    await app.request('/api/presence', as(id(1)))
    expect(await (await app.request('/api/presence', as(id(2)))).json()).toEqual({ online: 2, pinged: 0 })

    const posted = await app.request('/api/chat', as(id(1), say('hello')))
    expect(posted.status).toBe(200)
    expect((await app.request('/api/chat', as(id(1), say('too soon')))).status).toBe(429)

    const res = await app.request('/api/chat?after=0', as(id(2)))
    expect(res.headers.get('cache-control')).toBe('no-store')
    const raw = await res.text()
    const body = JSON.parse(raw) as ChatResponse
    expect(body.messages).toMatchObject([{ text: 'hello' }])
    expect(body.messages[0].name).not.toBe(body.name)
    expect(raw).not.toContain(id(1))
    const later = await app.request(`/api/chat?after=${body.messages[0].seq}`, as(id(2)))
    expect(await later.json()).toMatchObject({ messages: [] })
  })

  it('refuses a body far larger than a message', async () => {
    const app = createApp({ clientDir: null })
    const res = await app.request('/api/chat', as(id(1), say('x'.repeat(5000))))
    expect(res.status).toBe(413)
  })
})

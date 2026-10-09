import { CHAT_MAX_TEXT, type ChatMessage, type ChatRefusal } from '../../shared/room'

const ONLINE_MS = 90_000
const KEEP_MS = 24 * 3600_000
const SWEEP_MS = 60_000
const MAX_VISITORS = 10_000
const MAX_MESSAGES = 100
const POST_GAP_MS = 2000
const MAX_PINGS = 5
const QUOTE_CHARS = 80

const ADJECTIVES = [
  'Amber', 'Arctic', 'Bold', 'Brisk', 'Calm', 'Clever', 'Copper', 'Crimson', 'Dusty', 'Eager',
  'Fleet', 'Foggy', 'Gentle', 'Golden', 'Grey', 'Hardy', 'Hidden', 'Icy', 'Jolly', 'Keen',
  'Lone', 'Lucky', 'Mellow', 'Misty', 'Nimble', 'Northern', 'Pale', 'Patient', 'Quick', 'Quiet',
  'Rapid', 'Rusty', 'Salty', 'Silent', 'Silver', 'Steady', 'Stormy', 'Swift', 'Tidal', 'Wary',
]
const ANIMALS = [
  'Badger', 'Bear', 'Beaver', 'Bison', 'Crane', 'Crow', 'Deer', 'Eagle', 'Elk', 'Falcon',
  'Finch', 'Fox', 'Gull', 'Hare', 'Hawk', 'Heron', 'Hornet', 'Kite', 'Lynx', 'Marten',
  'Mink', 'Moose', 'Osprey', 'Otter', 'Owl', 'Perch', 'Pike', 'Raven', 'Robin', 'Seal',
  'Shrike', 'Stoat', 'Stork', 'Swan', 'Swift', 'Tern', 'Vole', 'Wolf', 'Wren', 'Zander',
]

interface Visitor {
  seen: number
  name: string
  postedAt: number
}

export interface Room {
  /** Marks the visitor as here now and returns the name they go by. */
  touch(id: string): string
  online(): number
  /** `replyTo` is the seq of the message being answered; one that has scrolled away is quietly dropped. */
  post(id: string, text: string, replyTo?: number): { message: ChatMessage } | { refused: ChatRefusal }
  /** The newest message that calls on this visitor, or 0. */
  pinged(id: string): number
  since(seq: number): ChatMessage[]
}

/**
 * Who is on the site and what they have said, held in memory: the process is stopped when the
 * site goes quiet, and the room empties with it.
 */
export function createRoom(now: () => number = Date.now, random: () => number = Math.random): Room {
  const visitors = new Map<string, Visitor>()
  /** Lower case to the name as given, so an @ finds its visitor however it was typed. */
  const names = new Map<string, string>()
  const messages: ChatMessage[] = []
  // Starts at the clock rather than at one, so a browser's "after" still works across a restart.
  let seq = now()
  let sweptAt = now()

  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)]

  function freshName(): string {
    for (;;) {
      const name = `${pick(ADJECTIVES)}${pick(ANIMALS)}${String(Math.floor(random() * 100)).padStart(2, '0')}`
      if (!names.has(name.toLowerCase())) return name
    }
  }

  function sweep(at: number): void {
    sweptAt = at
    for (const [id, visitor] of visitors) {
      if (at - visitor.seen < KEEP_MS) continue
      visitors.delete(id)
      names.delete(visitor.name.toLowerCase())
    }
  }

  function visit(id: string): Visitor {
    const at = now()
    if (at - sweptAt >= SWEEP_MS) sweep(at)
    let visitor = visitors.get(id)
    if (!visitor) {
      // ponytail: the table is simply emptied when it grows large, and everyone is renamed; evict the longest unseen if that ever shows up in practice.
      if (visitors.size >= MAX_VISITORS) {
        visitors.clear()
        names.clear()
      }
      visitor = { seen: at, name: freshName(), postedAt: -Infinity }
      visitors.set(id, visitor)
      names.set(visitor.name.toLowerCase(), visitor.name)
    }
    visitor.seen = at
    return visitor
  }

  return {
    touch: (id) => visit(id).name,

    online() {
      const at = now()
      let count = 0
      for (const visitor of visitors.values()) if (at - visitor.seen < ONLINE_MS) count += 1
      return count
    },

    post(id, raw, replyTo) {
      const visitor = visit(id)
      const text = raw.replace(/\p{Cc}+/gu, ' ').trim()
      if (!text) return { refused: 'empty' }
      if (text.length > CHAT_MAX_TEXT) return { refused: 'too_long' }
      const at = now()
      if (at - visitor.postedAt < POST_GAP_MS) return { refused: 'too_fast' }
      visitor.postedAt = at
      const message: ChatMessage = { seq: ++seq, at, name: visitor.name, text }
      const target = replyTo === undefined ? undefined : messages.find((earlier) => earlier.seq === replyTo)
      if (target) message.reply = { seq: target.seq, name: target.name, text: target.text.slice(0, QUOTE_CHARS) }
      const called = [target?.name, ...Array.from(text.matchAll(/@(\w+)/g), (match) => names.get(match[1].toLowerCase()))]
      const to = [...new Set(called.filter((name) => name !== undefined && name !== visitor.name))].slice(0, MAX_PINGS) as string[]
      if (to.length > 0) message.to = to
      messages.push(message)
      if (messages.length > MAX_MESSAGES) messages.shift()
      return { message }
    },

    since: (after) => messages.filter((message) => message.seq > after),

    pinged(id) {
      const name = visitors.get(id)?.name
      return (name && messages.findLast((message) => message.to?.includes(name))?.seq) || 0
    },
  }
}

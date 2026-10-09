import { createHash } from 'node:crypto'
import { CHAT_MAX_TEXT, type ChatMessage, type ChatRefusal, type Identity, type NameRefusal, isChatName, isVisitorId } from '../../shared/room'

const ONLINE_MS = 90_000
const KEEP_MS = 24 * 3600_000
const SWEEP_MS = 60_000
const MAX_VISITORS = 10_000
const MAX_MESSAGES = 100
const POST_GAP_MS = 2000
const MAX_PINGS = 5
const QUOTE_CHARS = 80
const RENAME_GAP_MS = 3000
/** Hex digits of a public id: 64 bits, too many to find a second browser that shares one. */
const UID_CHARS = 16
/** Browsers one address may hold in the room, and how many of them the count of visitors believes. */
const MAX_PER_ADDRESS = 20
const ONLINE_PER_ADDRESS = 5
/** Marks that reorder text on screen, so a message cannot read as something it does not say. */
const DIRECTION_MARKS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

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
  uid: string
  seen: number
  name: string
  owner: boolean
  /** Where they last called from, when the host says. */
  address?: string
  renamedAt: number
  postedAt: number
}

export interface Room {
  /** Marks the visitor as here now and returns the name they go by. */
  touch(id: string, address?: string): string
  /** The same, with the public id that stays theirs. */
  me(id: string): Identity
  /** Takes the name asked for, or draws a new one when none is. */
  rename(id: string, wanted?: string): Identity | { refused: NameRefusal }
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
export interface Owner {
  /** The browsers that are the owner's: their visitor ids. */
  ids: ReadonlySet<string>
  /** The name the owner writes under, in place of a drawn one. */
  name?: string
}

/**
 * Who the owner is, from CHAT_OWNER_IDS (visitor ids, comma-separated) and CHAT_OWNER_NAME. There is
 * no login: the id a browser made up for itself is the only thing that tells the owner's from anyone's.
 */
export function ownerFrom(env: NodeJS.ProcessEnv): Owner {
  const ids = new Set((env.CHAT_OWNER_IDS ?? '').split(',').map((id) => id.trim()).filter(isVisitorId))
  const name = env.CHAT_OWNER_NAME?.trim()
  // A drawn name always ends in two digits, so one that does not can never be drawn for someone else.
  return { ids, name: name && /^\w{2,20}$/.test(name) && !/\d\d$/.test(name) ? name : undefined }
}

/** CHAT_BANNED_IDS: the public ids (comma-separated, with or without the #) of browsers that may read the room and not write in it. */
export function bannedFrom(env: NodeJS.ProcessEnv): Set<string> {
  const ids = (env.CHAT_BANNED_IDS ?? '').split(',').map((id) => id.trim().replace(/^#/, '').toLowerCase())
  return new Set(ids.filter((id) => new RegExp(`^[0-9a-f]{${UID_CHARS}}$`).test(id)))
}

export function createRoom(
  now: () => number = Date.now,
  random: () => number = Math.random,
  owner: Owner = { ids: new Set() },
  banned: ReadonlySet<string> = new Set(),
): Room {
  /** In the order they were last heard from: the first is the one silent the longest. */
  const visitors = new Map<string, Visitor>()
  /** Every name in use, in lower case: two visitors never differ by capitals alone. */
  const names = new Set<string>()
  // Nobody else can take the owner's name, even before the owner first turns up.
  const reserved = owner.name?.toLowerCase()
  if (reserved) names.add(reserved)
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

  function release(name: string): void {
    if (name.toLowerCase() !== reserved) names.delete(name.toLowerCase())
  }

  function evict(id: string): void {
    const visitor = visitors.get(id)
    if (!visitor) return
    visitors.delete(id)
    release(visitor.name)
  }

  function sweep(at: number): void {
    sweptAt = at
    for (const [id, visitor] of visitors) {
      if (at - visitor.seen < KEEP_MS) continue
      visitors.delete(id)
      release(visitor.name)
    }
  }

  function visit(id: string, address?: string): Visitor {
    const at = now()
    if (at - sweptAt >= SWEEP_MS) sweep(at)
    let visitor = visitors.get(id)
    if (!visitor) {
      // One address cannot fill the room with made-up browsers: past a few, its own oldest makes room.
      // ponytail: the whole table is read for each new browser; keep a per-address list if the room ever fills.
      if (address) {
        const theirs = [...visitors].filter(([, other]) => other.address === address)
        if (theirs.length >= MAX_PER_ADDRESS) evict(theirs[0][0])
      }
      // A full room loses the visitor silent the longest, never everyone at once.
      if (visitors.size >= MAX_VISITORS) evict(visitors.keys().next().value!)
      const isOwner = owner.ids.has(id)
      // A fingerprint of the secret: the same for good, and no way back from it to the secret.
      const uid = createHash('sha256').update(id).digest('hex').slice(0, UID_CHARS)
      visitor = { uid, seen: at, name: (isOwner && owner.name) || freshName(), owner: isOwner, postedAt: -Infinity, renamedAt: -Infinity }
      names.add(visitor.name.toLowerCase())
    }
    // Taken out and put back, which moves them to the end: the order is who was heard from last.
    visitors.delete(id)
    visitors.set(id, visitor)
    visitor.seen = at
    if (address) visitor.address = address
    return visitor
  }

  return {
    touch: (id, address) => visit(id, address).name,

    me(id) {
      const { uid, name } = visit(id)
      return { id: uid, name }
    },

    rename(id, wanted) {
      const visitor = visit(id)
      if (wanted !== undefined && !isChatName(wanted)) return { refused: 'bad_name' }
      if (wanted?.toLowerCase() !== visitor.name.toLowerCase()) {
        const theirs = visitor.owner && wanted?.toLowerCase() === reserved
        if (wanted && names.has(wanted.toLowerCase()) && !theirs) return { refused: 'taken' }
        const at = now()
        if (at - visitor.renamedAt < RENAME_GAP_MS) return { refused: 'too_fast' }
        visitor.renamedAt = at
        release(visitor.name)
        visitor.name = wanted ?? freshName()
        names.add(visitor.name.toLowerCase())
      } else if (wanted) visitor.name = wanted
      return { id: visitor.uid, name: visitor.name }
    },

    online() {
      const at = now()
      let count = 0
      // Past a household's worth, more browsers at one address are not believed.
      const perAddress = new Map<string, number>()
      for (const visitor of visitors.values()) {
        if (at - visitor.seen >= ONLINE_MS) continue
        const sharing = visitor.address ? (perAddress.get(visitor.address) ?? 0) + 1 : 1
        if (visitor.address) perAddress.set(visitor.address, sharing)
        if (sharing <= ONLINE_PER_ADDRESS) count += 1
      }
      return count
    },

    post(id, raw, replyTo) {
      const visitor = visit(id)
      if (banned.has(visitor.uid)) return { refused: 'banned' }
      const text = raw.replace(DIRECTION_MARKS, '').replace(/\p{Cc}+/gu, ' ').trim()
      if (!text) return { refused: 'empty' }
      if (text.length > CHAT_MAX_TEXT) return { refused: 'too_long' }
      const at = now()
      if (at - visitor.postedAt < POST_GAP_MS) return { refused: 'too_fast' }
      visitor.postedAt = at
      const message: ChatMessage = { seq: ++seq, at, uid: visitor.uid, name: visitor.name, text }
      if (visitor.owner) message.owner = true
      const target = replyTo === undefined ? undefined : messages.find((earlier) => earlier.seq === replyTo)
      if (target) message.reply = { seq: target.seq, name: target.name, text: target.text.slice(0, QUOTE_CHARS) }
      const named = new Set(Array.from(text.matchAll(/@(\w+)/g), (match) => match[1].toLowerCase()))
      const called = target ? [target.uid] : []
      // ponytail: every visitor is looked at for each message that names someone; keep a name-to-visitor table if the room ever fills.
      if (named.size > 0) for (const other of visitors.values()) if (named.has(other.name.toLowerCase())) called.push(other.uid)
      const to = [...new Set(called)].filter((uid) => uid !== visitor.uid).slice(0, MAX_PINGS)
      if (to.length > 0) message.to = to
      messages.push(message)
      if (messages.length > MAX_MESSAGES) messages.shift()
      return { message }
    },

    since: (after) => messages.filter((message) => message.seq > after),

    pinged(id) {
      const uid = visitors.get(id)?.uid
      return (uid && messages.findLast((message) => message.to?.includes(uid))?.seq) || 0
    },
  }
}

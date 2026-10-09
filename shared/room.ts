/** What the presence and chat routes send. A visitor's own id is never part of it. */
export interface ChatMessage {
  seq: number
  at: number
  /** The writer's public id: theirs for good, whatever name they go by. */
  uid: string
  /** The name they went by when they wrote it. */
  name: string
  text: string
  /** The message this one answers, as it read when the answer was written. */
  reply?: { seq: number; name: string; text: string }
  /** Who it calls on, by public id: the writer of the message answered, and everyone named with an @. */
  to?: string[]
  /** Written by the site's owner. */
  owner?: true
}

export interface PresenceResponse {
  online: number
  /** The newest message that calls on this visitor, or 0. */
  pinged: number
}

/** Who a visitor is to everyone else. The id is worked out from the secret their browser keeps, and cannot be turned back into it. */
export interface Identity {
  id: string
  name: string
}

export type NameRefusal = 'bad_name' | 'taken' | 'too_fast'

/** Three to twenty letters, digits or underscores: what an @ can find. */
export const isChatName = (value: unknown): value is string => typeof value === 'string' && /^\w{3,20}$/.test(value)

export interface ChatResponse extends Identity {
  messages: ChatMessage[]
}

export type ChatRefusal = 'empty' | 'too_long' | 'too_fast' | 'banned'

export const CHAT_MAX_TEXT = 280

/** The header a browser names itself with: 32 hex digits it made up and keeps. */
export const VISITOR_HEADER = 'X-Visitor'
export const isVisitorId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

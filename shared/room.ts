/** What the presence and chat routes send. A visitor's own id is never part of it. */
export interface ChatMessage {
  seq: number
  at: number
  name: string
  text: string
}

export interface PresenceResponse {
  online: number
}

export interface ChatResponse {
  /** The name this visitor writes under. */
  name: string
  messages: ChatMessage[]
}

export type ChatRefusal = 'empty' | 'too_long' | 'too_fast'

export const CHAT_MAX_TEXT = 280

/** The header a browser names itself with: 32 hex digits it made up and keeps. */
export const VISITOR_HEADER = 'X-Visitor'
export const isVisitorId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

import { create } from 'zustand'
import type { ChatMessage, ChatResponse, Identity } from '../../../../shared/room'
import { roomFetch } from '../../../runtime/visitor'

/** A name the visitor chose, kept so it can be asked for again after the server has forgotten it. */
const NAME_KEY = 'pwh-name'

function savedName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY)
  } catch {
    return null
  }
}

function saveName(name: string | null): void {
  try {
    if (name) localStorage.setItem(NAME_KEY, name)
    else localStorage.removeItem(NAME_KEY)
  } catch {
    // Storage can be switched off; the name then lasts as long as the server remembers it.
  }
}

interface ChatState {
  /** This browser's public id, once the server has said. It never changes. */
  id: string | null
  /** The name the server gave this browser, once it has. */
  name: string | null
  messages: ChatMessage[]
  /** The room could not be reached on the last try. */
  down: boolean
  /** Why the last message was turned away: the server's own word for it. */
  refused: string | null
  poll(): Promise<void>
  /** True when the message went through. */
  send(text: string, replyTo?: number): Promise<boolean>
  /** Why the last change of name was turned away. */
  nameRefused: string | null
  /** Learns who this browser is, and asks for the name it chose before if the server has forgotten it. */
  identify(): Promise<void>
  /** Takes the name given, or a newly drawn one when none is. True when it went through. */
  rename(name?: string): Promise<boolean>
}

const KEPT = 200

function merge(have: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  const last = have.at(-1)?.seq ?? 0
  const fresh = more.filter((message) => message.seq > last)
  return fresh.length > 0 ? [...have, ...fresh].slice(-KEPT) : have
}

export const useChat = create<ChatState>()((set, get) => ({
  id: null,
  name: null,
  nameRefused: null,
  messages: [],
  down: false,
  refused: null,

  async poll() {
    try {
      const res = await roomFetch(`/api/chat?after=${get().messages.at(-1)?.seq ?? 0}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as ChatResponse
      set((s) => ({ id: body.id, name: body.name, messages: merge(s.messages, body.messages), down: false }))
    } catch {
      set({ down: true })
    }
  },

  async identify() {
    try {
      const res = await roomFetch('/api/me')
      if (!res.ok) return
      const me = (await res.json()) as Identity
      set({ id: me.id, name: me.name })
      const chosen = savedName()
      if (chosen && chosen !== me.name && !(await get().rename(chosen))) set({ nameRefused: null })
    } catch {
      // The chat's own polling says when the room cannot be reached.
    }
  },

  async rename(name) {
    set({ nameRefused: null })
    try {
      const res = await roomFetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const body = (await res.json()) as Partial<Identity> & { error?: string }
      if (!res.ok || !body.name || !body.id) {
        set({ nameRefused: body.error ?? 'failed' })
        return false
      }
      saveName(name ? body.name : null)
      set({ id: body.id, name: body.name })
      return true
    } catch {
      set({ nameRefused: 'failed' })
      return false
    }
  },

  async send(text, replyTo) {
    set({ refused: null })
    try {
      const res = await roomFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, replyTo }) })
      const body = (await res.json()) as { message?: ChatMessage; error?: string }
      if (!res.ok || !body.message) {
        set({ refused: body.error ?? 'failed' })
        return false
      }
      const { message } = body
      set((s) => ({ messages: merge(s.messages, [message]) }))
      return true
    } catch {
      set({ refused: 'failed' })
      return false
    }
  },
}))

import { create } from 'zustand'
import type { ChatMessage, ChatResponse } from '../../../../shared/room'
import { roomFetch } from '../../../runtime/visitor'

interface ChatState {
  /** The name the server gave this browser, once it has. */
  name: string | null
  messages: ChatMessage[]
  /** The room could not be reached on the last try. */
  down: boolean
  /** Why the last message was turned away: the server's own word for it. */
  refused: string | null
  poll(): Promise<void>
  /** True when the message went through. */
  send(text: string): Promise<boolean>
}

const KEPT = 200

function merge(have: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  const last = have.at(-1)?.seq ?? 0
  const fresh = more.filter((message) => message.seq > last)
  return fresh.length > 0 ? [...have, ...fresh].slice(-KEPT) : have
}

export const useChat = create<ChatState>()((set, get) => ({
  name: null,
  messages: [],
  down: false,
  refused: null,

  async poll() {
    try {
      const res = await roomFetch(`/api/chat?after=${get().messages.at(-1)?.seq ?? 0}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as ChatResponse
      set((s) => ({ name: body.name, messages: merge(s.messages, body.messages), down: false }))
    } catch {
      set({ down: true })
    }
  },

  async send(text) {
    set({ refused: null })
    try {
      const res = await roomFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
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

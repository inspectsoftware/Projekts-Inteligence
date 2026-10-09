import { VISITOR_HEADER, isVisitorId } from '../../shared/room'

const KEY = 'pwh-visitor'

let id: string | null = null

/** A random id this browser keeps, so two tabs count as one visitor. It says nothing about who is using it. */
export function visitorId(): string {
  if (id) return id
  try {
    const stored = localStorage.getItem(KEY)
    if (isVisitorId(stored)) return (id = stored)
  } catch {
    // Storage can be switched off; the id then lasts as long as the page.
  }
  id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // As above.
  }
  return id
}

/** fetch() for the presence and chat routes, which ask who is calling. */
export function roomFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...init.headers, [VISITOR_HEADER]: visitorId() } })
}

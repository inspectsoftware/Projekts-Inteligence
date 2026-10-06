import { USER_AGENT, UpstreamError } from './upstream'

/** The slice of the WebSocket API this module uses, so tests can supply a fake. */
export interface SocketLike {
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  close(): void
}

export type SocketFactory = (url: string) => SocketLike

export interface StreamOptions {
  /** Shown in error messages instead of the URL. */
  name: string
  url: string
  /** Close the upstream this long after anyone last asked for its data. */
  idleCloseMs: number
  /**
   * Called for every text frame. Must keep whatever state it builds bounded.
   * Returns whether there is now something to serve: a connection only counts as
   * ready once that is true, since the first frames are often greetings or metadata.
   */
  onMessage(raw: string, receivedAt: number): boolean
  /** Called when the connection drops, so stale state can be discarded. */
  onClose?(): void
  createSocket?: SocketFactory
  now?(): number
}

const RECONNECT_BACKOFF_MS = [0, 2000, 5000, 15_000, 30_000]

function defaultSocketFactory(url: string): SocketLike {
  const Impl = (globalThis as { WebSocket?: new (url: string, options?: unknown) => SocketLike }).WebSocket
  if (!Impl) throw new UpstreamError('network', 'This Node.js version has no WebSocket client')
  // Node's client accepts request headers as a second argument; browsers would not.
  return new Impl(url, { headers: { 'User-Agent': USER_AGENT } })
}

/**
 * One upstream WebSocket, opened only while someone is actually asking for its data.
 *
 * An always-on connection is not possible on Hostinger: the process is stopped when
 * traffic goes quiet, and an outbound socket does not count as traffic. So the socket
 * is opened by the first request, shared by every request after it, and closed again
 * once requests stop coming.
 */
export class LazyStream {
  private socket: SocketLike | null = null
  private hasData = false
  private lastTouched = 0
  private failures = 0
  private nextConnectAt = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private waiters: (() => void)[] = []
  private readonly options: StreamOptions
  private readonly now: () => number

  constructor(options: StreamOptions) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  get connected(): boolean {
    return this.socket !== null && this.hasData
  }

  /**
   * Marks the stream as wanted, connecting if needed, and resolves once the current
   * connection has delivered something usable.
   */
  async ready(timeoutMs: number): Promise<void> {
    this.touch()
    if (this.hasData) return
    if (!this.socket) throw new UpstreamError('network', `${this.options.name} is reconnecting`)

    await new Promise<void>((resolve, reject) => {
      const onData = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== onData)
        reject(new UpstreamError('timeout', `${this.options.name} sent nothing in time`))
      }, timeoutMs)
      this.waiters.push(onData)
    })
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const socket = this.socket
    this.drop()
    socket?.close()
  }

  private touch(): void {
    this.lastTouched = this.now()
    if (!this.socket && this.now() >= this.nextConnectAt) this.connect()
    if (!this.idleTimer) this.scheduleIdleCheck()
  }

  private scheduleIdleCheck(): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.now() - this.lastTouched >= this.options.idleCloseMs) this.close()
      else this.scheduleIdleCheck()
    }, this.options.idleCloseMs)
    // Never keep the process alive just to close a socket later.
    this.idleTimer.unref?.()
  }

  private connect(): void {
    let socket: SocketLike
    try {
      socket = (this.options.createSocket ?? defaultSocketFactory)(this.options.url)
    } catch (err) {
      this.failed()
      throw err
    }
    this.socket = socket

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      const usable = this.options.onMessage(event.data, this.now())
      this.failures = 0
      if (usable && !this.hasData) {
        this.hasData = true
        for (const waiter of this.waiters.splice(0)) waiter()
      }
    })
    const onGone = () => {
      if (this.socket !== socket) return
      this.drop()
      this.failed()
    }
    socket.addEventListener('close', onGone)
    socket.addEventListener('error', onGone)
  }

  private drop(): void {
    this.socket = null
    this.hasData = false
    this.options.onClose?.()
  }

  private failed(): void {
    this.failures += 1
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.failures, RECONNECT_BACKOFF_MS.length - 1)]
    this.nextConnectAt = this.now() + delay
  }
}

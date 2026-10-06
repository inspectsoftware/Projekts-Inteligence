import { APP } from '../../shared/meta'

/** Sent on every upstream request, so operators can tell who is calling and why. */
export const USER_AGENT = `${APP.name.replaceAll(' ', '')}/0.1 (non-commercial Latvia OSINT dashboard)`

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export type UpstreamFailure = 'timeout' | 'network' | 'http' | 'too-large' | 'forbidden-origin' | 'bad-body'

export class UpstreamError extends Error {
  readonly kind: UpstreamFailure
  readonly status?: number
  /** How long the upstream asked us to stay away, when it said so. */
  readonly retryAfterMs?: number

  constructor(kind: UpstreamFailure, message: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.kind = kind
    this.status = extra.status
    this.retryAfterMs = extra.retryAfterMs
  }
}

export interface RequestOptions {
  headers?: Record<string, string>
  maxBytes?: number
  /** Budget for this one request, on top of the refresh's overall deadline. */
  timeoutMs?: number
}

export interface Upstream {
  json<T = unknown>(url: string, options?: RequestOptions): Promise<T>
  text(url: string, options?: RequestOptions): Promise<string>
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/**
 * A fetch that can only reach the origins a feed declared. The server never
 * requests a URL chosen by a visitor, so it cannot be used as an open proxy.
 */
export function createUpstream(origins: readonly string[], signal: AbortSignal, fetchImpl: FetchLike = fetch): Upstream {
  async function request(url: string, options: RequestOptions = {}): Promise<string> {
    const { origin, host } = new URL(url)
    if (!origins.includes(origin)) {
      throw new UpstreamError('forbidden-origin', `${host} is not an allowed origin for this feed`)
    }

    const deadline = options.timeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]) : signal
    let res: Response
    try {
      res = await fetchImpl(url, {
        signal: deadline,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*', ...options.headers },
      })
    } catch (err) {
      if (deadline.aborted) throw new UpstreamError('timeout', `${host} did not answer in time`)
      throw new UpstreamError('network', `${host} could not be reached (${(err as Error).name})`)
    }

    // A redirect may not lead anywhere the feed did not declare.
    if (res.url && !origins.includes(new URL(res.url).origin)) {
      throw new UpstreamError('forbidden-origin', `${host} redirected to an origin this feed may not use`)
    }
    if (!res.ok) {
      throw new UpstreamError('http', `${host} answered HTTP ${res.status}`, {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      })
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    const body = await res.arrayBuffer()
    if (body.byteLength > maxBytes) {
      throw new UpstreamError('too-large', `${host} sent ${body.byteLength} bytes, more than this feed accepts`)
    }
    return new TextDecoder().decode(body)
  }

  return {
    text: request,
    async json<T>(url: string, options?: RequestOptions): Promise<T> {
      const body = await request(url, options)
      try {
        return JSON.parse(body) as T
      } catch {
        throw new UpstreamError('bad-body', `${new URL(url).host} did not send valid JSON`)
      }
    },
  }
}

import type { Entity } from '../../shared/entity'
import type { ConflictProps } from '../../shared/feeds'
import { UpstreamError } from '../core/upstream'
import type { FeedDef } from './types'

const HOUR = 3600 * 1000
const API = 'https://ucdpapi.pcr.uu.se'
/** A month of fighting worldwide is some thousands of events; the map shows the deadliest. */
const LIMIT = 3000

interface Page {
  TotalPages: number
  Result: {
    id: number
    latitude: number
    longitude: number
    date_start: string
    date_end: string
    best: number
    country: string
    conflict_name: string
    side_a: string
    side_b: string
    where_description?: string
    type_of_violence: number
  }[]
}

const KIND = { 1: 'state-based', 2: 'non-state', 3: 'one-sided' } as const

/**
 * The monthly candidate release is numbered year.0.month ("26.0.9" holds September 2026) and comes
 * out some weeks into the next month, so the newest that exists is one or two months back.
 */
export function candidateVersions(now: number): string[] {
  const date = new Date(now)
  return [1, 2, 3].map((back) => {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1))
    return `${month.getUTCFullYear() % 100}.0.${month.getUTCMonth() + 1}`
  })
}

/**
 * Armed-conflict events of the latest month from the Uppsala Conflict Data Program: where, between
 * whom, and how many died. A month behind by design, and behind a token UCDP hands out by email.
 * ponytail: written from UCDP's API documentation and never run against the live service, which
 * needs the token. Expect to adjust field names on first contact.
 */
export const conflictsFeed: FeedDef = {
  id: 'conflicts',
  title: 'Armed conflict events',
  origins: [API],
  ttlMs: 24 * HOUR,
  staleMs: 14 * 24 * HOUR,
  timeoutMs: 120_000,
  persist: true,
  requiresEnv: ['UCDP_TOKEN'],
  attribution: [{ label: 'UCDP Candidate Events Dataset', href: 'https://ucdp.uu.se' }],
  async load({ http, env, now }) {
    const headers = { 'x-ucdp-access-token': env.UCDP_TOKEN ?? '' }
    const versions = env.UCDP_VERSION ? [env.UCDP_VERSION] : candidateVersions(now)
    let failure: unknown
    for (const version of versions) {
      try {
        const events: Entity<ConflictProps>[] = []
        for (let page = 0, pages = 1; page < pages && page < 10; page += 1) {
          const body = await http.json<Page>(`${API}/api/gedevents/${version}?pagesize=1000&page=${page}`, { headers, timeoutMs: 30_000 })
          pages = body.TotalPages
          for (const event of body.Result) {
            if (!Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)) continue
            events.push({
              id: `conflict:${event.id}`,
              kind: 'conflict',
              lon: event.longitude,
              lat: event.latitude,
              label: event.country,
              ts: Date.parse(event.date_end),
              flags: 0,
              props: {
                from: Date.parse(event.date_start),
                to: Date.parse(event.date_end),
                deaths: event.best,
                country: event.country,
                conflict: event.conflict_name,
                sides: [event.side_a, event.side_b],
                where: event.where_description ?? '',
                kind: KIND[event.type_of_violence as 1 | 2 | 3] ?? 'state-based',
              },
            })
          }
        }
        if (events.length > 0) return { shape: 'entities', entities: events.sort((a, b) => b.props.deaths - a.props.deaths).slice(0, LIMIT) }
      } catch (err) {
        // A release that is not out yet answers 404: try the month before.
        failure = err
        if (!(err instanceof UpstreamError) || err.status !== 404) throw err
      }
    }
    throw failure ?? new UpstreamError('bad-body', 'UCDP sent no events')
  },
}

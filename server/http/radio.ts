import type { RadioBy, RadioStation } from '../../shared/radio'
import { type FetchLike, createUpstream } from '../core/upstream'

/** The directory's round-robin name first, then two of its servers by name in case that one is out. */
const MIRRORS = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info']
const FRESH_MS = 10 * 60_000
const MAX_HELD = 200
const LIMIT = 80

interface RawStation {
  stationuuid?: string
  name?: string
  url?: string
  url_resolved?: string
  homepage?: string
  tags?: string
  country?: string
  codec?: string
  bitrate?: number
  hls?: number
}

function httpsUrl(value: string | undefined): string | null {
  try {
    return value && new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** The stations a browser on an https page can play with a plain audio element: https streams that are not HLS playlists. */
export function normaliseStations(raw: readonly RawStation[]): RadioStation[] {
  const seen = new Set<string>()
  const stations: RadioStation[] = []
  for (const entry of raw) {
    const url = httpsUrl(entry.url_resolved) ?? httpsUrl(entry.url)
    const name = entry.name?.trim().slice(0, 80)
    if (!entry.stationuuid || !name || !url || entry.hls || seen.has(url)) continue
    seen.add(url)
    stations.push({
      id: entry.stationuuid,
      name,
      url,
      country: entry.country?.trim() ?? '',
      tags: (entry.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 4),
      codec: entry.codec?.trim() ?? '',
      bitrate: Number(entry.bitrate) || 0,
      homepage: httpsUrl(entry.homepage),
    })
  }
  return stations
}

/**
 * Radio stations anywhere, from the Radio Browser community directory. Only the search goes through
 * here; the sound never does. Answers are shared for ten minutes per search, so the directory hears
 * from us once however many visitors look for the same thing.
 */
export function createRadioSearch(fetchImpl?: FetchLike, now: () => number = Date.now): { search(by: RadioBy, query: string): Promise<RadioStation[]> } {
  const held = new Map<string, { at: number; stations: Promise<RadioStation[]> }>()

  async function read(by: RadioBy, query: string): Promise<RadioStation[]> {
    const http = createUpstream(MIRRORS, AbortSignal.timeout(12_000), fetchImpl)
    const params = new URLSearchParams({ [by]: query, limit: String(LIMIT), hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true' })
    let failure: unknown
    for (const mirror of MIRRORS) {
      try {
        return normaliseStations(await http.json<RawStation[]>(`${mirror}/json/stations/search?${params}`, { timeoutMs: 5000 }))
      } catch (err) {
        failure = err
      }
    }
    throw failure
  }

  return {
    search(by, query) {
      const key = `${by}:${query.toLowerCase()}`
      const hit = held.get(key)
      if (hit && now() - hit.at < FRESH_MS) return hit.stations
      // The oldest search makes room.
      if (held.size >= MAX_HELD && !hit) held.delete(held.keys().next().value!)
      const stations = read(by, query)
      held.delete(key)
      held.set(key, { at: now(), stations })
      stations.catch(() => held.delete(key))
      return stations
    },
  }
}

import type { PlaceInfo } from '../../shared/feeds'
import { LANGS, type Lang } from '../../shared/i18n'
import { type FetchLike, type Upstream, createUpstream } from '../core/upstream'

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const WIKIDATA = 'https://query.wikidata.org'
const wikipedia = (lang: Lang) => `https://${lang}.wikipedia.org`
/** Everything a lookup may reach. A visitor chooses the coordinates or the words, never the host. */
const ORIGINS = [NOMINATIM, WIKIDATA, ...LANGS.map(wikipedia)]

const DAY = 24 * 3600 * 1000
const MAX_CACHED = 500
/** Nominatim's usage policy: one request a second at most, from the whole application. */
const SPACING_MS = 1100
const MAX_WAITING = 5

interface NominatimPlace {
  lat: string
  lon: string
  name?: string
  display_name: string
  addresstype?: string
  type?: string
  osm_type?: string
  osm_id?: number
  address?: Record<string, string>
  extratags?: Record<string, string> | null
  boundingbox?: [string, string, string, string]
  error?: string
}

interface Sparql {
  results: { bindings: Record<string, { value: string } | undefined>[] }
}

/** Address parts from the place outwards, as Nominatim names them; the place's own part is left out. */
const CHAIN = ['suburb', 'city_district', 'village', 'town', 'city', 'municipality', 'county', 'state_district', 'state', 'region', 'country']

export class PlaceBusy extends Error {}

export interface PlaceLookup {
  at(lon: number, lat: number, zoom: number, lang: Lang): Promise<PlaceInfo | null>
  search(query: string, lang: Lang): Promise<PlaceInfo | null>
}

/**
 * What is known about a place, from OpenStreetMap (Nominatim) and, where the place has an entry,
 * Wikidata and Wikipedia. Answers are kept for a day, and Nominatim is asked one question a second
 * at most however many visitors there are: past a short queue a lookup is refused, not piled up.
 */
export function createPlaceLookup(fetchImpl?: FetchLike, now: () => number = Date.now): PlaceLookup {
  const cache = new Map<string, { at: number; value: Promise<PlaceInfo | null> }>()
  let queue: Promise<unknown> = Promise.resolve()
  let waiting = 0

  function nominatim(http: Upstream, url: string): Promise<NominatimPlace | NominatimPlace[]> {
    if (waiting >= MAX_WAITING) throw new PlaceBusy('Too many place lookups are waiting')
    waiting += 1
    const turn = queue.then(() => http.json<NominatimPlace | NominatimPlace[]>(url, { timeoutMs: 10_000 }))
    queue = turn.catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve, SPACING_MS)))
    return turn.finally(() => {
      waiting -= 1
    })
  }

  async function describe(http: Upstream, place: NominatimPlace, lang: Lang): Promise<PlaceInfo> {
    const tags = place.extratags ?? {}
    const address = place.address ?? {}
    const kind = place.addresstype ?? place.type ?? 'place'
    const info: PlaceInfo = {
      name: place.name || place.display_name.split(',')[0],
      kind,
      display: place.display_name,
      lon: Number(place.lon),
      lat: Number(place.lat),
      country: address.country ?? null,
      countryCode: address.country_code?.toUpperCase() ?? null,
      chain: CHAIN.filter((part) => part !== kind && address[part]).map((part) => address[part]),
      population: Number(tags.population) || null,
      areaKm2: null,
      elevationM: Number(tags.ele) || null,
      website: /^https?:\/\//.test(tags.website ?? '') ? tags.website : null,
      extract: null,
      wiki: null,
      osm: place.osm_type && place.osm_id ? `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}` : null,
      bbox: place.boundingbox ? [Number(place.boundingbox[2]), Number(place.boundingbox[0]), Number(place.boundingbox[3]), Number(place.boundingbox[1])] : null,
    }

    // Only a well-formed id goes into the query: it comes from a tag anyone can edit.
    const entity = /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : null
    if (!entity) return info
    try {
      const article = (site: Lang, name: string) => `OPTIONAL { ?${name} schema:about wd:${entity}; schema:isPartOf <${wikipedia(site)}/>; schema:name ?${name}Title }`
      const query = `SELECT ?pop ?area ?elev ?ownTitle ?enTitle WHERE { OPTIONAL { wd:${entity} wdt:P1082 ?pop } OPTIONAL { wd:${entity} wdt:P2046 ?area } OPTIONAL { wd:${entity} wdt:P2044 ?elev } ${article(lang, 'own')} ${article('en', 'en')} } LIMIT 1`
      const facts = (await http.json<Sparql>(`${WIKIDATA}/sparql?format=json&query=${encodeURIComponent(query)}`, { timeoutMs: 8000 })).results.bindings[0] ?? {}
      info.population ??= Number(facts.pop?.value) || null
      info.areaKm2 = Number(facts.area?.value) || null
      info.elevationM ??= Number(facts.elev?.value) || null

      const [site, title] = facts.ownTitle ? [lang, facts.ownTitle.value] : facts.enTitle ? (['en', facts.enTitle.value] as const) : [null, null]
      if (site && title) {
        const summary = await http.json<{ extract?: string; content_urls?: { desktop?: { page?: string } } }>(
          `${wikipedia(site)}/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
          { timeoutMs: 8000 },
        )
        info.extract = summary.extract?.slice(0, 900) || null
        info.wiki = summary.content_urls?.desktop?.page ?? null
      }
    } catch {
      // The encyclopaedia being slow or down leaves the map's own facts, which is still an answer.
    }
    return info
  }

  function cached(key: string, load: (http: Upstream) => Promise<PlaceInfo | null>): Promise<PlaceInfo | null> {
    const hit = cache.get(key)
    if (hit && now() - hit.at < DAY) return hit.value
    // ponytail: emptied when full; an LRU if lookups ever become that popular.
    if (cache.size >= MAX_CACHED) cache.clear()
    const value = load(createUpstream(ORIGINS, AbortSignal.timeout(30_000), fetchImpl))
    cache.set(key, { at: now(), value })
    // A failure is not an answer worth keeping.
    value.catch(() => cache.delete(key))
    return value
  }

  return {
    at(lon, lat, zoom, lang) {
      // Three decimals is a hundred metres: near enough that two clicks on one village share an answer.
      const [x, y, z] = [lon.toFixed(3), lat.toFixed(3), Math.round(Math.min(18, Math.max(3, zoom)))]
      return cached(`at:${x}:${y}:${z}:${lang}`, async (http) => {
        const place = (await nominatim(http, `${NOMINATIM}/reverse?format=jsonv2&lat=${y}&lon=${x}&zoom=${z}&extratags=1&accept-language=${lang}`)) as NominatimPlace
        return place.error || !place.display_name ? null : describe(http, place, lang)
      })
    },
    search(query, lang) {
      const words = query.trim().toLowerCase().slice(0, 100)
      return cached(`q:${words}:${lang}`, async (http) => {
        const [place] = (await nominatim(http, `${NOMINATIM}/search?format=jsonv2&limit=1&addressdetails=1&extratags=1&accept-language=${lang}&q=${encodeURIComponent(words)}`)) as NominatimPlace[]
        return place ? describe(http, place, lang) : null
      })
    },
  }
}

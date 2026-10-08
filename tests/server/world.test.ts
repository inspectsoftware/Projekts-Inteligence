import { describe, expect, it, vi } from 'vitest'
import type { NewsSource, RawNews } from '../../shared/adapters/news'
import { normaliseGpsTxt } from '../../shared/adapters/transit'
import { advisoryLevel } from '../../server/feeds/advisories'
import { candidateVersions } from '../../server/feeds/conflicts'
import { pickNotices } from '../../server/feeds/notices'
import { PlaceBusy, createPlaceLookup } from '../../server/http/place'
import { ViewBusy, cellOf, createViewAircraft } from '../../server/http/viewAircraft'
import { normaliseQuakes } from '../../server/feeds/quakes'
import { pickFires } from '../../server/feeds/weather'
import type { Fire } from '../../shared/adapters/fires'

const NOW = Date.parse('2026-10-08T12:00:00Z')

describe('travel advisories', () => {
  it('ranks a warning about a whole country over one about part of it', () => {
    expect(advisoryLevel([])).toBe(0)
    expect(advisoryLevel(['avoid_all_but_essential_travel_to_parts'])).toBe(1)
    expect(advisoryLevel(['avoid_all_travel_to_parts', 'avoid_all_but_essential_travel_to_parts'])).toBe(2)
    expect(advisoryLevel(['avoid_all_but_essential_travel_to_whole_country', 'avoid_all_travel_to_parts'])).toBe(3)
    expect(advisoryLevel(['avoid_all_travel_to_whole_country'])).toBe(4)
  })
})

describe('conflict events', () => {
  it('asks for the newest monthly release first, across a year’s end', () => {
    expect(candidateVersions(NOW)).toEqual(['26.0.9', '26.0.8', '26.0.7'])
    expect(candidateVersions(Date.parse('2027-01-15T00:00:00Z'))).toEqual(['26.0.12', '26.0.11', '26.0.10'])
  })
})

describe('public alerts', () => {
  const source = (patch: Partial<NewsSource> = {}): NewsSource => ({
    id: 't', url: 'https://t.example/rss', publisher: 'LSM', group: 't', lang: 'lv', country: 'LV', kind: 'media', weight: 0.9, ai: 'none', ...patch,
  })
  const story = (title: string, desc = ''): RawNews => ({ title, link: `https://t.example/${encodeURIComponent(title)}`, at: NOW, desc, foreign: false })

  it('picks appeals and warnings out of headlines, with who sent them', () => {
    const picked = pickNotices([
      { item: story('Policija meklē bezvēsts pazudušu pusaudzi'), source: source({ publisher: 'State Police', kind: 'official' }) },
      { item: story('Missing child found safe in Tartu'), source: source({ publisher: 'ERR', lang: 'en', country: 'EE' }) },
      { item: story('Rīgā izsludināta gaisa trauksme'), source: source() },
      // Somebody else's sirens, and a story that only mentions an evacuation further down.
      { item: story('Air raid sirens sound across Kyiv'), source: source({ publisher: 'Kyiv Independent', country: 'INT' }) },
      { item: story('Fuel prices rise again', 'Residents recalled the evacuation of 2019.'), source: source() },
    ])
    expect(picked.map((notice) => [notice.kind, notice.issuer, notice.official])).toEqual([
      ['missing', 'State Police', true],
      ['missing', 'ERR', false],
      ['emergency', 'LSM', false],
    ])
  })
})

describe('public transport positions', () => {
  it('reads Tallinn and Vilnius in the same file format', () => {
    const tallinn = normaliseGpsTxt('3,T1,24669040,59461320,,316,98,Z,88,Kopli', { id: 'tallinn', name: 'Tallinn' }, NOW)
    expect(tallinn).toMatchObject([{ id: 'transit:tallinn:98', lon: 24.66904, lat: 59.46132, trk: 316, props: { mode: 'tram', route: 'T1' } }])
    const vilnius = normaliseGpsTxt('1,2,25283620,54670325,15,58,1565,-1,45,', { id: 'vilnius', name: 'Vilnius' }, NOW)
    expect(vilnius).toMatchObject([{ props: { mode: 'trolleybus', route: '2', network: 'Vilnius' } }])
  })
})

describe('place lookup', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const place = { lat: '56.5', lon: '21.0', name: 'Liepāja', display_name: 'Liepāja, Latvia', addresstype: 'city', address: { city: 'Liepāja', country: 'Latvia', country_code: 'lv' }, extratags: { population: '66746', wikidata: 'Q167668; DROP' } }

  it('answers from the map’s own facts, never sends a malformed id on, and asks once per place', async () => {
    const fetchImpl = vi.fn(async (_url: string) => json(place))
    const lookup = createPlaceLookup(fetchImpl, () => NOW)
    const first = await lookup.at(21.0101, 56.5201, 10.4, 'en')
    expect(first).toMatchObject({ name: 'Liepāja', kind: 'city', country: 'Latvia', countryCode: 'LV', chain: ['Latvia'], population: 66746, extract: null })
    // The same hundred metres at the same zoom is the same question.
    expect(await lookup.at(21.0102, 56.5203, 10, 'en')).toBe(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/)
  })

  it('adds political facts from Wikidata in the reader’s language, and leaves out what has no name', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://nominatim.')) return json({ ...place, name: 'Latvija', addresstype: 'country', extratags: { wikidata: 'Q211' } })
      if (url.startsWith('https://query.wikidata.org/')) {
        return json({ results: { bindings: [{ pop: { value: '1860000' }, area: { value: '64589' }, capitalLabel: { value: 'Rīga' }, headOfStateLabel: { value: 'Q12345' }, currencyLabel: { value: 'eiro' }, ownTitle: { value: 'Latvija' } }] } })
      }
      return json({ extract: 'Latvija ir valsts.', content_urls: { desktop: { page: 'https://lv.wikipedia.org/wiki/Latvija' } } })
    })
    const info = await createPlaceLookup(fetchImpl, () => NOW).at(24.6, 56.9, 3, 'lv')
    expect(info).toMatchObject({ kind: 'country', population: 1860000, areaKm2: 64589, extract: 'Latvija ir valsts.', wiki: 'https://lv.wikipedia.org/wiki/Latvija' })
    expect(info!.facts).toEqual([
      { key: 'capital', value: 'Rīga' },
      { key: 'currency', value: 'eiro' },
    ])
    const asked = decodeURIComponent(String(fetchImpl.mock.calls[1][0]))
    expect(asked).toContain('wd:Q211 wdt:P35 ?headOfState')
    expect(asked).toContain('wikibase:language "lv,en"')
    expect(String(fetchImpl.mock.calls[2][0])).toBe('https://lv.wikipedia.org/api/rest_v1/page/summary/Latvija')
  })

  it('refuses to queue more than a few questions for the one-a-second service', async () => {
    const lookup = createPlaceLookup(() => new Promise<Response>(() => {}), () => NOW)
    const asked = Array.from({ length: 5 }, (_, index) => lookup.search(`place ${index}`, 'en'))
    await expect(lookup.search('one too many', 'en')).rejects.toBeInstanceOf(PlaceBusy)
    expect(asked).toHaveLength(5)
  })
})

describe('world layers', () => {
  it('keeps every fire near the Baltic and only the strongest elsewhere', () => {
    const fire = (lon: number, lat: number, frpMw: number): Fire => ({ id: `fire:${lon},${lat},${frpMw}`, kind: 'fire', lon, lat, ts: NOW, flags: 0, props: { frpMw, brightnessK: null, confidence: null, satellite: null, night: false } })
    const far = Array.from({ length: 15_010 }, (_, index) => fire(-60, -10, index))
    const picked = pickFires([fire(24, 57, 0.1), ...far])
    expect(picked).toHaveLength(15_001)
    expect(picked[0]).toMatchObject({ lon: 24, lat: 57 })
    // The ten weakest of the far ones are the ones left out.
    expect(Math.min(...picked.slice(1).map((one) => one.props.frpMw!))).toBe(10)
  })

  it('reads earthquakes and nothing else from the survey’s list', () => {
    const feature = (type: string, mag: number | null) => ({ id: `us${type}${mag}`, geometry: { coordinates: [168.19, -15.54, 10] as [number, number, number] }, properties: { mag, place: '102 km NE of Norsup, Vanuatu', time: NOW, url: 'https://earthquake.usgs.gov/x', tsunami: 1, type } })
    const quakes = normaliseQuakes({ features: [feature('earthquake', 6.3), feature('quarry blast', 2.6), feature('earthquake', null)] })
    expect(quakes).toMatchObject([{ kind: 'quake', lon: 168.19, lat: -15.54, label: 'M 6.3', props: { magnitude: 6.3, depthKm: 10, tsunami: true } }])
  })

  it('asks about aircraft by grid cell, once per cell while the answer is fresh, and refuses a long queue', async () => {
    expect(cellOf(35.68, 139.77)).toEqual({ lat: 34, lon: 138, key: '34,138' })
    expect(cellOf(35.1, 136.2).key).toBe('34,138')
    expect(cellOf(-0.5, -179.5).key).toBe('-2,-178')

    const asked: string[] = []
    let now = NOW
    const view = createViewAircraft(async (url) => {
      asked.push(url)
      return new Response(JSON.stringify({ now: now / 1000, ac: [{ hex: 'abc123', flight: 'JAL1', lat: 35, lon: 139, alt_baro: 30000, gs: 400, seen_pos: 1 }] }), { status: 200 })
    }, () => now)
    const first = await view.around(35.68, 139.77)
    expect(first.entities).toMatchObject([{ id: 'aircraft:abc123' }])
    expect(await view.around(35.1, 136.2)).toBe(first)
    expect(asked).toEqual(['https://api.adsb.lol/v2/point/34/138/250'])

    // Five different cells at once: the first is on its way, four wait, and the sixth is turned away.
    const stuck = createViewAircraft(() => new Promise<Response>(() => {}), () => now)
    for (let lon = 0; lon < 16; lon += 4) void stuck.around(10, lon).catch(() => undefined)
    await expect(stuck.around(10, 40)).rejects.toBeInstanceOf(ViewBusy)
    now += 1
  })
})

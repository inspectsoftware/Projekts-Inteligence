import { describe, expect, it, vi } from 'vitest'
import type { NewsSource, RawNews } from '../../shared/adapters/news'
import { normaliseGpsTxt } from '../../shared/adapters/transit'
import { advisoryLevel } from '../../server/feeds/advisories'
import { candidateVersions } from '../../server/feeds/conflicts'
import { pickNotices } from '../../server/feeds/notices'
import { PlaceBusy, createPlaceLookup } from '../../server/http/place'

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

  it('refuses to queue more than a few questions for the one-a-second service', async () => {
    const lookup = createPlaceLookup(() => new Promise<Response>(() => {}), () => NOW)
    const asked = Array.from({ length: 5 }, (_, index) => lookup.search(`place ${index}`, 'en'))
    await expect(lookup.search('one too many', 'en')).rejects.toBeInstanceOf(PlaceBusy)
    expect(asked).toHaveLength(5)
  })
})

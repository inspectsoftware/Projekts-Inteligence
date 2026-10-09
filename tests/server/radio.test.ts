import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'
import { RadioBusy, createRadioSearch, normaliseStations } from '../../server/http/radio'
import { buildCsp } from '../../shared/csp'

const station = (over: Record<string, unknown> = {}) => ({
  stationuuid: 'a1',
  name: ' Radio One ',
  url: 'http://one.example/stream',
  url_resolved: 'https://one.example/stream',
  homepage: 'https://one.example',
  tags: 'news, talk,,jazz,pop,rock',
  country: 'Latvia',
  codec: 'MP3',
  bitrate: 128,
  hls: 0,
  ...over,
})

describe('radio stations', () => {
  it('keeps only what an https page can play, once each', () => {
    const found = normaliseStations([
      station(),
      station({ stationuuid: 'a2' }),
      station({ stationuuid: 'b', url_resolved: 'https://b.example/live.m3u8', hls: 1 }),
      station({ stationuuid: 'c', url: 'http://c.example/', url_resolved: 'http://c.example/' }),
      station({ stationuuid: 'd', url_resolved: 'javascript:alert(1)', url: 'not a url' }),
      station({ stationuuid: 'e', name: '  ', url_resolved: 'https://e.example/' }),
    ])
    expect(found).toEqual([
      { id: 'a1', name: 'Radio One', url: 'https://one.example/stream', country: 'Latvia', tags: ['news', 'talk', 'jazz', 'pop'], codec: 'MP3', bitrate: 128, homepage: 'https://one.example' },
    ])
  })

  it('asks the directory once per search and moves to the next server when one is out', async () => {
    const asked: string[] = []
    const clock = { at: 0 }
    const radio = createRadioSearch(async (url) => {
      asked.push(url)
      return url.startsWith('https://all.') ? new Response('down', { status: 502 }) : Response.json([station()])
    }, () => clock.at)

    expect(await radio.search('country', 'Latvia')).toHaveLength(1)
    expect(await radio.search('country', 'latvia')).toHaveLength(1)
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('https://de1.api.radio-browser.info/json/stations/search?country=Latvia')
    expect(asked[1]).toContain('is_https=true')

    clock.at += 11 * 60_000
    await radio.search('country', 'Latvia')
    expect(asked).toHaveLength(4)
  })

  it('asks the directory for one search at a time and refuses past a short queue', async () => {
    let asked = 0
    const radio = createRadioSearch(async () => {
      asked += 1
      return Response.json([station()])
    })
    const searches = Array.from({ length: 8 }, (_, n) => radio.search('name', `flood ${n}`))
    const settled = await Promise.race([Promise.allSettled(searches.slice(5)), new Promise((resolve) => setTimeout(resolve, 200))])
    expect(settled).toMatchObject([{ status: 'rejected' }, { status: 'rejected' }, { status: 'rejected' }])
    await expect(searches[7]).rejects.toBeInstanceOf(RadioBusy)
    await searches[0]
    // The other four are still waiting their turn, a second apart.
    expect(asked).toBe(1)
  })

  it('turns away a search it cannot make sense of, without asking anyone', async () => {
    const app = createApp({ clientDir: null })
    for (const path of ['/api/radio', '/api/radio?q=a', '/api/radio?by=url&q=jazz', `/api/radio?q=${'x'.repeat(61)}`]) {
      expect((await app.request(path)).status, path).toBe(400)
    }
  })

  it('lets any https host play sound in the page, and nothing more than sound', () => {
    const policy = new Map(buildCsp().split('; ').map((directive) => [directive.split(' ')[0], directive.split(' ').slice(1)]))
    expect(policy.get('media-src')).toContain('https:')
    for (const directive of ['default-src', 'script-src', 'connect-src', 'img-src', 'frame-src']) expect(policy.get(directive), directive).not.toContain('https:')
  })
})

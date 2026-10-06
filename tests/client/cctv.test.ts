import { describe, expect, it } from 'vitest'
import type { Cam } from '../../shared/feeds'
import { pickCams } from '../../src/ui/windows/cctv/pick'

const cam = (id: string, extra: Partial<Cam> = {}): Cam => ({
  id,
  name: id,
  place: 'Rīga',
  country: 'LV',
  kind: 'still',
  src: `https://example.org/${id}.jpg`,
  refreshS: 10,
  credit: 'Someone',
  page: 'https://example.org/',
  ...extra,
})

const CAMS = [
  cam('port', { kind: 'hls' }),
  cam('square'),
  cam('waterfall', { place: 'Kuldīga', kind: 'iframe' }),
  cam('park', { kind: 'hls', poster: 'https://example.org/park.jpg' }),
  cam('tower', { country: 'EE', place: 'Tallinn' }),
  cam('A1 303,6', { country: 'LT', place: 'Lithuania', road: true }),
]

const ids = (cams: Cam[]) => cams.map((each) => each.id)

describe('camera filter', () => {
  it('keeps the road cameras apart and puts views with a picture first', () => {
    expect(ids(pickCams(CAMS, { roads: false, country: 'all', query: '' }))).toEqual(['square', 'park', 'tower', 'port', 'waterfall'])
    expect(ids(pickCams(CAMS, { roads: true, country: 'all', query: '' }))).toEqual(['A1 303,6'])
  })

  it('filters by country, and by name or place whatever the accents', () => {
    expect(ids(pickCams(CAMS, { roads: false, country: 'EE', query: '' }))).toEqual(['tower'])
    expect(ids(pickCams(CAMS, { roads: false, country: 'all', query: ' kuldiga ' }))).toEqual(['waterfall'])
    expect(ids(pickCams(CAMS, { roads: false, country: 'LV', query: 'PAR' }))).toEqual(['park'])
    expect(pickCams(CAMS, { roads: true, country: 'LV', query: '' })).toEqual([])
  })
})

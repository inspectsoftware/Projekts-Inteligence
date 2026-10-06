import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normaliseElements } from '../../shared/adapters/satellites'
import { haversine } from '../../shared/geo/sphere'
import { type Region, fixAt, groundTrack, nearRegion, satellitesIn, track } from '../../src/sat/orbits'

// Elements recorded from CelesTrak on 2026-10-06; positions are checked close to that epoch.
const elements = normaliseElements(
  JSON.parse(readFileSync(new URL('../fixtures/satellites.celestrak.json', import.meta.url), 'utf8')),
  'stations',
)
const tracked = track(elements)
const find = (pattern: RegExp) => tracked.find(({ element }) => pattern.test(element.OBJECT_NAME))!
const NOW = Date.parse('2026-10-06T10:00:00Z')
const EVERYWHERE: Region = { west: -180, south: -90, east: 180, north: 90 }

describe('orbit propagation', () => {
  it('accepts every element set in the fixture', () => {
    expect(tracked).toHaveLength(elements.length)
  })

  it('puts the ISS where a space station belongs', () => {
    const fix = fixAt(find(/^ISS/).rec, new Date(NOW), true)!
    expect(fix.altKm).toBeGreaterThan(380)
    expect(fix.altKm).toBeLessThan(440)
    expect(fix.speedKmS).toBeCloseTo(7.66, 1)
    // Never further from the equator than its inclination.
    expect(Math.abs(fix.lat)).toBeLessThanOrEqual(51.7)
    expect(fix.rangeKm).toBeGreaterThan(fix.altKm - 1)
  })

  it('puts navigation satellites in medium Earth orbit', () => {
    const gps = fixAt(find(/^GPS/).rec, new Date(NOW), false)!
    expect(gps.altKm).toBeGreaterThan(19_500)
    expect(gps.altKm).toBeLessThan(20_800)
    const galileo = fixAt(find(/^GSAT/).rec, new Date(NOW), false)!
    expect(galileo.altKm).toBeGreaterThan(22_500)
    expect(galileo.altKm).toBeLessThan(23_700)
  })

  it('gives each satellite a course and a ground speed to glide on', () => {
    const [iss] = satellitesIn([find(/^ISS/)], NOW, EVERYWHERE)
    expect(iss.id).toBe('satellite:25544')
    expect(iss.kind).toBe('satellite')
    expect(iss.ts).toBe(NOW)
    expect(iss.trk).toBeGreaterThanOrEqual(0)
    expect(iss.trk).toBeLessThan(360)
    // The point below the ISS moves a little slower than the station itself.
    expect(iss.spd).toBeGreaterThan(6800)
    expect(iss.spd).toBeLessThan(7700)
    expect(iss.props.periodMin).toBeCloseTo(93, 0)
    expect(iss.props).toMatchObject({ name: 'ISS (ZARYA)', noradId: 25544, intlDes: '1998-067A' })
  })

  it('only reports satellites inside the region', () => {
    const nowhere: Region = { west: 0, south: 89, east: 1, north: 90 }
    expect(satellitesIn(tracked, NOW, nowhere)).toEqual([])
    expect(satellitesIn(tracked, NOW, EVERYWHERE)).toHaveLength(tracked.length)
    expect(nearRegion(tracked, NOW, 25_000, EVERYWHERE)).toHaveLength(tracked.length)
    expect(nearRegion(tracked, NOW, 25_000, nowhere)).toEqual([])
  })

  it('traces a continuous ground track', () => {
    const path = groundTrack(find(/^ISS/).rec, NOW, -240, 900, 20)
    expect(path.length).toBeGreaterThan(10)
    for (let i = 1; i < path.length; i++) {
      // 20 s at roughly 7.2 km/s over the ground.
      const step = haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])
      expect(step).toBeGreaterThan(120_000)
      expect(step).toBeLessThan(160_000)
    }
  })
})

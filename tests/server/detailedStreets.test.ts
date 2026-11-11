import { describe, expect, it } from 'vitest'
import { buildStreets, islands, overpassQuery, tileBounds } from '../../server/streets/detailed'

/**
 * Two streets crossing at a node, around (24.1, 56.95): a two-lane main road and a side street;
 * a grass island and a hatched area by the junction, and an island past the tile's east edge.
 */
const OSM = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="56.9500" lon="24.0980"/>
  <node id="2" lat="56.9500" lon="24.1000"/>
  <node id="3" lat="56.9500" lon="24.1020"/>
  <node id="4" lat="56.9488" lon="24.1000"/>
  <node id="5" lat="56.9512" lon="24.1000"/>
  <node id="20" lat="56.95015" lon="24.10090"/>
  <node id="21" lat="56.95015" lon="24.10110"/>
  <node id="22" lat="56.95025" lon="24.10110"/>
  <node id="23" lat="56.95025" lon="24.10090"/>
  <node id="30" lat="56.94975" lon="24.09890"/>
  <node id="31" lat="56.94975" lon="24.09910"/>
  <node id="32" lat="56.94985" lon="24.09910"/>
  <node id="40" lat="56.9500" lon="24.1150"/>
  <node id="41" lat="56.9500" lon="24.1152"/>
  <node id="42" lat="56.9502" lon="24.1152"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/></way>
  <way id="11"><nd ref="4"/><nd ref="2"/><nd ref="5"/><tag k="highway" v="residential"/></way>
  <way id="12"><nd ref="20"/><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="20"/><tag k="area:highway" v="traffic_island"/><tag k="surface" v="grass"/></way>
  <way id="13"><nd ref="30"/><nd ref="31"/><nd ref="32"/><nd ref="30"/><tag k="area:highway" v="prohibited"/></way>
  <way id="14"><nd ref="40"/><nd ref="41"/><nd ref="42"/><nd ref="40"/><tag k="traffic_calming" v="island"/><tag k="area" v="yes"/></way>
</osm>`
const BOUNDS: [number, number, number, number] = [24.09, 56.94, 24.11, 56.96]

describe('streets lane by lane (osm2streets)', () => {
  it('cuts the world into z15 tiles, about 670 m square at Rīga', () => {
    const [w, s, e, n] = tileBounds(15, 18571, 10045)
    expect(e - w).toBeCloseTo(360 / 2 ** 15, 9)
    expect(n).toBeGreaterThan(s)
    expect((e - w) * 111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180)).toBeGreaterThan(600)
  })

  it('asks Overpass for the ways and their nodes, with room round the tile', () => {
    const q = overpassQuery([24.09, 56.94, 24.11, 56.96])
    expect(q).toContain('[out:xml]')
    expect(q).toContain('way["highway"]')
    expect(q).toContain('way["area:highway"]')
    expect(q).toContain('way["traffic_calming"="island"]')
    expect(q).toContain('(._;>;);out body;')
    // The bounds asked for reach past the tile's.
    const [s, w] = q.match(/\(([\d.]+),([\d.]+),/)!.slice(1).map(Number)
    expect(s).toBeLessThan(56.94)
    expect(w).toBeLessThan(24.09)
  })

  it('keeps the islands and hatched areas mappers drew, each in the tile its middle is in', () => {
    const found = islands(OSM, BOUNDS)
    expect(found.map((f) => `${f.properties?.kind}:${f.properties?.type}`).sort()).toEqual(['hatch:prohibited', 'island:grass'])
    const island = found.find((f) => f.properties?.kind === 'island')!
    expect(island.geometry).toEqual({ type: 'Polygon', coordinates: [[[24.1009, 56.95015], [24.1011, 56.95015], [24.1011, 56.95025], [24.1009, 56.95025], [24.1009, 56.95015]]] })
    // The island past the east edge belongs to the next tile.
    expect(islands(OSM, [24.11, 56.94, 24.13, 56.96]).map((f) => f.properties?.type)).toEqual(['paved'])
  })

  it('builds lanes, their paint and the junction from OSM, each on its level', async () => {
    const fc = await buildStreets(OSM, BOUNDS)
    const kinds = new Set(fc.features.map((f) => `${f.properties?.kind}:${f.properties?.type}`))
    expect(kinds).toContain('lane:Driving')
    expect(kinds).toContain('junction:intersection')
    expect(kinds).toContain('island:grass')
    expect(kinds).toContain('hatch:prohibited')
    expect([...kinds].some((k) => k.startsWith('mark:'))).toBe(true)
    // Four lanes on the main road, either side of the junction: at least eight driving lanes in all.
    expect(fc.features.filter((f) => f.properties?.kind === 'lane' && f.properties?.type === 'Driving').length).toBeGreaterThanOrEqual(8)
    for (const f of fc.features) expect(f.properties?.layer).toBe(0)
  })
})

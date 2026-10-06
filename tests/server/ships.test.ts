import { describe, expect, it } from 'vitest'
import { parseSanctionedVessels, splitCsvLine } from '../../shared/adapters/sanctions'
import {
  VesselTable,
  flagStateOf,
  parseAisStreamMessage,
  parseDigitrafficLocations,
  parseDigitrafficVessels,
  shipTypeOf,
} from '../../shared/adapters/ships'
import { sanctionedVesselRule } from '../../shared/alerts/rules'
import { Flag } from '../../shared/entity'

const SEA = [18.5, 55.3, 25.6, 59.7] as const
const NONE = { mmsi: new Set<number>(), imo: new Set<number>() }
const T0 = Date.parse('2026-10-06T11:00:00Z')

describe('ship classification', () => {
  it('groups AIS type codes', () => {
    expect(shipTypeOf(70)).toBe('cargo')
    expect(shipTypeOf(89)).toBe('tanker')
    expect(shipTypeOf(60)).toBe('passenger')
    expect(shipTypeOf(30)).toBe('fishing')
    expect(shipTypeOf(52)).toBe('service')
    expect(shipTypeOf(35)).toBe('military')
    expect(shipTypeOf(37)).toBe('pleasure')
    expect(shipTypeOf(0)).toBe('other')
    expect(shipTypeOf(undefined)).toBe('other')
  })

  it('reads the flag state from the MMSI', () => {
    expect(flagStateOf(275123456)).toBe('Latvia')
    expect(flagStateOf(273456789)).toBe('Russia')
    expect(flagStateOf(999000000)).toBeNull()
  })
})

describe('Digitraffic', () => {
  // Shape as returned by meri.digitraffic.fi on 2026-10-06. Its clock is not ours: here it runs a minute ahead.
  const THEIR_T0 = T0 + 60_000
  const locations = {
    dataUpdatedTime: new Date(THEIR_T0).toISOString(),
    features: [
      {
        mmsi: 341540001,
        geometry: { type: 'Point', coordinates: [21.040783, 58.693857] as [number, number] },
        properties: { mmsi: 341540001, sog: 8.2, cog: 212.5, navStat: 0, heading: 208, timestampExternal: THEIR_T0 - 20_000 },
      },
      { mmsi: 1, geometry: {}, properties: {} },
    ],
  }
  const vessels = [
    { callSign: 'V2QY7', destination: 'ALEXANDRIA', imo: 9504102, mmsi: 341540001, name: 'KAIE@@@@', shipType: 70 },
  ]

  it('turns positions and vessel details into one ship, dated on our clock', () => {
    const table = new VesselTable()
    for (const update of parseDigitrafficLocations(locations, T0)) table.position(update)
    for (const update of parseDigitrafficVessels(vessels)) table.describe(update)

    const [ship] = table.view(SEA, NONE)
    expect(table.size).toBe(1)
    expect(ship).toMatchObject({ id: 'ship:341540001', kind: 'ship', label: 'KAIE', trk: 212.5, ts: T0 - 20_000, flags: 0 })
    expect(ship.spd).toBeCloseTo(8.2 * 0.514444, 3)
    expect(ship.props).toMatchObject({
      name: 'KAIE',
      type: 'cargo',
      imo: 9504102,
      callSign: 'V2QY7',
      destination: 'ALEXANDRIA',
      heading: 208,
      status: 'Under way',
      source: 'digitraffic',
    })
  })

  it('measures ages against the newest report when the answer does not say when it was made', () => {
    const report = (mmsi: number, timestampExternal: number) => ({
      mmsi,
      geometry: { coordinates: [21, 58.5] as [number, number] },
      properties: { timestampExternal },
    })
    const updates = parseDigitrafficLocations({ features: [report(1, THEIR_T0 - 90_000), report(2, THEIR_T0)] }, T0)
    expect(updates.map((update) => update.at)).toEqual([T0 - 90_000, T0])
  })

  it('ignores details for vessels it has no position for', () => {
    const table = new VesselTable()
    for (const update of parseDigitrafficVessels(vessels)) table.describe(update)
    expect(table.view(SEA, NONE)).toEqual([])
  })
})

describe('AISStream', () => {
  const position = JSON.stringify({
    MessageType: 'PositionReport',
    MetaData: { MMSI: 275000111, ShipName: 'BALTIC TEST      ' },
    Message: {
      PositionReport: { Cog: 360, Sog: 0, TrueHeading: 511, NavigationalStatus: 5, Latitude: 57.03, Longitude: 24.08, UserID: 275000111 },
    },
  })
  const staticData = JSON.stringify({
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 275000111 },
    Message: { ShipStaticData: { Name: 'BALTIC TEST', CallSign: 'YLAB', ImoNumber: 9123456, Type: 80, Destination: 'RIGA' } },
  })

  it('reads a position report, treating 360 and 511 as "not available"', () => {
    const table = new VesselTable()
    table.position(parseAisStreamMessage(position, T0)!.position!)
    const [ship] = table.view(SEA, NONE)
    expect(ship).toMatchObject({ id: 'ship:275000111', label: 'BALTIC TEST', spd: 0, ts: T0 })
    expect(ship.trk).toBeUndefined()
    expect(ship.props).toMatchObject({ heading: null, status: 'Moored', flagState: 'Latvia', source: 'aisstream' })
  })

  it('adds static data and flags a sanctioned vessel by IMO', () => {
    const table = new VesselTable()
    table.position(parseAisStreamMessage(position, T0)!.position!)
    table.describe(parseAisStreamMessage(staticData, T0)!.static!)
    const [ship] = table.view(SEA, { mmsi: new Set(), imo: new Set([9123456]) })
    expect(ship.props).toMatchObject({ type: 'tanker', destination: 'RIGA', callSign: 'YLAB', imo: 9123456 })
    expect(ship.flags & Flag.SANCTIONED).toBeTruthy()

    const [alert] = sanctionedVesselRule.evaluate({
      now: T0,
      entities: (slot) => (slot === 'ships' ? [ship] : []),
      warnings: () => [],
      insideLatvia: () => false,
    })
    expect(alert).toMatchObject({
      severity: 'warn',
      title: 'Sanctioned vessel: BALTIC TEST',
      detail: 'Latvia · bound for RIGA',
      entityId: 'ship:275000111',
    })
  })

  it('rejects junk', () => {
    expect(parseAisStreamMessage('not json', T0)).toBeNull()
    expect(parseAisStreamMessage('{"MessageType":"PositionReport"}', T0)).toBeNull()
    const impossible = { MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: { PositionReport: { Latitude: 999, Longitude: 0 } } }
    expect(parseAisStreamMessage(JSON.stringify(impossible), T0)).toBeNull()
  })
})

describe('VesselTable', () => {
  const at = (mmsi: number, lon: number, lat: number, time: number, source: 'digitraffic' | 'aisstream' = 'aisstream') => ({
    mmsi,
    lon,
    lat,
    at: time,
    source,
  })

  it('keeps the newest report when both sources hear the same vessel', () => {
    const table = new VesselTable()
    table.position(at(1, 22, 57.5, T0, 'aisstream'))
    table.position(at(1, 22.5, 57.6, T0 - 60_000, 'digitraffic'))
    expect(table.view(SEA, NONE)[0]).toMatchObject({ lon: 22, ts: T0 })
    expect(table.view(SEA, NONE)[0].props.source).toBe('aisstream')
  })

  it('drops vessels that have gone quiet, and those outside the area', () => {
    const table = new VesselTable()
    table.position(at(1, 22, 57.5, T0 - 40 * 60_000))
    table.position(at(2, 22, 57.5, T0))
    table.position(at(3, 10, 54, T0))
    table.prune(T0)
    expect(table.size).toBe(2)
    expect(table.view(SEA, NONE).map((ship) => ship.id)).toEqual(['ship:2'])
  })
})

describe('sanctions list', () => {
  const CSV = [
    'type,caption,imo,risk,countries,flag,mmsi,id,url,datasets,aliases',
    'Vessel,"KAPITAN, THE",IMO9427366,sanction,ru,ru,273123456;273999888,x1,https://example.org,eu_fsf,',
    'Vessel,DETAINED ONE,IMO9000001,mare.detained,pa,pa,351000001,x2,https://example.org,paris_mou,',
    'Vessel,"SAYS ""HELLO""",IMO9555555;IMO9555556,reg.warn;sanction,,,,x3,https://example.org,us_ofac_sdn,',
    '',
  ].join('\n')

  it('splits quoted CSV fields', () => {
    expect(splitCsvLine('a,"b, c","d ""e""",')).toEqual(['a', 'b, c', 'd "e"', ''])
  })

  it('keeps sanctioned vessels only, by IMO and MMSI', () => {
    const { imo, mmsi } = parseSanctionedVessels(CSV)
    expect(imo.sort()).toEqual([9427366, 9555555, 9555556])
    expect(mmsi.sort()).toEqual([273123456, 273999888])
  })

  it('returns nothing for a file it does not recognise', () => {
    expect(parseSanctionedVessels('a,b\n1,2')).toEqual({ imo: [], mmsi: [] })
    expect(parseSanctionedVessels('')).toEqual({ imo: [], mmsi: [] })
  })
})

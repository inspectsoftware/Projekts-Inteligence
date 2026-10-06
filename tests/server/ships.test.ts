import { describe, expect, it } from 'vitest'
import { parseVesselRisks, splitCsvLine } from '../../shared/adapters/sanctions'
import {
  type Ship,
  type VesselLists,
  VesselTable,
  type WarshipList,
  flagStateOf,
  inLatvianWaters,
  parseAisStreamMessage,
  parseDigitrafficLocations,
  parseDigitrafficVessels,
  serviceOf,
  shipTypeOf,
} from '../../shared/adapters/ships'
import type { AlertInput } from '../../shared/alerts/engine'
import { vesselRule } from '../../shared/alerts/rules'
import { WARSHIPS } from '../../shared/data/warships'
import { Flag } from '../../shared/entity'
import { translate } from '../../shared/i18n'

const SEA = [18.5, 55.3, 25.6, 59.7] as const
const NO_IDS = { mmsi: new Set<number>(), imo: new Set<number>() }
const NONE: VesselLists = { sanctioned: NO_IDS, shadow: NO_IDS, warships: {} }
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
    const [ship] = table.view(SEA, { ...NONE, sanctioned: { mmsi: new Set(), imo: new Set([9123456]) } })
    expect(ship.props).toMatchObject({ type: 'tanker', destination: 'RIGA', callSign: 'YLAB', imo: 9123456, service: null })
    expect(ship.flags).toBe(Flag.SANCTIONED)
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

describe('state vessels', () => {
  const LIST: WarshipList = { 273546520: ['Yantar', 'Russian Navy'], 277005000: ['HNoMS Vidar', ''] }
  const vessel = (name: string | undefined, shipType?: number, mmsi = 265500350) => ({ mmsi, name, shipType })

  it('takes the AIS type code at its word', () => {
    expect(serviceOf(vessel('FINNISH WARSHIP 02', 35), LIST)).toBe('navy')
    expect(serviceOf(vessel('AXEL VON FERSEN', 35), LIST)).toBe('navy')
    expect(serviceOf(vessel('RV90', 55), LIST)).toBe('government')
    expect(serviceOf(vessel('KAIE', 70), LIST)).toBeNull()
  })

  it('recognises a warship that reports no type by what it calls itself', () => {
    // Seen on Digitraffic on 2026-10-06, reporting type 0.
    expect(serviceOf(vessel('SWEDISH WARSHIP K35', 0), LIST)).toBe('navy')
    expect(serviceOf(vessel('ORP GEN K PULASKI'), LIST)).toBe('navy')
    expect(serviceOf(vessel('KBV 181', 0), LIST)).toBe('government')
    expect(serviceOf(vessel(undefined, 0), LIST)).toBeNull()
  })

  it('does not take a merchant ship for a warship because of its name', () => {
    // "SENATOR" contains NATO, and FS is also how shipping companies start a name.
    expect(serviceOf(vessel('HANSA SENATOR', 0), LIST)).toBeNull()
    expect(serviceOf(vessel('FS CHARLOTTE', 70), LIST)).toBeNull()
    expect(serviceOf(vessel('NAVY PIER', 60), LIST)).toBeNull()
  })

  it('takes a vessel that declares a civil type at its word, though the navy list has it', () => {
    // Wikidata had the bunker tanker Hilda and the 1938 steamer Ukkopekka under a navy on 2026-10-06.
    const listed: WarshipList = { ...LIST, 273444560: ['Hilda', 'Russian Navy'], 230938590: ['Ukkopekka', 'Finnish Navy'] }
    expect(serviceOf(vessel('HILDA', 80, 273444560), listed)).toBeNull()
    expect(serviceOf(vessel('UKKOPEKKA', 60, 230938590), listed)).toBeNull()

    // The list's entry is still shown, as the hint it is.
    const table = new VesselTable()
    table.position({ mmsi: 273444560, lon: 21.9, lat: 57.7, at: T0, source: 'aisstream', name: 'HILDA' })
    table.describe({ mmsi: 273444560, shipType: 80, name: undefined, callSign: undefined, imo: undefined, destination: undefined })
    const [hilda] = table.view(SEA, { ...NONE, warships: listed })
    expect(hilda.props).toMatchObject({ type: 'tanker', service: null, listedAs: 'Hilda, Russian Navy' })
    expect(vesselRule.evaluate({ now: T0, entities: () => [hilda], warnings: () => [], news: () => [], insideLatvia: () => false, tr: translate.bind(null, 'en') })).toEqual([])
  })

  it('leaves the bunker tankers and tourist steamers out of the baked navy list', () => {
    for (const mmsi of [273444560, 273317910, 230938590, 265514680]) expect(Object.hasOwn(WARSHIPS, mmsi), String(mmsi)).toBe(false)
    expect(WARSHIPS[273546520]).toEqual(['Yantar', 'Russian Navy'])
  })

  it('recognises a vessel on the navy list when it reports no type or an unspecific one, and says what the list calls it', () => {
    expect(serviceOf(vessel('YANTAR', 90, 273546520), LIST)).toBe('navy')
    expect(serviceOf(vessel('YANTAR', undefined, 273546520), LIST)).toBe('navy')

    const table = new VesselTable()
    table.position({ mmsi: 273546520, lon: 21.9, lat: 57.7, at: T0, source: 'aisstream', name: 'YANTAR' })
    table.position({ mmsi: 277005000, lon: 21.0, lat: 56.0, at: T0, source: 'aisstream', name: 'JOTVINGIS' })
    const [yantar, jotvingis] = table.view(SEA, { ...NONE, warships: LIST })
    expect(yantar.props).toMatchObject({ service: 'navy', listedAs: 'Yantar, Russian Navy', flagState: 'Russia' })
    // The list still has this hull under its former name: shown as it is, next to the name on AIS.
    expect(jotvingis.props).toMatchObject({ name: 'JOTVINGIS', service: 'navy', listedAs: 'HNoMS Vidar', flagState: 'Lithuania' })
  })

  it('has a baked navy list keyed by nine-digit MMSI', () => {
    const keys = Object.keys(WARSHIPS)
    expect(keys.length).toBeGreaterThan(300)
    expect(keys.every((mmsi) => /^\d{9}$/.test(mmsi))).toBe(true)
  })
})

describe('vessel alerts', () => {
  const LISTS: VesselLists = {
    sanctioned: { mmsi: new Set([273000001]), imo: new Set() },
    shadow: { mmsi: new Set([667000002]), imo: new Set() },
    warships: { 273546520: ['Yantar', 'Russian Navy'] },
  }
  const IRBE_STRAIT = { lon: 21.9, lat: 57.7 }
  const GULF_OF_FINLAND = { lon: 24.5, lat: 59.6 }
  const VENTSPILS_HARBOUR = { lon: 21.545, lat: 57.398 }

  function ship(mmsi: number, name: string, at: { lon: number; lat: number }, shipType?: number): Ship {
    const table = new VesselTable()
    table.position({ mmsi, ...at, at: T0, source: 'aisstream', name })
    table.describe({ mmsi, shipType, name: undefined, callSign: undefined, imo: undefined, destination: undefined })
    return table.view(SEA, LISTS)[0]
  }
  const input = (ships: Ship[], insideLatvia: AlertInput['insideLatvia']): AlertInput => ({
    now: T0,
    entities: (slot) => (slot === 'ships' ? ships : []),
    warnings: () => [],
    news: () => [],
    insideLatvia,
    tr: translate.bind(null, 'en'),
  })
  const alertsFor = (ships: Ship[], insideLatvia: AlertInput['insideLatvia'] = () => false) =>
    vesselRule.evaluate(input(ships, insideLatvia)).map((alert) => [alert.severity, alert.title])

  it('knows where Latvian waters end', () => {
    expect(inLatvianWaters(IRBE_STRAIT.lon, IRBE_STRAIT.lat)).toBe(true)
    expect(inLatvianWaters(23.5, 57.4)).toBe(true) // Gulf of Rīga, Latvian side
    expect(inLatvianWaters(20.5, 56.5)).toBe(true) // open sea west of Liepāja
    expect(inLatvianWaters(23.5, 58.0)).toBe(false) // Gulf of Rīga, Estonian side
    expect(inLatvianWaters(20.8, 55.8)).toBe(false) // off Klaipėda
    expect(inLatvianWaters(GULF_OF_FINLAND.lon, GULF_OF_FINLAND.lat)).toBe(false)
    expect(inLatvianWaters(24.105, 56.949)).toBe(false) // Rīga itself: land
  })

  it('warns once a listed vessel or a non-NATO warship is inside Latvian waters, and only notes it elsewhere', () => {
    expect(alertsFor([ship(273546520, 'YANTAR', IRBE_STRAIT)])).toEqual([['warn', 'Naval vessel (Russia) in Latvian waters: YANTAR']])
    expect(alertsFor([ship(273546520, 'YANTAR', GULF_OF_FINLAND)])).toEqual([['info', 'Naval vessel (Russia): YANTAR']])
    expect(alertsFor([ship(273000001, 'KAPITAN', IRBE_STRAIT, 80)])).toEqual([['warn', 'Sanctioned vessel in Latvian waters: KAPITAN']])
    expect(alertsFor([ship(667000002, 'MIRES', GULF_OF_FINLAND, 80)])).toEqual([['info', 'Shadow-fleet vessel: MIRES']])
  })

  it('counts a harbour inside the land border as Latvian waters', () => {
    const moored = ship(667000002, 'MIRES', VENTSPILS_HARBOUR, 80)
    expect(inLatvianWaters(moored.lon, moored.lat)).toBe(false)
    expect(alertsFor([moored], () => true)).toEqual([['warn', 'Shadow-fleet vessel in Latvian waters: MIRES']])
  })

  it('says nothing about allied warships, or about a warship whose flag it cannot tell', () => {
    expect(alertsFor([ship(230997210, 'FINNISH WARSHIP 02', IRBE_STRAIT, 35)])).toEqual([])
    expect(alertsFor([ship(999000001, 'WARSHIP', IRBE_STRAIT, 35)])).toEqual([])
  })

  it('names the flag and what the navy list says in the detail', () => {
    const [alert] = vesselRule.evaluate(input([ship(273546520, 'YANTAR', IRBE_STRAIT)], () => false))
    expect(alert).toMatchObject({
      key: 'vessel:ship:273546520',
      detail: 'Russia · listed as Yantar, Russian Navy',
      entityId: 'ship:273546520',
    })
  })
})

describe('sanctions list', () => {
  const CSV = [
    'type,caption,imo,risk,countries,flag,mmsi,id,url,datasets,aliases',
    'VESSEL,"KAPITAN, THE",IMO9427366,sanction,ru,ru,273123456;273999888,x1,https://example.org,eu_fsf,',
    'VESSEL,DETAINED ONE,IMO9000001,mare.detained,pa,pa,351000001,x2,https://example.org,paris_mou,',
    'VESSEL,"SAYS ""HELLO""",IMO9555555;IMO9555556,reg.warn;sanction,,,,x3,https://example.org,us_ofac_sdn,',
    // As published on 2026-10-06: the shadow fleet is tagged as such, not as sanctioned.
    '"VESSEL","VOLGONEFT-111","IMO8230663","mare.shadow;poi","kn;ru","ru","273436920","imo-vsl-8230663","https://example.org","ua_war_sanctions",""',
    'VESSEL,BOTH LISTS,IMO9111111,sanction;mare.shadow,ru,ru,273000009,x5,https://example.org,eu_fsf,',
    // A company, under a company IMO number that could just as well be a ship's.
    '"ORGANIZATION","Prominent Shipmanagement Ltd","IMO6378969","sanction","ae","","","x6","https://example.org","us_ofac_sdn",""',
    '',
  ].join('\n')

  it('splits quoted CSV fields', () => {
    expect(splitCsvLine('a,"b, c","d ""e""",')).toEqual(['a', 'b, c', 'd "e"', ''])
  })

  it('keeps sanctioned and shadow-fleet vessels, by IMO and MMSI, and leaves companies out', () => {
    const risks = parseVesselRisks(CSV)
    expect(risks.imo.sort()).toEqual([9111111, 9427366, 9555555, 9555556])
    expect(risks.mmsi.sort()).toEqual([273000009, 273123456, 273999888])
    expect(risks.shadowImo.sort()).toEqual([8230663, 9111111])
    expect(risks.shadowMmsi.sort()).toEqual([273000009, 273436920])
  })

  it('flags a vessel on both lists with both', () => {
    const table = new VesselTable()
    table.position({ mmsi: 273000009, lon: 22, lat: 57.5, at: T0, source: 'digitraffic' })
    const risks = parseVesselRisks(CSV)
    const [ship] = table.view(SEA, {
      ...NONE,
      sanctioned: { mmsi: new Set(risks.mmsi), imo: new Set(risks.imo) },
      shadow: { mmsi: new Set(risks.shadowMmsi), imo: new Set(risks.shadowImo) },
    })
    expect(ship.flags).toBe(Flag.SANCTIONED | Flag.SHADOW_FLEET)
  })

  it('returns nothing for a file it does not recognise', () => {
    const nothing = { imo: [], mmsi: [], shadowImo: [], shadowMmsi: [] }
    expect(parseVesselRisks('a,b\n1,2')).toEqual(nothing)
    expect(parseVesselRisks('')).toEqual(nothing)
  })
})

import { LV_WATERS } from '../data/lvWaters'
import { type Entity, Flag, KNOTS_TO_MS } from '../entity'
import { createRegionTest } from '../geo/pip'
import { type BBox, inBBox } from '../region'

export type ShipType = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'service' | 'military' | 'pleasure' | 'other'
export type AisSource = 'digitraffic' | 'aisstream'
/** A state's own vessels: warships and naval auxiliaries, or coast guard, border guard and police. */
export type VesselService = 'navy' | 'government'

export interface ShipProps {
  mmsi: number
  imo: number | null
  name: string | null
  callSign: string | null
  type: ShipType
  destination: string | null
  /** Where the bow points, which can differ from the course when drifting or in a current. */
  heading: number | null
  /** What the crew has set: "Under way", "At anchor", "Moored"... */
  status: string | null
  /** Country of registration, from the first three digits of the MMSI. */
  flagState: string | null
  service: VesselService | null
  /** The name and operator Wikidata's list of navy vessels has for this MMSI. A hint: such entries go stale. */
  listedAs: string | null
  source: AisSource
}

export type Ship = Entity<ShipProps>

/** Everything known about one vessel, merged from position reports and static data as they arrive. */
export interface VesselRecord {
  mmsi: number
  lon: number
  lat: number
  /** When the position was reported, on our clock. */
  at: number
  sogKn?: number
  cog?: number
  heading?: number
  navStat?: number
  name?: string
  callSign?: string
  imo?: number
  shipType?: number
  destination?: string
  source: AisSource
}

export type PositionUpdate = Pick<VesselRecord, 'mmsi' | 'lon' | 'lat' | 'at' | 'sogKn' | 'cog' | 'heading' | 'navStat' | 'source'> & {
  name?: string
}
export type StaticUpdate = Pick<VesselRecord, 'mmsi' | 'name' | 'callSign' | 'imo' | 'shipType' | 'destination'>

/** A vessel that has not been heard from for this long is dropped: it has left, or switched off. */
const EXPIRE_AFTER_MS = 30 * 60 * 1000

const NAV_STATUS: Record<number, string> = {
  0: 'Under way',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Fishing',
  8: 'Under sail',
}

/** Maritime identification digits (the first three of an MMSI) seen around the Baltic. */
const FLAG_STATES: Record<number, string> = {
  209: 'Cyprus', 210: 'Cyprus', 212: 'Cyprus', 211: 'Germany', 218: 'Germany', 215: 'Malta', 229: 'Malta',
  248: 'Malta', 249: 'Malta', 256: 'Malta', 219: 'Denmark', 220: 'Denmark', 230: 'Finland', 231: 'Faroe Islands',
  232: 'United Kingdom', 233: 'United Kingdom', 234: 'United Kingdom', 235: 'United Kingdom', 236: 'Gibraltar',
  240: 'Greece', 241: 'Greece', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands', 247: 'Italy',
  255: 'Portugal (Madeira)', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland', 263: 'Portugal',
  265: 'Sweden', 266: 'Sweden', 271: 'Türkiye', 273: 'Russia', 275: 'Latvia', 276: 'Estonia', 277: 'Lithuania',
  205: 'Belgium', 224: 'Spain', 225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 316: 'Canada',
  338: 'United States', 366: 'United States', 367: 'United States', 368: 'United States', 369: 'United States',
  304: 'Antigua and Barbuda', 305: 'Antigua and Barbuda', 308: 'Bahamas', 309: 'Bahamas', 311: 'Bahamas',
  351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama', 356: 'Panama', 357: 'Panama',
  370: 'Panama', 371: 'Panama', 372: 'Panama', 373: 'Panama', 374: 'Panama', 477: 'Hong Kong',
  511: 'Palau', 518: 'Cook Islands', 538: 'Marshall Islands', 563: 'Singapore', 564: 'Singapore',
  565: 'Singapore', 566: 'Singapore', 613: 'Cameroon', 620: 'Comoros', 626: 'Gabon', 636: 'Liberia', 637: 'Liberia',
  667: 'Sierra Leone', 671: 'Togo',
}

/** The flag states above that are NATO members (the Faroes and Gibraltar through Denmark and the United Kingdom). */
export const NATO_FLAGS: ReadonlySet<string> = new Set([
  'Belgium', 'Canada', 'Denmark', 'Estonia', 'Faroe Islands', 'Finland', 'France', 'Germany', 'Gibraltar', 'Greece',
  'Italy', 'Latvia', 'Lithuania', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Portugal (Madeira)', 'Spain',
  'Sweden', 'Türkiye', 'United Kingdom', 'United States',
])

export function flagStateOf(mmsi: number): string | null {
  return FLAG_STATES[Math.floor(mmsi / 1_000_000)] ?? null
}

/** Groups the hundred AIS ship-type codes into the handful worth telling apart on a map. */
export function shipTypeOf(code: number | undefined): ShipType {
  if (code === undefined) return 'other'
  if (code === 30) return 'fishing'
  if (code === 35 || code === 55) return 'military'
  if (code === 36 || code === 37) return 'pleasure'
  if ((code >= 31 && code <= 34) || (code >= 50 && code <= 54) || (code >= 56 && code <= 59)) return 'service'
  if (code >= 60 && code <= 69) return 'passenger'
  if (code >= 70 && code <= 79) return 'cargo'
  if (code >= 80 && code <= 89) return 'tanker'
  return 'other'
}

/** Navy vessels by MMSI, as scripts/bake-naval.mjs bakes them from Wikidata. */
export type WarshipList = Readonly<Record<number, readonly [name: string, operator: string]>>

// What warships put in the AIS name field ("SWEDISH WARSHIP K35"), and the ship prefixes of the
// navies that sail the Baltic. Tried on a day of Finnish AIS data: four vessels, all of them right.
const NAVY_NAME =
  /\b(WARSHIP|NAVY|NATO)\b|^(LVNS|LNS|EML|ORP|FGS|HDMS|HSWMS|HMS|FNS|HNOMS|KNM|HNLMS|BNS|FS|USS|USNS|ESPS|ITS|TCG|HMCS|NRP)\s/i
// Hull names of the Swedish coast guard, the Estonian and Polish border guards and the German federal police.
const GOVERNMENT_NAME = /^(KBV|PVL|BP|SG)\s/i
const CIVIL_TYPES: ReadonlySet<ShipType> = new Set(['cargo', 'tanker', 'passenger', 'fishing', 'pleasure'])

/**
 * Whether a vessel is a state's own. Warships often report no ship type at all, so the type
 * code is backed up by the navy list and by the name. Many more sail with AIS switched off.
 */
export function serviceOf(vessel: Pick<VesselRecord, 'mmsi' | 'name' | 'shipType'>, warships: WarshipList): VesselService | null {
  // 35 is "military operations", 55 "law enforcement".
  if (vessel.shipType === 35) return 'navy'
  // The list and the name are thinner evidence than what the vessel says of itself: the list has
  // merchant tankers and tourist steamers on it under a navy's name. A vessel that declares itself
  // a merchant or passenger ship, a fishing boat or a yacht is taken at its word.
  if (CIVIL_TYPES.has(shipTypeOf(vessel.shipType))) return null
  if (Object.hasOwn(warships, vessel.mmsi)) return 'navy'
  if (vessel.shipType === 55) return 'government'
  if (!vessel.name) return null
  if (NAVY_NAME.test(vessel.name)) return 'navy'
  return GOVERNMENT_NAME.test(vessel.name) ? 'government' : null
}

/**
 * Inside Latvia's territorial sea or exclusive economic zone. The outline follows the coast,
 * so a ship in a harbour or up a river is outside it (and inside the land border instead).
 */
export const inLatvianWaters = createRegionTest([{ type: 'Polygon', coordinates: [LV_WATERS] }])

interface IdSets {
  mmsi: ReadonlySet<number>
  imo: ReadonlySet<number>
}

/** The reference lists a vessel is checked against as it is turned into a map entity. */
export interface VesselLists {
  sanctioned: IdSets
  shadow: IdSets
  warships: WarshipList
}

const clean = (text: string | undefined) => {
  // AIS pads names with "@" and spaces.
  const trimmed = text?.replace(/@+/g, ' ').trim()
  return trimmed ? trimmed : undefined
}

/** Latest known state of every vessel heard recently, whichever source reported it. */
export class VesselTable {
  private readonly vessels = new Map<number, VesselRecord>()

  get size(): number {
    return this.vessels.size
  }

  position(update: PositionUpdate): void {
    const existing = this.vessels.get(update.mmsi)
    // The two sources overlap; keep whichever heard the vessel last.
    if (existing && existing.at > update.at) return
    this.vessels.set(update.mmsi, { ...existing, ...update, name: clean(update.name) ?? existing?.name })
  }

  /** Static data only matters for vessels we have a position for. */
  describe(update: StaticUpdate): void {
    const existing = this.vessels.get(update.mmsi)
    if (!existing) return
    this.vessels.set(update.mmsi, {
      ...existing,
      name: clean(update.name) ?? existing.name,
      callSign: clean(update.callSign) ?? existing.callSign,
      destination: clean(update.destination) ?? existing.destination,
      imo: update.imo && update.imo > 0 ? update.imo : existing.imo,
      shipType: update.shipType ?? existing.shipType,
    })
  }

  prune(now: number): void {
    for (const [mmsi, vessel] of this.vessels) if (now - vessel.at > EXPIRE_AFTER_MS) this.vessels.delete(mmsi)
  }

  view(bbox: BBox, { sanctioned, shadow, warships }: VesselLists): Ship[] {
    const on = (list: IdSets, v: VesselRecord) => list.mmsi.has(v.mmsi) || (v.imo !== undefined && list.imo.has(v.imo))
    const out: Ship[] = []
    for (const v of this.vessels.values()) {
      if (!inBBox(v.lon, v.lat, bbox)) continue
      const listing = Object.hasOwn(warships, v.mmsi) ? warships[v.mmsi] : null
      // 360 and 511 are how AIS says "not available".
      const cog = v.cog !== undefined && v.cog < 360 ? v.cog : undefined
      const heading = v.heading !== undefined && v.heading < 360 ? v.heading : null
      const moving = v.sogKn !== undefined && v.sogKn < 102 && v.sogKn > 0.3

      out.push({
        id: `ship:${v.mmsi}`,
        kind: 'ship',
        lon: v.lon,
        lat: v.lat,
        ...(cog !== undefined || heading !== null ? { trk: moving ? (cog ?? heading!) : (heading ?? cog!) } : {}),
        spd: moving ? v.sogKn! * KNOTS_TO_MS : 0,
        label: v.name ?? String(v.mmsi),
        ts: v.at,
        flags: (on(sanctioned, v) ? Flag.SANCTIONED : 0) | (on(shadow, v) ? Flag.SHADOW_FLEET : 0),
        props: {
          mmsi: v.mmsi,
          imo: v.imo ?? null,
          name: v.name ?? null,
          callSign: v.callSign ?? null,
          type: shipTypeOf(v.shipType),
          destination: v.destination ?? null,
          heading,
          status: v.navStat !== undefined ? (NAV_STATUS[v.navStat] ?? null) : null,
          flagState: flagStateOf(v.mmsi),
          service: serviceOf(v, warships),
          listedAs: listing?.filter(Boolean).join(', ') || null,
          source: v.source,
        },
      })
    }
    return out
  }
}

// ---- Digitraffic (Finnish Transport Infrastructure Agency, open data) ------------------------

interface DigitrafficLocations {
  /** When Digitraffic put this answer together, on its clock. */
  dataUpdatedTime?: string
  features?: {
    mmsi?: number
    geometry?: { coordinates?: [number, number] }
    properties?: { sog?: number; cog?: number; heading?: number; navStat?: number; timestampExternal?: number }
  }[]
}

/**
 * Digitraffic stamps every report with its own clock. Reports are dated on ours instead, by
 * how old each one was when the answer was put together. (The answer may then have sat in
 * Digitraffic's cache for up to a minute, which matters little at a ship's pace.)
 */
export function parseDigitrafficLocations(data: DigitrafficLocations, receivedAt: number): PositionUpdate[] {
  const features = data.features ?? []
  const builtAt = Date.parse(data.dataUpdatedTime ?? '')
  // Without that time, the newest report in the answer stands in for "now" on their clock.
  const theirNow = Number.isFinite(builtAt)
    ? builtAt
    : features.reduce((newest, feature) => Math.max(newest, feature.properties?.timestampExternal ?? 0), 0)

  const out: PositionUpdate[] = []
  for (const feature of features) {
    const [lon, lat] = feature.geometry?.coordinates ?? []
    const p = feature.properties
    if (!feature.mmsi || typeof lon !== 'number' || typeof lat !== 'number' || !p?.timestampExternal) continue
    out.push({
      mmsi: feature.mmsi,
      lon,
      lat,
      at: receivedAt - Math.max(0, theirNow - p.timestampExternal),
      sogKn: p.sog,
      cog: p.cog,
      heading: p.heading,
      navStat: p.navStat,
      source: 'digitraffic',
    })
  }
  return out
}

interface DigitrafficVessel {
  mmsi?: number
  name?: string
  callSign?: string
  imo?: number
  shipType?: number
  destination?: string
}

export function parseDigitrafficVessels(list: readonly DigitrafficVessel[]): StaticUpdate[] {
  return list
    .filter((vessel): vessel is DigitrafficVessel & { mmsi: number } => typeof vessel.mmsi === 'number')
    .map((v) => ({ mmsi: v.mmsi, name: v.name, callSign: v.callSign, imo: v.imo, shipType: v.shipType, destination: v.destination }))
}

// ---- AISStream (aisstream.io, needs a key) ----------------------------------------------------

interface AisStreamMessage {
  MessageType?: string
  MetaData?: { MMSI?: number; ShipName?: string }
  Message?: Record<string, Record<string, unknown> | undefined>
}

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** One AISStream message, turned into a position update, a static update, or nothing. */
export function parseAisStreamMessage(
  raw: string,
  receivedAt: number,
): { position?: PositionUpdate; static?: StaticUpdate } | null {
  let message: AisStreamMessage
  try {
    message = JSON.parse(raw) as AisStreamMessage
  } catch {
    return null
  }
  const type = message.MessageType
  const body = type ? message.Message?.[type] : undefined
  const mmsi = number(message.MetaData?.MMSI) ?? number(body?.UserID)
  if (!type || !body || !mmsi) return null

  if (type === 'ShipStaticData' || type === 'StaticDataReport') {
    const reportB = body.ReportB as Record<string, unknown> | undefined
    const reportA = body.ReportA as Record<string, unknown> | undefined
    return {
      static: {
        mmsi,
        name: (body.Name ?? reportA?.Name ?? message.MetaData?.ShipName) as string | undefined,
        callSign: (body.CallSign ?? reportB?.CallSign) as string | undefined,
        imo: number(body.ImoNumber),
        shipType: number(body.Type) ?? number(reportB?.ShipType),
        destination: body.Destination as string | undefined,
      },
    }
  }

  const lat = number(body.Latitude)
  const lon = number(body.Longitude)
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return {
    position: {
      mmsi,
      lon,
      lat,
      at: receivedAt,
      sogKn: number(body.Sog),
      cog: number(body.Cog),
      heading: number(body.TrueHeading),
      navStat: number(body.NavigationalStatus),
      name: message.MetaData?.ShipName,
      source: 'aisstream',
    },
  }
}

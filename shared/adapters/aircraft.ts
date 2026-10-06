import { roleOf } from '../data/aircraftRoles'
import { type Aircraft, FEET_TO_M, FPM_TO_MS, Flag, KNOTS_TO_MS } from '../entity'

/**
 * One aircraft as published by readsb-based aggregators (adsb.lol, adsb.fi).
 * Only the fields used here; everything is optional because targets report unevenly.
 */
export interface ReadsbAircraft {
  hex: string
  type?: string
  flight?: string
  r?: string
  t?: string
  category?: string
  squawk?: string
  emergency?: string
  alt_baro?: number | 'ground'
  alt_geom?: number
  gs?: number
  track?: number
  true_heading?: number
  baro_rate?: number
  geom_rate?: number
  lat?: number
  lon?: number
  nic?: number
  nac_p?: number
  version?: number
  seen_pos?: number
  gpsOkBefore?: number
  dbFlags?: number
  /** Airframe description and operator from the aggregator's database. Only adsb.fi sends them. */
  desc?: string
  ownOp?: string
}

export interface ReadsbResponse {
  ac?: ReadsbAircraft[]
}

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700'])

function positionSource(type: string | undefined): Aircraft['props']['source'] {
  if (!type) return 'other'
  if (type.startsWith('adsb') || type.startsWith('adsr')) return 'adsb'
  if (type === 'mlat') return 'mlat'
  if (type.startsWith('tisb')) return 'tisb'
  return 'other'
}

/**
 * GPS interference shows up in the data aircraft broadcast about their own position.
 * Flagged when the aircraft recently lost a good GPS fix, or when a transponder that
 * reports integrity says it has none while airborne. Version 0 transponders are left
 * out of the second test: they report zero integrity even when nothing is wrong.
 */
function gpsDegraded(a: ReadsbAircraft, onGround: boolean): boolean {
  if (a.gpsOkBefore != null) return true
  const reportsIntegrity = (a.version ?? 0) >= 1
  return reportsIntegrity && !onGround && (a.nic === 0 || a.nac_p === 0)
}

/**
 * @param receivedAt Our clock when the response arrived. Each position is dated back from
 *   it by the age the aggregator reports, so timestamps never depend on two machines'
 *   clocks agreeing with each other.
 */
export function normaliseAircraft(response: ReadsbResponse, receivedAt: number): Aircraft[] {
  const out: Aircraft[] = []
  for (const a of response.ac ?? []) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue

    const onGround = a.alt_baro === 'ground'
    const callsign = a.flight?.trim() || null
    const emergency = (a.squawk != null && EMERGENCY_SQUAWKS.has(a.squawk)) || (a.emergency != null && a.emergency !== 'none')
    const military = ((a.dbFlags ?? 0) & 1) !== 0
    const type = a.t ?? null
    const category = a.category ?? null
    const description = a.desc?.trim() || null

    let flags = 0
    if (military) flags |= Flag.MIL
    if (emergency) flags |= Flag.EMERGENCY
    if (onGround) flags |= Flag.ON_GROUND
    if (gpsDegraded(a, onGround)) flags |= Flag.GPS_DEGRADED

    const altFeet = a.alt_geom ?? (typeof a.alt_baro === 'number' ? a.alt_baro : undefined)
    const rateFpm = a.baro_rate ?? a.geom_rate
    const track = a.track ?? a.true_heading

    out.push({
      id: `aircraft:${a.hex}`,
      kind: 'aircraft',
      lon: a.lon,
      lat: a.lat,
      ...(onGround ? { alt: 0 } : altFeet !== undefined && { alt: Math.round(altFeet * FEET_TO_M) }),
      ...(track !== undefined && { trk: track }),
      ...(a.gs !== undefined && { spd: a.gs * KNOTS_TO_MS }),
      ...(rateFpm !== undefined && { vr: rateFpm * FPM_TO_MS }),
      label: callsign ?? a.r ?? a.hex.toUpperCase(),
      ts: Math.round(receivedAt - (a.seen_pos ?? 0) * 1000),
      flags,
      props: {
        hex: a.hex,
        callsign,
        registration: a.r ?? null,
        type,
        category,
        squawk: a.squawk ?? null,
        source: positionSource(a.type),
        nic: a.nic ?? null,
        nacP: a.nac_p ?? null,
        gpsLost: a.gpsOkBefore != null,
        reportsIntegrity: (a.version ?? 0) >= 1,
        role: military ? roleOf({ hex: a.hex, type, category, description }) : null,
        description,
        operator: a.ownOp?.trim() || null,
      },
    })
  }
  return out
}

/**
 * Two aircraft lists as one. Where both know an aircraft the first list's record is kept, and
 * only what it lacks is taken from the second: the airframe details, and the military mark. The
 * aggregators' databases do not always agree on that one, and an aircraft should not turn civil
 * on the map because the other source has started answering for it.
 */
export function mergeByHex(first: readonly Aircraft[], second: readonly Aircraft[]): Aircraft[] {
  const extra = new Map(second.map((aircraft) => [aircraft.props.hex, aircraft]))
  const out = first.map((aircraft) => {
    const other = extra.get(aircraft.props.hex)
    if (!other) return aircraft
    extra.delete(aircraft.props.hex)
    const { props } = aircraft
    return {
      ...aircraft,
      flags: aircraft.flags | (other.flags & Flag.MIL),
      props: {
        ...props,
        role: props.role ?? other.props.role,
        description: props.description ?? other.props.description,
        operator: props.operator ?? other.props.operator,
      },
    }
  })
  return [...out, ...extra.values()]
}

/**
 * The two worldwide military lists as one. Where both have an aircraft the newer position is
 * kept, with the airframe details only adsb.fi sends.
 */
export function mergeMilitaryLists(fi: readonly Aircraft[], lol: readonly Aircraft[]): Aircraft[] {
  const ours = new Map(fi.map((aircraft) => [aircraft.props.hex, aircraft]))
  const newer = lol.flatMap((theirs) => {
    const mine = ours.get(theirs.props.hex)
    if (!mine || theirs.ts <= mine.ts) return []
    // adsb.lol reports some multilaterated ground speeds at about half their value, so for
    // those the speed stays adsb.fi's.
    return [theirs.props.source === 'mlat' ? { ...theirs, spd: mine.spd } : theirs]
  })
  return mergeByHex(mergeByHex(newer, fi), lol)
}

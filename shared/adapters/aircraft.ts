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

    let flags = 0
    if ((a.dbFlags ?? 0) & 1) flags |= Flag.MIL
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
        type: a.t ?? null,
        category: a.category ?? null,
        squawk: a.squawk ?? null,
        source: positionSource(a.type),
        nic: a.nic ?? null,
        nacP: a.nac_p ?? null,
        gpsLost: a.gpsOkBefore != null,
        reportsIntegrity: (a.version ?? 0) >= 1,
      },
    })
  }
  return out
}

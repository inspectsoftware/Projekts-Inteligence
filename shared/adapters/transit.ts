import type { Entity } from '../entity'

export type TransitMode = 'bus' | 'tram' | 'trolleybus' | 'minibus'

export interface TransitProps {
  /** Which operator's feed this came from, e.g. "Liepāja". */
  network: string
  mode: TransitMode
  route: string | null
  /** Number plate or fleet number, when the feed carries one. */
  vehicle: string | null
}

export type TransitVehicle = Entity<TransitProps>

export interface TransitNetwork {
  id: string
  name: string
}

const MODES: Record<string, TransitMode> = { '1': 'trolleybus', '2': 'bus', '3': 'tram', '4': 'minibus' }

/** Roughly the Baltic states: anything outside is a vehicle reporting from the depot's default position, or garbage. */
const inRange = (lon: number, lat: number) => lon > 20 && lon < 29 && lat > 53.8 && lat < 59.8

/**
 * Parses the headerless "gps.txt" position files several Latvian operators publish:
 *
 *   type, route, lon × 1e6, lat × 1e6, speed km/h, heading°, [vehicle, ...]
 *
 * A file holding just "0" or "1" means no vehicles are out.
 */
export function normaliseGpsTxt(text: string, network: TransitNetwork, receivedAt: number): TransitVehicle[] {
  const out: TransitVehicle[] = []
  const ordinals = new Map<string, number>()

  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',')
    if (cells.length < 6) continue
    const mode = MODES[cells[0].trim()]
    const lon = Number(cells[2]) / 1e6
    const lat = Number(cells[3]) / 1e6
    if (!mode || !Number.isFinite(lon) || !Number.isFinite(lat) || !inRange(lon, lat)) continue

    const route = cells[1].trim() || null
    const speedKmh = Number(cells[4])
    const heading = Number(cells[5])
    // Only some feeds identify the vehicle. Where they do not, "third bus on route 6" has to do:
    // stable enough between two polls for the icon to keep its place.
    const vehicle = /\d/.test(cells[6] ?? '') ? cells[6].trim() : null
    const group = `${cells[0].trim()}-${route ?? 'x'}`
    const ordinal = (ordinals.get(group) ?? 0) + 1
    ordinals.set(group, ordinal)
    const key = vehicle ? vehicle.replace(/[^\p{L}\p{N}]+/gu, '') : `${group}-${ordinal}`

    out.push({
      id: `transit:${network.id}:${key}`,
      kind: 'transit',
      lon,
      lat,
      ...(Number.isFinite(heading) && { trk: heading }),
      spd: Number.isFinite(speedKmh) ? speedKmh / 3.6 : 0,
      label: route ?? undefined,
      ts: receivedAt,
      flags: 0,
      props: { network: network.name, mode, route, vehicle },
    })
  }
  return out
}

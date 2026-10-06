import type { Entity } from '../entity'
import { type BBox, inBBox } from '../region'

export interface FireProps {
  /** Fire radiative power, megawatts: how much heat the satellite saw. */
  frpMw: number | null
  /** Brightness temperature in the 4 µm band, kelvin. */
  brightnessK: number | null
  confidence: 'low' | 'nominal' | 'high' | null
  satellite: string | null
  night: boolean
}

export type Fire = Entity<FireProps>

const CONFIDENCE: Record<string, FireProps['confidence']> = { l: 'low', n: 'nominal', h: 'high' }

function num(value: string | undefined): number | null {
  const parsed = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

/**
 * Parses NASA FIRMS' active-fire CSV (VIIRS) and keeps the detections inside `bbox`.
 * Columns are looked up by name, so a reordered file still parses.
 */
export function normaliseFires(csv: string, bbox: BBox): Fire[] {
  const lines = csv.trim().split(/\r?\n/)
  const header = lines[0]?.split(',').map((name) => name.trim()) ?? []
  const column = (name: string) => header.indexOf(name)
  const [iLat, iLon, iDate, iTime] = [column('latitude'), column('longitude'), column('acq_date'), column('acq_time')]
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) return []
  const [iBright, iFrp, iConfidence, iSatellite, iDayNight] = [
    column('bright_ti4'),
    column('frp'),
    column('confidence'),
    column('satellite'),
    column('daynight'),
  ]

  const out: Fire[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const lat = Number(cells[iLat])
    const lon = Number(cells[iLon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBBox(lon, lat, bbox)) continue

    // acq_time is HHMM in UTC without leading zeros ("45" is 00:45).
    const hhmm = (cells[iTime] ?? '').padStart(4, '0')
    const ts = Date.parse(`${cells[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`)
    if (!Number.isFinite(ts)) continue

    out.push({
      id: `fire:${lat.toFixed(4)},${lon.toFixed(4)},${cells[iDate]}T${hhmm}`,
      kind: 'fire',
      lon,
      lat,
      ts,
      flags: 0,
      props: {
        frpMw: num(cells[iFrp]),
        brightnessK: num(cells[iBright]),
        confidence: CONFIDENCE[(cells[iConfidence] ?? '').trim().toLowerCase()] ?? null,
        satellite: cells[iSatellite]?.trim() || null,
        night: cells[iDayNight]?.trim().toUpperCase() === 'N',
      },
    })
  }
  return out
}

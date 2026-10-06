import type { Entity } from '../entity'

// ---- Gamma dose rate (EURDEP network, redistributed by Germany's BfS) ---------------------

export interface RadiationProps {
  name: string
  /** Ambient gamma dose rate, microsieverts per hour. Natural background is roughly 0.05 to 0.2. */
  usvh: number
}
export type RadiationStation = Entity<RadiationProps>

export interface EurdepFeatures {
  features?: {
    geometry?: { coordinates?: [number, number] }
    properties?: { id?: string; name?: string; value?: number; end_measure?: string }
  }[]
}

export function normaliseRadiation(data: EurdepFeatures): RadiationStation[] {
  return (data.features ?? []).flatMap(({ geometry, properties: p }) => {
    const [lon, lat] = geometry?.coordinates ?? []
    const ts = Date.parse(p?.end_measure ?? '')
    if (!p?.id || typeof p.value !== 'number' || typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(ts)) return []
    const name = p.name ?? p.id
    return [{ id: `radiation:${p.id}`, kind: 'radiation' as const, lon, lat, label: name, ts, flags: 0, props: { name, usvh: p.value } }]
  })
}

// ---- River and coastal gauges (LVĢMC) -----------------------------------------------------

export interface GaugeProps {
  name: string
  /** Water level in metres above the gauge's own zero. */
  levelM: number | null
  tempC: number | null
  dischargeM3s: number | null
  /** On the sea coast rather than a river or lake. */
  coastal: boolean
}
export type Gauge = Entity<GaugeProps>

export interface RawGauge {
  id?: number
  name?: string
  lat?: number
  lon?: number
  ts?: { name?: string; value?: string; unit?: string; last_date?: string }[]
}

export function normaliseGauges(stations: readonly RawGauge[], now: number): Gauge[] {
  return stations.flatMap((station) => {
    const series = station.ts ?? []
    const find = (pattern: RegExp) => series.find((one) => pattern.test(one.name ?? '') && Number.isFinite(Number(one.value)))
    const level = find(/līmenis/i)
    const temp = find(/temperatūra/i)
    const discharge = find(/caurplūdums/i)
    if (station.id === undefined || typeof station.lat !== 'number' || typeof station.lon !== 'number' || (!level && !temp)) return []
    // Times come without a zone and are UTC.
    const ts = Date.parse(`${(level ?? temp)!.last_date?.replace(' ', 'T')}Z`)
    const name = station.name ?? `Gauge ${station.id}`
    return [
      {
        id: `gauge:${station.id}`,
        kind: 'gauge' as const,
        lon: station.lon,
        lat: station.lat,
        label: name,
        ts: Number.isFinite(ts) ? ts : now,
        flags: 0,
        props: {
          name,
          levelM: level ? Number(level.value) / (level.unit === 'cm' ? 100 : 1) : null,
          tempC: temp ? Number(temp.value) : null,
          dischargeM3s: discharge ? Number(discharge.value) : null,
          coastal: series.some((one) => one.name?.startsWith('Piekrastes')),
        },
      },
    ]
  })
}

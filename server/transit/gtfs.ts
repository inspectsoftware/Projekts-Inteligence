import { inflateRawSync } from 'node:zlib'

/** The text files of a zip archive, by name. Reads the central directory, which is all a GTFS file needs. */
export function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end === -1) throw new Error('not a zip file')
  const files = new Map<string, string>()
  let at = zip.readUInt32LE(end + 16)
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const body = zip.subarray(start, start + size)
    files.set(name, (method === 0 ? body : inflateRawSync(body)).toString('utf8'))
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
  }
  return files
}

const QUOTED = /(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g

/** The cells of one CSV line. Most GTFS lines have no quotes, and those take the fast path. */
function cells(line: string): string[] {
  if (!line.includes('"')) return line.split(',').map((cell) => cell.trim())
  return [...line.matchAll(QUOTED)].map((m) => (m[1] !== undefined ? m[1].replaceAll('""', '"') : m[2]).trim())
}

/**
 * Walks the rows of a GTFS text file without building an object per row, which matters for
 * stop_times.txt (hundreds of thousands of rows). `col` gives a column's position by name, -1 when
 * the file has no such column. No field in these files spans lines.
 */
export function eachRow(text: string | undefined, visit: (row: string[], col: (name: string) => number) => void): void {
  if (!text) return
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = cells(lines[0])
  const positions = new Map(header.map((name, i) => [name, i]))
  const col = (name: string) => positions.get(name) ?? -1
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    visit(cells(lines[i]), col)
  }
}

/** Rows of a GTFS text file, keyed by column name. For the small files; see eachRow for the big ones. */
export function table(files: Map<string, string>, name: string): Record<string, string>[] {
  const text = files.get(name)
  if (!text) throw new Error(`${name} is missing from the archive`)
  const rows: Record<string, string>[] = []
  const header = cells(text.replace(/^﻿/, '').split(/\r?\n/, 1)[0])
  eachRow(text, (row) => {
    if (row.length < header.length) throw new Error(`${name}: short row "${row.join(',')}"`)
    rows.push(Object.fromEntries(header.map((column, i) => [column, row[i]])))
  })
  return rows
}

/** "25:04:00" -> seconds after the service day's midnight, which may pass 24 h. */
export function seconds(time: string): number {
  const [h, m, s] = time.split(':').map(Number)
  return h * 3600 + m * 60 + (s || 0)
}

export interface GtfsTrip {
  id: string
  route: number
  service: number
  headsign: string
  /** Index into shapes, or -1. */
  shape: number
  /** The trip's stops in order, as indices into stops. */
  stops: Int32Array
  /** Seconds after the service day's midnight at each stop. */
  times: Int32Array
}

export interface GtfsIndex {
  stops: { name: string; lon: number; lat: number }[]
  routes: { short: string; long: string; type: number }[]
  /** Weekdays it runs (Monday first, "1111100"), between two dates (yyyymmdd), with dates added and taken away. */
  services: { days: string; from: number; to: number; added: Set<number>; removed: Set<number> }[]
  trips: GtfsTrip[]
  tripById: Map<string, number>
  /** Trips by route short name, lower case: what a vehicle's feed calls its route. */
  tripsByRoute: Map<string, number[]>
  /** Each shape as lon, lat, lon, lat… Once put on the streets (streets.ts), the line on the road, in its lane. */
  shapes: Float64Array[]
  /** Which shapes have been put on the streets, and where along each its traffic signals stand, metres (streets.ts). */
  onStreets?: boolean[]
  signals?: number[][]
  /** Whether any of its routes is a trolleybus's (match.ts modeIn), worked out once. */
  hasTrolleybuses?: boolean
}

/** Reads a GTFS archive into what matching vehicles to trips and drawing them needs, and no more. */
export function indexGtfs(files: Map<string, string>): GtfsIndex {
  const stops: GtfsIndex['stops'] = []
  const stopIndex = new Map<string, number>()
  eachRow(files.get('stops.txt'), (row, col) => {
    stopIndex.set(row[col('stop_id')], stops.length)
    stops.push({ name: row[col('stop_name')], lon: Number(row[col('stop_lon')]), lat: Number(row[col('stop_lat')]) })
  })

  const routes: GtfsIndex['routes'] = []
  const routeIndex = new Map<string, number>()
  eachRow(files.get('routes.txt'), (row, col) => {
    routeIndex.set(row[col('route_id')], routes.length)
    const short = row[col('route_short_name')] ?? ''
    const long = row[col('route_long_name')] ?? ''
    routes.push({ short, long, type: Number(row[col('route_type')]) })
  })

  const services: GtfsIndex['services'] = []
  const serviceIndex = new Map<string, number>()
  const service = (id: string) => {
    let at = serviceIndex.get(id)
    if (at === undefined) {
      at = services.length
      serviceIndex.set(id, at)
      services.push({ days: '0000000', from: 0, to: 0, added: new Set(), removed: new Set() })
    }
    return at
  }
  eachRow(files.get('calendar.txt'), (row, col) => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => row[col(day)]).join('')
    Object.assign(services[service(row[col('service_id')])], { days, from: Number(row[col('start_date')]), to: Number(row[col('end_date')]) })
  })
  eachRow(files.get('calendar_dates.txt'), (row, col) => {
    const entry = services[service(row[col('service_id')])]
    ;(row[col('exception_type')] === '1' ? entry.added : entry.removed).add(Number(row[col('date')]))
  })

  const shapeIndex = new Map<string, number>()
  const shapePoints: [number, number, number][][] = []
  eachRow(files.get('shapes.txt'), (row, col) => {
    const id = row[col('shape_id')]
    let at = shapeIndex.get(id)
    if (at === undefined) {
      at = shapePoints.length
      shapeIndex.set(id, at)
      shapePoints.push([])
    }
    shapePoints[at].push([Number(row[col('shape_pt_sequence')]), Number(row[col('shape_pt_lon')]), Number(row[col('shape_pt_lat')])])
  })
  const shapes = shapePoints.map((points) => withoutStopKinks(Float64Array.from(points.sort((a, b) => a[0] - b[0]).flatMap(([, lon, lat]) => [lon, lat])), stops))

  const trips: GtfsTrip[] = []
  const tripById = new Map<string, number>()
  eachRow(files.get('trips.txt'), (row, col) => {
    const route = routeIndex.get(row[col('route_id')])
    if (route === undefined) return
    tripById.set(row[col('trip_id')], trips.length)
    trips.push({
      id: row[col('trip_id')],
      route,
      service: service(row[col('service_id')]),
      headsign: row[col('trip_headsign')] ?? '',
      shape: shapeIndex.get(row[col('shape_id')] ?? '') ?? -1,
      stops: new Int32Array(0),
      times: new Int32Array(0),
    })
  })

  // stop_times.txt need not be in order: gather each trip's rows, then sort them by sequence.
  const gathered: number[][] = trips.map(() => [])
  eachRow(files.get('stop_times.txt'), (row, col) => {
    const trip = tripById.get(row[col('trip_id')])
    const stop = stopIndex.get(row[col('stop_id')])
    if (trip === undefined || stop === undefined) return
    // Departure, not arrival: what a rider waits for, and what stops.lt counts a trip's start from.
    const time = row[col('departure_time')] || row[col('arrival_time')]
    if (!time) return
    gathered[trip].push(Number(row[col('stop_sequence')]), stop, seconds(time))
  })
  gathered.forEach((flat, i) => {
    const order = Array.from({ length: flat.length / 3 }, (_, k) => k).sort((a, b) => flat[3 * a] - flat[3 * b])
    trips[i].stops = Int32Array.from(order, (k) => flat[3 * k + 1])
    trips[i].times = Int32Array.from(order, (k) => flat[3 * k + 2])
  })

  const tripsByRoute = new Map<string, number[]>()
  trips.forEach((trip, i) => {
    if (trip.stops.length < 2) return
    const key = routes[trip.route].short.toLowerCase()
    const list = tripsByRoute.get(key)
    if (list) list.push(i)
    else tripsByRoute.set(key, [i])
  })

  return { stops, routes, services, trips, tripById, tripsByRoute, shapes }
}

/** A vertex this close to a stop is the stop itself, put into the line by whoever drew it. */
const ON_STOP_M = 2
/** Off the street by more than this, such a vertex is a kink worth taking out; by more than the last, not a kink but the route. */
const KINK_M: readonly [number, number] = [3, 80]

/**
 * A route's line without the jogs to its stops. The operators' tools draw each line through the
 * exact point of every stop, which stands on the pavement or in a bay beside the road, so the line
 * kinks off the street at each one, and a vehicle moved along it would too. A vertex on a stop that
 * stands out from the straight line between its neighbours is dropped; the stop itself is still
 * drawn where it is.
 */
export function withoutStopKinks(shape: Float64Array, stops: readonly { lon: number; lat: number }[]): Float64Array {
  if (shape.length < 6) return shape
  const cell = (lon: number, lat: number) => `${Math.round(lon * 2000)},${Math.round(lat * 2000)}`
  const grid = new Map<string, { lon: number; lat: number }[]>()
  // Only the stops near this line, found by the grid cells it passes through.
  const wanted = new Set<string>()
  for (let i = 0; i < shape.length; i += 2) wanted.add(cell(shape[i], shape[i + 1]))
  for (const stop of stops) {
    const key = cell(stop.lon, stop.lat)
    if (!wanted.has(key)) continue
    const list = grid.get(key)
    if (list) list.push(stop)
    else grid.set(key, [stop])
  }
  if (grid.size === 0) return shape

  const k = Math.cos(shape[1] * (Math.PI / 180))
  const metres = (lon1: number, lat1: number, lon2: number, lat2: number) => Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320
  const onStop = (lon: number, lat: number) => (grid.get(cell(lon, lat)) ?? []).some((stop) => metres(lon, lat, stop.lon, stop.lat) < ON_STOP_M)

  const out: number[] = [shape[0], shape[1]]
  for (let i = 2; i < shape.length - 2; i += 2) {
    const [ax, ay] = [out[out.length - 2], out[out.length - 1]]
    const [px, py, bx, by] = [shape[i], shape[i + 1], shape[i + 2], shape[i + 3]]
    if (onStop(px, py)) {
      const ab = metres(ax, ay, bx, by)
      const off = ab === 0 ? 0 : (Math.abs((bx - ax) * k * (ay - py) - (ax - px) * k * (by - ay)) * 111_320 * 111_320) / ab
      if (off > KINK_M[0] && off < KINK_M[1]) continue
    }
    out.push(px, py)
  }
  out.push(shape[shape.length - 2], shape[shape.length - 1])
  return Float64Array.from(out)
}

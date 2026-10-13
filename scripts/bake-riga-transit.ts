// Manual, monthly: builds the routes, stops and timetable of Rīgas satiksme from the GTFS files
// it publishes on data.gov.lv (CC0 1.0) into public/data/riga-transit.json (what the map draws)
// and public/data/riga-timetable.json (what answers "when does the next one leave").
// Never runs as part of `npm run build`; the results are committed. The operator publishes a new
// file about once a month, and this reads whichever one the dataset lists last.
//
//   npx tsx scripts/bake-riga-transit.ts            # uses the cached file when present
//   npx tsx scripts/bake-riga-transit.ts --refresh  # downloads it again
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import type { Timetable } from '../shared/adapters/timetable'
import type { TransitMode } from '../shared/adapters/transit'
import { simplify } from '../shared/geo/simplify'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/riga-transit')
const outDir = join(root, 'public/data')
const refresh = process.argv.includes('--refresh')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const DATASET = 'https://data.gov.lv/dati/api/3/action/package_show?id=marsrutu-saraksti-rigas-satiksme-sabiedriskajam-transportam'

/** GTFS route types, with the extended code Rīga uses for trolleybuses. */
const MODES: Record<string, TransitMode> = { '0': 'tram', '3': 'bus', '11': 'trolleybus', '800': 'trolleybus' }
const MODE_ORDER: readonly TransitMode[] = ['bus', 'tram', 'trolleybus']
/** About three metres: a street corner survives, the jitter along a straight does not. */
const SHAPE_TOLERANCE = 0.00003

mkdirSync(cacheDir, { recursive: true })

async function download(): Promise<Buffer> {
  const file = join(cacheDir, 'gtfs.zip')
  if (!refresh && existsSync(file)) return readFileSync(file)
  const headers = { 'User-Agent': USER_AGENT }
  const dataset = await fetch(DATASET, { headers, signal: AbortSignal.timeout(60_000) })
  if (!dataset.ok) throw new Error(`dataset: HTTP ${dataset.status}`)
  const resources: { name: string; created: string; url: string }[] = (await dataset.json()).result.resources
  const newest = resources.filter((resource) => /\.zip$/i.test(resource.url)).sort((a, b) => a.created.localeCompare(b.created)).at(-1)
  if (!newest) throw new Error('dataset lists no zip file')
  console.log(`downloading ${newest.name} (published ${newest.created.slice(0, 10)})`)
  const res = await fetch(newest.url, { headers, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${newest.name}: HTTP ${res.status}`)
  const zip = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, zip)
  return zip
}

/** The text files of a zip archive, by name. Reads the central directory, which is all a GTFS file needs. */
function unzip(zip: Buffer): Map<string, string> {
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

/** Rows of a GTFS text file, keyed by column name. No field in these files spans lines. */
function table(files: Map<string, string>, name: string): Record<string, string>[] {
  const text = files.get(name)
  if (!text) throw new Error(`${name} is missing from the archive`)
  const cells = (line: string) => [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) => (m[1] !== undefined ? m[1].replaceAll('""', '"') : m[2]).trim())
  const [head, ...lines] = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  const columns = cells(head)
  return lines.map((line) => {
    const row = cells(line)
    if (row.length < columns.length) throw new Error(`${name}: short row "${line}"`)
    return Object.fromEntries(columns.map((column, i) => [column, row[i]]))
  })
}

/** Index of a value in a list of distinct values, adding it when new. */
function intern<T>(list: T[], seen: Map<string, number>, key: string, value: T): number {
  let index = seen.get(key)
  if (index === undefined) {
    index = list.push(value) - 1
    seen.set(key, index)
  }
  return index
}

const minutes = (time: string): number => {
  const [h, m, s] = time.split(':').map(Number)
  if (s !== 0) throw new Error(`a time with seconds: ${time}`)
  return h * 60 + m
}
const round = (n: number) => Math.round(n * 1e5) / 1e5
const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

const files = unzip(await download())

const routes = table(files, 'routes.txt').map((row) => {
  const mode = MODES[row.route_type]
  if (!mode) throw new Error(`route ${row.route_id}: unknown route_type ${row.route_type}`)
  return { id: row.route_id, name: row.route_short_name, title: row.route_long_name, url: row.route_url, mode }
})
const routeIndex = new Map(routes.map((route, i) => [route.id, i]))

const timetable: Timetable = { routes: routes.map((route) => [route.name, route.mode]), headsigns: [], stops: [], services: [], paths: [], offsets: [], trips: [] }

const serviceIndex = new Map<string, number>()
for (const row of table(files, 'calendar.txt')) {
  const days = [row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday].join('')
  serviceIndex.set(row.service_id, timetable.services.push([days, Number(row.start_date), Number(row.end_date), [], []]) - 1)
}
for (const row of table(files, 'calendar_dates.txt')) {
  // A service may exist only as a list of dates, with no weekly pattern at all.
  const index = intern(timetable.services, serviceIndex, row.service_id, ['0000000', 0, 0, [], []])
  timetable.services[index][row.exception_type === '1' ? 3 : 4].push(Number(row.date))
}

const calls = new Map<string, { stop: string; at: number; order: number }[]>()
for (const row of table(files, 'stop_times.txt')) {
  const list = calls.get(row.trip_id) ?? []
  list.push({ stop: row.stop_id, at: minutes(row.departure_time), order: Number(row.stop_sequence) })
  calls.set(row.trip_id, list)
}

const seen = { headsign: new Map<string, number>(), stop: new Map<string, number>(), path: new Map<string, number>(), offsets: new Map<string, number>() }
/** Which routes call at each stop, and which shapes each route's trips follow. */
const routesAt = new Map<string, Set<number>>()
const shapesOf = new Map<number, Set<string>>()

for (const row of table(files, 'trips.txt')) {
  const route = routeIndex.get(row.route_id)
  const service = serviceIndex.get(row.service_id)
  const stops = calls.get(row.trip_id)?.sort((a, b) => a.order - b.order)
  if (route === undefined || service === undefined || !stops || stops.length < 2) continue
  const path = stops.map((call) => intern(timetable.stops, seen.stop, call.stop, call.stop))
  const offsets = stops.map((call) => call.at - stops[0].at)
  timetable.trips.push([
    route,
    service,
    intern(timetable.headsigns, seen.headsign, row.trip_headsign, row.trip_headsign),
    intern(timetable.paths, seen.path, path.join(), path),
    intern(timetable.offsets, seen.offsets, offsets.join(), offsets),
    stops[0].at,
  ])
  for (const call of stops) routesAt.set(call.stop, (routesAt.get(call.stop) ?? new Set()).add(route))
  if (row.shape_id) shapesOf.set(route, (shapesOf.get(route) ?? new Set()).add(row.shape_id))
}

const shapes = new Map<string, { order: number; point: [number, number] }[]>()
for (const row of table(files, 'shapes.txt')) {
  const list = shapes.get(row.shape_id) ?? []
  list.push({ order: Number(row.shape_pt_sequence), point: [Number(row.shape_pt_lon), Number(row.shape_pt_lat)] })
  shapes.set(row.shape_id, list)
}

const features: object[] = []
for (const [index, route] of routes.entries()) {
  const lines = [...(shapesOf.get(index) ?? [])].map((id) =>
    simplify(
      (shapes.get(id) ?? []).sort((a, b) => a.order - b.order).map((entry) => entry.point),
      SHAPE_TOLERANCE,
    ).map(([lon, lat]) => [round(lon), round(lat)]),
  )
  if (lines.length === 0) continue
  features.push({
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: lines },
    properties: { class: 'route', mode: route.mode, ref: route.name, name: route.title, url: route.url },
  })
}

let stopCount = 0
for (const row of table(files, 'stops.txt')) {
  const calling = routesAt.get(row.stop_id)
  if (!calling) continue
  // The lines calling here, one property per kind of vehicle: "2, 3, 22".
  const lines = Object.fromEntries(
    MODE_ORDER.map((mode) => [mode, [...calling].filter((route) => routes[route].mode === mode).map((route) => routes[route].name).sort(byNumber).join(', ')]).filter(([, names]) => names),
  )
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(Number(row.stop_lon)), round(Number(row.stop_lat))] },
    properties: { class: 'stop', id: row.stop_id, name: row.stop_name, ...lines, ...(/request stop/i.test(row.stop_desc) && { request: 1 }) },
  })
  stopCount += 1
}

const write = (name: string, value: unknown) => {
  const json = JSON.stringify(value)
  writeFileSync(join(outDir, name), json)
  console.log(`${name}: ${(json.length / 1024).toFixed(0)} kB`)
}
write('riga-transit.json', { type: 'FeatureCollection', features })
write('riga-timetable.json', timetable)
console.log(`${features.length - stopCount} routes, ${stopCount} stops, ${timetable.trips.length} trips over ${timetable.paths.length} paths`)

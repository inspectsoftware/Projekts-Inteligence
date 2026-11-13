// Manual, after scripts/build-tiles.mjs (whose merged OSM extract it reads): every road of the Baltic
// states that cars, buses or trams use, with what is known of its lanes (lanes, turn:lanes, placement,
// width), and the islands and hatched areas between them, cut into z12 squares in roads/ (or ROADS_DIR;
// scripts/roads/buckets.mjs): ways as {id, tags, nodes, coords}, the nodes with tags worth keeping
// (signals, crossings) as {node, tags, coord}. The server builds its lane tiles from them.
//
//   node scripts/extract-roads.mjs [path/to/extract.osm.pbf]
//
// Reads the PBF twice, with nothing but Node: the ways first, then only the nodes they use.
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { PbfReader as Pbf } from 'pbf'
import { ROADS_DIR, writeBuckets } from './roads/buckets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INPUT = process.argv[2] ?? join(ROOT, 'scripts/.cache/osm/baltic.osm.pbf')

/** Roads a car, bus or tram is on; footways and paths are drawn from the tiles. */
const ROADS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway',
])
const KEEP = /^(highway|oneway|junction|lanes(:.*)?|turn:lanes(:.*)?|change:lanes(:.*)?|placement(:.*)?|width(:.*)?|layer|bridge|tunnel|name|ref|service|area:highway|traffic_calming|surface|landuse|area|maxspeed|busway(:.*)?|cycleway(:.*)?|railway|crossing(:.*)?|sidewalk(:.*)?)$/
const NODE_KEEP = /^(highway|crossing(:.*)?|traffic_calming|traffic_signals(:.*)?|direction|railway)$/

function wanted(tags) {
  if (ROADS.has(tags.highway)) return true
  if (tags['area:highway'] === 'traffic_island' || tags['area:highway'] === 'prohibited') return true
  if (tags.traffic_calming === 'island') return true
  return tags.railway === 'tram'
}

/** Each blob of the file in turn, inflated: [type, bytes]. */
function* blobs(path) {
  const fd = openSync(path, 'r')
  const size = statSync(path).size
  const head = Buffer.alloc(4)
  let pos = 0
  try {
    while (pos < size) {
      readSync(fd, head, 0, 4, pos)
      const hlen = head.readUInt32BE(0)
      const hbuf = Buffer.alloc(hlen)
      readSync(fd, hbuf, 0, hlen, pos + 4)
      const header = new Pbf(hbuf).readFields((tag, h, p) => {
        if (tag === 1) h.type = p.readString()
        else if (tag === 3) h.size = p.readVarint()
      }, { type: '', size: 0 })
      const bbuf = Buffer.alloc(header.size)
      readSync(fd, bbuf, 0, header.size, pos + 4 + hlen)
      pos += 4 + hlen + header.size
      const blob = new Pbf(bbuf).readFields((tag, b, p) => {
        if (tag === 1) b.raw = p.readBytes()
        else if (tag === 3) b.zlib = p.readBytes()
      }, {})
      yield [header.type, blob.zlib ? inflateSync(blob.zlib) : blob.raw]
    }
  } finally {
    closeSync(fd)
  }
}

/** A primitive block's strings, offsets and the ways and nodes in its groups, decoded on demand. */
function block(bytes, onWay, onDense) {
  const pb = new Pbf(bytes)
  const st = { strings: [], gran: 100, latOff: 0, lonOff: 0, groups: [] }
  pb.readFields((tag, s, p) => {
    if (tag === 1) {
      const end = p.readVarint() + p.pos
      while (p.pos < end) {
        const t = p.readVarint() >> 3
        if (t === 1) s.strings.push(p.readString())
        else p.skip(2)
      }
    } else if (tag === 2) {
      const len = p.readVarint()
      s.groups.push([p.pos, p.pos + len])
      p.pos += len
    } else if (tag === 17) s.gran = p.readVarint()
    else if (tag === 19) s.latOff = p.readVarint(true)
    else if (tag === 20) s.lonOff = p.readVarint(true)
  }, st)
  for (const [start, end] of st.groups) {
    pb.pos = start
    while (pb.pos < end) {
      const val = pb.readVarint()
      const tag = val >> 3
      if (tag === 3 && onWay) {
        const wend = pb.readVarint() + pb.pos
        const w = { id: 0, keys: [], vals: [], refs: [] }
        while (pb.pos < wend) {
          const v = pb.readVarint()
          pb.type = v & 7
          const t = v >> 3
          if (t === 1) w.id = pb.readVarint(true)
          else if (t === 2) pb.readPackedVarint(w.keys)
          else if (t === 3) pb.readPackedVarint(w.vals)
          else if (t === 8) pb.readPackedSVarint(w.refs)
          else pb.skip(v)
        }
        const tags = {}
        for (let i = 0; i < w.keys.length; i++) tags[st.strings[w.keys[i]]] = st.strings[w.vals[i]]
        let ref = 0
        onWay(w.id, tags, w.refs.map((d) => (ref += d)))
      } else if (tag === 2 && onDense) {
        const dend = pb.readVarint() + pb.pos
        const ids = [], lats = [], lons = [], kv = []
        while (pb.pos < dend) {
          const v = pb.readVarint()
          pb.type = v & 7
          const t = v >> 3
          if (t === 1) pb.readPackedSVarint(ids)
          else if (t === 8) pb.readPackedSVarint(lats)
          else if (t === 9) pb.readPackedSVarint(lons)
          else if (t === 10) pb.readPackedVarint(kv)
          else pb.skip(v)
        }
        let id = 0, lat = 0, lon = 0, k = 0
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; lat += lats[i]; lon += lons[i]
          let tags = null
          if (kv.length) {
            while (kv[k] !== 0) {
              ;(tags ??= {})[st.strings[kv[k]]] = st.strings[kv[k + 1]]
              k += 2
            }
            k++
          }
          onDense(id, (st.lonOff + st.gran * lon) / 1e9, (st.latOff + st.gran * lat) / 1e9, tags)
        }
      } else pb.skip(val)
    }
  }
}

const t0 = Date.now()
// Pass 1: the ways, and which nodes they need.
const ways = []
const need = new Set()
for (const [type, bytes] of blobs(INPUT)) {
  if (type !== 'OSMData') continue
  block(bytes, (id, tags, refs) => {
    if (!wanted(tags) || refs.length < 2) return
    const kept = {}
    for (const k in tags) if (KEEP.test(k)) kept[k] = tags[k]
    ways.push({ id, tags: kept, nodes: refs })
    for (const r of refs) need.add(r)
  })
}
console.log(`pass 1: ${ways.length} ways, ${need.size} nodes, ${((Date.now() - t0) / 1000).toFixed(0)} s`)

// Pass 2: their coordinates, and the tags of the nodes that have any worth keeping.
const coords = new Map()
const nodeTags = []
for (const [type, bytes] of blobs(INPUT)) {
  if (type !== 'OSMData') continue
  block(bytes, null, (id, lon, lat, tags) => {
    if (!need.has(id)) return
    coords.set(id, [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7])
    if (!tags) return
    const kept = {}
    let any = false
    for (const k in tags) {
      if (!NODE_KEEP.test(k)) continue
      kept[k] = tags[k]
      any = true
    }
    if (any) nodeTags.push({ node: id, tags: kept })
  })
}
console.log(`pass 2: ${coords.size} nodes placed, ${((Date.now() - t0) / 1000).toFixed(0)} s`)

const out = []
for (const w of ways) {
  const c = w.nodes.map((n) => coords.get(n))
  if (!c.some((p) => !p)) out.push({ id: w.id, tags: w.tags, nodes: w.nodes, coords: c })
}
const placed = nodeTags.filter((n) => coords.has(n.node)).map((n) => ({ ...n, coord: coords.get(n.node) }))
const buckets = writeBuckets(out, placed, ROADS_DIR, INPUT)
console.log(`${ROADS_DIR}: ${out.length} ways, ${placed.length} tagged nodes in ${buckets} squares, ${((Date.now() - t0) / 1000).toFixed(0)} s`)

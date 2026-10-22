/**
 * A reader for PMTiles archives, version 3: every tile of a map in one file on a plain web
 * server, read a piece at a time with HTTP range requests. The header and the root directory
 * come in the first 16 KB; the deeper directories and the tiles are fetched as they are wanted.
 * https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */

/**
 * One directory entry: the first tile id it covers, how many ids in a row share its bytes (0 when
 * it points at a deeper directory instead), and where those bytes are.
 */
interface Entry {
  id: number
  run: number
  offset: number
  length: number
}

interface Start {
  leafOffset: number
  dataOffset: number
  /** How directories and tiles are compressed: 1 none, 2 gzip. */
  internalCompression: number
  tileCompression: number
  root: Entry[]
}

/** The root directory always fits in the archive's first 16 KB, header included. */
const START_BYTES = 16384

/** How many deeper directories are kept. Each covers a wide area, so a session needs few. */
const LEAVES_KEPT = 64

/**
 * A tile's place along the Hilbert curve that orders the archive: every tile of the zooms above
 * comes first, then the curve through this zoom.
 */
export function tileId(z: number, x: number, y: number): number {
  let id = (4 ** z - 1) / 3
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = x & s ? 1 : 0
    const ry = y & s ? 1 : 0
    id += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      ;[x, y] = [y, x]
    }
  }
  return id
}

/** A directory: a count, then every entry's id (as the step from the one before), run, length and offset, column by column. */
function readDirectory(bytes: Uint8Array): Entry[] {
  let at = 0
  // Offsets into a file of hundreds of gigabytes pass 2^32, so the varints are added up, not shifted.
  const next = (): number => {
    let value = 0
    for (let scale = 1; ; scale *= 128) {
      if (at >= bytes.length) throw new Error('A PMTiles directory ends early')
      const byte = bytes[at++]
      value += (byte & 0x7f) * scale
      if (byte < 0x80) return value
    }
  }
  const count = next()
  const entries: Entry[] = []
  let id = 0
  for (let i = 0; i < count; i++) entries.push({ id: (id += next()), run: 0, offset: 0, length: 0 })
  for (const entry of entries) entry.run = next()
  for (const entry of entries) entry.length = next()
  entries.forEach((entry, i) => {
    // 0 means straight after the entry before; anything else is the offset plus one.
    const value = next()
    entry.offset = value === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : value - 1
  })
  return entries
}

/** The entry that holds a tile id: its own, one whose run reaches it, or the deeper directory it lies under. */
function findEntry(entries: Entry[], id: number): Entry | null {
  let low = 0
  let high = entries.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (entries[middle].id < id) low = middle + 1
    else if (entries[middle].id > id) high = middle - 1
    else return entries[middle]
  }
  const before = high >= 0 ? entries[high] : null
  return before && (before.run === 0 || id - before.id < before.run) ? before : null
}

async function decompress(bytes: Uint8Array<ArrayBuffer>, compression: number): Promise<Uint8Array<ArrayBuffer>> {
  if (compression === 1) return bytes
  if (compression !== 2) throw new Error(`PMTiles compression ${compression} is not supported`)
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}

async function fetchRange(url: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal })
  // A server that ignored the range would be sending the whole archive.
  if (res.status !== 206) {
    await res.body?.cancel()
    throw new Error(`HTTP ${res.status} for bytes ${offset}-${offset + length - 1} of ${url}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export class PmTiles {
  readonly url: string
  private start: Promise<Start> | null = null
  private leaves = new Map<number, Promise<Entry[]>>()

  constructor(url: string) {
    this.url = url
  }

  /**
   * One tile, decompressed; null where the archive has none. Only the tile's own request follows
   * the signal: the directories on the way are shared by every tile under them, so they are
   * fetched to the end and kept.
   */
  async getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
    const start = await this.readStart()
    const id = tileId(z, x, y)
    let entries = start.root
    // The spec allows directories three deep under the root.
    for (let depth = 0; depth < 4; depth++) {
      const entry = findEntry(entries, id)
      if (!entry) return null
      if (entry.run > 0) return decompress(await fetchRange(this.url, start.dataOffset + entry.offset, entry.length, signal), start.tileCompression)
      entries = await this.readLeaf(start, entry)
    }
    throw new Error(`The directories of ${this.url} run deeper than PMTiles allows`)
  }

  private readStart(): Promise<Start> {
    if (!this.start) {
      this.start = (async () => {
        const bytes = await fetchRange(this.url, 0, START_BYTES)
        if (bytes.length < 127 || new TextDecoder().decode(bytes.subarray(0, 7)) !== 'PMTiles' || bytes[7] !== 3) {
          throw new Error(`${this.url} is not a PMTiles archive of version 3`)
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const u64 = (at: number) => view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32
        const rootOffset = u64(8)
        const internalCompression = bytes[97]
        return {
          leafOffset: u64(40),
          dataOffset: u64(56),
          internalCompression,
          tileCompression: bytes[98],
          root: readDirectory(await decompress(bytes.slice(rootOffset, rootOffset + u64(16)), internalCompression)),
        }
      })()
      // A failure is not kept: the next tile asks again.
      this.start.catch(() => (this.start = null))
    }
    return this.start
  }

  private readLeaf(start: Start, entry: Entry): Promise<Entry[]> {
    let leaf = this.leaves.get(entry.offset)
    if (!leaf) {
      leaf = fetchRange(this.url, start.leafOffset + entry.offset, entry.length).then((bytes) => decompress(bytes, start.internalCompression)).then(readDirectory)
      // The oldest goes first: a Map keeps its keys in the order they were added.
      if (this.leaves.size >= LEAVES_KEPT) this.leaves.delete(this.leaves.keys().next().value!)
      this.leaves.set(entry.offset, leaf)
      leaf.catch(() => this.leaves.delete(entry.offset))
    }
    return leaf
  }
}

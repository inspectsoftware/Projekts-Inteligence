// Runs after both Vite builds:
//  - writes .br and .gz siblings for the client files so the server can send them as-is
//  - records which commit was built, for /api/health
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'dist/client')
const serverDir = join(root, 'dist/server')

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.geojson', '.txt'])
const MIN_BYTES = 1024

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

let count = 0
let before = 0
let after = 0
for (const file of walk(clientDir)) {
  if (!COMPRESSIBLE.has(extname(file))) continue
  const raw = readFileSync(file)
  if (raw.length < MIN_BYTES) continue
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  })
  writeFileSync(`${file}.br`, br)
  writeFileSync(`${file}.gz`, gzipSync(raw, { level: 9 }))
  count += 1
  before += raw.length
  after += br.length
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

writeFileSync(
  join(serverDir, 'build-info.json'),
  JSON.stringify({ commit: currentCommit(), builtAt: new Date().toISOString() }),
)

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`
console.log(`postbuild: precompressed ${count} client files (${kb(before)} -> ${kb(after)} brotli)`)

// Manual, weekly or monthly: builds tiles/baltic.pmtiles, our own vector tiles of Estonia, Latvia
// and Lithuania (schema: scripts/tiles/baltic.yml), with Planetiler from Geofabrik's OpenStreetMap
// extracts, merged into one with Osmosis first (Planetiler reads a single OSM file). Needs Java 21. Downloads what it lacks into scripts/.cache/osm; a fresh run fetches the
// extracts again when they are over a week old. Never part of `npm run build`: the result is
// hundreds of megabytes and is put on the server by hand, not committed.
//
//   node scripts/build-tiles.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(root, 'scripts/.cache/osm')
const out = join(root, 'tiles/baltic.pmtiles')
const WEEK = 7 * 24 * 3600_000
const JAR = 'https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar'
const OSMOSIS = 'https://github.com/openstreetmap/osmosis/releases/download/0.49.2/osmosis-0.49.2.tar'
const COUNTRIES = ['latvia', 'lithuania', 'estonia']

mkdirSync(cache, { recursive: true })
mkdirSync(dirname(out), { recursive: true })

async function fetchTo(url, file, maxAge = Infinity) {
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < maxAge) return
  console.log('downloading', url)
  const res = await fetch(url, { headers: { 'User-Agent': 'ProjektsInteligence/0.1 (tile build)' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

await fetchTo(JAR, join(cache, 'planetiler.jar'))
for (const country of COUNTRIES) await fetchTo(`https://download.geofabrik.de/europe/${country}-latest.osm.pbf`, join(cache, `${country}-latest.osm.pbf`), WEEK)

/** Java 21: JAVA_HOME, else Temurin where winget puts it, else whatever `java` is on the path. */
function java() {
  if (process.env.JAVA_HOME) return join(process.env.JAVA_HOME, 'bin', 'java')
  const adoptium = 'C:/Program Files/Eclipse Adoptium'
  if (existsSync(adoptium)) {
    const jre = readdirSync(adoptium).filter((name) => /^(jre|jdk)-21/.test(name)).sort().at(-1)
    if (jre) return join(adoptium, jre, 'bin', 'java.exe')
  }
  return 'java'
}

// One file of all three, made again whenever an extract is newer than it.
const merged = join(cache, 'baltic.osm.pbf')
const extracts = COUNTRIES.map((country) => join(cache, `${country}-latest.osm.pbf`))
if (!existsSync(merged) || extracts.some((file) => statSync(file).mtimeMs > statSync(merged).mtimeMs)) {
  const osmosisDir = join(cache, 'osmosis')
  if (!existsSync(osmosisDir)) {
    await fetchTo(OSMOSIS, join(cache, 'osmosis.tar'))
    mkdirSync(osmosisDir, { recursive: true })
    // Relative paths, run from the cache: given C:…, tar takes the drive letter for a remote host.
    const untar = spawnSync('tar', ['-xf', 'osmosis.tar', '-C', 'osmosis'], { cwd: cache, stdio: 'inherit' })
    if (untar.status !== 0) process.exit(untar.status ?? 1)
  }
  const bin = readdirSync(osmosisDir, { recursive: true }).find((name) => /bin[\\/]osmosis(\.bat)?$/.test(String(name)) && String(name).endsWith(process.platform === 'win32' ? '.bat' : 'osmosis'))
  if (!bin) throw new Error('osmosis not found in ' + osmosisDir)
  console.log('merging', COUNTRIES.join(', '))
  // --rb x3 then --merge twice: one stream of all three, written as one file.
  const args = [...extracts.flatMap((file) => ['--rb', file]), '--merge', '--merge', '--wb', merged]
  const merge = spawnSync(join(osmosisDir, String(bin)), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, JAVACMD: java(), JAVA_HOME: dirname(dirname(java())) },
  })
  if (merge.status !== 0) process.exit(merge.status ?? 1)
}

const started = Date.now()
const run = spawnSync(
  java(),
  [
    '-Xmx3g',
    '-jar',
    join(cache, 'planetiler.jar'),
    'generate-custom',
    `--schema=${join(root, 'scripts/tiles/baltic.yml')}`,
    // Built beside the one being served, and put in its place only once it is whole.
    `--output=${out}.next.pmtiles`,
    `--tmpdir=${join(root, 'scripts/.cache/planetiler-tmp')}`,
    '--force',
  ],
  { cwd: root, stdio: 'inherit' },
)
if (run.status !== 0) process.exit(run.status ?? 1)
renameSync(`${out}.next.pmtiles`, out)
console.log('tiles/baltic.pmtiles', Math.round(statSync(out).size / 1024 / 1024), 'MB in', Math.round((Date.now() - started) / 1000), 's')

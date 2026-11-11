// Manual, after scripts/build-tiles.mjs (whose merged OSM extract it reads): builds the road graph
// of Estonia, Latvia and Lithuania for Valhalla, the open-source navigation engine the server asks
// how each bus and tram line runs along the streets, lane by lane (server/transit/valhalla.ts).
//
//   node scripts/build-valhalla.mjs
//
// Needs Python 3.12 (PYTHON, else the per-user install); Valhalla itself comes as the pyvalhalla
// package, into a virtual environment in scripts/.cache. Writes valhalla/: valhalla.json and tiles/.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(root, 'scripts/.cache')
const venv = join(cache, 'valhalla-venv')
const out = join(root, 'valhalla')
const pbf = join(cache, 'osm/baltic.osm.pbf')
const PYVALHALLA = '3.9.1'

const windows = process.platform === 'win32'
const venvPython = join(venv, windows ? 'Scripts/python.exe' : 'bin/python')

function python() {
  if (process.env.PYTHON) return process.env.PYTHON
  const user = join(process.env.LOCALAPPDATA ?? '', 'Programs/Python/Python312/python.exe')
  return windows && existsSync(user) ? user : 'python3'
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(pbf)) {
  console.error('No', pbf, '- run node scripts/build-tiles.mjs first: it downloads and merges the extracts.')
  process.exit(1)
}
if (!existsSync(venvPython)) run(python(), ['-m', 'venv', venv])
run(venvPython, ['-m', 'pip', 'install', '-q', `pyvalhalla==${PYVALHALLA}`])

mkdirSync(join(out, 'tiles'), { recursive: true })
const config = join(out, 'valhalla.json')
// Valhalla's own defaults, pointed at our folder, and its service on this machine only.
const made = spawnSync(
  venvPython,
  [
    '-c',
    [
      'import json, sys, valhalla',
      // No archive: the tiles stay a folder, read where they lie.
      `c = valhalla.get_config(tile_extract="", tile_dir=${JSON.stringify(join(out, 'tiles'))}, verbose=True)`,
      'c["httpd"]["service"]["listen"] = "tcp://127.0.0.1:8002"',
      'c["mjolnir"]["concurrency"] = 4',
      // Intercity buses run further than the 200 km a trace may be by default.
      'c["service_limits"]["trace"]["max_distance"] = 600000',
      // The countries' borders, from the same extract: which side of the road they drive on, and their rules.
      `c["mjolnir"]["admin"] = ${JSON.stringify(join(out, 'admins.sqlite'))}`,
      'json.dump(c, sys.stdout, indent=1)',
    ].join('\n'),
  ],
  { cwd: root, encoding: 'utf8' },
)
if (made.status !== 0) {
  console.error(made.stderr)
  process.exit(1)
}
writeFileSync(config, made.stdout)

// The executables themselves, not through `python -m valhalla`, which reports success whatever they do.
const bin = spawnSync(venvPython, ['-m', 'valhalla', 'print_bin_path'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const exe = (name) => join(bin, windows ? `${name}.exe` : name)
// On Windows their DLLs come in the package's own folder, which pyvalhalla puts on the PATH for them.
const env = windows ? { ...process.env, PATH: `${join(bin, '../../pyvalhalla.libs')};${process.env.PATH ?? ''}` } : process.env

const started = Date.now()
run(exe('valhalla_build_admins'), ['-c', config, pbf], { env })
run(exe('valhalla_build_tiles'), ['-c', config, pbf], { env })
console.log('valhalla/tiles built in', Math.round((Date.now() - started) / 1000), 's')

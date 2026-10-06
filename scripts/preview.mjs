// Builds, then runs the production server the way Hostinger does (one process serving
// the API and the built client). Uses :4173 so it can run next to `npm run dev`.
//
//   node scripts/preview.mjs [port]
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2] ?? '4173'

function binOf(pkg) {
  const dir = resolve(root, 'node_modules', pkg)
  const { bin } = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  return resolve(dir, typeof bin === 'string' ? bin : bin[pkg])
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run([binOf('vite'), 'build'])
run([binOf('vite'), 'build', '--config', 'vite.server.config.ts'])
run(['scripts/postbuild.mjs'])

const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/index.js'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: port },
})
server.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill())

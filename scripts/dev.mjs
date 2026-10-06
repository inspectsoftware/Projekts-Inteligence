// Runs the Vite dev server (client, :5173) and the API server (:8787) together.
// Spawns node directly on each tool's entry script so it works without a shell on Windows.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Must match the proxy target in vite.config.ts. Set explicitly because a launcher may
// export PORT for the web UI, and the API server would otherwise pick that up.
const API_PORT = '8787'

function binOf(pkg) {
  const dir = resolve(root, 'node_modules', pkg)
  const { bin } = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  return resolve(dir, typeof bin === 'string' ? bin : bin[pkg])
}

const children = [
  spawn(process.execPath, [binOf('vite')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [binOf('tsx'), 'watch', '--env-file-if-exists=.env', 'server/index.ts'], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: API_PORT },
  }),
]

let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exit(code)
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

// Starts 3 isolated API servers for the security run, one per subagent group.
// Each gets its own PORT and its own owner/banned env, so they never share rate-limit
// tables or room state. API-only (no client build needed). Logs to scratchpad.
import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const { accounts, ports } = JSON.parse(readFileSync(resolve(here, 'accounts.local.json'), 'utf8'))
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs')
const logDir = process.env.SEC_LOG_DIR || here

const envs = {
  group1_impersonation: { CHAT_OWNER_IDS: accounts.group1_impersonation.owner.secret, CHAT_OWNER_NAME: 'TestOwner' },
  group2_limits:        { CHAT_BANNED_IDS: accounts.group2_limits.banned.uid },
  group3_outside:       {},
}

for (const [group, port] of Object.entries(ports)) {
  const out = createWriteStream(resolve(logDir, `server-${group}.log`))
  const child = spawn(process.execPath, [tsx, 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...envs[group], NODE_ENV: 'development' },
  })
  child.stdout.pipe(out); child.stderr.pipe(out)
  child.on('exit', (c) => console.log(`[${group}] exited ${c}`))
  console.log(`[${group}] starting on :${port}`)
}

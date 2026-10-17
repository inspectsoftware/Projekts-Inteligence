/**
 * Pre-launch security gate. Regenerates throwaway test accounts, boots isolated API
 * servers (one per attack group + one with CHAT_DISABLED), runs every attack script and
 * the negative-control proofs, tears everything down, and exits non-zero if anything failed.
 *
 *   node tests/security/run.mjs
 *
 * Nothing here touches production: every server listens on 127.0.0.1 with test env only,
 * and no attack script writes to source. Accounts live in accounts.local.json (gitignored).
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs')
const node = process.execPath

const run = (args, env = {}) =>
  new Promise((res) => {
    const c = spawn(node, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
    c.on('exit', (code) => res(code ?? 1))
  })

const health = async (port) => {
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// 1. Fresh accounts.
await run([resolve(here, 'accounts.mjs')])
const { accounts } = JSON.parse(readFileSync(resolve(here, 'accounts.local.json'), 'utf8'))

// 2. Boot servers. Ports fixed so the group scripts' defaults match.
const servers = [
  { port: 8787, env: { CHAT_OWNER_IDS: accounts.group1_impersonation.owner.secret, CHAT_OWNER_NAME: 'TestOwner' } },
  { port: 8788, env: { CHAT_BANNED_IDS: accounts.group2_limits.banned.uid } },
  { port: 8789, env: {} },
  { port: 8790, env: { CHAT_DISABLED: '1' } },
]
const procs = servers.map(({ port, env }) =>
  spawn(node, [tsx, 'server/index.ts'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT: String(port), ...env } }),
)
const stop = () => procs.forEach((p) => p.kill())
process.on('exit', stop)

if (!(await Promise.all([8787, 8788, 8789, 8790].map(health))).every(Boolean)) {
  console.error('A test server did not come up')
  stop()
  process.exit(1)
}

// 3. Attacks + controls.
const codes = []
codes.push(['group1 impersonation', await run([resolve(here, 'group1-impersonation.mjs')], { BASE: 'http://127.0.0.1:8787' })])
codes.push(['group2 limits', await run([resolve(here, 'group2-limits.mjs')], { BASE: 'http://127.0.0.1:8788' })])
codes.push(['group3 outside', await run([resolve(here, 'group3-outside.mjs')], { BASE: 'http://127.0.0.1:8789' })])
codes.push(['negative controls', await run([tsx, resolve(here, 'negative-controls.ts')])])

// 4. CHAT_DISABLED control: both POST and GET /chat must be 503, feeds must still serve.
{
  const v = '0'.repeat(32)
  const post = await fetch('http://127.0.0.1:8790/api/chat', { method: 'POST', headers: { 'X-Visitor': v, 'content-type': 'application/json' }, body: '{"text":"hi"}' })
  const get = await fetch('http://127.0.0.1:8790/api/chat', { headers: { 'X-Visitor': v } })
  const feeds = await fetch('http://127.0.0.1:8790/api/feeds')
  const ok = post.status === 503 && get.status === 503 && feeds.ok
  console.log(`\nCHAT_DISABLED: POST=${post.status} GET=${get.status} feeds=${feeds.status} -> ${ok ? 'PASS' : 'FAIL'}`)
  codes.push(['chat-disabled', ok ? 0 : 1])
}

stop()
// accounts.local.json is throwaway; remove it so no secret lingers after the gate.
try {
  rmSync(resolve(here, 'accounts.local.json'))
} catch {}

const failed = codes.filter(([, c]) => c !== 0)
console.log(`\n=== security gate: ${codes.length - failed.length}/${codes.length} groups passed ===`)
for (const [name, c] of codes) console.log(`  ${c === 0 ? 'PASS' : 'FAIL'}  ${name}`)
process.exit(failed.length === 0 ? 0 : 1)

// Generates isolated test accounts (visitor-id secrets) for the security run.
// Secrets are random 32-hex (isVisitorId). Public uid = sha256(secret).slice(0,16).
// Writes tests/security/accounts.local.json (gitignored). Masks secrets in stdout.
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const secret = () => randomBytes(16).toString('hex')          // 32 hex
const uid = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const acct = (role) => { const s = secret(); return { role, secret: s, uid: uid(s) } }

// Per group, its own set. Group1 needs owner + A + B; group2 needs a banned user + normal; group3 needs A + B.
const accounts = {
  group1_impersonation: { owner: acct('owner'), A: acct('userA'), B: acct('userB') },
  group2_limits:        { normal: acct('normal'), banned: acct('banned') },
  group3_outside:       { A: acct('userA'), B: acct('userB') },
}
const ports = { group1_impersonation: 8787, group2_limits: 8788, group3_outside: 8789 }

writeFileSync(join(here, 'accounts.local.json'), JSON.stringify({ accounts, ports }, null, 2))

const mask = (s) => s.slice(0, 4) + '…' + s.slice(-2)
for (const [g, set] of Object.entries(accounts)) {
  console.log(`${g} (port ${ports[g]}):`)
  for (const [k, a] of Object.entries(set)) console.log(`  ${k}: secret=${mask(a.secret)} uid=${a.uid}`)
}

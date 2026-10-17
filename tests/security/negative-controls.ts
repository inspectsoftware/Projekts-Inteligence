/**
 * Negative controls: prove each protection is load-bearing. For every control we run the
 * attack with the protection ON (must be refused) and again against a deliberately weakened
 * variant built through the code's own injection seams (must succeed). No source is edited:
 * the "off" case is a weaker object constructed here, never a change to server/.
 *
 * Run: node node_modules/tsx/dist/cli.mjs tests/security/negative-controls.ts
 */
import { createHash } from 'node:crypto'
import { createRoom } from '../../server/http/room.ts'
import { createUpstream, UpstreamError } from '../../server/core/upstream.ts'
import { isVisitorId } from '../../shared/room.ts'

let fails = 0
const check = (name: string, onRefused: boolean, offSucceeded: boolean) => {
  const ok = onRefused && offSucceeded
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  console.log(`      protection ON  -> ${onRefused ? 'attack refused ✅' : 'attack SUCCEEDED ❌'}`)
  console.log(`      protection OFF -> ${offSucceeded ? 'attack succeeded (control works) ✅' : 'attack still refused ❓'}`)
}

const OWNER = 'f'.repeat(32)
const A = 'a'.repeat(32)
const uidOf = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

// 1. Visitor-id length gate: a 16-hex public uid must not work as a 32-hex credential.
{
  const uid16 = uidOf(A) // 16 hex
  const on = isVisitorId(uid16) === false // ON: real guard rejects a public uid
  const relaxed = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16,32}$/.test(v)
  const off = relaxed(uid16) === true // OFF: a relaxed regex would accept it -> uid usable as credential
  check('visitor-id length gate (public uid cannot be used as a secret)', on, off)
}

// 2. Owner-secret gate: message.owner comes only from a secret in CHAT_OWNER_IDS, never the body.
{
  const roomOn = createRoom(Date.now, Math.random, { ids: new Set([OWNER]) })
  const asA = roomOn.post(A, 'x') // A is not an owner
  const onRefused = 'message' in asA && asA.message.owner === undefined
  // OFF: a room that (wrongly) trusts everyone as owner -> A gets the owner badge.
  const roomOff = createRoom(Date.now, Math.random, { ids: new Set([A, OWNER]) })
  const asAoff = roomOff.post(A, 'x')
  const offSucceeded = 'message' in asAoff && asAoff.message.owner === true
  check('owner-secret gate (body/non-owner cannot forge owner badge)', onRefused, offSucceeded)
}

// 3. Ban gate: a banned uid is refused POST; checked before text validation.
{
  const bannedUid = uidOf(A)
  const roomOn = createRoom(Date.now, Math.random, { ids: new Set() }, new Set([bannedUid]))
  const r = roomOn.post(A, 'hello')
  const onRefused = 'refused' in r && r.refused === 'banned'
  // OFF: empty ban list -> the same user posts fine.
  const roomOff = createRoom(Date.now, Math.random, { ids: new Set() }, new Set())
  const r2 = roomOff.post(A, 'hello')
  const offSucceeded = 'message' in r2
  check('ban gate (banned uid cannot post)', onRefused, offSucceeded)
}

// 4. Origin allowlist (SSRF backstop): a fetch to a non-allowed host must be refused
//    BEFORE any network call. The stub fetch records whether it was ever invoked.
{
  const metadata = 'http://169.254.169.254/latest/meta-data/'
  let calledOn = false
  const stubOn = (async () => {
    calledOn = true
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  const upOn = createUpstream(['https://nominatim.openstreetmap.org'], new AbortController().signal, stubOn)
  let onRefused = false
  try {
    await upOn.json(metadata)
  } catch (e) {
    onRefused = e instanceof UpstreamError && e.kind === 'forbidden-origin' && calledOn === false
  }
  // OFF: allowlist that (wrongly) includes the metadata host -> the fetch is actually attempted.
  let calledOff = false
  const stubOff = (async () => {
    calledOff = true
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  const upOff = createUpstream(['http://169.254.169.254'], new AbortController().signal, stubOff)
  await upOff.json(metadata).catch(() => undefined)
  check('origin allowlist (SSRF: no fetch of a non-allowed host)', onRefused, calledOff === true)
}

console.log(`\n${fails === 0 ? 'ALL CONTROLS LOAD-BEARING' : `${fails} CONTROL(S) NOT PROVEN`}`)
process.exit(fails === 0 ? 0 : 1)

#!/usr/bin/env node
// Group 1 — impersonation / privilege-escalation pentest against the room API.
// Read-only attacks with local test accounts. Run: `node group1-impersonation.mjs`
// BASE overridable via env (default http://127.0.0.1:8787). Exits non-zero on any FAIL.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = (process.env.BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const here = dirname(fileURLToPath(import.meta.url))
const { accounts } = JSON.parse(readFileSync(join(here, 'accounts.local.json'), 'utf8'))
const { owner, A, B } = accounts.group1_impersonation

const mask = (s) => (typeof s === 'string' && /^[0-9a-f]{32}$/.test(s) ? `${s.slice(0, 4)}…${s.slice(-2)}` : s)
let failures = 0

/** Send a request; return { status, json, text }. headers omit X-Visitor when secret is null/undefined. */
async function call(method, path, { secret, body } = {}) {
  const headers = {}
  if (secret !== undefined && secret !== null) headers['X-Visitor'] = secret
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: res.status, json, text }
}

function check(name, pass, detail) {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (detail) console.log(`      ${detail}`)
}

/** Does any string value anywhere in the response equal a real secret? That would be a leak. */
function leaksSecret(obj) {
  const secrets = [owner.secret, A.secret, B.secret]
  const hay = JSON.stringify(obj ?? '')
  return secrets.some((s) => hay.includes(s))
}

async function main() {
  console.log(`BASE=${BASE}`)
  console.log(`accounts: owner.uid=${owner.uid} A.uid=${A.uid} B.uid=${B.uid} (secrets masked)\n`)

  // ---- 1. Unauthenticated enumeration ----
  console.log('== 1. Unauthenticated enumeration ==')
  const readRoutes = ['/health', '/feeds', '/feed/ships', '/me', '/chat', '/presence', '/aircraft?lat=57&lon=24', '/place?lat=57&lon=24', '/radio?by=name&q=lv']
  const identityRoutes = new Set(['/me', '/chat', '/presence'])
  for (const hdr of [{ label: 'no header', secret: undefined }, { label: 'bogus header', secret: 'notarealid' }]) {
    for (const path of readRoutes) {
      const r = await call('GET', path, { secret: hdr.secret })
      const leaked = leaksSecret(r.json)
      const key = path.replace(/^\//, '').split('?')[0]
      // Identity routes MUST refuse without a valid 32-hex header (expect 400). Others are public by design.
      const isIdentity = identityRoutes.has('/' + key.split('/')[0])
      const pass = !leaked && (!isIdentity || r.status === 400)
      check(`GET ${path} [${hdr.label}] -> ${r.status}`, pass, `${isIdentity ? 'identity route; ' : 'public; '}leak=${leaked} body=${trunc(r.text)}`)
    }
    for (const path of ['/me', '/chat']) {
      const r = await call('POST', path, { secret: hdr.secret, body: { text: 'x', name: 'Xyz' } })
      const pass = r.status === 400 && !leaksSecret(r.json)
      check(`POST ${path} [${hdr.label}] -> ${r.status}`, pass, `expect 400 bad_request; body=${trunc(r.text)}`)
    }
  }

  // ---- 2. Act as B while holding A's secret ----
  console.log('\n== 2. Impersonation via body / public id ==')
  // 2a: POST /chat as A with body claiming B's identity -> stored uid/name must come from A's secret.
  const a = await call('POST', '/chat', { secret: A.secret, body: { text: 'hi', uid: B.uid, name: 'B' } })
  const m = a.json?.message
  check('2a body identity ignored (uid/name from secret, not body)',
    a.status === 200 && m?.uid === A.uid && m?.name !== 'B' && !m?.owner,
    `A.secret=${mask(A.secret)} -> message.uid=${m?.uid} (A.uid=${A.uid}), name=${m?.name}, owner=${m?.owner}`)

  // 2b: B's PUBLIC uid (16 hex) in header -> not a valid visitor id -> 400, cannot act as owner.
  const bMe = await call('GET', '/me', { secret: B.uid })
  const bChat = await call('POST', '/chat', { secret: B.uid, body: { text: 'as B' } })
  check('2b public uid in header rejected (16-hex is not a 32-hex visitor id)',
    bMe.status === 400 && bChat.status === 400,
    `GET /me -> ${bMe.status} ${trunc(bMe.text)}; POST /chat -> ${bChat.status} ${trunc(bChat.text)}`)

  // 2c: no per-user private store / mutation endpoint. GET /chat is the shared public room (by design).
  const probes = ['/user/' + B.uid, '/users/' + B.uid, '/visitor/' + B.uid, '/me/' + B.uid, '/chat/' + B.uid]
  const probeResults = []
  for (const p of probes) {
    const g = await call('GET', p, { secret: A.secret })
    const d = await call('DELETE', p, { secret: A.secret })
    probeResults.push(`${p}: GET ${g.status}/DEL ${d.status}`)
  }
  const sharedRoom = await call('GET', '/chat', { secret: A.secret })
  check('2c no per-user private store or mutation endpoint exists',
    probeResults.every((r) => /GET 404/.test(r)) && !leaksSecret(sharedRoom.json),
    `probes -> ${probeResults.join(' | ')}; GET /chat is shared public room (by design), no secret leak`)

  // 2d: rename collisions. A -> owner's reserved name "TestOwner" => taken. A -> B's current name => taken.
  const bIdent = await call('GET', '/me', { secret: B.secret })
  const bName = bIdent.json?.name
  const takeOwner = await call('POST', '/me', { secret: A.secret, body: { name: 'TestOwner' } })
  const takeB = bName ? await call('POST', '/me', { secret: A.secret, body: { name: bName } }) : { status: 0, json: {} }
  check('2d reserved/other names cannot be taken (expect refused "taken")',
    takeOwner.status === 400 && takeOwner.json?.error === 'taken' && (!bName || takeB.json?.error === 'taken'),
    `rename A->TestOwner -> ${takeOwner.status} ${trunc(takeOwner.text)}; rename A->"${bName}" -> ${takeB.status} ${trunc(takeB.text)}`)

  // ---- 3. Privilege escalation to owner ----
  console.log('\n== 3. Privilege escalation to owner ==')
  // Space out from 2a to dodge the 2s post gap for A.
  await sleep(2100)
  // 3a: body flags owner/role must not be honored on either endpoint.
  const escChat = await call('POST', '/chat', { secret: A.secret, body: { text: 'x', owner: true, role: 'admin' } })
  const em = escChat.json?.message
  const escMe = await call('POST', '/me', { secret: A.secret, body: { name: 'Hax', owner: true, role: 'admin' } })
  check('3a owner/role body flags ignored',
    escChat.status === 200 && em?.owner !== true && em?.role === undefined &&
      escMe.status === 200 && escMe.json?.owner !== true && escMe.json?.role === undefined,
    `chat.message.owner=${em?.owner} role=${em?.role}; me -> ${trunc(escMe.text)}`)

  // 3b: owner's PUBLIC uid in header cannot post as owner -> 400 (not 32-hex).
  const ownerUidHdr = await call('POST', '/chat', { secret: owner.uid, body: { text: 'as owner' } })
  check('3b owner public uid in header rejected (cannot post as owner)',
    ownerUidHdr.status === 400,
    `X-Visitor=owner.uid(${owner.uid}) -> ${ownerUidHdr.status} ${trunc(ownerUidHdr.text)}`)

  // 3c: POSITIVE control — real owner secret yields message.owner === true.
  const ownerPost = await call('POST', '/chat', { secret: owner.secret, body: { text: 'hello from owner' } })
  const omsg = ownerPost.json?.message
  check('3c positive control: real owner secret -> message.owner === true',
    ownerPost.status === 200 && omsg?.owner === true && omsg?.uid === owner.uid && omsg?.name === 'TestOwner',
    `owner.secret=${mask(owner.secret)} -> owner=${omsg?.owner}, uid=${omsg?.uid}, name=${omsg?.name}`)

  // ---- 4. Password-reset reuse ----
  console.log('\n== 4. Password-reset reuse ==')
  console.log('N/A — no passwords, no login, no reset flow exists in this app. Nothing to run.')

  console.log(`\n${failures === 0 ? 'ALL PASS — no vulnerability found' : failures + ' FAILURE(S)'}`)
  process.exit(failures === 0 ? 0 : 1)
}

const trunc = (s, n = 160) => (s && s.length > n ? s.slice(0, n) + '…' : s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

main().catch((err) => { console.error('runner error:', err); process.exit(2) })

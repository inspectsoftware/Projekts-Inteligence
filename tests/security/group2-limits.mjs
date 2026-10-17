#!/usr/bin/env node
// Group 2 (limits) pentest harness — RECORD ONLY, attacks the user's own local server.
// Usage: BASE=http://127.0.0.1:8788 node tests/security/group2-limits.mjs
// Reads accounts.local.json, runs checks 5/7/8 from the brief, prints PASS/FAIL, exits non-zero on any FAIL/500.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const here = dirname(fileURLToPath(import.meta.url))
const accounts = JSON.parse(readFileSync(join(here, 'accounts.local.json'), 'utf8')).accounts.group2_limits
const NORMAL = accounts.normal.secret
const BANNED = accounts.banned.secret
const freshSecret = () => randomBytes(16).toString('hex') // throwaway 32-hex visitor id

let fails = 0
const rows = []
const mask = (s) => (typeof s === 'string' && s.length > 6 ? `${s.slice(0, 4)}…${s.slice(-2)}` : s)

async function call(path, { method = 'GET', visitor, xff, json, raw, headers = {} } = {}) {
  const h = { ...headers }
  if (visitor) h['X-Visitor'] = visitor
  if (xff) h['X-Forwarded-For'] = xff
  let body
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = typeof json === 'string' ? json : JSON.stringify(json) }
  if (raw !== undefined) { h['Content-Type'] = 'application/json'; body = raw }
  const res = await fetch(BASE + path, { method, headers: h, body })
  let text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed, retryAfter: res.headers.get('retry-after') }
}

// record(name, how, response, pass, note)
function record(name, how, r, pass, note = '') {
  const is500 = r && r.status === 500
  const verdict = is500 ? 'FAIL (500)' : pass ? 'PASS' : 'FAIL'
  if (is500 || !pass) fails++
  const resp = r ? `${r.status} ${JSON.stringify(r.body)}${r.retryAfter ? ` RA=${r.retryAfter}` : ''}` : note
  rows.push({ name, how, resp, verdict, note })
  console.log(`[${verdict}] ${name} :: ${resp}${note ? ` — ${note}` : ''}`)
}

async function main() {
  // ---- Check 5: banned bypass of disabled UI ----
  const bPost = await call('/api/chat', { method: 'POST', visitor: BANNED, json: { text: 'hello' } })
  record('5 banned POST /chat', `POST /api/chat X-Visitor=${mask(BANNED)} {"text":"hello"}`, bPost,
    bPost.status === 403 && bPost.body?.error === 'banned')
  const bGet = await call('/api/chat', { visitor: BANNED })
  record('5 banned GET /chat (read-only)', `GET /api/chat X-Visitor=${mask(BANNED)}`, bGet,
    bGet.status === 200 && Array.isArray(bGet.body?.messages))
  console.log('[N/A] 5 CHAT_DISABLED — set at boot; needs a CHAT_DISABLED instance to verify.')
  rows.push({ name: '5 CHAT_DISABLED', how: 'env set at boot', resp: 'needs a CHAT_DISABLED instance to verify', verdict: 'N/A', note: '' })

  // ---- Check 6: metered AI feature ----
  console.log('[N/A] 6 API-after-free — AI/model is background-only, never invoked by a user request; no user-facing metered feature to bypass.')
  rows.push({ name: '6 metered AI', how: '—', resp: 'N/A: model is background-only, no user-facing metered endpoint', verdict: 'N/A', note: '' })

  // ---- Check 7a: burst past POST /chat limit (25 concurrent, same XFF, as normal) ----
  // Fresh random /chat bucket so re-runs within the same 60s window are not pre-saturated.
  const burstXff = `203.0.113.${100 + Math.floor(Math.random() * 150)}`
  const burst = await Promise.all(Array.from({ length: 25 }, () =>
    call('/api/chat', { method: 'POST', visitor: NORMAL, xff: burstXff, json: { text: 'hello' } })))
  const c200 = burst.filter((r) => r.status === 200).length
  const tooFast = burst.filter((r) => r.status === 429 && r.body?.error === 'too_fast').length
  const rateLtd = burst.filter((r) => r.status === 429 && r.body?.error === 'rate_limited')
  const other = burst.filter((r) => r.status !== 200 && !(r.status === 429 && (r.body?.error === 'too_fast' || r.body?.error === 'rate_limited')))
  const sample = rateLtd[0]
  record('7a burst 25 POST /chat (same XFF)',
    `25 concurrent POST /api/chat X-Visitor=${mask(NORMAL)} XFF=${burstXff}`,
    sample || { status: 'n/a', body: 'no rate_limited sample' },
    c200 >= 1 && rateLtd.length >= 1 && other.length === 0,
    `200=${c200} too_fast=${tooFast} rate_limited=${rateLtd.length} other=${other.length}; sample rate_limited RA=${sample?.retryAfter}`)

  // ---- Check 7b: XFF bucket bypass — 25 GET /feeds each with a different XFF ----
  const spoof = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    call('/api/feeds', { xff: `203.0.113.${i + 1}` })))
  const feedOk = spoof.filter((r) => r.status === 200).length
  record('7b XFF bucket bypass (25 distinct XFF)',
    '25 GET /api/feeds, XFF=203.0.113.1..25 (one per request)',
    { status: feedOk === 25 ? 200 : 'mixed', body: `${feedOk}/25 ok` },
    feedOk === 25,
    'All succeed: clientAddress = first XFF addr (PROXY_HOPS unset), so each spoofed addr is its own bucket. Caller CAN multiply allowance — documented design (self-affecting; locks nobody else out).')

  // ---- Check 8: malformed inputs ----
  // Fresh secret + fresh XFF per POST case so POST_GAP(too_fast) and 20/min never mask input handling.
  const chatCases = [
    ['text 5000 A (>bodyLimit)', { text: 'A'.repeat(5000) }, (r) => r.status === 413],
    ['text ""', { text: '' }, (r) => r.status === 400 && r.body?.error === 'empty'],
    ['text "   "', { text: '   ' }, (r) => r.status === 400 && r.body?.error === 'empty'],
    ['text control chars', { text: '\u0001\u0002' }, (r) => r.status === 400 && r.body?.error === 'empty'],
    ['text RTL \\u202Eabc', { text: '‮abc' }, (r) => r.status === 200 && r.body?.message?.text === 'abc'],
    ['text exactly 280 A', { text: 'A'.repeat(280) }, (r) => r.status === 200],
    ['text 281 A', { text: 'A'.repeat(281) }, (r) => r.status === 400 && r.body?.error === 'too_long'],
    ['text = number 5', { text: 5 }, (r) => r.status === 400 && r.body?.error === 'bad_request'],
    ['body not JSON', 'garbage', (r) => r.status === 400 && r.body?.error === 'bad_request'],
    ['missing text', {}, (r) => r.status === 400 && r.body?.error === 'bad_request'],
  ]
  let xi = 0
  for (const [label, payload, ok] of chatCases) {
    const opt = { method: 'POST', visitor: freshSecret(), xff: `198.51.100.${++xi}` }
    if (typeof payload === 'string') opt.raw = payload
    else opt.json = payload
    const r = await call('/api/chat', opt)
    record(`8 chat: ${label}`, `POST /api/chat`, r, ok(r))
  }

  const meCases = [
    ['name ""', { name: '' }, (r) => r.status === 400 && r.body?.error === 'bad_name'],
    ['name "ab" (short)', { name: 'ab' }, (r) => r.status === 400 && r.body?.error === 'bad_name'],
    ['name 21 chars', { name: 'a'.repeat(21) }, (r) => r.status === 400 && r.body?.error === 'bad_name'],
    ['name "a b" (space)', { name: 'a b' }, (r) => r.status === 400 && r.body?.error === 'bad_name'],
    ['name "<script>"', { name: '<script>' }, (r) => r.status === 400 && r.body?.error === 'bad_name'],
    ['name 10000 chars', { name: 'a'.repeat(10000) }, (r) => r.status === 413],
    ['name = number 42', { name: 42 }, (r) => r.status === 400 && r.body?.error === 'bad_request'],
  ]
  for (const [label, payload, ok] of meCases) {
    const r = await call('/api/me', { method: 'POST', visitor: freshSecret(), xff: `198.51.100.${++xi}`, json: payload })
    record(`8 me: ${label}`, `POST /api/me`, r, ok(r))
  }

  const getCases = [
    ['place lat=-999&lon=abc', '/api/place?lat=-999&lon=abc', (r) => r.status === 400],
    ['place q= (empty)', '/api/place?q=', (r) => r.status === 400],
    ['place q=a (1 char)', '/api/place?q=a', (r) => r.status === 400],
    ['place q=3000 chars', `/api/place?q=${'a'.repeat(3000)}`, (r) => r.status !== 500],
    ['aircraft lat=999&lon=0', '/api/aircraft?lat=999&lon=0', (r) => r.status === 400],
    ['aircraft (missing)', '/api/aircraft', (r) => r.status === 400],
    ['radio by=name&q=a', '/api/radio?by=name&q=a', (r) => r.status === 400],
    ['radio by=bogus&q=test', '/api/radio?by=bogus&q=test', (r) => r.status === 400],
    ['radio by=name&q=70 chars', `/api/radio?by=name&q=${'a'.repeat(70)}`, (r) => r.status === 400],
  ]
  for (const [label, path, ok] of getCases) {
    const r = await call(path)
    record(`8 ${label}`, `GET ${path.length > 60 ? path.slice(0, 57) + '...' : path}`, r, ok(r))
  }

  // ---- Check 9: open redirect ----
  console.log('[N/A] 9 ?next= open redirect — no redirect feature exists in this API.')
  rows.push({ name: '9 ?next= open redirect', how: '—', resp: 'N/A: no redirect feature exists', verdict: 'N/A', note: '' })

  // ---- Summary table ----
  console.log('\n| Attack | How | Response | Verdict |')
  console.log('|---|---|---|---|')
  for (const r of rows) {
    const resp = r.note && r.resp && !r.resp.includes(r.note) ? `${r.resp} — ${r.note}` : r.resp
    console.log(`| ${r.name} | ${r.how} | ${String(resp).replace(/\|/g, '\\|')} | ${r.verdict} |`)
  }
  console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAIL/500`}`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => { console.error('harness error:', e); process.exit(2) })

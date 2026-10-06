import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'

let clientDir: string

beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'pwh-client-'))
  mkdirSync(join(clientDir, 'assets'))
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(clientDir, 'assets', 'app-abc123.js'), 'console.log(1)')
})

afterAll(() => {
  rmSync(clientDir, { recursive: true, force: true })
})

describe('api', () => {
  it('reports health without caching', async () => {
    const res = await createApp({ clientDir: null }).request('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ ok: true, commit: expect.any(String) })
  })

  it('answers unknown api routes with a json 404, not the app shell', async () => {
    const res = await createApp({ clientDir }).request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('sets security headers on api, file, shell and 404 responses', async () => {
    const app = createApp({ clientDir })
    for (const path of ['/api/health', '/assets/app-abc123.js', '/some/route', '/assets/gone.js']) {
      const res = await app.request(path)
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'")
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
    }
  })
})

describe('client files', () => {
  it('serves the app shell uncached', async () => {
    const res = await createApp({ clientDir }).request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toContain('id="root"')
  })

  it('serves hashed assets as immutable', async () => {
    const res = await createApp({ clientDir }).request('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('falls back to the app shell for navigations', async () => {
    const res = await createApp({ clientDir }).request('/some/deep/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
  })

  it('returns a real 404 for a missing file instead of the app shell', async () => {
    const res = await createApp({ clientDir }).request('/assets/gone-000000.js')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('id="root"')
  })

  it('explains itself when the client has not been built', async () => {
    const res = await createApp({ clientDir: null }).request('/')
    expect(res.status).toBe(503)
  })
})

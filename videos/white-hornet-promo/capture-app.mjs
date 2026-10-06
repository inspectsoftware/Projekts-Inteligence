// Captures 1920x1080 plates of the running White Hornet dev app (npm run dev, port 5173)
// into capture/screenshots/. Usage: node capture-app.mjs [shot-name ...]
// PUPPETEER_CORE = path to a puppeteer-core install (hyperframes ships one in the npx cache).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.APP ?? 'http://localhost:5173'
const OUT = path.join(here, 'capture', 'screenshots')
mkdirSync(OUT, { recursive: true })

const ALL_WINDOWS = ['layers', 'display', 'views', 'situation', 'alerts', 'radar', 'tv', 'cctv', 'intel', 'countries', 'military']
const OLD_TOWN = '56.9475/24.1064' // Rātslaukums, Rīga: also an official camera site
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Hides every piece of chrome so only the map is left. */
const clean = (page) =>
  page.addStyleTag({ content: '#root > * > *:not(:has(.maplibregl-map)):not(.maplibregl-map){visibility:hidden!important}' })

const selectNearest = (lat, lon) => async (page) => {
  const id = await page.evaluate(
    async (lat, lon) => {
      const feed = await (await fetch('/api/feed/aircraft')).json()
      const airborne = feed.payload.entities.filter((e) => !(e.flags & 8) && e.label)
      airborne.sort((a, b) => Math.hypot(a.lat - lat, (a.lon - lon) * 0.55) - Math.hypot(b.lat - lat, (b.lon - lon) * 0.55))
      const pick = airborne[0]
      if (pick) window.__pwh.selection.getState().select(pick.id)
      return pick ? `${pick.id} ${pick.label} ${pick.lat},${pick.lon}` : null
    },
    lat,
    lon,
  )
  console.log('   selected', id)
  await sleep(1500)
  // The Inspector's own Centre button puts the aircraft mid-frame.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'centre')?.click())
  await sleep(4000)
}

const map = (name, hash, base, extra = {}) => ({ name, hash, base, open: [], clean: true, ...extra })

const SHOTS = [
  // Zoom stack on one centre, chrome hidden.
  map('stack-1-dark-z5', `5.2/${OLD_TOWN}`, 'dark'),
  map('stack-2-dark-z8', `8/${OLD_TOWN}`, 'dark'),
  map('stack-3-sat-z11', `11/${OLD_TOWN}`, 'sat'),
  map('stack-4-sat-z14', `14/${OLD_TOWN}`, 'sat'),
  map('stack-5-ortho-z16', `14.3/${OLD_TOWN}`, 'sat', { zoomIn: 2, wait: 16000 }),
  map('stack-6-ortho-z18', `14/${OLD_TOWN}`, 'sat', { zoomIn: 4 }),
  // Map plates.
  map('map-baltic-dark', '6.3/57.0/23.6', 'dark'),
  map('map-plane-selected', '7.6/56.95/24.1', 'dark', { clean: false, after: selectNearest(56.95, 24.1), wait: 14000 }),
  map('map-satellites', '3.6/57.0/23.0', 'dark', { layers: { satellites: true, aircraft: false } }),
  map('map-gps-hex', '5.6/57.3/22.5', 'dark', { layers: { 'gps-hex': true } }),
  map('map-ships', '8.6/57.78/21.95', 'dark'),
  map('map-radar', '6.3/57.0/23.6', 'dark', { layers: { radar: true }, open: ['radar'], clean: false }),
  map('map-night', '5.6/57.3/22.5', 'night'),
  map('map-riga-3d', '11.4/56.949/24.105/-18/48', 'dark'),
  // Vision modes.
  map('vision-nvg', '11.4/56.949/24.105/-18/48', 'dark', { vision: 'nvg' }),
  map('vision-flir', '11.4/56.949/24.105/-18/48', 'sat', { vision: 'flir' }),
  map('vision-crt', '6.3/57.0/23.6', 'dark', { vision: 'crt' }),
  // Windows.
  { name: 'ui-desktop', hash: '6.6/56.9/24.6', base: 'dark', open: ['layers', 'display', 'situation', 'alerts', 'intel'], wait: 16000 },
  { name: 'ui-bare', hash: '6.6/56.9/24.6', base: 'dark', open: [], wait: 14000 },
  { name: 'ui-tv', hash: '6.6/56.9/24.6', base: 'dark', open: ['tv'], sizes: { tv: { w: 1100, h: 640 } }, wait: 9000 },
  { name: 'ui-cctv', hash: '6.6/56.9/24.6', base: 'dark', open: ['cctv'], sizes: { cctv: { w: 1200, h: 760 } }, wait: 16000 },
  {
    name: 'ui-cctv-view',
    hash: '6.6/56.9/24.6',
    base: 'dark',
    open: ['cctv'],
    sizes: { cctv: { w: 1200, h: 760 } },
    wait: 14000,
    // Opens the first tile (Rātslaukums, the official town-hall-square camera).
    after: async (page) => {
      await page.mouse.click(437, 345)
      await sleep(7000)
    },
  },
  { name: 'ui-military', hash: '6.6/56.9/24.6', base: 'dark', open: ['military', 'countries'], wait: 12000 },
  {
    name: 'ui-palette',
    hash: '6.6/56.9/24.6',
    base: 'dark',
    open: ['layers', 'situation', 'intel'],
    after: async (page) => {
      await page.keyboard.down('Control')
      await page.keyboard.press('k')
      await page.keyboard.up('Control')
      await sleep(400)
      await page.keyboard.type('riga', { delay: 60 })
      await sleep(900)
    },
  },
]

const only = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1920,1080', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
})

for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.name)) continue
  console.log('>', shot.name)
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('   console:', m.text().slice(0, 160)))
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log('   nav', f.url().slice(0, 80)))
  const windows = Object.fromEntries(ALL_WINDOWS.map((id) => [id, { open: id === 'display' || shot.open.includes(id), ...(shot.sizes?.[id] ? { size: shot.sizes[id] } : {}) }]))
  await page.evaluateOnNewDocument(
    (ui, windows, layers, order) => {
      localStorage.setItem('pwh-ui', JSON.stringify({ state: ui, version: 1 }))
      localStorage.setItem('pwh-windows', JSON.stringify({ state: { windows, order }, version: 1 }))
      localStorage.setItem('pwh-layers', JSON.stringify({ state: { visible: layers }, version: 1 }))
    },
    { vision: 'normal', base: 'dark' },
    windows,
    shot.layers ?? {},
    shot.open,
  )
  try {
    await page.goto(`${APP}/#map=${shot.hash}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 60000 })
    await sleep(1500)
    for (const label of [shot.base, shot.vision]) {
      if (!label || label === 'dark') continue
      await page.evaluate((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === label)?.click(), label)
      await sleep(600)
    }
    if (!shot.open.includes('display')) await page.evaluate(() => window.__pwh.windows.getState().close('display'))
    // The dark base caps the opening zoom, so deeper plates step in with the map's own + button.
    for (let i = 0; i < (shot.zoomIn ?? 0); i++) {
      await page.mouse.click(1890, 69)
      await sleep(1200)
    }
    if (shot.clean) await clean(page)
    await sleep(shot.wait ?? 11000)
    if (shot.after) await shot.after(page)
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) })
  } catch (error) {
    console.log('   FAILED', error.message)
  }
  await context.close()
}
await browser.close()

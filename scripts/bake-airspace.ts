// Manual, one-off: builds shared/data/lvAirspace.ts, the outlines of Latvia's restricted, danger
// and reserved airspace, from the electronic AIP published by Latvijas gaisa satiksme (ENR 5.1
// and ENR 5.2). NOTAMs only name these areas; this is where their shapes come from.
// Never runs as part of `npm run build`; the result is committed. Run it again when a new AIP
// cycle takes effect (the script reads whichever issue the AIS site lists as current).
//
//   npx tsx scripts/bake-airspace.ts            # uses cached pages when present
//   npx tsx scripts/bake-airspace.ts --refresh  # fetches them again
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAipAreas } from '../shared/adapters/eaip'
import { type Ring, tidyRing } from '../shared/adapters/zones'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/airspace')
const refresh = process.argv.includes('--refresh')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const AIS = 'https://ais.lgs.lv'

mkdirSync(cacheDir, { recursive: true })

async function page(name: string, url: () => Promise<string> | string): Promise<string> {
  const file = join(cacheDir, name)
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8')
  const res = await fetch(await url(), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const text = await res.text()
  writeFileSync(file, text)
  return text
}

// The AIS front page lists the issue in force first, under "CURRENT ISSUE", then the ones to come.
const index = await page('index.html', () => `${AIS}/aiseaip`)
const issue = /CURRENT ISSUE[\s\S]*?href="(eAIPfiles\/[^"]+?)\/html\/index\.html/.exec(index)?.[1]
if (!issue) throw new Error('The AIS page no longer names a current issue')
console.log('issue', issue)

const border = (JSON.parse(readFileSync(join(root, 'public/data/lv-border.json'), 'utf8')).features[0].geometry.coordinates as Ring[])[0]

const areas = []
for (const section of ['5.1', '5.2']) {
  const html = await page(`ENR-${section}.html`, () => `${AIS}/${issue}/html/eAIP/EV-ENR-${section}-en-GB.html`)
  areas.push(...parseAipAreas(html, border))
}
if (areas.length < 100) throw new Error(`Only ${areas.length} areas: the AIP pages no longer look the way they did`)

const rows = areas
  .flatMap((area) => {
    const ring = area.ring && tidyRing(area.ring)
    return ring ? [`  ${area.id}: { name: ${JSON.stringify(area.name)}, ring: ${JSON.stringify(ring)} },`] : []
  })
  .sort()
writeFileSync(
  join(root, 'shared/data/lvAirspace.ts'),
  `// Baked by scripts/bake-airspace.ts on ${new Date().toISOString().slice(0, 10)} from the eAIP of Latvia, ENR 5.1 and 5.2
// (${issue.split('/')[1]}), published by SJSC Latvijas gaisa satiksme at ais.lgs.lv.
// Do not edit by hand.
import type { AreaTable } from '../adapters/airspace'

/**
 * Outlines of Latvia's restricted, danger and reserved airspace, by designator, as [lon, lat].
 * Simplified to about 200 m; stretches along the state border follow this project's own baked
 * border. For display only, never for flight planning.
 */
export const LV_AIRSPACE: AreaTable = {
${rows.join('\n')}
}
`,
)

const missing = areas.filter((area) => !area.ring).map((area) => area.id)
console.log(`lvAirspace.ts: ${rows.length} outlines of ${areas.length} areas`)
console.log(`no outline (limits follow the territorial sea, or could not be read): ${missing.join(' ')}`)

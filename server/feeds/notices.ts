import type { NewsEntry } from '../../shared/adapters/news'
import type { Notice, WeatherWarning } from '../../shared/feeds'
import { newsEntries, newsFeed, readSources } from './news'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
/** A public appeal is taken down when its publisher takes it down, and here after two weeks whatever happens. */
const KEEP_MS = 14 * 24 * HOUR

/** A search for a missing person, in English, Latvian, Lithuanian and Estonian. */
const MISSING =
  /\bmissing (?:person|people|child|children|girl|boy|man|woman|teen|teenager|pensioner)|\bwent missing|bezvēsts|bezvēsti|pazudu(?:šo|šu|ša|šais|si)\b|meklē pazudu|dingus(?:io|į|ią|ios)?\b.*(?:ieško|paiešk)|ieško dingus|be žinios ding|kadunud (?:inimes|last|lapse|mees|nais|tüdruk|pois)|otsib kadunud|otsitakse kadunud/iu

/** A warning to the public: evacuation, sirens, a declared emergency, an order to shelter. */
const EMERGENCY =
  /evacuat|evakuā|evakuo|evakueeri|state of emergency|ārkārt(?:as|ējā) situācij|ekstremali(?:oji)? situacij|eriolukor|air[- ]raid|gaisa trauksm|oro pavoj|õhuhäire|sirēn|\bsirens?\b|sireen|civilās aizsardzības|civilinės saugos|kriisiolukor|šūnu apraid|cell broadcast|shelter in place|patvertn|slėptuv|varjend|drinking water (?:ban|warning)|boil[- ]water|chemical leak|noplūd|radiation alert/iu

/** What has been seen, by link: the newsrooms let go of a story within hours, the log keeps it. */
const log = new Map<string, Notice>()

/** The public notices among these stories. Nothing but the headline, who published it, when, and the link. */
export function pickNotices(entries: readonly NewsEntry[]): Notice[] {
  return entries.flatMap(({ item, source }): Notice[] => {
    // The alert is the headline; a story that only mentions one in passing is not an alert. A
    // newsroom covering the wider region writes about other people's sirens, so only the Baltic ones count.
    const kind = MISSING.test(item.title) ? 'missing' : source.country !== 'INT' && EMERGENCY.test(item.title) ? 'emergency' : null
    if (!kind) return []
    return [{ id: item.link, kind, title: item.title, issuer: source.publisher, official: source.kind === 'official', at: item.at, link: item.link, lang: source.lang }]
  })
}

function weatherNotices(warnings: readonly WeatherWarning[]): Notice[] {
  return warnings
    .filter((warning) => warning.level !== 'yellow')
    .map((warning) => ({
      id: `weather:${warning.id}`,
      kind: 'emergency' as const,
      title: `${warning.type}: ${warning.areas.slice(0, 4).join(', ')}`,
      issuer: 'LVĢMC',
      official: true,
      at: warning.sent,
      link: 'https://videscentrs.lvgmc.lv',
      lang: 'en' as const,
    }))
}

/**
 * A log of warnings to the public and of appeals to find missing people, each with who sent it.
 * The Baltic states publish no machine-readable alert feed, so this reads the newsrooms and
 * official bodies already followed, and the weather service's orange and red warnings.
 * ponytail: a keyword net over headlines, and the log lives in memory: a restart keeps only what
 * the disk copy and the newsrooms still hold. Read the alert systems themselves once they publish.
 */
export const noticesFeed: FeedDef = {
  id: 'notices',
  title: 'Public alerts',
  // The newsrooms' hosts: after a restart this feed may have to read them itself, once.
  origins: newsFeed.origins,
  ttlMs: 5 * MINUTE,
  staleMs: 12 * HOUR,
  timeoutMs: 30_000,
  persist: true,
  attribution: [...newsFeed.attribution, { label: 'MeteoAlarm / LVĢMC', href: 'https://meteoalarm.org' }],
  async load({ http, now, feed }) {
    await feed('news').catch(() => undefined)
    if (newsEntries(now).length === 0) await readSources(http, now).catch(() => undefined)
    const weather = await feed('warnings').then(
      (body) => (body.payload.shape === 'warnings' ? weatherNotices(body.payload.warnings) : []),
      () => [],
    )
    for (const notice of [...pickNotices(newsEntries(now)), ...weather]) log.set(notice.id, notice)
    for (const [id, notice] of log) if (now - notice.at > KEEP_MS) log.delete(id)
    return { shape: 'notices', items: [...log.values()].sort((a, b) => b.at - a.at) }
  },
}

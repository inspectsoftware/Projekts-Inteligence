import { describe, expect, it, vi } from 'vitest'
import { type Cluster, type NewsSource, type RawNews, parseFeed, rank, score } from '../../shared/adapters/news'
import { newsRule } from '../../shared/alerts/rules'
import { regionLevel } from '../../shared/escalation'
import type { NewsItem } from '../../shared/feeds'
import { translate } from '../../shared/i18n'
import type { StoredSnapshot } from '../../server/core/disk'
import { pickPolitics } from '../../server/feeds/politics'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const HOUR = 3600 * 1000
const MINUTE = 60 * 1000

const source = (patch: Partial<NewsSource> = {}): NewsSource => ({
  id: 't',
  url: 'https://t.example/rss',
  publisher: 'T',
  group: 't',
  lang: 'en',
  country: 'LV',
  kind: 'media',
  weight: 0.9,
  ai: 'summary',
  ...patch,
})

const story = (title: string, patch: Partial<RawNews> = {}): RawNews => ({
  title,
  link: `https://t.example/${encodeURIComponent(title)}`,
  at: NOW,
  desc: '',
  foreign: false,
  ...patch,
})

describe('parseFeed', () => {
  const LSM = { url: 'https://eng.lsm.lv/rss/' }
  const item = (inner: string) => `<rss><channel><title>Feed</title><link>https://eng.lsm.lv/</link><item>${inner}</item></channel></rss>`

  it('keeps plain-text headlines that link back to the publisher', () => {
    const rss = `<rss><channel><title>LSM</title>
      <item><title>Fuel prices &amp; taxes: up nearly 10%&nbsp;in a month</title><link>https://eng.lsm.lv/article/a1/?utm_source=rss&amp;utm_medium=links</link><pubDate>Tue, 06 Oct 2026 10:19:25 GMT</pubDate></item>
      <item rdf:about="x"><title><![CDATA[<b>Older</b> story]]></title><link>https://eng.lsm.lv/article/a0/</link><pubDate>Tue, 06 Oct 2026 09:00:00 GMT</pubDate></item>
      <item><title>Elsewhere</title><link>https://example.org/x</link><pubDate>Tue, 06 Oct 2026 10:30:00 GMT</pubDate></item>
      <item><title>No date</title><link>https://eng.lsm.lv/article/a2/</link></item>
    </channel></rss>`
    expect(parseFeed(rss, LSM)).toEqual([
      { title: 'Fuel prices & taxes: up nearly 10% in a month', link: 'https://eng.lsm.lv/article/a1/', at: Date.parse('2026-10-06T10:19:25Z'), desc: '', foreign: false },
      { title: 'Older story', link: 'https://eng.lsm.lv/article/a0/', at: Date.parse('2026-10-06T09:00:00Z'), desc: '', foreign: false },
    ])
  })

  it('accepts the sites a feed says its stories live on, with their own parts, and no other', () => {
    const one = (link: string) => `<item><title>Uudis</title><link>${link}</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate></item>`
    const links = [
      'https://www.err.ee/1',
      'https://novaator.err.ee/2',
      'https://err.ee.example.org/3',
      'https://xerr.ee/4',
      'http://www.err.ee/5',
      'https://www.err.ee@example.org/6',
      'javascript:alert(1)//www.err.ee/',
    ]
    const rss = `<rss><channel>${links.map(one).join('')}</channel></rss>`
    const read = (source: Parameters<typeof parseFeed>[1]) => parseFeed(rss, source).map((news) => news.link)
    expect(read({ url: 'https://www.err.ee/rss', links: ['https://err.ee/'] })).toEqual(['https://www.err.ee/1', 'https://novaator.err.ee/2'])
    expect(read({ url: 'https://www.err.ee/rss' })).toEqual(['https://www.err.ee/1'])
    // Delfi's feed host is not where its stories are.
    expect(read({ url: 'https://feed.delfi.lt/v2', links: ['https://www.delfi.lt/'] })).toEqual([])
  })

  it('falls back to a10:updated and dc:date when there is no pubDate', () => {
    const council = item('<title>Council conclusions</title><link>https://eng.lsm.lv/c</link><a10:updated>2026-10-06T12:00:00Z</a10:updated>')
    const dublin = item('<title>Dated the other way</title><link>https://eng.lsm.lv/d</link><dc:date>2026-10-06T11:00:00+00:00</dc:date>')
    expect(parseFeed(council, LSM)[0].at).toBe(NOW)
    expect(parseFeed(dublin, LSM)[0].at).toBe(NOW - HOUR)
  })

  it('reads named entities and strips markup that arrives escaped', () => {
    const rss = item(
      '<title>&Scaron;iauli&#371; &bdquo;pasienis&ldquo; &ndash; u&#x17E;darytas &constructor; &#99999999;</title><link>https://eng.lsm.lv/e</link>' +
        '<pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate><description>First line&lt;br&gt;second &lt;a href="https://x.example"&gt;line&lt;/a&gt; &amp; 2 &lt; 3</description>',
    )
    expect(parseFeed(rss, LSM)[0]).toMatchObject({ title: 'Šiaulių „pasienis“ – uždarytas &constructor;', desc: 'First line second line & 2 < 3' })
    // The Lithuanian ministries and LSM escape theirs twice.
    const twice = item(
      '<title>Prane&amp;scaron;imas</title><link>https://eng.lsm.lv/g</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>' +
        '<description>numu&amp;scaron;ė&amp;nbsp;droną &amp;lt;b&amp;gt;i&amp;scaron;&amp;lt;/b&amp;gt; Baltarusijos</description>',
    )
    expect(parseFeed(twice, LSM)[0]).toMatchObject({ title: 'Pranešimas', desc: 'numušė droną iš Baltarusijos' })
  })

  it('reads a broken megabyte as quickly as a sound one', () => {
    const size = 1024 * 1024
    const fill = (piece: string) => piece.repeat(size / piece.length)
    const dated = '<link>https://eng.lsm.lv/h</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>'
    const broken = [
      `<rss>${fill('<item>')}`,
      `<rss><item>${fill('<title>')}</item></rss>`,
      `<rss><item>${fill('<content:encoded>')}</item></rss>`,
      `<rss><item><title>${fill('<a ')}</title>${dated}</item></rss>`,
      `<rss><item><title>${fill('<![CDATA[')}</title>${dated}</item></rss>`,
    ]
    const started = performance.now()
    for (const xml of broken) parseFeed(xml, LSM)
    // Milliseconds. With lazy patterns doing the searching, the first of these alone took twenty seconds.
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('never reads the full article, and trims the description', () => {
    const rss = item(
      `<title>Routine</title><link>https://eng.lsm.lv/f</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>` +
        `<content:encoded><![CDATA[<p>Whole article about sabotage</p><description>hidden</description>]]></content:encoded><description>${'word '.repeat(200)}</description>`,
    )
    const [news] = parseFeed(rss, LSM)
    expect(news.desc).not.toMatch(/sabotage|hidden/)
    expect(news.desc).toHaveLength(400)
  })

  it('notices world news by its section, in the link or among the categories', () => {
    const lv = (link: string, category: string) =>
      parseFeed(item(`<title>Ziņa</title><link>${link}</link><category>${category}</category><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>`), LSM)[0].foreign
    expect(lv('https://eng.lsm.lv/raksts/zinas/arzemes/a1/', 'Ziņas')).toBe(true)
    expect(lv('https://eng.lsm.lv/a2/', 'Välismaa')).toBe(true)
    expect(lv('https://eng.lsm.lv/raksts/zinas/latvija/a3/', 'Latvijā')).toBe(false)
  })
})

describe('score', () => {
  const native = { native: true, lang: 'lv' } as const
  const lt = { native: true, lang: 'lt', country: 'LT' } as const
  const et = { native: true, lang: 'et', country: 'EE' } as const
  const official = { kind: 'official', weight: 1 } as const
  const confirmed: Cluster = { groups: 3, official: false }

  // The research prototype's own table, plus a line or two per level in the languages it lacked.
  const HEADLINES: [title: string, level: number, source?: Partial<NewsSource>, cluster?: Cluster][] = [
    ['Fuel prices up nearly 10% in a month', 0],
    ['Izbeigts «Amber Latvijas balzams» tiesiskās aizsardzības process', 0, native],
    ['Valdība izsludina ārkārtējo situāciju lauksaimniecībā plūdu dēļ', 0, native],
    ['New film about the invasion of Latvia premieres', 0],
    ['NBS karavīri piedalās mācībās Ādažos', 1, native],
    ['Spiegu kaķu misija – kas nogāja greizi?', 1, native],
    ['Russian missile strike on Kyiv kills five', 1],
    ['Drones strike merchant vessels in Black Sea off Bulgaria', 1],
    ['Riga marks anniversary of the 1940 Soviet occupation and invasion of Latvia', 1],
    ['Lietuvos kariuomenė pradeda pratybas Rūdninkuose', 1, { ...native, lang: 'lt', country: 'LT' }],
    ['Kaitsevägi alustas õppust Kevadtorm', 1, { ...native, lang: 'et', country: 'EE' }],
    ['What if Russia invaded the Baltics? A scenario', 2],
    ['Kremlin warns Lithuania lifting nuclear arms ban risks escalation', 2],
    ['Igaunija pārvieto karaspēku tuvāk Krievijas robežai', 2, native],
    ['Estonia moves troops closer to Russian border', 2],
    ['Vācijā par spiegošanu aizturēts bijušais izlūkdienesta vadītājs', 2, native],
    ['Хакеры атаковали сайты правительства Литвы', 2],
    ['Russian drone violated Latvian airspace, armed forces say', 3],
    ['Krievijas drons ielidoja Latvijas gaisa telpā', 3, native],
    ['Į Lietuvos oro erdvę įskrido dronas iš Baltarusijos', 3, { ...native, lang: 'lt', country: 'LT' }],
    ['Vene lennuk rikkus Eesti õhuruumi', 3, { ...native, lang: 'et', country: 'EE' }],
    ['Российский беспилотник упал в Латвии', 3],
    ['Latvija slēdz robežu ar Baltkrieviju', 3, native],
    ['Latvia closes border with Belarus', 3],
    ['Undersea cable between Estonia and Finland damaged', 3],
    ['Läänemeres sai kahjustada merekaabel Estlink 2', 3, { ...native, lang: 'et', country: 'EE' }],
    ['Russia masses troops near the Latvian border, intelligence says', 3],
    // One newsroom alone is held at 3; a second one, or an official body, lets it through.
    ['Latvia declares mobilisation after border attack', 3],
    ['Latvia declares mobilisation after border attack', 4, {}, confirmed],
    ['Latvija izsludina ārkārtējo situāciju pierobežā pēc hibrīduzbrukuma', 3, native],
    ['Latvija izsludina ārkārtējo situāciju pierobežā pēc hibrīduzbrukuma', 4, { ...native, ...official }],
    ['Lietuva aktyvuoja NATO 4 straipsnio konsultacijas', 4, { ...native, ...official, lang: 'lt', country: 'LT' }],
    ['Eestis kuulutati välja mobilisatsioon', 4, { ...native, ...official, lang: 'et', country: 'EE' }],
    ['NATO invokes Article 5 after armed attack on Estonia', 5, {}, { groups: 3, official: true }],
    ['Latvijā izsludināts kara stāvoklis', 5, { ...native, ...official }],
    ['В Литве объявлена всеобщая мобилизация', 5, {}, confirmed],

    // Where the headline says it happened counts, whatever else it names.
    ['Latvia condemns Russian missile strike on Kyiv', 1],
    ['Latvia condemns Russian missile strike on Kyiv', 1, official],
    ['Kyiv hit by missile strike, Latvia condemns', 1],
    ['Estonia summons Russian envoy after drone attack on Kyiv', 1],
    ['Russian missile attack on Ukraine: Latvian volunteer killed', 1],
    ["Latvia to send more aid as Russia's invasion of Ukraine enters fifth year", 0],
    ["Baltic and Nordic foreign ministers issue joint statement on Russia's invasion of Ukraine", 0, official],
    ['Ukrainian drone crashes in Latvia', 3],
    ['Latvian airspace violated during Russian attack on Ukraine', 3],
    ['Russian drone violates Latvian airspace during attack on Ukraine', 3],

    // Everyday wording that is not an event: plans and laws, metaphors, sport, weather, a single border crossing.
    ['Government approves new mobilisation plan', 1, { ...official, country: 'EE' }],
    ['VRM pristatė atnaujintą mobilizacijos planą', 1, { ...lt, ...official }],
    ['Saeima pieņem jauno Mobilizācijas likumu', 1, native],
    ['Kremlin says invasion of Baltics is not planned', 2],
    ['Invasion of Spanish slugs spreads across Latvian gardens', 0],
    ['Fans invaded the pitch in Tallinn after Estonia win', 0],
    ['Latvia marks 86 years since the Soviet invasion of 1940', 0],
    ['Latvia remembers victims of the 1940 Soviet invasion of the Baltic states', 1],
    ['Theatre premiere: "Invasion of Latvia" imagines 2030', 0],
    ['Lauksaimnieki draud ar ceļu blokādi Rīgā', 0, native],
    ['Latvian drone maker entered US market', 1],
    ['Lithuania has entered the drone coalition led by Latvia', 1],
    ['Latvian-made drones shot down Russian Shaheds in Ukraine', 1],
    ['Latvian drone makers hit by export ban', 1],
    ['Porziņģis explodes for 30 points as Latvia beat Estonia', 0],
    ['Lithuania blast Latvia in EuroBasket warm-up', 0],
    ['Arctic blast to hit Latvia this weekend', 0],
    ['Narva border crossing to remain closed at night', 2],
    ['Latvia closes two border crossings with Russia for repairs', 2],
    ['Lietuva uždarė visus pasienio punktus su Baltarusija', 2, lt],

    // Words that look like history or the stage and are not.
    ['Concerted cyberattack hits Latvian government sites', 3],
    ['Krievija spēlē bīstamu spēli: drons ielidojis Latvijas gaisa telpā', 3, native],
    ['Latvijas vēsturē lielākais kiberuzbrukums valsts iestādēm', 3, native],
    ['Didžiausia Lietuvos istorijoje kibernetinė ataka prieš valstybės institucijas', 3, lt],
    ['Eesti ajaloo suurim küberrünnak riigiasutuste vastu', 3, et],
    ['Drone crashes near war memorial in Rezekne, Latvia', 3],
    // A warning or a denial after the comma is a reaction to the event, not doubt about it.
    ['Russian drone crashes in Latvia, army warns residents to stay away', 3],
    ['Estonia says Russian jets violated its airspace, Moscow denies', 3],
    ['Latvija slēdz robežu ar Baltkrieviju; Lukašenko noliedz vainu', 3, native],

    // Punctuation between the words, and the verb forms headlines really use.
    ['Drone, believed to be Russian, crashes in eastern Latvia', 3],
    ['Two Russian drones entered Lithuania', 3],
    ['Bojāts Latvijas–Zviedrijas zemūdens kabelis', 3, native],
    ['Russian jets enter Estonian airspace for 12 minutes', 3],
    ['Vene hävitajad sisenesid Eesti õhuruumi', 3, et],
    ['Russian troops open fire on Lithuanian border guards', 4, {}, confirmed],
    ['Shots fired at Latvian border guards from Belarus', 4, {}, confirmed],
    ['Russia attacks Estonia: NATO meets', 5, {}, confirmed],
    ['Krievija iebrukusi Latvijā', 5, native, confirmed],
    ['Rusija užpuolė Lietuvą', 5, lt, confirmed],
    ['Venemaa ründas Eestit', 5, et, confirmed],
  ]

  it.each(HEADLINES)('%s: level %i', (title, level, patch, cluster) => {
    expect(score(story(title), source(patch), NOW, cluster).escalation).toBe(level)
  })

  it('says what it found, where, and what held the level down', () => {
    expect(score(story('Latvia declares mobilisation after border attack'), source(), NOW)).toMatchObject({
      tags: ['mobilisation', 'defence', 'unconfirmed'],
      countries: ['LV'],
      keys: ['mobilisation@LV'],
    })
    expect(score(story('Russian missile strike on Kyiv, five dead'), source(), NOW)).toMatchObject({
      tags: ['strike', 'casualties', 'event_elsewhere'],
      countries: ['RU', 'UA'],
      keys: [],
    })
    // A key for each thing it is about. None for what it puts elsewhere, nor for a story held below 2.
    expect(score(story('Russian drone violates Latvian airspace'), source(), NOW).keys).toEqual(['airspace_violation@LV', 'drone_incursion@LV'])
    expect(score(story('Latvia condemns Russian missile strike on Kyiv'), source(), NOW).keys).toEqual([])
    expect(score(story('Riga marks anniversary of the 1940 Soviet occupation and invasion of Latvia'), source(), NOW).keys).toEqual([])
    // A home-language outlet is about its own country unless it says otherwise; the Baltic Sea is everybody's.
    expect(score(story('Valdība lemj par budžetu'), source({ native: true }), NOW).countries).toEqual(['LV'])
    expect(score(story('Valdība lemj par budžetu', { foreign: true }), source({ native: true }), NOW).countries).toEqual([])
    expect(score(story('Baltic Sea cable damaged'), source(), NOW).countries).toEqual(['LV', 'LT', 'EE'])
  })

  it('reads a description at one level lower than a headline', () => {
    const quiet = story('Minister answers questions', { desc: 'He was asked about sabotage of the railway in Latvia.' })
    expect(score(quiet, source(), NOW).escalation).toBe(2)
  })

  it('looks for history, sport and doubt in the headline alone', () => {
    const incident = (desc: string) => score(story('Russian drone violates Estonian airspace', { desc }), source(), NOW).escalation
    expect(incident('Estonia is acting in concert with its allies after the biggest such incident in its history.')).toBe(3)
    expect(incident('The museum said the flight could have been a mistake, which Moscow denies. No football match was disturbed.')).toBe(3)
  })

  it('does not take everyday words for places', () => {
    // "tapa" is a Latvian verb as well as an Estonian army base, and "krim" is how "kriminālpolicija" starts.
    expect(score(story('Kā tapa jaunais tilts'), source({ native: true }), NOW).countries).toEqual(['LV'])
    expect(score(story('Kriminālpolicija aizturējusi spiegošanā aizdomās turēto'), source({ native: true }), NOW).escalation).toBe(2)
  })

  it('weighs level, place, publisher and age into the importance', () => {
    const at = (title: string, hours = 0, patch?: Partial<NewsSource>) => score(story(title, { at: NOW - hours * HOUR }), source(patch), NOW).importance
    const incident = 'Russian drone crashes in Latvia'
    expect(at('Fuel prices in Latvia up nearly 10% in a month')).toBe(12)
    expect(at(incident)).toBeGreaterThan(80)
    expect(at(incident, 0, { weight: 0.6 })).toBe(at(incident) - 3)
    // Two days on, a serious incident has lost half of what fades; routine news is at its floor the same day.
    expect(at(incident, 48)).toBe(Math.round(at(incident) * 0.65))
    expect(at('Fuel prices in Latvia up nearly 10% in a month', 48)).toBe(4)
    expect(at('NATO troops exercise in Latvia')).toBeGreaterThan(at('Fuel prices in Latvia up nearly 10% in a month'))
  })
})

describe('rank', () => {
  const lsm = source({ id: 'lsm-en', publisher: 'LSM', group: 'lsm' })
  const lsmLv = source({ id: 'lsm-lv', publisher: 'LSM', group: 'lsm', lang: 'lv', native: true })
  const err = source({ id: 'err-en', publisher: 'ERR', group: 'err', country: 'EE' })
  const guard = source({ id: 'rs-lv', publisher: 'Border Guard', group: 'gov-lv', kind: 'official', weight: 1, lang: 'lv', native: true })

  it('counts other publishers carrying the same story, and lists the important ones first', () => {
    const items = rank(
      [
        { item: story('Fuel prices up nearly 10% in a month'), source: lsm },
        { item: story('Russian drone crashes in Latvia', { at: NOW - HOUR }), source: lsm },
        { item: story('Drone crashed in Latvia near the Belarus border, army says', { at: NOW - 2 * HOUR }), source: err },
        { item: story('Drone crashes in Latvia', { at: NOW - 30 * HOUR }), source: source({ publisher: 'BNN', group: 'bnn' }) },
      ],
      NOW,
    )
    expect(items.map((item) => [item.publisher, item.escalation, item.corroboration])).toEqual([
      ['LSM', 3, 1],
      ['ERR', 3, 1],
      // The same words more than twelve hours apart are another incident.
      ['BNN', 3, 0],
      ['LSM', 0, 0],
    ])
    const alone = rank([{ item: story('Russian drone crashes in Latvia', { at: NOW - HOUR }), source: lsm }], NOW)[0]
    expect(items[0].importance).toBe(alone.importance + 6)
    expect(items[0]).toMatchObject({ source: 'lsm-en', lang: 'en', ai: 'summary', countries: ['LV', 'RU'], tags: ['drone_incursion', 'drone'] })
  })

  it('does not let a publisher corroborate itself in another language, and lists that story once', () => {
    const english = { item: story('Latvia declares mobilisation after border attack'), source: lsm }
    // At home the country goes unnamed, and is still what ties the two editions together.
    const latvian = { item: story('Valdība izsludina mobilizāciju', { at: NOW - HOUR }), source: lsmLv }
    const items = rank([latvian, english], NOW)
    expect(items).toMatchObject([{ lang: 'en', escalation: 3, corroboration: 0, tags: ['mobilisation', 'defence', 'unconfirmed'] }])
    // Without an English edition the Latvian one stands.
    expect(rank([latvian], NOW)).toMatchObject([{ lang: 'lv', escalation: 3 }])
  })

  it('keeps a home-language story that is not the English one retold', () => {
    // Nine hours on, the same words are a second drone.
    const first = { item: story("Drone crashes in Latvia's Rezekne region", { at: NOW - 9 * HOUR }), source: lsm }
    const second = { item: story('Vēl viens drons nokritis Latgalē', { at: NOW - HOUR / 2 }), source: lsmLv }
    expect(rank([first, second], NOW).map((item) => [item.lang, item.escalation, item.corroboration])).toEqual([
      ['lv', 3, 0],
      ['en', 3, 0],
    ])
    // Delfi in Vilnius and Delfi in Riga are two newsrooms under one name, and still one voice.
    const vilnius = { item: story('Hackers attack Lithuanian ministry in Baltic-wide campaign'), source: source({ publisher: 'Delfi', group: 'delfi', country: 'LT' }) }
    const riga = { item: story('Baltijas valstīs izplatās izspiedējvīrusa kampaņa'), source: source({ publisher: 'Delfi', group: 'delfi', lang: 'lv', native: true }) }
    expect(rank([vilnius, riga], NOW).map((item) => item.corroboration)).toEqual([0, 0])
  })

  it('pairs up publishers that word one event differently', () => {
    const items = rank(
      [
        { item: story('Russian drone violates Latvian airspace'), source: lsm },
        { item: story('Russian drone crashes in Latvia'), source: err },
        { item: story('Drone from Belarus crashes in Latvia, airspace closed'), source: source({ publisher: 'LRT', group: 'lrt', country: 'LT' }) },
      ],
      NOW,
    )
    expect(items.map((item) => item.corroboration)).toEqual([2, 2, 2])
    // Each names the other two, with a link to their own report, and never itself.
    const first = items.find((item) => item.publisher === 'LSM')!
    expect(first.confirmedBy!.map((voice) => voice.publisher).sort()).toEqual(['ERR', 'LRT'])
    expect(first.confirmedBy!.every((voice) => voice.link !== first.link && !voice.official)).toBe(true)
    expect(rank([{ item: story('Fuel prices up nearly 10% in a month'), source: lsm }], NOW)[0].confirmedBy).toBeUndefined()
  })

  it('picks political stories as published, newest first, and nothing else', () => {
    const picked = pickPolitics(
      [
        { item: story('Fuel prices up nearly 10% in a month'), source: lsm },
        { item: story('Saeima passes next year’s budget', { at: NOW - 2 * HOUR }), source: lsm },
        { item: story('Valitsus kinnitas eelarve', { at: NOW - HOUR }), source: source({ publisher: 'ERR', group: 'err', lang: 'et', country: 'EE' }) },
        { item: story('Elephant born at the zoo'), source: lsm },
        { item: story('Coalition talks collapsed', { at: NOW - 80 * HOUR }), source: lsm },
        { item: story('Press release on a visit', { at: NOW - 3 * HOUR }), source: source({ id: 'eu-council', publisher: 'Council of the EU', kind: 'official', country: 'INT' }) },
      ],
      NOW,
    )
    expect(picked.map((item) => [item.title, item.publisher, item.official])).toEqual([
      ['Valitsus kinnitas eelarve', 'ERR', false],
      ['Saeima passes next year’s budget', 'LSM', false],
      ['Press release on a visit', 'Council of the EU', true],
    ])
  })

  it('lets a second publisher or an official body confirm a crisis', () => {
    const english = { item: story('Latvia declares mobilisation after border attack'), source: lsm }
    const second = rank([english, { item: story('Mobilisation declared in Latvia'), source: err }], NOW)
    expect(second).toMatchObject([{ escalation: 4, corroboration: 1 }, { escalation: 4, corroboration: 1 }])
    expect(second[0].tags).not.toContain('unconfirmed')

    // The newsroom ranks above the body that confirms it: being confirmed officially is worth more than being official.
    expect(rank([english, { item: story('Latvijā izsludināta mobilizācija'), source: guard }], NOW)).toMatchObject([
      { publisher: 'LSM', escalation: 4, corroboration: 1 },
      { publisher: 'Border Guard', escalation: 4, corroboration: 1 },
    ])

    // A statement about a strike on Kyiv and an anniversary piece confirm nothing that happened here.
    const strike = { item: story('Missile strike hits Latvian port'), source: lsm }
    const statement = { item: story('Latvia condemns Russian missile strike on Kyiv'), source: err }
    const history = { item: story('Latvia marks anniversary of 1941 missile strike on Riga port'), source: guard }
    expect(rank([strike, statement, history], NOW)[0]).toMatchObject({ publisher: 'LSM', escalation: 3, corroboration: 0 })
  })
})

const news = (patch: Partial<NewsItem>): NewsItem => ({
  title: 'Russian drone crashes in Latvia',
  link: 'https://eng.lsm.lv/a1/',
  at: NOW - HOUR,
  source: 'lsm-en',
  publisher: 'LSM',
  lang: 'en',
  countries: ['LV', 'RU'],
  importance: 80,
  escalation: 3,
  tags: [],
  corroboration: 0,
  ai: 'rate-only',
  ...patch,
})

describe('regionLevel', () => {
  it('is the highest live level, with a second publisher needed from 3 up', () => {
    expect(regionLevel([], NOW)).toBe(0)
    expect(regionLevel([news({})], NOW)).toBe(2)
    expect(regionLevel([news({ corroboration: 1 })], NOW)).toBe(3)
    expect(regionLevel([news({}), news({ publisher: 'ERR', escalation: 4 })], NOW)).toBe(3)
    // A story counts for as many hours as its level's half-life: 12 at level 1, 48 at level 3.
    expect(regionLevel([news({ escalation: 1, at: NOW - 13 * HOUR })], NOW)).toBe(0)
    expect(regionLevel([news({ corroboration: 1, at: NOW - 47 * HOUR })], NOW)).toBe(3)
  })

  it('reads one country from the stories about it', () => {
    const items = [news({ corroboration: 1 }), news({ escalation: 1, countries: ['EE'] })]
    expect(regionLevel(items, NOW, 'LV')).toBe(3)
    expect(regionLevel(items, NOW, 'EE')).toBe(1)
    expect(regionLevel(items, NOW, 'LT')).toBe(0)
  })
})

describe('news alert', () => {
  const alerts = (items: NewsItem[]) => newsRule.evaluate({ now: NOW, entities: () => [], warnings: () => [], news: () => items, insideLatvia: () => false, tr: translate.bind(null, 'en') })

  it('is raised by a fresh serious headline and withdrawn when it is six hours old', () => {
    expect(alerts([news({}), news({ link: 'https://eng.lsm.lv/a2/', escalation: 2 }), news({ link: 'https://eng.lsm.lv/a3/', at: NOW - 7 * HOUR })])).toEqual([
      { key: 'news:https://eng.lsm.lv/a1/', severity: 'warn', title: 'Serious incident: Russian drone crashes in Latvia', detail: 'Level 3 · LSM' },
    ])
    expect(alerts([news({ escalation: 4, corroboration: 2 })])).toMatchObject([{ severity: 'critical', detail: 'Level 4 · LSM · also reported by 2' }])
  })
})

describe('news feed', () => {
  interface Sent {
    title: string
    link: string
    at: number
    desc?: string
  }
  const rss = (items: Sent[]) =>
    `<rss><channel>${items
      .map((one) => `<item><title>${one.title}</title><link>${one.link}</link><pubDate>${new Date(one.at).toUTCString()}</pubDate><description>${one.desc ?? ''}</description></item>`)
      .join('')}</channel></rss>`

  /** A fresh copy of the feed (it remembers what it read) behind a cache whose clock and upstream the test holds. */
  async function setup(answers: Record<string, () => Sent[]>, onDisk: StoredSnapshot | null = null) {
    vi.resetModules()
    const { FeedCache, FeedUnavailable } = await import('../../server/core/cache')
    const { newsFeed } = await import('../../server/feeds/news')
    const { blurbOf } = await import('../../server/feeds/newsBlurbs')
    const state = { now: NOW, asked: [] as string[] }
    const cache = new FeedCache({
      log: () => {},
      now: () => state.now,
      disk: { read: async () => onDisk, write: async () => {} },
      fetch: async (url) => {
        const { host } = new URL(url)
        state.asked.push(host)
        return answers[host] ? new Response(rss(answers[host]())) : new Response('bad gateway', { status: 502 })
      },
    })
    const read = async () => {
      const { snapshot } = await cache.get(newsFeed)
      // Past the first answer the cache hands out the old copy while it refreshes.
      await vi.waitUntil(() => !cache.peek('news').refreshing)
      const latest = cache.peek('news').snapshot ?? snapshot
      return { json: latest.json.toString(), items: latest.payload.shape === 'news' ? latest.payload.items : [] }
    }
    return { state, read, blurbOf, FeedUnavailable, newsFeed, cache }
  }

  const incident = { title: 'Russian drone crashes in Latvia', link: 'https://eng.lsm.lv/a1/', at: NOW - 5 * HOUR, desc: 'The army is searching the area.' }

  it('serves what answered when most feeds are down, and keeps descriptions on the server', async () => {
    const { state, read, blurbOf, newsFeed } = await setup({
      'eng.lsm.lv': () => [incident, { title: 'Too old to matter', link: 'https://eng.lsm.lv/a0/', at: NOW - 80 * HOUR }],
      'www.lrt.lt': () => [{ title: 'Seimas debates the budget', link: 'https://www.lrt.lt/en/b1', at: NOW - HOUR, desc: 'Lithuanian MPs met.' }],
    })
    const { items, json } = await read()

    // Thirty feeds on twenty-nine hosts, each asked once and none of them outside the declared origins.
    expect(state.asked).toHaveLength(30)
    expect(new Set(state.asked).size).toBe(29)
    expect(newsFeed.origins).toHaveLength(29)
    // LRT publishes two of the feeds read, and here they answer with the same story.
    expect(items.map((item) => [item.publisher, item.title, item.escalation, item.ai])).toEqual([
      ['LSM', 'Russian drone crashes in Latvia', 3, 'rate-only'],
      ['LRT', 'Seimas debates the budget', 0, 'none'],
    ])
    expect(json).not.toContain('searching the area')
    expect(blurbOf(incident.link)).toBe('The army is searching the area.')
    // LRT allows a language model nothing, so its description is not kept for one.
    expect(blurbOf('https://www.lrt.lt/en/b1')).toBeUndefined()
  })

  it('starts from the copy on disk, unless an older build wrote it', async () => {
    const kept = (item: object): StoredSnapshot => ({ updatedAt: NOW - HOUR, payload: { shape: 'news', items: [item as NewsItem] } })
    const first = async (onDisk: StoredSnapshot) => {
      const { cache, newsFeed } = await setup({ 'eng.lsm.lv': () => [incident] }, onDisk)
      const { payload } = (await cache.get(newsFeed)).snapshot
      await vi.waitUntil(() => !cache.peek('news').refreshing)
      return payload.shape === 'news' ? payload.items.map((item) => item.title) : []
    }
    expect(await first(kept(news({ title: 'Rated an hour ago' })))).toEqual(['Rated an hour ago'])
    // Before the ratings a headline was a title, a link and a time. Served as it is, it empties the list and breaks the brief.
    expect(await first(kept({ title: 'Unrated', link: 'https://eng.lsm.lv/a0/', at: NOW - 2 * HOUR }))).toEqual([incident.title])
  })

  it('fails when nothing answers, or when what answers is not a feed', async () => {
    const dead = await setup({})
    await expect(dead.read()).rejects.toBeInstanceOf(dead.FeedUnavailable)
    const empty = await setup({ 'eng.lsm.lv': () => [] })
    await expect(empty.read()).rejects.toThrow('did not send any stories')
  })

  it('asks newsrooms every ten minutes and official bodies every thirty', async () => {
    const { state, read } = await setup({ 'eng.lsm.lv': () => [incident], 'cert.lv': () => [{ title: 'Brīdinājums', link: 'https://cert.lv/b1', at: NOW - HOUR }] })
    const count = (host: string) => state.asked.filter((asked) => asked === host).length
    await read()
    for (let round = 1; round <= 3; round++) {
      state.now += 10 * MINUTE + 1
      await read()
    }
    expect(count('eng.lsm.lv')).toBe(4)
    expect(count('cert.lv')).toBe(2)
    // A dead official feed is retried with the newsrooms: there is nothing of it to keep.
    expect(count('www.rs.gov.lv')).toBe(4)
  })

  it('caps the list without ever dropping an important story for a routine one', async () => {
    const routine = Array.from({ length: 200 }, (_, i) => ({ title: `Council meeting ${i}`, link: `https://eng.lsm.lv/r${i}/`, at: NOW - i * 20 * MINUTE }))
    const old = { ...incident, at: NOW - 60 * HOUR }
    const { read } = await setup({ 'eng.lsm.lv': () => [...routine, old] })
    const { items } = await read()
    expect(items).toHaveLength(150)
    expect(items[0].title).toBe(incident.title)
    expect(items.map((item) => item.title)).toContain('Council meeting 0')
    expect(items.every((item, index) => index === 0 || item.importance <= items[index - 1].importance)).toBe(true)
  })

  it('keeps a story that scrolled off the end of its feed, and drops one that was withdrawn', async () => {
    const later = (hours: number) => ({ title: `Later story ${hours}`, link: `https://eng.lsm.lv/l${hours}/`, at: NOW - hours * HOUR })
    let feed = [later(1), incident]
    const { state, read } = await setup({ 'eng.lsm.lv': () => feed })
    expect((await read()).items.map((item) => item.link)).toContain(incident.link)

    state.now += 10 * MINUTE + 1
    feed = [later(1), later(2)]
    expect((await read()).items.map((item) => item.link)).toContain(incident.link)

    state.now += 10 * MINUTE + 1
    feed = [later(1), later(9)]
    expect((await read()).items.map((item) => item.link)).toEqual([later(1).link, later(9).link])
  })
})

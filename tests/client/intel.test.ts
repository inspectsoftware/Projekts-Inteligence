import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPayload, IntelBrief, NewsItem } from '../../shared/feeds'
import { IntelWindow } from '../../src/ui/windows/IntelWindow'
import { rowsFor, sourcesOf } from '../../src/ui/windows/intel'

const { NOW, feeds } = vi.hoisted(() => ({ NOW: Date.parse('2026-10-06T12:00:00Z'), feeds: {} as Record<string, FeedPayload | undefined> }))

// The real hooks poll the server and tick a clock. Here the window is handed its data and the time.
vi.mock('../../src/runtime/useFeed', () => ({ useFeed: (id: string) => feeds[id] }))
vi.mock('../../src/runtime/useNow', () => ({ useNow: () => NOW }))

const HOUR = 3600 * 1000

const item = (patch: Partial<NewsItem>): NewsItem => ({
  title: 'Russian drone crashes in Latvia',
  link: 'https://eng.lsm.lv/a1/',
  at: NOW - HOUR,
  source: 'lsm-en',
  publisher: 'LSM',
  lang: 'en',
  countries: ['LV', 'RU'],
  importance: 80,
  escalation: 3,
  tags: ['drone_incursion', 'drone'],
  corroboration: 0,
  ai: 'summary',
  ...patch,
})

const drone = item({})
const budget = item({ title: 'Seimas debates the <b>budget</b>', link: 'https://www.lrt.lt/b1', at: NOW - 60_000, publisher: 'LRT', countries: ['LT'], importance: 12, escalation: 0, tags: [] })
const drill = item({ title: 'Kaitsevägi alustas õppust', link: 'https://www.err.ee/c1', at: NOW - 2 * HOUR, publisher: 'ERR', lang: 'et', countries: ['EE'], importance: 46, escalation: 1, tags: ['exercise'], corroboration: 2 })

const brief: IntelBrief = {
  mode: 'ai',
  generatedAt: NOW - 5 * 60_000,
  level: 1,
  headline: 'A drone came down in Latvia; nothing suggests an attack',
  summary: 'LSM reports a drone crash in Latvia. The report rests on one source.',
  points: [{ text: 'A drone crashed in eastern Latvia.', level: 2, links: [drone.link, 'https://gone.example/x'] }],
  countries: { LV: { level: 2, text: 'One incident under investigation.' }, LT: { level: 0, text: 'Routine.' }, EE: { level: 1, text: 'An exercise.' } },
  ratings: { [drone.link]: { importance: 55, escalation: 2, summary: 'A drone of unknown origin crashed; no one was hurt.' } },
}

describe('the list behind the window', () => {
  const all = { sort: 'importance', country: 'all', minLevel: 0 } as const

  it('orders by importance or by time, and narrows by country and level', () => {
    const links = (choice: Parameters<typeof rowsFor>[2]) => rowsFor([budget, drone, drill], undefined, choice).map((row) => row.publisher)
    expect(links(all)).toEqual(['LSM', 'ERR', 'LRT'])
    expect(links({ ...all, sort: 'latest' })).toEqual(['LRT', 'LSM', 'ERR'])
    expect(links({ ...all, country: 'EE' })).toEqual(['ERR'])
    expect(links({ ...all, minLevel: 1 })).toEqual(['LSM', 'ERR'])
  })

  it("puts the brief's rating in place of the rule score before filtering and ordering", () => {
    const rows = rowsFor([budget, drone, drill], { [drone.link]: { importance: 30, escalation: 2, summary: 'One line.' } }, { ...all, minLevel: 1 })
    expect(rows.map((row) => [row.publisher, row.escalation, row.importance, row.summary])).toEqual([
      ['ERR', 1, 46, undefined],
      ['LSM', 2, 30, 'One line.'],
    ])
    expect(rowsFor([drone], brief.ratings, { ...all, minLevel: 3 })).toEqual([])
  })

  it('links a key point only to headlines that are on the list', () => {
    expect(sourcesOf(brief.points[0].links, [budget, drone])).toEqual([drone])
  })
})

describe('IntelWindow', () => {
  const render = () => renderToStaticMarkup(createElement(IntelWindow))

  beforeEach(() => {
    feeds.news = undefined
    feeds.brief = undefined
  })

  it('waits without a level, then works one out from the headlines alone', () => {
    expect(render()).toContain('Standing by')

    feeds.news = { shape: 'news', items: [drone, budget, drill] }
    const html = render()
    // One newsroom's level 3 does not move the region past 2 without a second publisher.
    expect(html).toContain('L2 Hybrid pressure')
    expect(html).toContain('No brief has been written yet')
    expect(html).toContain('<a href="https://eng.lsm.lv/a1/" lang="en" target="_blank" rel="noreferrer noopener"')
    expect(html).toContain('drone incursion · drone')
    expect(html).toContain('exercise · also reported by 2')
    // Text from a feed is text, whatever it looks like.
    expect(html).toContain('Seimas debates the &lt;b&gt;budget&lt;/b&gt;')
  })

  it('shows the brief once it arrives, and its ratings on the headlines', () => {
    feeds.news = { shape: 'news', items: [drone, budget, drill] }
    feeds.brief = { shape: 'brief', ...brief }
    const html = render()
    expect(html).toContain('L1 Posture')
    expect(html).toContain('A drone came down in Latvia; nothing suggests an attack')
    expect(html).toContain('>AI</span>5 min ago')
    expect(html).toContain('A drone of unknown origin crashed; no one was hurt.')
    expect(html).not.toContain('L2 Hybrid pressure')
  })
})

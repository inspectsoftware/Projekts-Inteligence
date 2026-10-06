import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Send } from '../../server/ai/model'
import { buildCountryBriefs, numbersIn, rulesCountryBrief } from '../../server/feeds/countryBriefs'
import { setBlurbs } from '../../server/feeds/newsBlurbs'
import { COUNTRY_CODES, type CountryFile, formatFact, formatYear } from '../../shared/countries'
import data from '../../shared/data/countries.json'
import { NOW, asked, fakeModel, headline, reply } from './fakeModel'

const file: CountryFile = data
const SECTIONS = ['overview', 'defence', 'military', 'economy', 'risks'] as const

beforeEach(() => setBlurbs([]))

describe('country facts', () => {
  it('holds all nine countries, each fact with a source that can be opened', () => {
    expect(Object.keys(file.countries)).toEqual([...COUNTRY_CODES])
    expect(file.generatedAt).toBe('2026-10-06T13:00:00Z')
    for (const profile of Object.values(file.countries)) {
      for (const entry of [...profile.facts, ...profile.defence, ...profile.forces]) expect(entry.url).toMatch(/^https:\/\//)
      for (const entry of [...profile.facts, ...profile.defence]) expect(entry.source).not.toBe('')
    }
  })

  it('writes a value with its unit', () => {
    const fact = (value: string | number, unit: string | null) => formatFact({ key: '', label: '', value, unit, year: 2025, source: '', url: '' })
    expect(fact('Riga', null)).toBe('Riga')
    expect(fact(1847785, 'people')).toBe('1,847,785')
    expect(fact(64590, 'km2')).toBe('64,590 km²')
    expect(fact(2157966637, 'EUR')).toBe('€2.16 bn')
    expect(fact(2561310169359, 'USD')).toBe('US$2.56 trn')
    expect(fact(26312, 'USD')).toBe('US$26,312')
    expect(fact(46137, 'intl $')).toBe('Int$46,137')
    expect(fact(4.92, '% of GDP')).toBe('4.92% of GDP')
    expect(fact(-0.99, '% per year')).toBe('-0.99% per year')
    expect(fact(76.4, 'years')).toBe('76.4 years')
    expect(fact(1.589, 'score')).toBe('1.589')
    expect(formatYear('2026e')).toBe('2026 est.')
    expect(formatYear(2025)).toBe('2025')
  })
})

describe('template-written briefs', () => {
  it('are real sentences with the actual figures and their years', () => {
    const news = [headline({ escalation: 2 }), headline()]
    const brief = rulesCountryBrief(file.countries.LV, news, NOW)
    expect(brief.mode).toBe('rules')
    expect(brief.overview).toContain('Latvia has 1,847,785 people (2025) and covers 64,590 km² (2023). Its capital is Riga.')
    expect(brief.economy).toContain('GDP was US$48.62 bn (2025), or US$26,312 per person')
    expect(brief.economy).toContain('the forecast for 2026 is 2.2% (IMF WEO Apr 2026)')
    expect(brief.defence).toContain('The national defence budget for 2026 is €2.16 bn, or 4.73% of GDP (source: Ministry of Defence of Latvia).')
    expect(brief.defence).toContain('3.67% of GDP (2025 est.) and 4.92% of GDP (2026 est.)')
    expect(brief.military).toContain('NATO lists 8,200 military personnel for 2025 (estimate) and 8,300 for 2026 (estimate)')
    expect(brief.military).toContain('\n\nAllied forces. NATO Multinational Brigade Latvia: Canada-led brigade of 14 nations')
    expect(brief.risks).toContain('The Global Peace Index scores Latvia 1.589 (rank 19, 2026)')
    expect(brief.risks).toContain('As of 6 October 2026, keyword scoring of 2 recent headlines about Latvia supports level 2 (hybrid pressure).')
  })

  it('leave out what the file does not hold for a country, without leaving a hole', () => {
    for (const iso of COUNTRY_CODES) {
      const brief = rulesCountryBrief(file.countries[iso], [], NOW)
      for (const section of SECTIONS) {
        expect(brief[section].length, `${iso} ${section}`).toBeGreaterThan(80)
        expect(brief[section], `${iso} ${section}`).not.toMatch(/undefined|NaN|null|\(\)|  /)
      }
    }
    const russia = rulesCountryBrief(file.countries.RU, [], NOW)
    expect(russia.defence).toBe('SIPRI puts military expenditure at 7.5% of GDP (2025), US$190.42 bn. The World Bank series, an older SIPRI vintage, gives 7.05% of GDP (2024).')
    expect(russia.military).toContain('The fact file holds no sourced order of battle for Russia.')
    expect(russia.economy).toContain('Net energy imports were -75.1% of energy use (2022), which makes it a net exporter.')
    expect(russia.risks).toContain('no recent headline mentions Russia')
  })

  it('are what every country gets without a key', async () => {
    const send = vi.fn<Send>()
    const payload = await buildCountryBriefs(file, [], NOW, fakeModel(send, {}).model)
    expect(send).not.toHaveBeenCalled()
    expect(payload).toMatchObject({ shape: 'country-briefs', mode: 'rules', generatedAt: NOW })
    expect(Object.keys(payload.briefs)).toEqual([...COUNTRY_CODES])
    expect(payload.briefs.EE).toEqual(rulesCountryBrief(file.countries.EE, [], NOW))
  })
})

describe('model-written briefs', () => {
  const written = (over: Record<string, string> = {}) => ({
    overview: 'Latvia has 1,847,785 people (2025) and its capital is Riga.',
    defence: 'NATO puts core defence expenditure at 4.92% of GDP for 2026, an estimate.',
    military: 'NATO lists 8,300 military personnel for 2026, an estimate.',
    economy: 'GDP was US$48.62 bn in 2025.',
    risks: 'No headlines were available.',
    ...over,
  })

  it('numbers are read the same however they are written', () => {
    expect([...numbersIn('1,847,785 people on 2026-10-06, 4.92% and €2.16 bn; 8,000 professional, 12,000 guards')]).toEqual(
      ['1847785', '2026', '10', '6', '4.92', '2.16', '8000', '12000'],
    )
  })

  it('asks once per country, the Baltic states first, with the facts and only the headlines the terms allow', async () => {
    const open = headline({ title: 'OPEN-HEADLINE', importance: 50 })
    const rateOnly = headline({ title: 'RATE-ONLY-HEADLINE', importance: 40, ai: 'rate-only' })
    const closed = headline({ title: 'SECRET-HEADLINE', importance: 90, ai: 'none' })
    const elsewhere = headline({ title: 'ELSEWHERE-HEADLINE', countries: ['FI'] })
    setBlurbs([
      [open.link, 'OPEN-BLURB'],
      [rateOnly.link, 'RATE-ONLY-BLURB'],
      [closed.link, 'SECRET-BLURB'],
    ])
    const send = vi.fn<Send>(async () => reply(written()))
    await buildCountryBriefs(file, [open, rateOnly, closed, elsewhere], NOW, fakeModel(send).model)

    expect(send).toHaveBeenCalledTimes(9)
    expect(send.mock.calls.map(([body]) => String(body.messages[0].content).split('\n')[0])).toEqual([
      'Country: Latvia (LV)',
      'Country: Lithuania (LT)',
      'Country: Estonia (EE)',
      'Country: Finland (FI)',
      'Country: Sweden (SE)',
      'Country: Poland (PL)',
      'Country: Germany (DE)',
      'Country: Russia (RU)',
      'Country: Belarus (BY)',
    ])
    const latvia = asked(send.mock.calls[0][0])
    expect(latvia).toContain('- Population: 1,847,785 (2025; World Bank)')
    expect(latvia).toContain('- Core defence expenditure: 4.92% of GDP (2026 est.; NATO Defence Expenditure of NATO Countries (2014-2026))')
    expect(latvia).toContain('OPEN-HEADLINE | OPEN-BLURB')
    // Nothing is rated here, so a headline that may be rated but not reworded stays out as well.
    expect(latvia).not.toMatch(/SECRET|RATE-ONLY|ELSEWHERE|https?:\/\//)
    // Both still count in the rule score, which is ours.
    expect(latvia).toContain('Keyword scoring of 3 recent headlines about Latvia: level 0 (routine).')
    expect(latvia).toContain('untrusted')
    expect(asked(send.mock.calls[3][0])).toContain('ELSEWHERE-HEADLINE')
  })

  it('keeps a section only if every number in it is in the fact sheet', async () => {
    const send = vi.fn<Send>(async () =>
      reply(written({ economy: 'GDP was about US$50 bn in 2025.', risks: '<i>No headlines</i> were available, see https://example.org/x' })),
    )
    const payload = await buildCountryBriefs({ ...file, countries: { LV: file.countries.LV } }, [], NOW, fakeModel(send).model)
    const rules = rulesCountryBrief(file.countries.LV, [], NOW)
    expect(payload.mode).toBe('ai')
    expect(payload.briefs.LV).toEqual({
      mode: 'ai',
      overview: 'Latvia has 1,847,785 people (2025) and its capital is Riga.',
      defence: 'NATO puts core defence expenditure at 4.92% of GDP for 2026, an estimate.',
      military: 'NATO lists 8,300 military personnel for 2026, an estimate.',
      // 50 is nowhere in the sheet.
      economy: rules.economy,
      risks: 'No headlines were available, see',
    })
  })

  it('takes a figure from a headline as that publisher’s claim, in the risk section and nowhere else', async () => {
    const claim = headline({ title: 'Latvia to cut defence spending to 0.5% of GDP, sources claim', publisher: 'RFE/RL' })
    const risks = 'RFE/RL reports a claim that defence spending is to be cut to 0.5% of GDP.'
    const send = vi.fn<Send>(async () => reply(written({ defence: 'Latvia spends 0.5% of GDP on defence.', risks })))
    const { briefs } = await buildCountryBriefs({ ...file, countries: { LV: file.countries.LV } }, [claim], NOW, fakeModel(send).model)
    expect(asked(send.mock.calls[0][0])).toContain('0.5% of GDP, sources claim')
    expect(briefs.LV.defence).toBe(rulesCountryBrief(file.countries.LV, [claim], NOW).defence)
    expect(briefs.LV.risks).toBe(risks)
  })

  it('leaves a country the model fails on in rules mode and writes the others', async () => {
    const send = vi
      .fn<Send>(async () => reply(written({ overview: 'A country in northern Europe.' })))
      .mockResolvedValueOnce(reply('', 'refusal'))
      .mockResolvedValueOnce(reply('not json'))
    const payload = await buildCountryBriefs(file, [], NOW, fakeModel(send).model)
    expect(send).toHaveBeenCalledTimes(9)
    expect(payload.mode).toBe('ai')
    expect(payload.briefs.LV).toEqual(rulesCountryBrief(file.countries.LV, [], NOW))
    expect(payload.briefs.LT.mode).toBe('rules')
    expect(payload.briefs.EE).toMatchObject({ mode: 'ai', overview: 'A country in northern Europe.' })
  })

  it('stops asking after a failure that would only repeat', async () => {
    const send = vi
      .fn<Send>()
      .mockResolvedValueOnce(reply(written()))
      .mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError())
    const payload = await buildCountryBriefs(file, [], NOW, fakeModel(send).model)
    expect(send).toHaveBeenCalledTimes(2)
    expect(Object.values(payload.briefs).map((brief) => brief.mode)).toEqual(['ai', ...Array(8).fill('rules')])
  })
})

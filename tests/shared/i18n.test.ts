import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANGS, translate } from '../../shared/i18n'
import { et } from '../../shared/i18n/et'
import { lt } from '../../shared/i18n/lt'
import { lv } from '../../shared/i18n/lv'
import { ru } from '../../shared/i18n/ru'

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(entry.name) && !path.includes('i18n')) yield path
  }
}

/** Every English text handed to t(), tr() or msg() as a plain string literal, anywhere in the app. */
export function usedTexts(): Set<string> {
  const found = new Set<string>()
  const call = /\b(?:t|tr|msg)\(\s*(?:lang,\s*)?(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  for (const root of ['src', 'shared', 'server']) {
    for (const file of sources(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(call)) {
        found.add((match[1] ?? match[2]).replace(/\\(['"\\])/g, '$1'))
      }
    }
  }
  return found
}

describe('translations', () => {
  it('fills in values and falls back to English', () => {
    expect(translate('en', '{n} aircraft', { n: 3 })).toBe('3 aircraft')
    expect(translate('lv', 'A text nobody translated')).toBe('A text nobody translated')
    expect(LANGS).toContain('ru')
  })

  it.each(Object.entries({ lv, lt, et, ru }))('%s covers every text the app shows and keeps its placeholders', (_code, dict) => {
    const missing = [...usedTexts()].filter((text) => !(text in dict))
    expect(missing).toEqual([])
    for (const [english, translated] of Object.entries(dict)) {
      const marks = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
      expect(marks(translated), english).toEqual(marks(english))
    }
  })
})

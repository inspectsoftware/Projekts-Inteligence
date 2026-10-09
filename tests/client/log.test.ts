import { beforeEach, describe, expect, it } from 'vitest'
import { clearLog, getLog, logEvent, reportText } from '../../src/runtime/log'

const page = { href: 'https://example.org/', userAgent: 'TestBrowser/1.0', language: 'lv' }

describe('console log', () => {
  beforeEach(clearLog)

  it('counts a fault that repeats instead of listing it again', () => {
    logEvent('error', 'boom', 1)
    logEvent('error', 'boom', 2)
    logEvent('warn', 'boom', 3)
    expect(getLog()).toEqual([
      { at: 2, level: 'error', text: 'boom', count: 2 },
      { at: 3, level: 'warn', text: 'boom', count: 1 },
    ])
  })

  it('keeps the newest two hundred', () => {
    for (let n = 0; n < 250; n++) logEvent('warn', `fault ${n}`)
    expect(getLog()).toHaveLength(200)
    expect(getLog()[0].text).toBe('fault 50')
    expect(getLog().at(-1)?.text).toBe('fault 249')
  })

  it('writes a report with the build, the browser and every line', () => {
    logEvent('error', 'TypeError: x is undefined', Date.UTC(2026, 9, 9, 12, 0, 0))
    logEvent('error', 'TypeError: x is undefined', Date.UTC(2026, 9, 9, 12, 0, 5))
    const text = reportText('abc1234', page, Date.UTC(2026, 9, 9, 12, 1, 0))
    expect(text).toContain('Build: abc1234')
    expect(text).toContain('Browser: TestBrowser/1.0')
    expect(text).toContain('Page: https://example.org/')
    expect(text).toContain('2026-10-09T12:00:05.000Z ERROR (x2) TypeError: x is undefined')
    expect(reportText('abc1234', page)).not.toContain('Nothing in the log.')
    clearLog()
    expect(reportText('abc1234', page)).toContain('Nothing in the log.')
  })
})

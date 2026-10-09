import { useSyncExternalStore } from 'react'
import { APP } from '../../shared/meta'

export type LogLevel = 'error' | 'warn'

export interface LogEntry {
  at: number
  level: LogLevel
  text: string
  /** How many times in a row it happened. */
  count: number
}

const MAX_ENTRIES = 200
const MAX_TEXT = 2000

let entries: readonly LogEntry[] = []
const listeners = new Set<() => void>()

/** Notes a fault for the Console window. The same fault again straight away is counted, not listed twice. */
export function logEvent(level: LogLevel, text: string, at: number = Date.now()): void {
  const clipped = text.slice(0, MAX_TEXT)
  const last = entries.at(-1)
  if (last && last.level === level && last.text === clipped) entries = [...entries.slice(0, -1), { ...last, at, count: last.count + 1 }]
  else entries = [...entries.slice(-(MAX_ENTRIES - 1)), { at, level, text: clipped, count: 1 }]
  for (const listener of listeners) listener()
}

export function clearLog(): void {
  entries = []
  for (const listener of listeners) listener()
}

/** Oldest first. */
export const getLog = (): readonly LogEntry[] => entries

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLog(): readonly LogEntry[] {
  return useSyncExternalStore(subscribe, getLog)
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Starts collecting what would otherwise only reach the browser's own console. Call once, before the app renders. */
export function installLog(): void {
  window.addEventListener('error', (event) => logEvent('error', describe(event.error ?? event.message)))
  window.addEventListener('unhandledrejection', (event) => logEvent('error', `Unhandled rejection: ${describe(event.reason)}`))
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      logEvent(level, args.map(describe).join(' '))
    }
  }
}

export interface ReportPage {
  href: string
  userAgent: string
  language: string
}

const thisPage = (): ReportPage => ({ href: location.origin + location.pathname, userAgent: navigator.userAgent, language: navigator.language })

/** The log as plain text to paste into a report, with what a maintainer asks for first. English, whatever the page shows. */
export function reportText(commit: string, page: ReportPage = thisPage(), at: number = Date.now()): string {
  const lines = entries.map((entry) => {
    const times = entry.count > 1 ? ` (x${entry.count})` : ''
    return `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase()}${times} ${entry.text}`
  })
  return [
    `${APP.name} report`,
    `Build: ${commit}`,
    `Time: ${new Date(at).toISOString()}`,
    `Page: ${page.href}`,
    `Browser: ${page.userAgent}`,
    `Language: ${page.language}`,
    '',
    ...(lines.length > 0 ? lines : ['Nothing in the log.']),
  ].join('\n')
}

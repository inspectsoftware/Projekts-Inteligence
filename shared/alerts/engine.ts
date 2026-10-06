import type { Entity } from '../entity'
import type { NewsItem, WeatherWarning, Zone } from '../feeds'

export type Severity = 'info' | 'warn' | 'critical'

/** A condition a rule found to be true right now. */
export interface AlertCandidate {
  /** Stable for as long as the same condition holds, e.g. `emergency:aircraft:4ab56e`. */
  key: string
  severity: Severity
  title: string
  detail?: string
  at?: { lon: number; lat: number }
  /** Entity to select when the alert is opened. */
  entityId?: string
}

export interface AlertInput {
  now: number
  entities(slot: string): readonly Entity[]
  /** Official weather warnings in force or imminent. */
  warnings(): readonly WeatherWarning[]
  /** Rated headlines. Empty while nothing on screen is reading the news feed. */
  news(): readonly NewsItem[]
  /**
   * Sea warnings and airspace restrictions. Empty while nothing on screen is reading those feeds.
   * Optional so that rules about other things can be tried without it.
   */
  zones?(): readonly Zone[]
  insideLatvia(lon: number, lat: number): boolean
}

export interface AlertRule {
  id: string
  /** How long the condition must be absent before its alert is withdrawn. */
  clearAfterMs: number
  /** Pure: returns every condition that currently holds, not just new ones. */
  evaluate(input: AlertInput): AlertCandidate[]
}

export interface Alert extends AlertCandidate {
  ruleId: string
  raisedAt: number
  /** Last time the condition was seen to hold. */
  seenAt: number
}

export interface Evaluation {
  /** Everything active after this pass, most severe and most recent first. */
  alerts: Alert[]
  raised: Alert[]
  cleared: Alert[]
  /** True when anything a person could see has changed. */
  changed: boolean
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

/**
 * Alerts are conditions with a beginning and an end, not one-off events: an alert is
 * raised when a rule first reports it, kept (and updated) while the rule keeps
 * reporting it, and withdrawn only after it has been absent for a while. A feed
 * hiccup or a page reload therefore never fires the same alert twice.
 */
export class AlertEngine {
  private readonly rules: readonly AlertRule[]
  private readonly active = new Map<string, Alert>()

  constructor(rules: readonly AlertRule[]) {
    this.rules = rules
  }

  evaluate(input: AlertInput): Evaluation {
    const raised: Alert[] = []
    const cleared: Alert[] = []
    let changed = false

    for (const rule of this.rules) {
      const seen = new Set<string>()
      for (const candidate of rule.evaluate(input)) {
        seen.add(candidate.key)
        const existing = this.active.get(candidate.key)
        if (!existing) {
          const alert: Alert = { ...candidate, ruleId: rule.id, raisedAt: input.now, seenAt: input.now }
          this.active.set(candidate.key, alert)
          raised.push(alert)
          changed = true
          continue
        }
        if (
          existing.title !== candidate.title ||
          existing.detail !== candidate.detail ||
          existing.severity !== candidate.severity
        ) {
          changed = true
        }
        // Replace rather than mutate, so anything holding the old object sees a new one.
        this.active.set(candidate.key, { ...existing, ...candidate, seenAt: input.now })
      }

      for (const [key, alert] of this.active) {
        if (alert.ruleId !== rule.id || seen.has(key)) continue
        if (input.now - alert.seenAt >= rule.clearAfterMs) {
          this.active.delete(key)
          cleared.push(alert)
          changed = true
        }
      }
    }

    const alerts = [...this.active.values()].sort(
      (a, b) => RANK[a.severity] - RANK[b.severity] || b.raisedAt - a.raisedAt,
    )
    return { alerts, raised, cleared, changed }
  }
}

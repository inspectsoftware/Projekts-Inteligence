import { useEffect, useState } from 'react'
import type { Alert, Severity } from '../../shared/alerts/engine'
import { formatAge } from '../lib/format'
import { useMap } from '../map/instance'
import { serverNow } from '../runtime/clock'
import { getEntity } from '../runtime/entityStore'
import { useAlerts } from '../state/alerts'
import { useSelection } from '../state/selection'
import { Panel } from './kit'

const MAX_SHOWN = 4

const BAR: Record<Severity, string> = {
  critical: 'bg-danger animate-pulse',
  warn: 'bg-warn',
  info: 'bg-accent',
}

const TITLE: Record<Severity, string> = {
  critical: 'text-danger',
  warn: 'text-warn',
  info: 'text-accent',
}

/** Re-renders once in a while so "3 min ago" stays true without any new data arriving. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Active alerts, most serious first. Opening one flies to it and selects what it is about. */
export function AlertStack() {
  const map = useMap()
  const active = useAlerts((s) => s.active)
  const select = useSelection((s) => s.select)
  const now = useNow(15_000)

  if (active.length === 0) return null

  const open = (alert: Alert) => {
    if (alert.entityId && getEntity(alert.entityId)) select(alert.entityId)
    if (map && alert.at) {
      map.flyTo({ center: [alert.at.lon, alert.at.lat], zoom: Math.max(map.getZoom(), 7.5), duration: 1400 })
    }
  }

  return (
    <div className="pointer-events-none absolute top-13 left-1/2 z-10 grid w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 gap-1.5 font-mono max-md:top-23 max-md:*:nth-[n+3]:hidden">
      {active.slice(0, MAX_SHOWN).map((alert) => (
        <Panel key={alert.key}>
          <button
            type="button"
            onClick={() => open(alert)}
            title="Show on the map"
            className="flex w-full items-stretch gap-2.5 text-left transition-colors hover:bg-ink-700"
          >
            <span className={`w-1 shrink-0 ${BAR[alert.severity]}`} />
            <span className="min-w-0 flex-1 py-1.5">
              <span className={`block truncate text-[11px] tracking-[0.12em] uppercase ${TITLE[alert.severity]}`}>
                {alert.title}
              </span>
              {alert.detail && <span className="block truncate text-[10.5px] text-fg-dim">{alert.detail}</span>}
            </span>
            <span className="shrink-0 self-center pr-2.5 text-[9.5px] tracking-[0.1em] text-fg-mute uppercase tabular-nums">
              {formatAge(now - alert.raisedAt)}
            </span>
          </button>
        </Panel>
      ))}
      {active.length > MAX_SHOWN && (
        <p className="text-center text-[9.5px] tracking-[0.16em] text-fg-mute uppercase">
          +{active.length - MAX_SHOWN} more
        </p>
      )}
    </div>
  )
}

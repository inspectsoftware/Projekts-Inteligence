import type { Alert, Severity } from '../../shared/alerts/engine'
import { t } from '../i18n'
import { formatAge } from '../lib/format'
import { useMap } from '../map/instance'
import { getEntity } from '../runtime/entityStore'
import { useNow } from '../runtime/useNow'
import { useAlerts } from '../state/alerts'
import { useSelection } from '../state/selection'

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

/** Active alerts, most serious first: the body of the Alerts window. Opening one flies to it and selects what it is about. */
export function AlertStack() {
  const map = useMap()
  const active = useAlerts((s) => s.active)
  const select = useSelection((s) => s.select)
  const now = useNow(15_000)

  if (active.length === 0) return <p className="p-3 text-[11px] text-fg-mute">{t('No active alerts')}</p>

  const open = (alert: Alert) => {
    if (alert.entityId && getEntity(alert.entityId)) select(alert.entityId)
    if (map && alert.at) {
      map.flyTo({ center: [alert.at.lon, alert.at.lat], zoom: Math.max(map.getZoom(), 7.5), duration: 1400 })
    }
  }

  return (
    <ul className="divide-y divide-line">
      {active.map((alert) => (
        <li key={alert.key}>
          <button
            type="button"
            onClick={() => open(alert)}
            title={t('Show on the map')}
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
        </li>
      ))}
    </ul>
  )
}

import { AlertEngine } from '../../shared/alerts/engine'
import { RULES } from '../../shared/alerts/rules'
import { useAlerts } from '../state/alerts'
import { insideLatvia } from './border'
import { serverNow } from './clock'
import { getEntities, getPayload, subscribeEntities } from './entityStore'

/** Entities change up to once a second; alert conditions do not need checking that often. */
const MIN_INTERVAL_MS = 2000
/** Also run on a timer, so alerts are withdrawn even when a feed stops delivering. */
const HEARTBEAT_MS = 15_000

/** Evaluates the alert rules whenever the live data changes. Returns a stop function. */
export function startAlerts(): () => void {
  const engine = new AlertEngine(RULES)
  let lastRun = 0
  let pending: ReturnType<typeof setTimeout> | null = null

  const run = () => {
    pending = null
    lastRun = Date.now()
    const result = engine.evaluate({
      now: serverNow(),
      entities: getEntities,
      warnings: () => getPayload('warnings', 'warnings')?.warnings ?? [],
      insideLatvia,
    })
    if (result.changed) useAlerts.getState().setActive(result.alerts)
  }
  const schedule = () => {
    if (pending) return
    pending = setTimeout(run, Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRun)))
  }

  const unsubscribe = subscribeEntities(schedule)
  const heartbeat = setInterval(schedule, HEARTBEAT_MS)

  return () => {
    unsubscribe()
    clearInterval(heartbeat)
    if (pending) clearTimeout(pending)
    useAlerts.getState().setActive([])
  }
}

import { KEY_ROLES, ROLE_LABEL } from '../../../../shared/data/aircraftRoles'
import { type Aircraft, FEET_TO_M, KNOTS_TO_MS } from '../../../../shared/entity'
import { aircraftLayer } from '../../../layers/aircraft'
import { formatInt } from '../../../lib/format'
import { insideLatvia } from '../../../runtime/border'
import { useFeed } from '../../../runtime/useFeed'
import { airborneMilitary, fromRiga } from './order'
import { Credits, TrackRow } from './parts'

/** Military aircraft in the air across the region, the ones that say most about posture first. */
export function AirTab() {
  // Polled for as long as the tab is shown, whether or not the aircraft layer is on.
  const feed = useFeed('aircraft', 'entities')
  if (!feed) return <p className="text-fg-mute">Waiting for data…</p>
  const aircraft = airborneMilitary(feed.entities as Aircraft[])

  return (
    <>
      {aircraft.length === 0 ? (
        <p className="text-fg-mute">No military aircraft are broadcasting in the region right now.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {aircraft.map((a) => {
            const { role, type, description } = a.props
            const inside = insideLatvia(a.lon, a.lat)
            return (
              <TrackRow
                key={a.id}
                entity={a}
                layer={aircraftLayer}
                title={a.label ?? a.props.hex.toUpperCase()}
                kind={[type, role ? ROLE_LABEL[role] : 'role unknown'].filter(Boolean).join(' · ')}
                tone={role && KEY_ROLES.has(role) ? 'mil' : 'plain'}
                detail={[
                  a.alt !== undefined && `${formatInt(a.alt / FEET_TO_M)} ft`,
                  a.spd !== undefined && `${formatInt(a.spd / KNOTS_TO_MS)} kt`,
                  description,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                where={inside ? 'Over Latvia' : fromRiga(a)}
                inside={inside}
              />
            )
          })}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-fg-mute">
        Only aircraft that broadcast their position. Russian and Belarusian combat aircraft do not, and will not appear.
      </p>
      <Credits feed="aircraft" />
    </>
  )
}

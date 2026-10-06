import { type Ship, inLatvianWaters } from '../../../../shared/adapters/ships'
import { Flag, KNOTS_TO_MS } from '../../../../shared/entity'
import { t } from '../../../i18n'
import { shipsLayer } from '../../../layers/ships'
import { insideLatvia } from '../../../runtime/border'
import { useFeed } from '../../../runtime/useFeed'
import { SectionTitle } from '../../kit'
import { rigaOffset, vesselsOfInterest } from './order'
import { Credits, TrackRow } from './parts'

/** "Navy", "Government", "Sanctioned" or "Shadow fleet", then the flag the MMSI gives. */
function kindOf(ship: Ship): string {
  const { service, flagState } = ship.props
  const what =
    service === 'navy'
      ? t('Navy')
      : service === 'government'
        ? t('Government')
        : (ship.flags & Flag.SANCTIONED) !== 0
          ? t('Sanctioned')
          : t('Shadow fleet')
  return `${what} · ${flagState ? t(flagState) : t('flag unknown')}`
}

function Group({ title, ships, tone }: { title: string; ships: Ship[]; tone: 'mil' | 'danger' }) {
  return (
    <section className="mb-3">
      <SectionTitle>{title}</SectionTitle>
      {ships.length === 0 ? (
        <p className="text-fg-mute">{t('None broadcasting in the watched waters.')}</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {ships.map((ship) => {
            const { props } = ship
            // The sea out to the edge of the economic zone, or a harbour or river inside the land border.
            const inside = inLatvianWaters(ship.lon, ship.lat) || insideLatvia(ship.lon, ship.lat)
            return (
              <TrackRow
                key={ship.id}
                entity={ship}
                layer={shipsLayer}
                title={props.name ?? `MMSI ${props.mmsi}`}
                kind={kindOf(ship)}
                tone={tone}
                detail={[
                  props.status && t(props.status),
                  `${((ship.spd ?? 0) / KNOTS_TO_MS).toFixed(1)} kn`,
                  props.destination && t('bound for {port}', { port: props.destination }),
                  props.listedAs && t('listed as {name}', { name: props.listedAs }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                where={inside ? t('Latvian waters') : t('{km} km {compass} of Rīga', rigaOffset(ship))}
                inside={inside}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** States' own vessels, then those on a sanctions or shadow-fleet list, across the watched waters. */
export function SeaTab() {
  // Polled for as long as the tab is shown, whether or not the ships layer is on.
  const feed = useFeed('ships', 'entities')
  if (!feed) return <p className="text-fg-mute">{t('Waiting for data…')}</p>
  const ships = feed.entities as Ship[]
  const { state, listed } = vesselsOfInterest(ships)
  // AISStream only delivers when the server has a key for it.
  const fullCoverage = ships.some((ship) => ship.props.source === 'aisstream')

  return (
    <>
      <Group title={t('Navy and government')} ships={state} tone="mil" />
      <Group title={t('Sanctioned and shadow fleet')} ships={listed} tone="danger" />
      <p className="text-[10px] text-fg-mute">
        {!fullCoverage &&
          t('Only the northern approaches are covered, from the Irbe Strait towards the Gulf of Finland: the open Finnish receivers reach no further, and the rest needs an AISStream key.') + ' '}
        {t('Warships often sail with AIS switched off, so an empty list proves nothing.')}
      </p>
      <Credits feed="ships" />
    </>
  )
}

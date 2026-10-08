import { useState } from 'react'
import type { Train } from '../../../shared/adapters/trains'
import type { TransitMode, TransitVehicle } from '../../../shared/adapters/transit'
import { t } from '../../i18n'
import { trainsLayer } from '../../layers/trains'
import { MODE_LABEL, transitLayer } from '../../layers/transit'
import { formatInt } from '../../lib/format'
import { useFeed } from '../../runtime/useFeed'
import { isLayerOn, useLayers } from '../../state/layers'
import { Segmented } from '../kit'
import { Credits, TrackRow } from './military/parts'

const TABS = [
  { id: 'trains', label: t('Trains'), hint: t('Passenger trains in Latvia') },
  { id: 'bus', label: t('Buses'), hint: t('City and regional buses') },
  { id: 'rail', label: t('Trams'), hint: t('Trams and trolleybuses') },
  { id: 'minibus', label: t('Minibuses'), hint: t('Minibuses on fixed routes') },
] as const
type Tab = (typeof TABS)[number]['id']

const MODES: Record<Exclude<Tab, 'trains'>, readonly TransitMode[]> = { bus: ['bus'], rail: ['tram', 'trolleybus'], minibus: ['minibus'] }

/** A long list is no use in a window this size, and a town's whole fleet would be one. */
const MAX_ROWS = 150

const speed = (spd: number | undefined) => `${formatInt((spd ?? 0) * 3.6)} km/h`

function ShownSwitch({ on, count, onToggle }: { on: boolean; count: number; onToggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="mb-2 flex w-full items-center gap-2 px-1 py-1 text-left tracking-[0.12em] uppercase transition-colors hover:bg-ink-700"
    >
      <span className={`h-2.5 w-2.5 shrink-0 border border-accent ${on ? 'bg-accent' : ''}`} />
      <span className={on ? 'text-fg' : 'text-fg-mute'}>{on ? t('Shown on the map') : t('Hidden on the map')}</span>
      <span className="ml-auto text-fg tabular-nums">{count}</span>
    </button>
  )
}

function TrainsTab() {
  const feed = useFeed('trains', 'entities')
  const visible = useLayers((s) => s.visible)
  const toggle = useLayers((s) => s.toggle)
  if (!feed) return <p className="text-fg-mute">{t('Waiting for data…')}</p>
  const trains = (feed.entities as Train[]).toSorted((a, b) => a.props.number.localeCompare(b.props.number, undefined, { numeric: true }))
  return (
    <>
      <ShownSwitch
        on={isLayerOn(visible, trainsLayer.id, trainsLayer.defaultOn)}
        count={trains.length}
        onToggle={() => toggle(trainsLayer.id, trainsLayer.defaultOn)}
      />
      <ul className="divide-y divide-line/50">
        {trains.slice(0, MAX_ROWS).map((train) => (
          <TrackRow
            key={train.id}
            entity={train}
            layer={trainsLayer}
            title={t('Train {number}', { number: train.props.number })}
            kind={train.props.gps ? '' : t('estimated')}
            tone="warn"
            detail={[train.props.route, train.props.nextStop && `→ ${train.props.nextStop} ${train.props.nextStopTime ?? ''}`].filter(Boolean).join(' · ')}
            where={speed(train.spd)}
            inside={false}
          />
        ))}
      </ul>
      <Credits feed="trains" />
    </>
  )
}

function TransitTab({ modes }: { modes: readonly TransitMode[] }) {
  const feed = useFeed('transit', 'entities')
  const visible = useLayers((s) => s.visible)
  const hidden = useLayers((s) => s.hiddenModes)
  if (!feed) return <p className="text-fg-mute">{t('Waiting for data…')}</p>
  const vehicles = (feed.entities as TransitVehicle[])
    .filter((vehicle) => modes.includes(vehicle.props.mode))
    // In service first, then by route as a timetable lists them.
    .toSorted((a, b) => Number(!a.props.route) - Number(!b.props.route) || (a.props.route ?? '').localeCompare(b.props.route ?? '', undefined, { numeric: true }))
  const layerOn = isLayerOn(visible, transitLayer.id, transitLayer.defaultOn)
  const on = layerOn && modes.some((mode) => !hidden[mode])
  const toggle = () => {
    const { toggle: toggleLayer, setModeHidden } = useLayers.getState()
    for (const mode of modes) setModeHidden(mode, on)
    // Showing a kind while the whole layer is off has to switch the layer on as well.
    if (!on && !layerOn) toggleLayer(transitLayer.id, transitLayer.defaultOn)
  }
  return (
    <>
      <ShownSwitch on={on} count={vehicles.length} onToggle={toggle} />
      {vehicles.length === 0 && <p className="text-fg-mute">{t('No operator is publishing live positions for these right now.')}</p>}
      <ul className="divide-y divide-line/50">
        {vehicles.slice(0, MAX_ROWS).map((vehicle) => (
          <TrackRow
            key={vehicle.id}
            entity={vehicle}
            layer={transitLayer}
            title={vehicle.props.route ? t('Route {route}', { route: vehicle.props.route }) : t('Not in service')}
            kind={MODE_LABEL[vehicle.props.mode]}
            tone="plain"
            detail={[vehicle.props.network, vehicle.props.vehicle].filter(Boolean).join(' · ')}
            where={speed(vehicle.spd)}
            inside={false}
          />
        ))}
      </ul>
      <Credits feed="transit" />
    </>
  )
}

/** Every vehicle with a public live position, one kind at a time, each kind shown or hidden on the map by itself. */
export function TransportWindow() {
  const [tab, setTab] = useState<Tab>('trains')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2">
        <Segmented<Tab> label={t('Kind of transport')} value={tab} options={TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px]">
        {tab === 'trains' ? <TrainsTab /> : <TransitTab key={tab} modes={MODES[tab]} />}
        <p className="mt-2 text-[10px] text-fg-mute">
          {t('Taxis and ticketing apps are not here: none of them publishes vehicle positions. Rīga’s own buses and trams are missing for the same reason.')}
        </p>
      </div>
    </div>
  )
}

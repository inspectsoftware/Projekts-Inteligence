import type { Advisory } from '../../../../shared/feeds'
import { t } from '../../../i18n'
import { ADVISORY_LABEL, ADVISORY_TONE, countryPoint, dangerLayer, loadWorld } from '../../../layers/danger'
import { getMap } from '../../../map/instance'
import { useFeed } from '../../../runtime/useFeed'
import { isLayerOn, useLayers } from '../../../state/layers'
import { Credits } from './parts'

/** Switches the map colouring on and flies to the country, where its outline is known. */
async function show(advisory: Advisory): Promise<void> {
  const { visible, toggle } = useLayers.getState()
  if (!isLayerOn(visible, dangerLayer.id, dangerLayer.defaultOn)) toggle(dangerLayer.id, dangerLayer.defaultOn)
  const point = countryPoint(await loadWorld(), advisory.name)?.properties
  if (point) getMap()?.flyTo({ center: [point.lon, point.lat], zoom: 4, duration: 2200 })
}

/** Every country a foreign ministry warns against, the strongest warnings first. */
export function DangerTab() {
  const feed = useFeed('advisories', 'advisories')
  if (!feed) return <p className="text-fg-mute">{t('Waiting for data…')}</p>
  const warned = feed.countries.filter((advisory) => advisory.level > 0)

  return (
    <>
      <p className="mb-2 text-[10px] text-fg-mute">
        {t('Travel advice of the UK Foreign Office, by country. It is one government’s judgement, not a record of fighting; announced firing areas and closed airspace are under Zones.')}
      </p>
      <ul className="divide-y divide-line/50">
        {warned.map((advisory) => (
          <li key={advisory.name}>
            <button
              type="button"
              title={t('Show on the map')}
              onClick={() => void show(advisory)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-1 py-1 text-left transition-colors hover:bg-ink-700"
            >
              <span className="truncate text-fg">{advisory.name}</span>
              <span className={`text-right text-[10px] ${ADVISORY_TONE[advisory.level]}`}>{ADVISORY_LABEL[advisory.level]}</span>
              {advisory.note && <span className="col-span-2 truncate text-[10px] text-fg-dim">{advisory.note}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Credits feed="advisories" />
    </>
  )
}

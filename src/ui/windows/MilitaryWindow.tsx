import { useState } from 'react'
import { t } from '../../i18n'
import { Segmented } from '../kit'
import { AirTab } from './military/AirTab'
import { DangerTab } from './military/DangerTab'
import { SeaTab } from './military/SeaTab'
import { SitesTab } from './military/SitesTab'
import { ZonesTab } from './military/ZonesTab'

const TABS = [
  { id: 'air', label: t('Air'), hint: t('Military aircraft in the region right now') },
  { id: 'sea', label: t('Sea'), hint: t('Naval, government and sanctioned vessels') },
  { id: 'zones', label: t('Zones'), hint: t('Firing areas, navigational warnings and closed airspace in force') },
  { id: 'sites', label: t('Sites'), hint: t('Bases, allied battlegroups and training areas') },
  { id: 'danger', label: t('Danger'), hint: t('Countries a foreign ministry warns against travelling to') },
] as const
type Tab = (typeof TABS)[number]['id']

/** Everything military in one place. Each tab polls only what it shows. */
export function MilitaryWindow() {
  const [tab, setTab] = useState<Tab>('air')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2">
        <Segmented<Tab> label={t('Military tracker')} value={tab} options={TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px]">
        {tab === 'air' && <AirTab />}
        {tab === 'sea' && <SeaTab />}
        {tab === 'zones' && <ZonesTab />}
        {tab === 'sites' && <SitesTab />}
        {tab === 'danger' && <DangerTab />}
      </div>
    </div>
  )
}

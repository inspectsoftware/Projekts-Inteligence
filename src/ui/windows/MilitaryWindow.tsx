import { useState } from 'react'
import { Segmented } from '../kit'
import { AirTab } from './military/AirTab'
import { SeaTab } from './military/SeaTab'
import { SitesTab } from './military/SitesTab'
import { ZonesTab } from './military/ZonesTab'

const TABS = [
  { id: 'air', label: 'Air', hint: 'Military aircraft in the region right now' },
  { id: 'sea', label: 'Sea', hint: 'Naval, government and sanctioned vessels' },
  { id: 'zones', label: 'Zones', hint: 'Firing areas, navigational warnings and closed airspace in force' },
  { id: 'sites', label: 'Sites', hint: 'Bases, allied battlegroups and training areas' },
] as const
type Tab = (typeof TABS)[number]['id']

/** Everything military in one place. Each tab polls only what it shows. */
export function MilitaryWindow() {
  const [tab, setTab] = useState<Tab>('air')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2">
        <Segmented<Tab> label="Military tracker" value={tab} options={TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px]">
        {tab === 'air' && <AirTab />}
        {tab === 'sea' && <SeaTab />}
        {tab === 'zones' && <ZonesTab />}
        {tab === 'sites' && <SitesTab />}
      </div>
    </div>
  )
}

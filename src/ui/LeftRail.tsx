import { useState } from 'react'
import { BASE_MODES } from '../map/basemaps'
import { VIEWS, flyHome, flyToView } from '../map/camera'
import { useMap } from '../map/instance'
import { VISION_MODES, useUi } from '../state/ui'
import { LayerTree } from './LayerTree'
import { Panel, SectionTitle, Segmented } from './kit'

export function LeftRail() {
  const map = useMap()
  const base = useUi((s) => s.base)
  const vision = useUi((s) => s.vision)
  const setBase = useUi((s) => s.setBase)
  const setVision = useUi((s) => s.setVision)
  // Only matters on narrow screens, where the rail would otherwise cover the map.
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="pointer-events-auto absolute top-13 left-3 z-30 border border-line bg-ink-850 px-2 py-1.5 font-mono text-[10px] tracking-[0.16em] text-fg-dim uppercase md:hidden"
      >
        {open ? 'Close' : 'Layers'}
      </button>
      <aside
        className={`pointer-events-none absolute bottom-14 left-3 w-60 flex-col gap-3 font-mono max-md:top-23 max-md:z-30 md:top-13 md:z-10 md:flex ${open ? 'flex' : 'hidden'}`}
      >
      <Panel className="min-h-0 shrink overflow-y-auto p-3">
        <LayerTree />
      </Panel>

      <Panel className="shrink-0 p-3">
        <SectionTitle>Base</SectionTitle>
        <Segmented label="Basemap" value={base} options={BASE_MODES} onChange={setBase} />
        <div className="h-3" />
        <SectionTitle>Vision</SectionTitle>
        <Segmented label="Vision mode" value={vision} options={VISION_MODES} onChange={setVision} />
      </Panel>

      <Panel className="min-h-0 shrink overflow-y-auto p-3">
        <SectionTitle>Views</SectionTitle>
        <ul className="grid grid-cols-2 gap-px bg-line p-px">
          <li className="col-span-2">
            <button
              type="button"
              disabled={!map}
              onClick={() => map && flyHome(map)}
              className="w-full bg-ink-850 px-2 py-1.5 text-left text-[10px] tracking-[0.16em] text-fg uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40"
            >
              Latvia overview
            </button>
          </li>
          {VIEWS.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                disabled={!map}
                onClick={() => map && flyToView(map, view)}
                className="w-full truncate bg-ink-850 px-2 py-1.5 text-left text-[10px] tracking-[0.12em] text-fg-dim uppercase transition-colors hover:bg-ink-700 hover:text-accent disabled:opacity-40"
              >
                {view.label}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      </aside>
    </>
  )
}

import { BASE_MODES, zoomCeiling } from '../../map/basemaps'
import { VISION_MODES, useUi } from '../../state/ui'
import { SectionTitle, Segmented } from '../kit'

/** What the map is drawn on, and the filter it is seen through. */
export function DisplayWindow() {
  const base = useUi((s) => s.base)
  const vision = useUi((s) => s.vision)
  const setBase = useUi((s) => s.setBase)
  const setVision = useUi((s) => s.setVision)

  return (
    <div className="p-3">
      <SectionTitle>Base</SectionTitle>
      <Segmented label="Basemap" value={base} options={BASE_MODES} onChange={setBase} />
      {/* Zooming past what a base can resolve only enlarges its pixels, so say where that is. */}
      <p className="mt-2 text-[10px] text-fg-mute">
        {BASE_MODES.find((mode) => mode.id === base)?.detail} Zoom limit {zoomCeiling(base)}.
      </p>
      <div className="h-3" />
      <SectionTitle>Vision</SectionTitle>
      <Segmented label="Vision mode" value={vision} options={VISION_MODES} onChange={setVision} />
    </div>
  )
}

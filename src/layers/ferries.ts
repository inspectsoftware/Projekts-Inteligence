import type { Color } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import type { Ship } from '../../shared/adapters/ships'
import { t } from '../i18n'
import { getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { isLayerOn, useLayers } from '../state/layers'
import { HALO, LABEL_FONT, OUTLINE, SELECTED, iconScale, memoLast, selectionRing } from './common'
import type { LayerDef } from './types'

/**
 * The ferries to Helsinki, Stockholm and Germany and the boats on the rivers, out of the ships'
 * AIS feed: only what carries passengers, named, for anyone who wants to see their boat come in.
 * Who the rest of the shipping is stays in the Ships layer. Clicking one opens the same card.
 */
const FERRY: Color = [64, 132, 230]

const passengers = memoLast((ships: Ship[]) => ships.filter((ship) => ship.props.type === 'passenger'))

export const ferriesLayer: LayerDef = {
  id: 'ferries',
  group: 'sea',
  label: t('Ferries and passenger boats'),
  hint: t('Ferries and passenger boats broadcasting AIS. Without an AISStream key only the Gulf of Finland and the northern approaches are covered'),
  defaultOn: false,
  swatch: '#4084e6',
  feeds: ['ships'],

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    // With all shipping shown, these are already drawn there.
    if (isLayerOn(useLayers.getState().visible, 'ships', false)) return []
    const data = passengers(getEntities('ships') as Ship[])
    const { canvas, mapping } = getIconAtlas()
    // Small from afar, as buses are: a ferry is a speck on the Gulf until a harbour fills the screen.
    const scale = iconScale(zoom) * Math.min(1, Math.max(0.45, 0.45 + ((zoom - 6) / 5) * 0.55))
    const highlight = `${selectedId}|${hoveredId}`
    const icons = {
      data,
      iconAtlas: canvas as unknown as string,
      iconMapping: mapping,
      getIcon: () => 'ship' as const,
      getPosition: (ship: Ship) => positionAt(ship, now),
      getAngle: (ship: Ship) => -(ship.trk ?? 0),
      getSize: 18,
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now },
    }
    return [
      new IconLayer<Ship>({ ...icons, id: 'ferries-halo', getSize: 18 + 2.5 / scale, getColor: HALO }),
      new IconLayer<Ship>({
        ...icons,
        id: 'ferries',
        pickable: true,
        getColor: (ship) => (ship.id === selectedId || ship.id === hoveredId ? SELECTED : FERRY),
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      selectionRing('ferries-selection', data.filter((ship) => ship.id === selectedId), now, 17, scale),
      new TextLayer<Ship>({
        id: 'ferries-labels',
        data,
        // Few enough to name from far out: "Megastar", "Isabelle".
        visible: fontsReady && zoom >= 6.5,
        getText: (ship) => ship.props.name ?? '',
        getPosition: (ship) => positionAt(ship, now),
        getSize: 11,
        getColor: [...FERRY, 240] as Color,
        getPixelOffset: [13, 0],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 600,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getPosition: now },
      }),
    ]
  },
}

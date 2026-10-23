import type { Color } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../../shared/entity'
import { positionAt } from '../map/motion'
import type { LayerContext } from './types'

export const LABEL_FONT = '"JetBrains Mono Variable", ui-monospace, monospace'
export const HALO: Color = [4, 7, 10, 215]
export const SELECTED: Color = [255, 255, 255]
export const OUTLINE: Color = [4, 7, 10, 255]

/**
 * Keeps the last result for as long as it is asked with the same objects. A layer handed a new
 * array is recomputed whole by deck.gl (every position, colour and label glyph), so data worked
 * out in build() must stay the same array until the entities it comes from change.
 */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: A | null = null
  let result: R
  return (...args) => {
    if (!last || args.length !== last.length || args.some((arg, i) => arg !== last![i])) {
      last = args
      result = fn(...args)
    }
    return result
  }
}

/** Icons grow a little as the camera closes in, within sensible limits. */
export function iconScale(zoom: number): number {
  return Math.min(1.5, Math.max(0.75, 0.75 + (zoom - 5.5) * 0.11))
}

/** The ring drawn around whichever entity is selected. */
export function selectionRing<T extends Entity>(id: string, selected: T[], now: number, radius: number, scale: number) {
  return new ScatterplotLayer<T>({
    id,
    data: selected,
    getPosition: (entity) => positionAt(entity, now),
    getRadius: radius,
    radiusUnits: 'pixels',
    radiusScale: scale,
    filled: false,
    stroked: true,
    getLineColor: [79, 214, 255, 230],
    getLineWidth: 1.5,
    lineWidthUnits: 'pixels',
    updateTriggers: { getPosition: now },
  })
}

/** Fixed things drawn as dots, with a ring around the selected one. */
export function dots<T extends Entity>(id: string, data: T[], colorOf: (entity: T) => Color, radius: number, ctx: LayerContext) {
  const highlight = `${ctx.selectedId}|${ctx.hoveredId}`
  return [
    new ScatterplotLayer<T>({
      id,
      data,
      pickable: true,
      getPosition: (entity) => [entity.lon, entity.lat],
      getRadius: radius,
      radiusUnits: 'pixels',
      getFillColor: (entity) => (entity.id === ctx.selectedId || entity.id === ctx.hoveredId ? SELECTED : colorOf(entity)),
      getLineColor: OUTLINE,
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      stroked: true,
      updateTriggers: { getFillColor: highlight },
    }),
    selectionRing(
      `${id}-selection`,
      data.filter((entity) => entity.id === ctx.selectedId),
      ctx.now,
      12,
      iconScale(ctx.zoom),
    ),
  ]
}

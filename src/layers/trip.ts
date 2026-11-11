import type { Color, Layer } from '@deck.gl/core'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { TripAnswer } from '../../shared/adapters/transit'
import { useTrip } from '../runtime/trip'
import { currentMapTheme } from '../state/ui'

type Stop = TripAnswer['stops'][number] & { passed: boolean }

/** The edge of the line and the face of its stops: white on the light map; on the dark one, dark, so the route does not glare. */
const PAINT: Record<'light' | 'dark', { casing: Color; stop: Color; passedStop: Color; passed: Color; line: number }> = {
  light: { casing: [255, 255, 255, 230], stop: [255, 255, 255], passedStop: [220, 220, 220], passed: [150, 150, 150], line: 235 },
  dark: { casing: [8, 11, 14, 235], stop: [22, 26, 30], passedStop: [44, 48, 52], passed: [110, 114, 118], line: 200 },
}

/**
 * The selected vehicle's route under it, as a city map shows it: the line it follows in the
 * vehicle's colour and every stop on it as a ring, those already passed in grey.
 * Nothing until its trip has come back from /api/trip. `width`: the line's, in pixels.
 */
export function tripLayers(selectedId: string | null, color: Color, width = 5): Layer[] {
  const { id, answer } = useTrip.getState()
  if (!answer || !selectedId || id !== selectedId) return []
  const [r, g, b] = color
  const theme = currentMapTheme()
  const paint = PAINT[theme]
  const stops: Stop[] = answer.stops.map((stop, i) => ({ ...stop, passed: i < answer.next }))
  return [
    new PathLayer<[number, number][]>({
      id: 'trip-line-casing',
      data: [answer.shape],
      getPath: (path) => path,
      getColor: paint.casing,
      updateTriggers: { getColor: theme },
      getWidth: width + 2,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
    new PathLayer<[number, number][]>({
      id: 'trip-line',
      data: [answer.shape],
      getPath: (path) => path,
      getColor: [r, g, b, paint.line],
      updateTriggers: { getColor: `${theme}|${r},${g},${b}` },
      getWidth: width,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
    new ScatterplotLayer<Stop>({
      id: 'trip-stops',
      data: stops,
      getPosition: (stop) => [stop.lon, stop.lat],
      getRadius: Math.max(3.5, width - 0.5),
      radiusUnits: 'pixels',
      stroked: true,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      getFillColor: (stop) => (stop.passed ? paint.passedStop : paint.stop),
      getLineColor: (stop) => (stop.passed ? paint.passed : [r, g, b]),
      updateTriggers: { getFillColor: `${answer.next}|${theme}`, getLineColor: `${answer.next}|${theme}` },
    }),
  ]
}

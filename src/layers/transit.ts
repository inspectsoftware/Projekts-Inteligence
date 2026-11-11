import type { Color } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import type { TransitMode, TransitVehicle } from '../../shared/adapters/transit'
import type { Entity } from '../../shared/entity'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { type VehicleIcon, getIconAtlas, vehicleFill } from '../map/icons'
import { headingAt, positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { useLayers } from '../state/layers'
import { HALO, LABEL_FONT, SELECTED, iconScale, memoLast, selectionRing } from './common'
import { PIN_ZOOM, pinLayer, pinPx } from './pins'
import { vehiclesIn3d } from '../map/threeD'
import { tripLayers } from './trip'
import type { InspectorModel, LayerDef } from './types'

const MODE_COLOR: Record<TransitMode, Color> = {
  bus: [255, 196, 96],
  tram: [255, 128, 170],
  trolleybus: [126, 200, 255],
  minibus: [214, 214, 130],
}

export const MODE_LABEL: Record<TransitMode, string> = {
  bus: t('Bus'),
  tram: t('Tram'),
  trolleybus: t('Trolleybus'),
  minibus: t('Minibus'),
}

/** Route numbers only become readable once a few streets fill the screen; further out a big city's fleet would bury the map in them. */
const LABEL_ZOOM = 13.5
/** The room one route number takes on screen, in pixels: a second one inside it is left out. */
const LABEL_CELL = { w: 40, h: 22 }

/**
 * The vehicles that get a route number at this zoom: none further out than LABEL_ZOOM, and closer
 * in at most one per label-sized patch of screen, so the tags never pile up into an unreadable
 * stack. The selected and hovered vehicles always keep theirs, and are placed first.
 */
export function labelled(data: readonly TransitVehicle[], zoom: number, keep: readonly (string | null)[]): TransitVehicle[] {
  const kept = data.filter((vehicle) => keep.includes(vehicle.id))
  if (zoom < LABEL_ZOOM) return kept
  const mpp = metresPerPixel(zoom)
  const dLat = (LABEL_CELL.h * mpp) / 111_320
  const dLon = (LABEL_CELL.w * mpp) / (111_320 * Math.cos((56.5 * Math.PI) / 180))
  const taken = new Set<string>()
  const placed = new Set<string>()
  const out: TransitVehicle[] = []
  for (const vehicle of [...kept, ...data]) {
    if (!vehicle.label || placed.has(vehicle.id)) continue
    const cell = `${Math.floor(vehicle.lon / dLon)},${Math.floor(vehicle.lat / dLat)}`
    if (taken.has(cell)) continue
    taken.add(cell)
    placed.add(vehicle.id)
    out.push(vehicle)
  }
  return out
}

/** labelled(), worked out again only when the vehicles, the highlight or the zoom (to a quarter step) change, not every frame. */
const labelledOnce = memoLast((data: TransitVehicle[], zoomStep: number, selectedId: string | null, hoveredId: string | null) =>
  labelled(data, zoomStep / 4, [selectedId, hoveredId]),
)

/** The vehicles of the modes being shown; the selected one whatever its mode, as it was asked for by name. */
const shownVehicles = memoLast((all: TransitVehicle[], hiddenModes: Record<string, boolean>, selectedId: string | null) =>
  all.filter((vehicle) => !hiddenModes[vehicle.props.mode] || vehicle.id === selectedId),
)

function describe(entity: Entity, now: number): InspectorModel {
  const vehicle = entity as TransitVehicle
  const { props } = vehicle
  const rows: InspectorModel['rows'] = [{ label: t('Network'), value: props.network }]
  if (props.vehicle) rows.push({ label: t('Vehicle'), value: props.vehicle })
  rows.push({ label: t('Speed'), value: `${formatInt((vehicle.spd ?? 0) * 3.6)} km/h` })
  if (vehicle.trk !== undefined && (vehicle.spd ?? 0) > 0.5) rows.push({ label: t('Heading'), value: formatBearing(vehicle.trk) })
  rows.push({ label: t('Position'), value: `${formatLat(vehicle.lat)}  ${formatLon(vehicle.lon)}` })
  if (!props.scheduled) rows.push({ label: t('Last update'), value: formatAge(now - vehicle.ts) })

  return {
    kicker: MODE_LABEL[props.mode],
    title: props.route ? t('Route {route}', { route: props.route }) : t('Not in service'),
    subtitle: props.network,
    // A town that does not publish its vehicles: shown where the timetable has it, and said so.
    badges: props.scheduled ? [{ text: t('Timetable, not live'), tone: 'info' }] : props.route ? [] : [{ text: t('No route'), tone: 'info' }],
    rows,
    links: TIMETABLE_SITES[props.network] ? [{ label: t('Timetables'), href: TIMETABLE_SITES[props.network] }] : [],
  }
}

/**
 * Each network's own timetable pages. By town: marsruti.lv's front page sends visitors on to
 * Vilnius, so a Liepāja bus has to link to marsruti.lv/liepaja itself.
 */
const TIMETABLE_SITES: Readonly<Record<string, string>> = {
  'Rīga': 'https://saraksti.lv/',
  'Liepāja': 'https://marsruti.lv/liepaja/',
  'Rēzekne': 'https://marsruti.lv/rezekne/',
  'Regional buses': 'https://marsruti.lv/LSA/',
  'Tallinn': 'https://transport.tallinn.ee/',
  'Vilnius': 'https://www.stops.lt/vilnius/',
  'Kaunas': 'https://www.stops.lt/kaunas/',
  'Klaipėda': 'https://www.stops.lt/klaipeda/',
  'Panevėžys': 'https://www.stops.lt/panevezys/',
  'Alytus': 'https://www.stops.lt/alytus/',
  'Druskininkai': 'https://www.stops.lt/druskininkai/',
  'Druskininkai and Alytus region': 'https://www.stops.lt/druskininkai/',
  'Tauragė region': 'https://www.stops.lt/taurage/',
  'Tartu': 'https://www.peatus.ee/',
  'Pärnu': 'https://www.peatus.ee/',
  'Narva': 'https://www.peatus.ee/',
  'Kohtla-Järve': 'https://www.peatus.ee/',
  'Rakvere': 'https://www.peatus.ee/',
  'Daugavpils': 'https://satiksme.daugavpils.lv/',
  'Jelgava': 'https://www.jap.lv/',
  'Jūrmala': 'https://gsvalbe.id.lv/pieturas/',
  'Valmiera': 'https://gsvalbe.id.lv/pieturas/',
  'Ventspils': 'https://gsvalbe.id.lv/pieturas/',
  'Jēkabpils': 'https://gsvalbe.id.lv/pieturas/',
  'Šiauliai': 'https://www.stops.lt/siauliai/',
  'Harju County': 'https://www.peatus.ee/',
  'Läänemaa and Saaremaa': 'https://www.peatus.ee/',
  'Marijampolė': 'https://www.visimarsrutai.lt/',
  'Kėdainiai district': 'https://www.visimarsrutai.lt/',
  'Jonava district': 'https://www.visimarsrutai.lt/',
  'Plungė district': 'https://www.visimarsrutai.lt/',
  'Telšiai district': 'https://www.visimarsrutai.lt/',
  'Vilnius district': 'https://www.visimarsrutai.lt/',
  'Alytus district': 'https://www.visimarsrutai.lt/',
  'Varėna district': 'https://www.visimarsrutai.lt/',
  'Lazdijai district': 'https://www.visimarsrutai.lt/',
  'Lithuanian intercity buses': 'https://www.visimarsrutai.lt/',
  'Palanga': 'https://www.visimarsrutai.lt/',
  'Visaginas': 'https://www.visimarsrutai.lt/',
  'Neringa': 'https://www.visimarsrutai.lt/',
  'Mažeikiai district': 'https://www.visimarsrutai.lt/',
  'Ukmergė district': 'https://www.visimarsrutai.lt/',
  'Utena district': 'https://www.visimarsrutai.lt/',
  'Rokiškis district': 'https://www.visimarsrutai.lt/',
  'Biržai district': 'https://www.visimarsrutai.lt/',
  'Kretinga district': 'https://www.visimarsrutai.lt/',
  'Radviliškis district': 'https://www.visimarsrutai.lt/',
  'Anykščiai district': 'https://www.visimarsrutai.lt/',
  'Elektrėnai': 'https://www.visimarsrutai.lt/',
}

/** Metres right of its line a vehicle is drawn: traffic keeps right here, so the two directions on one street part, each on its own side. */
const LANE_M = 1.8

/** Where a vehicle is drawn: gliding between its fixes (see positionAt), moved onto its side of the street. */
export function onLane(vehicle: TransitVehicle, now: number): [number, number] {
  const [lon, lat] = positionAt(vehicle, now)
  // Matched to the streets on the server, it is in its lane already.
  if (vehicle.props.lane) return [lon, lat]
  const trk = headingAt(vehicle, now)
  if (trk === undefined) return [lon, lat]
  const right = ((trk + 90) * Math.PI) / 180
  const east = (Math.sin(right) * LANE_M) / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lon + east, lat + (Math.cos(right) * LANE_M) / 111_320]
}


/**
 * Vehicles shrink to dots as the camera pulls back, the way a city map does: from zoom 14 down to 9
 * their icons go from full size to a fifth of it, so a whole city's fleet reads as a sprinkle
 * rather than a blot. On top of the zoom growth every icon has.
 */
export function transitShrink(zoom: number): number {
  return Math.min(1, Math.max(0.2, 0.2 + ((zoom - 9) / 5) * 0.8))
}

/** Each kind's icon (map/icons.ts) and its real length, for drawing it to scale close in. */
const VEHICLE: Record<TransitMode, { icon: VehicleIcon; metres: number }> = {
  bus: { icon: 'bus', metres: 12 },
  trolleybus: { icon: 'trolleybus', metres: 12 },
  // Drawn a little longer than a bus rather than at a tram's full 30 m, which close in would bury the street.
  tram: { icon: 'tram', metres: 15 },
  minibus: { icon: 'minibus', metres: 7 },
}
/** The icon's size as a marker, before the zoom scales it. */
const ICON = 14

/** Metres per CSS pixel at the Baltic's middle latitude: within a few per cent from Vilnius to Tallinn. */
const metresPerPixel = (zoom: number) => (40_075_016.686 * Math.cos((56.5 * Math.PI) / 180)) / (512 * 2 ** zoom)

/**
 * How tall a vehicle's icon is drawn, in pixels, from its icon size in the atlas units, its real length
 * and how much of the icon its outline fills. Further out it is a marker (transitShrink); close in,
 * where a marker would be lost beside the buildings, it is drawn at the vehicle's real
 * length on the street, as city maps do, and keeps growing with the map.
 */
export function vehicleIconPx(zoom: number, icon: number, metres: number, fill: number): number {
  return Math.max(icon * iconScale(zoom) * transitShrink(zoom), metres / metresPerPixel(zoom) / fill)
}

/** vehicleIconPx for a bus, tram, trolleybus or minibus. */
export function transitIconPx(zoom: number, mode: TransitMode = 'bus'): number {
  const { icon, metres } = VEHICLE[mode]
  return vehicleIconPx(zoom, ICON, metres, vehicleFill(icon))
}

/**
 * The dark edge round an icon this many pixels long, in pixels a side: a hairline on a small
 * silhouette, enough to part it from a road of the same colour without ringing it in black; on a
 * detailed one also what shows through its windows, never more than 4.
 */
export const haloPx = (px: number): number => (px < DETAIL_PX ? 1.25 : Math.min(4, px * 0.12))
/** Further out than this a whole country is on screen, and buses are not drawn, as a city map does. */
export const CITY_ZOOM = 9
/** The selected or hovered vehicle stands out by its size and its ring, in its own colour. */
export const PICKED_SCALE = 1.25
/**
 * Below this size a vehicle is drawn as its plain silhouette: its windows and joints, cut out of
 * it, would show as dark stripes across a small icon rather than as details.
 */
export const DETAIL_PX = 26

export const transitLayer: LayerDef = {
  id: 'transit',
  group: 'land',
  label: t('Public transport'),
  hint: t('Buses, trams, trolleybuses and minibuses across Estonia, Latvia and Lithuania: live wherever the operator publishes where its vehicles are, and by the timetable, marked so, in towns that do not'),
  defaultOn: true,
  swatch: '#ffc460',
  feeds: ['transit'],
  describes: ['transit'],
  describe,

  stats(entities) {
    const idle = (entities as TransitVehicle[]).filter((vehicle) => !vehicle.props.route).length
    return [{ label: t('not in service'), value: idle, tone: 'info' }]
  },

  build({ now, zoom, pitch, selectedId, hoveredId, fontsReady }) {
    const { hiddenModes } = useLayers.getState()
    // Tilted close in, the vehicles stand in 3D (map/vehicles3d.ts): their flat icons are left out.
    // Further out, each is its pin (layers/pins.ts) instead.
    const flat = zoom >= PIN_ZOOM && !vehiclesIn3d(zoom, pitch)
    const shown = shownVehicles(getEntities('transit') as TransitVehicle[], hiddenModes, selectedId)
    // Seen a country at a time, a town's buses are a smudge over its name: only the picked one is drawn.
    const data = zoom < CITY_ZOOM ? shown.filter((vehicle) => vehicle.id === selectedId) : shown
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    const iconPx = transitIconPx(zoom)
    const scale = iconPx / ICON
    // Each kind at its own length once drawn to scale; worked out per kind, not per vehicle.
    const px = Object.fromEntries((Object.keys(VEHICLE) as TransitMode[]).map((mode) => [mode, transitIconPx(zoom, mode)])) as Record<TransitMode, number>
    const sizeKey = Math.round(zoom * 20)
    // Route numbers grow a little with the vehicles, from 11 px where they appear to 14 px on a street.
    const labelSize = Math.round(Math.min(14, Math.max(11, 11 + (zoom - 15) * 1.5)))
    const highlight = `${selectedId}|${hoveredId}`
    // In its own colour even when picked: white read as some other, washed-out vehicle on either map.
    const picked = (vehicle: TransitVehicle) => vehicle.id === selectedId || vehicle.id === hoveredId
    const sizeOf = (vehicle: TransitVehicle) => px[vehicle.props.mode] * (picked(vehicle) ? PICKED_SCALE : 1)
    const colorOf = (vehicle: TransitVehicle): Color => {
      const [r, g, b] = MODE_COLOR[vehicle.props.mode]
      // Vehicles without a route (depot moves, breaks) stay visible but step back.
      return vehicle.props.route ? [r, g, b] : [r, g, b, 110]
    }

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      // Each bus glides from where it is drawn to its latest fix (see positionAt), so it moves every frame.
      getPosition: (vehicle: TransitVehicle) => onLane(vehicle, now),
      getAngle: (vehicle: TransitVehicle) => -(headingAt(vehicle, now) ?? 0),
      sizeUnits: 'pixels' as const,
      billboard: false,
    }

    const selected = data.find((vehicle) => vehicle.id === selectedId)
    return [
      // The selected vehicle's route with its stops, under every vehicle.
      ...tripLayers(selected ? selected.id : null, selected ? MODE_COLOR[selected.props.mode] : SELECTED),
      // A plain silhouette a little larger, under each vehicle: its edge, and the dark of its windows.
      new IconLayer<TransitVehicle>({
        ...icons,
        visible: flat,
        id: 'transit-halo',
        getIcon: (vehicle) => `${VEHICLE[vehicle.props.mode].icon}-halo` as const,
        getSize: (vehicle) => sizeOf(vehicle) + 2 * haloPx(sizeOf(vehicle)),
        getColor: HALO,
        updateTriggers: { getPosition: now, getAngle: now, getSize: `${sizeKey}|${highlight}` },
      }),
      new IconLayer<TransitVehicle>({
        ...icons,
        visible: flat,
        id: 'transit',
        pickable: true,
        getIcon: (vehicle) => (px[vehicle.props.mode] < DETAIL_PX ? (`${VEHICLE[vehicle.props.mode].icon}-halo` as const) : VEHICLE[vehicle.props.mode].icon),
        getSize: sizeOf,
        getColor: colorOf,
        updateTriggers: { getPosition: now, getAngle: now, getSize: `${sizeKey}|${highlight}`, getIcon: sizeKey, getColor: highlight },
      }),
      // What each one is, on a pin over it.
      pinLayer('transit-pins', data, zoom, now, (vehicle) => vehicle.props.mode, (vehicle) => onLane(vehicle, now)),
      selectionRing(
        'transit-selection',
        data.filter((vehicle) => vehicle.id === selectedId),
        now,
        15,
        scale,
      ),
      new TextLayer<TransitVehicle>({
        id: 'transit-labels',
        // Left out rather than drawn at size 0: a hidden label would still draw its tag.
        data: labelledOnce(data, Math.floor(zoom * 4), selectedId, hoveredId),
        visible: fontsReady,
        getText: (vehicle) => vehicle.label ?? '',
        getPosition: (vehicle) => onLane(vehicle, now),
        getSize: labelSize,
        // Dark on every mode's colour: they are all light enough for it.
        getColor: [17, 17, 17],
        // The route number on a tag of the vehicle's colour just above it, as on a stop's display.
        // Over its pin where it has one, else just over the vehicle.
        getPixelOffset: (vehicle) => [0, -(zoom < PIN_ZOOM ? pinPx(zoom) + 2 : px[vehicle.props.mode] / 2 + 4)],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        background: true,
        getBackgroundColor: (vehicle) => colorOf(vehicle),
        backgroundPadding: [4, 1.5],
        backgroundBorderRadius: 5,
        fontFamily: LABEL_FONT,
        fontWeight: 700,
        fontSettings: { sdf: true },
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getBackgroundColor: highlight, getPixelOffset: sizeKey },
      }),
    ]
  },
}

import { type ComponentType, useMemo, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { useAlerts } from '../../state/alerts'
import { isLayerOn, useLayers } from '../../state/layers'
import { useSelection } from '../../state/selection'
import { type WindowState, useWindows } from '../../state/windows'
import { AlertStack } from '../AlertStack'
import { Inspector } from '../Inspector'
import { LayerTree } from '../LayerTree'
import { RadarControl } from '../RadarControl'
import { StatusPanel } from '../StatusPanel'
import { CctvWindow } from './CctvWindow'
import { CountryWindow } from './CountryWindow'
import { DisplayWindow } from './DisplayWindow'
import type { Placement, Size } from './geometry'
import { useIntelBadge } from './intel'
import { IntelWindow } from './IntelWindow'
import { useMilitaryBadge } from './military/badge'
import { MilitaryWindow } from './MilitaryWindow'
import { NoticesWindow } from './NoticesWindow'
import { SyncWindow } from './SyncWindow'
import { TransportWindow } from './TransportWindow'
import { TvWindow } from './TvWindow'
import { ViewsWindow } from './ViewsWindow'

/** A count or a short flag, shown in a window's header and on its dock button. */
export interface WindowBadge {
  text: string
  tone?: 'info' | 'warn' | 'danger'
}

export const BADGE_TEXT = { info: 'text-accent', warn: 'text-warn', danger: 'text-danger' } as const

/**
 * One window. Adding a window to the product means writing its body component and listing
 * it here; the dock, the window layer and the command palette pick it up from there.
 */
export interface WindowDef {
  id: string
  title: string
  /** Dock label, five letters at most. */
  short: string
  /** Path data for the dock icon: 16x16, stroked, not filled. */
  icon: string
  defaultOpen: boolean
  /** Where it sits until the user moves it. */
  placement: Placement
  width: number
  /** What a resizable window starts at. The others are as tall as their content, up to this. */
  height: number
  resizable?: { min: Size; max: Size }
  hideInDock?: boolean
  /**
   * For a window that belongs to a mode rather than to the dock. `subject` is what the mode is
   * about, null while it is off: the window is shown for as long as there is one and comes to
   * the front whenever it changes. Closing the window leaves the mode.
   */
  mode?: { subscribe(onChange: () => void): () => void; subject(): unknown; leave(): void }
  /** A hook. Runs even while the window is closed, so the dock can show what is waiting inside. */
  useBadge?(): WindowBadge | null
  /** The body. It gets no props, and it scrolls inside the frame unless it lays itself out to fit. */
  component: ComponentType
}

function useAlertBadge(): WindowBadge | null {
  const active = useAlerts((s) => s.active)
  if (active.length === 0) return null
  // Most severe first, so the first alert sets the colour.
  const worst = active[0].severity
  return { text: String(active.length), tone: worst === 'critical' ? 'danger' : worst }
}

/**
 * Dock order. Default slots are laid out for 1440x900, and the ones open at the start still clear
 * each other in a viewport some 720px high, which is what a browser leaves of a laptop screen.
 * The rest share the middle of the map until they are moved.
 */
export const WINDOWS: readonly WindowDef[] = [
  {
    id: 'layers',
    title: t('Layers'),
    short: t('dock::Layer'),
    icon: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
    defaultOpen: true,
    placement: { corner: 'tl', dx: 56, dy: 52 },
    width: 240,
    height: 420,
    resizable: { min: { w: 200, h: 160 }, max: { w: 420, h: 1200 } },
    component: LayerTree,
  },
  {
    id: 'display',
    title: t('Display'),
    short: t('Disp'),
    icon: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 2.5v11',
    defaultOpen: true,
    placement: { corner: 'tl', dx: 56, dy: 480 },
    width: 240,
    // Room for the note on where the satellite base stops being sharp, the longest of the four.
    height: 240,
    component: DisplayWindow,
  },
  {
    id: 'views',
    title: t('Views'),
    short: t('dock::Views'),
    icon: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
    defaultOpen: false,
    placement: { corner: 'tl', dx: 304, dy: 608 },
    width: 240,
    height: 280,
    component: ViewsWindow,
  },
  {
    id: 'situation',
    title: t('Situation'),
    short: t('Sit'),
    icon: 'M1.5 8.5h3l2-5 3 9 2-4h3',
    defaultOpen: true,
    // Left of the map buttons, not under them.
    placement: { corner: 'tr', dx: 54, dy: 52 },
    width: 288,
    height: 220,
    resizable: { min: { w: 240, h: 160 }, max: { w: 480, h: 1000 } },
    component: StatusPanel,
  },
  {
    id: 'alerts',
    title: t('Alerts'),
    short: t('Alert'),
    icon: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11v.5',
    defaultOpen: true,
    placement: { corner: 'tc', dx: 0, dy: 52 },
    width: 416,
    height: 240,
    useBadge: useAlertBadge,
    component: AlertStack,
  },
  {
    id: 'radar',
    title: t('Radar'),
    short: t('dock::Radar'),
    icon: 'M8 8l4-4M8 2.5A5.5 5.5 0 1013.5 8',
    defaultOpen: false,
    placement: { corner: 'bc', dx: 0, dy: 56 },
    width: 352,
    height: 80,
    hideInDock: true,
    mode: {
      subscribe: useLayers.subscribe,
      subject: () => isLayerOn(useLayers.getState().visible, 'radar', false) || null,
      leave: () => useLayers.getState().toggle('radar', false),
    },
    component: RadarControl,
  },
  {
    id: 'tv',
    title: t('Live TV'),
    short: 'TV',
    icon: 'M2 4h12v8H2zM6 14h4',
    defaultOpen: false,
    placement: { corner: 'tl', dx: 304, dy: 300 },
    width: 420,
    height: 320,
    // YouTube's terms ask for a player of at least 200 by 200. Any smaller than this, and the
    // channel rail and the credit lines leave it less.
    resizable: { min: { w: 360, h: 310 }, max: { w: 1280, h: 800 } },
    component: TvWindow,
  },
  {
    id: 'cctv',
    title: t('Live CCTV'),
    short: 'CCTV',
    icon: 'M2 5h8v6H2zM10 7l4-2v6l-4-2',
    defaultOpen: false,
    // Clear of the radar strip underneath.
    placement: { corner: 'br', dx: 360, dy: 126 },
    width: 460,
    height: 360,
    resizable: { min: { w: 300, h: 220 }, max: { w: 1280, h: 900 } },
    component: CctvWindow,
  },
  {
    id: 'intel',
    title: t('Intel feed'),
    short: t('Intel'),
    icon: 'M3 4h10M3 8h10M3 12h6',
    defaultOpen: true,
    // Raised off the bottom edge: on wide screens the data credits fill that corner.
    placement: { corner: 'br', dx: 12, dy: 136 },
    width: 340,
    height: 300,
    resizable: { min: { w: 260, h: 200 }, max: { w: 640, h: 1000 } },
    useBadge: useIntelBadge,
    component: IntelWindow,
  },
  {
    id: 'countries',
    title: t('Country briefs'),
    short: t('dock::Brief'),
    icon: 'M4 14V2.5M4 3h8l-2 3 2 3H4',
    defaultOpen: false,
    placement: { corner: 'tc', dx: 0, dy: 300 },
    width: 380,
    height: 460,
    resizable: { min: { w: 300, h: 240 }, max: { w: 720, h: 1000 } },
    component: CountryWindow,
  },
  {
    id: 'military',
    title: t('Military'),
    short: t('Mil'),
    icon: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z',
    defaultOpen: false,
    placement: { corner: 'tr', dx: 362, dy: 300 },
    width: 340,
    height: 400,
    resizable: { min: { w: 260, h: 200 }, max: { w: 640, h: 1000 } },
    useBadge: useMilitaryBadge,
    component: MilitaryWindow,
  },
  {
    id: 'transport',
    title: t('Transport'),
    short: t('dock::Trans'),
    icon: 'M3.5 11.5v-7a2 2 0 012-2h5a2 2 0 012 2v7zM3.5 7.5h9M5 13.5v-2M11 13.5v-2',
    defaultOpen: false,
    placement: { corner: 'tc', dx: 0, dy: 300 },
    width: 340,
    height: 400,
    resizable: { min: { w: 280, h: 200 }, max: { w: 640, h: 1000 } },
    component: TransportWindow,
  },
  {
    id: 'notices',
    title: t('Public alerts'),
    short: t('dock::Amber'),
    icon: 'M8 2.5a3.5 3.5 0 00-3.5 3.5v2.5L3 11h10l-1.5-2.5V6A3.5 3.5 0 008 2.5zM6.5 13a1.5 1.5 0 003 0',
    defaultOpen: false,
    placement: { corner: 'tc', dx: 0, dy: 300 },
    width: 360,
    height: 380,
    resizable: { min: { w: 280, h: 200 }, max: { w: 640, h: 1000 } },
    component: NoticesWindow,
  },
  {
    id: 'sync',
    title: t('Updates'),
    short: t('dock::Sync'),
    icon: 'M8 4.5V8l2.5 1.5M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
    defaultOpen: false,
    placement: { corner: 'bl', dx: 304, dy: 56 },
    width: 240,
    height: 260,
    resizable: { min: { w: 200, h: 120 }, max: { w: 420, h: 1000 } },
    component: SyncWindow,
  },
  // Last, though it has no place in the dock: until it is raised, a window is drawn over the ones
  // listed before it, and this one opens on top of the Intel feed.
  {
    id: 'inspector',
    title: t('Inspector'),
    short: t('Insp'),
    icon: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5L14 14',
    defaultOpen: false,
    // Under Situation, over the Intel feed's slot: off the map, and clear of the data credits.
    placement: { corner: 'br', dx: 12, dy: 136 },
    width: 288,
    height: 480,
    hideInDock: true,
    mode: {
      subscribe: useSelection.subscribe,
      subject: () => {
        const { selectedId, feature } = useSelection.getState()
        return selectedId ?? feature
      },
      leave: () => useSelection.getState().select(null),
    },
    component: Inspector,
  },
]

/** Tailwind's md breakpoint. Below it there is no room to drag: one window shows at a time, as a sheet. */
const wideScreen = () => window.matchMedia('(min-width: 48rem)')

function subscribeScreen(onChange: () => void): () => void {
  const media = wideScreen()
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeScreen, () => !wideScreen().matches)
}

export function isWindowOpen(def: WindowDef, windows: Record<string, WindowState>): boolean {
  return def.mode ? def.mode.subject() !== null : (windows[def.id]?.open ?? def.defaultOpen)
}

/** What is on screen right now: every open window on a wide screen, a single one on a narrow one. */
export function shownWindows(): WindowDef[] {
  const { windows, order } = useWindows.getState()
  const open = WINDOWS.filter((def) => isWindowOpen(def, windows))
  if (wideScreen().matches) return open
  // The one raised last, out of the windows whose mode is on and the window last opened or raised
  // by hand. Nothing older is gone back to, so closing the sheet gives the map back, and a window
  // that is only open by default does not count: a phone starts with a clear map.
  const byRaise = (a: WindowDef, b: WindowDef) => order.indexOf(a.id) - order.indexOf(b.id)
  const byHand = WINDOWS.filter((def) => !def.mode && order.includes(def.id)).sort(byRaise).at(-1)
  return open.filter((def) => def.mode || def === byHand).sort(byRaise).slice(-1)
}

function subscribeShown(onChange: () => void): () => void {
  const stops = [subscribeScreen(onChange), useWindows.subscribe(onChange)]
  for (const def of WINDOWS) if (def.mode) stops.push(def.mode.subscribe(onChange))
  return () => {
    for (const stop of stops) stop()
  }
}

/** shownWindows() as a hook. Re-renders only when the set itself changes, not when a window moves. */
export function useShownWindows(): WindowDef[] {
  const ids = useSyncExternalStore(subscribeShown, () => shownWindows().map((def) => def.id).join(' '))
  return useMemo(() => WINDOWS.filter((def) => ids.split(' ').includes(def.id)), [ids])
}

export function closeWindow(def: WindowDef): void {
  if (def.mode) def.mode.leave()
  else useWindows.getState().close(def.id)
}

/** Opens a window that is not on screen and closes one that is: what the dock and the command palette do. */
export function toggleWindow(def: WindowDef): void {
  const { open, close, toggle } = useWindows.getState()
  if (wideScreen().matches) return toggle(def.id, def.defaultOpen)
  // A window can be open here and still out of sight, so it is the sheet on show that decides.
  if (shownWindows().includes(def)) close(def.id)
  else open(def.id)
}

const noBadge = () => null

/** The badge a window asks for, if any. Which hook runs is fixed per window, so the order of hooks never changes. */
export function useWindowBadge(def: WindowDef): WindowBadge | null {
  const useBadge = def.useBadge ?? noBadge
  return useBadge()
}

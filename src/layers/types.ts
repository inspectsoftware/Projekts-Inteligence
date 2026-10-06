import type { Layer } from '@deck.gl/core'
import type { Entity } from '../../shared/entity'
import type { FeedId } from '../../shared/feeds'
import type { Stat } from '../state/feeds'

export type LayerGroup = 'air' | 'sea' | 'land' | 'space' | 'signals' | 'environment'

export const GROUP_LABELS: Record<LayerGroup, string> = {
  air: 'Air',
  sea: 'Sea',
  land: 'Land',
  space: 'Space',
  signals: 'Signals',
  environment: 'Environment',
}

/** What a layer needs to know to draw one frame. */
export interface LayerContext {
  /** Server-corrected time for this frame. Changes on every animation tick. */
  now: number
  zoom: number
  selectedId: string | null
  hoveredId: string | null
  /** False until the label font has loaded; text drawn earlier would bake in a fallback font. */
  fontsReady: boolean
}

export type Tone = 'info' | 'ok' | 'warn' | 'danger' | 'mil'

/** Everything the inspector panel shows about one selected object. */
export interface InspectorModel {
  kicker: string
  title: string
  subtitle?: string
  badges: { text: string; tone: Tone }[]
  rows: { label: string; value: string }[]
  links: { label: string; href: string }[]
}

/**
 * One toggleable layer. Adding a layer to the product means writing one of these
 * and listing it in registry.ts; the scene, layer list and inspector pick it up from there.
 */
export interface LayerDef {
  id: string
  group: LayerGroup
  label: string
  hint: string
  defaultOn: boolean
  /** Legend swatch (CSS colour). */
  swatch: string
  /** Polled while the layer is visible. */
  feeds: readonly FeedId[]
  /** deck.gl layers for this frame. Must be cheap: it runs on every animation tick. */
  build(ctx: LayerContext): Layer[]
  /** Entity kinds this layer can describe in the inspector. */
  describes?: readonly Entity['kind'][]
  describe?(entity: Entity, now: number): InspectorModel
  /** Headline numbers for the layer list, recomputed once per snapshot. */
  stats?(entities: readonly Entity[]): Stat[]
}

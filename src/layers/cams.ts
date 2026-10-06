import type { Color } from '@deck.gl/core'
import { type CamEntity, camEntities, pictureOf } from '../../shared/adapters/cams'
import type { Cam } from '../../shared/feeds'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { serverNow } from '../runtime/clock'
import { getEntities, getPayload, publishEntities } from '../runtime/entityStore'
import { useFeeds } from '../state/feeds'
import { dots } from './common'
import type { LayerDef } from './types'

/** Entities this layer works out from the camera list are published under this key. */
const SLOT = 'webcams'

const VIEW: Color = [255, 158, 199]
const ROAD: Color = [201, 128, 160]

const KIND: Record<Cam['kind'], string> = {
  still: t('Still picture'),
  hls: t('Live video'),
  video: t('Live video'),
  youtube: t('Live video on YouTube'),
  iframe: t("Live video in the publisher's player"),
}

let source: Cam[] | null = null

function reset(): void {
  source = null
  if (getEntities(SLOT).length > 0) publishEntities(SLOT, [])
}

export const camsLayer: LayerDef = {
  id: 'cams',
  group: 'land',
  label: t('Live cameras'),
  hint: t("Officially published live cameras in the three Baltic states: city, port and ski views, and Lithuania's road cameras. Watch them in the Live CCTV window"),
  defaultOn: false,
  swatch: '#ff9ec7',
  feeds: ['cams'],
  describes: ['webcam'],

  describe(entity, now) {
    const cam = (entity as CamEntity).props
    const picture = pictureOf(cam, now)
    const where = `${formatLat(entity.lat)}  ${formatLon(entity.lon)}`
    return {
      kicker: cam.road ? t('Road camera') : t('Live camera'),
      title: cam.name,
      subtitle: `${t(cam.place)} · ${cam.country}`,
      image: picture ? { src: picture, alt: t('Camera view: {name}, {place}', { name: cam.name, place: t(cam.place) }) } : undefined,
      badges: cam.approx ? [{ text: t('Approximate position'), tone: 'warn' }] : [],
      rows: [
        { label: t('Shows'), value: KIND[cam.kind] },
        { label: t('Position'), value: where },
      ],
      links: /^https?:\/\//.test(cam.page) ? [{ label: cam.credit, href: cam.page }] : [],
    }
  },

  // The feed lists cameras, not entities: the ones with a position become dots here, once per snapshot.
  update() {
    const cams = getPayload('cams', 'cams')?.cams ?? null
    if (cams === source) return
    source = cams
    const entities = camEntities(cams ?? [], serverNow())
    publishEntities(SLOT, entities)
    useFeeds.getState().report('cams', {
      count: entities.length,
      stats: [{ label: t('hand-picked views'), value: entities.filter((entity) => !entity.props.road).length, tone: 'info' }],
    })
  },

  dispose: reset,

  build: (ctx) => dots('webcams', getEntities(SLOT) as CamEntity[], (entity) => (entity.props.road ? ROAD : VIEW), 4.5, ctx),
}

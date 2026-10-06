import { youtubeLive } from '../../shared/adapters/cams'
import type { Cam } from '../../shared/feeds'

/**
 * The hand-picked live views: cameras their owners publish themselves, each re-tested and its
 * terms read before it was listed here. Positions marked `approx` are the middle of the area
 * the camera looks at, or an estimate, not the mast.
 */

const ROP = { place: 'Rīga port', country: 'LV', kind: 'hls', credit: 'Freeport of Riga', page: 'https://rop.lv/lv/tiessaistes-kameras' } as const

/** The port publishes eight streams and no stills. Streams 3 and 5 come over a weak link and stall now and then. */
const port = (n: number, name: string, lon: number, lat: number, approx = true): Cam => ({
  ...ROP,
  id: `riga-port-${n}`,
  name,
  lon,
  lat,
  approx,
  src: `https://rop.lv/hls/cam${n}.m3u8`,
})

const SIGULDA = { place: 'Sigulda', country: 'LV', kind: 'still', refreshS: 20, credit: 'Siguldas Sporta centrs' } as const
const KULDIGA = { place: 'Kuldīga', country: 'LV', kind: 'iframe', credit: 'Kuldīgas novada pašvaldība' } as const
const KELTAS = { place: 'Klaipėda', country: 'LT', kind: 'still', refreshS: 30, approx: true, credit: 'AB Smiltynės perkėla', page: 'https://keltas.eu/' } as const

/** Views whose address never changes. */
export const FIXED_CAMS: readonly Cam[] = [
  {
    id: 'riga-ratslaukums',
    name: 'Rātslaukums (Town Hall Square)',
    place: 'Rīga',
    country: 'LV',
    lon: 24.1069,
    lat: 56.9474,
    kind: 'still',
    src: 'https://webcam.riga.lv/webcam/skaties.jpg',
    refreshS: 10,
    credit: 'Rīgas digitālā aģentūra',
    page: 'https://webcam.riga.lv/',
  },
  port(1, 'Port panorama', 24.0905, 56.952),
  port(2, 'Krievu sala', 24.0731, 57.0303),
  port(3, 'Sea gates (Jūras vārti)', 24.0216, 57.0595),
  port(4, 'From the traffic control tower towards the centre', 24.0883, 57.0324),
  port(5, 'From Daugavgrīva lighthouse towards the centre', 24.0216, 57.0595, false),
  port(6, 'From Krievu sala', 24.0731, 57.0303),
  port(7, 'Kundziņsala towards the bay', 24.1058, 57.0101),
  port(8, 'Kundziņsala towards the centre', 24.1058, 57.0101),
  {
    id: 'ventspils-park',
    name: 'Adventure Park (Piedzīvojumu parks)',
    place: 'Ventspils',
    country: 'LV',
    lon: 21.5487,
    lat: 57.3752,
    kind: 'hls',
    src: 'https://vstreams.ventspils.lv:8080/memfs/13eec0cb-5ba4-4c39-bad9-5605b0899f7e.m3u8',
    poster: 'https://vstreams.ventspils.lv:8080/memfs/13eec0cb-5ba4-4c39-bad9-5605b0899f7e.jpg',
    refreshS: 60,
    credit: 'Ventspils Piedzīvojumu parks (CC BY 4.0)',
    page: 'https://www.piedzivojumuparks.lv/webkameras',
  },
  { ...SIGULDA, id: 'sigulda-slope', name: 'City ski slope', lon: 24.8422, lat: 57.1653, src: 'https://www.siguldassports.lv/webcam_refresh.php?cam=1', page: 'https://www.siguldassports.lv/lv/siguldas_pilsetas_trase/' },
  { ...SIGULDA, id: 'sigulda-slope-2', name: 'City ski slope, second view', lon: 24.8422, lat: 57.1653, src: 'https://www.siguldassports.lv/webcam_refresh.php?cam=2', page: 'https://www.siguldassports.lv/lv/siguldas_pilsetas_trase/' },
  { ...SIGULDA, id: 'sigulda-fischer', name: 'Fischer ski centre', lon: 24.8147, lat: 57.141, src: 'https://www.siguldassports.lv/webcam_refresh.php?cam=3', page: 'https://www.siguldassports.lv/lv/fisher_sleposanas_trase/kameras/' },
  {
    id: 'madona-square',
    name: 'Saieta laukums (town square)',
    place: 'Madona',
    country: 'LV',
    lon: 26.2204,
    lat: 56.8542,
    kind: 'still',
    src: 'https://www.madona.lv/lat/webcam/gj.php?id=1',
    refreshS: 30,
    credit: 'Madonas novada pašvaldība',
    page: 'https://www.madona.lv/lat/webcam/',
  },
  { ...KULDIGA, id: 'kuldiga-rumba', name: 'Ventas rumba (waterfall)', lon: 21.979, lat: 56.9679, src: 'https://cdn.tiesraides.lv/kuldiga.lv/live-ip/11', page: 'https://kuldigasnovads.lv/tiessaites-kamera-ventas-rumba/' },
  { ...KULDIGA, id: 'kuldiga-ratslaukums', name: 'Rātslaukums', lon: 21.9708, lat: 56.9679, src: 'https://cdn.tiesraides.lv/kuldiga.lv/live-ip/12', page: 'https://kuldigasnovads.lv/tiessaistes-kamera-kuldigas-ratslaukums/' },
  { ...KULDIGA, id: 'kuldiga-pilsetas-laukums', name: 'Pilsētas laukums', lon: 21.9608, lat: 56.969, src: 'https://cdn.tiesraides.lv/kuldiga.lv/live-ip/13', page: 'https://kuldigasnovads.lv/tiessaistes-kamera-pilsetas-laukums/' },
  {
    id: 'aluksne-centre',
    name: 'Town centre',
    place: 'Alūksne',
    country: 'LV',
    lon: 27.0509,
    lat: 57.4199,
    // An endless WebM file, which an iPhone will not play.
    kind: 'video',
    src: 'https://skats.aluksne.lv:8125/cam.webm',
    credit: 'Alūksnes novada pašvaldība',
    page: 'https://aluksne.lv/index.php/tikla-kamera/',
  },
  {
    id: 'tallinn-tv-tower',
    name: 'TV tower panorama',
    place: 'Tallinn',
    country: 'EE',
    lon: 24.8875,
    lat: 59.4712,
    kind: 'hls',
    src: 'https://sv.levira.com/teletorn/smil:teletorn.smil/playlist.m3u8',
    // Renewed about once an hour.
    poster: 'https://app.levira.com/skyview/thumb_tt.jpg',
    refreshS: 3600,
    credit: 'Tallinna Teletorn / Levira',
    page: 'https://teletorn.ee/teletorni-kaamera/',
  },
  {
    id: 'tallinn-old-town',
    name: 'Old Town from the Viru Hotel roof',
    place: 'Tallinn',
    country: 'EE',
    lon: 24.7551,
    lat: 59.4364,
    kind: 'youtube',
    src: youtubeLive('UCQVre66peaZxhdvfIE1Ahxw'),
    credit: '360PANO, Digital.Tallinn CityCam',
    page: 'https://www.youtube.com/channel/UCQVre66peaZxhdvfIE1Ahxw/live',
  },
  {
    id: 'kuressaare-centre',
    name: 'Town centre',
    place: 'Kuressaare',
    country: 'EE',
    lon: 22.4859,
    lat: 58.2533,
    kind: 'youtube',
    src: youtubeLive('UCbbYmJZDLv8LWZi0klT0kEw'),
    credit: 'Saarte Hääl',
    page: 'https://www.youtube.com/channel/UCbbYmJZDLv8LWZi0klT0kEw/live',
  },
  {
    id: 'kaunas-old-town',
    name: 'Old town',
    place: 'Kaunas',
    country: 'LT',
    lon: 23.886,
    lat: 54.897,
    approx: true,
    kind: 'youtube',
    src: youtubeLive('UCVNiDnPReTVmHURkEPXhxaw'),
    credit: 'Kauno Uostas (Kaunas Gyvai)',
    page: 'https://www.youtube.com/channel/UCVNiDnPReTVmHURkEPXhxaw/live',
  },
  // The ferry operator's stills cannot be shown from another site, so they come through /api/cam/:id.
  { ...KELTAS, id: 'klaipeda-new-ferry', name: 'New ferry terminal', lon: 21.13891, lat: 55.68866, src: '/api/cam/klaipeda-new-ferry' },
  { ...KELTAS, id: 'klaipeda-old-ferry', name: 'Old ferry terminal', lon: 21.12378, lat: 55.70655, src: '/api/cam/klaipeda-old-ferry' },
  { ...KELTAS, id: 'smiltyne-old-ferry', name: 'Old ferry landing, Smiltynė side', lon: 21.113, lat: 55.707, src: '/api/cam/smiltyne-old-ferry' },
]

/**
 * The ferry operator's own number for each still served through /api/cam/:id. Its fourth camera
 * (27) is left out: it looks at the queue from close up, number plates and all, and nothing here
 * can shrink a picture.
 */
export const KELTAS_CAMERAS: ReadonlyMap<string, number> = new Map([
  ['klaipeda-new-ferry', 26],
  ['klaipeda-old-ferry', 28],
  ['smiltyne-old-ferry', 79],
])

/** What is known about a camera before its address has been looked up. */
type Listed = Omit<Cam, 'kind' | 'src' | 'poster' | 'refreshS'>

const CESIS = { place: 'Cēsis', country: 'LV', credit: 'Cēsu novada pašvaldība', page: 'https://www.cesis.lv/lv/novads/cesu-novads/web-kamera/' } as const

/** Cameras hosted by ipcamlive, by the alias their publisher embeds on its own page. */
export const IPCAMLIVE_CAMS: readonly (Listed & { alias: string })[] = [
  { ...CESIS, alias: '1cesis', id: 'cesis-rozu-laukums', name: 'Rožu laukums (Rose Square)', lon: 25.2708, lat: 57.3117 },
  { ...CESIS, alias: '2cesis', id: 'cesis-maija-parks', name: 'Maija parks', lon: 25.2742, lat: 57.3149 },
  { ...CESIS, alias: '3cesis', id: 'cesis-vienibas-laukums', name: 'Vienības laukums', lon: 25.2749, lat: 57.3133 },
  { ...CESIS, alias: 'cesis5', id: 'cesis-pils-parks', name: 'Castle Park island', lon: 25.2681, lat: 57.3149 },
  {
    alias: '59171eddc8080',
    id: 'saulkrasti-beach',
    name: 'Beach',
    place: 'Saulkrasti',
    country: 'LV',
    lon: 24.4088,
    lat: 57.2616,
    approx: true,
    credit: 'Visit Saulkrasti',
    page: 'https://www.visitsaulkrasti.lv/saulkrasti-webkamera/',
  },
]

export const JELGAVA_PAGE = 'https://www.jelgava.lv/pilseta/tiessaistes-kamera/'

const JELGAVA = { place: 'Jelgava', country: 'LV', credit: 'Jelgavas valstspilsētas pašvaldība', page: JELGAVA_PAGE } as const

/**
 * Jelgava's streams are unlisted YouTube videos that get a new id whenever they restart, so the
 * ids are read off the municipality's page and each view is recognised by its title there.
 */
export const JELGAVA_CAMS: readonly (Listed & { title: RegExp })[] = [
  { ...JELGAVA, title: /tilts/i, id: 'jelgava-bridge', name: 'Mītava pedestrian bridge', lon: 23.7318, lat: 56.6521 },
  { ...JELGAVA, title: /pasta sal/i, id: 'jelgava-pasta-sala', name: 'View from Pasta sala', lon: 23.7353, lat: 56.65 },
]

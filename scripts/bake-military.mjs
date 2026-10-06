// Manual, one-off: builds the two military reference layers. Never runs as part of
// `npm run build`; the results in public/data/ are committed.
//
//   public/data/mil-sites.json           bases, training areas and radar sites, from the list below
//   public/data/sea-exercise-areas.json  military areas at sea, from EMODnet Human Activities (CC BY 4.0)
//
//   node scripts/bake-military.mjs            # uses the cached download when present
//   node scripts/bake-military.mjs --refresh  # asks EMODnet again
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/military')
const outDir = join(root, 'public/data')
const refresh = process.argv.includes('--refresh')
const USER_AGENT = 'ProjectWhiteHornet/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

const report = (name, count) => console.log(`${name}: ${(statSync(join(outDir, name)).size / 1024).toFixed(0)} kB, ${count} features`)

// ---- Military sites -----------------------------------------------------------------------
//
// A hand-kept list. This is a public site, so the rule for every entry is: the name, the
// country, the operator and what kind of place it is must all be stated by the page linked
// as its source, which was read on 2026-10-06; the note says no more than that page does.
// Where the page is about a town rather than the site itself, the marker is the town and the
// entry is flagged `approx`. No unit strengths, no equipment counts, nothing from memory.
//
// Kinds: air, naval, army, training, sensor (radar and radio), other.
// Sources: WP en.wikipedia.org (CC BY-SA 4.0), WD wikidata.org (CC0), OSM openstreetmap.org (ODbL).
const WP = 'https://en.wikipedia.org/wiki/'
const WD = 'https://www.wikidata.org/wiki/'
const OSM = 'https://www.openstreetmap.org/'

const SITES = [
  // Latvia
  // The article does not say which branch the base belongs to, so it is not typed as an army base.
  { name: 'Ādaži Military Base', country: 'LV', kind: 'other', operator: 'Latvian National Armed Forces', lat: 57.097, lon: 24.3679, approx: true, source: `${WP}%C4%80da%C5%BEi`, note: 'The article on the town of Ādaži calls it the largest military base of the Latvian National Armed Forces and places it in the village of Kadaga, across the river. The marker is at Kadaga.' },
  { name: 'Ādaži military training area', country: 'LV', kind: 'training', lat: 57.1538, lon: 24.4698, source: `${OSM}relation/309689`, note: 'Mapped as a military training area ("Ādažu poligons").' },
  { name: 'Lielvārde Air Base', country: 'LV', kind: 'air', operator: 'Latvian Air Force', lat: 56.7783, lon: 24.8533, source: `${WP}Lielv%C4%81rde_Air_Base`, note: 'Military air base (ICAO: EVGA). The article says it forms the core of operations of the Latvian Air Force.' },
  { name: 'Latvian Naval Forces, Liepāja', country: 'LV', kind: 'naval', operator: 'Latvian National Armed Forces', lat: 56.55, lon: 21.0056, approx: true, source: `${WP}Latvian_Naval_Forces`, note: 'The naval branch of the National Armed Forces has its headquarters in Liepāja. The source names only the city, so the marker, set on its Karosta district, is approximate.' },
  { name: 'Selonia Military Training Area', country: 'LV', kind: 'training', lat: 56.3999, lon: 25.348, approx: true, source: `${OSM}relation/18052216`, note: 'Mapped as a military training area ("Sēlijas militārais poligons"). OpenStreetMap marks its own outline as approximate.' },
  { name: 'Mežaine military training area', country: 'LV', kind: 'training', operator: 'Latvian National Guard', lat: 56.7167, lon: 21.9833, source: `${WP}Mezaine`, note: 'Training area of the 4th Brigade of the National Guard near Skrunda, on the site of the former Soviet radar town Skrunda-1.' },
  { name: 'Audriņi air surveillance radar', country: 'LV', kind: 'sensor', operator: 'Latvian Air Force', lat: 56.5833, lon: 27.2333, approx: true, source: `${WP}Audri%C5%86i`, note: 'The article on the village says an air search radar of the Latvian Air Force was built on its outskirts in 2004. The marker is the village, not the radar.' },

  // Lithuania
  { name: 'Šiauliai Air Base', country: 'LT', kind: 'air', operator: 'Lithuanian Air Force', lat: 55.8939, lon: 23.3947, source: `${WP}%C5%A0iauliai_Air_Base`, note: 'A major facility of the Lithuanian Air Force and one of the bases of NATO\'s Baltic Air Policing mission.' },
  { name: 'Rukla', country: 'LT', kind: 'army', operator: 'Lithuanian Armed Forces', lat: 55.0528, lon: 24.3778, approx: true, source: `${WP}Rukla`, note: 'Units of the Lithuanian Armed Forces are based in the town, which has hosted NATO\'s Enhanced Forward Presence since 2017. The marker is the town.' },
  { name: 'Gaižiūnai training area', country: 'LT', kind: 'training', lat: 55.0171, lon: 24.39, source: `${OSM}way/150533938`, note: 'Mapped as military land ("Gaižiūnų poligonas").' },
  { name: 'Pabradė Training Area', country: 'LT', kind: 'training', lat: 54.9831, lon: 25.7664, approx: true, source: `${WP}Pabrad%C4%97`, note: 'A major military facility about 4 km north of Pabradė. The marker is the town.' },
  { name: 'Rūdninkai Training Area', country: 'LT', kind: 'training', operator: 'Lithuanian Armed Forces', lat: 54.3883, lon: 25.095, source: `${WP}R%C5%ABdninkai_Training_Area`, note: 'Military training area south-west of Vilnius, re-established in 2022. The article says it is to host the German 45th Panzer Brigade.' },
  { name: 'Brig. Gen. Kazys Veverskis training area, Kazlų Rūda', country: 'LT', kind: 'training', lat: 54.7881, lon: 23.4556, source: `${OSM}relation/7890379`, note: 'Mapped as military land ("Brg. Gen. Kazio Veverskio poligonas", formerly Kazlų Rūdos poligonas).' },
  { name: 'Lithuanian Naval Force, Klaipėda', country: 'LT', kind: 'naval', operator: 'Lithuanian Naval Force', lat: 55.7167, lon: 21.1195, source: `${OSM}way/344659224`, note: 'Mapped as military land under the name of the Naval Force of the Lithuanian Armed Forces ("Lietuvos kariuomenės karinės jūrų pajėgos").' },
  { name: 'Karmėlava', country: 'LT', kind: 'sensor', lat: 54.9722, lon: 24.0667, approx: true, source: `${WP}Karm%C4%97lava`, note: 'The article on the town says radar information about the airspace over the Baltic states is collected here and passed on to NATO. The marker is the town.' },

  // Estonia
  { name: 'Ämari Air Base', country: 'EE', kind: 'air', operator: 'Estonian Air Force', lat: 59.2622, lon: 24.2186, source: `${WP}%C3%84mari_Air_Base`, note: 'Military air base (ICAO: EEEI). It has hosted NATO Baltic Air Policing patrols since April 2014.' },
  { name: 'Tapa Army Base', country: 'EE', kind: 'army', operator: 'Estonian Defence Forces', lat: 59.2453, lon: 25.9545, source: `${WP}Tapa_Army_Base`, note: 'Army base of the 1st Infantry Brigade. The article lists a NATO Enhanced Forward Presence battalion among the units housed there.' },
  { name: 'Central Training Area (Keskpolügoon)', country: 'EE', kind: 'training', operator: 'Estonian Defence Forces', lat: 59.3636, lon: 25.8276, source: `${OSM}relation/905820`, note: 'Mapped as a military training area ("Kaitseväe keskpolügoon").' },
  { name: 'Nursipalu training area', country: 'EE', kind: 'training', lat: 57.7951, lon: 26.8067, source: `${OSM}relation/10442832`, note: 'Mapped as a military training area ("Nursipalu harjutusväli").' },
  { name: 'Taara Army Base, Võru', country: 'EE', kind: 'army', operator: 'Estonian Defence Forces', lat: 57.8254, lon: 27.0226, source: `${WP}Taara_Army_Base`, note: 'Army base in Võru, run by the 2nd Infantry Brigade.' },
  { name: 'Naval Base, Tallinn (Miinisadam)', country: 'EE', kind: 'naval', operator: 'Estonian Navy', lat: 59.4563, lon: 24.725, source: `${OSM}relation/11321534`, note: 'Mapped as a naval base ("Mereväebaas", also known as Miinisadam).' },
  // Position as the article's own map of air force locations gives it, not the village centre.
  { name: 'Kellavere radar station', country: 'EE', kind: 'sensor', operator: 'Estonian Air Force', lat: 59.0789, lon: 26.5306, source: `${WP}Estonian_Air_Force`, note: 'Marked on the article\'s map of Estonian Air Force locations as a radar station.' },

  // Poland
  { name: 'Suwałki Gap', country: 'PL', kind: 'other', lat: 54.2, lon: 23.4, approx: true, source: `${WP}Suwa%C5%82ki_Gap`, note: 'The sparsely populated area around the Polish–Lithuanian border, between Belarus and Russia\'s Kaliningrad exclave, which the article describes as of great strategic and military importance. An area, not a site: the marker only names it.' },
  { name: 'Bemowo Piskie', country: 'PL', kind: 'army', lat: 53.7333, lon: 22.05, approx: true, source: `${WP}Bemowo_Piskie`, note: 'The village is the site of the training base of NATO\'s Enhanced Forward Presence battlegroup in Poland. The marker is the village.' },
  { name: 'Naval Support Facility Redzikowo', country: 'PL', kind: 'other', operator: 'United States', lat: 54.4728, lon: 17.1231, approx: true, source: `${WP}Redzikowo`, note: 'A United States missile defence site (Aegis Ashore) at the airfield just north of the village, operational since 2023. The marker is the village.' },
  { name: '22nd Air Base, Malbork', country: 'PL', kind: 'air', operator: 'Polish Air Force', lat: 54.0267, lon: 19.1364, source: `${WP}22nd_Air_Base`, note: 'Polish Air Force base east of Malbork.' },

  // Russia: Kaliningrad Oblast
  { name: 'Baltiysk', country: 'RU', kind: 'naval', operator: 'Russian Navy', lat: 54.65, lon: 19.9167, approx: true, source: `${WP}Baltiysk`, note: 'The article calls the town a major base of the Russian Navy\'s Baltic Fleet. The marker is the town.' },
  { name: 'Kaliningrad (Baltic Fleet headquarters)', country: 'RU', kind: 'naval', operator: 'Russian Navy', lat: 54.7167, lon: 20.5, approx: true, source: `${WP}Baltic_Fleet`, note: 'The article gives Kaliningrad as the headquarters of the Baltic Fleet. The marker is the city.' },
  { name: 'Chkalovsk air base, Kaliningrad', country: 'RU', kind: 'air', operator: 'Russian Naval Aviation', lat: 54.7667, lon: 20.3967, source: `${WP}Kaliningrad_Chkalovsk`, note: 'Naval air base 9 km north-west of Kaliningrad.' },
  { name: 'Chernyakhovsk air base', country: 'RU', kind: 'air', operator: 'Russian Navy', lat: 54.6017, lon: 21.7817, source: `${WP}Chernyakhovsk_(air_base)`, note: 'Military air base of the Baltic Fleet, 4 km south-west of Chernyakhovsk.' },
  { name: 'Donskoye air base', country: 'RU', kind: 'air', operator: 'Russian Naval Aviation', lat: 54.9367, lon: 19.985, source: `${WP}Donskoye_(air_base)`, note: 'Air base in Kaliningrad Oblast, close to Russia\'s westernmost point; the article says its pads are used by helicopters.' },
  { name: 'Pionersky Radar Station', country: 'RU', kind: 'sensor', lat: 54.8573, lon: 20.1823, source: `${WD}Q7196882`, note: 'Russian early-warning radar station.' },

  // Russia: Pskov and Leningrad Oblasts, Saint Petersburg
  { name: 'Pskov airport', country: 'RU', kind: 'air', lat: 57.785, lon: 28.3983, source: `${WP}Princess_Olga_Pskov_International_Airport`, note: 'An airfield used both as a military air base and as a civil airport; the article says a military transport aviation regiment is based here.' },
  { name: 'Ostrov air base', country: 'RU', kind: 'air', operator: 'Russian Aerospace Forces', lat: 57.2967, lon: 28.4322, source: `${WP}Ostrov_(air_base)`, note: 'Air base 7 km south-east of Ostrov, listed as an army aviation airfield.' },
  { name: 'Vladimirsky Lager', country: 'RU', kind: 'army', lat: 58.2167, lon: 29.0667, approx: true, source: `${WP}Vladimirsky_Lager`, note: 'A locality in Pskov Oblast with a military base; the article says a motor rifle brigade has been stationed there since 1993. The marker is the locality.' },
  { name: 'Kamenka', country: 'RU', kind: 'army', lat: 60.45, lon: 29.0833, approx: true, source: `${WP}Kamenka,_Vyborgsky_District,_Leningrad_Oblast`, note: 'The article says a motor rifle brigade is located at this settlement on the Karelian Isthmus, with a tank training range to its east. The marker is the settlement.' },
  { name: 'Levashovo air base', country: 'RU', kind: 'air', operator: 'Russian Aerospace Forces', lat: 60.0867, lon: 30.1933, source: `${WP}Levashovo_(air_base)`, note: 'Air base on the northern edge of Saint Petersburg, mostly transport aircraft and helicopters.' },
  { name: 'Pushkin Airport', country: 'RU', kind: 'air', operator: 'Russian Aerospace Forces', lat: 59.685, lon: 30.3383, source: `${WP}Pushkin_Airport`, note: 'Air base 28 km south of Saint Petersburg; the article says a helicopter regiment is based here.' },
  { name: 'Kronstadt', country: 'RU', kind: 'naval', operator: 'Russian Navy', lat: 59.9908, lon: 29.7747, approx: true, source: `${WP}Baltic_Fleet`, note: 'The article names Kronstadt as a base of the Baltic Fleet. The marker is the town.' },
  { name: 'Vysotsk', country: 'RU', kind: 'naval', operator: 'Russian Navy', lat: 60.6167, lon: 28.5833, approx: true, source: `${WP}Vysotsk`, note: 'The article on the town says it hosts a base of the Baltic Fleet. The marker is the town.' },
  { name: 'Lekhtusi Radar Station', country: 'RU', kind: 'sensor', lat: 60.2755, lon: 30.546, source: `${WD}Q6520615`, note: 'Russian early-warning radar station.' },

  // Belarus
  { name: 'Lida air base', country: 'BY', kind: 'air', operator: 'Belarusian Air Force and Air Defence Forces', lat: 53.8778, lon: 25.3731, source: `${WP}Lida_(air_base)`, note: 'Air base at Lida, Grodno Region.' },
  { name: 'Baranovichi air base', country: 'BY', kind: 'air', operator: 'Belarusian Air Force and Air Defence Forces', lat: 53.0944, lon: 26.0458, source: `${WP}Baranovichi_(air_base)`, note: 'Air base south of the city of Baranavichy (ICAO: UMMA).' },
  { name: 'Machulishchy air base', country: 'BY', kind: 'air', operator: 'Belarusian Air Force and Air Defence Forces', lat: 53.7736, lon: 27.5772, source: `${WP}Machulishchy_(air_base)`, note: 'Air base at Machulishchy, Minsk Region.' },
  { name: 'Luninets air base', country: 'BY', kind: 'air', operator: 'Belarusian Air Force and Air Defence Forces', lat: 52.275, lon: 26.775, source: `${WP}Luninets_(air_base)`, note: 'Reserve air base at Luninets, Brest Region.' },
  { name: 'Baranavichy Radar Station', country: 'BY', kind: 'sensor', operator: 'Russian Aerospace Defence Forces', lat: 52.85, lon: 26.48, source: `${WD}Q3920826`, note: 'Russian early-warning radar station in Belarus.' },
  { name: 'Vileyka VLF transmitter', country: 'BY', kind: 'sensor', operator: 'Russian Navy', lat: 54.4633, lon: 26.7781, source: `${WD}Q827990`, note: 'Russian radio transmitter in Belarus, listed as part of the Russian Navy.' },

  // Sweden, Finland
  { name: 'Gotland Regiment (P 18), Visby', country: 'SE', kind: 'army', operator: 'Swedish Army', lat: 57.6133, lon: 18.2825, source: `${WP}Gotland_Regiment`, note: 'Armoured regiment based in Visby, re-established in 2018.' },
  { name: 'Karlskrona Naval Base', country: 'SE', kind: 'naval', operator: 'Swedish Navy', lat: 56.1561, lon: 15.5864, source: `${WP}Karlskrona_Naval_Base`, note: 'The largest naval base of the Swedish Navy.' },
  { name: 'Muskö Naval Base', country: 'SE', kind: 'naval', operator: 'Swedish Navy', lat: 58.9797, lon: 18.0638, source: `${WP}Musk%C3%B6_Naval_Base`, note: 'Underground naval facility on the island of Muskö, south of Stockholm.' },
  { name: 'Upinniemi naval base', country: 'FI', kind: 'naval', operator: 'Finnish Navy', lat: 60.0292, lon: 24.3583, approx: true, source: `${WP}Upinniemi`, note: 'The village is dominated by a Finnish naval base, home to the Coastal Brigade among other units. The marker is the village.' },
]

const sites = {
  type: 'FeatureCollection',
  features: SITES.map(({ lat, lon, ...properties }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })),
}
writeFileSync(join(outDir, 'mil-sites.json'), JSON.stringify(sites))
report('mil-sites.json', sites.features.length)

// ---- Military areas at sea ----------------------------------------------------------------
//
// What each coastal state has declared in its maritime spatial plan: firing areas, exercise
// areas, defence zones. Standing outlines only; whether one is in use on a given day is what
// the navigational warnings say.

const raw = join(cacheDir, 'emodnet-militaryareaspoly.json')
if (refresh || !existsSync(raw)) {
  const res = await fetch(
    'https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeNames=emodnet:militaryareaspoly&bbox=9,53,31,61,EPSG:4326',
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120_000) },
  )
  if (!res.ok) throw new Error(`EMODnet answered HTTP ${res.status}`)
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
}

const seaAreas = join(outDir, 'sea-exercise-areas.json')
// About 200 m, which is finer than these planning outlines are drawn. Areas a state has marked as no longer in use are left out.
await mapshaper.runCommands(
  `-i "${raw}" -filter "status !== 'Deactivated'" -simplify dp interval=200 keep-shapes ` +
    `-each "km2 = Math.round(areakm)" -rename-fields type=type_1,source=resource -filter-fields country,status,type,source,km2 ` +
    `-o "${seaAreas}" format=geojson precision=0.001`,
)
const areas = JSON.parse(readFileSync(seaAreas, 'utf8')).features
if (areas.length < 100) throw new Error(`Only ${areas.length} areas: the EMODnet layer no longer looks the way it did`)
report('sea-exercise-areas.json', areas.length)

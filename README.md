# Project White Hornet

A Latvia-only OSINT "world view": one dark tactical map that fuses live public data about the
country (air, sea, land, space, signals, weather, energy, internet, news).

Everything shown comes from public, open feeds used within their terms. No individual people are
tracked or profiled, and only officially published cameras are used.

## Run it

```bash
npm install
npm run dev        # client on http://localhost:5173, API on http://localhost:8787
npm run preview    # production build, served by the real server on http://localhost:4173
npm run check      # type-check, lint, tests
```

Requires Node 22 or newer.

## How it is put together

One npm package, one Node process.

- `src/` is the React client (Vite). `server/` is a Hono API. `shared/` is code both use.
- `npm run build` produces `dist/client` (static files) and `dist/server/index.js` (the server
  bundle, which also serves the client).
- The server is stateless and request-driven: every upstream feed sits behind an in-memory cache, so
  upstream load does not grow with the number of visitors, and the process can be stopped and
  restarted at any time without losing anything that matters.

## Deploy on Hostinger (Node.js web app)

hPanel → Websites → Add Website → Node.js web app → Import Git repository → Connect with GitHub.

| Setting          | Value                  |
| ---------------- | ---------------------- |
| Application type | `Hono`                 |
| Node.js version  | `22`                   |
| Branch           | `main`                 |
| Entry file       | `dist/index.js`        |

Every push to `main` redeploys. `GET /api/health` reports the running commit.

Hostinger starts the app on demand and stops it when there is no traffic, so the first request after
a quiet period is slower than the rest.

## Environment variables

All optional; the core runs without any. Locally they go in `.env` (see `.env.example`), on
Hostinger in hPanel → Environment Variables.

| Name                | Unlocks                                              |
| ------------------- | ---------------------------------------------------- |
| `AISSTREAM_API_KEY` | Full ship coverage (Riga, Liepāja, the Gulf of Riga) |

## Data sources

Listed here as each layer lands, with the attribution its licence requires.

| What                           | Source                                                                                        | Licence / terms                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Vector basemap                 | [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, © OpenStreetMap contributors          | ODbL (data)                                     |
| Satellite mosaic               | [Sentinel-2 cloudless 2024](https://s2maps.eu) by EOX (modified Copernicus Sentinel data)     | CC BY-NC-SA 4.0                                 |
| Daily imagery, night lights    | NASA EOSDIS GIBS                                                                              | Free to use with acknowledgement                |
| Aircraft                       | [adsb.lol](https://www.adsb.lol) first, [adsb.fi](https://adsb.fi) as fallback                | ODbL / non-commercial with credit               |
| Trains                         | [Vivi live train map](https://trainmap.vivi.lv) (the operator's public map feed)               | No published terms; used lightly                |
| Satellites                     | Orbital elements from [CelesTrak](https://celestrak.org), propagated in the browser            | Free; fetched at most every 2 h                 |
| GPS interference               | Worked out from the aircraft feed's own integrity reports, per H3 cell                         | As the aircraft feed                            |
| Weather warnings               | LVĢMC via [MeteoAlarm](https://meteoalarm.org)                                                 | Attribution required; may lag the official site |
| Weather stations               | [LVĢMC](https://videscentrs.lvgmc.lv) observation files                                        | No published terms; cached, read every 10 min   |
| Rain radar                     | [RainViewer](https://www.rainviewer.com)                                                       | Personal / non-commercial use, credit required  |
| Fires                          | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) (VIIRS, last 24 h)                          | Free to use with acknowledgement                |
| National border, municipalities | [Administratīvās teritorijas 2026](https://data.gov.lv/dati/dataset/7bb04db9-97ce-4a30-b93a-10ba8dafd104), data.gov.lv | CC0 |
| Airfields, power grid, defence sites, border crossings, undersea cables, place search | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via the Overpass API | ODbL |
| Ships                          | [Digitraffic](https://www.digitraffic.fi/en/marine-traffic/) (Fintraffic), plus [AISStream](https://aisstream.io) when a key is set | CC BY 4.0 / free key, AISStream's terms |
| Sanctioned-vessel flag         | [OpenSanctions](https://www.opensanctions.org/datasets/maritime/) maritime list                | CC BY-NC 4.0                                    |
| Buses and trams                | Operators' public live maps on [marsruti.lv](https://www.marsruti.lv) (Liepāja, Rēzekne, regional buses) | No published terms; used lightly      |
| Road cameras, roadworks, incidents | Latvia's National Access Point for road data, [transportdata.gov.lv](https://transportdata.gov.lv) (Latvijas Valsts ceļi) | Public map data; read every 5 min |
| Power system and price         | [energy-charts.info](https://www.energy-charts.info) (Fraunhofer ISE), from ENTSO-E and Nord Pool data | CC BY 4.0                               |
| Internet reachability          | [IODA](https://ioda.inetintel.cc.gatech.edu/country/LV), Georgia Tech                          | Free for research and non-commercial use        |
| News headlines                 | [LSM](https://eng.lsm.lv) English service RSS: titles and links only                           | Headlines link back to the source               |
| Radiation                      | EURDEP network, via [BfS](https://odlinfo.bfs.de) open data                                    | Free to use with acknowledgement                |
| River and coastal gauges       | [LVĢMC](https://videscentrs.lvgmc.lv) hydrology files                                          | No published terms; cached, read every 15 min   |

Baked data in `public/data/` is rebuilt by hand with the scripts in `scripts/`
(`node scripts/bake-boundaries.mjs`, `node scripts/bake-osm.mjs`), never as part of the build.

### Known gaps

- **Ships:** without `AISSTREAM_API_KEY` only the northern approaches (the Irbe Strait and beyond)
  are covered, because that is as far as the open Finnish receivers reach.
- **Rīga public transport:** Rīgas Satiksme's vehicle-position file has been unreachable from
  outside its own site, so Rīga's buses, trams and trolleybuses are not on the map.
- **Road weather:** the road authority's road-weather layer is published empty, so only its
  cameras, roadworks and incidents are shown.
- **Power:** the transmission operator's live figures sit behind bot protection, so grid numbers
  come from ENTSO-E data and run a few hours behind. Frequency is not shown for the same reason.
- **Air quality:** LVĢMC publishes its station list openly but not the readings, so there is no layer.
- **Defence sites** are simply what OpenStreetMap maps as military land: a public map's view, not an
  inventory.

## Terms of use

Several upstream feeds are licensed for non-commercial use only, so this site must stay free of
advertising and paid access.

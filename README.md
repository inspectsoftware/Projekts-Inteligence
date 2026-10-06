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
| Entry file       | `dist/server/index.js` |

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
| National border, municipalities | [Administratīvās teritorijas 2026](https://data.gov.lv/dati/dataset/7bb04db9-97ce-4a30-b93a-10ba8dafd104), data.gov.lv | CC0 |

Baked data in `public/data/` is rebuilt by hand with the scripts in `scripts/` (for example
`node scripts/bake-boundaries.mjs`), never as part of the build.

## Terms of use

Several upstream feeds are licensed for non-commercial use only, so this site must stay free of
advertising and paid access.

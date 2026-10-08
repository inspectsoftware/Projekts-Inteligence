# Projekts Inteliģence

A Latvia-only intelligence panel: one dark tactical map that fuses live OSINT data about the
country (air, sea, land, space, signals, weather, energy, internet, news).

Everything shown comes from public, open feeds used within their terms. No individual people are
tracked or profiled, and only officially published cameras are used. The one exception is a public
appeal to find a missing person: its headline is relayed with a link to its publisher, never a
photo or a profile, and it is dropped after two weeks.

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

| Name                   | Unlocks                                              |
| ---------------------- | ---------------------------------------------------- |
| `AISSTREAM_API_KEY`    | Full ship coverage (Riga, Liepāja, the Gulf of Riga) |
| `ANTHROPIC_API_KEY`    | Briefs written by a language model (Claude). Without it the regional brief and the country briefs are written by rules and templates, and everything else works the same. A process that stays up makes at most 81 calls a day: 72 for the regional brief (one per 20 minutes, and only while somebody has it open) and 9 for the country briefs (once a day). A start that finds the temp folder empty writes all of them again, up to 10 calls each time, so on a host that wipes the folder the daily total follows the number of starts |
| `ANTHROPIC_MODEL`      | Which model writes them. Default `claude-haiku-4-5` (the cheapest and fastest). `claude-sonnet-5-5` and `claude-opus-5-5` write better briefs at a higher price; a model that rejects the request leaves the briefs written by rules |
| `AI_MAX_CALLS_PER_DAY` | Ceiling on model calls per UTC day, counted by the running process. Default 120; 0 switches the model off. Once it is reached the briefs are written by rules until midnight UTC. The count is kept in the temp folder, and a start that finds the folder empty counts from zero: this stops a busy day or a bug, not a host that keeps wiping the folder. The cap that holds whatever the host does is a spend limit on the key's workspace in the Claude Console |
| `UCDP_TOKEN`           | The armed-conflict events layer. The token is free and comes by email from the Uppsala Conflict Data Program ([API docs](https://ucdp.uu.se/apidocs/)); without it the layer says it needs a key |
| `UCDP_VERSION`         | Which UCDP candidate release to read, such as `26.0.9`. Default: the newest of the last three months that answers |

## Data sources

Listed here as each layer lands, with the attribution its licence requires.

| What                           | Source                                                                                        | Licence / terms                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Vector basemap                 | [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, © OpenStreetMap contributors          | ODbL (data)                                     |
| Satellite mosaic               | [Sentinel-2 cloudless 2025](https://s2maps.eu) by EOX (Contains modified Copernicus Sentinel data 2025). 10 m per pixel; the whole satellite view up to zoom 13 and everything outside the orthophotos beyond it | CC BY-NC-SA 4.0 |
| Orthophotos, other countries   | Open national air photos, shown from zoom 13 inside each country: USA ([USGS](https://www.usgs.gov/programs/national-geospatial-program/national-map), to about 1 m), Japan ([GSI](https://maps.gsi.go.jp/development/ichiran.html)), Spain ([PNOA, IGN](https://pnoa.ign.es)), France ([IGN](https://geoservices.ign.fr)), the Netherlands ([PDOK](https://www.pdok.nl)), Luxembourg ([ACT](https://data.public.lu)), Switzerland ([swisstopo](https://www.swisstopo.admin.ch)), Austria ([basemap.at](https://basemap.at)), Czechia ([ČÚZK](https://geoportal.cuzk.cz)) and Poland ([GUGiK](https://www.geoportal.gov.pl)). Fetched by the browser, keyless | Public domain (USA), CC0 (Luxembourg), Licence Ouverte 2.0 (France), CC BY 4.0 (Spain, Netherlands, Austria), open with credit (the rest). Recalled, not re-read when added: check each before launch |
| Time zones                     | [Natural Earth](https://www.naturalearthdata.com) 1:10m time zones, simplified. Standard offsets as drawn in 2012: the lines do not move with daylight saving, and a few countries have changed zone since | Public domain |
| 3D relief                      | Elevation tiles from [Mapterhorn](https://mapterhorn.com/attribution) (Copernicus GLO-30 and national surveys), fetched only while the 3D button is on | Open data, credit required |
| Orthophoto, Latvia             | Ortofoto © Latvijas Ģeotelpiskās informācijas aģentūra (LĢIA), serviss: [LVM GEO](https://www.lvmgeo.lv/dati/tabmenu-two/brivpieejas-wms-wfs-servisi) (the `Orto_LKS` mosaic, 0.25 m per pixel). Shown from zoom 13 and cut to the national border in the browser, because the service is opaque white outside it | LVM GEO's free-access service (fees none, access constraints none); LĢIA gives cycle 7 under Creative Commons 4.0, credit required |
| Orthophoto, Estonia            | Maa- ja Ruumiameti ortofoto 2026: the `foto` tiles of [Maa- ja Ruumiamet](https://geoportaal.maaamet.ee/est/teenused/wms-wfs-wcs-teenused/maa-ameti-kaarditeenuste-kasutustingimused-p24.html), about 0.3 m per pixel, from zoom 13. The navy the service fills the edge of its coverage with is taken out in the browser | Free for any lawful use; the data, its age and the agency must be named; bulk caching discouraged |
| Orthophoto, Lithuania (switched off) | ORT10LT © Nacionalinė žemės tarnyba, © [geoportal.lt](https://www.geoportal.lt) © SSVA. Built, but off until the operator has been written to: see the known gaps | Data CC BY 4.0; the service asks to be told by email before it is used in another system |
| Daily imagery, night lights    | NASA EOSDIS GIBS (VIIRS, about 250 m and 500 m per pixel)                                     | Free to use with acknowledgement                |
| Aircraft                       | Within 250 nm of Latvia, every 10 s: [adsb.lol](https://www.adsb.lol) first, [adsb.fi](https://adsb.fi) as fallback. Military aircraft across the wider region, every 30 s: the `/v2/mil` lists of both, merged (the newer position of the two, the airframe description from adsb.fi) | adsb.lol: ODbL 1.0. adsb.fi: personal, non-commercial use, named with a link to its home page, at most 1 request a second |
| Military aircraft roles        | A table of ICAO type designators in `shared/data/aircraftRoles.ts`, checked against the tar1090 aircraft database (which is not redistributed here). King Airs, Challengers and Globals are told apart by the airframe description adsb.fi sends | Our own table |
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
| Sanctioned and shadow-fleet vessels | [OpenSanctions](https://www.opensanctions.org/datasets/maritime/) maritime list (its `sanction` and `mare.shadow` tags), read once a day | CC BY-NC 4.0                                    |
| Navy and government vessels    | AIS ship types 35 and 55, what a warship calls itself on AIS, and the navy vessels with an MMSI on [Wikidata](https://www.wikidata.org), less those it calls a bunker, passenger or cruise vessel. A vessel that declares a civil ship type is never counted | Wikidata: CC0                                   |
| Latvian waters                 | Latvia's territorial sea and exclusive economic zone from [Marine Regions](https://www.marineregions.org) (Flanders Marine Institute, Maritime Boundaries Geodatabase) | CC BY; no legal value, as the source says itself |
| Sea warnings                   | Navigational warnings in force for the Baltic from the [Swedish Maritime Administration](https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex), which coordinates them for every coastal state (BALTICO), Russian exercise areas included; Estonia's own, with outlines, from the [Estonian Transport Administration](https://gis.transpordiamet.ee/navhoiatused/en.html). Read every 15 min | Neither publisher states a licence. Public safety notices of government agencies, shown with credit and a link, not for navigation; a courtesy email to both is advised |
| Airspace restrictions          | Latvia: the valid NOTAM list of [Latvijas gaisa satiksme](https://ais.lgs.lv/notam/displayfile/All%20valid), joined to area outlines baked from ENR 5.1 and 5.2 of its [eAIP](https://ais.lgs.lv/aiseaip). Estonia: the NOTAM areas on the drone map of [EANS](https://utm.eans.ee/avm/). Read every 15 min | Neither publisher states a licence. Official aeronautical information, shown with credit and a link, not for flight planning; a courtesy email to both is advised |
| Military sites                 | 51 bases, training areas and radar sites around the Baltic, a hand-kept list in `scripts/bake-military.mjs`. Each entry links the public page it rests on and says no more than that page: [Wikipedia](https://en.wikipedia.org), [Wikidata](https://www.wikidata.org) or [OpenStreetMap](https://www.openstreetmap.org/copyright) | CC BY-SA 4.0 / CC0 / ODbL |
| Sea exercise areas             | Military areas at sea from [EMODnet Human Activities](https://emodnet.ec.europa.eu/en/human-activities), which gathers them from each state's maritime plan | CC BY 4.0 |
| Buses and trams                | Operators' public live maps on [marsruti.lv](https://www.marsruti.lv) (Liepāja, Rēzekne, regional buses) | No published terms; used lightly      |
| Road cameras, roadworks, incidents | Latvia's National Access Point for road data, [transportdata.gov.lv](https://transportdata.gov.lv) (Latvijas Valsts ceļi) | Public map data; read every 5 min |
| Live cameras, Rīga             | [Rīgas digitālā aģentūra](https://webcam.riga.lv/) (Rātslaukums still) and the [Freeport of Riga](https://rop.lv/lv/tiessaistes-kameras) (eight streams) | No published terms; shown with credit and a link |
| Live cameras, Latvian towns    | Municipal and tourist-office cameras: [Jelgava](https://www.jelgava.lv/pilseta/tiessaistes-kamera/) (YouTube), [Cēsis](https://www.cesis.lv/lv/novads/cesu-novads/web-kamera/) and [Saulkrasti](https://www.visitsaulkrasti.lv/saulkrasti-webkamera/) (ipcamlive), [Kuldīga](https://kuldigasnovads.lv) (the municipality's own player), [Ventspils](https://www.piedzivojumuparks.lv/webkameras), [Sigulda](https://www.siguldassports.lv), [Madona](https://www.madona.lv/lat/webcam/), [Alūksne](https://aluksne.lv/index.php/tikla-kamera/) | Ventspils: CC BY 4.0. YouTube and ipcamlive: their embedding terms. The rest: no published terms; credit and a link |
| Live cameras, Estonia          | [Tallinn TV tower](https://teletorn.ee/teletorni-kaamera/) (Levira), Digital.Tallinn CityCam and Saarte Hääl (Kuressaare) on YouTube, and Tallinna Liikuvusamet's 254 [junction cameras](https://ristmikud.tallinn.ee/) | YouTube's embedding terms; otherwise no published terms; credit and a link |
| Live cameras, Lithuania        | Via Lietuva's road cameras on [eismoinfo.lt](https://eismoinfo.lt/), AB Smiltynės perkėla's ferry terminals on [keltas.eu](https://keltas.eu/), Kaunas Gyvai on YouTube | eismoinfo.lt: reuse allowed when Via Lietuva or eismoinfo.lt is named as the source. keltas.eu: no published terms |
| Live television                | Publishers' own players only: YouTube embeds (the no-cookie player) of [LTV's news service](https://www.youtube.com/channel/UCOSAAyJoybqsY5sZ76BaqFA), [Saeima](https://www.saeima.lv/lv/streams/video), Latvia's [Cabinet](https://www.mk.gov.lv/lv/tiesraide) and President, the [Seimas](https://www.youtube.com/channel/UCN6ZSYI-7pxml6bE_zrTgow/streams), Estonia's government, and TVP World, DW (English and Russian), France 24, Euronews (English and Russian), Sky News, Al Jazeera, UATV, Current Time, FREEDOM and Bloomberg; [LRT](https://www.lrt.lt/mediateka/tiesiogiai)'s embed pages for four of its channels; the [Riigikogu](https://www.riigikogu.ee/info-ja-meedia/otseulekanded/) chamber stream. Which video is today's bulletin or sitting is read from each channel's YouTube feed, and pinned streams are checked through YouTube's oEmbed, every 15 min | YouTube: embedding switched on by each publisher. Saeima: its sittings may be embedded from its YouTube account, unaltered, with a link to saeima.lv. LSM: sharing unaltered from its own platform profiles. LRT: its own embed endpoint; no reuse terms found. Riigikogu: no terms found for the stream. LTV1, LTV7, Latvijas Radio, ReTV, TV24, Delfi TV, Lietuvos rytas TV and ERR are links to the broadcaster's own page and nothing more |
| Power system and price         | [energy-charts.info](https://www.energy-charts.info) (Fraunhofer ISE), from ENTSO-E and Nord Pool data | CC BY 4.0                               |
| Internet reachability          | [IODA](https://ioda.inetintel.cc.gatech.edu/country/LV), Georgia Tech                          | Free for research and non-commercial use        |
| News headlines, public broadcasters | RSS feeds of [LSM](https://www.lsm.lv) (Latvian and [English](https://eng.lsm.lv)), [ERR](https://www.err.ee) (Estonian and [English](https://news.err.ee)) and [LRT](https://www.lrt.lt) (Lithuanian and English). Headline, link and publisher only, never the article | LSM and ERR: sharing a headline with a link is allowed, anything more needs written permission. LRT: no terms found; its robots.txt shuts language models out |
| News headlines, other newsrooms | RSS feeds of Delfi ([Latvia](https://www.delfi.lv), [Lithuania](https://www.delfi.lt)), [15min](https://www.15min.lt), [BNN](https://bnn-news.com), [The Kyiv Independent](https://kyivindependent.com), [RFE/RL](https://www.rferl.org), [Meduza](https://meduza.io), [The Moscow Times](https://www.themoscowtimes.com), [The Insider](https://theins.press), [Re:Baltica](https://en.rebaltica.lv), [ICDS](https://icds.ee) and [EUvsDisinfo](https://euvsdisinfo.eu) | 15min: title with a link and its name. RFE/RL: excerpts with a link. The Insider: with an active link. Delfi and BNN: no terms found, robots.txt shuts language models out. No terms found for the rest |
| News headlines, official bodies | RSS feeds of [CERT.LV](https://cert.lv), Latvia's [State Border Guard](https://www.rs.gov.lv), [Interior](https://www.iem.gov.lv) and [Foreign](https://www.mfa.gov.lv) ministries; Estonia's [Government](https://valitsus.ee), [Defence](https://kaitseministeerium.ee) and [Foreign](https://vm.ee) ministries, [Defence Forces](https://mil.ee) and [RIA](https://ria.ee); Lithuania's [State Border Guard](https://vsat.lrv.lt) and [Interior Ministry](https://vrm.lrv.lt); the [Council of the EU](https://www.consilium.europa.eu) | Latvian government sites reserve all rights; the others publish no licence. Headline and link only |
| News ratings                   | Importance (0 to 100) and escalation level (0 to 5) are worked out on this server by keyword rules in English, Latvian, Lithuanian, Estonian and Russian. A publisher's own description is read for that and never shown. Newsrooms are read every 10 min, official bodies and analysis every 30 | As the headlines |
| Politics page                  | The same feeds as the news list, plus the [Lithuanian Government](https://lrv.lt), the [Riigikogu](https://www.riigikogu.ee) and the [Estonian Government](https://valitsus.ee) in Estonian. Picked by a keyword net in four languages and shown newest first at `/?politics`: headline, publisher, time and link, never rated or summarised | As the news rows above; government press feeds, credit and a link |
| Place information              | [Nominatim](https://nominatim.org) (© OpenStreetMap contributors), facts from [Wikidata](https://www.wikidata.org) and the opening of the [Wikipedia](https://www.wikipedia.org) article. Asked only on a right-click or a world search, through this server, cached for a day and held to one Nominatim request a second | ODbL; CC0; CC BY-SA 4.0, credit and a link |
| Danger by country              | Travel advice of the UK [Foreign, Commonwealth & Development Office](https://www.gov.uk/foreign-travel-advice), one level per country, drawn on [Natural Earth](https://www.naturalearthdata.com) 1:110m outlines | Open Government Licence v3.0; public domain |
| Armed conflict events          | [UCDP Candidate Events Dataset](https://ucdp.uu.se), the latest monthly release, about a month behind. Needs `UCDP_TOKEN`. Written from the API documentation and not yet run against the live service | Free with a token; cite UCDP and the release |
| Public alerts                  | No Baltic state publishes a machine-readable alert feed and Latvia has no AMBER Alert system. The window lists the weather service's orange and red warnings, and headlines of the news feeds above picked by keyword: warnings to the public, and appeals to find missing people | As the news and weather rows |
| Public transport, Tallinn and Vilnius | Vehicle position files of [Tallinna Transport](https://transport.tallinn.ee) and [stops.lt](https://www.stops.lt/vilnius/) | Tallinn: city open data, free use. Vilnius: no published terms; used lightly |
| Radiation                      | EURDEP network, via [BfS](https://odlinfo.bfs.de) open data                                    | Free to use with acknowledgement                |
| River and coastal gauges       | [LVĢMC](https://videscentrs.lvgmc.lv) hydrology files                                          | No published terms; cached, read every 15 min   |
| Country figures                | [World Bank](https://data.worldbank.org), [IMF World Economic Outlook](https://www.imf.org/external/datamapper), [Eurostat](https://ec.europa.eu/eurostat), [Wikidata](https://www.wikidata.org), NATO's [defence expenditure report](https://www.nato.int/en/news-and-events/articles/news/2026/07/07/defence-investment-update-record-spending-in-europe-and-canada), the [SIPRI Military Expenditure Database](https://doi.org/10.55163/CQGC9685), Transparency International's CPI and the Global Peace Index (IEP). Notes on the armed forces come from defence ministries, NATO and public broadcasters. Every figure links to its source in the window | World Bank CC BY 4.0; Wikidata CC0; SIPRI free to cite for non-commercial use; the rest cited with a link |
| Briefs                         | Written from the headlines and the country figures above: by Anthropic's Claude when `ANTHROPIC_API_KEY` is set, by rules and templates otherwise. Each is marked AI or Rules | A headline reaches the model only where its publisher's terms allow that |

Baked data in `public/data/` is rebuilt by hand with the scripts in `scripts/`
(`node scripts/bake-boundaries.mjs`, `node scripts/bake-osm.mjs`), never as part of the build.
The navy list and the outline of Latvian waters in `shared/data/` come from
`node scripts/bake-naval.mjs` in the same way.
The military sites and sea exercise areas come from `node scripts/bake-military.mjs`. The outlines
of Latvia's restricted and danger airspace in `shared/data/lvAirspace.ts` come from
`npx tsx scripts/bake-airspace.ts`, which is to be run again whenever a new AIP cycle takes effect
(the next one on 29 October 2026).
The country figures in `shared/data/countries.json` were collected by hand on 6 October 2026 and
are refreshed the same way.

### Known gaps

- **No taxis, no Mobilly, no Rīga city transport.** No taxi operator publishes vehicle positions,
  Mobilly has no public API, and Rīgas Satiksme's position file cannot be reached. The Transport
  window says so instead of showing an empty tab.
- **Latvia's cabinet, president and Saeima publish no feed**, so on the politics page their word
  arrives through the newsrooms. The keyword net lets through a "party" that is a celebration.
- **The camera is no longer held to the Baltic**: typed coordinates (decimal, degrees-minutes-seconds
  or MGRS) go anywhere on Earth. The data layers, the place search and the sharp imagery are still
  regional, so elsewhere there is only the base map.
- **The alert log is a keyword net, not an alert system.** It can show a headline that is not an
  alert and miss one that is, and it lives in memory: a restart keeps only what the disk copy and
  the newsrooms still hold. Police and rescue services publish no feed to read instead.
- **Danger by country is one government's travel advice**, not a map of fighting. Territories too
  small for the 1:110m outlines are in the list but not on the map.
- **Sharp imagery is not worldwide.** No keyless service with usable terms covers the whole Earth
  below a metre, so the air photos stop at the twelve countries listed above; everywhere else is
  the 10 m mosaic. Along a border a tile that is half photo is shown whole, blank half included.
  Finland, Norway, Belgium and Slovakia were tried and need a key or refuse other sites' pages.
- **The live layers are still Baltic.** Aircraft, ships, trains, roads, weather and the place
  gazetteer come from regional services. Elsewhere there is the map, the imagery, place lookup,
  danger by country and satellites.
- **The light theme stops at the map's own layers.** Panels and the vector map change; aircraft, ship
  and other live symbols keep the colours and dark outlines chosen for the dark map, and over
  imagery the map keeps its dark lettering in both themes.
- **Map sharpness:** nothing here is 1:1. The sharpest imagery that may be used without a key is
  the national orthophoto, at about 0.2 to 0.3 m of ground per pixel, so that is what the deepest
  zoom (19) shows over Latvia and Estonia; past zoom 18 the photo is only being enlarged. Each base
  stops two levels after its own detail runs out: Daily at zoom 10, Night at 9.
- **Lithuania's orthophoto is switched off.** The service asks to be told by email
  (pagalba@geoportal.lt) before it is used in another system, and nobody has written yet. Once that
  is done, set `LITHUANIA_ENABLED` in `shared/origins.ts` to `true`; nothing else needs changing: the
  tiles, the credit and the content-security policy all follow from it. Until then Lithuania has
  10 m satellite data only, and its origin is not allowed by the policy.
- **Kaliningrad, Belarus and the Pskov side stay at 10 m**, like Lithuania for now and the open
  sea: no sharper imagery exists for them that is keyless and licensed. Zoomed in there, the
  satellite view is soft; the drawn streets and the labels over it are sharp.
- **Along the borders** the Latvian photo is cut 500 m outside the simplified border the app ships,
  not on the border itself, and ends sooner wherever the photo does (the Russian and Belarusian
  side, where a few map sheets are blank as well). The white and the navy the two services paint
  where they have no photo are taken out tile by tile, by their look. Where such fill reaches only
  a few pixels into a tile a pale dash can stay on the seam, and a roof burnt out to pure white
  that crosses the rim of a border tile can, rarely, lose a piece. Safari older than 16.4 shows no
  Latvian photo on the border tiles and keeps Estonia's navy. The vector map's house numbers and
  places are OpenStreetMap's, as complete as its mappers have made them.
- **Ships:** without `AISSTREAM_API_KEY` only the northern approaches (the Irbe Strait and beyond)
  are covered, because that is as far as the open Finnish receivers reach.
- **Military aircraft:** only aircraft that broadcast are seen. Russian and Belarusian combat
  aircraft do not, so the picture is NATO and partner traffic plus the odd state transport. Outside
  the 250 nm circle only military aircraft are shown, and their positions are up to 30 s old; for
  the first poll after a quiet spell they can be missing altogether. A role is read off the type
  designator: it is what such an airframe usually does, and a type the table does not know stays
  "role unknown". A military King Air, Challenger or Global is called ISR only when its database
  description names a reconnaissance variant, so one that flies such missions under a plain
  description stays "role unknown" too. The two aggregators do not always agree on what is military;
  an aircraft either of them marks is shown as military. adsb.lol reports some multilaterated ground
  speeds at about half their value, and turns callers away at times: its military list is then left
  alone for five minutes and adsb.fi's is shown alone.
- **Warships:** most sail with AIS off, Russian ones nearly always, so an empty list proves nothing.
  The Wikidata navy list is a hint: it has stale names and operators, and the Inspector shows its
  entry beside what the ship itself broadcasts. It never outweighs the ship's own word: a vessel that
  declares itself a tanker, a cargo, passenger or fishing vessel or a yacht is not called a warship,
  which also leaves out a naval auxiliary that reports a merchant type. A vessel's nationality is
  only ever the country digits of its MMSI. The shadow-fleet tag is OpenSanctions' reading of Ukrainian and other lists,
  not a court's.
- **Vessel alerts** warn inside Latvia's territorial sea and economic zone, an outline simplified
  to about 200 m; elsewhere in the watched box a listed vessel or a non-NATO warship is only noted.
- **Sea warnings** are read out of free text. A warning whose positions cannot all be read is
  listed without a place rather than drawn wrong; positions are drawn as an area only when the
  words before them say they bound one, and a warning that lists several areas without lettering
  them is marked by a point. A warning with no date runs from its time of issue until it is
  withdrawn. One that names a date in a way the parser does not know, or several periods, is listed
  as "see notice for times": it is never shown as in force and raises no alert. Where Estonia and
  the Swedish page carry the same warning, the times are the broadcast ones and the outline is
  Estonia's; an Estonian warning on its own starts when its wording says, not when it was
  published. Whether one is "military" is judged from its wording (an exercise, firing, an area
  declared dangerous to shipping, interference). Latvia and Lithuania publish no feed of their own: their urgent warnings
  arrive through the Swedish page, and Latvia's monthly Notices to Mariners are only linked. Danish
  and Finnish national warnings are not read.
- **Airspace restrictions** cover Latvia and Estonia. Lithuania's air navigation service keeps its
  sites behind bot protection, so nothing Lithuanian is shown. A Latvian NOTAM only names an area:
  the 13 areas whose limits follow the edge of the territorial sea have no outline, nor do areas
  defined in an AIP supplement (EVD451 to EVD457 at the time of writing) or the temporary reserved
  areas at Tukums (EVTRA2, EVTRA3), and their NOTAMs are listed as text. Hours inside a NOTAM's
  validity are applied when they are written as "DAILY 0500-1500" or as days of the month with
  their hours, which covers every schedule seen so far: outside them the area is drawn faint and
  marked "outside its hours". Any other wording (weekdays, sunrise to sunset) is shown as "see
  notice for times" and never as in force. The outlines go stale with each AIP cycle until they
  are baked again.
- **Zone alerts** are raised only while the Sea warnings or Airspace restrictions layer is on, or
  the Zones tab is open: nothing reads those feeds otherwise. At sea the test is whether a corner
  of the announced area lies in Latvian waters. Only a zone known to apply at that moment counts:
  one outside its hours, or with times that could not be read, stays quiet.
- **Military sites** is a reference list, not an inventory: 51 places, each cut down to what its
  linked public page says, with no unit strengths and no equipment. Where that page is about a
  town, the marker is the town.
- **Rīga public transport:** Rīgas Satiksme's vehicle-position file has been unreachable from
  outside its own site, so Rīga's buses, trams and trolleybuses are not on the map.
- **Road weather:** the road authority's road-weather layer is published empty, so only its
  cameras, roadworks and incidents are shown.
- **Power:** the transmission operator's live figures sit behind bot protection, so grid numbers
  come from ENTSO-E data and run a few hours behind. Frequency is not shown for the same reason.
- **Air quality:** LVĢMC publishes its station list openly but not the readings, so there is no layer.
- **Country figures** are a snapshot: heads of government, IMF forecasts and NATO's estimates go
  out of date until the file is refreshed by hand. Russia and Belarus have no sourced force notes.
- **News, ratings:** a headline's importance and level come from word lists, not from understanding.
  The lists for the three most serious levels have only ever met made-up headlines, because the
  days they were tested on had no such event. Where a thing happened is read off the word order
  ("Latvia condemns the strike on Kyiv" is about Kyiv), and a headline built another way is read
  wrong. A figure of speech passes for the thing ("sabotage of the budget"), fog that diverts
  flights counts as a disrupted airport, and a home-language headline that names only a neighbour
  ("Robeža ar Baltkrieviju slēgta") is held at level 2. Two publishers count as carrying the same
  story when they report the same kind of event in the same country within 12 hours, so two
  similar incidents on one day are counted as one, and the same routine story in two languages is
  listed twice.
- **News, who is missing:** NATO headquarters, Latvia's defence ministry, armed forces and security
  services, Lithuania's defence ministry and security service, and Estonia's security police
  publish no feed, or keep it behind bot protection; their news arrives through the broadcasters.
  TVNET, Apollo, Postimees, LA.lv, NRA and Diena are left out because their terms forbid this use.
- **News, terms:** what a language model may do with each publisher's headlines is a cautious
  reading of terms and robots.txt, not legal advice, and for LRT, Delfi, BNN, The Kyiv Independent,
  Meduza, The Moscow Times, ICDS and Re:Baltica no terms page was found at all. RFE/RL's robots.txt
  disallows the very feed addresses its own site advertises. A courtesy email to LSM
  (info [at] lsm.lv) and ERR (portaalid [at] err.ee) is advised before launch; their permission
  would also let a model summarise their stories.
- **News, quiet hours:** feeds are read only while somebody has the Intel feed open, and the busiest
  ones hold an hour or two of stories, so what was published while nobody was looking can be missed.
- **Briefs:** when a call to the language model fails, the rule-written text stands until the next
  refresh: 20 minutes for the region, a day for a country. A regional brief is only written from
  headlines read in the last 20 minutes; while the publishers cannot be reached the previous one
  stays, marked stale.
- **Briefs, what is checked:** code checks a model's levels against the ratings and each number in
  a country section against the digits in that country's figures (the risk section may also quote
  a headline's). A right number with the wrong unit passes, as does a small one that occurs
  anywhere among the figures, and a number spelled out is not seen. The wording is not checked. The
  model may lower a level the keyword rules gave, but not raise the region to 3 on its own rating.
- **Briefs, publishers that allow rating only** (LSM, ERR, 15min): a development that rests on one
  of their stories is shown as their own headline, and the country briefs never see them. The
  regional summary is still written by a model that has read those headlines, held back from
  retelling them by its instructions alone.
- **Live cameras, places without one:** no officially published camera was found for Liepāja,
  Daugavpils, Rēzekne, Valmiera, Jūrmala or Rīga airport, for Vilnius, Palanga or the port of
  Klaipėda, or for Tartu, Pärnu, Narva or the port of Tallinn. Streams of those places exist only
  on aggregators that carry advertising, which are not used. The public broadcaster's Rīga
  panoramas need LSM's written permission and are not shown either.
- **Live cameras, Estonian roads:** the Transport Administration's 177 road cameras (Tark Tee) are
  left out. Their terms require a registered, manually approved API key, and how the key is to be
  sent is not documented.
- **Live cameras, terms:** the Rīga, Freeport, Sigulda, Madona, Alūksne, Kuldīga, Tallinn TV tower,
  Tallinn junction and Smiltynė ferry cameras come without reuse terms. They are shown, with credit
  and a link to the publisher's page, on the assumption that a camera a public body puts on its own
  site for everyone (most with cross-site access switched on, or as a public player) may be shown
  elsewhere. A courtesy email to each publisher is advised before launch, first of all to Tallinn
  (kaamera [at] tallinnlv.ee), whose 254 cameras are the largest set.
- **Live cameras, addresses that change:** YouTube video ids, ipcamlive stream ids and Lithuania's
  photo addresses change on their own, so the server looks them up (every minute, hour or five
  minutes). A camera whose lookup fails drops out of the list until it works again. Lithuania's
  list comes from eismoinfo.lt's own undocumented backend and may break when that site is rebuilt.
- **Live cameras, the rest:** Tallinn's junction cameras are published without positions, so they
  are in the window but not on the map, and an offline one shows the publisher's own "no
  connection" card. Positions marked approximate are the middle of an area, not the mast. The port,
  Kuldīga, Alūksne and three YouTube views have no still, only a stream; Alūksne's does not play on
  an iPhone, and port streams 3 and 5 stall now and then. One of the four ferry cameras is left
  out because it shows queueing cars from close up.
- **Live television, Latvia:** no Latvian channel that is on round the clock may be embedded yet.
  LTV1, LTV7 and Latvijas Radio need LSM's prior written permission (info@lsm.lv; one request could
  cover the LTV world feeds, Visiem LTV and the radio stations), and ReTV that of its editorial
  office (contacts on retv.lv/kontakti). Their streams were tested and do play; until a yes arrives
  they are links to the broadcaster's own page. What is embedded from Latvia is scheduled: LTV's two
  evening bulletins, Saeima, the Cabinet and the President.
- **Live television, Estonia:** ERR's terms allow a link and nothing more, so Estonian television is
  link-only. The one Estonian live video is the Riigikogu chamber stream: its address is read off
  Riigikogu's own page, is not a documented interface, and shows a title card between sittings.
- **Live television, pinned streams:** Sky News, Euronews, FREEDOM and DW in Russian run several
  streams on one channel, so their video ids are written into `shared/media/tv.ts`. The ids change
  without notice (Sky's every few weeks) and nothing keyless finds the new one: the feed notices a
  dead id and the channel becomes a link until the id is renewed by hand.
- **Live television, what is on air:** YouTube's channel feed says which broadcasts exist, not
  whether one is live. A bulletin counts as on air inside its usual slot when the feed lists it for
  today, or lists the day's earlier one: by the evening LTV's clips have often pushed the coming
  Panorāma out of the feed's fifteen entries, and it is then left to the channel's own player
  address to find. A sitting or press conference is only ever marked "today", and the player shows
  whether that is a countdown, the live picture or a recording. The feed is read every 15 minutes
  while the window is open. Whether the Cabinet streams its sittings live or uploads them afterwards
  is unconfirmed.
- **Live television, other countries:** everything was tested from a Latvian address only. LRT
  holds some programmes back outside Lithuania, and any YouTube publisher may block a region.
- **Defence sites** are simply what OpenStreetMap maps as military land: a public map's view, not an
  inventory.

## Terms of use

The code is under the [MIT licence](LICENSE). The data is not: every source in the table above keeps
its own terms, and several are licensed for non-commercial use only, so this site must stay free of
advertising and paid access. Anyone reusing the code with these feeds takes on those terms too.

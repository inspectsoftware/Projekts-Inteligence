# Projekts Inteliģence

**A live open-source intelligence map of Latvia and the Baltic, at [inteligence.lv](https://inteligence.lv).**

One dark tactical map that brings together what public, open feeds say about the region right now:
aircraft and ships, trains and buses, satellites overhead, GPS interference, weather and radar,
fires and earthquakes, the power grid and the internet, airspace and sea warnings, news, politics,
live cameras and television, and the cities themselves in 3D.

Everything shown comes from public, open sources used within their terms, each credited
[below](#data-sources). No individual people are tracked or profiled, and only officially
published cameras are used. The one exception is a public appeal to find a missing person: its
headline is relayed with a link to its publisher, never a photo or a profile, and it is dropped
after two weeks.

## What you can do with it

- **Look at the region live.** Aircraft (with military roles where the type tells them), ships
  (with navy, government and sanctioned vessels marked), trains, regional buses and trams,
  satellites, GPS interference worked out from the aircraft's own reports, weather warnings and
  stations, rain radar, fires, earthquakes, radiation and river gauges, road cameras, roadworks and
  incidents. Each is a layer you switch on in **Layers**; click anything for its details.
- **See the cities in 3D.** Zoom in and buildings stand up. Rīga, the whole of Estonia, Hamburg,
  Berlin and Zürich are drawn from their official laser-scanned 3D models, with real roofs, spires
  and domes, and Rīga's trees stand beside them. Elsewhere buildings come from OpenStreetMap's data
  as gathered by Overture Maps, with the roof shapes people have mapped. Click a building in Rīga,
  Estonia or Zürich for its address and use.
- **Choose a base map.** The dark tactical map (or a light one), **Sat** (national air photos down
  to about 0.25 m per pixel, over a 10 m satellite mosaic), **Sat 3D** (the 3D city with its roofs
  taken from those photos), the last few days of satellite passes, yesterday's pass, and night
  lights. Tilt the map up to the skyline, switch on the relief, or press the walking figure to
  stand in the street and walk around (WASD to move, drag to look, Esc to leave).
- **Follow what is happening.** The **Intel** feed rates headlines from public broadcasters,
  newsrooms and official bodies by importance and escalation; **Brief** sums up the region and each
  country; **Alerts** collects warnings; **Mil** follows military aircraft, warships, airspace and
  sea warnings, and military sites; the **Politics** page gathers parliament, government and party
  news and video.
- **Watch and listen.** Live television from the publishers' own players, officially published
  live cameras across the Baltic, and radio from around the world.
- **Arrange it your way.** Every panel is a window you can drag, resize from any corner and keep. Share the exact
  view as a link, and use it in English, Latvian, Lithuanian, Estonian or Russian, in a dark or a
  light theme, on a desktop or a phone.

## Run it yourself

```bash
npm install
npm run dev        # client on http://localhost:5173, API on http://localhost:8787
npm run preview    # production build, served by the real server on http://localhost:4173
npm run check      # type-check, lint, tests
```

Requires Node 22 or newer. Everything works without configuration; a few optional keys, set in
`.env` (see `.env.example`), unlock more:

| Name                   | Unlocks                                              |
| ---------------------- | ---------------------------------------------------- |
| `AISSTREAM_API_KEY`    | Full ship coverage of the Latvian coast (Rīga, Liepāja, the Gulf of Rīga), with a free key from [AISStream](https://aisstream.io) |
| `ANTHROPIC_API_KEY`    | Briefs written by a language model (Claude). Without it they are written by rules and templates, and everything else works the same. At most 81 calls a day: 72 for the regional brief, only while somebody has it open, and 9 for the country briefs |
| `ANTHROPIC_MODEL`      | Which model writes them. Default `claude-haiku-4-5`; `claude-sonnet-5-5` and `claude-opus-5-5` write better briefs at a higher price |
| `AI_MAX_CALLS_PER_DAY` | Ceiling on model calls per UTC day. Default 120; 0 switches the model off. For a hard cap, set a spend limit on the key's workspace in the Claude Console |
| `UCDP_TOKEN`           | The armed-conflict events layer, with a free token from the [Uppsala Conflict Data Program](https://ucdp.uu.se/apidocs/) |
| `UCDP_VERSION`         | Which UCDP candidate release to read, such as `26.0.9`. Default: the newest of the last three months |
| `CHAT_OWNER_IDS`       | Marks the site owner in the chat: the secret visitor ids (32 characters, `localStorage.getItem('pwh-visitor')`) of the owner's browsers, comma-separated. There is no login, so anyone holding one of these ids writes as the owner: keep them secret |
| `CHAT_OWNER_NAME`      | The name the owner writes under, up to 20 letters and digits |
| `CHAT_BANNED_IDS`      | Public ids (as shown beside a message), comma-separated, of browsers that may read the chat but not write in it |
| `CHAT_DISABLED`        | `1` shuts the chat |
| `PROXY_HOPS`           | How many of the host's proxies stand between a visitor and the process, so request limits go by an address a caller cannot forge. `GET /api/health` reports what it sees as `forwarded`. Leave it unset when unsure |

### Deploying

`npm run build` produces `dist/client` (static files) and `dist/server/index.js`: one Node process
that serves both the API and the client, started with `npm start`. Any Node 22 host will do. The
live site runs as a Hostinger Node.js web app (type Hono, branch `main`, entry file
`dist/index.js`), which builds and restarts on every push. `GET /api/health` reports the running
commit.

## How it is put together

One npm package, one Node process.

- `src/` is the React client (Vite, MapLibre GL, deck.gl). `server/` is a Hono API. `shared/` is
  code both use.
- The server is stateless and request-driven: every upstream feed sits behind an in-memory cache, so
  upstream load does not grow with the number of visitors, and the process can be stopped and
  restarted at any time without losing anything that matters.
- Two routes depend on where visitors look, and both are bounded. Outside the Baltic, aircraft are
  fetched for wherever the map is (`/api/aircraft`): answers are shared per 4° grid cell for ten
  seconds, 40 cells are held at most, the sources are asked at most once every 1.5 s across all
  visitors, and past a short queue a request is refused. Place lookups (`/api/place`) are bounded
  the same way.
- Map tiles, air photos and the 3D city models are fetched by the browser straight from their
  publishers. The 3D city is one WebGL layer of the map's own, fed by a web worker
  (`src/map/city/`).
- A strict content-security policy lists every outside origin the page may talk to
  (`shared/origins.ts`).

## Data sources

Every source, with the attribution its licence requires.

| What                           | Source                                                                                        | Licence / terms                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Vector basemap and its 3D buildings | [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, © OpenStreetMap contributors          | ODbL (data)                                     |
| Satellite mosaic               | [Sentinel-2 cloudless 2025](https://s2maps.eu) by EOX (Contains modified Copernicus Sentinel data 2025). 10 m per pixel; the whole satellite view up to zoom 13 and everything outside the orthophotos beyond it | CC BY-NC-SA 4.0 |
| Orthophotos, other countries   | Open national air photos, shown from zoom 13 inside each country: USA ([USGS](https://www.usgs.gov/programs/national-geospatial-program/national-map), to about 1 m), Japan ([GSI](https://maps.gsi.go.jp/development/ichiran.html)), Spain ([PNOA, IGN](https://pnoa.ign.es)), France ([IGN](https://geoservices.ign.fr)), the Netherlands ([PDOK](https://www.pdok.nl)), Luxembourg ([ACT](https://data.public.lu)), Switzerland ([swisstopo](https://www.swisstopo.admin.ch)), Austria ([basemap.at](https://basemap.at)), Czechia ([ČÚZK](https://geoportal.cuzk.cz)) and Poland ([GUGiK](https://www.geoportal.gov.pl)). Fetched by the browser, keyless | Public domain (USA), CC0 (Luxembourg), Licence Ouverte 2.0 (France), CC BY 4.0 (Spain, Netherlands, Austria), open with credit (the rest). |
| Time zones                     | [Natural Earth](https://www.naturalearthdata.com) 1:10m time zones, simplified. Standard offsets as drawn in 2012: the lines do not move with daylight saving, and a few countries have changed zone since | Public domain |
| 3D relief                      | Elevation tiles from [Mapterhorn](https://mapterhorn.com/attribution) (Copernicus GLO-30 and national surveys), fetched while the 3D button is on, and under the city models below to stand their buildings on the street | Open data, credit required |
| Orthophoto, Latvia             | Ortofoto © Latvijas Ģeotelpiskās informācijas aģentūra (LĢIA), serviss: [LVM GEO](https://www.lvmgeo.lv/dati/tabmenu-two/brivpieejas-wms-wfs-servisi) (the `Orto_LKS` mosaic, 0.25 m per pixel). Shown from zoom 13 and cut to the national border in the browser, because the service is opaque white outside it | LVM GEO's free-access service (fees none, access constraints none); LĢIA gives cycle 7 under Creative Commons 4.0, credit required |
| Orthophoto, Estonia            | Maa- ja Ruumiameti ortofoto 2026: the `foto` tiles of [Maa- ja Ruumiamet](https://geoportaal.maaamet.ee/est/teenused/wms-wfs-wcs-teenused/maa-ameti-kaarditeenuste-kasutustingimused-p24.html), about 0.3 m per pixel, from zoom 13. The navy the service fills the edge of its coverage with is taken out in the browser | Free for any lawful use; the data, its age and the agency must be named; bulk caching discouraged |
| Orthophoto, Lithuania (switched off) | ORT10LT © Nacionalinė žemės tarnyba, © [geoportal.lt](https://www.geoportal.lt) © SSVA. Built but switched off: the service asks to be told by email before it is used in another system | Data CC BY 4.0; the service asks to be told by email before it is used in another system |
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
| Sea warnings                   | Navigational warnings in force for the Baltic from the [Swedish Maritime Administration](https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex), which coordinates them for every coastal state (BALTICO), Russian exercise areas included; Estonia's own, with outlines, from the [Estonian Transport Administration](https://gis.transpordiamet.ee/navhoiatused/en.html). Read every 15 min | Neither publisher states a licence. Public safety notices of government agencies, shown with credit and a link, not for navigation |
| Airspace restrictions          | Latvia: the valid NOTAM list of [Latvijas gaisa satiksme](https://ais.lgs.lv/notam/displayfile/All%20valid), joined to area outlines baked from ENR 5.1 and 5.2 of its [eAIP](https://ais.lgs.lv/aiseaip). Estonia: the NOTAM areas on the drone map of [EANS](https://utm.eans.ee/avm/). Read every 15 min | Neither publisher states a licence. Official aeronautical information, shown with credit and a link, not for flight planning |
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
| Earthquakes                    | [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), magnitude 2.5 and up, last 24 hours, worldwide | Public domain |
| Politics page                  | The same feeds as the news list, plus the [Saeima](https://www.saeima.lv/lv/feeds/news.rss)'s press releases, [LSM's politics section](https://eng.lsm.lv/rss/?catid=315) in English, [Rīga city](https://www.riga.lv/lv/rss/articles)'s news, the [Lithuanian Government](https://lrv.lt), the [Riigikogu](https://www.riigikogu.ee) and the [Estonian Government](https://valitsus.ee) in Estonian. Every item of the Saeima, LSM politics and the governments counts; the rest is picked by a keyword net in four languages. Shown newest first at `/?politics`: headline, publisher, time and link, never rated or summarised | As the news rows above. Saeima: its content may be reused for information with credit to the Saeima. LSM: sharing by a link to the article on LSM. Rīga: no terms found; credit and a link |
| Politics page video            | Live TV's channels for the Saeima, the Cabinet, the President, LTV news, the Seimas, the Riigikogu and Estonia's government, plus [Rīga City Council](https://www.youtube.com/channel/UCnpNiIZTRDchM5GKm6faVWw/streams)'s sittings (found in its YouTube feed with the TV channels, every 15 min), LTV's [Kas notiek Latvijā?](https://www.youtube.com/channel/UCtYJhxqbewMnrHE-18lAb9Q/videos), and the own YouTube channels of the lists elected to the 15th Saeima: [Apvienotais Saraksts](https://www.youtube.com/channel/UCYdpAtJ-PjtYCgO-7qVstaA), [Jaunā Vienotība](https://www.youtube.com/channel/UCiK5qoCil39pvHttkpw95RA), [Latvija pirmajā vietā](https://www.youtube.com/channel/UCxTOOrVGtBDglW9H8Or-KdQ), [PROGRESĪVIE](https://www.youtube.com/channel/UC22SWiFrfCPV8q68LsglM0g) and [Suverēnā vara](https://www.youtube.com/channel/UClctaV6uWutR0VftEdq9BNQ), each played as its uploads, newest first. Nacionālā apvienība and Apvienība Jaunlatvieši are links to their websites | YouTube: embedding switched on by each publisher, in the no-cookie player, loaded only on a click. Each party channel was checked on 2026-10-21 to be linked from the party's website or to link to it |
| Place information              | [Nominatim](https://nominatim.org) (© OpenStreetMap contributors), facts from [Wikidata](https://www.wikidata.org) and the opening of the [Wikipedia](https://www.wikipedia.org) article. Asked only on a right-click or a world search, through this server, cached for a day and held to one Nominatim request a second | ODbL; CC0; CC BY-SA 4.0, credit and a link |
| Danger by country              | Travel advice of the UK [Foreign, Commonwealth & Development Office](https://www.gov.uk/foreign-travel-advice), one level per country, drawn on [Natural Earth](https://www.naturalearthdata.com) 1:110m outlines | Open Government Licence v3.0; public domain |
| Armed conflict events          | [UCDP Candidate Events Dataset](https://ucdp.uu.se), the latest monthly release, about a month behind. Needs `UCDP_TOKEN`. Not yet tested against the live service | Free with a token; cite UCDP and the release |
| Public alerts                  | No Baltic state publishes a machine-readable alert feed and Latvia has no AMBER Alert system. The window lists the weather service's orange and red warnings, and headlines of the news feeds above picked by keyword: warnings to the public, and appeals to find missing people | As the news and weather rows |
| Public transport, Tallinn and Vilnius | Vehicle position files of [Tallinna Transport](https://transport.tallinn.ee) and [stops.lt](https://www.stops.lt/vilnius/) | Tallinn: city open data, free use. Vilnius: no published terms; used lightly |
| Public transport, Rīga         | Routes, stops and the timetable of [Rīgas satiksme](https://data.gov.lv/dati/lv/dataset/marsrutu-saraksti-rigas-satiksme-sabiedriskajam-transportam), baked from its monthly GTFS file. Scheduled times only: the operator publishes no vehicle positions, and its own planner reads them from an endpoint closed to other sites, which is left alone | CC0 1.0 |
| Radiation                      | EURDEP network, via [BfS](https://odlinfo.bfs.de) open data                                    | Free to use with acknowledgement                |
| River and coastal gauges       | [LVĢMC](https://videscentrs.lvgmc.lv) hydrology files                                          | No published terms; cached, read every 15 min   |
| Country figures                | [World Bank](https://data.worldbank.org), [IMF World Economic Outlook](https://www.imf.org/external/datamapper), [Eurostat](https://ec.europa.eu/eurostat), [Wikidata](https://www.wikidata.org), NATO's [defence expenditure report](https://www.nato.int/en/news-and-events/articles/news/2026/07/07/defence-investment-update-record-spending-in-europe-and-canada), the [SIPRI Military Expenditure Database](https://doi.org/10.55163/CQGC9685), Transparency International's CPI and the Global Peace Index (IEP). Notes on the armed forces come from defence ministries, NATO and public broadcasters. Every figure links to its source in the window | World Bank CC BY 4.0; Wikidata CC0; SIPRI free to cite for non-commercial use; the rest cited with a link |
| Briefs                         | Written from the headlines and the country figures above: by Anthropic's Claude when `ANTHROPIC_API_KEY` is set, by rules and templates otherwise. Each is marked AI or Rules | A headline reaches the model only where its publisher's terms allow that |
| 3D city, Rīga                  | The city's LOD2 buildings, modelled from airborne laser scans, and its trees, by Rīgas valstspilsētas pašvaldība ([GEO RĪGA](https://georiga.eu/3d-riga/); the buildings are also on [data.gov.lv](https://data.gov.lv/dati/lv/dataset/rigas-apkaimju-lod2-modeli) as Rīgas apkaimju LOD2 modeļi). Fetched by the browser from the city's public ArcGIS scene services, only while zoomed into Rīga; the layers are listed by `scripts/bake-city-3d.mjs` | CC BY 4.0, credit to Rīgas valstspilsētas pašvaldība. The trees have no data.gov.lv entry of their own; GEO RĪGA gives CC BY 4.0 for its open data |
| 3D city, Estonia               | The whole country's LOD2 buildings with their ETAK attributes, by Maa- ja Ruumiamet (Hooned LOD2, last updated 18.03.2025), from the Land Board's public ArcGIS scene service in its copy in degrees. Fetched by the browser only while zoomed in; its leaves are indexed by `scripts/bake-city-3d.mjs` | [Maa- ja Ruumiameti avaandmete litsents](https://geoportaal.maaruum.ee/opendata-licence), credit "Maa- ja Ruumiamet, Hooned LOD2, 18.03.2025" |
| 3D city, Hamburg               | The city's LoD2 buildings (as of 04.2021), from Esri Deutschland's public copy on ArcGIS Online ([item](https://www.arcgis.com/home/item.html?id=943049b99a9d45a1a0b526939c9b9b38)) | [Datenlizenz Deutschland – Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0), credit "Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)" |
| 3D city, Berlin                | The city's LoD2 buildings (as of 04.2022), from Esri Deutschland's public copy on ArcGIS Online ([item](https://www.arcgis.com/home/item.html?id=50e8049abb5841dcb3c113210b2109fb)) | [Datenlizenz Deutschland – Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0), credit "Geoportal Berlin / 3D-Gebäudemodelle im Level of Detail 2 (LoD 2)" |
| 3D city, Zürich                | Stadt Zürich's LOD2 buildings, from a public copy by Esri's 3D team on ArcGIS Online ([item](https://www.arcgis.com/home/item.html?id=7b79c3c2140049bb95283868e5c3b32f)) | [CC0](https://opendefinition.org/licenses/cc-zero/), no credit required; source "Stadt Zürich" ([geodata](https://www.stadt-zuerich.ch/geodaten)) |
| 3D buildings, worldwide        | [Overture Maps](https://docs.overturemaps.org/attribution/) buildings, used for footprints, heights and roof shapes near the camera worldwide | ODbL, credit "© OpenStreetMap contributors, © Overture Maps Foundation" |
Baked data in `public/data/` and `shared/data/` is rebuilt by hand with the scripts in `scripts/`
(boundaries, OpenStreetMap features, the navy list and Latvian waters, military sites and sea
exercise areas, Latvian airspace for each AIP cycle, Rīga's routes and timetable each month, and
the 3D city catalogue), never as part of the build. The country figures in
`shared/data/countries.json` were collected by hand on 6 October 2026.

## Limitations

- **Coverage is regional.** Military aircraft, fires, earthquakes and satellites are worldwide, and
  civil aircraft follow the map from zoom 5.5 in. Ships, trains, public transport, roads, weather
  and the place search stay around the Baltic: no keyless source covers the world.
- **Only what broadcasts is seen.** Russian and Belarusian combat aircraft do not broadcast, and
  most warships sail with AIS off, so an empty list proves nothing. Roles and navy membership are
  read from type designators, AIS ship types and Wikidata: hints, not facts.
- **Ratings are word lists, not understanding.** A headline's importance and escalation level, and
  the alert log, come from keyword rules in five languages and can be wrong both ways. Each brief
  says whether a model or the rules wrote it.
- **Sharp imagery is not worldwide.** National air photos cover Latvia, Estonia and ten other
  countries (Lithuania's is built but switched off until its operator has been asked); everywhere
  else is the 10 m satellite mosaic. The deepest zoom over Latvia and Estonia shows about 0.25 m of
  ground per pixel.
- **The 3D city is only as good as its sources.** The official models are their publishers' own and
  a few years old. Elsewhere only a minority of buildings have a mapped roof shape, so most get a
  flat roof on their real footprint and height. In Sat 3D a tall building's roof photo can miss its
  roof, because air photos lean tall buildings away from the camera.
- **Some publishers allow only links.** Several broadcasters and newsrooms allow a headline with a
  link and nothing more, so their channels and articles open on their own pages.
- **Streams move.** Live camera and stream addresses change on their own and are looked up again
  regularly; a source that fails is shown as unavailable rather than as old data.

## Licence

The code is under the [MIT licence](LICENSE). The data is not: every source in the table above keeps
its own terms, and several are licensed for non-commercial use only, so the site stays free of
advertising and paid access. Anyone reusing the code with these feeds takes on those terms too.

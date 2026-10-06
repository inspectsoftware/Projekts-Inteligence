# Asset inventory — White Hornet promo

All plates are real 1920x1080 captures of the running app (`capture-app.mjs`), live data, 6 Oct 2026.
"Clean" = chrome hidden, map only. Window crops are pixel-exact cut-outs of the real UI.

## Zoom stack — one centre (Rātslaukums, Rīga old town, 56.9475 N 24.1064 E), all clean
- stack-1-dark-z5.png — dark tactical map, zoom 5.2: whole Baltic, Latvia outlined in glowing cyan
- stack-2-dark-z8.png — dark tactical map, zoom 8: Gulf of Rīga and central Latvia, live aircraft/train/ship marks, Rīga at exact centre
- stack-3-sat-z11.png — Sentinel-2 satellite basemap, zoom 11: Rīga and the Daugava from orbit
- stack-4-sat-z14.png — orthophoto, zoom 14: Rīga city centre, river and bridges
- stack-5-ortho-z16.png — 0.25 m orthophoto, zoom 16.3: old town roofs, street labels
- stack-6-ortho-z18.png — 0.25 m orthophoto, zoom 18: Rātslaukums square, cars and roofs visible

## Map plates
- map-baltic-dark.png — clean dark map, Latvia centred, shipping lanes and live marks
- map-plane-selected.png — full chrome, one aircraft (WZZ55KB) selected with ring, Inspector open right
- map-satellites.png — clean dark map zoom 3.6: whole Baltic + Scandinavia, undersea cables dashed, wide enough for orbit tracks
- map-gps-hex.png — clean dark map, GPS-interference hexes over the Baltic
- map-night.png — clean VIIRS night-lights basemap with live marks
- map-riga-3d.png — clean dark map, Rīga in 48 degree tilted 3D view
- map-radar.png — dark map with the rain-radar timeline window
- vision-nvg.png — Rīga 3D view in NVG green-phosphor vision mode
- vision-flir.png — Rīga 3D view in FLIR white-hot vision mode on satellite base
- vision-crt.png — dark map in CRT scanline vision mode

## Full UI plates
- ui-desktop.png — the whole desk: top bar, dock, Layers, Display, Alerts, Situation, Intel feed windows over Latvia
- ui-bare.png — same view with every window closed: top bar, dock, HUD, map
- ui-tv.png — Live TV window open, channel rail (Latvia / Lithuania / Estonia), empty player
- ui-cctv.png — Live CCTV window, grid of 32 official cameras
- ui-cctv-view.png — Live CCTV window showing the Rātslaukums camera enlarged
- ui-military.png — Military and Country briefs windows
- ui-palette.png — command palette open over a blurred desk, query "riga"

## Window crops (transparent-free rectangular cut-outs, native pixel size)
- win-inspector.png — 289x480, Inspector dossier for aircraft WZZ55KB (altitude, speed, track, squawk, MGRS); sat at x1620 y465 in the app
- win-tv.png — 1100x640, Live TV window; channel rail is local x0..176, the empty player is local x177..1099 y30..639
- win-cctv-grid.png — 1200x760, Live CCTV grid of official cameras
- win-cctv-view.png — 1200x760, Live CCTV single view: Rātslaukums at night
- cam-ratslaukums.png — 872x652, the Rātslaukums camera image alone
- win-layers.png — 240x420, Layers window; home position x57 y52
- win-display.png — 240x190, Display window (basemap + vision switches); home x57 y480
- win-alerts.png — 417x122, Alerts window; home x752 y52
- win-situation.png — 288x220, Situation window (power price, load); home x1578 y52
- win-intel.png — 341x301, Intel feed window; home x1568 y644
- win-palette.png — 546x426, command palette with results for "riga"; home x687 y129
- mark.svg — the app mark: Latvian flag on a dark rounded square with a cyan crosshair reticle

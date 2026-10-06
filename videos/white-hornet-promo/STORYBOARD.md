---
format: 1920x1080
duration: 45s
message: "One map. Every public signal about Latvia, live."
arc: Hook (boot) → One aircraft → Dive to a real place → Ground cameras → Live TV → Orbit → Everything at once → The desk → Lockup
audience: people seeing White Hornet for the first time
mode: autonomous
music: tense pulsing cinematic electronic, dark synth, driving
---

## Video direction

- **Palette system** (from `frame.md`): ground `#04070a`, text `#d5e1ea`, dim `#8499a8`, hairline `#1b2a35`. ONE accent, cyan `#4fd6ff`. Semantic colours only where the app uses them: orange `#ff8a3d` military, violet `#b78cff` satellites, green `#3ddc97` the "public sources" badge, red `#ff4d5e` / amber `#ffb020` warnings, `#a4e8ff` civil aircraft.
- **Type**: labels, readouts and chrome in JetBrains Mono Variable, UPPERCASE, tracking 0.14–0.3em, small. Headlines in Inter Variable 800, UPPERCASE, tight tracking, large. Square corners, 1px hairlines, panels `rgba(10,16,22,0.85)` + `#1b2a35` border. Every headline sits on a legible ground: when over a busy plate, put a dark gradient scrim behind it.
- **Real plates are the picture.** Captured app plates are full-bleed `<img>` at native 1920x1080; never redraw the UI. Motion comes from camera moves on plates and vector overlays (plane, satellites, reticles, HUD type) on top.
- **Motion grammar**: long-tail `power3` / `expo.out`, no bounce, no overshoot. Silent video: reveals land on a steady pulse (roughly every 0.5s), paced across the whole frame, never dumped at t=0. Camera moves are decisive and then STOP; holds are still. Cuts between plates inside a frame are velocity-matched (cut at peak speed).
- **HUD language**: thin cyan corner brackets, mono readouts that tick, a 1px reticle ring. Used sparingly, as the thread that ties frames together.
- **Rhythm**: frames 1 and 9 are quiet and held. Frames 2–6 each make one big move. Frame 7 is the loud one (fast cuts). Frame 8 calms into the full desk.
- **Negative list**: no bokeh, no purple "AI" gradients, no stock icons, no drop shadows, no bouncy eases, no lazy breathing, no slow drift in the back half of a frame. No broadcaster footage, no real faces, no logos of TV channels. No claim of global coverage: it is Latvia and the Baltic.
- **Keep-out**: plates are full-bleed, but all TYPE and focal overlays stay above y=900.

## Frame 1 — Boot

- scene: Black screen boots like the real app: three uplink lines type on, a cyan sweep, the wordmark locks in
- duration: 4s
- poster: 3.4s
- transition_in: cut
- status: animated
- src: compositions/frames/01-boot.html
- type: Hook
- persuasion: Curiosity gap
- beat: intrigue
- blueprint: typewriter-reveal (Adapt)
- asset_candidates: assets/mark.svg — the app mark, flag + cyan reticle
- focal: the wordmark WHITE HORNET
- roles: mark.svg = supporting (small, above the wordmark)
- sfx: typing, riser

narrativeRole: open cold inside the product's own boot screen.
keyMessage: something is coming online.

Adapt: keep the caret-types-a-line signature; three short log lines instead of one sentence, then the brand payoff.
Scene 1 (0.0–1.8s): pure `#04070a` ground with a faint 1px grid. Left-aligned block at centre-left (x≈560, y≈400), mono, small: the three real boot lines type on one after another behind a cyan block caret — **type-on with caret** (`discrete-text-sequence` + `context-sensitive-cursor`): `UPLINK ........ ESTABLISHING`, `BASEMAP ....... STANDBY`, `FEEDS ......... STANDBY`. As each next line starts, the previous line's status word flips to green `OK`.
Scene 2 (1.8–2.6s): a thin cyan sweep bar under the log runs left to right once (finite scaleX tween) and the last status flips to `24 FEEDS LIVE` in cyan.
Scene 3 (2.6–4.0s): the log block dims to 30%; dead-centre the mark (120px) fades up and directly under it `WHITE HORNET` in Inter 800, ~150px, tracking 0.18em, resolves via **3D char flip-decode** (`hacker-flip-3d`); below it mono `LATVIA // INTELLIGENCE PANEL` in dim text. Corner HUD brackets draw on (`svg-path-draw`). Holds still to the cut.

## Frame 2 — The plane

- scene: One aircraft flies across the live tactical map; it gets selected and its real dossier opens
- duration: 6s
- poster: 4.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-plane.html
- type: Product_Intro
- persuasion: Show-don't-tell proof
- beat: curiosity + control
- blueprint: compose
- asset_candidates: assets/stack-2-dark-z8.png — clean dark tactical map, Rīga at exact centre; assets/win-inspector.png — real Inspector dossier for aircraft WZZ55KB, 289x480
- focal: the hero aircraft (vector, drawn in code)
- roles: stack-2-dark-z8.png = background (full-bleed, NOT dimmed; it is the product) · win-inspector.png = supporting (right side)
- sfx: whoosh, ui-click
- handoff_out: map plate `stack-2-dark-z8.png` full-bleed at x=0 y=0 scale=1 opacity=1, no motion. Hero aircraft icon centred at x=960 y=540, rotation=35deg (nose up-right), rendered size 96px, colour #ffffff, opacity=1, speed 0. Cyan selection ring centred x=960 y=540, diameter 150px, 2px stroke #4fd6ff, opacity=1. Inspector and headline may be anything (they do not continue).

narrativeRole: the user's premise — a single plane on the map — proves the data is live and inspectable.
keyMessage: every aircraft, live, one click from its full record.

The hero aircraft is an inline SVG using the app's own icon path (64x64 box, nose up): `M32 3C35 3 36.5 8 36.5 14L36.5 24L60 41L60 46L36.5 39L36 52L44 58L44 61L32 58L20 61L20 58L28 52L27.5 39L4 46L4 41L27.5 24L27.5 14C27.5 8 29 3 32 3Z`. Fill `#a4e8ff` with a dark halo (`rgba(4,7,10,0.85)` stroke 6px behind); it turns white when selected. Rotate the SVG with GSAP `rotation` (nose-up = 0deg).
Scene 1 (0.0–2.6s): the map plate is full-bleed, starting at scale 1.12 centred on (960,540) and easing down to scale 1.0 by 2.6s (one decisive pull-back, `multi-phase-camera`, then it STOPS for good). The hero aircraft enters from the lower-left edge (x≈250, y≈930) and flies a gentle curve toward the centre, nose following the path (rotation ≈50deg easing to 35deg), leaving a thin 2px cyan trail that draws behind it (`svg-path-draw`). A mono callsign label `WZZ55KB` rides at its upper-right. Top-left, above the map on a dark scrim: mono kicker `AIR // ADS-B + MLAT` types on.
Scene 2 (2.6–3.8s): the aircraft arrives at exact centre (960,540) and settles (long-tail). On arrival a cyan selection ring snaps on around it (scale 1.6→1, `spring-pop-entrance` in its smooth register) and the icon turns white. Headline top-left under the kicker: `EVERY AIRCRAFT. LIVE.` — per-word reveal (`dynamic-content-sequencing`).
Scene 3 (3.8–5.2s): the real Inspector (`win-inspector.png`, native 289x480, shown at 1.5x) slides in from the right edge to rest at right side (its left edge ≈ x=1400, vertically centred ≈ y=180..900), with a 1px cyan leader line drawing from the ring to the panel's edge (`svg-path-draw`). Three cyan tick marks pulse once down the panel's rows in sequence (altitude, speed, position).
Scene 4 (5.2–6.0s): everything holds still; only the ring does one slow finite pulse. End state matches `handoff_out` exactly.

## Frame 3 — The dive

- scene: The camera drops straight down through the plane's position: tactical map, satellite view, then 25 cm air photo of a real square
- duration: 5s
- poster: 4.6s
- transition_in: cut
- status: animated
- src: compositions/frames/03-dive.html
- type: Key_Feature
- persuasion: Show-don't-tell proof
- beat: awe
- blueprint: compose
- asset_candidates: assets/stack-2-dark-z8.png — dark map zoom 8, Rīga at centre; assets/stack-3-sat-z11.png — satellite zoom 11, same centre; assets/stack-4-sat-z14.png — orthophoto zoom 14, same centre; assets/stack-5-ortho-z16.png — orthophoto zoom 16.3, same centre; assets/stack-6-ortho-z18.png — orthophoto zoom 18, Rātslaukums square
- focal: the zoom itself, ending on stack-6-ortho-z18.png
- roles: all five plates = background (full-bleed, stacked, never dimmed)
- sfx: whoosh, impact
- handoff_in: map plate `stack-2-dark-z8.png` full-bleed at x=0 y=0 scale=1 opacity=1. Hero aircraft icon centred at x=960 y=540, rotation=35deg, 96px, #ffffff, opacity=1, speed 0. Cyan selection ring centred x=960 y=540, diameter 150px, 2px #4fd6ff, opacity=1.
- handoff_out: plate `stack-6-ortho-z18.png` full-bleed at x=0 y=0 scale=1 opacity=1, no motion. Cyan reticle ring centred x=960 y=540, diameter 150px, 2px stroke #4fd6ff, opacity=1, with four 20px tick marks at N/E/S/W. No aircraft. HUD text may be anything.

narrativeRole: "transitions into an actual place" — the abstract map becomes a real square you could stand in.
keyMessage: from the whole country down to 25 centimetres per pixel.

All five plates share one centre pixel (960,540) and differ only in zoom level z: 8, 11, 14, 16.3, 18. Build ONE continuous zoom: drive a single proxy value Z from 8 to 18 on the timeline (ease: slow start, fast middle, long-tail landing — e.g. `power2.inOut` into the final second). In `onUpdate`, set every plate's scale to `2^(Z − z_plate)` with `transform-origin: 960px 540px`, and its opacity so that plate i is fully opaque while Z is within its range and cross-dissolves into plate i+1 over the last ~0.6 zoom levels before `z_(i+1)` (a plate is only ever shown at scale 1 or larger, never smaller than the frame; hide plates whose scale exceeds ~12). This is deterministic and seek-safe (pure function of Z). Add a radial motion-blur feel during the fast middle with a short `filter: blur()` peak on the plate layer (`motion-blur-streak`), zero at both ends.
Scene 1 (0.0–0.7s): starts exactly as `handoff_in`. The aircraft icon scales up to ~7x and fades to 0 as the camera passes down through it; the selection ring stays locked at centre and becomes the dive reticle (same position and size throughout the frame). Top-left mono kicker `DISPLAY // DARK → SAT`.
Scene 2 (0.7–3.6s): the continuous dive from Z=8 to Z≈17. Left edge, mono HUD stack ticking live from the same proxy: `Z 08.00` counting up, `ALT 11 278 M` counting down toward 0, fixed `56.9475° N  024.1064° E`. A basemap tag swaps by hard cut as plates change: `DARK` → `SENTINEL-2` → `ORTHOPHOTO 0.25 M` (`discrete-text-sequence`).
Scene 3 (3.6–5.0s): the last second eases to a dead stop at Z=18 on the square. The reticle gains four tick marks. Headline lower-left on a dark scrim (above y=900): `RĀTSLAUKUMS, RĪGA` with mono sub `25 CM PER PIXEL`. Holds still; end state matches `handoff_out`.

## Frame 4 — Ground truth

- scene: The reticle on the square opens into that square's live official camera, then pulls back to a wall of cameras
- duration: 4s
- poster: 3.4s
- transition_in: cut
- status: animated
- src: compositions/frames/04-cameras.html
- type: Key_Feature
- persuasion: Show-don't-tell proof
- beat: clarity + trust
- blueprint: compose
- asset_candidates: assets/stack-6-ortho-z18.png — orthophoto of Rātslaukums square; assets/win-cctv-view.png — Live CCTV window showing the Rātslaukums camera, 1200x760; assets/win-cctv-grid.png — Live CCTV grid of official cameras, 1200x760
- focal: assets/win-cctv-view.png
- roles: stack-6-ortho-z18.png = background (full-bleed; dims to ~45% once the window is open) · win-cctv-view.png = cutout (hero window) · win-cctv-grid.png = supporting (replaces the hero in the back half)
- sfx: ui-click, whoosh
- handoff_in: plate `stack-6-ortho-z18.png` full-bleed at x=0 y=0 scale=1 opacity=1, no motion. Cyan reticle ring centred x=960 y=540, diameter 150px, 2px #4fd6ff, opacity=1, four 20px ticks at N/E/S/W.

narrativeRole: the place from above becomes the place right now, at street level.
keyMessage: official public cameras, on the same map.

Scene 1 (0.0–1.5s): starts exactly as `handoff_in`. At 0.3s the reticle blinks once and the real camera window (`win-cctv-view.png`, native 1200x760) expands out of the reticle — **card morph-anchor** (`card-morph-anchor`): from a 150px square at centre (uniform `scale` from ~0.12, opacity 0→1) to full size centred at x=360..1560, y=110..870. The orthophoto behind dims to ~45% and blurs slightly (`depth-of-field-blur`). Mono tag above the window, left: `LIVE CCTV // RĀTSLAUKUMS`, with a small red `● LIVE` dot.
Scene 2 (1.5–2.7s): **scale-swap** (`scale-swap-transition`) at the same centre: the single view shrinks and fades as the camera grid (`win-cctv-grid.png`, same 1200x760 box) arrives in its place. A cyan highlight box steps across four tiles of the top row, one per beat.
Scene 3 (2.7–4.0s): headline over the lower part of the frame on a dark scrim (y≈780..890, above 900): `32 CAMERAS. OFFICIAL FEEDS ONLY.` — per-word reveal (`dynamic-content-sequencing`); mono chips `LV` `EE` `LT` pop in a row beside it. Holds still.

## Frame 5 — Live TV

- scene: The Live TV window flicks through parliament, cabinet and president channels; the player shows an abstract speaker and a live waveform
- duration: 6s
- poster: 4.5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-tv.html
- type: Key_Feature
- persuasion: Feature-to-benefit translation
- beat: confidence
- blueprint: compose
- asset_candidates: assets/win-tv.png — Live TV window with the real channel rail and an empty player, 1100x640; assets/map-baltic-dark.png — clean dark map, backdrop
- focal: assets/win-tv.png
- roles: map-baltic-dark.png = background (full-bleed, dimmed ~40%) · win-tv.png = cutout (hero window)
- sfx: ui-click, glitch

narrativeRole: "TV stations, politicians talking" — the room where decisions are announced is one click away.
keyMessage: parliament, cabinet and president streams next to the map.

HARD RULE: no broadcaster footage, no real people, no channel logos. The player content is an abstract illustration drawn in code.
Show `win-tv.png` at 1.4x (1540x896) centred, top edge at y≈30 (x=190..1730, y=30..926 is fine since it is a plate; keep added TYPE above y=900). In window-local native pixels the channel rail is x0..176 and the empty player is x177..1099, y30..639. Channel rows (local y centre, 24px tall, x8..170): `LTV news` 71, `Saeima` 96, `Cabinet of Mi…` 120, `President of …` 145, `Seimas` 419, `Riigikogu` 521. Position overlays in the window's local coordinate space inside one wrapper that carries the 1.4x scale.
The stand-in player content (drawn in code, fills the player rect): a dark navy field with a soft vignette; a generic speaker silhouette (plain head-and-shoulders shape, flat `#1b2a35`, no features) behind a simple lectern block with two thin microphone lines; a row of ~40 thin cyan audio bars along the bottom third whose heights animate from a deterministic array (index-derived, no randomness); a lower-third bar bottom-left: red `● LIVE` chip + channel title + mono sub-line; top-right a tiny mono tag `ILLUSTRATION`.
Scene 1 (0.0–1.2s): the window rises into place over the dimmed map (y +60→0, opacity 0→1, long-tail). Top-left of frame, mono kicker `LIVE TV // 24 CHANNELS · LV LT EE` types on. Player is the empty dark state.
Scene 2 (1.2–2.4s): a cyan highlight box lands on rail row `Saeima`; the player hard-cuts on (2-frame horizontal glitch slice, then clean) to the stand-in with lower-third `SAEIMA` / `PLENARY SITTING`; bars start moving.
Scene 3 (2.4–3.5s): highlight steps to `Cabinet of Mi…`; player glitch-cuts: lectern shifts left, silhouette shifts right (a different "shot"), lower-third `CABINET OF MINISTERS` / `PRESS BRIEFING`.
Scene 4 (3.5–4.6s): highlight steps to `President of …`; glitch-cut: centred silhouette, two flag-pole rectangles behind in flat carmine `#9e3039` and off-white stripes (Latvian flag as plain stripes), lower-third `PRESIDENT OF LATVIA` / `ADDRESS`.
Scene 5 (4.6–6.0s): highlight jumps down the rail to `Seimas` then `Riigikogu` in two quick beats (player glitch-cuts each time, lower-thirds `SEIMAS` then `RIIGIKOGU`). Headline bottom-left of frame on a dark scrim, above y=900: `WHO IS SPEAKING. RIGHT NOW.` — hard-cut word build (`discrete-text-sequence`). Holds; bars keep moving to the end (finite tweens).

## Frame 6 — Orbit

- scene: Hard pull-back to orbit: violet satellites cross the Baltic on their ground tracks while GPS-interference hexes pulse red
- duration: 5s
- poster: 4s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/06-orbit.html
- type: Key_Feature
- persuasion: Authority by association
- beat: awe + tension
- blueprint: compose
- asset_candidates: assets/map-satellites.png — clean dark map of the whole Baltic and Scandinavia, wide; assets/stack-1-dark-z5.png — dark map zoom 5.2, Latvia glowing at centre
- focal: the satellites (vector, drawn in code) over assets/map-satellites.png
- roles: stack-1-dark-z5.png = background (opening state, zooms away) · map-satellites.png = background (the wide view it lands on, full-bleed, not dimmed)
- sfx: whoosh, riser

narrativeRole: "satellites" — the same panel looks up as well as down.
keyMessage: what is overhead, and where GPS is being jammed.

Satellite icon, the app's own path (64x64 box): `M26 24H38V40H26ZM4 27H22V37H4ZM42 27H60V37H42ZM22 30.5H26V33.5H22ZM38 30.5H42V33.5H38Z`, fill violet `#b78cff`, ~44px, with a dark halo. In `map-satellites.png` Latvia sits around x=770..1230, y=480..760.
Scene 1 (0.0–1.2s): opens on `stack-1-dark-z5.png` full-bleed at scale 2.2 (tight on Latvia at centre) and pulls back hard to scale 1.0 while cross-dissolving into `map-satellites.png` (velocity-matched, `multi-phase-camera`); a brief blur peak mid-move (`motion-blur-streak`). Then the camera STOPS.
Scene 2 (1.2–3.2s): three curved ground tracks draw across the map as thin dashed violet lines (`svg-path-draw`), each led by a satellite icon travelling along it (finite motion, different speeds): one north–south just west of Latvia, one diagonal across Estonia, one sweeping over the southern Baltic. Mono labels ride beside each: `ISS`, `SENTINEL-2B`, `NOAA-20`. Top-left on a dark scrim, mono kicker `SPACE // PROPAGATED LIVE` then headline `OVERHEAD. TRACKED.` (per-word reveal, `dynamic-content-sequencing`).
Scene 3 (3.2–5.0s): seven flat-top hexagons fade in sequentially over the sea west and north of Latvia (around x=560..900, y=330..700): four red `#ff4d5e` at 35% fill, three amber `#ffb020`, each with a 1px outline; each does ONE finite pulse on entry. A mono callout with a leader line from the cluster: `GPS INTERFERENCE` / `LAST 90 MIN`, and a counter that ticks `00 → 13 AIRCRAFT DEGRADED` (`counting-dynamic-scale`). Satellites keep travelling to the end. Holds.

## Frame 7 — Everything

- scene: Fast cuts through every view of the product on the beat: air, sea, land, space, signals, night lights, night vision, thermal
- duration: 7s
- poster: 5.8s
- transition_in: cut
- status: animated
- src: compositions/frames/07-everything.html
- type: Benefits
- persuasion: Value stacking
- beat: excitement + power
- blueprint: kinetic-type-beats (Adapt)
- asset_candidates: assets/map-baltic-dark.png — clean dark map, Latvia with shipping lanes and live marks; assets/map-riga-3d.png — Rīga in tilted 3D; assets/map-gps-hex.png — GPS interference hexes; assets/map-night.png — night-lights basemap; assets/vision-nvg.png — NVG green vision mode; assets/vision-flir.png — FLIR white-hot vision mode; assets/ui-military.png — Military and Country briefs windows; assets/map-radar.png — rain radar timeline
- focal: the cut rhythm itself; each plate is hero for its beat
- roles: all eight plates = background (full-bleed, one per beat, each dimmed ~25% under its word)
- sfx: impact, impact, impact, glitch, riser

narrativeRole: "shows off the whole website, go crazy" — the loud beat; breadth at speed.
keyMessage: 24 live feeds, one map.

Adapt: keep the kinetic-type signature (one huge word per beat, hard cuts) but each word sits over a real plate that punches in.
Eight beats on a steady pulse, each plate hard-cutting in at scale 1.08 and easing to 1.0 (never drifting after), with ONE giant word (Inter 800, ~260px, UPPERCASE, centred at y≈470) slamming in via **kinetic beat-slam** (`kinetic-beat-slam`), and a small mono sub-label under it. A persistent mono counter top-right ticks up one step per beat toward 24: `03 / 24 FEEDS` … (`counting-dynamic-scale`). Thin cyan HUD brackets at the corners persist across all beats.
Scene 1 (0.0–0.8s): `map-baltic-dark.png` — `AIR` / `ADS-B · MLAT · MILITARY`.
Scene 2 (0.8–1.6s): same plate shifted (translate so the shipping lanes are centred) — `SEA` / `AIS · SANCTIONED · SHADOW FLEET`, word tinted green `#3ddc97`.
Scene 3 (1.6–2.4s): `map-riga-3d.png` — `LAND` / `TRAINS · TRANSIT · ROADS`.
Scene 4 (2.4–3.2s): `map-gps-hex.png` — `SIGNALS` / `GPS INTERFERENCE`, word tinted red `#ff4d5e`.
Scene 5 (3.2–4.0s): `map-night.png` — `NIGHT` / `VIIRS NIGHT LIGHTS`.
Scene 6 (4.0–4.7s): `vision-nvg.png` — `NVG`, with a 2-frame horizontal glitch slice on the cut; word in phosphor green.
Scene 7 (4.7–5.4s): `vision-flir.png` — `FLIR`, glitch slice on the cut; word white.
Scene 8 (5.4–7.0s): `ui-military.png` dimmed 55% — the counter lands on `24 / 24 FEEDS` and the centre word is replaced by a two-line lockup: `24 LIVE FEEDS.` / `ONE MAP.` (second line cyan), landing with a long-tail settle and then holding dead still for the last ~0.9s.

## Frame 8 — The desk

- scene: The whole desk assembles: real windows snap into their slots around Latvia, then the command palette opens and searches
- duration: 4s
- poster: 3.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-desk.html
- type: Product_Intro
- persuasion: Show-don't-tell proof
- beat: control + ease
- blueprint: zoom-out-workspace-reveal (Adapt)
- asset_candidates: assets/ui-bare.png — the app with every window closed: top bar, dock, HUD, map of Latvia; assets/win-layers.png — Layers window 240x420, home x57 y52; assets/win-display.png — Display window 240x190, home x57 y480; assets/win-alerts.png — Alerts window 417x122, home x752 y52; assets/win-situation.png — Situation window 288x220, home x1578 y52; assets/win-intel.png — Intel feed window 341x301, home x1568 y644; assets/win-palette.png — command palette 546x426 with results for "riga", home x687 y129
- focal: assets/ui-bare.png as the whole product
- roles: ui-bare.png = background (full-bleed, NOT dimmed until the palette opens) · the five window crops = supporting (each lands at its exact home pixel position, native size) · win-palette.png = cutout (centre, last)
- sfx: ui-click, ui-click, whoosh

narrativeRole: after the montage, show the actual product, whole and calm.
keyMessage: this is the real interface.

Adapt: keep the signature — open tight, ONE decelerating zoom-out reveals the whole workspace — then assemble the windows on top.
Scene 1 (0.0–1.0s): `ui-bare.png` full-bleed starting at scale 1.6 centred on Latvia (≈ x=960, y=540) and decelerating to scale 1.0 (`multi-phase-camera`), then it STOPS.
Scene 2 (1.0–2.4s): the five real windows snap into their home slots one per beat, each sliding ~40px from its nearest screen edge with opacity 0→1 (long-tail, no bounce) at native size and exact home position: `win-layers.png` (57,52), `win-alerts.png` (752,52), `win-situation.png` (1578,52), `win-display.png` (57,480), `win-intel.png` (1568,644). As each lands, a 1px cyan snap-guide line flashes along its aligned edge for a few frames.
Scene 3 (2.4–4.0s): the desk dims to ~45% and blurs slightly (`depth-of-field-blur`); the command palette `win-palette.png` drops in at its home (687,129) at native size (opacity 0→1, y −16→0). A cyan block caret blinks after the query text area for two finite blinks (`context-sensitive-cursor`), and a cyan highlight bar steps down the first three result rows (row height ≈31px starting at palette-local y≈50). Mono caption centred below the palette at y≈610 on a scrim: `CTRL + K  ·  FIND ANYTHING`. Holds.

## Frame 9 — Lockup

- scene: End card: the mark, WHITE HORNET, Latvia intelligence panel, public sources only
- duration: 4s
- poster: 2.8s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/09-lockup.html
- type: Brand_Outro
- persuasion: Risk reversal
- beat: trust + inevitability
- blueprint: logo-assemble-lockup (Adapt)
- asset_candidates: assets/mark.svg — the app mark, flag + cyan reticle; assets/stack-1-dark-z5.png — dark map with Latvia glowing, backdrop
- focal: assets/mark.svg + the wordmark
- roles: stack-1-dark-z5.png = background (full-bleed, dimmed ~70%, static) · mark.svg = cutout (centre, above the wordmark)
- sfx: impact

narrativeRole: name it and state the ethic.
keyMessage: White Hornet. Public sources only.

Adapt: keep the signature — the mark comes to exist from parts — the reticle draws on first, then the lockup.
Scene 1 (0.0–1.2s): dimmed map backdrop, still. Dead-centre at y≈330 a cyan reticle ring (170px) and its four ticks draw on (`svg-path-draw`); the mark (`mark.svg`, 150px) fades up inside it as the ring completes.
Scene 2 (1.2–2.4s): `WHITE HORNET` in Inter 800, ~170px, tracking 0.16em, centred at y≈540, letters cascading in left to right with a long-tail settle (`dynamic-content-sequencing`); a 1px cyan hairline draws outward from centre beneath it.
Scene 3 (2.4–3.4s): mono `LATVIA // INTELLIGENCE PANEL` fades up under the hairline (y≈680), then a green-outlined badge `PUBLIC SOURCES ONLY` (1px `#3ddc97` border, green mono text) pops in below it (y≈760).
Scene 4 (3.4–4.0s): final frame — everything holds, then fades to the `#04070a` ground over the last 0.5s.

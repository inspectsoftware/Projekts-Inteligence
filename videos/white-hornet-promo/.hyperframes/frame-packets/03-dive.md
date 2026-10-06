# Frame packet: 03-dive

## Project inputs

- Project: C:\Users\n\Desktop\Project-White-Hornet\videos\white-hornet-promo
- Design tokens: C:\Users\n\Desktop\Project-White-Hornet\videos\white-hornet-promo\frame.md
- RULES_DIR: C:\Users\n\.claude\plugins\cache\hyperframes\hyperframes\0.8.137\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 — The dive

- scene: The camera drops straight down through the plane's position: tactical map, satellite view, then 25 cm air photo of a real square
- duration: 5s
- poster: 4.6s
- transition_in: cut
- status: outline
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

## Selected motion rule: discrete-text-sequence

---
name: discrete-text-sequence
description: Replace entire text states at frame thresholds for non-linear typing effects — typos, bulk additions, pauses, backspaces, simulated thinking.
metadata:
  tags: text, typing, discrete, threshold, non-linear, sequence
---

# Discrete Text Sequence

Instead of character-by-character typewriter, replace entire string states at time thresholds — enabling non-linear effects (typos, backspaces, bulk paste, "thinking" gaps) that smooth per-char typing can't achieve. If your effect is "type each character, no edits", this rule is overkill — use the smooth-slice variation below.

## How It Works

The typing is authored as a sparse array of `{ t, text }` states; on every `onUpdate` a **reverse search** finds the latest entry whose `t` has passed and renders its text. Display jumps between states with no animation between them — the realism comes from the schedule shape: fast keystroke clusters (0.06–0.20s apart), pauses at word breaks (0.3–0.6s), a typo, backspaces peeling back to the fork, then a bulk paste replacing many chars in one entry. A block cursor blinks via a deterministic sin square wave on the same timeline.

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="terminal">
  <div class="prompt">$</div>
  <div class="text-wrap">
    <span class="text" id="text"></span><span class="cursor" id="cursor">_</span>
  </div>
</div>
```

```css
.terminal {
  font-family: {monoFont}; /* monospace required — proportional jitters even in a fixed box */
  display: flex;
  align-items: baseline;
  font-size: TERMINAL_FONT_SIZE;
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  min-width: TEXT_WRAP_MIN_WIDTH; /* ≥ widest state — stops right-edge jitter */
  white-space: nowrap;
}
.cursor {
  display: inline-block; /* inline ignores width */
  width: CURSOR_WIDTH;
}
```

```js
// Each entry shows from its t until the NEXT entry's t.
// Shape: keystrokes → typo → backspace to the fork → bulk paste → completion mark.
const SEQUENCE = [
  { t: 0.0, text: "" },
  { t: T_K1, text: "{p1}" }, // first keystrokes (~3-5 chars, 0.1-0.2s apart)
  { t: T_K2, text: "{p1 + ' ' + p2_typo}" }, // continuation containing a typo
  { t: T_BS, text: "{p1 + ' ' + p2_partial}" }, // backspace(s) — peel back to the fork
  { t: T_BULK, text: "{fullCorrectedText}" }, // bulk paste — many chars in one jump
  { t: T_DONE, text: "{fullCorrectedText + ' ✓'}" }, // completion marker
];

// Reverse-search for the latest entry whose t has passed
function textAt(time) {
  for (let i = SEQUENCE.length - 1; i >= 0; i--) {
    if (time >= SEQUENCE[i].t) return SEQUENCE[i].text;
  }
  return "";
}

const textEl = document.getElementById("text");
const cursorEl = document.getElementById("cursor");

const driver = { t: 0 };
tl.to(
  driver,
  {
    t: TOTAL_DURATION,
    duration: TOTAL_DURATION,
    ease: "none",
    onUpdate: () => {
      textEl.textContent = textAt(driver.t);
    },
  },
  0,
);

// Cursor blink — deterministic sin square wave, never a CSS animation
const blink = { p: 0 };
tl.to(
  blink,
  {
    p: Math.PI * 2 * BLINK_CYCLES,
    duration: TOTAL_DURATION,
    ease: "none",
    onUpdate: () => {
      cursorEl.style.opacity = Math.sin(blink.p) > 0 ? "1" : "0";
    },
  },
  0,
);
```

## Variations

- **Smooth character slice** (continuous typewriter — no pauses, no edits): faster to author but uniformly "machine-typed", missing the human realism:

```js
const fullText = "{fullPhrase}";
const len = { v: 0 };
tl.to(
  len,
  {
    v: fullText.length,
    duration: TYPE_DUR,
    ease: "power1.inOut",
    onUpdate: () => {
      textEl.textContent = fullText.substring(0, Math.floor(len.v));
    },
  },
  0,
);
```

- **Thinking pause** — hold one state for `THINK_HOLD_DUR` (0.8–2.0s; under 0.5s reads as a stutter, not thought) simply by leaving a gap before the next entry's `t`.
- **State pulse on completion** — when the final state lands, `tl.to(".text", { scale: 1.03–1.08, duration: 0.15–0.3, yoyo: true, repeat: 1 }, T_DONE)`.
- **Per-state color shift** — in `onUpdate`, branch on `driver.t` vs the milestones: success color after `T_DONE`, dim mid-edit, normal while typing.

## Values

| token               | range                                        | notes                                                                  |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| TERMINAL_FONT_SIZE  | 48–96px                                      | full-bleed comps; smaller for terminal-style detail                    |
| TEXT_WRAP_MIN_WIDTH | ≥ widest state                               | measure with a hidden probe after `document.fonts.ready` if unsure     |
| milestone `t`s      | keystrokes 0.06–0.20s apart; pauses 0.3–0.6s | monotonically increasing; `T_DONE ≤ TOTAL_DURATION − ~1s` climax dwell |
| TYPE_DUR (smooth)   | `chars × 0.06–0.12s`                         | fast → relaxed                                                         |
| BLINK_CYCLES        | one cycle per 0.5–0.8s                       | `TOTAL_DURATION / 0.8 ≤ BLINK_CYCLES ≤ TOTAL_DURATION / 0.5`           |
| CURSOR_WIDTH        | ~0.3× font size                              | gap to text single-digit px so the cursor feels attached               |

## Critical Constraints

- **Reverse-search the array each frame** — O(n) with small n (≤30 typical); don't index by frame, the sequence is sparse.
- **`min-width` on the text wrap is mandatory** — without it the right edge jitters as state length changes.
- **Discrete jumps must be INSTANT** — any transition on the text turns the jump into a smear and kills the "typing" feel.
- **Cursor blink is sin/sequence-driven on the timeline**, `display: inline-block`, monospace font, `white-space: nowrap` (wrapping mid-state breaks the illusion; trailing spaces must survive).
- **Discrete vs smooth** — use discrete only for non-linear states (typos, pauses, bulk paste); plain typing takes the smooth-slice variation.

## See also

`context-sensitive-cursor` (same SEQUENCE pattern + segment-colored cursor) · `3d-text-depth-layers` (discrete text with layered depth) · `counting-dynamic-scale` (discrete label beside a smooth counter) · `press-release-spring` (post-completion press beat).

## Selected motion rule: motion-blur-streak

---
name: motion-blur-streak
description: Fake directional velocity blur on a fast entrance or camera push-through — blur peaks at max speed and resolves to 0 at the settle, so the element streaks in then snaps sharp. Two paths — SVG feGaussianBlur on the motion axis, or an echo/ghost trail that collapses into the lead. Plus a per-frame-driven form for an element riding a baked track (tracked insert, shake-matched title): velocity-gated text-free silhouette ghosts (or a rotate/blur/counter-rotate filter sandwich when a true blur is the look), streak axis from the track delta.
metadata:
  tags: motion-blur, velocity, streak, entrance, fly-in, ghost, echo, svg-filter, kinetic, camera, snap, driven, tracked, baked-track
---

# Motion-Blur Streak

Real motion blur isn't available to a seeked renderer (it integrates over shutter time), so this rule **fakes** it for a fast fly-in or hard camera push-through. The whole point is the _coupling_: the blur envelope rides the **same ease and window** as the position tween, so peak blur lands exactly on peak speed and the element is razor-sharp the instant it stops. Two paths:

- **(A) Directional SVG blur** — inline `<feGaussianBlur stdDeviation="X 0">` (X on the motion axis, 0 across it), tweened via a proxy. Cleanest; a true directional smear.
- **(B) Echo / ghost trail** — 2–4 duplicates at decreasing opacity, offset backward along the motion vector, collapsing into the lead as it settles. No filter cost; a stylized "speed-line" trail.

Both paths assume a **tween window** — an element driven per frame from a baked track has none; that form is the Per-Frame-Driven Carve-In below.

**Entrances and mid-shot moves only — never a mid-composition exit.** A blurred element fleeing off-frame mid-composition reads as a glitch; a hard exit between scenes is the transition's job (`../transitions/overview.md`). Two sanctioned scope extensions: the envelope may ride the **camera wrapper** during a travel leg (Camera-Travel Carve-Out), or become a per-frame function of a baked track for a **driven element** (Per-Frame-Driven Carve-In).

## How It Works

A fast `out`-eased move front-loads velocity — fastest off the start, bleeding to zero at the settle. Map the blur/echo envelope onto that same curve: position travels from an off-frame / pushed-back start to rest over `MOVE_DUR`; in lockstep on the same window and ease the smear goes `PEAK_BLUR → 0` (A) or the ghosts collapse onto the lead (B). By the settle the element is fully crisp and dwells ≥1 s — the contrast between violent streak and still, sharp settle IS the effect. GSAP can't tween an SVG attribute directly: tween a plain `{ v }` proxy and write `setAttribute("stdDeviation", …)` in `onUpdate`, seeding it once at setup so a seek to t=0 shows the streaked start.

## Recipe

```html
<!-- inside a standard scene clip; overflow: hidden on the scene (the smear extends past rest) -->
<svg width="0" height="0" aria-hidden="true" style="position: absolute">
  <filter id="streak" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur id="streak-blur" in="SourceGraphic" stdDeviation="0 0" />
  </filter>
</svg>
<div class="streak-el" id="streak-el" style="filter: url(#streak)">{phrase}</div>
<!-- Path B instead: N-1 aria-hidden .streak-ghost duplicates BEHIND the lead, no filter -->
```

```js
// Path A — proxy-tweened directional blur.
const blurNode = document.getElementById("streak-blur");
const blurProxy = { v: PEAK_BLUR };
const writeBlur = () => blurNode.setAttribute("stdDeviation", `${blurProxy.v} 0`); // X axis only
writeBlur(); // seed frame 0 — a seek to t=0 must show the streaked start, not a sharp pre-frame

tl.fromTo(
  "#streak-el",
  { x: ENTER_FROM_X, opacity: 0 },
  { x: 0, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
  MOVE_START,
);
tl.to(blurProxy, { v: 0, duration: MOVE_DUR, ease: MOVE_EASE, onUpdate: writeBlur }, MOVE_START);

// Path B — ghosts on the SAME window/ease; per-ghost variation by index.
gsap.utils.toArray(".streak-ghost").forEach((g) => {
  const i = Number(g.dataset.i); // 1..N-1, set in HTML
  tl.fromTo(
    g,
    { x: ENTER_FROM_X - i * ECHO_STEP_PX, opacity: GHOST_BASE_OPACITY / i },
    { x: 0, opacity: 0, duration: MOVE_DUR, ease: MOVE_EASE },
    MOVE_START,
  );
});
```

## Variations

- **Vertical streak** — swap axes: `y`, `stdDeviation="0 Y"`, vertical echo offsets.
- **Camera push-through** — `scale: SCALE_FROM → 1` with a symmetric `"B B"` envelope (depth-wise smear, not directional): the wordmark punches out of soft focus and snaps crisp at the lock.
- **Staggered grid streak-in** — each card streaks into its slot at `MOVE_START + i * CARD_STAGGER` with its own blur proxy / ghosts; sharp the instant it lands.
- **Hold-the-streak** — blur on a marginally slower curve than position (position `expo.out`, blur `power3.out`) so the last wisp resolves just after arrival. Sparingly; default is locked envelopes.

## Camera-Travel Carve-Out

The envelope is also sanctioned at **wrapper level**: on the `.world` / camera wrapper of a virtual-camera scene ([viewport-change.md](viewport-change.md), [multi-phase-camera.md](multi-phase-camera.md), [3d-camera-flight.md](3d-camera-flight.md)) during a **travel leg** — a dive, a whip sweep, a violent final push. This does **not** violate "never a mid-composition exit": the world never leaves frame — the camera travels _through_ it, and every leg ends with the world at rest, sharp, inside the frame. Each leg is an **arrival** at the next pose, so the entrance doctrine applies leg by leg. Three deltas from the element-level recipe:

- **Envelope follows the leg's ease.** An `out` leg (dive, final push) uses the base recipe unchanged. An `inOut` repositioning leg peaks mid-leg: split the envelope at the velocity peak — `0 → PEAK` on the in-half ease over the first half, `PEAK → 0` on the out-half over the second. Seed the proxy at **0** for these (the streaked state lives mid-leg, not at t=0; seed-at-`PEAK_BLUR` belongs to the entrance shape, where the first frame IS the fastest).
- **Filter placement.** 2D camera: `filter: url(#streak)` on the `.world` wrapper. 3D flight: on the **perspective stage** above the 3D context — a `filter` on a `preserve-3d` element flattens it and collapses every `translateZ`. Never per-element inside the world: one frame-wide envelope, not N desynced ones.
- **Full-frame blur is heavy** — cap `PEAK_BLUR` ~18–20 at wrapper level (vs 30 for one element); a brief whip may touch ~24. Axis rule as usual: `"X 0"` for a lateral whip/pan, `"B B"` for a dive/push.

### Whip sweep (named composition)

The heavily-blurred lateral whip that resolves into the next region — two rules on one window:

1. **Position** — [nudge-curve.md](nudge-curve.md)'s three-phase chain on the camera state, tuned burst-dominant (tail still ≥3× ramp-in in time).
2. **Blur** — `0 → PEAK` across the ramp-in, held at `PEAK` through the linear burst (constant velocity = constant smear), `PEAK → 0` across the tail.

Swap or reveal the next region's content DURING the burst — the smear masks the change; the `power4.out` tail lands it sharp. Reveal during the burst, read after the tail.

```js
tl.to(cam, { x: WHIP_X * 0.1, duration: 0.12, ease: "power3.in", onUpdate: applyCamera }, WHIP_AT);
tl.to(
  cam,
  { x: WHIP_X * 0.75, duration: 0.1, ease: "none", onUpdate: applyCamera },
  WHIP_AT + 0.12,
);
tl.to(
  cam,
  { x: WHIP_X, duration: 0.35, ease: "power4.out", onUpdate: applyCamera },
  WHIP_AT + 0.22,
);

tl.to(blurProxy, { v: PEAK_BLUR, duration: 0.12, ease: "power3.in", onUpdate: writeBlur }, WHIP_AT);
// blur holds at PEAK through the linear burst (no tween needed — value rests at PEAK)
tl.to(blurProxy, { v: 0, duration: 0.35, ease: "power4.out", onUpdate: writeBlur }, WHIP_AT + 0.22);
```

## Per-Frame-Driven Carve-In (baked tracks)

When the element is not tweened but **driven** — a tracked insert or callout riding a baked per-frame track, a title matched to camera shake — there is no move window to share. The envelope becomes a per-frame function of the track's own delta, computed in the same `onUpdate` that applies the position.

One element per transform, so no write clobbers another:

```html
<!-- .track: position + any fade, the only element either touches -->
<div class="track">
  <!-- ×2, the lead's box -->
  <div class="streak-ghost" aria-hidden="true" data-layout-allow-overlap></div>
  <!-- Path A only: rotate onto the travel axis; same box as .lead so both rotate about one center -->
  <div class="blur-wrap" style="filter: url(#streak)">
    <!-- counter-rotate only; no GSAP transform tweens on it -->
    <div class="lead">…</div>
  </div>
</div>
```

```js
// inside the frame-lookup driver (an ease:"none" proxy → frames[i]); TRACK.x / TRACK.y are baked arrays
const j = Math.max(1, i); // frame 0 borrows the frame-1 delta so a seek to t=0 has a defined state
const dx = TRACK.x[j] - TRACK.x[j - 1];
const dy = TRACK.y[j] - TRACK.y[j - 1];
const speed = Math.hypot(dx, dy); // px per frame
const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // the streak axis IS the travel direction
track.style.transform = `translate(${TRACK.x[i]}px, ${TRACK.y[i]}px)`;

// Path B, driven form (the default here): text-free silhouette clones trail the lead along −delta.
const base = speed > TRAIL_GATE ? Math.min(TRAIL_MAX, TRAIL_K * speed) : 0;
ghost1.style.transform = `translate(${-dx * 0.25}px, ${-dy * 0.25}px)`;
ghost2.style.transform = `translate(${-dx * 0.5}px, ${-dy * 0.5}px)`;
ghost1.style.opacity = String(base); // a fade on .track multiplies in; never read another tween's value
ghost2.style.opacity = String(base * 0.5);

// Path A, driven form: rotate a filter wrapper onto the travel axis, blur along X only, counter-rotate the content.
const sigma = speed > TRAIL_GATE ? Math.min(SIGMA_MAX, 0.5 * speed) : 0;
blurWrap.style.transform = `rotate(${angle}deg)`;
lead.style.transform = `rotate(${-angle}deg)`;
blurNode.setAttribute("stdDeviation", `${sigma} 0`);
```

Three deltas from the tweened recipe:

- **Ghosts are text-free silhouettes** — the lead's box, border, radius and fill with **no content** (`aria-hidden="true"`, `data-layout-allow-overlap`). A 25–50%-opacity clone reads as shape; a clone carrying the text reads as a duplicate element, and content-free clones give the layout and contrast checkers nothing to flag.
- **Velocity-gated, not window-shaped** — the trail exists only above `TRAIL_GATE` px/frame and scales with speed (`min(TRAIL_MAX, TRAIL_K × speed)`): a slow drift shows nothing, a whip shows a 180°-shutter smear. Fade `.track`, never `.lead`: group opacity takes the trail with it, and the ghost opacity stays a pure function of the frame index whatever order frames are seeked in.
- **Axis from the baked delta** — `atan2(dy, dx)` per frame; the streak follows the track around corners with nothing to seed at setup.

**Which path for a driven subtree.** Path B is the default: it costs no filter raster (a full filter region re-rasterizes every frame under per-frame drive), its clones carry no text so the layout and contrast checkers see nothing new, and it degrades to nothing when the track is still. Path A in the driven form is legitimate when a true blur is the look. Both forms measured deterministic on the reference host (2026-09-08: single-card 120-frame and three-card 450-frame drives of each path, hardware-GL and software lanes, every double render bit-identical) — but a per-frame-driven filter is the first thing to re-measure on a new host: keep the double-render frame-hash comparison (`--format png-sequence` twice) in the pipeline rather than trusting one clean run. One earlier build (2026-08) observed 1-LSB `feGaussianBlur` jitter under per-frame load and shipped Path B for that reason.

## Values

| token               | range                                              | notes                                                                                           |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MOVE_EASE           | `expo.out` / `power4.out` (default) / `power3.out` | `out`-family ONLY — `in`/`inOut` puts peak speed in the wrong place; position and blur share it |
| MOVE_DUR            | 0.25–0.6s                                          | over ~0.7s reads as a focus pull, not velocity                                                  |
| ENTER_FROM_X/Y      | 40–120% of the element's own dimension             | enough runway for the streak to read                                                            |
| PEAK_BLUR           | 8–30 (default 18)                                  | >30 erases the glyph at the start; ~18–20 cap at wrapper level                                  |
| SCALE_FROM          | 1.3–2.5                                            | push-through variation                                                                          |
| N (ghosts)          | 2–4                                                | >4 reads as strobe, not streak                                                                  |
| ECHO_STEP_PX        | 12–40px                                            | `N × step ≲ ENTER_FROM` so the furthest ghost starts inside the runway                          |
| GHOST_BASE_OPACITY  | 0.3–0.6                                            | opaque ghosts read as duplicate elements                                                        |
| CARD_STAGGER        | 0.05–0.12s                                         | one assembling wave, not separate arrivals                                                      |
| TRAIL_GATE          | 3–6 px/frame (default 4)                           | driven form: below it the track counts as still — no trail, no blur                             |
| TRAIL_K · TRAIL_MAX | 0.05 · 0.32                                        | driven form: ghost opacity `min(TRAIL_MAX, TRAIL_K × speed)` — hits the cap at ~6 px/frame      |
| TRAIL_OFFSETS       | 0.25 / 0.5 of the per-frame delta                  | two clones = a discrete 180° shutter; a third at 0.75 only for a long whip                      |
| SIGMA_MAX           | 8–12                                               | driven Path A: `σ = min(SIGMA_MAX, 0.5 × speed)` along the travel axis                          |

## Critical Constraints

- Blur peaks at peak speed and resolves to 0 at the settle — share the ease and window between position and envelope. A blur that lingers after the stop reads as a focus pull.
- Entrances / mid-shot arrivals only — never a mid-composition exit; wrapper-level use only per the Camera-Travel Carve-Out, per-frame-driven use only per the Per-Frame-Driven Carve-In.
- Seed `stdDeviation` at setup: at `PEAK_BLUR` for the entrance shape, at 0 for a whip / `inOut` leg.
- Generous filter region (`x="-50%" y="-50%" width="200%" height="200%"`) or the smear clips at the element's box edge.
- Directional axis: `"X 0"` horizontal, `"0 Y"` vertical, `"B B"` only for a depth/scale move — symmetric blur on a sideways move looks like defocus.
- Dwell ≥1 s sharp after the snap; a streak landing at the last beat reads as "flashed and gone".
- Heavy element on a solid field — thin type (< ~120px / 800 weight) or a busy backdrop swallows the smear.
- `overflow: hidden` on the scene — the smear / furthest ghost extends past the resting position during travel.
- Driven form: clones are text-free silhouettes (`aria-hidden`, `data-layout-allow-overlap`) inside the faded `.track`, axis from the baked delta; nothing is seeded at setup except the structural frame-0 state.

## See also

`kinetic-beat-slam` (streak as one beat's entrance) · `center-outward-expansion` (grid streak-in) · `scale-swap-transition` (same-footprint morph — not an arrival) · `nudge-curve` (the whip sweep's position half) · `3d-camera-flight` / `viewport-change` (the Camera-Travel Carve-Out's wrappers).

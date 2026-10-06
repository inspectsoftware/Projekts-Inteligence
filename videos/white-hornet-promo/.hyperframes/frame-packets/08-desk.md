# Frame packet: 08-desk

## Project inputs

- Project: C:\Users\n\Desktop\Project-White-Hornet\videos\white-hornet-promo
- Design tokens: C:\Users\n\Desktop\Project-White-Hornet\videos\white-hornet-promo\frame.md
- RULES_DIR: C:\Users\n\.claude\plugins\cache\hyperframes\hyperframes\0.8.137\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 8 — The desk

- scene: The whole desk assembles: real windows snap into their slots around Latvia, then the command palette opens and searches
- duration: 4s
- poster: 3.5s
- transition_in: blur-crossfade
- status: outline
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

## Selected blueprint: zoom-out-workspace-reveal

# zoom-out-workspace-reveal — Zoom-Out Workspace Reveal

**intent**: Open TIGHT on one full-bleed detail — a graphic macro or a small UI region — let micro-action play in close-up, then ONE continuous decelerating zoom-out reveals that everything seen so far lives inside a containing whole (a design-tool workspace / a multi-pane agent workspace); the frame locks at the wide and element-level payoff carries on. The zoom-out IS the narrative engine and the reveal-of-nesting is the payoff — distinct from `grid-card-assemble`, where a zoom-OUT is an optional camera modifier garnishing an element-stagger assemble; here nothing assembles, the world was whole all along, and the single outward move is what re-scopes its meaning. The structural inverse of every existing push-in shape (`constellation-hub`'s push-in, `device-surface-showcase`'s continuous push, `dataviz-countup`'s push-through).

**roles served**

- Hook (from `continuous-zoomout-nesting-reveal`): when the open should be a full-bleed graphic mystery — a blob morphing, a macro blossom blooming — resolved by one unbroken exponentially-decelerating zoom-out that passes THROUGH an intermediate composition (oversized headline / card artwork / web page) before revealing the whole thing is an artboard inside a design tool (panels, layers, inspector, timeline); the frame locks and the canvas keeps animating, ending mid-action.
- Benefits (from `close-up-open-single-zoom-out-reveal`): when the payoff is scale/breadth — micro-actions play in extreme close-up on one small UI region (file rows popping in, a highlight stepping, a guided glide down a list), then ONE fast smoothly-decelerating zoom-out (~0.5–1s) reveals the region was a corner of a huge multi-pane agent workspace (chat + artifact preview + sidebar); the wide holds static to the end while element-level payoff completes the story ("look how much the agent did — and here's the deliverable").

**duration**: 6.8–11s (Hook continuous-pull both 6.8s; Benefits dwell-then-snap 10.7–11s — the dwell and the post-lock payoff stretch, the reveal itself does not)

**HARD RULE — no zoom-in anywhere; camera static outside the single reveal.** Carried verbatim from both Benefits goldens and structurally true of both Hook goldens: the camera's only scale motion is OUTWARD. One zoom-out per shot. Before the reveal the camera either holds, glides/pans along the close-up surface, or is already running the (only) pull-back; after the reveal decelerates to a full stop the frame is LOCKED — every later change (pane swap, pane expansion, cursor travel, playhead scrub, canvas animation) is element/layout motion, never camera. No push-in, no punch, no re-zoom, no second reveal. Violating this collapses the shape back into a generic camera tour.

**shot structure** (one oversized static world — the full `[whole: workspace]` authored at final layout from frame 0 — with the camera starting scaled far in on the `[detail]`; the reveal is one scale animation on the world; two folded sub-shapes — **(A) continuous nesting pull** (Hook) and **(B) close-up dwell → snap reveal** (Benefits))

- **Scene 1 (0.0–~2.5s) — full-bleed detail + micro-action.** Extreme close-up: the `[detail: graphic macro — blob / blossom stem / small UI region — file list / browser corner]` fills the frame edge-to-edge with NO containing chrome, canvas, or neighboring panes visible. The detail PERFORMS in close-up — this beat is never a static hold:
  - _Variant — Hook (A)_: the graphic itself moves/morphs/blooms — an organic `[accent]` blob flows across and morphs into an undulating wavy line, or blurred macro forms sharpen as circular petals pop and expand outward into a flat vector `[motif]` — while the pull-back is ALREADY running underneath (the camera never waits).
  - _Variant — Benefits (B)_: camera holds (or glides) while UI micro-action plays — `[rows: filenames / list items]` pop in top-to-bottom, a soft `[highlight]` steps down row-by-row, or the camera rides down a list while gently pulling back. Optional blur-to-sharp resolve on the opening frame.

- **Scene 2 (~2.5s–reveal start) — the middle beat.** Diverges by sub-shape:
  - _Variant — Hook (A) — intermediate nesting level_: the continuing zoom-out resolves a mid-level composition, still full-bleed, still no chrome — oversized `[headline]` glyphs descend into frame as partial letterforms and settle centered (the "descent" is pure world-scale: the letters are static in world space, the camera pull produces the motion), or the `[motif]` is revealed living inside a `[card]` in a row of cards on a `[web page]`. The viewer re-scopes once — and still doesn't know the real container.
  - _Variant — Benefits (B) — close-up beat advances_: the close-up story develops at the same tightness — the view shifts to an adjacent `[panel]`, a new `[row]` fades/slides in and grows its panel, a `[cursor]` enters and hovers it with a soft highlight. This is the pre-reveal dwell; tension is "we're deep inside something."

- **Scene 3 (the reveal) — ONE decelerating zoom-out completes; frame LOCKS.** The signature move. The camera pulls back to scale 1 and eases to a full stop, revealing the containing `[whole]`:
  - _Variant — Hook (A)_: the pull is the tail of the SAME continuous zoom running since frame 0 (total travel ~4.3–4.5s of a 6.8s shot), with strong exponential deceleration — the `[intermediate composition]` turns out to be `[an artboard / a phone-screen mock]` on a `[design-tool canvas]`: light chrome, left pages/layers panel, right properties inspector, blue selection box, bottom animation timeline with keyframe bars.
  - _Variant — Benefits (B)_: the pull is a discrete rapid burst (~0.5–1s) from the held close-up — smooth, heavily decelerating — landing the full `[multi-pane agent workspace]`: left `[chat pane]` with the prompt + status + response, center/right `[artifact pane: spreadsheet / deck preview]`, optional `[sidebar: progress checklist + artifacts + context]`.
  - Both: the zoom-out ends BEFORE the shot does — always leave a post-lock act. The deceleration-to-stop is what makes the lock legible.

- **Scene 4 (lock–end) — element-level payoff on the locked wide.** The reveal is not the ending; the close-up's world keeps living inside the wide. All motion is element/layout:
  - _Variant — Hook (A)_: a `[cursor]` enters from off-frame and glides to hover/click the selected element, or a `[playhead]` scrubs left-to-right across the bottom timeline while the canvas artwork animates in sync (petals rotate about their hub, a starburst spins in place, a motif sweeps/shifts). Ends MID-ACTION — the tool is alive.
  - _Variant — Benefits (B)_: a `[file-attachment card]` fades in → the cursor clicks `[Open]` → the artifact pane swaps content via a quick white-out → the viewer pane expands full-width over its neighbor (LAYOUT motion, not camera) landing on the `[deliverable: full slide / dashboard]`; or the frame simply holds long and static while the cursor drifts to rest near the `[payoff stat]`. Struck-through checklist items in the sidebar read as completed work. Long hold to the end.

**motion vocabulary**: one continuous scale-driven zoom-out with exponential/eased deceleration (no cuts) · single fast decelerating zoom-out burst (~0.5–1s) · workspace-lock at zoom end · full-bleed no-chrome opening · blur-to-sharp macro focus resolve · organic blob flow + morph into undulating wavy line · squiggle-underline settle with residual undulation · circular petals popping/expanding outward (bloom) · oversized letters descending into frame as partial glyphs (world-scale, not element motion) · text scaling down through the frame to a centered settle · rows pop in top-to-bottom · selection highlight steps down row-by-row · camera rides/pans down a list while pulling back · new row fades/slides in and grows its panel · cursor hover with soft row highlight · cursor entering from off-frame and gliding to hover/click · timeline playhead scrub left-to-right · in-canvas rotation about a hub / spin-in-place · motif shift/sweep-in · file-attachment card fade-in · cursor click · pane content swap via quick white-out · pane expands full-width over neighbor (layout motion) · checklist items shown struck-through · long static hold · cursor drift to rest · ends mid-action (Hook).

**rule mapping** (motion verb → `rule-id`)

- the single decelerating zoom-out on the whole world → `viewport-change` (one `.world` wrapper; `cam` object as single source of truth via `onUpdate`; start `cam.scale` at the reveal ratio with `T = -offset × S` centering the detail, tween scale → 1 and translate → 0 with ONE shared ease — the detail drifts from frame-center to its home slot as the wide takes over, exactly the golden read)
- off-center detail framed at open, zoom-out to wide → `coordinate-target-zoom` ("Zoom out (target → wide view)" variation — nested wrappers, reverse phases: start zoomed on the measured target, tween outer scale → 1 + inner translate → 0 with shared duration/ease; measure the detail's center after `fonts.ready`, never hand-derive)
- pre-reveal glide/ride down a list while gently pulling back (Benefits B) → `viewport-change` (pan + scale composed on the one `cam` object) — sequencing the slow-glide → hold → fast-pull profile → `multi-phase-camera` (phase machinery; this shape runs the same scale-agnostic math at 4–12× outward — see `viewport-change`'s scale-guide range note)
- exponential deceleration-to-stop → ease selection (`expo.out` / `power4.out` on the reveal tween) — parameter guidance, no rule needed; after the stop, NO camera tweens exist on the timeline (hard rule above)
- blur-to-sharp macro resolve chorded to the early pull → `depth-of-field-blur` (refocus/settle variation: `--dof` ramps to 0 as the zoom recedes, same timeline position as the pull)
- oversized partial glyphs descending / text scaling down through the frame → no element tween — authored static in world space; `viewport-change`'s pull produces the motion (author trap: animating the letters separately double-moves them)
- organic blob flow + morph into wavy line → SVG path morph — see `hyperframes-keyframes` (morph); flagged special, like `device-surface-showcase`'s WebGL specials — substitute a non-morph accent when the capability isn't loaded
- squiggle-underline residual undulation → `sine-wave-loop` (finite bounded undulation)
- circular petals pop/expand outward (bloom) → `spring-pop-entrance` (staggered pops) + `center-outward-expansion` (petals expand from the hub to final positions)
- rows pop in top-to-bottom → `spring-pop-entrance` (staggered group, ≤500ms stagger cap) or `gsap-effects` (low-drama fade + short slide stagger)
- selection highlight steps down row-by-row → `gsap-effects` (stepped `tl.set` repositions at time thresholds — instant steps, no glide; trivial, no dedicated rule needed)
- new row fades/slides in → `spring-pop-entrance` (soft variant); its panel growing to fit → `anchored-layout-expand` (one-axis layout expansion)
- cursor enters off-frame → glides → hovers → clicks → `cursor-click-ripple` (move-to-target, co-depress, ripple); soft hover row-highlight → `gsap-effects` (background-color/opacity tween)
- timeline playhead scrub left-to-right → `gsap-effects` (linear `ease:"none"` translateX); in-sync canvas animation = place the artwork tweens at the same timeline position as the scrub (sync is free on one paused timeline)
- in-canvas rotation about a hub / spin-in-place (petal flower, starburst) → `svg-icon-enrichment` (SVG `setAttribute('transform','rotate(deg cx cy)')` for explicit centers)
- motif shift/sweep-in on a card → `gsap-effects` (masked translate) or `techniques.md` clip-path reveal
- file-attachment card fade-in → `spring-pop-entrance` (soft) / `gsap-effects` fade
- pane content swap via quick white-out → `discrete-text-sequence` (whole-state swap at a threshold) + `gsap-effects` (white flash overlay with attack-decay opacity envelope)
- pane expands full-width over neighbor (layout motion) → `anchored-layout-expand` (one-axis layout hand-off; width/height tweens stay forbidden)
- checklist items struck-through / status states → static content, or `discrete-text-sequence` if they check off on screen
- long static hold + cursor drift to rest → hold needs no rule; the drift is a single slow `gsap-effects` translate that ARRIVES somewhere meaningful (rests near the payoff stat) — it performs, it is not idle wobble
- ends mid-action (Hook) → the playhead/canvas tweens simply run to the composition edge — no exit move, no rule

**camera law — staging the one move** (the camera is the engine here, not a modifier)

- Build the ENTIRE `[whole]` workspace at final layout inside one `.world` wrapper; there is no second set. The open is `cam.scale = S0` (typically 4–12× — whatever makes the `[detail]` full-bleed) with counter-translate centering the detail; the reveal tweens to `scale 1, translate 0`. `overflow: hidden` on the scene; background on the scene, never the world.
- Crispness constraint: everything visible at open must survive S0 magnification — author the detail as DOM/vector (text, SVG, CSS shapes); any raster inside the close-up needs `sourceResolution ≥ rendered × S0`.
- Sub-shape A: the reveal tween spans ~0–4.5s with `expo.out`-class deceleration — one tween, no phases, no cuts; element beats (morph, bloom, glyph settle) are positioned along it.
- Sub-shape B: optional gentle pre-reveal pan/pull (`viewport-change` pan, or a slow scale ease-out ≤ ~15% travel) during the dwell, then the reveal burst (~0.5–1s, heavy decel) as its own tween; camera fully static after.
- Never: a zoom-in, a second zoom-out, camera motion after the lock, or replacing the reveal with a cut. One outward move is the whole grammar.

**boundary vs `grid-card-assemble`**: it already carries an optional zoom-OUT reveal modifier (glass-card / logo-wall variants), so the two shapes border each other. The test: if elements ASSEMBLE and the pull-back merely shows the assembled array in context, it's `grid-card-assemble`; if the world is whole from frame 0 and the single decelerating pull-back is itself the story — close-up mystery → nesting reveal → locked-frame payoff — it's this blueprint. Related evidence: a mined profile-page golden runs the same single UI zoom-out/scroll-up reveal at small scale inside a kinetic-type shot, corroborating the move's currency without sharing the shape.

## Selected motion rule: context-sensitive-cursor

---
name: context-sensitive-cursor
description: Cursor color and styling that adapt to the current text segment being typed — accent color on highlights, dim on placeholders, etc.
metadata:
  tags: cursor, color, context, typewriter, styling, segment
---

# Context-Sensitive Cursor

In a typewriter sequence, the cursor's color (and optionally height / blink behavior) matches the **active text segment** — brand accent while typing the brand name, dim on placeholders, success color on the completion mark. The eye lands on the keyword being typed because the cursor shifts with it; a fixed single-color cursor is visual noise by comparison. Layers on top of [discrete-text-sequence](discrete-text-sequence.md)'s SEQUENCE pattern.

## How It Works

The text is authored as a SEQUENCE of `{ t, text, segment, color }` entries; a linear driver's `onUpdate` reverse-searches for the current entry and writes both the visible text and the cursor's `background` (the cursor is a colored block, so `background`, NOT `color`). A second linear tween sweeps a phase `p` through `2π × BLINK_CYCLES_PER_SCENE` and gates cursor opacity on `sin(p) > 0` — a deterministic square-wave blink on the timeline.

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
  font-family: {monoFont}; /* proportional fonts drift the cursor mid-segment */
  display: flex;
  align-items: baseline;
  white-space: pre; /* preserve trailing spaces — cursor sits at segment end */
}
.text {
  white-space: pre;
}
.cursor {
  display: inline-block; /* inline ignores width/height */
  width: {cursorWidth}px;
  height: {cursorHeight}px;
  background: {textColor}; /* default — overridden per segment in onUpdate */
  vertical-align: {cursorBaselineFix}px; /* small negative — anchor to baseline, not line-height */
}
```

```js
// Adjacent entries usually share a text prefix but may differ in `segment` —
// that's what shifts the cursor color mid-line.
const SEQUENCE = [
  { t: 0, text: "", segment: "main", color: "{mainColor}" },
  { t: T_LEADIN_END, text: "{leadInChunk}", segment: "main", color: "{mainColor}" },
  { t: T_BRAND_IN, text: "{leadInBrandPrefix}", segment: "brand", color: "{brandColor}" },
  { t: T_BRAND_OUT, text: "{leadInBrandFull}", segment: "main", color: "{mainColor}" },
  { t: T_CMD_IN, text: "{leadInCmdPrefix}", segment: "cmd", color: "{cmdColor}" },
  { t: T_SUCCESS, text: "{leadInDone}", segment: "success", color: "{successColor}" },
];

function entryAt(time) {
  for (let i = SEQUENCE.length - 1; i >= 0; i--) {
    if (time >= SEQUENCE[i].t) return SEQUENCE[i];
  }
  return SEQUENCE[0];
}

const textEl = document.getElementById("text");
const cursorEl = document.getElementById("cursor");

const driver = { t: 0 };
tl.to(
  driver,
  {
    t: DURATION,
    duration: DURATION,
    ease: "none",
    onUpdate: () => {
      const entry = entryAt(driver.t);
      textEl.textContent = entry.text;
      cursorEl.style.background = entry.color;
    },
  },
  0,
);

// Deterministic square-wave blink
const blink = { p: 0 };
tl.to(
  blink,
  {
    p: Math.PI * 2 * BLINK_CYCLES_PER_SCENE,
    duration: DURATION,
    ease: "none",
    onUpdate: () => {
      cursorEl.style.opacity = Math.sin(blink.p) > 0 ? "1" : "0";
    },
  },
  0,
);
```

## Variations

- **Non-blinking during active typing** — suppress blink while letters are appearing (solid cursor), resume on idle. This MUST be a pure function of the driver's time: tracking a mutable `lastChangeTime` in `onUpdate` is not reverse-seek-safe (scrubbing backwards leaves the stale forward-pass value behind and the cursor blinks — or holds solid — at the wrong frames). Bake the change times from the SEQUENCE instead — every entry whose `text` differs from its predecessor is a typing event:

```js
// Baked once at build time — no runtime state.
const CHANGE_TIMES = SEQUENCE.filter((e, i) => i > 0 && e.text !== SEQUENCE[i - 1].text).map(
  (e) => e.t,
);
// In onUpdate — identical result at any seek, either direction:
const isTyping = CHANGE_TIMES.some((t) => t <= driver.t && driver.t - t < TYPING_GRACE);
cursorEl.style.opacity = isTyping ? "1" : Math.sin(blink.p) > 0 ? "1" : "0";
```

- **Cursor HEIGHT shifts on segment** — larger cursor on the brand segment: `cursorEl.style.height = entry.segment === "brand" ? cursorHeightEmphasis : cursorHeight` (1.1–1.25×; more reads as glitch).
- **Contrast reversal** — a dark-text-on-light segment needs a dark cursor too; keep `entry.color` as the single source of truth and read from it.

## Values

| token                  | range                       | notes                                                                                           |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| DURATION               | 4–8s per typed line         | `≥ SEQUENCE[last].t + closing dwell`                                                            |
| entry `t` spacing      | 0.2–0.5s micro-additions    | ascending, non-uniform — slow down on highlights                                                |
| segment palette        | 3–4 colors max              | more reads as random; brand vs success should differ in saturation/luminance                    |
| cursorWidth / Height   | 8–24px / 0.85–1.0× fontSize | too thin vanishes in render compression; too tall outranks the text                             |
| cursorBaselineFix      | small negative px           | drop the block to the text baseline                                                             |
| BLINK_CYCLES_PER_SCENE | period ≈ 0.6–1.2s           | **whole number** — otherwise the sin sweep ends mid-cycle and the cursor pops on the last frame |
| TYPING_GRACE           | 0.15–0.3s                   | **< shortest dwell between adjacent entries** — otherwise the cursor never blinks               |

## Critical Constraints

- **Cursor color goes on `background`** — it's a colored block, not a glyph.
- **Blink is timeline-driven sin, pure of any mutable tracker** — the typing-grace variation shows the seek-safe form.
- **`white-space: pre` on text and container** — collapsed trailing spaces park the cursor in the wrong column.
- **Monospace font + `display: inline-block` cursor** — proportional faces drift the cursor mid-segment; inline ignores the block geometry.
- **BLINK_CYCLES_PER_SCENE is a whole number** for the fixed DURATION.

## See also

`discrete-text-sequence` (the underlying SEQUENCE pattern) · `camera-cursor-tracking` (camera follows the cursor) · `press-release-spring` (post-typing confirm press).

## Selected motion rule: depth-of-field-blur

---
name: depth-of-field-blur
description: Selective-focus rack-focus — pull the eye to a focal element by GSAP-tweening filter blur (+ a small opacity dim) on the off-focus layers while the focal one stays sharp. Drive blur via a `--dof` CSS var; finite tweens, no CSS transition, deterministic. Covers single focal pull, rack-focus between two depth planes, and blur-the-cluster-while-pushing-in.
metadata:
  tags: blur, focus, depth-of-field, dof, rack-focus, filter, dim, spotlight, cinematic, push-in
---

# Depth-of-Field Blur (Selective Focus / Rack Focus)

Pulls the eye to one focal element by **blurring** (and slightly **dimming**) everything around it while the focal layer stays sharp — the camera's depth-of-field falling off the background, or a rack-focus shifting which plane is in focus. `filter` and `opacity` are paint-only, so both tween seek-safe. This is the backing rule for the focus-falloff beat the blueprints reach for: outer nodes blurring during a push-in (`constellation-hub`), rack-focus across a parallax card stack (`cursor-ui-demo`), non-highlighted cards dimming to spotlight a hero metric (`dataviz-countup`).

## How It Works

Every layer carries a `--dof` custom property (px of blur), read by `filter: blur(var(--dof))`, plus its own `opacity`. A GSAP tween advances each layer's `--dof` from `0` to its target blur and its opacity from `1` to a dim level over the focus-shift window. The focal layer's `--dof` stays `0`. Per-layer targets derive from `data-depth` / index, so the falloff is identical on every seek.

Three mechanics, same primitive:

1. **Focal pull** — one window: off-focus layers go sharp(0) → blurred while the focal layer holds at 0. The eye is pulled to the only thing still crisp.
2. **Rack focus** — two adjacent windows on the same property: plane A's blur ramps 0 → max at the same position plane B's ramps max → 0. State continuity matters exactly as in `press-release-spring`: A's resting blur after the rack must equal what B held before it — author both as tweens on the same `--dof` at the same position so the hand-off is seamless.
3. **Blur-the-cluster-while-pushing-in** — the DoF tween runs at the SAME timeline position as a camera push-in (`multi-phase-camera` / `coordinate-target-zoom`): "the world recedes" and "we push in" read as one move.

## Recipe

```html
<div class="world" id="world">
  <!-- Focal layer — stays sharp -->
  <div class="layer focal" id="focal">{FocalLabel}</div>
  <!-- Off-focus layers — blur + dim; data-depth orders near→far -->
  <div class="layer ctx" data-depth="1">{Context A}</div>
  <div class="layer ctx" data-depth="2">{Context B}</div>
  <div class="layer ctx" data-depth="3">{Context C}</div>
</div>
```

```css
.world {
  /* single wrapper so a concurrent camera push-in transforms everything
     together; DoF is independent of the camera */
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: 50% 50%;
}
.layer {
  --dof: 0px; /* px of blur; filter reads it — starts sharp */
  filter: blur(var(--dof));
  will-change: filter; /* promotes the layer so per-frame re-rasterization is cheap */
}
.focal {
  z-index: 2; /* sharp layer must sit ABOVE the blurred ones, or its crisp
     edges read as bleeding into the haze */
}
.ctx {
  z-index: 1;
}
```

```js
// Mechanic 1 — FOCAL PULL. Blur scales with data-depth so far planes blur
// more than near ones; the focal layer (--dof: 0, opacity: 1) is untouched.
gsap.utils.toArray(".ctx").forEach((el) => {
  const depth = Number(el.dataset.depth) || 1;
  tl.to(
    el,
    {
      "--dof": `${BLUR_PER_DEPTH * depth}px`,
      opacity: DIM_LEVEL, // dim, not gone
      duration: FOCUS_DUR,
      ease: "power2.inOut",
    },
    FOCUS_START,
  );
});
```

## Variations

- **Rack focus between two depth planes** — `gsap.set` plane B pre-blurred BEFORE the rack (no pop), then two tweens sharing `RACK_START` + `RACK_DUR`: A → `MAX_BLUR` + `DIM_LEVEL`, B → `0px` + `1`. Shared window makes them cross at the midpoint.
- **Blur the cluster while pushing in** — run the focal-pull tweens at the same position + duration as a camera tween on `#world` (`scale/x/y`, `power2.inOut`). Camera transforms the world; DoF tweens the layers — independent property channels, no conflict.
- **Spotlight a hero metric in a card grid** — `gsap.utils.toArray(".card:not(.hero)")` all defocus (`GRID_BLUR` + `DIM_LEVEL`) on one shared window; heroes are skipped.
- **Refocus / settle** — if the beat resolves back to "everything visible" (or hands off to a crossfade needing a clean outgoing frame), ramp all `--dof` back to `0px` / opacity 1 over the tail (`REFOCUS_START + REFOCUS_DUR ≤ DURATION`).
- **Bounded focus-breathing on the focal layer (optional)** — a finite `ease:"none"` driver writes `Math.max(0, Math.sin(p)) * FOCAL_BREATH_PX` into the focal `--dof` during a hold. Keep it ≤ ~0.6px or it reads as "still focusing"; default to omitting it.

## Values

| token                 | range                                  | notes                                                                                                    |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| BLUR_PER_DEPTH        | 3–6 px per depth step                  | a 3-plane stack tops out ~9–18 px; low = gentle DoF, high = tilt-shift falloff                           |
| MAX_BLUR              | 8 soft → 16 default → 24 heavy px      | terminal blur for a fully-defocused plane; above ~24 px on a big surface, shrink/group the layer instead |
| GRID_BLUR             | 6–12 px                                | pushes cards back without losing the grid's shape                                                        |
| DIM_LEVEL             | 0.4 strong → 0.55 default → 0.7 subtle | rarely below 0.35 — fully dark reads as "removed," not "defocused"                                       |
| FOCUS_DUR             | 0.5–1.2 s                              | a rack/pull is a deliberate move, not a snap; shorter = snap focus, longer = languid                     |
| RACK_START / RACK_DUR | shared by both planes                  | `gsap.set` the pre-blurred plane BEFORE `RACK_START`                                                     |
| FOCAL_BREATH_PX       | ≤ 0.6 px, period 2–3 s                 | barely-there nicety                                                                                      |
| FOCAL vs CTX sizing   | context smaller / grouped              | small context layers let a modest radius still read as "out of focus" — and blur cheaply                 |

Tokens: dark `{bgGradient}` so the sharp focal layer reads as lit and forward; heavy display `{font}` weight — blurred copy needs it to stay shape-legible.

## Critical Constraints

- **Tween the `--dof` variable on the timeline** — reading `filter: blur(var(--dof))` keeps the blur on the HF seek clock.
- **Blur the SMALL / GROUPED layers, not the giant one.** Filter cost scales with radius × pixel area; a 20 px blur on a full-frame background is the worst case. Keep per-layer radius ≤ ~24 px on large surfaces and lean on the `opacity` **dim** to do the push-back work — dim + modest blur reads more like real DoF than blur cranked to the max.
- **`will-change: filter`** on every layer whose blur animates (drop it after settle if the layer also does heavy transform work).
- **Focal layer stays genuinely sharp** — `--dof: 0`, untouched (or breathing ≤ 0.6 px). Any visible blur on the focal element kills the "this is the thing" read.
- **State continuity on a rack** — the outgoing plane starts at the blur the incoming plane was holding, and vice-versa; adjacent tweens on the same `--dof` at the same position.
- **DoF is independent of the camera** — blur the layers, transform `.world` for the push-in; don't fake DoF with the camera transform or vice-versa.
- **Settle sharp before a hand-off** — refocus to `--dof: 0` in the tail if the next beat is a crossfade/push; handing off mid-defocus reads as "the render glitched."
- **Sharp focal layer above blurred layers** (`z-index`).

## See also

[multi-phase-camera.md](multi-phase-camera.md) (the push-in this rule's falloff accompanies) · [coordinate-target-zoom.md](coordinate-target-zoom.md) (zoom onto the focal core — the `constellation-hub` hook) · [viewport-change.md](viewport-change.md) (pan + rack across a tilted card plane) · [counting-dynamic-scale.md](counting-dynamic-scale.md) (hero metric counts up sharp — the `dataviz-countup` spotlight) · [3d-page-scroll.md](3d-page-scroll.md) (the parallax stack to rack between) · [sine-wave-loop.md](sine-wave-loop.md) (post-rack idle; keep both amplitudes tiny).

## Selected motion rule: multi-phase-camera

---
name: multi-phase-camera
description: Sequential camera zoom with 2-3 distinct phases (pull-back / focus / push) plus continuous micro-drift for organic cinematic feel.
metadata:
  tags: camera, zoom, phase, drift, scale, cinematic
---

# Multi-Phase Camera

A camera wrapper around the ENTIRE scene that progresses through discrete zoom phases at scripted triggers, with continuous sine-driven micro-drift overlaid so the camera never feels static between phases. Distinct from a single linear zoom — multi-phase creates cinematic pacing (anticipation → reveal → settle).

## How It Works

The camera is one wrapping `<div>` whose `transform: scale() translate(x, y)` is composed from two channels inside a single `onUpdate` writer:

1. **Phase scale** — a proxy object `{ scale }` stepped through phases at trigger times (`PHASE_1_SCALE` at t=0 → `PHASE_2_SCALE` at `PHASE_2_AT` → `PHASE_3_SCALE` at `PHASE_3_AT`).
2. **Drift offset** — a continuous sine-based `translateX` / `translateY` (small amplitude, slow frequency) ADDED to the phase transform. X and Y run at slightly different frequencies (`DRIFT_FREQ_RATIO ≈ 1.3`) — equal frequencies produce a perfect diagonal that reads mechanical; ~1.3 gives an organic Lissajous.

## Recipe

```html
<div class="camera" id="camera">
  <div class="content">
    <div class="hero">{Brand}</div>
    <div class="tagline">{tagline}</div>
    <div class="cta">{ctaText}</div>
  </div>
</div>
```

```css
.scene {
  overflow: hidden; /* REQUIRED — any phase scale < 1 exposes the content's edges */
  background: {sceneBgColor}; /* background on .scene, NOT .camera — a camera-borne
     background warps/translates with the transform and reveals the outer void */
}
.camera {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%; /* off-center origin creates phase-to-phase drift */
  will-change: transform;
}
```

```js
const camera = document.getElementById("camera");

// Three-phase scale plan: pullback → focus → push.
const phase = { scale: PHASE_1_SCALE }; // Phase 1 is the initial value — no tween

// Phase 2 — settle to neutral focus
tl.to(phase, { scale: PHASE_2_SCALE, duration: PHASE_2_DUR, ease: PHASE_2_EASE }, PHASE_2_AT);

// Phase 3 — slow push-in for the climax
tl.to(phase, { scale: PHASE_3_SCALE, duration: PHASE_3_DUR, ease: PHASE_3_EASE }, PHASE_3_AT);

// Drift driver — continuous sine motion overlaid on the phase scale.
// The ONE writer of camera.style.transform.
const drift = { p: 0 };
tl.to(
  drift,
  {
    p: Math.PI * 2 * DRIFT_CYCLES,
    duration: TOTAL_DURATION, // spans the whole composition
    ease: "none",
    onUpdate: () => {
      const dx = Math.sin(drift.p) * DRIFT_AMP_X;
      const dy = Math.sin(drift.p * DRIFT_FREQ_RATIO) * DRIFT_AMP_Y;
      camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
    },
  },
  0,
);

// Content reveals happen INSIDE the camera frame (hero/tagline/cta beats).
```

## Phase Patterns

| Pattern             | Scale sequence (1 → 2 → 3)        | Feel                            | When to use                   |
| ------------------- | --------------------------------- | ------------------------------- | ----------------------------- |
| **Focus-in**        | back → neutral → slight push      | Approach → settle → slight push | Default product reveal        |
| **Dramatic reveal** | push → neutral → pull             | Wide → focus → settle back      | Hero shot with breathing room |
| **Steady push**     | neutral → slight push → more push | Gradual forward momentum        | Continuous narrative push     |
| **Bookend pull**    | neutral → strong push → neutral   | Settle → push → release         | CTA emphasis then release     |

## Variations

- **Phase trigger by content beat**: align a camera tween's start with a content tween's end (entry completes → push begins) rather than a fixed clock value.
- **Camera shake (panic / impact)**: a brief higher-amplitude, higher-frequency drift tween over a short window — same `drift` mechanism with `SHAKE_AMP` / `SHAKE_CYCLES` / `SHAKE_DUR` at `SHAKE_AT`.
- **Targeted zoom into an off-center element**: combine scale with counter-translation so the target lands at viewport center — divide the measured offset by the current scale before feeding it into the writer:

```js
const tRect = document.querySelector(".cta").getBoundingClientRect();
const offsetX = (STAGE_W / 2 - (tRect.left + tRect.width / 2)) / phase.scale;
const offsetY = (STAGE_H / 2 - (tRect.top + tRect.height / 2)) / phase.scale;
// then in onUpdate: translate(offsetX + dx, offsetY + dy)
```

(Full counter-translate doctrine: [coordinate-target-zoom.md](coordinate-target-zoom.md).)

## Values

| token                       | range                                    | notes                                                                               |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| PHASE_1 / 2 / 3_SCALE       | 0.88–0.96 / 0.98–1.02 / 1.04–1.15        | tighter spread = subtler camera; scale < 1 REQUIRES `overflow: hidden` on `.scene`  |
| PHASE_2_AT / PHASE_2_DUR    | 0.3–1.0s / 1.0–1.8s                      | longer DUR = slower settle, more cinematic                                          |
| PHASE_3_AT / PHASE_3_DUR    | 2.0–4.0s / 1.0–2.0s                      | PHASE_3_AT ≥ PHASE_2_AT + PHASE_2_DUR or focus is preempted                         |
| PHASE_2_EASE / PHASE_3_EASE | `power2.out` `power3.out` `power2.inOut` | spring/back easing on a camera feels uncomfortable; each later phase settles deeper |
| TOTAL_DURATION              | = `data-duration`                        | the drift tween must span the whole composition                                     |
| DRIFT_CYCLES                | 1–3                                      | 1 = one slow breath; high values read as mechanical wobble                          |
| DRIFT_AMP_X / DRIFT_AMP_Y   | 2–8 px / 1–4 px                          | imperceptible per-frame, visible over time — if it reads as a shake, it's too much  |
| DRIFT_FREQ_RATIO            | 1.2–1.5                                  | 1.0 = perfect diagonal (mechanical); ~1.3 = organic Lissajous                       |
| HERO_AT (etc.)              | after Phase-2 settle lands               | a hero fading in mid-pull-back feels like it's flying away                          |

## Critical Constraints

- **Camera wraps EVERYTHING in the scene** — a per-element camera creates parallax bugs and breaks the "one viewpoint" read.
- **One writer**: phase scale and drift compose inside the single drift `onUpdate`; nothing else touches `camera.style.transform`.
- **`overflow: hidden` on `.scene`** — required whenever any phase scale < 1.
- **`transform-origin: 50% 50%` on `.camera`** — off-center origin creates unpredictable phase-to-phase drift.
- **Scene background on `.scene`, not `.camera`** — otherwise scaling/translating reveals the outer void.
- **Hero reveal starts AFTER the initial pull-back ease lands** — otherwise the headline feels like it's flying away.

## See also

[coordinate-target-zoom.md](coordinate-target-zoom.md) (counter-translate math for the targeted variation) · [orbit-3d-entry.md](orbit-3d-entry.md) (orbit inside a drifting camera) · [counting-dynamic-scale.md](counting-dynamic-scale.md) (climax push synced to counter peak) · [3d-text-depth-layers.md](3d-text-depth-layers.md) (depth-stacked hero under camera moves) · [sine-wave-loop.md](sine-wave-loop.md) (element idle inside the camera).

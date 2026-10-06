---
workflow: product-launch-video
flow: automation
storyboard: no
message: "One map. Every public signal about Latvia, live."
destination: web
aspect: 1920x1080
language: en
length: 45s
audience: people seeing White Hornet for the first time
angle: product reveal
---

## Intent

Introductory promo for White Hornet, a Latvia-only intelligence panel: one dark tactical map
that fuses live open-source data (air, sea, land, space, signals, news). The user's premise:
open on one aircraft flying on the map, dive into an actual place, then TV stations,
politicians talking, satellites, then show off the whole site. "Go crazy with this."

## Assets

- capture/screenshots/*.png — real 1920x1080 plates captured from the running app by `capture-app.mjs`.

## Customizations

- Hybrid visuals: real app plates plus code-built motion overlays (hero vector plane from the app's own icon path).
- Music + SFX, no voice-over; on-screen type carries the message.
- TV beat: real Live TV window and channel names, stand-in video in the player (waveform, speaker silhouette, lower-third).

## Notes

- No broadcaster footage and no real faces anywhere in the video.
- Latvia / Baltic only; never imply global coverage.
- End card carries "Public sources only". No URL unless the user supplies one.
- Not signed in to HeyGen and local MusicGen deps are missing: music source is unresolved (sign in, supply a track, or render silent).

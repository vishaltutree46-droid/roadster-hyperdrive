# Tesla Roadster — Hyperdrive

An unofficial, fan-made 3D open-world driving game inspired by the Tesla Roadster.
Built with **TypeScript + Vite + Three.js**. No external 3D assets — the car,
roads, city and terrain are all generated procedurally in code.

> Not affiliated with or endorsed by Tesla, Inc. All performance figures are
> simulated arcade values; the **N** boost is a fictional game feature; all
> audio is synthesized in code.

## Play

- **Live build:** <https://vishaltutree46-droid.github.io/roadster-hyperdrive/>

## Run locally

Requires Node 18+.

```bash
npm install
npm run dev      # dev server with hot reload
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
```

## Controls

| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake / Reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| C | Cycle camera (6 modes) |
| R | Reset car |
| N | Boost — arcade fictional feature |
| L | Headlights |
| M | Mute |
| P | Photo mode |
| Esc | Pause |

Gamepad supported (left stick steer, triggers throttle/brake). Touch controls
appear automatically on touch devices.

## What's inside

- **Procedural Roadster tribute** — lofted body cross-sections, glass canopy,
  detailed wheels/brakes, full interior, LED DRL + full-width tail bar,
  PBR clearcoat paint with metallic/gloss/matte finishes.
- **Open world** — ~4 km coastal highway loop, mountain pass, cut-and-cover
  tunnel, river bridge, night city district, palm-lined coast, test pad.
- **Day / sunset / night** + **clear / rain / fog** weather affecting light,
  fog, road grip look and handling.
- **Arcade EV physics** — fixed 120 Hz step, speed-sensitive steering,
  handbrake drifts, skid marks, tire smoke, collisions, surface grip
  (tarmac / sand / grass / water).
- **6 cameras** — chase, rear, hood, cockpit, cinematic orbit, low — with
  damped transitions, speed FOV kick and impact shake.
- **Garage** — paint, finish, wheel color, headlights, turntable + orbit/zoom;
  saved to localStorage.
- **6 modes** — free roam, time trial, speed challenge, drift challenge,
  checkpoint race, photo mode (PNG capture).
- **Procedural audio** — synthesized motor whine, wind, tire skid, impacts,
  UI; starts after first click (browser autoplay policy).
- **Performance** — instancing everywhere, quality presets (low→ultra),
  auto quality scaling, WebGL fallback path (no WebGPU dependency).

## Deploy

The production build is fully static (`dist/`), with relative asset paths
(`base: './'` in `vite.config.ts`), so it works on any static host.

### GitHub Pages (used for the live build)

```bash
npm run build
# push dist/ to a gh-pages branch, then enable Pages:
gh api -X POST /repos/<owner>/<repo>/pages \
  -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/'
# → https://<owner>.github.io/<repo>/
```

### Vercel / Netlify / any static host

- Build command: `npm run build`
- Publish directory: `dist`
- No server-side code, no environment variables needed.

## Project layout

```
src/
  main.ts        boot + WebGL check
  game.ts        orchestrator: state machine, main loop, quality scaling
  config.ts      settings, persistence, paint catalog
  input.ts       keyboard / gamepad / touch
  audio.ts       procedural Web Audio engine
  carModel.ts    procedural Roadster (lofted body, wheels, interior)
  physics.ts     arcade EV vehicle simulation (120 Hz fixed step)
  world.ts       terrain, road network, tunnel, bridge, city, sky, weather
  cameras.ts     6-mode cinematic camera rig
  particles.ts   skid marks, smoke/sparks, rain
  hud.ts         HUD + canvas minimap
  modes.ts       free roam / time trial / speed / drift / race
  garage.ts      studio showcase scene
  ui.ts          menus, settings, pause, completion screens
```

## Known limitations

- The vehicle is a procedural tribute, not a licensed 3D scan — panel detail
  won't match a AAA licensed model.
- No real traffic or pedestrians yet; the world is yours alone.
- Motion blur and ray-traced reflections are intentionally omitted for
  browser performance.

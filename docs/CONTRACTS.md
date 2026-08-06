# RED SANDS — Engineering Contracts & Art Direction

**Every agent must read this before writing a line.** These interfaces are frozen.
Additive changes are fine; renames and removals break other agents' code.

---

## 1. Non-negotiable rules

1. **Own only your file(s).** Never edit another system's file, `src/core/*`,
   `src/main.js`, or `tools/*`. If you need something from another system, use the
   contract. If the contract is missing something, add it to *your own* module's
   public surface and note it in your report.
2. **Zero console errors.** Verify with the harness (§6) before you report done.
3. **`three` r0.185, WebGL2, ES modules, no new dependencies** unless explicitly
   assigned one. Import as `import * as THREE from 'three'`; addons from
   `three/examples/jsm/...`.
4. **Determinism.** Never call `Math.random()`. Use `rng(seed)` from
   `src/core/Context.js`. Screenshots must be reproducible frame-for-frame.
5. **Linear HDR workflow.** The renderer has `NoToneMapping` and PostFX applies
   the tonemap. Author all colours/lights in **linear** radiance, not sRGB.
   Any colour texture you create must be flagged `SRGBColorSpace`; normal /
   roughness / AO / data textures must be `NoColorSpace` (linear).
6. **Budget.** At `ultra`, the whole frame must stay under ~2000 draw calls and
   ~16 ms on an M3 Pro. Use `InstancedMesh`, merged geometry, and LOD. A system
   that tanks the frame will be sent back.
7. **No placeholder art.** Everything is generated procedurally at runtime —
   there are no external asset files. If you need a texture, generate it.

---

## 2. System lifecycle

```js
export class MySystem {
  static id = 'mySystem';          // must match the id used in main.js
  constructor(ctx) { this.ctx = ctx; }
  async init() {}                  // heavy setup; awaited during boot
  update(dt) {}                    // simulation, before transforms settle
  lateUpdate(dt) {}                // after camera/transforms are final
  resize(w, h) {}                  // w,h are DRAWBUFFER pixels (already × DPR)
  dispose() {}
}
```

Registered ids: `procTextures timeOfDay weather terrain water roads vegetation
scatter town lighting sky clouds particles physics player bike wildlife riven
cordon garage compound
loot camera postfx audio hud touch`. Reach another system with
`ctx.get('terrain')`.

**Init order matters for `roads` (35).** It must come after `terrain` (20) and
before `vegetation` (40) and `scatter` (45), both of which read the network —
vegetation to keep off it, scatter to draw it.

---

## 3. Shared state (`ctx`)

Full field list lives in `src/core/Context.js` — read it. Summary of ownership:

| Field | Owner | Readers |
|---|---|---|
| `ctx.env.sunDirection/sunColor/sunIntensity/moon*/timeOfDay/daylight/twilight` | `timeOfDay` | everyone |
| `ctx.env.ambient*/turbidity/fog*/cloud*/wetness/rainIntensity/snow*/lightningFlash/weatherName` | `weather` | everyone |
| `ctx.env.windVector/windStrength/windGust` | `weather` | vegetation, particles, clouds, water, audio |
| `ctx.env.exposure` | `postfx` | sky, hud |
| `ctx.env.cameraSubmerged` | `water` | postfx, audio |
| `ctx.world.getHeight/getNormal/getSurface/getSlope/isWater/waterLevel/ready` | `terrain` | everyone placing geometry |
| `ctx.player.position/velocity/yaw/mode/speed01/horse/inTown` | `player` | LOD, audio, camera, wildlife, hud |
| `ctx.poi` | any | capture harness |
| `ctx.time.dt/elapsed/frame` | engine | everyone |
| `ctx.quality.*` | engine | everyone |

`ctx.on(evt, fn)` / `ctx.emit(evt, payload)` for events. Known events:
`ready`, `teleport`, `playerTeleported`, `weatherChange`, `lightning`,
`hourChange`, `footstep`, `mount`, `dismount`, `mountBeat`, `gunshot`,
`bikeStart`, `bikeStall`, `rivenHit`, `rivenKilled`, `cordonHit`, `cordonKilled`,
`looted`, `upgraded`, `compoundCleared`, `escaped`,
`refuelled`.

`ctx.player.horse` still carries that name — it is a frozen field half a dozen
systems read — but what it holds is the **bike**. See §4.8.

---

## 4. Cross-system APIs

### 4.1 `procTextures` — the material library

Every other system gets its surfaces from here. Generated procedurally on the
GPU at boot into `CanvasTexture`/`DataTexture`; no files.

```js
const t = ctx.get('procTextures');

/** @returns {{map:Texture, normalMap:Texture, roughnessMap:Texture,
 *             aoMap:Texture, displacementMap:Texture|null, size:number}} */
t.get(name);                       // cached; safe to call every frame
t.material(name, overrides = {});  // → MeshStandardMaterial, cached & shared
t.has(name);
```

Required `name` values (all must exist and look convincing):

`rock_cliff` `rock_slab` `rock_boulder` `dirt_dry` `dirt_packed` `mud`
`grass_prairie` `grass_dry` `sand_fine` `gravel` `scree` `snow`
`bark_pine` `bark_oak` `bark_birch` `leaves_atlas` `foliage_scrub`
`wood_plank` `wood_weathered` `wood_painted` `plaster` `adobe` `brick`
`stone_block` `shingle` `corrugated_iron` `metal_rusted` `metal_worn`
`canvas_tent` `fabric_wool` `leather` `cobble` `hay` `glass_dirty` `paper_poster`

Helpers other systems may use:
```js
t.noise2D(x, y, opts)          // deterministic fBm sampler, CPU
t.heightToNormal(heightData, w, h, strength) // → DataTexture (linear)
t.makeCanvas(size)             // → { canvas, ctx2d }
t.toTexture(canvas, { srgb, repeat, aniso }) // → CanvasTexture, correctly flagged
```

### 4.2 `terrain`

```js
const T = ctx.get('terrain');
T.getHeightfield();     // → { data: Float32Array, res: number, size: number }
T.raycast(origin, dir); // → {point, normal, distance} | null  (analytic, fast)
T.getFlowMap();         // → { data: Float32Array, res } water flow accumulation
T.registerMaterialUser(fn); // fn(material) called for every terrain material —
                            // use to inject snow/wetness uniforms
```

`ctx.world.getSurface(x,z)` returns weights `{grass,rock,dirt,sand,snow}` that
**must** agree with what the terrain shader actually paints, so vegetation and
footstep audio match the visible ground.

### 4.3 `lighting`

```js
const L = ctx.get('lighting');
L.sun;                             // DirectionalLight (CSM-driven)
L.addLight(light, { flicker, radius, importance }); // register a local light
L.removeLight(light);
L.requestShadowCaster(object3d);   // opt an object into the shadow cascades
```

Local lights are budget-managed: only the N nearest/most important are active.

### 4.4 `postfx`

```js
const P = ctx.get('postfx');
P.render(dt);                      // called by Engine — do not call yourself
P.setDOF({ focusDistance, aperture, bokehScale, enabled });
P.setGrade(name | { lift, gamma, gain, saturation, temperature });
P.shake(intensity, duration);      // camera impulse, e.g. thunder / gunshot
P.velocityBuffer;                  // RG16F texture, for motion blur + TAA
P.depthTexture;                    // scene depth, for volumetrics/particles
```

Systems that need soft-particle depth or SSR must read `P.depthTexture`.

### 4.5 `physics`

```js
const PH = ctx.get('physics');
PH.addBody({ shape, mass, position, quaternion, friction, restitution, mesh });
PH.removeBody(body);
PH.raycast(origin, dir, maxDist, mask); // → hit | null
PH.sphereCast(origin, dir, radius, maxDist);
PH.step(dt);                        // fixed 1/60, called by its own update
```
Terrain collision is analytic against `ctx.world.getHeight`, not a mesh.

### 4.6 `particles`

```js
const PT = ctx.get('particles');
PT.emitter(name, opts);   // 'rain' 'snow' 'dust' 'embers' 'smoke' 'fireflies'
                          // 'splash' 'muzzle' 'leaves' 'pollen' 'breath'
PT.burst(name, position, count, opts);
```
All particles are soft-particle depth-faded and lit by `ctx.env`.

### 4.7 `bike` — THE RIDEABLE CONTRACT

Anything the player can ride publishes this surface, and it is deliberately the
one the horse published before it, so `Player`'s mount transition, mounted pose,
camera rig and audio hooks work against any of them without a branch:

```js
const B = ctx.get('bike');
B.state;            // { position, velocity, radius, height, grounded,
                    //   groundNormal, maxSlopeCos, stepHeight } — as Physics wants
B.yaw; B.speed01; B.renderPos; B.mounted; B.holdStill;
B.syncPose(dt);     // idempotent per frame; pose before anyone reads the seat
B.getSaddle();      // → { position, quaternion, stirrupL, stirrupR,
                    //     bobMetres, gaitPhase, gait, speed01, freq,
                    //     gripL, gripR, vehicle }
B.status();         // → { fuel, running, rpm, gear, speed, speedKph, headlight }
B.refuel(amount);   // spends one `fuel` from Loot; false if there is none
```

`stirrupL/R` are footpegs. `freq` MUST be 0 for a vehicle — Player gates its
whole gait-rocking chain on it. `vehicle: true` switches the rider from an
equestrian seat to a forward crouch with the hands IK'd onto `gripL/R`.

### 4.8 `riven` — the infected

Types are `stray` (the common runner), `skitter` (low, quadrupedal, fast) and
`harrow` (large, slow, tough). `hit.part` is `'head'` or `'body'`.

```js
const R = ctx.get('riven');
R.raycast(origin, dir, maxDist);   // → hit | null   (same shape as Wildlife's)
R.applyHit(hit, damage);           // → { killed, species } | null
R.alarm(position, radius, intensity);  // wake everything in earshot
R.hunting;                         // how many are actively chasing, for the HUD
R.noise;                           // how loud the player is being, 0 .. ~14
R.stats();
```

Anything that makes a noise should call `alarm()`. The single most important
number in the game is `R.noise`: crouching is 0.25, walking 1.0, the bike with
the throttle open is 14.

### 4.9 `cordon` — the armed faction

```js
const C = ctx.get('cordon');
C.raycast(origin, dir, maxDist);   // → hit | null   (same shape as Riven's)
C.applyHit(hit, damage);           // → { killed, species } | null
C.alarm(position, radius);         // put everything in range on alert
C.engaged;                         // how many have eyes on you, for the HUD
C.stats();
```

Types are `trooper` (rifle, 72 m, holds ground) and `enforcer` (close, tough,
advances). Checkpoints are sited on HIGHWAY routes only — that is deliberate and
load-bearing: the Cordon is the price of the fast road, and taxing a logging
spur would break the one clean trade the map offers.

They sense by SIGHT where the Riven sense by SOUND, and every other rule is
inverted to match, so the two factions cannot be answered the same way. Anything
that adds a new enemy should pick a side of that table rather than splitting it.

`Cordon._fire` alarms the Riven at 260 m — further than the player's own rifle —
which is what makes a firefight draw the horde. `Riven.nearestTo(pos, radius)`
exists for the Cordon to find targets without reaching into its `_agents`.

### 4.10 `loot`

```js
const L = ctx.get('loot');
L.inventory;             // { fuel, ammo, scrap, meds } — read freely
L.nearest();             // the stash in range, or null
L.collect(stash);        // → what was gained
L.take(res, n);          // → false if there is not enough
L.give(res, n);          // → how much fitted under the cap
L.dropFrom(pos, kind);   // something died carrying something
```

`Weapon.reserve` is reconciled against `inventory.ammo` every frame by Loot —
the weapon never learns an inventory exists and the inventory never has to
understand a reload.

### 4.10b `garage` / `compound` — progression and the ending

```js
const G = ctx.get('garage');
G.mult('baffle');        // the multiplier a track currently supplies
G.costOf('tank');        // scrap for the next level, or null if maxed
G.nearest();             // the workbench in range, or null
G.buy(track);            // spends scrap; refuses away from a bench
G.readiness();           // 0..1 across all tracks

const C = ctx.get('compound');
C.status();              // { seen, distance, defenders, cleared, escaped }
```

Tracks are `tank economy baffle gearing tyres`. Bike reads tank/economy/gearing/
tyres each fixed step; **Riven reads `baffle` inside `_playerNoise()`**, which is
what makes it a stealth upgrade rather than a stat.

The compound garrisons itself through `Cordon.addPost(pos, yaw, size, tag)`
rather than growing a second soldier AI — same faction, same rules, so what the
player learned at a highway checkpoint still applies at the last fight. Posts
tagged `'compound'` get no roadblock built on them.

There is deliberately NO experience or level system. If you are tempted to add
one, read the header of Garage.js first.

### 4.11 `roads`

```js
const R = ctx.get('roads');
R.routes;                  // polylines, each tagged .cls .halfWidth .speed
R.index;                   // RoadIndex — nearest(x,z) / distance2(x,z)
R.query(x, z);             // → { on, speed, d, tx, tz }
R.distance2(x, z);         // cheap keep-out test for bakes
R.nearestStation();        // the station whose pumps are in range, or null
R.usePump(station);        // fills the tank, costs the station one reserve
R.stats();
```

`query().on` is 0 off-road and 1 on the running surface, easing out over a 1.9 m
shoulder. `speed` is the class multiplier (highway 1.00, logging 0.86, track
0.70) and is only meaningful where `on > 0`.

**Roads plans; Scatter draws.** The ribbon is Scatter's existing streaming
ground mesh — it takes `roads.routes` and widths straight off this system. Do
not render a second road surface; two ribbons fight over the same z-range.

**The roadbed is DRAPED, not graded.** `Terrain.addHeightOverride` was measured
and rejected for this: `getHeight` scans overrides linearly and is the hottest
function in the engine, so a chunked road network would put ~140 footprint tests
on every ground query forever. The router earns the smoothness instead by
punishing gradient quadratically. If you ever want real cuttings, index the
override list spatially first.

### 4.12 `audio`

```js
const A = ctx.get('audio');
A.play(name, { position, volume, pitch, loop });  // → handle
A.ambience(name, weight);   // crossfade an ambient bed 0..1
A.stop(handle);
```
Everything is synthesised with WebAudio — no sample files.

---

## 5. Art direction

The target is **the wet side of the Cascade Range, shot on film**. Overcast,
cold, and dark. Specifically:

- **Palette.** Near-black basalt, blue-green conifer shadow, wet duff, pale
  pumice, and snow. Greens read green because everything is DARK, not because
  anything is saturated — the metrics gate caps on-screen green saturation at
  0.34 and it is right to. Rock is GREY: andesite and basalt are young and
  barely oxidised, and the red sandstone this world used to be made of was a
  desert mineralogy. Skies are a lid more often than they are blue.
- **Light.** Strong directional key with genuinely soft penumbrae. Skylight fills
  shadows with *cool blue*; bounce off the ground fills with *warm ochre*.
  Golden hour is the money shot: long shadows, rim-lit dust, aerial perspective
  stacking depth in visible layers.
- **Atmosphere is the single most important thing.** Every distant object must
  sit behind correctly-scattered haze. Depth must read as discrete layers of
  progressively lighter, bluer, lower-contrast silhouettes. A scene without
  aerial perspective looks like a toy no matter how good the meshes are.
- **Contrast & grade.** Filmic curve, slightly lifted blacks with a cool tint,
  gentle highlight rolloff, subtle halation around the sun. Never crushed, never
  blown out. A touch of grain. Very slight chromatic aberration at the edges only.
- **Surface honesty.** No surface is uniform. Every material needs large-scale
  variation (metres), medium detail (decimetres) and micro-detail (millimetres),
  plus edge wear, dirt accumulation in crevices, and sun-bleaching on up-facing
  planes.
- **Silhouette & composition.** Ridge lines should read as interesting
  silhouettes from any angle. Avoid uniform slopes and repeating shapes.
- **Motion.** Nothing is perfectly still. Grass, leaves, cloth, dust, water,
  and the camera itself all carry low-amplitude continuous motion.

**Common failure modes that will get your work rejected:**
plastic-looking uniform materials · tiling you can see · flat lighting with no
shadow contrast · saturated cartoon green grass · a sky gradient with no
scattering · hard-edged shadows · geometry that pops or z-fights · everything
in perfect focus with no atmospheric depth · repeating identical props on a grid.

---

## 5b. Iteration discipline — READ THIS, IT IS WHY PASSES WERE SLOW

Measured cost of the loop you are about to run: **boot is 15–26 s per capture**,
and a full 10-shot set at 1920×1080/ultra adds ~5 s per shot on top. Agents that
iterate six times at full quality burn most of their wall clock waiting.

**Use `--fast` for every intermediate look.** Same code paths, ~4× cheaper
(1280×720, medium preset, 48 settle frames):

```bash
node tools/capture.mjs --fast --out shots/_me --only golden_hour_vista
```

Only run full resolution/ultra for the one final judgement you report on.

**Rules that keep the loop tight:**
1. Capture **only the shots that exercise your system** (`--only a,b`). Never the
   full set until the end.
2. **Two improvement rounds, not six.** Make the biggest change you believe in
   first, look, then make one correction. Small timid increments cost the same
   wall clock as large ones and converge slower.
3. **Boot budget is 5 s.** If your `init()` does heavy generation — erosion,
   LUTs, texture baking — cache it, cut its resolution, or move it off the boot
   path (generate at low res first, refine after the first frame). Every capture
   by every future agent pays your boot cost. This is the highest-leverage
   optimisation available to you and it compounds across the whole project.
4. **Do not re-derive context.** The brief you were given already contains the
   defect list. Read the files you own and the contracts; do not go exploring the
   whole tree.
5. **Frame budget is 16 ms at ultra 1080p.** A shot over budget is a defect, not
   a trade-off. Report your own system's cost in ms and draw calls.

---

## 6. Verification — REQUIRED before you report done

```bash
cd .

# 1. must compile
npx vite build --logLevel error

# 2. must boot clean, zero console errors (exit code 0)
node tools/capture.mjs --smoke --fast --out shots/_yourname

# 3. ITERATE HERE — cheap, only your shots (see §5b)
node tools/capture.mjs --fast --out shots/_yourname --only golden_hour_vista

# 4. ONCE, at the end, for the result you report
node tools/capture.mjs --out shots/_yourname --w 1920 --h 1080 --only golden_hour_vista,dawn_mist_valley
```

Then **`Read` the PNG files you just produced** and judge them honestly against
§5. If it does not look AAA, keep working. Iterate until the image is genuinely
good — that is the deliverable, not the code.

Shot names available: `golden_hour_vista dawn_mist_valley high_noon_desert
town_street night_camp storm_plains river_bend forest_interior
player_third_person moonlit_ridge`.

`stats()` in the report tells you draw calls / triangles / frame ms — watch them.

---

## 7. Report format

Return a short structured summary: what you implemented, the techniques used,
the final stats (draw calls / tris / ms), what you verified visually, anything
you had to leave out, and anything another system must do for your work to look
right.

---

## 8. Automated gates — run these before you report done

Beyond the visual check in §6, your work must pass the scripted judges. Every
one of these encodes a defect that was once real in this project and was fixed;
they exist so it cannot come back silently (see `docs/PROCESS.md` §3).

```bash
python3 tools/metrics.py --shots shots/_yourname      # regression suite
node tools/capture.mjs --motion --fast --out shots/_yourname_m --frames 24
python3 tools/motion.py --dir shots/_yourname_m       # temporal artifacts
```

`metrics.py` gates: single sun disc · aerial-perspective hue and contrast both
correctly signed with distance · real blacks present · HDR headroom · silhouette
anti-aliasing · grass not emerald · no chroma artifacts · frame and boot budget.

`motion.py` gates: static-camera temporal σ (shimmer) · LOD pop ratio during a
dolly. **These catch what screenshots cannot** — a perfect still can come from a
frame that boils. If your system draws anything with alpha-tested foliage, thin
geometry, or a specular response, run the motion gate.

Both exit non-zero on failure and print the offending numbers. A red gate is a
defect, not a matter of taste.

`stats().systemMs` now reports per-system CPU cost, worst first — use it to find
out whether the offender is actually yours before optimising.

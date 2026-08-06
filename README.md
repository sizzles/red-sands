<div align="center">

# BROKEN ROAD

**An open-world survival ride that runs entirely in a browser tab.**

8 km² of the Cascade Range · glaciated volcanoes · endless rain · a motorcycle you have to keep fuelled
No downloads. No plugins. No art files — every texture, mesh and sound is generated at runtime.

[![three.js](https://img.shields.io/badge/three.js-r185-000?logo=three.js&logoColor=white)](https://threejs.org)
[![WebGL2](https://img.shields.io/badge/WebGL-2.0-990000)](https://developer.mozilla.org/docs/Web/API/WebGL2RenderingContext)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-5c8374)](LICENSE)

</div>

---

## What this is

A procedurally generated open world — volcanic terrain, conifer forest, weather, the Riven,
audio — rendered in WebGL2. There is not a single `.png`, `.gltf` or `.wav` in the
repository. The mountains are real stratovolcano profiles with hydraulically eroded
flanks, the sky is a physical scattering integral, the engine note is four oscillators
and a resonant filter, and the rain has been falling for about as long as anyone can
remember.

It began life as [an open-world western](#lineage) and was converted. Most of the
renderer survived that intact; almost none of the world did.

## Play

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Click to capture the pointer. On a phone, just open it —
touch controls appear on their own.

| | |
|---|---|
| **W A S D** | move · on the bike, throttle and steering |
| **Shift** | run · open the throttle |
| **S** *(riding)* | brake |
| **Ctrl** | crouch — and crouching is how you stay alive |
| **E** | get on the bike · loot a stash · skin a carcass |
| **L** | headlight |
| **F** | pour a fuel can into the tank |
| **Q** | use a bandage |
| **Right mouse** | raise the rifle |
| **Left mouse** | fire |
| **R** | reload |

Add `?quality=mobile|low|medium|high|ultra` to force a preset, or `?touch=1` to see the
touch controls on a desktop.

## The road

Ten routes in three classes, and the classes are not three widths of the same
road — they route differently because they are held to different gradients. A
state route is capped at 7.5%, a logging spur at 15%, a two-track at 26%, which
is roughly what real survey standards allow. The highway therefore has to go
round the hill the two-track goes over.

Routing is A* over a cost grid, and it is the second router written for this. The
first was greedy least-effort descent — step, fan out candidate headings, take
the best — and it was replaced on evidence: measured over the finished network it
gave highways a mean gradient of **15.9%** with pitches over 100%, and 44% of one
route steeper than 12%. A greedy walker facing a slope has no candidate that
avoids it and takes the least-bad one; worse, it structurally cannot switchback,
because reversing direction is never a locally good move. A* has neither blind
spot — it will send a road two kilometres sideways and back if that is genuinely
cheaper, which is what a survey does. The same network now measures **4.5 / 7.8 /
7.0%** mean on its three highways.

The cost function is `length · (1 + 9·(grade/maxGrade)²)`, quadratic because
earthwork goes as the square of the cut, with a ×24 penalty rather than an
infinity beyond the class limit: a road that breaks its own standard for eighty
metres is a real road, one that cannot be built at all is a crash.

**On the road the bike is quicker, but grip is the real prize.** Top speed rises
14%; grip rises 20% *and* the loose-surface penalty vanishes, which off-road can
drag drive down to 0.35 on wet pumice. The suspension also stops working, which
is the part you actually feel. Roads clear their own corridor — timber felled
7.5 m either side, sward thinned — so in the trees a road reads as a cut long
before you can see its surface.

**Fuel stations** sit on the highways at roughly 1.1 km intervals, on the
flattest ground within reach of the carriageway, and each holds three tanks that
do not come back. The map is a slowly emptying resource, so the third hour is a
longer ride than the first. Their pole signs carry the only saturated colour in
the world, because from the saddle at 90 km/h in the rain the sign is the only
part of a station you will ever spot in time to stop.

## The loop

Three numbers, and they pull against each other:

- **Fuel.** A full tank is about four minutes of hard riding. Jerry cans are scattered
  across the map at fixed positions, and there are never quite enough.
- **Noise.** The Riven hunt by sound. Crouching puts you at `0.25`; walking is `1.0`;
  the bike, with the throttle open, is `14` — fifty-six times louder. The thing that
  lets you cover ground is the thing that tells everything in the valley where you are,
  and shutting the engine off to push the last kilometre is a real decision because the
  numbers make it real.
- **Ammunition.** Every round you fire is one you had to find, and firing a rifle wakes
  everything inside 220 metres. A gun is what you use when the plan has already failed.

The cruelty is emergent rather than authored: the model that decides where a nest goes
and the model that decides where a stash goes are *both* "somewhere sheltered a person
would have used", so the two correlate, and the best loot in the world is
disproportionately inside the worst places to be. Nobody wrote that down.

## Under the hood

**The mountains.** Four stratovolcanoes and two cinder cones, placed by hand on a
continuous volcanic crest, because a cone is *concave up* — shallow at the base and
steepening all the way to the summit — and that is the exact opposite of what noise
gives you. With `h(r) = H·(1 − r/R)^1.62` the summit slope works out at 31°, the angle
of repose for fragmental volcanic debris, which is the angle real cones stand at. Radial
barrancas are deepest at mid-flank; the summit crater is a subtracted bowl, which leaves
the raised rim for free; and the fractal mountain noise is faded out over the top third
of every cone, because noise on a cone's shoulders reads as erosion and noise on its
summit reads as a broken cone.

**The divide.** The crest runs north–south and everything follows from which side of it
you are on. Air off the Pacific is forced up the west flank, drops its water there, and
comes down the east side dry — so within thirty kilometres you get temperate rainforest
on one side and sagebrush, basalt and pumice desert on the other. Aridity is computed
from the signed distance to the crest, and vegetation, ground colour and scatter all
inherit the divide without knowing it exists.

**Lava.** A basalt flow field is nearly flat at the kilometre scale and savage at the
metre scale, with essentially nothing in between. That spectral gap is the whole tell:
hills have detail at every scale, lava has detail at exactly one, which is why a flow
looks like nothing from a ridge and is impassable on foot.

**The bike.** A genuine bicycle model — `yawRate = v·tan(steer)/wheelbase` — so you
cannot turn at a standstill and the turn radius grows with speed. The lean follows the
real balance condition, `lean = atan(v·yawRate/g)`, which means it banks by exactly as
much as the corner demands. Faking the lean off steering input is the usual shortcut and
it reads as wrong immediately, because the bike then leans hardest where it is turning
least. Attitude comes from sampling the ground under both contact patches 1.5 m apart,
which is what stops it burying its nose in a ditch.

**The engine.** Four oscillators through one resonant lowpass. The audible one is a
sawtooth an octave *below* the firing rate — a 270° twin fires unevenly, and that
half-rate lope is the entire difference between a big twin and a scooter. Intake noise
is driven by throttle rather than by rpm, so the motor audibly strains under load and
goes quiet on a trailing throttle at the same revs. There is a gearbox purely so the
note *falls* when it changes up.

**The Riven.** Survivors' word for them — *riven*, torn apart — and the same word the
map uses for the gap north of the crest, because the people who named one named the
other. Three shapes, distinguishable by silhouette alone at eighty metres because that
is the only warning you get: the **stray** (human height, pitched forward so the head
leads the body), the **skitter** (0.85 m on all fours, reads as an animal until it is
far too close), and the **harrow** (2.15 m, slow, worth running from).

They move in packs of three to twelve around fixed nests, and the horde is compressed
into one mechanic: one that sees you screams, and the scream puts
everything within 62 m straight into a chase with your position already known — which
chains through overlapping packs. Waking one group next to two others is how six become
twenty-five without twenty-five ever being simulated as a group.

**Redwoods.** 48–78 m, and the point of them is scale — which is not a property
of one object but a relationship. A 62 m redwood among 20 m ponderosa reads as
enormous; the same tree alone reads as a normal tree seen from closer. So two
thirds of the height is clean bole with nothing on it, the crown radius is 12% of
height against the pine's 30%, and the butt swell is an exponential buttress
bolted onto a near-cylindrical column. The empty vertical column *is* the effect.
They are sited rather than sprinkled: a low-frequency grove mask plus moisture and
altitude gates puts them on the wet valley floors west of the crest and nowhere
else, so riding up out of the valley means riding out of them.

**Columnar basalt.** The signature rock of a flood-basalt province, and it looks
like masonry because it is a crystallisation pattern — a cooling sheet contracts,
relieves the strain as cracks meeting at 120°, and those hexagons extrude down the
cooling front into columns. Three things follow and all three are modelled: the
columns *tessellate* (one block that cracked, not a pile of rocks), the tops are
*broken at cross-joints* rather than cut to an envelope, and they stand
*perpendicular to the cooling surface*, so a cluster shares one tilt instead of
each column leaning independently. Placed where flat ground paints as bedrock —
on this map the unique signature of a young lava field — and on cut faces where a
river has sliced a flow open.

**Sky and light.** A Hillaire-style scattering chain — transmittance, multiple-scattering
and sky-view LUTs, Rayleigh + Mie with Cornette-Shanks phase and an ozone layer. The sun
follows a NOAA solar ephemeris at 43.9° N, which is worth more than a geography note:
nine degrees further north than this world used to be is a materially lower sun, longer
shadows all day, and a golden hour that lasts.

**Rendering.** Cascaded shadow maps with PCSS contact hardening; GTAO; TAA with YCoCg
variance clipping; SSR; raymarched volumetric clouds with a deep-scattering floor; AgX
tonemapping with a strictly monotone highlight shoulder.

## On a phone

Detection is a media query, not a user-agent sniff: coarse pointer plus no hover. The
mobile preset renders at `pixelRatio 0.62` and turns the cloud raymarch off, which
together are worth more than everything else in the block — a phone GPU's bottleneck is
fragments and bandwidth, never triangles.

The touch overlay is DOM rather than canvas, so the browser composites it and the render
loop pays nothing. The movement stick feeds *analog* axes into the player's input (the
throttle needs the gradient); discrete actions dispatch real `KeyboardEvent`s on
`window`, so every existing handler — including its priority ordering — runs unchanged
rather than being reimplemented and drifting.

## Architecture

Twenty-three systems on a fixed lifecycle, sharing one frozen context object:

```
src/core/       Engine, Context (the shared contract), Config
src/materials/  procedural PBR library + worker bake pool
src/world/      Terrain · Roads · Vegetation · Scatter · Town
src/render/     Sky · Clouds · Water · Lighting · Particles · PostFX
src/sim/        TimeOfDay · Weather · Physics · Wildlife · Riven · Loot
src/player/     Player · Bike · Weapon · CameraRig
src/audio/      synthesised beds + foley
src/ui/         HUD · TouchControls
```

Every system implements `init / update / lateUpdate / resize / dispose` and communicates
only through `ctx` and events. Ownership of every shared field is documented in
[`docs/CONTRACTS.md`](docs/CONTRACTS.md).

The bike deliberately publishes the same surface the horse it replaced did — `state`,
`yaw`, `speed01`, `renderPos`, `syncPose()`, `getSaddle()` — so the mount transition,
the mounted pose, the camera rig and the audio hooks all work against it unchanged.
Where the horse published stirrup irons, the bike publishes footpegs.

## How it is judged

The interesting part of this repo may be the test rig rather than the game. Since "does
it look good" is not a unit test, the project grew instruments that answer it
mechanically. They live in [`tools/`](tools) and are documented in
[`docs/PROCESS.md`](docs/PROCESS.md).

| Tool | What it catches |
|---|---|
| `capture.mjs` | renders canonical shots headless on the real GPU, deterministically |
| `metrics.py` | a **regression suite for images** — every defect ever found, permanently asserted |
| `motion.py` | temporal artifacts: shimmer, LOD pop, ghosting |
| `flicker.mjs` | camera-motion flicker binned by true camera-relative distance |
| `abcompare.py` | blind A/B against the previous build |
| `scout.mjs` | adversarial camera — hunts the ugliest frame in the world |

```bash
npm run dev            # play it
npm run capture:fast   # render the canonical shots (1280×720, ~4× cheaper)
npm run metrics        # image regression suite
npm run motion         # temporal artifact gates
```

Two rules keep it coherent: **no external assets** (if you need a texture, generate it)
and **no `Math.random()`** (use the seeded `rng` from `src/core/Context.js`, or captures
stop being reproducible and every instrument above stops working).

## Lineage

This was [RED SANDS](https://github.com/gillworks/red-sands), an open-world western, and
the renderer, the material library, the audio synthesis and the whole test rig are its
work. The conversion replaced the world: desert became the Cascades, the horse became a
motorcycle, the weather turned, and something moved into the trees.

*Days Gone* was the design reference for that conversion in the same way Red Dead
Redemption 2 was the quality bar for the original. This project is unaffiliated with and
unendorsed by Sony Interactive Entertainment, Bend Studio or Rockstar Games, and shares
no names, characters or assets with either game.

## License

[MIT](LICENSE).

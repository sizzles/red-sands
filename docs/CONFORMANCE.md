# Conformance

A black-box description of everything in this game that is **pure arithmetic**,
sampled at fixed inputs and written to JSON.

```
npm run conform          check against the golden file
npm run conform:write    accept current output as the new golden
npm run conform:list     what is covered, and why
```

Exit 0 if everything matches, 1 if anything drifted.

---

## What it is for

### Porting

Most of this world is a function of numbers rather than of three.js: the random
stream, the terrain field, the ecology curves, the whole build grammar, every
character body, and all the balance tables. None of that touches a renderer, so
all of it can be reimplemented in another language.

The only honest way to know a reimplementation is **faithful** rather than
merely plausible is to run the same inputs through both and diff the numbers. A
Luau port implements `probes.mjs`, emits the same JSON shape, and diffs against
`golden.json`. Divergence localises to one function immediately instead of
presenting as "the world looks a bit wrong".

### Regression

That is the stated purpose. The one it earns its keep on day to day is catching
changes nobody meant to make. This repository has shipped:

- a compound whose every wall faced **inwards**, which survived four renders
  because a wall with its detail on the far side photographs exactly like a wall
  whose detail is too shallow;
- four tower ladders leading to decks **no character in the game could reach**,
  with the connectivity check reporting the position fully connected;
- two workbenches **17 m apart** that a comment claimed were 120.

Every one of those is a number that changed and nobody noticed. Every one would
have failed here.

---

## Precision

JavaScript and Luau both use IEEE-754 doubles, so `+`, `*` and comparisons agree
bit for bit. `sin`, `cos`, `pow` and `sqrt` are implementation-defined in the
last few units in the last place, and this world is built out of trigonometry.

So every number is rounded to **6 significant figures** on the way out. That is
far tighter than any real divergence and far looser than the ~1e-16 noise those
functions actually produce.

If a port fails only on trigonometry-heavy probes and only in the sixth figure,
the port is fine and the tolerance is the thing to discuss — not the code.

---

## What a probe must be

| Rule | Why |
| --- | --- |
| **Pure** | no renderer, no browser, no clock, no `Math.random`. Everything runs in plain node in milliseconds. |
| **Fixed** | identical inputs every run. Seeds are constants in `probes.mjs`. |
| **Structural** | prefer counts, extents, sums and sorted keys over raw vertex dumps. A golden file nobody can read is a golden file nobody will update honestly when it legitimately changes. |

That last one is a judgement call, not a rule of thumb. `build.compound` reports
per-material vertex and triangle counts, a solid-cloud centroid and bounding
box, the sorted node and link lists, and the `navCheck` result — about ninety
numbers standing in for a 44,000-triangle structure. Enough that any real change
moves something; few enough that a human can read the diff and say whether it
was meant.

---

## Coverage

Run `npm run conform:list` for the current set with its reasoning. Broadly:

- **`rng.*`** — the PRNG itself, checked first because nothing else can match if
  it diverges, and separately across seeds to catch a port that has the
  algorithm right and the seed mixing wrong.
- **`field.regionAt`** — region weights at eight fixed points. These decide
  biome, vegetation, rock palette and where the lava beds are.
- **`ecology.logSize`** — the log-normal behind forest height distribution.
- **`build.bodies`** — all five Riven and both Cordon rigs: vertex and triangle
  counts, extents, part indices, mean vertex colour.
- **`build.blockhouse` / `build.tower` / `build.stair`** — the industrial
  grammar, including the walkable proxies, the ladder volume and the largest
  stair riser (which has to stay under the controller's step height, or the
  flight silently becomes a wall).
- **`build.compound`** — the whole endgame position: geometry, collision and
  circulation out of one set of rules. `nav.ok` false here means levels the
  player cannot reach.
- **`tables.*`** — the garage and gunsmith economies, plus the totals the two
  are balanced against each other on.

## Not covered

Anything that needs the running game: the terrain heightfield, the road router,
ecology maps, compound siting, loot placement, physics. Those want a browser and
belong in a second tier that boots the game — the probes under `_*.mjs` in the
repo root are the ad-hoc version of that, and folding them in is the obvious
next step.

The build grammar is covered against a **closed-form test surface**
(`testGround`) rather than real terrain, deliberately: what these probes test is
the grammar, not the ground, and a port can reproduce that surface in four
lines.

---

## Changing a golden value

`--write` prints exactly what changed before it overwrites. Read it. A golden
file that is easy to overwrite without reading is a golden file that records
whatever the bug did.

If a probe's **meaning** changes rather than its value, bump `VERSION` in
`probes.mjs`. A stale golden then fails loudly with a message saying so, instead
of comparing two things that were never the same measurement.

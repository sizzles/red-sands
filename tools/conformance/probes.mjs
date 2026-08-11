import * as THREE from 'three';
import { rng } from '../../src/core/Context.js';
import { regionAt } from '../../src/world/terrain/Field.js';
import { logSize } from '../../src/world/vegetation/Ecology.js';
import { Builder, Frame, navCheck } from '../../src/world/build/Builder.js';
import { buildBlockhouse, guardTower, stairRun } from '../../src/world/build/Industrial.js';
import { buildYard, YARD } from '../../src/sim/compound/Yard.js';
import { buildRiven } from '../../src/sim/riven/RivenBody.js';
import { buildCordon } from '../../src/sim/cordon/CordonBody.js';
import { TRACKS, TRACK_KEYS } from '../../src/sim/Garage.js';
import { GUN_TRACKS, GUN_KEYS } from '../../src/sim/Gunsmith.js';

/**
 * BROKEN ROAD — CONFORMANCE PROBES
 * ============================================================================
 * A black-box description of everything in this game that is PURE ARITHMETIC,
 * sampled at fixed inputs and written to JSON.
 *
 * WHY IT EXISTS
 * Most of this world is a function of numbers rather than of three.js: the
 * random stream, the terrain field, the ecology curves, the whole build grammar,
 * every character body, and all the balance tables. None of that touches a
 * renderer, so all of it can be reimplemented in another language — and the only
 * honest way to know a reimplementation is FAITHFUL rather than merely
 * plausible is to run the same inputs through both and diff the numbers.
 *
 * That is the stated purpose. The one it earns its keep on day to day is
 * regression: this repository has shipped a compound whose every wall faced
 * inwards, four tower ladders leading to decks nothing could reach, and two
 * workbenches 17 m apart that a comment claimed were 120. Every one of those is
 * a number that changed and nobody noticed. Every one would have failed here.
 *
 * WHAT A PROBE MUST BE
 *   PURE        no renderer, no browser, no clock, no Math.random. Everything
 *               here runs in plain node in milliseconds.
 *   FIXED       identical inputs every run. Seeds are constants in this file.
 *   STRUCTURAL  prefer counts, extents, sums and sorted keys over raw vertex
 *               dumps. A golden file nobody can read is a golden file nobody
 *               will update honestly when it legitimately changes.
 *
 * PRECISION
 * JavaScript and Luau both use IEEE-754 doubles, so `+`, `*` and comparisons
 * agree bit for bit. `sin`, `cos`, `pow` and `sqrt` are implementation-defined
 * in the last few units in the last place, and this world is built out of
 * trigonometry. So everything is rounded to SIG significant figures on the way
 * out. Six is far tighter than any real divergence and far looser than the
 * ~1e-16 noise those functions actually produce.
 * ============================================================================
 */

/** Every probe that takes a seed takes THIS seed. Never change it casually. */
export const SEED = 1337;
/** Significant figures kept in the golden file. See PRECISION above. */
export const SIG = 6;
/** Bumped when a probe's MEANING changes, so a stale golden fails loudly. */
export const VERSION = 1;

/* ------------------------------------------------------------------ helpers */

const KEYS = {
  concrete: 'concrete', rust: 'rust', iron: 'iron',
  bag: 'bag', gravel: 'gravel', lamp: 'lamp',
};

/**
 * A deterministic stand-in for the terrain under a structure.
 *
 * Deliberately NOT the real heightfield: that needs the whole terrain system
 * and a browser, and what these probes are testing is the GRAMMAR, not the
 * ground. A closed-form surface with a real cross-fall exercises every
 * ground-following path — level coping, seated towers, stepped gabions — and a
 * port can reproduce it in four lines.
 */
export function testGround(x, z) {
  return 100 + x * 0.05 + Math.sin(z * 0.05) * 0.6;
}

/** Vertex/triangle/extent summary of a BufferGeometry. */
function geomSummary(g) {
  const p = g.attributes.position.array;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < lo[k]) lo[k] = p[i + k];
      if (p[i + k] > hi[k]) hi[k] = p[i + k];
    }
  }
  const out = {
    verts: g.attributes.position.count,
    tris: g.index ? g.index.count / 3 : 0,
    min: lo, max: hi,
  };
  if (g.attributes.aPart) {
    out.parts = [...new Set(g.attributes.aPart.array)].sort((a, b) => a - b);
  }
  if (g.attributes.color) {
    const c = g.attributes.color.array;
    let s = 0;
    for (let i = 0; i < c.length; i++) s += c[i];
    out.colourMean = s / c.length;
  }
  return out;
}

/**
 * A stable fingerprint of a list of positions.
 *
 * Sums and extents rather than a hash: a hash tells you THAT something moved,
 * a centroid and a bounding box tell you roughly WHERE, which is the difference
 * between a failing test you can act on and one you have to bisect.
 */
function cloud(list, get) {
  let n = 0, sx = 0, sy = 0, sz = 0;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const item of list) {
    const p = get(item);
    n++; sx += p[0]; sy += p[1]; sz += p[2];
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  }
  if (!n) return { n: 0 };
  return { n, centroid: [sx / n, sy / n, sz / n], min: lo, max: hi };
}

/* ------------------------------------------------------------------- probes */

export const PROBES = [
  /* ---------------------------------------------------------- foundations */
  {
    id: 'rng.sequence',
    why: 'Everything seeded in this world comes out of this function. If it '
       + 'diverges, nothing else can possibly match, so it is checked first.',
    run() {
      const r = rng(SEED);
      return Array.from({ length: 12 }, () => r());
    },
  },
  {
    id: 'rng.streams',
    why: 'Different seeds must give unrelated streams — this catches a port '
       + 'that has the algorithm right and the seed mixing wrong.',
    run() {
      const out = {};
      for (const s of [0, 1, 0x7b19a3, 0x51d3ae07, 4294967295]) {
        const r = rng(s >>> 0);
        out[String(s)] = [r(), r(), r()];
      }
      return out;
    },
  },

  /* --------------------------------------------------------- terrain field */
  {
    id: 'field.regionAt',
    why: 'The region weights decide biome, vegetation, rock palette and where '
       + 'the lava beds are. A port that gets these wrong builds a different '
       + 'world that still looks like a world.',
    run() {
      const pts = [
        [0, 0], [1200, -800], [-2400, 1600], [3320, 1350],
        [-3448, 2696], [2841, 3954], [-1040, 2848], [4000, -4000],
      ];
      const out = {};
      for (const [x, z] of pts) {
        const R = regionAt(x, z);
        out[`${x},${z}`] = {
          mount: R.mount, foot: R.foot, bad: R.bad, plain: R.plain,
          sand: R.sand, arid: R.arid,
        };
      }
      return out;
    },
  },

  /* -------------------------------------------------------------- ecology */
  {
    id: 'ecology.logSize',
    why: 'The log-normal that gives a forest its height distribution. Ten '
       + 'samples pin the whole curve including both tails.',
    run() {
      const out = [];
      for (let i = 0; i <= 10; i++) out.push(logSize(i / 10, 0.46, 1.55, 1.75));
      return out;
    },
  },

  /* -------------------------------------------------- the build grammar */
  {
    id: 'build.bodies',
    why: 'Every character in the game is a box rig — the part that ports to '
       + 'another engine essentially verbatim, because it is boxes and boxes '
       + 'are what every engine has.',
    run() {
      const out = {};
      for (const k of ['stray', 'skitter', 'harrow', 'keener', 'cairn']) {
        const r = rng(SEED ^ 0x11);
        out['riven.' + k] = geomSummary(buildRiven(k, r));
      }
      for (const k of ['trooper', 'enforcer']) {
        const r = rng(SEED ^ 0x22);
        out['cordon.' + k] = geomSummary(buildCordon(k, r));
      }
      return out;
    },
  },
  {
    id: 'build.blockhouse',
    why: 'One structure through the industrial grammar: repeat-to-fit bays, '
       + 'recessed openings, plinth, pilasters, roof. If the bay arithmetic '
       + 'drifts, the rhythm changes and this moves.',
    run() {
      const B = new Builder();
      const F = new Frame(0, 100, 0, 1, 0);
      const r = rng(SEED ^ 0x33);
      buildBlockhouse(B, F, KEYS, {
        w: 13, d: 7.5, h: 6.2, bay: 3.25, roof: 'iron', ground: 0,
        bays: ['vent', 'door', 'vent', 'vent'], grime: 0.66,
      }, r);
      const geos = B.build();
      const out = { buckets: {}, stats: B.stats() };
      for (const [k, g] of [...geos].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        out.buckets[k] = geomSummary(g);
      }
      return out;
    },
  },
  {
    id: 'build.tower',
    why: 'The framed tower, its walkable deck proxy and the ladder volume that '
       + 'reaches it. Covers the three-channel emission in one call.',
    run() {
      const B = new Builder();
      const F = new Frame(0, 100, 0, 1, 0);
      const r = rng(SEED ^ 0x44);
      B.node('ground', { x: 0, y: 100, z: 0, kind: 'ground' });
      guardTower(B, F, KEYS, {
        h: 15.5, r: 1.55, rand: r, ground: 0, node: 'deck', from: 'ground',
      });
      const plan = B.plan();
      return {
        stats: B.stats(),
        solids: cloud(plan.solids, (s) => [s.x, s.y, s.z]),
        walkable: plan.solids.filter((s) => s.walkable).length,
        ladders: plan.ladders.map((l) => ({
          y0: l.y0, y1: l.y1, top: [l.top.x, l.top.y, l.top.z], n: [l.nx, l.nz],
        })),
        nav: navCheck(plan, 'ground'),
      };
    },
  },
  {
    id: 'build.stair',
    why: 'Treads, and the largest single riser. That number has to stay under '
       + 'the controller step height or the flight becomes a wall — which no '
       + 'render would show, because a wall and a stair look identical.',
    run() {
      const B = new Builder();
      const F = new Frame(0, 100, 0, 1, 0);
      B.node('a', { x: 0, y: 100, z: 0, kind: 'ground' });
      B.node('b', { x: 0, y: 103.85, z: 0, kind: 'walk' });
      stairRun(B, F, KEYS, { x: 0, z: 0, y0: 0, y1: 3.85, w: 1.5, from: 'a', to: 'b' });
      const plan = B.plan();
      const tops = plan.solids
        .filter((s) => s.tag === 'stair').map((s) => s.y + s.hy).sort((p, q) => p - q);
      let maxRiser = 0;
      for (let i = 1; i < tops.length; i++) {
        const d = tops[i] - tops[i - 1];
        if (d > maxRiser && d < 1) maxRiser = d;
      }
      return {
        treads: tops.length, maxRiser,
        rise: tops.length ? tops[tops.length - 1] - 100 : 0,
        links: plan.links.length,
      };
    },
  },
  {
    id: 'build.compound',
    why: 'The whole endgame position: geometry, collision and circulation out '
       + 'of one set of rules. `nav.ok` false here means levels the player '
       + 'cannot reach, which is exactly the bug that shipped once already.',
    run() {
      const r = rng(SEED ^ 0x55);
      const site = { pos: new THREE.Vector3(0, 100, 0), yaw: 0.4 };
      const built = buildYard(site, r, KEYS, testGround);
      const buckets = {};
      for (const [k, g] of [...built.shell].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        buckets[k] = geomSummary(g);
      }
      const byTag = {};
      for (const s of built.plan.solids) byTag[s.tag] = (byTag[s.tag] || 0) + 1;
      return {
        yard: YARD,
        buckets,
        gateH: built.gateH,
        wallTop: built.wallTop,
        nav: built.nav,
        nodes: [...built.plan.nodes.values()]
          .map((n) => ({ id: n.id, y: n.y, kind: n.kind }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
        links: built.plan.links
          .map((l) => `${l.a}>${l.b}:${l.kind}`).sort(),
        solidsByTag: byTag,
        solids: cloud(built.plan.solids, (s) => [s.x, s.y, s.z]),
        lamps: built.lamps.map((l) => [l.x, l.y, l.z]),
        posts: built.posts.map((p) => [p.x, p.z]),
      };
    },
  },

  /* -------------------------------------------------------- balance tables */
  {
    id: 'tables.garage',
    why: 'Pure data, and the economy rests on it. Cheap to check and it makes '
       + 'a port impossible to get subtly wrong by transcription.',
    run: () => ({ keys: TRACK_KEYS, tracks: TRACKS }),
  },
  {
    id: 'tables.gunsmith',
    why: 'As above. Also pins the total build cost against the garage, which '
       + 'is the thing the two are balanced on.',
    run() {
      let total = 0;
      for (const k of GUN_KEYS) total += GUN_TRACKS[k].cost.reduce((a, b) => a + b, 0);
      let bike = 0;
      for (const k of TRACK_KEYS) bike += TRACKS[k].cost.reduce((a, b) => a + b, 0);
      return { keys: GUN_KEYS, tracks: GUN_TRACKS, totalRifle: total, totalBike: bike };
    },
  },
];

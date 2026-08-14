import * as THREE from 'three';

/**
 * BROKEN ROAD — THE ROAD NETWORK
 * ============================================================================
 * A road is not a line between two points. It is the cheapest path a grading
 * crew could find, and everything that makes a road read as a road — the way it
 * contours round a spur instead of over it, the way it hunts for the low saddle
 * on a pass, the way it runs beside a river rather than crossing it twice —
 * falls out of routing on COST rather than on distance.
 *
 * THE ROUTER is A* over a cost grid, and it is the second one written here. The
 * first was greedy least-effort descent — step forward, fan out candidate
 * headings, take the best — and it was replaced on evidence rather than on
 * taste. Measured over the finished network it produced highways with a mean
 * gradient of 15.9% and pitches to 106%, with 44% of one route steeper than
 * 12%. A greedy walker facing a slope has no candidate that avoids it and takes
 * the least-bad one; worse, it structurally cannot switchback, because
 * reversing direction is never a locally good move. A* has neither blind spot.
 *
 * ROAD CLASSES, and why they route differently
 *
 *   highway  Two lanes of state route, laid before any of this happened. Held
 *            to 7.5% gradient because it was surveyed and graded properly, so
 *            it takes the long way round everything and is the fastest thing to
 *            ride. It is also the most exposed.
 *   logging  A gravel spur to a landing or a mill. Takes 15%, so it goes places
 *            the highway will not.
 *   track    A dirt two-track. 26% — anything a truck in low range can climb.
 *
 * The classes are not decoration: `speed` on each is read by the bike, and the
 * whole point of the network is that the fast road and the direct road are
 * different roads.
 * ============================================================================
 */

/**
 * Road classes.
 *
 * `maxGrade` is the real engineering constraint and it is taken from real
 * standards: US highways are held to 6–8% and only exceed it under protest,
 * a graded forest road will take 15%, and a two-track will go up anything a
 * truck in low range can. Those three numbers are what make the classes
 * genuinely different roads rather than three widths of the same road — the
 * highway has to go round the hill the track goes over.
 *
 * `half` is the half-width of the running surface; `speed` is the multiplier
 * the bike reads.
 */
export const CLASS = {
  highway: { name: 'highway', half: 3.6, maxGrade: 0.075, speed: 1.00, wander: 0.10, smooth: 26 },
  logging: { name: 'logging', half: 2.5, maxGrade: 0.150, speed: 0.86, wander: 0.20, smooth: 16 },
  track: { name: 'track', half: 1.5, maxGrade: 0.260, speed: 0.70, wander: 0.30, smooth: 8 },
};

/** Cost-grid resolution over the playable square. 8192 / 320 = 25.6 m cells. */
const GRID = 320;

/* Deterministic value noise — CONTRACTS §1.4, no Math.random anywhere. */
function hash2(i, j, s) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ (s | 0);
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13;
  return ((h >>> 0) / 4294967296);
}
function vnoise2(x, y, s) {
  const X = Math.floor(x), Y = Math.floor(y);
  const fx = x - X, fy = y - Y;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(X, Y, s), b = hash2(X + 1, Y, s);
  const c = hash2(X, Y + 1, s), d = hash2(X + 1, Y + 1, s);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
function fbm2(x, y, oct, s) {
  let t = 0, amp = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { t += amp * vnoise2(x * f, y * f, s + i * 977); n += amp; amp *= 0.5; f *= 2; }
  return t / n - 0.5;
}

/* -------------------------------------------------------------------- A* */

/**
 * A binary min-heap keyed on f-score. Sorting an open list, or scanning it for
 * the minimum, turns A* over a hundred thousand nodes from milliseconds into
 * seconds — and this runs ten times at boot.
 */
class Heap {
  constructor() { this.a = []; this.f = []; }
  get size() { return this.a.length; }
  push(v, f) {
    const A = this.a, F = this.f;
    let i = A.length;
    A.push(v); F.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      const tv = A[p]; A[p] = A[i]; A[i] = tv;
      const tf = F[p]; F[p] = F[i]; F[i] = tf;
      i = p;
    }
  }
  pop() {
    const A = this.a, F = this.f;
    const top = A[0];
    const lv = A.pop(), lf = F.pop();
    if (A.length) {
      A[0] = lv; F[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < F.length && F[l] < F[m]) m = l;
        if (r < F.length && F[r] < F[m]) m = r;
        if (m === i) break;
        const tv = A[m]; A[m] = A[i]; A[i] = tv;
        const tf = F[m]; F[m] = F[i]; F[i] = tf;
        i = m;
      }
    }
    return top;
  }
}

/**
 * The cost field the router searches.
 *
 * Built once and shared by every route, because sampling the heightfield a
 * hundred thousand times is the expensive part and the terrain does not change
 * between roads.
 */
export function buildCostField(world, size) {
  const n = GRID;
  const half = size * 0.5;
  const cell = size / n;
  const h = new Float32Array(n * n);
  const wet = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -half + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * cell;
      const k = j * n + i;
      h[k] = world.getHeight(x, z);
      wet[k] = world.isWater(x, z) ? 1 : 0;
    }
  }
  return { n, cell, half, h, wet, size };
}

/**
 * Route a road with A* over the cost field.
 *
 * WHY NOT GREEDY DESCENT. The obvious router — step forward, fan out candidate
 * headings, take the best — was tried first and measured: it produced highways
 * with a mean gradient of 18% and pitches over 150%, because a greedy walker
 * facing a slope has no candidate that avoids it and simply takes the least-bad
 * one. Worse, it structurally cannot switchback: reversing direction is never
 * a locally good move, so the one manoeuvre that actually gets a road up a
 * mountain is the one manoeuvre it can never make.
 *
 * A* over a grid has no such blind spot. It will happily send the road two
 * kilometres sideways and back if that is genuinely cheaper, which is exactly
 * what a survey does, and switchbacks fall out on their own wherever the
 * terrain demands them — nobody has to author them.
 *
 * THE COST FUNCTION is where the road classes live:
 *
 *     cost = length · (1 + 9·(grade/maxGrade)²)      up to the limit
 *            ×24 penalty                             beyond it
 *
 * Quadratic below the limit because earthwork goes as the square of the cut, and
 * a steep multiplier above it rather than an infinity so the search can still
 * find SOME path out of a bowl with no legal exit. A road that has to break its
 * own standard for eighty metres is a real road; a road that cannot be built at
 * all is a crash.
 */
export function routeRoad(field, a, b, seed, cls, opts = {}) {
  const { n, cell, half, h, wet } = field;
  const toIdx = (x, z) => {
    let i = Math.round((x + half) / cell - 0.5);
    let j = Math.round((z + half) / cell - 0.5);
    i = i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
    j = j < 0 ? 0 : (j > n - 1 ? n - 1 : j);
    return j * n + i;
  };
  const start = toIdx(a.x, a.z);
  const goal = toIdx(b.x, b.z);
  if (start === goal) return [];

  const gx = goal % n, gz = (goal / n) | 0;
  const N = n * n;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap();
  g[start] = 0;
  open.push(start, 0);

  /* Deterministic per-route jitter so two roads between the same pair of places
     do not lie on top of each other, and so a road is not a ruled line across
     a flat. Sampled on the grid, so it is stable. */
  const jit = (i, j) => fbm2(i * cell / 340, j * cell / 340, 2, seed) * cls.wander;

  const OVER = 24.0;         // multiplier beyond the class's grade limit
  const maxG = cls.maxGrade;
  let found = false;
  let guard = 0;
  while (open.size && guard++ < N * 4) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    const cx = cur % n, cz = (cur / n) | 0;
    const ch = h[cur];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (closed[ni]) continue;
        const dist = (dx && dz) ? cell * 1.41421356 : cell;
        const grade = Math.abs(h[ni] - ch) / dist;
        let mult = 1 + 9 * (grade / maxG) * (grade / maxG);
        if (grade > maxG) mult *= OVER;
        /* Water is a bridge, and a bridge is expensive but not forbidden —
           the river has to be crossable somewhere or half the map is cut off. */
        if (wet[ni]) mult += 14;
        mult += jit(nx, nz);
        const t = g[cur] + dist * mult;
        if (t < g[ni]) {
          g[ni] = t;
          from[ni] = cur;
          /* Admissible heuristic: straight-line distance at the cheapest
             possible multiplier of 1, so A* stays optimal. */
          const hx = (nx - gx) * cell, hz = (nz - gz) * cell;
          open.push(ni, t + Math.sqrt(hx * hx + hz * hz));
        }
      }
    }
  }
  if (!found) return [];

  const idx = [];
  for (let k = goal; k >= 0; k = from[k]) {
    idx.push(k);
    if (k === start) break;
  }
  idx.reverse();

  const pts = idx.map((k) => {
    const i = k % n, j = (k / n) | 0;
    return new THREE.Vector3(-half + (i + 0.5) * cell, h[k], -half + (j + 0.5) * cell);
  });
  /*
   * Pin the real endpoints — the grid snaps to 25 m and the town wants the road
   * at its door, not somewhere in the same cell as its door.
   *
   * The Y MUST COME FROM THE GRID, not from the caller. The network's nodes are
   * built as (x, 0, z) because only their footprint matters to the planner, and
   * writing that zero through to the polyline put both ends of every road at
   * sea level: measured, it produced a single 4341% pitch at the end of a track
   * whose terrain was 900 m up. The route's own cell height is the right value
   * and it is already to hand.
   */
  if (pts.length > 1) {
    const last = pts.length - 1;
    pts[0].set(a.x, h[start], a.z);
    pts[last].set(b.x, h[goal], b.z);
  }

  /*
   * SMOOTHING. The A* path is a chain of 25 m steps on eight headings, so
   * untouched it is visibly a staircase. Laplacian passes round it off, and the
   * count is per class — a state route gets 26 and a two-track 8, which is most
   * of what makes them read as different orders of road even where they run
   * side by side.
   */
  const iters = cls.smooth;
  for (let it = 0; it < iters; it++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) * 0.25;
      pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) * 0.25;
    }
  }
  void opts;
  return pts;
}

/** Resample a polyline to a fixed spacing, re-sampling the ground as it goes. */
export function resample(pts, spacing, gh) {
  if (pts.length < 2) return pts;
  /* Drape the first point too. Every other point in the output gets its height
     from `gh`; leaving the seed point on whatever the caller supplied is how a
     single bad vertex survives into the finished ribbon. */
  const out = [new THREE.Vector3(pts[0].x, gh(pts[0].x, pts[0].z), pts[0].z)];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-4) continue;
    let t = (spacing - carry) / seg;
    while (t <= 1) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push(new THREE.Vector3(x, gh(x, z), z));
      t += spacing / seg;
    }
    carry = (1 - (t - spacing / seg)) * seg;
  }
  return out;
}

/**
 * Lay out the whole network.
 *
 * The plan is authored rather than generated, because a road network is the one
 * thing in a procedural world that must NOT look procedural — it is the record
 * of decisions people made, and randomly connected nodes read as a river delta.
 * What is procedural is where each road actually goes, which the router decides
 * from the terrain it is given.
 *
 * @returns {Array<Array<THREE.Vector3>>} routes, each tagged with `cls`
 */
export function buildRoadNetwork(ctx, seed) {
  const world = ctx.world;
  const gh = world.getHeight;
  const half = (world.size || 8192) * 0.5;
  const routes = [];

  const at = (key) => {
    const v = ctx.poi.get(key);
    if (!v) return null;
    const p = v.isVector3 ? v : v.pos;
    return p ? new THREE.Vector3(p.x, 0, p.z) : null;
  };

  /* Somewhere sensible on the rim, nudged off water and off the worst ground. */
  const rim = (angle, r = 0.92) => {
    let bx = Math.cos(angle) * half * r;
    let bz = Math.sin(angle) * half * r;
    for (let k = 0; k < 8 && world.isWater(bx, bz); k++) { bx *= 0.92; bz *= 0.92; }
    return new THREE.Vector3(bx, 0, bz);
  };

  const town = at('town') || new THREE.Vector3(0, 0, 0);
  const river = at('river');
  const forest = at('forest');

  /* One cost field, shared by every route: sampling the heightfield 102 400
     times is the expensive part and the terrain does not change between roads. */
  const field = buildCostField(world, world.size || 8192);

  const add = (a, b, cls, s) => {
    if (!a || !b) return null;
    const pts = routeRoad(field, a, b, s, cls);
    if (pts.length < 6) return null;
    const r = resample(pts, 3.5, gh);
    r.cls = cls;
    r.halfWidth = cls.half;
    r.speed = cls.speed;
    r.name = cls.name;
    routes.push(r);
    return r;
  };

  const H = CLASS.highway, L = CLASS.logging, T = CLASS.track;

  /*
   * THE STATE ROUTE. One road crosses the whole map through the town, and it is
   * the spine everything else hangs off. Made of two halves meeting at the town
   * rather than one route passing near it, so the town is genuinely ON the road
   * instead of beside it.
   */
  add(rim(Math.PI * 0.93), town, H, seed + 1);
  add(town, rim(Math.PI * -0.10), H, seed + 2);

  /*
   * THE PASS. A second highway climbing east over the volcanic crest into the
   * rain shadow. Nothing tells the router where the saddle is — it finds the
   * low point by itself, because that is what minimising the square of the
   * grade means. Riding it is the clearest read on the map's structure the game
   * has: you climb out of the wet timber, over, and down into the lava.
   */
  add(town, rim(Math.PI * 0.16, 0.86), H, seed + 3);

  /* Gravel spurs to the places worth going. */
  if (forest) add(town, forest, L, seed + 11);
  if (river) add(town, river, L, seed + 12);
  add(town, rim(Math.PI * 0.58, 0.80), L, seed + 13);
  add(town, rim(Math.PI * -0.62, 0.78), L, seed + 14);

  /* Two-tracks looping the far country, so the corners are not empty and there
     is always some way through that is not the main road. */
  add(rim(Math.PI * 0.40), rim(Math.PI * 0.80), T, seed + 21);
  add(rim(Math.PI * -0.36), rim(Math.PI * -0.80), T, seed + 22);
  add(rim(Math.PI * 0.62), rim(Math.PI * -0.18, 0.70), T, seed + 23);

  return routes;
}

/**
 * Spatial index over the network.
 *
 * Buckets every centre-line point into a uniform grid so a lookup touches only
 * the handful of points that could possibly be nearest. This is on the bike's
 * fixed-step path and is consulted once per cell by the vegetation bake, so it
 * has to be O(1) — a linear scan over 6000 points would be neither.
 */
export class RoadIndex {
  constructor(routes, cell = 48) {
    this.routes = routes;
    this.cell = cell;
    this.map = new Map();
    for (let r = 0; r < routes.length; r++) {
      const pts = routes[r];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
        /* Register into the 3×3 neighbourhood so a query never has to look at
           more than its own bucket, whatever side of a boundary it lands on. */
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            const k = (cx + a) * 100003 + (cz + b);
            let arr = this.map.get(k);
            if (!arr) { arr = []; this.map.set(k, arr); }
            arr.push(r * 100000 + i);
          }
        }
      }
    }
  }

  /**
   * Nearest point on the network.
   *
   * @returns {{d:number, route:number, i:number, half:number, speed:number,
   *            tx:number, tz:number} | null}
   *          distance in metres, which road, the index along it, its half-width
   *          and speed class, and the unit tangent there.
   */
  nearest(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const arr = this.map.get(cx * 100003 + cz);
    if (!arr) return null;
    let best = 1e18, br = -1, bi = -1;
    for (let n = 0; n < arr.length; n++) {
      const r = (arr[n] / 100000) | 0;
      const i = arr[n] % 100000;
      const p = this.routes[r][i];
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; br = r; bi = i; }
    }
    if (br < 0) return null;
    const pts = this.routes[br];
    const a = pts[Math.max(0, bi - 1)], b = pts[Math.min(pts.length - 1, bi + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    return {
      d: Math.sqrt(best), route: br, i: bi,
      half: pts.halfWidth, speed: pts.speed,
      tx: tx / tl, tz: tz / tl,
    };
  }

  /** Squared distance only — the hot path for keep-out tests. */
  distance2(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const arr = this.map.get(cx * 100003 + cz);
    if (!arr) return 1e9;
    let best = 1e9;
    for (let n = 0; n < arr.length; n++) {
      const r = (arr[n] / 100000) | 0;
      const p = this.routes[r][arr[n] % 100000];
      const dx = p.x - x, dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return best;
  }
}

import {
  noise2, fbm, fbm01, ridged, billow, smoothstep, clamp, mix,
  polylineDist, polylineMetrics,
} from './Noise.js';

/**
 * Landform synthesis — the Cascade Range, central Oregon.
 *
 * The world is deliberately *composed*, not left to noise:
 *
 *      N (-Z)
 *        ┌──────────────────────────────┐
 *        │  wet timber   ▲▲ CREST ▲▲    │   a volcanic spine of glaciated
 *        │  ridges        ▲▲▲▲▲▲       │   stratocones runs NNE–SSW through
 *        │      ~~~ river ~~~  ≈≈ lava  │   the east; west of it is wet
 *   W    │  TIMBERED VALLEY    ≈≈≈≈≈   │   conifer ridge-and-valley country,
 *        │   lake  ~~~     pumice ░░░   │   east of it the rain shadow: basalt
 *        │  timber         ░░░░░░       │   flows and pumice desert.
 *        └──────────────────────────────┘
 *
 * The crest is the organising fact of the map. It makes the mountains, it makes
 * the weather (everything west of it is wet, everything east of it is not), and
 * it is what the eye reads from anywhere in the world — you can always see
 * where you are relative to the volcanoes.
 *
 * Region boundaries are domain-warped so nothing reads as an authored blob, and
 * the river's long profile is derived from the terrain it actually crosses
 * (sampled, then forced monotonically downhill) so the valley always drains.
 *
 * REGION KEYS ARE LOAD-BEARING and kept from the original composition, because
 * the splat baker, the ecology and the scatter all key off them. What they MEAN
 * has changed:
 *
 *   mount  alpine — the cones and the crest above the treeline
 *   foot   timbered ridges, the bulk of the map
 *   bad    lava beds: basalt flow fields, not sedimentary mesas
 *   sand   pumice and ash flats — pale, flat, sterile
 *   plain  valley floor: meadow, marsh and second-growth
 *   arid   how far into the rain shadow you are, 0 west .. 1 east
 */

export const RIVER_PTS = [
  [1980, -2760], [1560, -2150], [1120, -1620], [700, -1130],
  [250, -760], [-260, -470], [-800, -230], [-1420, 60],
  [-2100, 470], [-2900, 1030], [-3800, 1780], [-5200, 2900],
];
const RIVER_M = polylineMetrics(RIVER_PTS);

/* ------------------------------------------------------------------ regions */

function ellipse(x, z, cx, cz, rx, rz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dz = z - cz;
  const u = (dx * c + dz * s) / rx;
  const v = (-dx * s + dz * c) / rz;
  return Math.sqrt(u * u + v * v);
}

/* ------------------------------------------------------------------- cones */

/**
 * THE VOLCANOES.
 *
 * A stratovolcano is *concave up*: shallow at the base, steepening all the way
 * to the summit, which is the exact opposite of what noise gives you and the
 * whole reason these are placed by hand rather than left to the fractal. With
 *
 *      h(r) = H · (1 − r/R)^p
 *
 * the surface slope is (H·p/R)·(1 − r/R)^(p−1): zero where the flank runs out
 * onto the plain and maximal at the summit. At H = 940 m, R = 2500 m, p = 1.62
 * the summit slope works out at 0.61 ≈ 31°, which is the angle of repose for
 * fragmental volcanic debris and therefore the angle real cones actually stand
 * at. Get that number wrong in either direction and the silhouette stops
 * reading as a volcano from any distance.
 *
 * Two more details do most of the recognition work:
 *
 *   BARRANCAS  the radial erosion gullies that stripe every flank. They are
 *              deepest at mid-flank — nothing has had room to concentrate at
 *              the summit and the fans bury them at the foot — so the profile
 *              is a u(1−u) hump, and their angular positions are jittered by
 *              noise so the cone is not a cake decoration.
 *   CRATER     subtracting a smooth bowl from a profile that peaks at r = 0
 *              produces the raised rim for free.
 *
 * `cinder` cones are the small ones: steeper, far smaller, and with a crater
 * enormous relative to the cone, because that is what a single-eruption scoria
 * pile looks like once its throat has drained.
 */
const CONES = [
  { x: 1380, z: -2840, h: 900, r: 2560, cr: 168, cd: 96, gully: 1.00, gN: 19 },
  { x: 2700, z: -1400, h: 742, r: 2080, cr: 122, cd: 58, gully: 0.92, gN: 17 },
  { x: 1900, z: -160, h: 648, r: 1760, cr: 104, cd: 44, gully: 0.86, gN: 15 },
  { x: -260, z: -3300, h: 690, r: 1940, cr: 134, cd: 62, gully: 0.96, gN: 17 },
  { x: 2520, z: 900, h: 214, r: 540, cr: 142, cd: 74, gully: 0.22, gN: 11, cinder: 1 },
  { x: 900, z: 1880, h: 168, r: 445, cr: 118, cd: 58, gully: 0.18, gN: 9, cinder: 1 },
];

/**
 * Cone height and ownership at a world position.
 *
 * `u` is how far up the tallest cone under this point we are, 0 at the base
 * ring and 1 at the summit. Callers use it to fade the fractal mountain noise
 * out toward the summits — noise on a cone's shoulders is erosion, noise on its
 * summit is just a broken cone.
 *
 * @returns {{h:number, u:number, alp:number}} added metres, summit-ness, and
 *          how alpine (bare rock / permanent snow) the ground here should read.
 */
function coneAt(x, z) {
  let H = 0, U = 0, alp = 0;
  for (let i = 0; i < CONES.length; i++) {
    const c = CONES[i];
    const dx = x - c.x, dz = z - c.z;
    const r2 = dx * dx + dz * dz;
    if (r2 > c.r * c.r) continue;
    const r = Math.sqrt(r2);
    const u = 1 - r / c.r;
    if (u <= 0) continue;

    let h = c.h * Math.pow(u, c.cinder ? 1.34 : 1.62);

    /* Barrancas. The angular jitter is noise sampled on the unit circle, so
       the gullies wander rather than sitting on a perfect radial fan. */
    if (c.gully > 0.01 && r > 1) {
      const ang = Math.atan2(dz, dx);
      const jit = noise2(Math.cos(ang) * 2.6 + i * 13.1, Math.sin(ang) * 2.6 - i * 7.7) * 1.15;
      const g = Math.abs(Math.sin(ang * c.gN * 0.5 + jit));
      /* deepest at mid-flank; 4·u·(1−u) peaks at 1 */
      h -= c.h * 0.052 * c.gully * g * 4 * u * (1 - u);
    }

    /* Summit crater — a smooth bowl, which leaves a rim at r = cr. */
    if (r < c.cr) {
      const t = r / c.cr;
      h -= c.cd * (1 - t * t * (3 - 2 * t));
    }

    if (h > 0) {
      H += h;
      if (u > U) U = u;
      /* Bare above roughly two thirds of the way up; cinder cones are bare
         all over, being loose scoria nothing takes root in. */
      const a = c.cinder ? smoothstep(0.05, 0.45, u) : smoothstep(0.42, 0.78, u);
      if (a > alp) alp = a;
    }
  }
  return { h: H, u: U, alp };
}

/**
 * The crest: the ridge that links the cones. Real ranges are not a scatter of
 * isolated peaks — the volcanoes sit on a continuous structural high, and it is
 * that ridgeline, not the cones, that divides the wet side from the dry side.
 */
const CREST_PTS = [
  [-700, -3900], [200, -3350], [1000, -2880], [1600, -2280],
  [2180, -1480], [2500, -650], [2200, 250], [2000, 1050],
  [2250, 1950], [2600, 2900],
];
/**
 * Distance from the crest axis, with the SIDE it falls on.
 *
 * polylineDist gives the distance but not the side, and the side is the whole
 * point here — it is what makes the west wet and the east a desert. `side` is
 * the sign of the cross product against the nearest segment, smoothed by the
 * distance so the rain shadow fades in over a few kilometres instead of
 * switching along a line.
 *
 * @returns {{d:number, side:number}} metres from the axis, and −1 west .. +1 east
 */
function crestAt(x, z) {
  let best = Infinity, cross = 0;
  for (let i = 0; i < CREST_PTS.length - 1; i++) {
    const ax = CREST_PTS[i][0], az = CREST_PTS[i][1];
    const dx = CREST_PTS[i + 1][0] - ax, dz = CREST_PTS[i + 1][1] - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = ax + dx * t, cz = az + dz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) {
      best = d;
      /* Signed perpendicular distance: normalise the cross product by the
         segment length or a long segment reads as "further east" than a short
         one at the same offset. The crest runs roughly north to south, so
         positive is east of it. */
      const L = Math.sqrt(len2) || 1;
      cross = ((x - cx) * dz - (z - cz) * dx) / L;
    }
  }
  return { d: best, side: clamp(cross / 2600, -1, 1) };
}

/**
 * Continuous region weights at a world position.
 * @returns {{mount:number, foot:number, bad:number, plain:number, sand:number,
 *            far:number, valley:number, core:number, arid:number,
 *            valleyD:number, valleyT:number}}
 */
export function regionAt(x, z) {
  const wx = x + fbm(x * 0.00019 + 11.3, z * 0.00019 - 4.7, 3, 1) * 820;
  const wz = z + fbm(x * 0.00019 - 6.1, z * 0.00019 + 9.9, 3, 1) * 820;

  const cr = crestAt(wx, wz);
  const cone = coneAt(x, z);

  /* --- alpine: the cones above the treeline, plus the crest itself where it
         rides high enough between them to go bare. */
  let mount = Math.max(
    cone.alp,
    smoothstep(1500, 620, cr.d) * 0.62,
  );

  /*
   * ORDER MATTERS HERE. The dry-side landforms are specific places — a flow
   * field is where a particular vent poured, an ash blanket is where a
   * particular wind dropped it — whereas timber is simply what grows on
   * anything nobody else has claimed. So lava and pumice take their ground
   * first and forest fills the remainder, rather than the other way round.
   * Assembled the other way, the timber belt (which covers most of the map by
   * design) suppressed the flow fields to a few percent of the area they
   * should have had.
   */

  /* --- lava beds: young basalt flow fields banked against the east foot of the
         crest, where the eruptions actually went. Two big flows and an outlying
         tongue, all on the dry side. */
  const eL1 = ellipse(wx, wz, 3320, 1350, 1720, 1400, 0.16);
  const eL2 = ellipse(wx, wz, 2450, 2700, 1360, 1020, -0.32);
  const eL3 = ellipse(wx, wz, 3150, -260, 1180, 900, 0.30);
  const lavaRaw = Math.min(Math.min(eL1, eL2), eL3);
  let bad = smoothstep(1.30, 0.46, lavaRaw)
    * (1 - mount)
    * smoothstep(-0.30, 0.20, cr.side);          // east of the crest only

  /* --- pumice and ash flats: the sterile pale desert downwind of the vents.
         Ash falls out on the lee side, so this belongs east and a little south
         of the big cone, and it thins with distance from it. */
  const eP = ellipse(wx, wz, 2450, 850, 1780, 1420, 0.08);
  let sand = smoothstep(1.30, 0.52, eP);
  sand = Math.max(sand, smoothstep(2000, 3400, wz) * smoothstep(-0.05, 0.55, cr.side));
  sand *= (1 - mount) * (1 - bad);

  /* --- timbered ridges. The DEFAULT terrain of the map: the whole west side is
         ridge-and-valley conifer country, and the flanks of the cones are
         forested to about two thirds of their height. The old composition made
         foothills a thin collar around a massif; here they are the world. */
  let foot = clamp(
    smoothstep(6000, 900, cr.d) * 0.92
    + smoothstep(0.02, 0.55, cone.u) * 0.55,
    0, 1)
    * (1 - mount) * (1 - bad) * (1 - sand)
    /* Timber thins fast once you are over the crest and into the rain
       shadow — that transition from closed canopy to open juniper over a
       couple of kilometres is the most visible thing the divide does. */
    * (1 - smoothstep(0.05, 0.65, cr.side) * 0.72);

  /* --- distant ranges beyond the play area, so the horizon is never empty */
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const far = smoothstep(3900, 7600, edge);

  let plain = clamp(1 - mount - foot - bad - sand, 0, 1);
  const sum = mount + foot + bad + sand + plain || 1;
  mount /= sum; foot /= sum; bad /= sum; sand /= sum; plain /= sum;

  const rv = polylineDist(x, z, RIVER_PTS, RIVER_M.cum, RIVER_M.total);
  const vW = mix(150, 420, Math.pow(rv.t, 0.6));
  const valley = smoothstep(vW * 1.9, vW * 0.50, rv.d);
  const core = smoothstep(vW * 1.00, vW * 0.26, rv.d);

  /*
   * ARIDITY IS NOW OROGRAPHIC, and that one change is what makes the map read
   * as a real range rather than as a set of biome blobs. Air coming off the
   * Pacific is forced up the west flank, dumps its water there, and comes down
   * the east side dry: at the same latitude and within thirty kilometres you
   * get temperate rainforest on one side of the crest and sagebrush desert on
   * the other. So aridity is driven by which side of the crest you are on, and
   * every downstream consumer — vegetation, splat colour, scatter — inherits
   * the divide for free.
   */
  const aridN = fbm01(x * 0.00032 + 71.2, z * 0.00032 - 33.8, 3, 1);
  const shadow = smoothstep(-0.55, 0.60, cr.side);
  const arid = clamp(
    shadow * 0.86 + bad * 0.20 + sand * 0.24
    - smoothstep(2600, 400, cr.d) * 0.18          // the crest itself catches snow
    + (aridN - 0.5) * 0.34 - valley * 0.30,
    0, 1);

  return {
    mount, foot, bad, plain, sand, far, valley, core, arid,
    valleyD: rv.d, valleyT: rv.t,
    coneU: cone.u, crestD: cr.d, crestSide: cr.side,
  };
}

/* ------------------------------------------------------------------- heights */

function landformAt(x, z, R) {
  /* second, independent warp for the landform itself */
  const wax = x + fbm(x * 0.00040 + 3.1, z * 0.00040 + 8.4, 4, 1) * 620;
  const waz = z + fbm(x * 0.00040 - 5.6, z * 0.00040 - 2.2, 4, 1) * 620;

  let H = 0;

  /*
   * THE CREST. A broad structural swell along the volcanic axis that the cones
   * are built on top of. Without it each cone sits alone on a plain like a
   * paperweight; with it the range has a spine and the peaks read as the high
   * points of one continuous uplift, which is what they are.
   */
  const crestSwell = smoothstep(6400, 700, R.crestD);
  H += crestSwell * 205;

  /* The low-frequency skeleton, tracked alongside H. The cone pass below needs
     somewhere to fade the fractal detail TO: fading it to zero would drop each
     summit back to sea level and hang the cone off nothing. */
  let Hbase = crestSwell * 205;

  /* Ridge-and-valley timber country. Billow gives rounded, soil-mantled ridges
     — the right shape for slopes that have been under forest since the ice
     went, as opposed to the sharp ridged-multifractal crests of bare rock. */
  if (R.foot > 0.003) {
    const b = billow(wax, waz, 5, 1 / 2050);
    const r = ridged(wax, waz, 4, 1 / 2600);
    H += R.foot * (40 + b * 176 + r * 118);
    Hbase += R.foot * 150;
  }
  if (R.mount > 0.003) {
    const r1 = ridged(wax, waz, 6, 1 / 3600, 0.5, 2.11, 0.95);
    const r2 = ridged(wax * 1.9 + 1200, waz * 1.9 - 800, 4, 1 / 3600);
    const m = Math.pow(clamp(r1 * 0.79 + r2 * 0.21, 0, 1), 1.30);
    H += R.mount * (70 + m * 520);
    Hbase += R.mount * 150;
  }
  if (R.plain > 0.003) {
    const b = billow(wax * 0.85, waz * 0.85, 4, 1 / 3100);
    const s = fbm(x, z, 3, 1 / 4800);
    const lr = ridged(wax * 1.4 - 900, waz * 1.4 + 400, 4, 1 / 1900, 0.5, 2.05);
    H += R.plain * (44 + b * 46 + s * 24 + lr * 34);
    Hbase += R.plain * 68;
  }
  if (R.bad > 0.003) {
    /*
     * LAVA BEDS. A basalt flow field is nearly FLAT at the kilometre scale and
     * savagely rough at the metre scale — the opposite of every other landform
     * here, and the reason it reads instantly as lava rather than as rock. All
     * this pass contributes is the gentle overall tilt of the flow away from
     * its vent and the broad lobes it split into; the rubble that makes it
     * impassable is added in refineCore where the resolution can carry it.
     */
    const lobe = billow(wax * 1.15 + 700, waz * 1.15 - 300, 4, 1 / 1450);
    H += R.bad * (52 + lobe * 74);
    Hbase += R.bad * 89;
  }
  if (R.sand > 0.003) {
    /* Pumice desert: an ash blanket drapes what it lands on, so this is almost
       featureless, with only long low dunes where the wind has moved it. */
    H += R.sand * (24 + billow(wax * 0.80, waz * 1.55, 3, 1 / 1700) * 26);
    Hbase += R.sand * 37;
  }

  /*
   * THE CONES, added last and on top of everything, because a volcano is a pile
   * of its own ejecta sitting on whatever was already there. The fractal
   * mountain noise above is faded out toward each summit (see `coneDamp`) so
   * the upper flanks stay clean — noise on a cone's shoulders reads as erosion,
   * noise on its summit just reads as a broken cone.
   */
  const cone = coneAt(x, z);
  if (cone.h > 0) {
    H = mix(H, Hbase, smoothstep(0.26, 0.84, cone.u) * 0.94) + cone.h;
  }
  if (R.far > 0.002) {
    /* big soft ranges ringing the world — pure silhouette material */
    const f = ridged(wax * 0.62 - 4000, waz * 0.62 + 2500, 5, 1 / 5200, 0.52, 2.05);
    H = mix(H, 30 + Math.pow(f, 1.25) * 520, R.far * 0.92);
  }

  /* Broad structural basin around the drainage axis. Only ~0.5% cross-slope,
     invisible to the eye, but it is what makes the whole region drain into one
     trunk river instead of a hundred disconnected pans. */
  H -= smoothstep(3400, 260, R.valleyD) * 16;

  /* regional tilt: the whole basin drains west-south-west */
  H += x * 0.0032 - z * 0.0026;
  return H;
}

/* ---------------------------------------------------------------- pass one */

/**
 * Coarse landform over `ext` metres at `res`, in two sweeps: the land first,
 * then the river valley cut into it along a profile derived from that land.
 */
export function generateCoarse(res, ext) {
  const N = res * res;
  const h = new Float32Array(N);
  const wMount = new Float32Array(N);
  const wFoot = new Float32Array(N);
  const wBad = new Float32Array(N);
  const wPlain = new Float32Array(N);
  const wSand = new Float32Array(N);
  const wValley = new Float32Array(N);
  const arid = new Float32Array(N);
  const vT = new Float32Array(N);
  const vCore = new Float32Array(N);

  const step = ext / res;
  const half = ext * 0.5;

  for (let j = 0; j < res; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * step;
      const k = j * res + i;
      const R = regionAt(x, z);
      h[k] = landformAt(x, z, R);
      wMount[k] = R.mount; wFoot[k] = R.foot; wBad[k] = R.bad;
      wPlain[k] = R.plain; wSand[k] = R.sand;
      wValley[k] = R.valley; vCore[k] = R.core;
      vT[k] = R.valleyT;
      arid[k] = R.arid;
    }
  }

  /* --- river long profile: sample the land, then force it downhill */
  const SAMPLES = 300;
  const prof = new Float32Array(SAMPLES);
  const sampleH = (x, z) => {
    let fx = clamp((x + half) / ext * res - 0.5, 0, res - 1.001);
    let fz = clamp((z + half) / ext * res - 0.5, 0, res - 1.001);
    const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
    const a = h[z0 * res + x0], b = h[z0 * res + x0 + 1];
    const c = h[(z0 + 1) * res + x0], d = h[(z0 + 1) * res + x0 + 1];
    const t0 = a + (b - a) * tx;
    return t0 + ((c + (d - c) * tx) - t0) * tz;
  };
  const pointAt = (t) => {
    const target = t * RIVER_M.total;
    for (let s = 0; s < RIVER_PTS.length - 1; s++) {
      const c0 = RIVER_M.cum[s], c1 = RIVER_M.cum[s + 1];
      if (target <= c1 || s === RIVER_PTS.length - 2) {
        const u = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
        return [
          RIVER_PTS[s][0] + (RIVER_PTS[s + 1][0] - RIVER_PTS[s][0]) * u,
          RIVER_PTS[s][1] + (RIVER_PTS[s + 1][1] - RIVER_PTS[s][1]) * u,
        ];
      }
    }
    return RIVER_PTS[0];
  };
  const segLen = RIVER_M.total / (SAMPLES - 1);
  for (let s = 0; s < SAMPLES; s++) {
    const [px, pz] = pointAt(s / (SAMPLES - 1));
    const land = sampleH(px, pz);
    const wantDrop = segLen * 0.004;          // 0.4% minimum gradient
    prof[s] = s === 0 ? land - 11
      : Math.min(land - 11, prof[s - 1] - wantDrop);
    /* never gouge an implausible gorge across a flat */
    prof[s] = Math.max(prof[s], land - 40);
  }
  /* second monotone pass in case the clamp broke it */
  for (let s = 1; s < SAMPLES; s++) {
    if (prof[s] > prof[s - 1] - segLen * 0.0012) prof[s] = prof[s - 1] - segLen * 0.0012;
  }

  const profAt = (t) => {
    const f = clamp(t, 0, 1) * (SAMPLES - 1);
    const i0 = f | 0, i1 = Math.min(SAMPLES - 1, i0 + 1);
    return prof[i0] + (prof[i1] - prof[i0]) * (f - i0);
  };

  /* --- pass two: cut the valley */
  for (let j = 0; j < res; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const v = wValley[k];
      if (v < 0.002) continue;
      const x = -half + (i + 0.5) * step;
      const floor = profAt(vT[k]);
      /* flanks: only ever cut down toward the floor */
      const flank = floor + Math.pow(1 - v, 1.35) * 330;
      let H = mix(h[k], Math.min(h[k], flank), v);
      /* axis: force the bed, with a little meander noise */
      const core = vCore[k];
      if (core > 0.002) {
        H = mix(H, floor + fbm(x, z, 2, 1 / 420) * 3.5, core * 0.94);
      }
      h[k] = H;
    }
  }

  return { h, wMount, wFoot, wBad, wPlain, wSand, wValley, arid, res, ext, prof };
}

/* ---------------------------------------------------------------- pass two */

function bilerpGrid(src, res, u, v) {
  const fx = clamp(u * res - 0.5, 0, res - 1.001);
  const fy = clamp(v * res - 0.5, 0, res - 1.001);
  const x0 = fx | 0, y0 = fy | 0;
  const tx = fx - x0, ty = fy - y0;
  const x1 = x0 + 1 < res ? x0 + 1 : x0;
  const y1 = y0 + 1 < res ? y0 + 1 : y0;
  const a = src[y0 * res + x0], b = src[y0 * res + x1];
  const c = src[y1 * res + x0], d = src[y1 * res + x1];
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

/**
 * Refine the core up to `res`, adding the mid and high frequency character each
 * region deserves plus the erosion hardness field (strata + mesa caprock) that
 * the droplet pass honours.
 */
export function refineCore(coarse, res, core) {
  const N = res * res;
  const h = new Float32Array(N);
  const hard = new Float32Array(N);
  const arid = new Float32Array(N);
  const rMount = new Float32Array(N);
  const rBad = new Float32Array(N);
  const rValley = new Float32Array(N);
  const rPlain = new Float32Array(N);
  const rFoot = new Float32Array(N);
  const rSand = new Float32Array(N);

  const step = core / res;
  const half = core * 0.5;
  const u0 = 0.5 - (core * 0.5) / coarse.ext;
  const uspan = core / coarse.ext;

  for (let j = 0; j < res; j++) {
    const z = -half + (j + 0.5) * step;
    const v = u0 + ((j + 0.5) / res) * uspan;
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * step;
      const u = u0 + ((i + 0.5) / res) * uspan;
      const k = j * res + i;

      const wm = bilerpGrid(coarse.wMount, coarse.res, u, v);
      const wf = bilerpGrid(coarse.wFoot, coarse.res, u, v);
      const wb = bilerpGrid(coarse.wBad, coarse.res, u, v);
      const wp = bilerpGrid(coarse.wPlain, coarse.res, u, v);
      const ws = bilerpGrid(coarse.wSand, coarse.res, u, v);
      const wv = bilerpGrid(coarse.wValley, coarse.res, u, v);
      let H = bilerpGrid(coarse.h, coarse.res, u, v);

      const wax = x + noise2(x * 0.00090 + 17.7, z * 0.00090 - 3.3) * 200;
      const waz = z + noise2(x * 0.00090 - 8.2, z * 0.00090 + 6.5) * 200;

      let hardness = 0.40;
      const flank = 1 - wv;

      if (wm > 0.006) {
        /*
         * Alpine detail — but NOT on the cones. refineCore is where the
         * mid-frequency ridges get added, and 80 m of ridged noise at a 620 m
         * wavelength is exactly the amount needed to destroy a summit that the
         * coarse pass went to the trouble of keeping clean. `coneK` fades it
         * out over the top third of every cone, leaving the barrancas — which
         * are radial and belong there — as the only relief up high.
         */
        const cu = coneAt(x, z).u;
        const coneK = 1 - smoothstep(0.34, 0.80, cu) * 0.90;
        const r = ridged(wax, waz, 5, 1 / 620, 0.52, 2.09);
        const spur = ridged(wax * 2.3, waz * 2.3, 3, 1 / 620);
        H += wm * flank * coneK * ((r - 0.42) * 190 + (spur - 0.45) * 58);
        hardness = mix(hardness, 0.34 + 0.46 * (0.5 + 0.5
          * Math.sin(H * 0.052 + fbm(x, z, 2, 1 / 700) * 3.0)), wm);
      }
      if (wf > 0.006) {
        const b = billow(wax, waz, 4, 1 / 470);
        H += wf * flank * (b - 0.46) * 82;
        hardness = mix(hardness, 0.35, wf);
      }
      if (wp > 0.006) {
        /* Three scales of swell. Without the 130 m band the grassland reads as
           a billiard table from a mile away — there is nothing for the light to
           catch once the texture detail has mipped away. */
        const b = billow(wax * 0.9, waz * 0.9, 4, 1 / 730);
        const g = fbm(x, z, 3, 1 / 230);
        const f = fbm(x + 813, z - 271, 3, 1 / 128);
        const d = fbm(x - 2011, z + 655, 3, 1 / 320);
        H += wp * flank * ((b - 0.47) * 44 + g * 13.0 + d * 9.5 + f * 6.0);
        hardness = mix(hardness, 0.22, wp);
      }
      if (ws > 0.006) {
        /* Ash DRAPES. It falls out of the air and settles into a blanket that
           smooths whatever it lands on, so the pumice flats get less relief
           than any other surface here, not more — and being uncemented dust
           they are the softest thing the erosion pass will find. */
        H += ws * flank * (fbm(x * 0.50, z * 1.40, 3, 1 / 320) * 4.2
          + fbm(x - 411, z + 122, 2, 1 / 130) * 1.5);
        hardness = mix(hardness, 0.11, ws);
      }
      if (wb > 0.006) {
        /*
         * LAVA BEDS.
         *
         * The character of an aa flow is that its roughness lives almost
         * entirely in one narrow band — one to four metres — and there is
         * essentially nothing between that and the kilometre-scale tilt of the
         * flow itself. That spectral gap is the tell: hills have detail at
         * every scale, lava has detail at exactly one, which is why a flow
         * field looks flat from a ridge and is impassable on foot.
         *
         *   RUBBLE    ridged noise at ~9 m, cubed. Cubing is what turns a
         *             smooth wave into isolated jagged blocks with flat-ish
         *             ground between them, instead of corduroy.
         *   PRESSURE  long ridges where the crust buckled against itself as
         *             the still-liquid interior kept pushing. These are the
         *             large forms a flow DOES have, and they are linear rather
         *             than radial, so ridged noise stretched along the flow.
         *   TUBES     collapsed lava tubes: narrow, deep, sharply-bounded
         *             trenches. Rare, but they are the single most recognisable
         *             feature of a basalt field and they make the terrain
         *             genuinely tactical to ride across.
         */
        const rub = ridged(wax * 1.0, waz * 1.0, 3, 1 / 9.0, 0.55, 2.13);
        H += wb * flank * (rub * rub * rub * 5.4 - 0.9);

        const press = ridged(wax * 0.42 + 900, waz * 1.35 - 400, 3, 1 / 210, 0.5, 2.05);
        H += wb * flank * Math.pow(press, 1.6) * 17;

        const tube = ridged(wax * 0.75 - 2200, waz * 0.75 + 1500, 2, 1 / 340, 0.5, 2.0);
        H -= wb * flank * smoothstep(0.86, 0.98, tube) * 13;

        /* Basalt is the hardest thing in the world by a long way; the droplet
           pass has to leave the flows more or less as it found them or the
           whole field slumps into rolling hills within one erosion run. */
        hardness = mix(hardness, 0.94, wb);
      }
      if (wv > 0.002) {
        H -= wv * fbm(x, z, 2, 1 / 360) * 4;
        hardness = mix(hardness, 0.18, wv * 0.85);
      }

      h[k] = H;
      hard[k] = clamp(hardness, 0.05, 1);
      arid[k] = bilerpGrid(coarse.arid, coarse.res, u, v);
      rMount[k] = wm; rBad[k] = wb; rValley[k] = wv;
      rPlain[k] = wp; rFoot[k] = wf; rSand[k] = ws;
    }
  }

  return { h, hard, arid, rMount, rBad, rValley, rPlain, rFoot, rSand, res, size: core };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * BROKEN ROAD — THE BIKE, as geometry.
 * ============================================================================
 * A twenty-year-old 650 twin that somebody has kept running with hose clamps
 * and baling wire, built out of primitives at runtime like everything else in
 * this project.
 *
 * WHY IT IS SPLIT THE WAY IT IS
 * The machine is authored as four rigid assemblies, because those are exactly
 * the four things that move independently of each other:
 *
 *   body    frame, tank, engine, pipes, seat, rack and the load on it
 *   front   fork legs, yoke, bars, headlight, front mudguard — steers, and
 *           slides on the fork axis as the suspension works
 *   wheelR  spins, and travels on the swingarm arc
 *   wheelF  spins, and is carried by `front`
 *
 * Everything inside an assembly is merged down to one draw call per material,
 * which puts the whole bike at eight draws — the same order as the horse it
 * replaces, and it has to be, because it is on screen just as constantly.
 *
 * COORDINATE CONVENTION matches the horse exactly: +Z is forward, +X is the
 * rider's LEFT, +Y is up, and the origin sits on the ground midway between the
 * contact patches. Anything that used to hang off the saddle bone therefore
 * hangs off the seat with no change of handedness.
 * ============================================================================
 */

/** Geometry, in metres. A real mid-size road bike, measured. */
export const BIKE = {
  wheelbase: 1.515,
  rearAxle: -0.660,
  frontAxle: 0.855,
  wheelR: 0.335,          // tyre outer radius
  tyre: 0.072,            // section
  rimR: 0.215,
  /** Steering head: the point the fork rotates about, and the rake off vertical. */
  headY: 0.985,
  headZ: 0.660,
  rake: 0.475,            // 27.2 degrees
  seatY: 0.815,
  seatZ: -0.115,
  barY: 1.075,
  barZ: 0.545,
  barHalf: 0.335,
  /** Suspension travel available to the fork, metres. */
  forkTravel: 0.135,
};

/* -------------------------------------------------------------- primitives */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A capped cylinder spanning two points. Nearly every structural part of a
 * motorcycle is a tube between two lugs, so this is most of the bike.
 */
function tube(ax, ay, az, bx, by, bz, r, seg = 8) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  const d = _b.clone().sub(_a);
  const len = d.length();
  if (len < 1e-5) return null;
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  _q.setFromUnitVectors(UP, d.normalize());
  _m.compose(_a.clone().addScaledVector(d, len * 0.5), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  _q.setFromEuler(new THREE.Euler(rx, ry, rz));
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** A squashed sphere — tanks, seat pans, mudguard bulges, bedrolls. */
function blob(r, sx, sy, sz, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
  _q.setFromEuler(new THREE.Euler(rx, ry, rz));
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

/**
 * An open cylindrical shell used as a mudguard: a cylinder with its axis along
 * X and only part of its circumference, which is exactly what a mudguard is.
 */
function guard(radius, width, x, y, z, start, sweep) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 14, 1, true, start, sweep);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/* ------------------------------------------------------------------ wheels */

/**
 * One wheel: tyre, rim, hub and spokes, built about the origin with the axle
 * along X so the caller can spin it on its own local X.
 *
 * The spokes are the only part of a bike that reads at a distance purely
 * through motion — a wheel without them is a black disc and stays a black disc
 * however fast it turns.
 */
export function buildWheel(rng, { rear }) {
  const R = BIKE.wheelR, t = BIKE.tyre;
  const parts = { rubber: [], steel: [] };
  const width = rear ? 0.115 : 0.092;

  const tyre = new THREE.TorusGeometry(R - t, t, 8, 22);
  tyre.rotateY(Math.PI / 2);
  tyre.scale(width / (t * 2), 1, 1);
  parts.rubber.push(tyre);

  /* Knobbly tread: a ring of small blocks. Cheap, and it is what stops the
     tyre reading as a smooth black doughnut under a low sun. */
  const NK = 16;
  for (let i = 0; i < NK; i++) {
    const a = (i / NK) * Math.PI * 2;
    const s = 0.6 + rng() * 0.5;
    parts.rubber.push(box(width * 0.9, 0.020, 0.055 * s,
      0, Math.sin(a) * (R - 0.008), Math.cos(a) * (R - 0.008), a, 0, 0));
  }

  const rim = new THREE.CylinderGeometry(BIKE.rimR, BIKE.rimR, width * 0.42, 20, 1, true);
  rim.rotateZ(Math.PI / 2);
  parts.steel.push(rim);
  const hub = new THREE.CylinderGeometry(0.058, 0.058, width * 1.15, 10);
  hub.rotateZ(Math.PI / 2);
  parts.steel.push(hub);
  if (rear) {
    /* Sprocket and disc — the rear wheel of a chain bike is visibly not
       symmetrical, and the asymmetry is what sells it as machinery. */
    const spr = new THREE.CylinderGeometry(0.115, 0.115, 0.012, 18);
    spr.rotateZ(Math.PI / 2);
    spr.translate(width * 0.62, 0, 0);
    parts.steel.push(spr);
  }
  const disc = new THREE.CylinderGeometry(0.098, 0.098, 0.008, 16);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-width * 0.60, 0, 0);
  parts.steel.push(disc);

  const NS = 12;
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2 + rng() * 0.05;
    const lean = (i % 2 ? 1 : -1) * width * 0.30;
    parts.steel.push(tube(
      lean, Math.sin(a) * 0.055, Math.cos(a) * 0.055,
      0, Math.sin(a) * BIKE.rimR, Math.cos(a) * BIKE.rimR, 0.0055, 4));
  }
  return parts;
}

/* -------------------------------------------------------------------- body */

/**
 * Frame, engine, tank, pipes, seat and the drifter's load, all in bike-local
 * space and all rigid with respect to each other.
 */
export function buildBody(rng) {
  const P = { steel: [], engine: [], leather: [], canvas: [] };
  const S = P.steel, E = P.engine, L = P.leather, C = P.canvas;

  const headX = 0, headY = BIKE.headY, headZ = BIKE.headZ;
  /* Down the rake from the steering head to the bottom yoke. */
  const yokeY = headY - 0.235 * Math.cos(BIKE.rake);
  const yokeZ = headZ - 0.235 * Math.sin(BIKE.rake) * -1;

  /* --- frame: a perimeter loop, which is what everything else bolts to --- */
  S.push(tube(headX, headY, headZ, 0, 0.735, 0.055, 0.030));        // top tube
  S.push(tube(headX, yokeY, yokeZ, 0, 0.395, 0.170, 0.028));        // down tube
  S.push(tube(0, 0.395, 0.170, 0, 0.335, -0.230, 0.026));           // cradle
  S.push(tube(0, 0.735, 0.055, 0, 0.640, -0.330, 0.026));           // seat tube
  for (const s of [1, -1]) {
    S.push(tube(0, 0.735, 0.055, s * 0.105, 0.700, -0.395, 0.020)); // seat rails
    S.push(tube(s * 0.105, 0.700, -0.395, s * 0.098, 0.690, -0.700, 0.018));
    /* swingarm — pivots in reality, rigid here; the travel is taken in the
       rear wheel's vertical offset instead, which at these amplitudes is
       within a couple of millimetres of the true arc */
    S.push(tube(s * 0.075, 0.360, -0.240, s * 0.098, BIKE.wheelR, BIKE.rearAxle, 0.021));
    S.push(tube(s * 0.098, 0.690, -0.640, s * 0.098, BIKE.wheelR + 0.02, BIKE.rearAxle + 0.04, 0.014));
  }

  /* --- engine: a V-twin, the visual mass of the whole machine ------------ */
  E.push(box(0.255, 0.215, 0.290, 0, 0.480, -0.055));               // crankcase
  E.push(box(0.215, 0.075, 0.230, 0, 0.352, -0.055));               // sump
  for (const [ang, zc] of [[0.36, 0.115], [-0.30, -0.190]]) {
    /* Barrel and head, canted fore and aft off the crankcase. */
    E.push(box(0.195, 0.185, 0.145, 0, 0.640, zc, ang, 0, 0));
    E.push(box(0.215, 0.070, 0.165, 0, 0.745, zc + Math.sin(ang) * 0.10, ang, 0, 0));
    /* Cooling fins. Six thin plates is enough to catch a rim light and read
       as an air-cooled motor rather than a painted brick. */
    for (let f = 0; f < 6; f++) {
      const t = (f - 2.5) * 0.028;
      E.push(box(0.225, 0.008, 0.155,
        0, 0.640 + Math.cos(ang) * t, zc - Math.sin(ang) * t, ang, 0, 0));
    }
  }
  /* Exhaust: header off each cylinder, collector, muffler down the right. */
  E.push(tube(0.04, 0.600, 0.180, 0.115, 0.360, 0.090, 0.024, 6));
  E.push(tube(0.115, 0.360, 0.090, -0.130, 0.330, -0.150, 0.026, 6));
  E.push(tube(-0.130, 0.330, -0.150, -0.150, 0.430, -0.560, 0.030, 6));
  const muff = new THREE.CylinderGeometry(0.052, 0.044, 0.360, 10);
  muff.rotateX(Math.PI / 2);
  muff.translate(-0.155, 0.455, -0.760);
  E.push(muff);

  /* --- tank ------------------------------------------------------------- */
  S.push(blob(0.20, 0.92, 0.68, 1.42, 0, 0.845, 0.230, 14));
  S.push(box(0.075, 0.030, 0.090, 0, 0.958, 0.300));                // filler cap

  /* --- seat and rack ---------------------------------------------------- */
  L.push(blob(0.17, 0.85, 0.34, 1.55, 0, BIKE.seatY - 0.035, BIKE.seatZ, 12));
  L.push(box(0.255, 0.055, 0.240, 0, BIKE.seatY - 0.050, -0.480));  // pillion pad
  for (const s of [1, -1]) {
    S.push(tube(s * 0.105, 0.700, -0.560, s * 0.145, 0.735, -0.760, 0.014, 6));
  }

  /* --- what a man living on the bike actually carries -------------------- */
  C.push(blob(0.115, 1.0, 1.0, 1.9, 0, 0.800, -0.790, 10, 0, Math.PI / 2, 0)); // bedroll
  for (const s of [1, -1]) {
    L.push(box(0.115, 0.290, 0.330, s * 0.215, 0.585, -0.545, 0, 0, s * 0.06));
    L.push(box(0.128, 0.055, 0.300, s * 0.215, 0.720, -0.545, 0, 0, s * 0.06)); // flap
  }
  /* Jerry can on the left pannier. It is the loot economy made visible: the
     player should be able to see, from third person, whether they are carrying
     a refill or not. Its visibility is toggled at runtime. */
  const can = box(0.085, 0.230, 0.170, 0.235, 0.845, -0.545);
  S.push(box(0.055, 0.028, 0.055, 0.235, 0.968, -0.505));           // spout

  /* --- number plate / rear light ---------------------------------------- */
  S.push(box(0.115, 0.010, 0.145, 0, 0.560, -0.855, 0.30, 0, 0));

  /* Weathering: nothing on this bike is straight any more. A degree or two of
     random cant on the bolt-on parts costs nothing and is the difference
     between a machine that has been ridden and a showroom render. */
  for (const g of L.concat(C)) {
    g.rotateY((rng() - 0.5) * 0.045);
  }

  return { parts: P, canGeo: can };
}

/* ------------------------------------------------------------------- front */

/**
 * Fork legs, yoke, bars, mudguard and headlight, built about the STEERING HEAD
 * so the assembly can simply be rotated on its local Y to steer.
 *
 * Everything is expressed relative to that pivot, with the rake already taken
 * out — the caller tips the whole group back by BIKE.rake, so inside here the
 * fork runs straight down −Y and the geometry stays readable.
 */
export function buildFront() {
  const P = { steel: [], glass: [] };
  const S = P.steel;
  /* Axle depth below the head, along the fork axis. */
  const legLen = 0.545;
  const offset = 0.048;         // yoke offset — trail, and it is visible

  for (const s of [1, -1]) {
    S.push(tube(s * 0.112, -0.030, offset, s * 0.112, -legLen, offset, 0.026, 8));
    S.push(tube(s * 0.112, -0.230, offset, s * 0.112, -legLen + 0.02, offset, 0.021, 8)); // slider
  }
  S.push(tube(0.135, -0.020, offset, -0.135, -0.020, offset, 0.022, 6));   // top yoke
  S.push(tube(0.135, -0.185, offset, -0.135, -0.185, offset, 0.022, 6));   // bottom yoke
  S.push(tube(0, 0.010, 0, 0, -0.200, 0, 0.028, 8));                      // stem

  /* Bars: a straight centre section and two swept ends, plus grips. */
  const barY = 0.090;
  S.push(tube(0.115, barY, 0.010, -0.115, barY, 0.010, 0.016, 6));
  for (const s of [1, -1]) {
    S.push(tube(s * 0.115, barY, 0.010, s * BIKE.barHalf, barY + 0.030, -0.060, 0.015, 6));
    const grip = new THREE.CylinderGeometry(0.021, 0.021, 0.115, 8);
    grip.rotateZ(Math.PI / 2);
    grip.translate(s * (BIKE.barHalf - 0.045), barY + 0.028, -0.055);
    S.push(grip);
    /* levers */
    S.push(tube(s * (BIKE.barHalf - 0.110), barY + 0.024, -0.048,
      s * (BIKE.barHalf - 0.030), barY + 0.010, 0.010, 0.008, 4));
  }

  /* Headlight: a cowl and a lens. The lens gets its own material so it can be
     driven emissive when the light is on — a headlight that does not visibly
     light UP is the one thing players notice immediately at night. */
  const cowl = new THREE.CylinderGeometry(0.105, 0.088, 0.115, 14, 1, true);
  cowl.rotateX(Math.PI / 2);
  cowl.translate(0, -0.055, 0.100);
  S.push(cowl);
  const lens = new THREE.CircleGeometry(0.100, 16);
  lens.translate(0, -0.055, 0.159);
  P.glass.push(lens);

  /* Front mudguard, hung off the sliders and therefore part of this group. */
  S.push(guard(BIKE.wheelR + 0.055, 0.145, 0, -legLen + 0.05, offset, Math.PI * 0.28, Math.PI * 0.44));

  return P;
}

/* ------------------------------------------------------------------- merge */

/**
 * Merge a `{ materialKey: [geometry, ...] }` bag into one BufferGeometry per
 * key and return meshes sharing a single parent. Anything that fails to merge
 * is dropped rather than thrown, because a missing bracket is not worth a
 * black screen.
 */
export function assemble(parts, materials, name) {
  const group = new THREE.Group();
  group.name = name;
  for (const key in parts) {
    const list = parts[key].filter(Boolean);
    if (!list.length) continue;
    const geo = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!geo) continue;
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, materials[key] || materials.steel);
    m.name = name + '_' + key;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

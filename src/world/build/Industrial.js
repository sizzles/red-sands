import { UV } from './Buildings.js';

/**
 * Industrial — the military/utility half of the build kit.
 *
 * `Buildings.js` is a frontier vocabulary: clapboard, false fronts, shingles,
 * porch posts, sash windows. It is the right vocabulary for the settlement and
 * completely the wrong one for a Cordon post, which is poured concrete, block
 * work, corrugated iron, steel doors and gabion revetment. This file is the
 * second vocabulary, built on exactly the same `Builder`/`Frame` primitives and
 * feeding exactly the same `aWear` channels, so everything the weathering pass
 * already does — rust bleeding down from fixings, dirt splash off the ground,
 * sun bleaching on up-faces, hex-tiling that kills the texture repeat — happens
 * here for free.
 *
 * THE RULES ARE THE SAME AS THE TOWN'S, and they are worth restating because
 * they are what actually produce the detail, not the triangle count:
 *
 *   1. MASS FIRST. Silhouette out of a few parameters.
 *   2. SPLIT INTO BAYS. Repeat-to-fit, so a pilaster rhythm reads evenly at any
 *      wall length instead of being spaced by hand.
 *   3. NO PLANE MAY END IN A ZERO-THICKNESS SILHOUETTE. Every edge gets real
 *      material: coping, fascia, plinth, angle, drip. This is the single
 *      biggest one — a roof is not a plane, it is a deck with 200 mm of edge
 *      hanging off it, and that edge is most of what you see from the ground.
 *   4. OPENINGS ARE RECESSED, with darkness behind them. Depth reads at
 *      distance; a painted rectangle does not.
 *   5. WEAR IS DERIVED FROM GEOMETRY, not painted on. Fill `aWear` honestly and
 *      Wear.js does the rest.
 *   6. UVs IN METRES, so a block course is the same physical size everywhere.
 *
 * Local frames follow the town's convention: +x along the face, +z away from
 * it, y up, local y = 0 is the floor line.
 */

/** Metres per texture tile, per industrial surface. */
export const IUV = {
  block: { us: 1.20, vs: 0.60 },   // ~200 mm block course
  concrete: { us: 2.20, vs: 2.20 },
  iron: { us: 0.85, vs: 1.70 },   // ~100 mm corrugation pitch
  ironV: { us: 1.70, vs: 0.85, rot: 1 },
  steel: { us: 0.70, vs: 0.70 },
  bag: { us: 0.46, vs: 0.30 },   // a sandbag is ~450 x 300
  gravel: { us: 1.80, vs: 1.80 },
};

const DARK = [0.050, 0.043, 0.036];
const STEEL = [0.52, 0.53, 0.55];
const CONC = [0.74, 0.73, 0.70];

/* ------------------------------------------------------------------ openings */

/**
 * A steel door in a recessed opening.
 *
 * Everything here is depth. The reveal is 260 mm deep with a dark plate behind
 * it, the frame angle stands 60 mm proud of the wall, and the leaf itself is
 * set back inside the frame — so at any sun angle there are three separate
 * shadow lines across the opening. That is what a door looks like from forty
 * metres; the panel detail is only ever seen from four.
 */
export function steelDoor(B, F, M, x, y, w, h, o = {}) {
  const wear = o.wear;
  const wall = o.wallZ != null ? o.wallZ : 0;
  const inner = wall + (o.thick || 0.26);
  const rv = { us: IUV.concrete.us, vs: IUV.concrete.vs, wear, col: [0.56, 0.55, 0.53], nu: 1, nv: 1 };
  B.faceX(M.concrete, F, x, wall, inner, y, y + h, +1, rv);
  B.faceX(M.concrete, F, x + w, wall, inner, y, y + h, -1, rv);
  B.faceY(M.concrete, F, y + h, x, x + w, wall, inner, -1, rv);
  B.faceZ(M.concrete, F, inner + 0.55, x - 0.05, x + w + 0.05, y, y + h + 0.05, -1,
    { us: 1, vs: 1, wear, col: DARK, nu: 1, nv: 1 });

  /* frame angle, proud of the wall on three sides */
  const fa = { us: IUV.steel.us, vs: 0.30, wear, col: [0.44, 0.45, 0.46], nv: 1 };
  B.box(M.rust, F, x - 0.075, x, wall - 0.06, inner, y, y + h + 0.075, fa);
  B.box(M.rust, F, x + w, x + w + 0.075, wall - 0.06, inner, y, y + h + 0.075, fa);
  B.box(M.rust, F, x - 0.075, x + w + 0.075, wall - 0.06, inner, y + h, y + h + 0.075, fa);

  if (!o.open) {
    const dz = inner - 0.06;
    const dc = o.col || [0.40, 0.44, 0.42];
    B.box(M.rust, F, x + 0.03, x + w - 0.03, dz - 0.05, dz, y + 0.015, y + h - 0.03,
      { us: IUV.steel.us, vs: IUV.steel.vs, wear, col: dc, nu: 1, nv: 1 });
    /* two stiffening ribs across the leaf — the only modelling a steel door
       needs, and the thing that stops it reading as a flat plate */
    const rc = { us: 0.4, vs: 0.2, wear, col: [dc[0] * 0.88, dc[1] * 0.88, dc[2] * 0.88], nu: 1, nv: 1 };
    for (const t of [0.30, 0.70]) {
      B.box(M.rust, F, x + 0.08, x + w - 0.08, dz - 0.075, dz - 0.05,
        y + h * t - 0.035, y + h * t + 0.035, rc);
    }
    /* hinges and a lever handle */
    for (const t of [0.16, 0.84]) {
      B.box(M.rust, F, x + 0.005, x + 0.055, dz - 0.09, dz - 0.03, y + h * t - 0.06, y + h * t + 0.06,
        { us: 0.2, vs: 0.2, wear, col: [0.60, 0.58, 0.54], nu: 1, nv: 1 });
    }
    B.box(M.rust, F, x + w - 0.28, x + w - 0.10, dz - 0.115, dz - 0.06, y + h * 0.46, y + h * 0.50,
      { us: 0.2, vs: 0.2, wear, col: [0.68, 0.66, 0.60], nu: 1, nv: 1 });
  }
  /* concrete step, because a door that meets the ground exactly is a door with
     no wear line under it */
  B.box(M.concrete, F, x - 0.12, x + w + 0.12, wall - 0.55, wall + 0.10, y - 0.16, y + 0.02,
    { us: IUV.concrete.us, vs: 0.5, wear, col: [0.66, 0.65, 0.62], nv: 1 });
  return { x: x + w * 0.5, y, z: wall };
}

/**
 * A louvred vent. Four or five slats in a recessed frame.
 *
 * These are the cheapest facade element there is and they do more work than
 * windows on a building nobody goes inside: they break a blank block wall into
 * a rhythm, they read as dark from any distance, and they say the building is
 * mechanical rather than residential in one shape.
 */
export function louvreVent(B, F, M, x, y, w, h, o = {}) {
  const wear = o.wear;
  const wall = o.wallZ != null ? o.wallZ : 0;
  const inner = wall + 0.16;
  const rv = { us: IUV.concrete.us, vs: IUV.concrete.vs, wear, col: [0.54, 0.53, 0.51], nu: 1, nv: 1 };
  B.faceX(M.concrete, F, x, wall, inner, y, y + h, +1, rv);
  B.faceX(M.concrete, F, x + w, wall, inner, y, y + h, -1, rv);
  B.faceY(M.concrete, F, y + h, x, x + w, wall, inner, -1, rv);
  B.faceY(M.concrete, F, y, x, x + w, wall, inner, +1, rv);
  B.faceZ(M.rust, F, inner + 0.10, x, x + w, y, y + h, -1,
    { us: 1, vs: 1, wear, col: DARK, nu: 1, nv: 1 });

  const n = Math.max(3, Math.round(h / 0.11));
  const sc = { us: 0.4, vs: 0.12, wear, col: [0.48, 0.49, 0.48], nu: 1, nv: 1 };
  for (let i = 0; i < n; i++) {
    const sy = y + 0.02 + (h - 0.04) * (i / n);
    /* each slat tips forward-down, so the top edge catches light and the
       underside is in shadow — that alternation is the whole read */
    B.box(M.rust, F, x + 0.02, x + w - 0.02, wall + 0.02, inner - 0.01, sy, sy + 0.032, sc);
  }
  const t = 0.055;
  const tw = { us: IUV.steel.us, vs: 0.3, wear, col: [0.44, 0.45, 0.45], nv: 1 };
  B.box(M.rust, F, x - t, x + w + t, wall - 0.04, wall + 0.02, y + h, y + h + t, tw);
  B.box(M.rust, F, x - t, x, wall - 0.04, wall + 0.02, y, y + h, tw);
  B.box(M.rust, F, x + w, x + w + t, wall - 0.04, wall + 0.02, y, y + h, tw);
  B.box(M.rust, F, x - t, x + w + t, wall - 0.04, wall + 0.02, y - t, y, tw);
}

/** A roller shutter: the depot's big opening. Corrugated, in a steel guide. */
export function rollerShutter(B, F, M, x, y, w, h, o = {}) {
  const wear = o.wear;
  const wall = o.wallZ != null ? o.wallZ : 0;
  const inner = wall + (o.thick || 0.30);
  const open = o.open || 0;                 // 0 shut, 1 fully up
  const rv = { us: IUV.concrete.us, vs: IUV.concrete.vs, wear, col: [0.56, 0.55, 0.53], nu: 1, nv: 1 };
  B.faceX(M.concrete, F, x, wall, inner, y, y + h, +1, rv);
  B.faceX(M.concrete, F, x + w, wall, inner, y, y + h, -1, rv);
  B.faceY(M.concrete, F, y + h, x, x + w, wall, inner, -1, rv);
  B.faceZ(M.concrete, F, inner + 1.4, x - 0.1, x + w + 0.1, y, y + h + 0.1, -1,
    { us: 1, vs: 1, wear, col: DARK, nu: 1, nv: 1 });

  /* guides either side, and the barrel housing over the head */
  const gc = { us: IUV.steel.us, vs: 0.4, wear, col: [0.42, 0.43, 0.44], nv: 1 };
  B.box(M.rust, F, x - 0.10, x + 0.02, wall - 0.05, inner, y, y + h + 0.30, gc);
  B.box(M.rust, F, x + w - 0.02, x + w + 0.10, wall - 0.05, inner, y, y + h + 0.30, gc);
  B.box(M.rust, F, x - 0.12, x + w + 0.12, wall - 0.12, inner, y + h + 0.06, y + h + 0.42,
    { us: IUV.steel.us, vs: 0.35, wear, col: [0.46, 0.47, 0.47], nv: 1 });

  /* the curtain itself, hanging to whatever height it is open to */
  const top = y + h;
  const bot = y + h * open;
  if (bot < top - 0.05) {
    B.box(M.iron, F, x + 0.015, x + w - 0.015, inner - 0.075, inner - 0.03, bot, top,
      { us: IUV.iron.us, vs: IUV.iron.vs, rot: 1, wear, col: [0.60, 0.59, 0.55], nv: 1 });
    /* bottom rail — a heavier bar, and the thing that reads as a shutter
       rather than as corrugated sheet stuck in a hole */
    B.box(M.rust, F, x - 0.02, x + w + 0.02, inner - 0.10, inner - 0.01, bot - 0.075, bot,
      { us: 0.4, vs: 0.2, wear, col: [0.40, 0.41, 0.42], nu: 1, nv: 1 });
  }
}

/* --------------------------------------------------------------------- roofs */

/**
 * Flat roof with a parapet. `s` = { x0, x1, z0, z1, y, up, coping }.
 *
 * The parapet is the point: a flat roof with no upstand is a slab, and its
 * silhouette against the sky is a line with nothing on it. An upstand with a
 * coping that oversails it by 60 mm gives a hard shadow under the cap all the
 * way round, plus scuppers punched through at deck level with a stain running
 * down the wall below each one — which is where Wear.js earns its keep.
 */
export function flatRoof(B, F, M, s) {
  const { x0, x1, z0, z1, y } = s;
  const wear = s.wear;
  const up = s.up != null ? s.up : 0.52;      // parapet height above deck
  const t = s.t != null ? s.t : 0.20;         // parapet thickness
  const deck = { us: IUV.concrete.us, vs: IUV.concrete.vs, wear, col: s.deckCol || [0.60, 0.59, 0.56] };
  B.faceY(M.concrete, F, y, x0, x1, z0, z1, +1, deck);

  const pc = { us: IUV.concrete.us, vs: 0.55, wear, col: s.col || CONC, nv: 1 };
  B.box(M.concrete, F, x0 - t, x1 + t, z0 - t, z0, y - 0.15, y + up, pc);
  B.box(M.concrete, F, x0 - t, x1 + t, z1, z1 + t, y - 0.15, y + up, pc);
  B.box(M.concrete, F, x0 - t, x0, z0, z1, y - 0.15, y + up, pc);
  B.box(M.concrete, F, x1, x1 + t, z0, z1, y - 0.15, y + up, pc);

  /* COPING. Oversails the parapet both sides so there is a drip line, and it
     is the reason the roof edge is a shadow rather than an arris. */
  const ov = 0.07;
  const cc = { us: IUV.concrete.us, vs: 0.4, wear, col: s.copingCol || [0.80, 0.79, 0.75], nv: 1 };
  B.box(M.concrete, F, x0 - t - ov, x1 + t + ov, z0 - t - ov, z0 + ov, y + up, y + up + 0.11, cc);
  B.box(M.concrete, F, x0 - t - ov, x1 + t + ov, z1 - ov, z1 + t + ov, y + up, y + up + 0.11, cc);
  B.box(M.concrete, F, x0 - t - ov, x0 + ov, z0 - ov, z1 + ov, y + up, y + up + 0.11, cc);
  B.box(M.concrete, F, x1 - ov, x1 + t + ov, z0 - ov, z1 + ov, y + up, y + up + 0.11, cc);

  /* scuppers: a slot through the parapet at deck level. Two, on the low side. */
  if (s.scuppers !== false) {
    for (const fx of [0.28, 0.72]) {
      const sx = x0 + (x1 - x0) * fx;
      B.box(M.rust, F, sx - 0.10, sx + 0.10, z1, z1 + t + 0.16, y + 0.02, y + 0.13,
        { us: 0.3, vs: 0.2, wear, col: [0.44, 0.42, 0.38], nu: 1, nv: 1 });
    }
  }
  /* roof plant: a vent stack and a header tank, so the top of the building is
     not an empty tray when seen from the towers */
  if (s.plant !== false) {
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
    B.tube(M.rust, F.p(cx - 1.4, cz - 0.8, y), F.p(cx - 1.4, cz - 0.8, y + 0.95), 0.13, 0.13, 8,
      { us: 0.4, vs: 0.5, wear, col: [0.50, 0.47, 0.42], caps: true });
    B.box(M.iron, F, cx + 0.6, cx + 2.2, cz - 0.7, cz + 0.9, y, y + 0.78,
      { us: IUV.iron.us, vs: IUV.iron.vs, wear, col: [0.62, 0.61, 0.57], nv: 1 });
  }
}

/**
 * Corrugated shed roof, with the fascia and the exposed purlin ends that stop
 * it terminating in a paper-thin edge. `s` = { x0, x1, z0, z1, yLow, yHigh }.
 */
export function ironShedRoof(B, F, M, s) {
  const { x0, x1, z0, z1, yLow, yHigh } = s;
  const wear = s.wear;
  const oh = s.oh != null ? s.oh : 0.36;
  const col = s.col || [0.58, 0.57, 0.53];
  const a = F.p(x0 - oh, z0 - oh, yHigh);
  const b = F.p(x1 + oh, z0 - oh, yHigh);
  const c = F.p(x1 + oh, z1 + oh, yLow);
  const d = F.p(x0 - oh, z1 + oh, yLow);
  B.quad(M.iron, a, b, c, d, { us: IUV.iron.us, vs: IUV.iron.vs, wear, col, nv: 2 });
  /* underside, so the overhang is not one-sided paper */
  const dropA = F.p(x0 - oh, z0 - oh, yHigh - 0.055);
  const dropB = F.p(x1 + oh, z0 - oh, yHigh - 0.055);
  const dropC = F.p(x1 + oh, z1 + oh, yLow - 0.055);
  const dropD = F.p(x0 - oh, z1 + oh, yLow - 0.055);
  B.quad(M.iron, dropD, dropC, dropB, dropA,
    { us: IUV.iron.us, vs: IUV.iron.vs, wear, col: [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55], nv: 2 });
  /* fascia along the low edge, and a barge angle down each rake */
  const fc = { us: IUV.steel.us, vs: 0.26, wear, col: [0.46, 0.46, 0.44], nv: 1 };
  B.box(M.rust, F, x0 - oh, x1 + oh, z1 + oh - 0.07, z1 + oh, yLow - 0.20, yLow + 0.03, fc);
  B.box(M.rust, F, x0 - oh, x0 - oh + 0.07, z0 - oh, z1 + oh, yLow - 0.14, yHigh + 0.03, fc);
  B.box(M.rust, F, x1 + oh - 0.07, x1 + oh, z0 - oh, z1 + oh, yLow - 0.14, yHigh + 0.03, fc);
  /* a gutter and one downpipe: the pipe is where Wear.js hangs its rust run */
  if (s.gutter !== false) {
    B.tube(M.rust, F.p(x0 - oh + 0.2, z1 + oh - 0.03, yLow - 0.24),
      F.p(x1 + oh - 0.2, z1 + oh - 0.03, yLow - 0.24), 0.065, 0.065, 6,
      { us: 0.5, vs: 0.5, wear, col: [0.52, 0.48, 0.42] });
    const px = x1 - 0.5;
    B.tube(M.rust, F.p(px, z1 + oh - 0.03, yLow - 0.28), F.p(px, z1 + 0.06, s.ground || 0),
      0.055, 0.055, 6, { us: 0.4, vs: 0.6, wear, col: [0.52, 0.48, 0.42] });
  }
}

/* ---------------------------------------------------------------- structures */

/**
 * A block building: plinth, bays with pilasters, and whatever roof you ask for.
 *
 * This is the industrial equivalent of `buildBuilding`. The bay loop is the
 * interesting part — the wall length is divided into as many ~`bay` metre
 * panels as fit, and the openings are assigned per bay index, so the rhythm is
 * even whether the wall is nine metres or nineteen. Hand-placing openings is
 * what makes procedural buildings look hand-placed in the bad way.
 *
 * @param {object} spec { w, d, h, bay, roof:'flat'|'iron', door, shutter,
 *                        vents, ground, grime }
 */
export function buildBlockhouse(B, F, M, spec, rand) {
  const w = spec.w, d = spec.d, h = spec.h;
  const g = spec.ground || 0;
  const wear = [g, g + h + 1.2, spec.grime != null ? spec.grime : 0.62, 0.30];
  const bayW = spec.bay || 3.2;
  const nBay = Math.max(2, Math.round(w / bayW));
  const bw = w / nBay;
  const col = spec.col || CONC;
  const wallO = { us: IUV.block.us, vs: IUV.block.vs, wear, col };

  /* --- plinth. A 400 mm band of poured concrete standing 60 mm proud of the
     block above it. It is the line the dirt splash breaks against, and without
     it the wall grows out of the ground like a decal. */
  const pl = 0.42;
  const plO = { us: IUV.concrete.us, vs: 0.45, wear, col: [col[0] * 0.86, col[1] * 0.86, col[2] * 0.85], nv: 1 };
  B.box(M.concrete, F, -0.06, w + 0.06, -0.06, d + 0.06, g - 0.25, g + pl, plO);

  /* --- the four walls, each punched with its bay openings ------------------ */
  const holesFront = [];
  const openings = [];
  for (let i = 0; i < nBay; i++) {
    const x = i * bw;
    const kind = spec.bays ? spec.bays[i % spec.bays.length] : (i === (nBay >> 1) ? 'door' : 'vent');
    if (kind === 'door') {
      const dw = Math.min(1.15, bw * 0.55), dh = 2.15;
      const dx = x + (bw - dw) * 0.5;
      holesFront.push({ x0: dx, x1: dx + dw, y0: g, y1: g + dh });
      openings.push(['door', dx, g, dw, dh]);
    } else if (kind === 'shutter') {
      const sw = Math.min(3.4, bw * 0.86), sh = 2.9;
      const sx = x + (bw - sw) * 0.5;
      holesFront.push({ x0: sx, x1: sx + sw, y0: g, y1: g + sh });
      openings.push(['shutter', sx, g, sw, sh]);
    } else if (kind === 'vent') {
      const vw = Math.min(0.86, bw * 0.42), vh = 0.62;
      const vx = x + (bw - vw) * 0.5, vy = g + h - 1.05;
      holesFront.push({ x0: vx, x1: vx + vw, y0: vy, y1: vy + vh });
      openings.push(['vent', vx, vy, vw, vh]);
    }
  }
  B.wallHoles(M.concrete, F, 0, 0, w, g + pl, g + h, -1, holesFront, wallO);
  B.faceZ(M.concrete, F, d, 0, w, g + pl, g + h, +1, wallO);
  B.faceX(M.concrete, F, 0, 0, d, g + pl, g + h, -1, wallO);
  B.faceX(M.concrete, F, w, 0, d, g + pl, g + h, +1, wallO);

  for (const [kind, ox, oy, ow, oh2] of openings) {
    if (kind === 'door') steelDoor(B, F, M, ox, oy, ow, oh2, { wear, thick: 0.30 });
    else if (kind === 'shutter') rollerShutter(B, F, M, ox, oy, ow, oh2, { wear, open: spec.shutterOpen || 0 });
    else louvreVent(B, F, M, ox, oy, ow, oh2, { wear });
  }

  /* --- PILASTERS between the bays. Four courses of block standing 90 mm proud
     is nothing structurally and everything visually: it converts a flat rectangle
     into a rhythm of light and shadow that survives to any distance the building
     is legible at. */
  const pc = { us: IUV.block.us, vs: IUV.block.vs, wear, col: [col[0] * 1.04, col[1] * 1.03, col[2] * 1.01], nu: 1 };
  for (let i = 0; i <= nBay; i++) {
    const x = Math.min(w - 0.16, Math.max(0, i * bw - 0.16));
    B.box(M.concrete, F, x, x + 0.32, -0.09, 0.01, g + pl, g + h + 0.05, pc);
    B.box(M.concrete, F, x, x + 0.32, d - 0.01, d + 0.09, g + pl, g + h + 0.05, pc);
  }
  /* corner returns, so the pilaster rhythm wraps rather than stopping dead */
  B.box(M.concrete, F, -0.09, 0.01, 0, d, g + pl, g + h + 0.05, pc);
  B.box(M.concrete, F, w - 0.01, w + 0.09, 0, d, g + pl, g + h + 0.05, pc);

  /* --- roof */
  if (spec.roof === 'iron') {
    ironShedRoof(B, F, M, {
      x0: -0.10, x1: w + 0.10, z0: -0.10, z1: d + 0.10,
      yHigh: g + h + 0.75, yLow: g + h + 0.10, wear, ground: g,
    });
  } else {
    flatRoof(B, F, M, {
      x0: 0, x1: w, z0: 0, z1: d, y: g + h, wear,
      plant: spec.plant, scuppers: true,
    });
  }

  /* --- sandbag revetment against the front wall, two courses. The one element
     that says "this is a position" rather than "this is a shed". */
  if (spec.bags !== false) {
    sandbagCourse(B, F, M, 0.4, w - 0.4, -0.30, g, { wear, rand, rows: 2 });
  }
  return { w, d, h, wear };
}

/**
 * A framed guard tower: four legs, X-bracing, a deck, a rail and a roof.
 *
 * The first build made these solid boxes, which at 15 m tall read as chimneys.
 * A frame is the correct shape and it is also much stronger visually, because
 * you can see sky through it — a lattice against a bright sky is one of the
 * few silhouettes that stays legible in aerial haze at a kilometre.
 */
export function guardTower(B, F, M, s) {
  const g = s.ground || 0;
  const H = s.h || 11.5;
  const r = s.r || 1.55;            // half-width of the leg square
  const wear = [g, g + H + 2.4, 0.68, 0.34];
  const leg = 0.19;
  const legs = [[-r, -r], [r, -r], [r, r], [-r, r]];

  /* concrete pad footings, then the legs */
  for (const [lx, lz] of legs) {
    B.box(M.concrete, F, lx - 0.34, lx + 0.34, lz - 0.34, lz + 0.34, g - 0.4, g + 0.22,
      { us: IUV.concrete.us, vs: 0.4, wear, col: [0.70, 0.69, 0.66], nv: 1 });
    B.box(M.rust, F, lx - leg * 0.5, lx + leg * 0.5, lz - leg * 0.5, lz + leg * 0.5, g, g + H,
      { us: IUV.steel.us, vs: 0.9, wear, col: STEEL, nu: 1 });
  }
  /* X-bracing in four lifts up each face. This is most of the triangle count
     and all of the character. */
  const lifts = Math.max(3, Math.round(H / 2.9));
  const br = 0.075;
  const bc = { us: 0.5, vs: 0.6, wear, col: [0.46, 0.47, 0.48] };
  for (let k = 0; k < lifts; k++) {
    const y0 = g + (H / lifts) * k, y1 = g + (H / lifts) * (k + 1);
    for (let f = 0; f < 4; f++) {
      const a = legs[f], b = legs[(f + 1) % 4];
      B.tube(M.rust, F.p(a[0], a[1], y0), F.p(b[0], b[1], y1), br, br, 4, bc);
      B.tube(M.rust, F.p(b[0], b[1], y0), F.p(a[0], a[1], y1), br, br, 4, bc);
      /* a horizontal tie at the top of each lift, so the X's have something to
         land on and the frame reads as built rather than as crossed sticks */
      B.tube(M.rust, F.p(a[0], a[1], y1), F.p(b[0], b[1], y1), br * 0.85, br * 0.85, 4, bc);
    }
  }

  /* deck: a steel plate on edge beams, oversailing the legs */
  const dy = g + H;
  const dk = r + 0.55;
  B.box(M.rust, F, -dk, dk, -dk, dk, dy, dy + 0.10,
    { us: IUV.steel.us, vs: IUV.steel.vs, wear, col: [0.50, 0.51, 0.50] });
  B.box(M.rust, F, -dk - 0.06, dk + 0.06, -dk - 0.06, dk + 0.06, dy - 0.22, dy,
    { us: IUV.steel.us, vs: 0.3, wear, col: [0.42, 0.43, 0.43], nv: 1 });

  /* rail on all four sides, with sandbags stacked along two of them */
  const rc = { us: 0.4, vs: 0.4, wear, col: [0.44, 0.45, 0.46] };
  for (let f = 0; f < 4; f++) {
    const sgn = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const a = sgn[f], b = sgn[(f + 1) % 4];
    for (const hh of [0.55, 1.05]) {
      B.tube(M.rust, F.p(a[0] * dk, a[1] * dk, dy + hh), F.p(b[0] * dk, b[1] * dk, dy + hh), 0.038, 0.038, 5, rc);
    }
    B.tube(M.rust, F.p(a[0] * dk, a[1] * dk, dy), F.p(a[0] * dk, a[1] * dk, dy + 1.10), 0.045, 0.045, 5, rc);
  }
  if (s.bags !== false) {
    sandbagCourse(B, F, M, -dk + 0.15, dk - 0.15, -dk + 0.12, dy + 0.10, { wear, rand: s.rand, rows: 2 });
    sandbagCourse(B, F, M, -dk + 0.15, dk - 0.15, dk - 0.30, dy + 0.10, { wear, rand: s.rand, rows: 2 });
  }

  /* roof: a shallow iron canopy on four short posts */
  const ry = dy + 1.95;
  for (const [lx, lz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
    B.box(M.rust, F, lx - 0.055, lx + 0.055, lz - 0.055, lz + 0.055, dy + 0.10, ry,
      { us: 0.3, vs: 0.6, wear, col: STEEL, nu: 1 });
  }
  ironShedRoof(B, F, M, {
    x0: -dk - 0.15, x1: dk + 0.15, z0: -dk - 0.15, z1: dk + 0.15,
    yHigh: ry + 0.42, yLow: ry, wear, oh: 0.18, gutter: false,
    col: [0.50, 0.49, 0.46],
  });

  /* the floodlight head, on a stub arm off the rail */
  if (s.lamp !== false) {
    B.tube(M.rust, F.p(0, dk - 0.1, dy + 1.05), F.p(0, dk + 0.75, dy + 1.45), 0.05, 0.05, 5, rc);
    B.box(M.rust, F, -0.30, 0.30, dk + 0.62, dk + 0.98, dy + 1.28, dy + 1.72,
      { us: 0.3, vs: 0.3, wear, col: [0.38, 0.38, 0.37], nu: 1, nv: 1 });
    if (M.lamp) {
      B.faceZ(M.lamp, F, dk + 0.60, -0.26, 0.26, dy + 1.33, dy + 1.67, -1,
        { us: 0.3, vs: 0.3, wear, col: [1, 1, 1], nu: 1, nv: 1 });
    }
  }
  /* a caged ladder up one leg */
  if (s.ladder !== false) {
    const lx = -r, lz = r + 0.10;
    B.tube(M.rust, F.p(lx - 0.22, lz, g), F.p(lx - 0.22, lz, dy + 0.9), 0.032, 0.032, 5, rc);
    B.tube(M.rust, F.p(lx + 0.22, lz, g), F.p(lx + 0.22, lz, dy + 0.9), 0.032, 0.032, 5, rc);
    for (let y = g + 0.30; y < dy + 0.6; y += 0.30) {
      B.tube(M.rust, F.p(lx - 0.22, lz, y), F.p(lx + 0.22, lz, y), 0.019, 0.019, 4, rc);
    }
  }
  return { deckY: dy, lampY: dy + 1.5, lampZ: dk + 0.8 };
}

/* -------------------------------------------------------------- perimeter kit */

/**
 * A course of sandbags along a line, stacked in rows with a half-bag stagger.
 *
 * Individually modelled bags rather than a textured box: a sandbag wall has a
 * completely distinctive lumpy top edge, and that edge is the read. Each bag is
 * one box with a jittered size and yaw, which is cheap and reads correctly from
 * two metres and from two hundred.
 */
export function sandbagCourse(B, F, M, x0, x1, z, y, o = {}) {
  const wear = o.wear;
  const rand = o.rand || (() => 0.5);
  const rows = o.rows || 2;
  const bw = 0.46, bh = 0.16, bd = 0.28;
  const n = Math.max(1, Math.floor((x1 - x0) / bw));
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    const yy = y + r * bh;
    for (let i = 0; i < n; i++) {
      const cx = x0 + off + i * bw + bw * 0.5;
      if (cx + bw * 0.5 > x1) continue;
      const j = 0.86 + rand() * 0.26;
      const sag = r === rows - 1 ? 0.82 : 1.0;      // top course sits lower
      const tone = 0.80 + rand() * 0.34;
      B.box(M.bag, F,
        cx - bw * 0.47 * j, cx + bw * 0.47 * j,
        z - bd * 0.5 * j, z + bd * 0.5 * j,
        yy, yy + bh * sag * j,
        {
          us: IUV.bag.us, vs: IUV.bag.vs, wear, nu: 1, nv: 1,
          col: [0.62 * tone, 0.58 * tone, 0.47 * tone],
        });
    }
  }
}

/**
 * A gabion / HESCO run: wire-cage baskets filled with spoil.
 *
 * The signature perimeter of any modern field position, and the single fastest
 * way to make a wall stop being a wall and start being a defensive work. Built
 * as a filled box with a proud wire frame on the visible faces — the frame is
 * what carries the read, because it is the only regular grid on an otherwise
 * lumpy object.
 */
export function hescoRun(B, F, M, x0, x1, z, y, o = {}) {
  const wear = o.wear;
  const rand = o.rand || (() => 0.5);
  const h = o.h || 1.05;
  const d = o.d || 0.95;
  const n = Math.max(1, Math.round((x1 - x0) / d));
  const cw = (x1 - x0) / n;
  /* Baskets are individually seated on the ground under them. They are stacked
     by hand in the real thing and they step down a slope one cell at a time;
     running them off one datum leaves half the row buried and half in the air,
     which on a 7% site is the first thing you notice. */
  const yAt = o.yAt || (() => y);
  for (let i = 0; i < n; i++) {
    const a = x0 + i * cw, b = a + cw;
    const t = 0.86 + rand() * 0.28;
    const hh = h * (0.94 + rand() * 0.12);
    const y0 = yAt((a + b) * 0.5);
    B.box(M.gravel, F, a + 0.02, b - 0.02, z - d * 0.5, z + d * 0.5, y0, y0 + hh, {
      us: IUV.gravel.us, vs: IUV.gravel.vs, wear, nu: 2, nv: 1,
      col: [0.56 * t, 0.52 * t, 0.44 * t],
    });
    /* the wire cage: verticals at the cell corners and two horizontal bands */
    const wc = { us: 0.3, vs: 0.3, wear, col: [0.42, 0.40, 0.36] };
    for (const zz of [z - d * 0.5 - 0.01, z + d * 0.5 + 0.01]) {
      for (const xx of [a, b]) {
        B.tube(M.rust, F.p(xx, zz, y0), F.p(xx, zz, y0 + hh), 0.022, 0.022, 4, wc);
      }
      for (const fy of [0.30, 0.72]) {
        B.tube(M.rust, F.p(a, zz, y0 + hh * fy), F.p(b, zz, y0 + hh * fy), 0.018, 0.018, 4, wc);
      }
    }
    /* spoil spilling over the top edge, so the cage looks filled not printed */
    B.box(M.gravel, F, a + 0.06, b - 0.06, z - d * 0.42, z + d * 0.42, y0 + hh, y0 + hh + 0.07 * t, {
      us: IUV.gravel.us, vs: IUV.gravel.vs, wear, nu: 1, nv: 1,
      col: [0.60 * t, 0.55 * t, 0.46 * t],
    });
    /*
     * A SECOND COURSE on roughly half the cells, set back and narrower.
     *
     * One even row of identical cubes stepping down a slope reads as a line of
     * packing crates, which is what the first build photographed as. Real
     * revetment is stacked to whatever height the ground and the working party
     * decided on that day, so it is ragged along the top and pyramidal in
     * section — and it is the ragged top edge, not the cage, that says this was
     * built by hand out of what was to hand.
     */
    if (rand() > 0.42) {
      const h2 = hh * (0.72 + rand() * 0.26);
      const in2 = d * 0.16;
      B.box(M.gravel, F, a + 0.10, b - 0.10, z - d * 0.5 + in2, z + d * 0.5 - in2,
        y0 + hh + 0.05, y0 + hh + 0.05 + h2, {
          us: IUV.gravel.us, vs: IUV.gravel.vs, wear, nu: 2, nv: 1,
          col: [0.54 * t, 0.50 * t, 0.43 * t],
        });
      const wc2 = { us: 0.3, vs: 0.3, wear, col: [0.40, 0.38, 0.34] };
      for (const zz of [z - d * 0.5 + in2 - 0.01, z + d * 0.5 - in2 + 0.01]) {
        for (const xx of [a + 0.10, b - 0.10]) {
          B.tube(M.rust, F.p(xx, zz, y0 + hh + 0.05), F.p(xx, zz, y0 + hh + 0.05 + h2),
            0.020, 0.020, 4, wc2);
        }
        B.tube(M.rust, F.p(a + 0.10, zz, y0 + hh + 0.05 + h2 * 0.55),
          F.p(b - 0.10, zz, y0 + hh + 0.05 + h2 * 0.55), 0.017, 0.017, 4, wc2);
      }
    }
  }
}

/** A steel drum. Ribbed, because a smooth cylinder reads as a pipe. */
export function drum(B, F, M, cx, cz, y, o = {}) {
  const wear = o.wear;
  const col = o.col || [0.42, 0.46, 0.40];
  B.tube(M.rust, F.p(cx, cz, y), F.p(cx, cz, y + 0.88), 0.29, 0.29, 10,
    { us: 0.6, vs: 0.6, wear, col, caps: true });
  for (const fy of [0.30, 0.62]) {
    B.tube(M.rust, F.p(cx, cz, y + 0.88 * fy), F.p(cx, cz, y + 0.88 * fy + 0.05), 0.315, 0.315, 10,
      { us: 0.3, vs: 0.2, wear, col: [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85] });
  }
}

/** A lattice antenna mast — the compound's tallest silhouette. */
export function latticeMast(B, F, M, cx, cz, y, h, o = {}) {
  const wear = o.wear || [y, y + h, 0.6, 0.3];
  const col = [0.50, 0.51, 0.52];
  const r0 = 0.42, r1 = 0.14;
  const legs = [0, 2.094, 4.189];
  const at = (a, t) => F.p(cx + Math.cos(a) * (r0 + (r1 - r0) * t),
    cz + Math.sin(a) * (r0 + (r1 - r0) * t), y + h * t);
  const lifts = Math.round(h / 1.5);
  for (const a of legs) {
    for (let k = 0; k < lifts; k++) {
      B.tube(M.rust, at(a, k / lifts), at(a, (k + 1) / lifts), 0.036, 0.033, 4,
        { us: 0.3, vs: 0.6, wear, col });
    }
  }
  for (let k = 0; k < lifts; k++) {
    const t0 = k / lifts, t1 = (k + 1) / lifts;
    for (let i = 0; i < 3; i++) {
      const a = legs[i], b = legs[(i + 1) % 3];
      B.tube(M.rust, at(a, t0), at(b, t1), 0.020, 0.019, 3, { us: 0.3, vs: 0.5, wear, col });
      B.tube(M.rust, at(a, t1), at(b, t1), 0.018, 0.018, 3, { us: 0.3, vs: 0.5, wear, col });
    }
  }
  /* a crossarm and a dish near the top, so it is an antenna and not a pylon */
  B.tube(M.rust, F.p(cx - 1.05, cz, y + h * 0.88), F.p(cx + 1.05, cz, y + h * 0.88), 0.028, 0.028, 4,
    { us: 0.3, vs: 0.5, wear, col });
  B.box(M.rust, F, cx + 0.30, cx + 0.34, cz - 0.55, cz + 0.55, y + h * 0.62, y + h * 0.62 + 1.10,
    { us: 0.4, vs: 0.4, wear, col: [0.72, 0.71, 0.68], nu: 1, nv: 1 });
}

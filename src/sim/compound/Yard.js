import { Builder, Frame } from '../../world/build/Builder.js';
import {
  IUV, buildBlockhouse, guardTower, sandbagCourse, hescoRun, drum, latticeMast,
} from '../../world/build/Industrial.js';

/**
 * BROKEN ROAD — THE COMPOUND
 * ============================================================================
 * The Cordon's own position at the head of the pass, built across the only road
 * out of the valley. Everything about the shape is trying to say one thing from
 * a long way off: *this is not a checkpoint, and you are not going to ride
 * through it.*
 *
 * The checkpoints out on the highway are staggered barriers with a line through
 * them at walking pace, because their job is to slow you down and tax you. This
 * closes the road completely. That difference has to be legible at the moment
 * the player first crests the pass, because that is the moment the game asks
 * its only real question: are you ready yet?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `CompoundBuild.js` ANY MORE
 *
 * The first version was twenty-four axis-aligned `BoxGeometry` calls merged by
 * hand into 684 triangles on one untextured stone material. Meanwhile the town
 * — the same world, sixteen buildings and two hundred props — comes out of
 * `world/build/` at about fifteen draw calls WITH recessed openings, real
 * fascia and barge boards, plinths, and a per-pixel weathering pass that runs
 * rust down from every fixing and splashes dirt up off the ground.
 *
 * The endgame location was simply built with a cruder tool than everything else
 * in the game. So it now goes through the same kit: `Builder` for the mesh,
 * `Industrial.js` for the military vocabulary the town's clapboard-and-shingle
 * one cannot express, and `Wear.js` for the surface. Nothing here is a new
 * rendering technique; it is the existing one, finally applied.
 *
 * ---------------------------------------------------------------------------
 * LOCAL SPACE
 *   +x  across the road, to the left as you approach
 *   +z  along the road, in the direction of travel — so the gate is at +halfZ
 *       and the way out of the valley is beyond it
 *   y   up, y = 0 on the site's ground level
 * ============================================================================
 */

/**
 * Footprint and scale.
 *
 * The tower-to-wall ratio is the number that matters. At two-to-one this read
 * as a fence with posts in it from the hundred metres the player first sees it
 * from; real defensive works run nearer three-to-one, so the tower is
 * unmistakably the thing that watches and the wall is unmistakably the thing
 * that stops you. 5.4 and 15.5 also lifts the tower decks clear of a mature
 * treeline, which is what makes the compound visible from the pass at all.
 */
export const YARD = { halfX: 26, halfZ: 20, wallH: 5.4, gateW: 9.0 };

/** How far the walls run below grade. Absorbs cross-fall under the footprint. */
const FOOT = 4.2;

const BAY = 4.2;          // metres between wall buttresses
const CONC = [0.60, 0.59, 0.57];      // the recessed wall behind everything

/**
 * One run of perimeter wall, from local (x0,z0) to (x1,z1).
 *
 * Split into bays rather than extruded as one box, and that is the whole
 * difference. A bay carries: block face, a plinth band it grows out of, a
 * buttress pilaster at each joint, a coping that oversails both faces so the
 * top edge is a shadow instead of an arris, and a fighting step on the inside.
 * The rhythm comes out even at any wall length because the bay count is
 * `round(run / BAY)` and the width divides back out — hand-placing buttresses
 * is what makes procedural walls look hand-placed in the bad way.
 */
function wallRun(B, F, M, x0, z0, x1, z1, o) {
  const wear = o.wear;
  const H = o.h;
  const t = o.t != null ? o.t : 0.62;
  const dx = x1 - x0, dz = z1 - z0;
  const run = Math.hypot(dx, dz);
  if (run < 0.4) return;
  const n = Math.max(1, Math.round(run / BAY));
  const bw = run / n;
  /*
   * A sub-frame whose +x runs along this wall, so every piece below can be
   * authored in flat 2D. `Frame` always derives +z as +x rotated 90 degrees, so
   * as long as the caller walks the perimeter in a consistent direction, +z is
   * the OUTWARD normal on every run for free — which is what lets the plinth,
   * the buttresses and the gabions be written once instead of four times.
   */
  const W = F.sub(x0, z0, 0, Math.atan2(dz, dx));
  /* Tones are separated harder than the material would separate them. Under an
     overcast sky nothing casts a shadow, so the only thing left distinguishing
     a proud panel from the wall behind it is its value — and at 4% apart they
     were indistinguishable. Recess dark, proud light, cap lightest. */
  const face = { us: IUV.block.us, vs: IUV.block.vs, wear, col: o.col || CONC };

  /* plinth: poured, proud, and the line the dirt splash breaks against */
  B.box(M.concrete, W, -0.05, run + 0.05, -t * 0.5 - 0.07, t * 0.5 + 0.07, -FOOT, 0.46,
    { us: IUV.concrete.us, vs: 0.5, wear, col: [0.62, 0.61, 0.58], nv: 1 });
  /*
   * THE CURTAIN, punched with an EMBRASURE per bay.
   *
   * This is the element that does the most work per triangle on the whole
   * position, and it took two renders to see why. Buttresses and panel fields
   * only exist on screen as the shadows they cast, so at a frontal sun — or
   * under the overcast this valley spends half its life in — the wall goes back
   * to being a flat band however deep the relief is. A hole does not have that
   * problem. A recess is dark from every angle in every weather, and a rhythm
   * of dark slots along a wall says "men stand behind this and shoot through
   * it" in one shape, which is also the only thing that explains the fighting
   * step on the other side.
   *
   * Blind pockets rather than a hole right through: from outside they are
   * indistinguishable, and it avoids punching the inner face, its reveals and
   * the sightline problems that come with an actual opening.
   */
  const emb = [];
  /* Sill height is not arbitrary: the fighting step inside is at H-1.55, so a
     man standing on it has his chest at about H-0.2 and fires through a loop
     whose head is around H-1.6. That is the whole reason both elements exist,
     and it only reads if they agree with each other. */
  const ew = 0.62, eh = 0.52, ey = H - 2.15;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * bw;
    if (cx < 0.9 || cx > run - 0.9) continue;
    emb.push({ x0: cx - ew * 0.5, x1: cx + ew * 0.5, y0: ey, y1: ey + eh });
  }
  B.wallHoles(M.concrete, W, -t * 0.5, 0, run, 0.46, H, -1, emb, face);
  B.faceZ(M.concrete, W, t * 0.5, 0, run, 0.46, H, +1, face);
  B.faceX(M.concrete, W, 0, -t * 0.5, t * 0.5, 0.46, H, -1, face);
  B.faceX(M.concrete, W, run, -t * 0.5, t * 0.5, 0.46, H, +1, face);
  B.faceY(M.concrete, W, H, 0, run, -t * 0.5, t * 0.5, +1, face);
  {
    const zin = -t * 0.5 + 0.36;
    const rev = { us: IUV.concrete.us, vs: IUV.concrete.vs, wear, col: [0.50, 0.49, 0.47], nu: 1, nv: 1 };
    const blk = { us: 1, vs: 1, wear, col: [0.055, 0.050, 0.045], nu: 1, nv: 1 };
    for (const e of emb) {
      B.faceX(M.concrete, W, e.x0, -t * 0.5, zin, e.y0, e.y1, +1, rev);
      B.faceX(M.concrete, W, e.x1, -t * 0.5, zin, e.y0, e.y1, -1, rev);
      B.faceY(M.concrete, W, e.y1, e.x0, e.x1, -t * 0.5, zin, -1, rev);
      B.faceY(M.concrete, W, e.y0, e.x0, e.x1, -t * 0.5, zin, +1, rev);
      B.faceZ(M.concrete, W, zin, e.x0, e.x1, e.y0, e.y1, -1, blk);
      /* a splayed cill under each loop, throwing water and a shadow clear of
         the wall — and giving the slot a bright edge to be dark against */
      B.box(M.concrete, W, e.x0 - 0.13, e.x1 + 0.13, -t * 0.5 - 0.16, -t * 0.5 + 0.01,
        e.y0 - 0.14, e.y0 + 0.01,
        { us: IUV.concrete.us, vs: 0.3, wear, col: [0.86, 0.85, 0.80], nu: 1, nv: 1 });
    }
  }

  /*
   * RELIEF, and the first build did not have enough of it.
   *
   * The close shot of the curtain came back as a flat plane with a good texture
   * on it: correct masonry courses, no visible repeat, and no architecture. A
   * 300 mm buttress on a 5.4 m wall is right by the book and photographs as
   * nothing, because relief only reads through the shadow it casts and at the
   * sun angles this valley actually spends its time at, 300 mm casts about a
   * hand's width. Three elements fix it, and all three are what a real mass
   * concrete wall has anyway:
   *
   *   BUTTRESSES  550 mm proud, 850 mm wide, at every bay joint. Deep enough
   *               to throw a shadow across the panel beside them.
   *   PANELS      one proud field per bay, held back from the buttresses, so
   *               there is a continuous shadow line boxing every bay.
   *   STRING      a horizontal band below the coping. A tall blank wall needs
   *               one horizontal to read its own height against.
   */
  const bd = 0.55, bwid = 0.85;
  const bc = { us: IUV.block.us, vs: IUV.block.vs, wear, col: [CONC[0] * 1.34, CONC[1] * 1.33, CONC[2] * 1.30], nu: 1 };
  for (let i = 0; i <= n; i++) {
    const x = Math.min(run - bwid, Math.max(0, i * bw - bwid * 0.5));
    B.box(M.concrete, W, x, x + bwid, -t * 0.5 - bd, -t * 0.5 + 0.01, 0.20, H - 0.30, bc);
    /* a weathered splay at the top of each buttress, so it dies into the wall
       instead of stopping in mid-air */
    B.box(M.concrete, W, x, x + bwid, -t * 0.5 - bd * 0.45, -t * 0.5 + 0.01, H - 0.30, H - 0.02, bc);
  }
  /* proud panel per bay */
  const pnl = { us: IUV.block.us, vs: IUV.block.vs, wear, col: [CONC[0] * 1.16, CONC[1] * 1.15, CONC[2] * 1.14] };
  for (let i = 0; i < n; i++) {
    const x0p = i * bw + bwid * 0.5 + 0.22;
    const x1p = (i + 1) * bw - bwid * 0.5 - 0.22;
    if (x1p - x0p < 0.5) continue;
    /* The panel stops CLEAR of the embrasure band. At H-1.55 it was laid
       straight over the slots punched in the wall face behind it, so the
       embrasures were built, on the right side, and completely invisible. */
    B.box(M.concrete, W, x0p, x1p, -t * 0.5 - 0.17, -t * 0.5 + 0.01, 0.86, H - 2.55, pnl);
  }
  /* string course, running the whole length under the coping */
  B.box(M.concrete, W, -0.04, run + 0.04, -t * 0.5 - 0.24, t * 0.5 + 0.05, H - 1.42, H - 1.10,
    { us: IUV.concrete.us, vs: 0.32, wear, col: [0.80, 0.79, 0.75], nv: 1 });

  /* COPING. Oversails 160 mm both faces: the drip line under it is what turns
     the top of a wall into an edge you can see at distance, and at 90 mm it was
     not clearing the string course below it. */
  B.box(M.concrete, W, -0.06, run + 0.06, -t * 0.5 - 0.28, t * 0.5 + 0.16, H, H + 0.24,
    { us: IUV.concrete.us, vs: 0.35, wear, col: [0.86, 0.85, 0.81], nv: 1 });

  /* fighting step on the inside — a walkway 1.55 m below the top on corbels.
     It explains where the figures on the wall are standing, which is the only
     reason to have it. */
  if (o.step !== false) {
    const sy = H - 1.55;
    B.box(M.concrete, W, 0, run, t * 0.5, t * 0.5 + 1.35, sy, sy + 0.22,
      { us: IUV.concrete.us, vs: 0.4, wear, col: [0.66, 0.65, 0.62], nv: 1 });
    for (let i = 0; i <= n; i++) {
      const x = Math.min(run - 0.20, Math.max(0, i * bw - 0.20));
      B.box(M.concrete, W, x, x + 0.40, t * 0.5, t * 0.5 + 1.05, sy - 0.55, sy,
        { us: IUV.concrete.us, vs: 0.3, wear, col: [0.60, 0.59, 0.56], nu: 1, nv: 1 });
    }
  }

  /* gabion revetment banked against the outside foot of the wall. This is the
     single fastest way to stop a wall reading as a wall and start it reading
     as a defensive work, and it is what a real field position actually has. */
  if (o.hesco !== false) {
    hescoRun(B, W, M, 0.5, run - 0.5, -t * 0.5 - 0.72, -0.05, {
      wear, rand: o.rand, h: 1.15, d: 1.0,
      /* run-local x -> compound-local ground, so the revetment steps down the
         slope with the site instead of hanging off one datum */
      yAt: o.gAt ? (gx) => o.gAt(x0 + (dx / run) * gx, z0 + (dz / run) * gx) - 0.05 : null,
    });
  }
}

/**
 * Build the whole compound in world space.
 *
 * @param {{pos:THREE.Vector3, yaw:number}} site
 * @param {function} rand deterministic RNG
 * @param {object} M material map — keys concrete, rust, iron, bag, gravel, lamp
 * @param {function} [getH] world height query, for draping the yard surface
 * @returns {{ shell:Map, gate:Map, lamps:Array, posts:Array, gateAt:object }}
 */
export function buildYard(site, rand, M, getH) {
  const B = new Builder();
  const G = new Builder();
  const { halfX, halfZ, wallH, gateW } = YARD;

  /* Root frame: +x across the road, +z along it. See the header. */
  const F = new Frame(site.pos.x, site.pos.y, site.pos.z,
    Math.cos(site.yaw), -Math.sin(site.yaw));

  /*
   * GROUND, and the single most important number in this file.
   *
   * `gAt` gives compound-local ground height at any local (x, z). The wide shot
   * of the first build showed why it has to exist: everything was authored off
   * one datum — the road point the site was chosen at — and the measured
   * cross-fall under the footprint is 3.9 m over 52. So the uphill half of a
   * 5.4 m curtain was buried and only about two metres of wall stood above the
   * ground anywhere the player actually approaches from. The fortress read as a
   * kerb with towers behind it.
   *
   * The fix is what a real perimeter wall does on a slope: the COPING IS LEVEL
   * and the exposed height varies. Take the highest ground under the perimeter,
   * put the top of the wall 5.4 m above THAT, and let the downhill runs stand
   * taller. Nothing is ever shorter than the design height, the top is a single
   * unbroken horizontal from any angle, and the footings absorb the rest.
   */
  const gAt = getH
    ? (lx, lz) => { const w = F.p(lx, lz, 0); return getH(w[0], w[2]) - site.pos.y; }
    : () => 0;
  let hiG = 0;
  for (let i = -halfX; i <= halfX; i += 4) {
    hiG = Math.max(hiG, gAt(i, -halfZ), gAt(i, halfZ));
  }
  for (let j = -halfZ; j <= halfZ; j += 4) {
    hiG = Math.max(hiG, gAt(-halfX, j), gAt(halfX, j));
  }
  const wallTop = hiG + wallH;

  const wear = [0, wallTop + 2.0, 0.66, 0.32];
  B.wear = wear;

  /*
   * THE YARD SURFACE. Gravel, laid inside the walls.
   *
   * DRAPED, not flat. Measured cross-fall under this footprint is 3.9 m over
   * 52 metres, so a flat plate at the site elevation is buried at the high end
   * and floating at the low end by nearly two metres each — which is what a
   * graded pad would fix, except that `Terrain.addHeightOverride` is fill-only
   * and Compound cannot register one late enough to matter without burying the
   * road that runs through the gate. Following the ground is the honest answer
   * at this scale: a bulldozed yard is levelled, not benched, and 7% is what a
   * levelled yard on a hillside actually looks like.
   *
   * `quad`'s `warp` hook gets the height query per interpolated vertex, and
   * `step: 4` gives it a vertex every four metres to work with.
   */
  {
    const y0 = site.pos.y;
    const H = getH;
    const warp = H ? (u, v, p) => { p[1] = H(p[0], p[2]) + 0.09; } : null;
    const a = F.p(-halfX + 0.4, -halfZ + 0.4, 0.09);
    const b = F.p(halfX - 0.4, -halfZ + 0.4, 0.09);
    const c = F.p(halfX - 0.4, halfZ - 0.4, 0.09);
    const d = F.p(-halfX + 0.4, halfZ - 0.4, 0.09);
    B.quad(M.gravel, a, b, c, d, {
      us: IUV.gravel.us, vs: IUV.gravel.vs, wear, col: [0.60, 0.58, 0.54],
      step: 4, warp,
    });
    void y0;
  }

  /* ---- perimeter. The road enters on -Z and leaves on +Z, so the gap is in
     the +Z wall and the gate closes it. The back wall is solid: the way you
     came in is not the way out. */
  const ro = { wear, h: wallTop, rand, col: CONC, gAt };
  /*
   * WALK DIRECTION IS LWALL HANDEDNESS, and getting it backwards is silent.
   *
   * `Frame` derives its +z as +x rotated 90 degrees, so the direction a run is
   * walked in decides which face of that wall is "outside" as far as wallRun is
   * concerned. The first version walked the other way, which built every wall
   * INSIDE OUT: buttresses, proud panels, string course, embrasures and the
   * gabion revetment all ended up facing the parade ground, and the fighting
   * step and its corbels ended up on the approach.
   *
   * It is silent because the result is not broken, just wrong — from outside you
   * see a plain wall with a row of square lumps on it, which for four renders
   * read as "the buttresses are too subtle" rather than "the buttresses are on
   * the other side". Caught by measuring vertex distance from the wall
   * centreline rather than by looking at it: the fighting step sat 1.66 m proud
   * of the OUTER face and the buttresses 0.86 m proud of the inner one.
   *
   * So: every run is walked so that its -z is outward. Do not reorder these
   * without re-running that measurement.
   */
  wallRun(B, F, M, -halfX, halfZ, -halfX, -halfZ, ro);
  wallRun(B, F, M, -gateW * 0.5, halfZ, -halfX, halfZ, ro);
  wallRun(B, F, M, halfX, halfZ, gateW * 0.5, halfZ, ro);
  wallRun(B, F, M, halfX, -halfZ, halfX, halfZ, ro);
  wallRun(B, F, M, -halfX, -halfZ, halfX, -halfZ, ro);

  /* gate piers, heavier than the curtain either side of the opening */
  for (const s of [-1, 1]) {
    const px = s * (gateW * 0.5 + 0.55);
    B.box(M.concrete, F, px - 0.62, px + 0.62, halfZ - 0.75, halfZ + 0.75, -FOOT, wallTop + 0.62,
      { us: IUV.block.us, vs: IUV.block.vs, wear, col: [CONC[0] * 1.03, CONC[1] * 1.02, CONC[2] * 1.0] });
    B.box(M.concrete, F, px - 0.78, px + 0.78, halfZ - 0.92, halfZ + 0.92, wallTop + 0.62, wallTop + 0.86,
      { us: IUV.concrete.us, vs: 0.35, wear, col: [0.86, 0.85, 0.81], nv: 1 });
  }

  /* ---- corner towers. The first thing visible when the pass opens up. */
  const lamps = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (halfX - 2.6), z = sz * (halfZ - 2.6);
    /* Turn each tower so its +z — and therefore its lamp arm and its ladder —
       faces out along the diagonal. Four lights all aimed at the same corner of
       the yard would leave the other three dark. */
    const k = Math.SQRT1_2;
    const T = F.sub(x, z, 0, Math.atan2(-sx * k, sz * k));
    const tg = gAt(x, z);
    const r = guardTower(B, T, M, { h: 15.5 + (hiG - tg), r: 1.55, rand, ground: tg });
    lamps.push({ x: x + sx * k * r.lampZ, z: z + sz * k * r.lampZ, y: r.lampY });
  }

  /* ---- inner buildings. Roof lines deliberately just over the curtain: the
     interior is most of what makes a compound look occupied, and at 3.4 m under
     a 5.4 m wall none of it was visible from any approach angle. */
  const barracks = F.sub(-16.5, -12.0, 0, 0);
  buildBlockhouse(B, barracks, M, {
    w: 13, d: 7.5, h: 6.2, bay: 3.25, roof: 'iron', ground: gAt(-10, -8),
    bays: ['vent', 'door', 'vent', 'vent'], grime: 0.66,
  }, rand);

  const depot = F.sub(7.5, -11.0, 0, 0);
  buildBlockhouse(B, depot, M, {
    w: 11, d: 9.0, h: 6.6, bay: 5.5, roof: 'flat', ground: gAt(13, -6),
    bays: ['shutter', 'vent'], shutterOpen: 0.62, grime: 0.72, bags: false,
  }, rand);

  /* the radio mast off the depot — the tallest thing in the valley after the
     towers, and the silhouette that identifies the place from a ridge */
  latticeMast(B, F, M, 20.5, -4.0, gAt(20.5, -4.0), 17.5, { wear: [0, 18, 0.6, 0.3] });

  /* ---- yard plant. Fuel bowsers against the depot, drums, a generator. */
  for (let i = 0; i < 3; i++) {
    const bz = -9.5 + i * 3.4;
    const by = gAt(4.2, bz);
    B.box(M.rust, F, 3.4, 5.0, bz - 0.75, bz + 0.75, by + 0.12, by + 2.05,
      { us: IUV.steel.us, vs: IUV.steel.vs, wear, col: [0.46, 0.48, 0.44] });
    B.box(M.rust, F, 3.3, 5.1, bz - 0.86, bz + 0.86, by + 2.05, by + 2.22,
      { us: 0.4, vs: 0.3, wear, col: [0.40, 0.42, 0.39], nv: 1 });
  }
  const gy = gAt(-0.9, 7.0);
  B.box(M.iron, F, -2.6, 0.8, 6.0, 8.0, gy, gy + 1.35,
    { us: IUV.iron.us, vs: IUV.iron.vs, wear, col: [0.54, 0.55, 0.50] });
  B.box(M.rust, F, -2.7, 0.9, 5.9, 8.1, gy + 1.35, gy + 1.50,
    { us: 0.4, vs: 0.3, wear, col: [0.44, 0.44, 0.41], nv: 1 });
  B.tube(M.rust, F.p(0.2, 7.9, gy + 1.5), F.p(0.2, 7.9, gy + 2.6), 0.075, 0.070, 6,
    { us: 0.3, vs: 0.5, wear, col: [0.46, 0.42, 0.36], caps: true });
  for (const [dx, dz] of [[-5.2, 8.4], [-4.4, 9.1], [-5.9, 9.3], [13.5, 6.2], [14.4, 6.9]]) {
    drum(B, F, M, dx, dz, gAt(dx, dz) + 0.06, { wear, col: rand() > 0.5 ? [0.42, 0.46, 0.40] : [0.50, 0.36, 0.26] });
  }

  /* ---- fighting positions the garrison holds, and where they stand. */
  const posts = [];
  for (const [px, pz] of [[-14, 12], [14, 12], [-7, 2], [9, 3], [0, -14]]) {
    const jx = px + (rand() - 0.5) * 2.4, jz = pz + (rand() - 0.5) * 2.4;
    const py = gAt(jx, jz);
    const P = F.sub(jx, jz, 0, 0);
    sandbagCourse(B, P, M, -2.5, 2.5, 1.15, py + 0.02, { wear, rand, rows: 4 });
    sandbagCourse(B, P, M, -2.5, -1.7, 0.30, py + 0.02, { wear, rand, rows: 4 });
    sandbagCourse(B, P, M, 1.7, 2.5, 0.30, py + 0.02, { wear, rand, rows: 4 });
    posts.push({ x: jx, z: jz });
  }

  /* ---- THE GATE, in its own builder so the whole thing can be raised. Built
     about the gate's own origin; the caller places the group. */
  const GF = new Frame(0, 0, 0, 1, 0);
  /* The leaves span from the road surface under the opening up to the same
     level coping as the wall, so a gate on a slope is a taller gate — which is
     what the hinges would actually have to carry. */
  const gBase = gAt(0, halfZ) - 0.06;
  const gateH = wallTop - gBase;
  const gw = [gBase, wallTop + 1.0, 0.72, 0.40];
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 0.05 : -gateW * 0.5;
    const x1 = s > 0 ? gateW * 0.5 : -0.05;
    /* frame: a heavy perimeter angle with a corrugated infill and one diagonal
       brace, which is what a fabricated gate leaf actually is */
    const fc = { us: IUV.steel.us, vs: 0.35, wear: gw, col: [0.40, 0.41, 0.40], nv: 1 };
    G.box(M.rust, GF, x0, x1, -0.10, 0.10, gBase, gBase + 0.22, fc);
    G.box(M.rust, GF, x0, x1, -0.10, 0.10, wallTop - 0.22, wallTop, fc);
    G.box(M.rust, GF, x0, x0 + 0.20, -0.10, 0.10, gBase, wallTop, fc);
    G.box(M.rust, GF, x1 - 0.20, x1, -0.10, 0.10, gBase, wallTop, fc);
    G.box(M.iron, GF, x0 + 0.18, x1 - 0.18, -0.045, 0.045, gBase + 0.20, wallTop - 0.20,
      { us: IUV.iron.us, vs: IUV.iron.vs, rot: 1, wear: gw, col: [0.56, 0.55, 0.51] });
    G.tube(M.rust, GF.p(x0 + 0.2, -0.11, gBase + 0.25), GF.p(x1 - 0.2, -0.11, wallTop - 0.25),
      0.055, 0.055, 4, { us: 0.4, vs: 0.5, wear: gw, col: [0.44, 0.45, 0.44] });
    /* a hazard chevron band across the middle of each leaf */
    G.box(M.rust, GF, x0 + 0.18, x1 - 0.18, -0.075, -0.05,
      gBase + gateH * 0.44, gBase + gateH * 0.60,
      { us: 0.5, vs: 0.25, wear: gw, col: [0.78, 0.62, 0.16], nv: 1 });
  }

  return {
    shell: B.build(),
    gate: G.build(),
    lamps,
    posts,
    gateAt: { x: 0, z: halfZ, y: 0 },
    gateH,
    wallTop,
    stats: B.stats(),
  };
}

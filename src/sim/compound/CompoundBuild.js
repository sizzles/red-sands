import * as THREE from 'three';

/**
 * BROKEN ROAD — THE COMPOUND, AS GEOMETRY
 * ============================================================================
 * The Cordon's own position at the head of the pass, built across the only road
 * out of the valley. Everything about the shape is trying to say one thing from
 * a long way off: *this is not a checkpoint, and you are not going to ride
 * through it.*
 *
 * The checkpoints out on the highway are staggered barriers with a line through
 * them at walking pace, because their job is to slow you down and tax you. This
 * closes the road completely. That difference has to be legible at the moment
 * the player first crests the pass and sees it, because that is the moment the
 * game asks its only real question: are you ready yet?
 *
 * So the silhouette is built out of things checkpoints do not have — a
 * continuous wall, corner towers taller than anything else in the valley, and
 * floodlights that are on at every hour. Local space has +Z along the road,
 * origin on the road at the gate line.
 * ============================================================================
 */

/** Footprint. Wide enough that riding round it is a decision, not a reflex. */
/*
 * Footprint and scale. Wide enough that riding round it is a decision, not a
 * reflex — and TALL enough to be a fortress rather than a stock pen.
 *
 * The first build put a 4.2 m wall under an 8.4 m tower, which is a two-to-one
 * ratio, and at the hundred metres the player first sees this from that reads
 * as a fence with posts in it. Real defensive works run their towers at three
 * times the curtain so the tower is unmistakably the thing that watches and the
 * wall is unmistakably the thing that stops you. 5.4 and 15.5 gets that, and it
 * also lifts the tower tops clear of a mature treeline, which is what makes the
 * compound visible from the pass at all.
 */
export const YARD = { halfX: 26, halfZ: 20, wallH: 5.4, gateW: 9.0 };

function boxAt(out, w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  out.push(g);
}

function merge(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * @returns {{ shell:THREE.BufferGeometry, gate:THREE.BufferGeometry,
 *             lamps:Array<THREE.Vector3>, posts:Array<{x:number,z:number}> }}
 *   `gate` is separate so it can be animated open; `lamps` are where the
 *   floodlights go; `posts` are where the garrison stands.
 */
export function buildCompound(rand) {
  const S = [];
  const G = [];
  const { halfX, halfZ, wallH, gateW } = YARD;

  /* --- perimeter. The road enters on -Z and leaves on +Z, so the gap is in
     the +Z wall and the gate closes it.
   *
   * FOOTINGS. Every wall and tower runs FOOT metres below y = 0 rather than
   * sitting on it. This is one rigid mesh dropped on a heightfield, so any
   * cross-fall under the 54 x 42 m footprint leaves the downhill end hanging in
   * the air — which is exactly what the first build did, visibly, from a
   * hundred metres away. Burying the base absorbs the fall instead: the
   * underground part is never seen, and the wall meets the ground everywhere.
   * Site selection is tightened alongside this (see Compound._pickSite), so the
   * footings only have to cover what the rejection lets through. */
  const t = 0.5;                                  // wall thickness
  const FOOT = 5.0;                               // buried depth
  const wh = wallH + FOOT;                        // total built height
  const wy = wallH * 0.5 - FOOT * 0.5;            // centre, so the top stays put
  /* side walls */
  boxAt(S, t, wh, halfZ * 2, -halfX, wy, 0);
  boxAt(S, t, wh, halfZ * 2, halfX, wy, 0);
  /* back wall, solid — the way you came in is not the way out */
  boxAt(S, halfX * 2, wh, t, 0, wy, -halfZ);
  /* front wall either side of the gate opening */
  const seg = halfX - gateW * 0.5;
  boxAt(S, seg, wh, t, -(gateW * 0.5 + seg * 0.5), wy, halfZ);
  boxAt(S, seg, wh, t, (gateW * 0.5 + seg * 0.5), wy, halfZ);

  /* --- PARAPET AND FIGHTING STEP. Two bands running the whole perimeter: a
     cap that overhangs the curtain, and a walkway a metre and a half below the
     top on the inside. Neither is structural and both are cheap, but together
     they are what makes the wall read as MANNED rather than as an extruded
     rectangle — the cap gives the silhouette a hard top edge with a shadow
     under it, and the walkway explains where the figures on top are standing. */
  const capY = wallH + 0.22;
  const walkY = wallH - 1.55;
  const capT = t * 2.6, capH = 0.44;
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1]]) {
    const w = sx ? capT : halfX * 2 + capT;
    const d = sz ? capT : halfZ * 2;
    boxAt(S, w, capH, d, sx * halfX, capY, sz * halfZ);
    /* walkway, inboard */
    boxAt(S, sx ? 1.9 : halfX * 2 - 3.8, 0.24, sz ? 1.9 : halfZ * 2 - 3.8,
      sx * (halfX - 1.2), walkY, sz * (halfZ - 1.2));
  }
  /* the front wall's cap is broken by the gate opening */
  for (const s of [-1, 1]) {
    boxAt(S, seg, capH, capT, s * (gateW * 0.5 + seg * 0.5), capY, halfZ);
    boxAt(S, seg - 1.0, 0.24, 1.9, s * (gateW * 0.5 + seg * 0.5), walkY, halfZ - 1.2);
  }

  /* --- corner towers. Taller than the treeline, which is the point: this is
     the first thing visible when the pass opens up, from a kilometre out. */
  const lamps = [];
  const TH = 15.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (halfX - 1.2), z = sz * (halfZ - 1.2);
    boxAt(S, 3.4, TH + FOOT, 3.4, x, TH * 0.5 - FOOT * 0.5, z);
    boxAt(S, 5.2, 0.35, 5.2, x, TH + 0.18, z);          // platform
    /* rail, all four sides — at this height the platform is a silhouette and a
       two-sided rail is visibly missing from half the angles it is seen at */
    boxAt(S, 5.2, 1.0, 0.18, x, TH + 0.68, z - 2.5);
    boxAt(S, 5.2, 1.0, 0.18, x, TH + 0.68, z + 2.5);
    boxAt(S, 0.18, 1.0, 5.2, x - 2.5, TH + 0.68, z);
    boxAt(S, 0.18, 1.0, 5.2, x + 2.5, TH + 0.68, z);
    /* a shallow roof over the post: the one shape that says someone lives up
       there through the weather this valley gets */
    boxAt(S, 5.8, 0.28, 5.8, x, TH + 1.42, z);
    lamps.push(new THREE.Vector3(x, TH + 0.9, z));
  }

  /* --- inner buildings: a barracks and the depot the fuel is in. */
  /* Roof lines deliberately just OVER the curtain: the interior is most of
     what makes a compound look occupied, and at 3.4 m under a 5.4 m wall none
     of it was visible from outside at any approach angle. */
  boxAt(S, 13, 6.2 + 3, 7.5, -10, 3.1 - 1.5, -8);
  boxAt(S, 14, 0.35, 8.5, -10, 6.35, -8);
  boxAt(S, 9, 6.8 + 3, 9.0, 12, 3.4 - 1.5, -6);
  boxAt(S, 10, 0.35, 10, 12, 6.95, -6);
  /* a radio mast off the depot — one thin vertical, and the tallest thing in
     the valley after the towers */
  boxAt(S, 0.34, 13.5, 0.34, 15.5, 6.75, -2.5);
  boxAt(S, 2.2, 0.16, 0.22, 15.5, 12.6, -2.5);
  /* fuel bowsers against the depot */
  for (let i = 0; i < 3; i++) {
    boxAt(S, 1.1, 1.9, 1.1, 6.0, 0.95, -10 + i * 3.2);
  }

  /* --- sandbag positions the garrison fights from, plus where they stand. */
  const posts = [];
  for (const [px, pz] of [[-13, 11], [13, 11], [-6, 2], [8, 3], [0, -12]]) {
    const jx = px + (rand() - 0.5) * 2, jz = pz + (rand() - 0.5) * 2;
    boxAt(S, 5.0, 0.95, 0.9, jx, 0.48, jz + 1.4);
    posts.push({ x: jx, z: jz });
  }

  /* --- THE GATE. Two leaves meeting on the road centreline. Built about
     y = 0 so the whole geometry can simply be raised to open. */
  for (const s of [-1, 1]) {
    boxAt(G, gateW * 0.5, wallH, 0.35, s * gateW * 0.25, wallH * 0.5, halfZ);
    /* diagonal brace, because a flat slab reads as a wall not a gate */
    boxAt(G, gateW * 0.54, 0.30, 0.42, s * gateW * 0.25, wallH * 0.5, halfZ, 0);
  }

  return { shell: merge(S), gate: merge(G), lamps, posts };
}

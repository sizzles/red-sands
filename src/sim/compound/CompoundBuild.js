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
export const YARD = { halfX: 26, halfZ: 20, wallH: 4.2, gateW: 9.0 };

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
     the +Z wall and the gate closes it. */
  const t = 0.5;                                  // wall thickness
  /* side walls */
  boxAt(S, t, wallH, halfZ * 2, -halfX, wallH * 0.5, 0);
  boxAt(S, t, wallH, halfZ * 2, halfX, wallH * 0.5, 0);
  /* back wall, solid — the way you came in is not the way out */
  boxAt(S, halfX * 2, wallH, t, 0, wallH * 0.5, -halfZ);
  /* front wall either side of the gate opening */
  const seg = halfX - gateW * 0.5;
  boxAt(S, seg, wallH, t, -(gateW * 0.5 + seg * 0.5), wallH * 0.5, halfZ);
  boxAt(S, seg, wallH, t, (gateW * 0.5 + seg * 0.5), wallH * 0.5, halfZ);

  /* --- corner towers. Taller than the treeline, which is the point: this is
     the first thing visible when the pass opens up, from a kilometre out. */
  const lamps = [];
  const TH = 8.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (halfX - 1.2), z = sz * (halfZ - 1.2);
    boxAt(S, 3.4, TH, 3.4, x, TH * 0.5, z);
    boxAt(S, 4.4, 0.35, 4.4, x, TH + 0.18, z);          // platform
    /* rail */
    boxAt(S, 4.4, 0.9, 0.16, x, TH + 0.62, z - 2.1);
    boxAt(S, 4.4, 0.9, 0.16, x, TH + 0.62, z + 2.1);
    lamps.push(new THREE.Vector3(x, TH + 0.9, z));
  }

  /* --- inner buildings: a barracks and the depot the fuel is in. */
  boxAt(S, 13, 3.4, 7.5, -10, 1.7, -8);
  boxAt(S, 14, 0.35, 8.5, -10, 3.55, -8);
  boxAt(S, 9, 4.0, 9.0, 12, 2.0, -6);
  boxAt(S, 10, 0.35, 10, 12, 4.15, -6);
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

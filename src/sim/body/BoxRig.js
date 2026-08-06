import * as THREE from 'three';

/**
 * BROKEN ROAD — THE BOX RIG
 * ============================================================================
 * The shared skeleton builder behind every humanoid in the world: the Riven and
 * the Cordon. Both were carrying their own byte-identical copy of this class,
 * which is how they drifted apart, so it lives here once.
 *
 * A figure is a set of TAPERED BOXES merged into one geometry. Every vertex
 * carries three things beyond its position:
 *
 *   aPart    which limb it belongs to, as a float the vertex shader branches on
 *   aPivot   the joint that limb swings on
 *   aPivot2  that joint's PARENT, for the second bone of a two-bone chain
 *
 * so an entire run cycle happens in the vertex shader and a hundred figures cost
 * one draw call. There is no bone palette, no skinning matrix and no per-frame
 * CPU work beyond writing an instance matrix and four floats.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO PIVOTS
 *
 * With one pivot per vertex a limb is a rigid pendulum. It has no knee and no
 * elbow, so every degree of swing past about 45 stops reading as a stride and
 * starts reading as the leg coming off — which caps the animation at an
 * amplitude too small to be legible at the distance these are actually seen
 * from. Carrying the parent joint as well makes a two-link chain out of two
 * rotations applied in order, child first:
 *
 *     p = rotate(p, aPivot,  knee)      // the shin folds under
 *     p = rotate(p, aPivot2, hip)       // the whole leg swings
 *
 * which is forward kinematics for the only case that matters here, at the cost
 * of twelve bytes a vertex and one extra rotate.
 *
 * ---------------------------------------------------------------------------
 * WHY VERTEX COLOUR
 *
 * These figures share a world with trees carrying baked bark maps, normal maps
 * and per-instance tint. A single flat material colour over a whole body makes
 * them the only untextured object on screen, and the eye goes straight to it.
 * Baking tone into the vertices — joints darkened, cloth dark, flesh mottled —
 * costs twelve more bytes a vertex, no texture memory, and no shader work at
 * all: three.js multiplies the `color` attribute in natively via `vertexColors`,
 * and it composes with `InstancedMesh.setColorAt` and the material colour to
 * give a clean three-layer split — species, individual, anatomy.
 *
 * The tones below are RATIOS around 1.0, not albedos. `normaliseTones` divides
 * the finished array through by its own mean luminance, so adding shadow to a
 * recipe never quietly darkens the whole creature.
 * ============================================================================
 */

/** Relative tones. Ratios on the per-type material colour, never albedos. */
export const TONES = {
  FLESH: [1.00, 1.00, 1.00],
  NECRO: [0.74, 0.82, 0.78],   // dead tissue: green-grey, never green
  RAGS: [0.40, 0.38, 0.42],   // what is left of the clothes
  HAIR: [0.26, 0.24, 0.23],
  MAW: [1.12, 0.52, 0.46],
  SKIN: [1.06, 0.92, 0.80],   // living, under a helmet
  DRAB: [0.82, 0.84, 0.74],   // uniform
  WEBBING: [0.52, 0.53, 0.48],   // plate carrier, pouches, straps
  STEEL: [0.34, 0.35, 0.37],   // weapon, helmet shell
};

/** Deterministic value hash. Not `Math.random` — captures have to reproduce. */
export function mot1(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Point a fraction `t` of the way from a to b. */
export const lerpV = (a, b, t) => a.clone().lerp(b, t);

/**
 * Renormalise a baked vertex-colour array to unit mean luminance.
 *
 * Every tone above can only ever remove light — joint darkening, mottle, cloth —
 * so a body built from them comes out about a fifth darker than the colour its
 * system chose for the species. Dividing through by the MEASURED mean puts the
 * average back exactly where it was and keeps the variation, which is the whole
 * point of baking it. Measuring rather than hand-tuning a constant means the
 * recipes can be edited freely without the types drifting apart in brightness.
 */
export function normaliseTones(col) {
  let sum = 0;
  for (let i = 0; i < col.length; i += 3) {
    sum += col[i] * 0.2126 + col[i + 1] * 0.7152 + col[i + 2] * 0.0722;
  }
  const mean = sum / (col.length / 3);
  if (!(mean > 1e-4)) return;
  const k = 1 / mean;
  for (let i = 0; i < col.length; i++) col[i] *= k;
}

export class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = [];
    this.part = []; this.pivot = []; this.piv2 = []; this.idx = [];
  }

  /**
   * A tapered box between two end centres. `wa/ha` and `wb/hb` are the half
   * width (Z) and half height (Y) at each end.
   *
   * @param {object} [o]
   *   o.tone  relative RGB for this box (default flesh)
   *   o.ao    [at a, at b] darkening, for packing shadow into the joints
   *   o.mot   mottle depth — how much per-vertex noise breaks the flat faces
   *   o.p2    parent joint, for the second bone of a two-bone chain
   */
  box(a, b, wa, ha, wb, hb, part, pivot, o) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.multiplyScalar(1 / len);
    let up = Math.abs(dir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    up = new THREE.Vector3().crossVectors(dir, right).normalize();

    const tone = (o && o.tone) || TONES.FLESH;
    const aoA = o && o.ao ? o.ao[0] : 1.0;
    const aoB = o && o.ao ? o.ao[1] : 1.0;
    const mot = o && o.mot != null ? o.mot : 0.16;
    const p2 = (o && o.p2) || pivot;

    const base = this.pos.length / 3;
    for (const [c, w, h] of [[a, wa, ha], [b, wb, hb]]) {
      const ao = (c === a) ? aoA : aoB;
      for (let k = 0; k < 4; k++) {
        const sx = (k === 0 || k === 3) ? -1 : 1;
        const sy = (k < 2) ? -1 : 1;
        const p = c.clone().addScaledVector(right, w * sx).addScaledVector(up, h * sy);
        this.pos.push(p.x, p.y, p.z);
        const n = right.clone().multiplyScalar(sx).addScaledVector(up, sy).normalize();
        this.nrm.push(n.x, n.y, n.z);
        this.uv.push((c === a) ? 0 : 1, k * 0.25);
        this.part.push(part);
        this.pivot.push(pivot.x, pivot.y, pivot.z);
        this.piv2.push(p2.x, p2.y, p2.z);
        /* Mottle is sampled in OBJECT space at a ~11 cm period, so the patches
           are body-scale blotches rather than per-face flicker, and two
           vertices meeting at a joint agree with each other. */
        const m = 1.0 - mot * mot1(p.x * 9.1, p.y * 9.1, p.z * 9.1);
        this.col.push(tone[0] * ao * m, tone[1] * ao * m, tone[2] * ao * m);
      }
    }
    const q = (i0, i1, i2, i3) => this.idx.push(base + i0, base + i1, base + i2,
      base + i0, base + i2, base + i3);
    q(0, 1, 5, 4); q(1, 2, 6, 5); q(2, 3, 7, 6); q(3, 0, 4, 7);
    q(3, 2, 1, 0); q(4, 5, 6, 7);
  }

  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    /* Named `color` on purpose: three.js picks it up through `vertexColors`
       with no shader work of ours. */
    normaliseTones(this.col);
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pivot, 3));
    g.setAttribute('aPivot2', new THREE.Float32BufferAttribute(this.piv2, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Give an InstancedMesh a per-individual colour.
 *
 * A pack of eight identical clones is the other half of why these read as
 * placeholders — trees have varied in tint since the first pass and the figures
 * never did. Kept narrow deliberately: this is meant to look like different
 * people in different light, not like a bag of sweets.
 *
 * @param {THREE.InstancedMesh} mesh
 * @param {function} rand deterministic RNG
 * @param {number} [spread] how far the value wanders, 0..1
 */
export function varyInstanceColour(mesh, rand, spread = 0.30) {
  const c = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    const v = 1.0 - spread * 0.5 + rand() * spread;
    const warm = 0.95 + rand() * 0.11;
    c.setRGB(v * warm, v * (0.98 + rand() * 0.05), (v / warm) * (0.97 + rand() * 0.06));
    mesh.setColorAt(i, c);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

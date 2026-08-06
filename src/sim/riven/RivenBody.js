import * as THREE from 'three';

/**
 * BROKEN ROAD — THE RIVEN, AS GEOMETRY
 * ============================================================================
 * Bipeds built the same way the wildlife is: a handful of tapered boxes merged
 * into one geometry, with every vertex carrying which limb it belongs to
 * (`aPart`) and the joint that limb swings on (`aPivot`), so the whole run
 * cycle can happen in the vertex shader and a hundred of them cost one draw
 * call.
 *
 * Object space: +X forward (the way it is facing), +Y up, +Z to its left.
 * Origin on the ground between the feet. Metres, and honest ones — the silhouette
 * against a treeline at eighty metres is the only warning the player gets, so
 * the three types have to be distinguishable by shape alone.
 *
 * THE THREE SHAPES
 *   stray    1.62 m. Human height, but pitched forward from the hips with the
 *            arms hanging low, so the head leads the body. It is the wrong
 *            posture for a person and right for something that runs on the
 *            edge of falling over, and it is what reads at distance.
 *   skitter  0.85 m, on all fours, long arms. Reads as an animal until it is
 *            far too close, which is the entire point of it.
 *   harrow   2.15 m and twice the mass through the shoulders, with a low head
 *            carried between them. Slow, and worth running from.
 * ============================================================================
 */

export const PART = {
  TORSO: 0, HEAD: 1, ARM_L: 2, ARM_R: 3, LEG_L: 4, LEG_R: 5,
};

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = [];
    this.part = []; this.pivot = []; this.idx = [];
  }

  /**
   * A tapered box between two end centres. `wa/ha` and `wb/hb` are the half
   * width (Z) and half height (Y) at each end.
   */
  box(a, b, wa, ha, wb, hb, part, pivot) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.multiplyScalar(1 / len);
    let up = Math.abs(dir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    up = new THREE.Vector3().crossVectors(dir, right).normalize();

    const base = this.pos.length / 3;
    for (const [c, w, h] of [[a, wa, ha], [b, wb, hb]]) {
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
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pivot, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * @param {string} kind stray | skitter | harrow
 * @param {function} r deterministic RNG — the asymmetry it produces is per
 *        TYPE, not per instance, so it costs nothing and still stops the three
 *        shapes reading as anatomy charts.
 */
export function buildRiven(kind, r) {
  const b = new Builder();

  if (kind === 'skitter') {
    /* On all fours. The spine is nearly horizontal and the shoulders are the
       highest point, which is exactly the profile of a big dog — and the
       player's first read on this thing being an animal is a mistake the shape
       is deliberately engineering. */
    const hipY = 0.46, shoY = 0.54;
    b.box(V(-0.30, hipY, 0), V(0.26, shoY, 0), 0.115, 0.105, 0.135, 0.115, PART.TORSO, V(0, hipY, 0));
    b.box(V(0.26, shoY, 0), V(0.50, shoY - 0.04, 0), 0.085, 0.078, 0.062, 0.058, PART.HEAD, V(0.26, shoY, 0));
    for (const [s, part] of [[1, PART.ARM_L], [-1, PART.ARM_R]]) {
      const px = 0.22, pz = s * 0.105;
      b.box(V(px, shoY - 0.02, pz), V(px + 0.06, 0.0, pz * 1.15), 0.048, 0.048, 0.036, 0.036, part, V(px, shoY - 0.02, pz));
    }
    for (const [s, part] of [[1, PART.LEG_L], [-1, PART.LEG_R]]) {
      const px = -0.26, pz = s * 0.095;
      b.box(V(px, hipY - 0.02, pz), V(px - 0.02, 0.0, pz * 1.1), 0.052, 0.052, 0.038, 0.038, part, V(px, hipY - 0.02, pz));
    }
    return b.finish();
  }

  const harrow = kind === 'harrow';
  /* Proportions. A harrow is not just a scaled stray — it is far wider
     through the chest and shorter in the neck, which is what makes it read as
     heavy rather than as a big man. */
  const H = harrow ? 2.15 : 1.62;
  const hipY = H * 0.50;
  const shoY = H * 0.83;
  const chestW = harrow ? 0.30 : 0.185;
  const chestD = harrow ? 0.20 : 0.135;

  /* Torso, pitched forward. `lean` moves the shoulders ahead of the hips in X,
     and it is the whole silhouette: a person stands with them stacked. */
  const lean = harrow ? 0.24 : 0.17;
  b.box(V(0, hipY, 0), V(lean, shoY, 0),
    harrow ? 0.19 : 0.135, harrow ? 0.15 : 0.115, chestW, chestD,
    PART.TORSO, V(0, hipY, 0));

  /* Head, dropped forward and down off the shoulders. */
  const neck = harrow ? 0.06 : 0.11;
  b.box(V(lean + 0.02, shoY + neck, 0), V(lean + (harrow ? 0.20 : 0.17), shoY + neck * (harrow ? 0.4 : 0.7), 0),
    harrow ? 0.115 : 0.090, harrow ? 0.110 : 0.088,
    harrow ? 0.085 : 0.062, harrow ? 0.090 : 0.070,
    PART.HEAD, V(lean, shoY, 0));

  /* Arms, long and hanging. The stray's fingertips reach below its knees,
     which no healthy human's do, and it is one of the cheapest tells there is. */
  const armLen = harrow ? H * 0.52 : H * 0.47;
  for (const [s, part] of [[1, PART.ARM_L], [-1, PART.ARM_R]]) {
    const px = lean - 0.01, pz = s * (chestW + 0.035);
    const swing = 0.10 + r() * 0.06;
    b.box(V(px, shoY - 0.04, pz), V(px - swing, shoY - 0.04 - armLen, pz * 1.12),
      harrow ? 0.072 : 0.050, harrow ? 0.072 : 0.050,
      harrow ? 0.052 : 0.034, harrow ? 0.052 : 0.034,
      part, V(px, shoY - 0.04, pz));
  }

  /* Legs. */
  for (const [s, part] of [[1, PART.LEG_L], [-1, PART.LEG_R]]) {
    const pz = s * (harrow ? 0.115 : 0.082);
    b.box(V(0, hipY - 0.02, pz), V(0.02, 0.0, pz * 1.05),
      harrow ? 0.090 : 0.062, harrow ? 0.090 : 0.062,
      harrow ? 0.058 : 0.042, harrow ? 0.058 : 0.042,
      part, V(0, hipY - 0.02, pz));
  }
  return b.finish();
}

/* ------------------------------------------------------------------ shader */

export const RIVEN_PARS = /* glsl */`
attribute float aPart;
attribute vec3  aPivot;
attribute vec4  aAnim;

vec3 rvRotZ(vec3 p, vec3 pivot, float a) {
  vec3 d = p - pivot;
  float c = cos(a), s = sin(a);
  return pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
}
vec3 rvRotX(vec3 p, vec3 pivot, float a) {
  vec3 d = p - pivot;
  float c = cos(a), s = sin(a);
  return pivot + vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}
`;

/**
 * The run cycle.
 *
 *   aAnim.x  phase in radians, advanced by DISTANCE TRAVELLED on the CPU so
 *            the feet never skate when the thing changes speed
 *   aAnim.y  0..1 how much of the cycle to apply — 0 while standing
 *   aAnim.z  aggression 0..1: how far forward it is pitched and how wide the
 *            arms are thrown. This is the single channel that carries the
 *            difference between shambling and charging.
 *   aAnim.w  death 0..1 — collapses the whole body toward the ground
 */
export const RIVEN_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
{
  float ph   = aAnim.x;
  float gait = aAnim.y;
  float rage = aAnim.z;
  float dead = aAnim.w;
  float part = aPart + 0.5;

  if (part > 3.0) {
    /* ---- legs: a run, not a walk ------------------------------------
       The two differ in DUTY CYCLE, not in amplitude. A walk always has a
       foot down; a run has a flight phase, so the swing is fast and the
       stance is slow. Skewing the sine with its own square gives that
       asymmetry for one multiply, and it is what stops the gait reading
       as a pendulum. */
    float off = (part < 5.0) ? 0.0 : 3.14159265;
    float s = sin(ph + off);
    float swing = (s * 0.62 + s * abs(s) * 0.30) * (0.18 + gait * (0.72 + rage * 0.42));
    vec3 d = transformed - aPivot;
    float c = cos(swing), sn = sin(swing);
    transformed = aPivot + vec3(d.x * c - d.y * sn, d.x * sn + d.y * c, d.z);
    /* Lift the trailing foot rather than the leading one. */
    transformed.y += max(0.0, -s) * gait * 0.16 * max(0.0, -d.y);
  } else if (part > 1.0) {
    /* ---- arms: counter-swing, and thrown wide when it is charging ---- */
    float off = (part < 3.0) ? 3.14159265 : 0.0;
    float s = sin(ph + off);
    float swing = s * (0.22 + gait * 0.85) * (1.0 + rage * 0.55);
    transformed = rvRotZ(transformed, aPivot, swing);
    /* Reaching: the arms come UP and OUT as it closes, which is the last
       thing the player sees before it is on them. */
    transformed = rvRotX(transformed, aPivot, (part < 3.0 ? 1.0 : -1.0) * rage * 0.55);
    transformed.x += rage * 0.16 * max(0.0, aPivot.y - transformed.y);
  } else if (part > 0.0) {
    /* ---- head: lolls with the stride, and snaps level when it hunts -- */
    float bob = sin(ph * 2.0) * 0.10 * gait;
    transformed = rvRotZ(transformed, aPivot, bob * (1.0 - rage) - rage * 0.30);
    transformed = rvRotX(transformed, aPivot, sin(ph) * 0.14 * gait * (1.0 - rage));
  } else {
    /* ---- torso: pitch forward with aggression, and bounce with the run */
    transformed = rvRotZ(transformed, aPivot, rage * 0.26);
    transformed.y += sin(ph * 2.0) * 0.035 * gait;
  }

  /* ---- death: fold forward and sink. One channel, because a corpse only
     has to stop being a silhouette; anything more elaborate is invisible
     at the ranges these are actually shot at. */
  if (dead > 0.001) {
    transformed = rvRotZ(transformed, vec3(0.0), dead * 1.48);
    transformed.y -= dead * 0.12;
  }
}
`;

/**
 * Patch a standard material to run the cycle. Same trick Wildlife uses: splice
 * the attributes into the pars block and replace three.js's `begin_vertex`
 * chunk wholesale, so the rest of the standard pipeline (shadows, fog, aerial
 * perspective injection) is untouched.
 */
export function patchRivenAnim(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIVEN_PARS)
      .replace('#include <begin_vertex>', RIVEN_BEGIN);
  };
  mat.customProgramCacheKey = () => 'rivenAnim';
}

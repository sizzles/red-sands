import * as THREE from 'three';

/**
 * BROKEN ROAD — THE CORDON, AS GEOMETRY
 * ============================================================================
 * Armed humans, built the same way everything else alive in this world is: a
 * handful of tapered boxes merged into one geometry, every vertex carrying
 * which limb it belongs to (`aPart`) and the joint it swings on (`aPivot`), so
 * the whole cycle runs in the vertex shader and forty of them cost one draw
 * call.
 *
 * THE SILHOUETTE PROBLEM, AND THE ONE RULE THAT SOLVES IT
 * There are now two kinds of humanoid in this world trying to kill you, and at
 * the range where you must decide what to do about them — eighty metres, in
 * rain, from a moving bike — they are both a dark upright smudge. If the player
 * cannot tell them apart instantly, every encounter becomes a coin flip, and
 * the two need completely opposite responses: you can outrun the Riven on the
 * road, and you cannot outrun a rifle.
 *
 * So the distinction is postural and absolute:
 *
 *   THE RIVEN LEAN.    Pitched forward from the hips, head ahead of the body,
 *                      arms hanging low. Something running on the edge of
 *                      falling over.
 *   THE CORDON STAND.  Vertical. Shoulders square and level, head up and back,
 *                      and a horizontal bar across the chest where the rifle
 *                      is. That last one does most of the work: it is the only
 *                      horizontal line on any figure in the game, and the eye
 *                      picks it out long before it can resolve a face.
 *
 * Object space: +X forward, +Y up, +Z to its left. Origin on the ground between
 * the feet. Metres.
 * ============================================================================
 */

export const PART = {
  TORSO: 0, HEAD: 1, ARM_L: 2, ARM_R: 3, LEG_L: 4, LEG_R: 5, RIFLE: 6,
};

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = [];
    this.part = []; this.pivot = []; this.idx = [];
  }

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
 * @param {string} kind trooper | enforcer
 */
export function buildCordon(kind, r) {
  const b = new Builder();
  const heavy = kind === 'enforcer';

  const H = heavy ? 1.88 : 1.78;
  const hipY = H * 0.52;
  const shoY = H * 0.82;
  const chestW = heavy ? 0.235 : 0.185;
  const chestD = heavy ? 0.155 : 0.125;

  /* Torso: VERTICAL. The hips and shoulders are stacked, which is the whole
     difference from the Riven and the reason a soldier reads as a soldier. */
  b.box(V(0, hipY, 0), V(0.01, shoY, 0),
    heavy ? 0.175 : 0.140, heavy ? 0.130 : 0.105, chestW, chestD,
    PART.TORSO, V(0, hipY, 0));
  /* Webbing / plate carrier — a second, slightly larger box over the chest.
     It squares the shoulders off, which is a military silhouette in one shape. */
  b.box(V(0.005, shoY - 0.20, 0), V(0.012, shoY - 0.02, 0),
    chestW * 1.10, chestD * 1.18, chestW * 1.06, chestD * 1.12,
    PART.TORSO, V(0, hipY, 0));

  /* Head, up and back on the shoulders, with a helmet brim. */
  const neck = 0.10;
  b.box(V(0, shoY + neck, 0), V(-0.005, shoY + neck + 0.20, 0),
    0.085, 0.082, 0.078, 0.080, PART.HEAD, V(0, shoY, 0));
  b.box(V(-0.03, shoY + neck + 0.17, 0), V(0.055, shoY + neck + 0.20, 0),
    0.098, 0.092, 0.070, 0.070, PART.HEAD, V(0, shoY, 0));

  /* Arms. Both come forward and in — a carried rifle takes both hands, and
     arms hanging at the sides is the pose of someone who is not armed. */
  const armLen = H * 0.42;
  for (const [s, part] of [[1, PART.ARM_L], [-1, PART.ARM_R]]) {
    const px = 0.02, pz = s * (chestW + 0.03);
    b.box(V(px, shoY - 0.03, pz), V(px + 0.16, shoY - 0.03 - armLen * 0.72, pz * 0.78),
      heavy ? 0.058 : 0.046, heavy ? 0.058 : 0.046,
      heavy ? 0.044 : 0.036, heavy ? 0.044 : 0.036,
      part, V(px, shoY - 0.03, pz));
  }

  /* Legs, straight under the hips. */
  for (const [s, part] of [[1, PART.LEG_L], [-1, PART.LEG_R]]) {
    const pz = s * (heavy ? 0.098 : 0.082);
    b.box(V(0, hipY - 0.02, pz), V(0.015, 0.0, pz * 1.02),
      heavy ? 0.075 : 0.062, heavy ? 0.075 : 0.062,
      heavy ? 0.050 : 0.042, heavy ? 0.050 : 0.042,
      part, V(0, hipY - 0.02, pz));
  }

  /*
   * THE RIFLE, and it is the single most important shape on this model.
   *
   * Held across the body, horizontal, at chest height. It is the only
   * horizontal line on any figure in this world, so at the range where the
   * body is eight pixels tall the rifle is the two pixels that say "this one
   * shoots back". Rendered as its own PART so it can be swung up to the
   * shoulder when the figure aims — which is the other half of the read: a
   * Cordon that has seen you visibly changes shape before it fires.
   */
  const rifleY = shoY - 0.16;
  const rl = heavy ? 0.62 : 0.82;
  b.box(V(0.14, rifleY, 0.20), V(0.14, rifleY, 0.20 - rl),
    0.026, 0.030, 0.020, 0.024, PART.RIFLE, V(0.14, rifleY, 0.12));
  /* magazine, angled down and forward */
  b.box(V(0.14, rifleY - 0.02, -0.02), V(0.20, rifleY - 0.17, -0.05),
    0.018, 0.038, 0.016, 0.032, PART.RIFLE, V(0.14, rifleY, 0.12));

  /* Kit wobble: nothing is worn identically. */
  void r;
  return b.finish();
}

/* ------------------------------------------------------------------ shader */

export const CORDON_PARS = /* glsl */`
attribute float aPart;
attribute vec3  aPivot;
attribute vec4  aAnim;

vec3 cdRotZ(vec3 p, vec3 pivot, float a) {
  vec3 d = p - pivot;
  float c = cos(a), s = sin(a);
  return pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
}
vec3 cdRotY(vec3 p, vec3 pivot, float a) {
  vec3 d = p - pivot;
  float c = cos(a), s = sin(a);
  return pivot + vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}
`;

/**
 *   aAnim.x  stride phase in radians, advanced by DISTANCE travelled
 *   aAnim.y  0..1 how much of the walk cycle to apply
 *   aAnim.z  0..1 AIM: rifle up to the shoulder, torso bladed, head down to it
 *   aAnim.w  0..1 death
 */
export const CORDON_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
{
  float ph   = aAnim.x;
  float gait = aAnim.y;
  float aim  = aAnim.z;
  float dead = aAnim.w;
  float part = aPart + 0.5;

  if (part > 6.0) {
    /* ---- rifle: carried low across the body, or up in the shoulder ----
       Rotating it about the chest pivot is enough — the arms follow it
       below, and the two together read as shouldering a weapon. */
    transformed = cdRotZ(transformed, aPivot, aim * 0.30);
    transformed = cdRotY(transformed, aPivot, -aim * 0.62);
    transformed.x += aim * 0.06;
  } else if (part > 3.0) {
    /* ---- legs: a walk, not a run. Duty cycle near 1, low amplitude, and
       the stance leg stays straight — soldiers on a post shift their weight,
       they do not lope. */
    float off = (part < 5.0) ? 0.0 : 3.14159265;
    float s = sin(ph + off);
    float swing = s * (0.10 + gait * 0.48);
    vec3 d = transformed - aPivot;
    float c = cos(swing), sn = sin(swing);
    transformed = aPivot + vec3(d.x * c - d.y * sn, d.x * sn + d.y * c, d.z);
    transformed.y += max(0.0, -s) * gait * 0.07 * max(0.0, -d.y);
  } else if (part > 1.0) {
    /* ---- arms: counter-swing while walking, but LOCKED when aiming, because
       both hands are on the weapon and a swinging arm would tear it out of
       them. That lock is a surprisingly strong tell at range. */
    float off = (part < 3.0) ? 3.14159265 : 0.0;
    float s = sin(ph + off);
    transformed = cdRotZ(transformed, aPivot, s * (0.10 + gait * 0.42) * (1.0 - aim));
    transformed = cdRotZ(transformed, aPivot, aim * 0.34);
    transformed = cdRotY(transformed, aPivot, -aim * 0.30);
  } else if (part > 0.0) {
    /* ---- head: level while walking, dropped to the sights when aiming ---- */
    transformed = cdRotZ(transformed, aPivot, aim * 0.16 + sin(ph * 2.0) * 0.02 * gait);
    transformed = cdRotY(transformed, aPivot, -aim * 0.24);
  } else {
    /* ---- torso: blades toward the target as the weapon comes up ---- */
    transformed = cdRotY(transformed, aPivot, -aim * 0.36);
    transformed.y += sin(ph * 2.0) * 0.018 * gait;
  }

  if (dead > 0.001) {
    transformed = cdRotZ(transformed, vec3(0.0), dead * 1.52);
    transformed.y -= dead * 0.10;
  }
}
`;

export function patchCordonAnim(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + CORDON_PARS)
      .replace('#include <begin_vertex>', CORDON_BEGIN);
  };
  mat.customProgramCacheKey = () => 'cordonAnim';
}

/* ------------------------------------------------------------- roadblocks */

/**
 * A checkpoint: concrete barriers staggered across the carriageway so nothing
 * can be ridden through at speed, a burnt-out car shoved to one side, and oil
 * drums. Built about the origin with +Z along the road.
 *
 * The stagger is the design: a solid wall would simply stop the player, which
 * is a loading screen with extra steps. Offset barriers leave a line through at
 * walking pace, so the choice at a checkpoint is to slow right down in front of
 * armed men, or turn round and lose the road.
 */
export function buildRoadblock(rand) {
  const b = new Builder();
  const P = PART.TORSO;   // static prop; the part index is never read
  const O = V(0, 0, 0);

  const barrier = (x, z, yaw) => {
    /* A Jersey barrier: 0.8 m tall, wider at the base. */
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = c * 1.0, hz = s * 1.0;
    b.box(V(x - hx, 0.02, z - hz), V(x + hx, 0.02, z + hz), 0.28, 0.02, 0.28, 0.02, P, O);
    b.box(V(x - hx, 0.40, z - hz), V(x + hx, 0.40, z + hz), 0.16, 0.40, 0.16, 0.40, P, O);
  };

  /* Two staggered rows, three barriers each, leaving a gap on alternate sides. */
  for (let row = 0; row < 2; row++) {
    const z = row === 0 ? 1.6 : -1.6;
    const shift = row === 0 ? -1.5 : 1.5;
    for (let i = -1; i <= 1; i++) {
      barrier(i * 2.3 + shift, z + (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.12);
    }
  }

  /* Oil drums, and a fire barrel they stand round at night. */
  for (let i = 0; i < 4; i++) {
    const dx = -4.4 + rand() * 8.8, dz = 3.6 + rand() * 2.2;
    b.box(V(dx, 0.0, dz), V(dx + (rand() - 0.5) * 0.1, 0.86, dz), 0.20, 0.20, 0.19, 0.19, P, O);
  }

  /* The wrecked car shoved onto the verge — the thing that stopped first. */
  b.box(V(-5.4, 0.45, 3.2), V(-3.6, 0.45, 3.4), 0.48, 0.32, 0.48, 0.32, P, O);
  b.box(V(-5.0, 0.86, 3.25), V(-4.1, 0.86, 3.35), 0.42, 0.26, 0.42, 0.26, P, O);

  return b.finish();
}

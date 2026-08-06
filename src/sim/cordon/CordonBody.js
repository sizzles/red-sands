import { Builder, V, TONES, varyInstanceColour } from '../body/BoxRig.js';

export { varyInstanceColour };

/**
 * BROKEN ROAD — THE CORDON, AS GEOMETRY
 * ============================================================================
 * The other thing in this valley that shoots. Same box rig as the Riven (see
 * body/BoxRig.js), deliberately opposite silhouette:
 *
 *   THE RIVEN stand pitched forward, arms hanging below the knees, head leading
 *   the body. Nothing on them is horizontal and nothing on them is straight.
 *
 *   THE CORDON stand UP. Hips under shoulders, head above both, and a rifle
 *   held across the chest — the only horizontal line on any figure in the
 *   world. At the range where a body is eight pixels tall that horizontal is
 *   the entire read: it is what says "this one shoots back", and it is why the
 *   rifle is its own animated part rather than welded to the torso.
 *
 * Object space matches the Riven exactly: +X forward, +Y up, +Z to its left,
 * origin on the ground between the feet.
 * ============================================================================
 */

export const PART = {
  TORSO: 0, HEAD: 1,
  ARM_L: 2, ARM_R: 3, FORE_L: 4, FORE_R: 5,
  LEG_L: 6, LEG_R: 7, SHIN_L: 8, SHIN_R: 9,
  RIFLE: 10,
};

export function buildCordon(kind, r) {
  const b = new Builder();
  const heavy = kind === 'enforcer';

  const H = heavy ? 1.88 : 1.78;
  const hipY = H * 0.52;
  const shoY = H * 0.82;
  const chestW = heavy ? 0.235 : 0.185;
  const chestD = heavy ? 0.155 : 0.125;

  /* Torso: VERTICAL, in two segments so there is a waist for the belt to sit
     on. The hips and shoulders being stacked is the whole difference from the
     Riven and the reason a soldier reads as a soldier. */
  const midY = hipY + (shoY - hipY) * 0.44;
  const pel = V(0, hipY, 0);
  const mid = V(0.004, midY, 0);
  const sho = V(0.01, shoY, 0);
  b.box(pel, mid,
    heavy ? 0.175 : 0.140, heavy ? 0.130 : 0.105,
    heavy ? 0.168 : 0.134, heavy ? 0.122 : 0.098,
    PART.TORSO, pel, { tone: TONES.DRAB, ao: [0.9, 1.0], mot: 0.14 });
  b.box(mid, sho,
    heavy ? 0.168 : 0.134, heavy ? 0.122 : 0.098, chestW, chestD,
    PART.TORSO, pel, { tone: TONES.DRAB, mot: 0.14 });
  /* Plate carrier — a second, slightly larger box over the chest. It squares
     the shoulders off, which is a military silhouette in one shape. */
  b.box(V(0.005, shoY - 0.22, 0), V(0.012, shoY - 0.02, 0),
    chestW * 1.10, chestD * 1.18, chestW * 1.06, chestD * 1.12,
    PART.TORSO, pel, { tone: TONES.WEBBING, ao: [0.86, 1.0], mot: 0.20 });
  /* Belt and two pouches on the front of it. Small, but they are what stop the
     midsection reading as a smooth cylinder from the front. */
  b.box(V(0.0, hipY + 0.06, 0), V(0.004, hipY + 0.12, 0),
    (heavy ? 0.178 : 0.143), 0.032, (heavy ? 0.176 : 0.141), 0.030,
    PART.TORSO, pel, { tone: TONES.WEBBING, mot: 0.18 });
  for (const s of [1, -1]) {
    b.box(V(0.02, hipY + 0.02, s * (heavy ? 0.10 : 0.078)),
      V(0.055, hipY + 0.13, s * (heavy ? 0.11 : 0.086)),
      0.042, 0.060, 0.038, 0.052,
      PART.TORSO, pel, { tone: TONES.WEBBING, ao: [0.9, 1.0], mot: 0.22 });
  }

  /* Head — a neck of exposed skin under the shell, which is the only warm
     colour on the model and the reason the helmet reads as a helmet. */
  const neck = 0.10;
  b.box(V(0, shoY + neck * 0.2, 0), V(0, shoY + neck, 0),
    0.058, 0.052, 0.062, 0.056, PART.HEAD, V(0, shoY, 0),
    { tone: TONES.SKIN, ao: [0.62, 0.86], mot: 0.10 });
  b.box(V(0, shoY + neck, 0), V(-0.005, shoY + neck + 0.20, 0),
    0.085, 0.082, 0.078, 0.080, PART.HEAD, V(0, shoY, 0),
    { tone: TONES.SKIN, ao: [0.84, 1.0], mot: 0.12 });
  /* helmet shell and brim */
  b.box(V(-0.01, shoY + neck + 0.10, 0), V(-0.005, shoY + neck + 0.215, 0),
    0.098, 0.070, 0.086, 0.058, PART.HEAD, V(0, shoY, 0),
    { tone: TONES.STEEL, ao: [0.9, 1.0], mot: 0.16 });
  b.box(V(-0.03, shoY + neck + 0.17, 0), V(0.075, shoY + neck + 0.185, 0),
    0.098, 0.030, 0.062, 0.020, PART.HEAD, V(0, shoY, 0),
    { tone: TONES.STEEL, ao: [1.0, 0.82], mot: 0.14 });

  /* ---- ARMS. Both come forward and in, because a carried rifle takes two
     hands and arms hanging at the sides is the pose of someone unarmed. Built
     already bent at the elbow, so the elbow channel in the shader only has to
     carry the CHANGE when the weapon comes up. */
  const armLen = H * 0.42;
  const uw = heavy ? 0.058 : 0.046, fw = heavy ? 0.046 : 0.037;
  for (const [s, up, fo] of [[1, PART.ARM_L, PART.FORE_L], [-1, PART.ARM_R, PART.FORE_R]]) {
    const pz = s * (chestW + 0.03);
    const shoP = V(0.02, shoY - 0.03, pz);
    const elb = V(0.085, shoY - 0.03 - armLen * 0.56, pz * 0.94);
    const wri = V(0.235, shoY - 0.03 - armLen * 0.86, pz * 0.52);
    b.box(shoP, elb, uw, uw, fw * 1.15, fw * 1.15, up, shoP,
      { tone: TONES.DRAB, ao: [1.0, 0.74], mot: 0.14 });
    b.box(elb, wri, fw * 1.15, fw * 1.15, fw * 0.88, fw * 0.88, fo, elb,
      { p2: shoP, tone: TONES.DRAB, ao: [0.74, 0.94], mot: 0.14 });
    /* glove on the weapon */
    b.box(wri, wri.clone().add(V(0.075, -0.018, -s * 0.012)),
      fw * 0.92, fw * 0.80, fw * 0.80, fw * 0.62, fo, elb,
      { p2: shoP, tone: TONES.WEBBING, ao: [0.92, 1.0], mot: 0.20 });
  }

  /* ---- LEGS, straight under the hips, with a knee. A soldier on a post walks;
     the knee amplitude below is a fraction of the Riven's, and that difference
     in duty cycle is readable at a hundred metres. */
  const tw = heavy ? 0.075 : 0.062, sw = heavy ? 0.054 : 0.045;
  for (const [s, up, sh] of [[1, PART.LEG_L, PART.SHIN_L], [-1, PART.LEG_R, PART.SHIN_R]]) {
    const pz = s * (heavy ? 0.098 : 0.082);
    const hipP = V(0, hipY - 0.02, pz);
    const kne = V(0.010, (hipY - 0.02) * 0.50, pz * 1.02);
    const ank = V(0.015, heavy ? 0.098 : 0.088, pz * 1.03);
    b.box(hipP, kne, tw, tw, sw * 1.12, sw * 1.12, up, hipP,
      { tone: TONES.DRAB, ao: [1.0, 0.76], mot: 0.14 });
    b.box(kne, ank, sw * 1.12, sw * 1.12, sw * 0.92, sw * 0.92, sh, kne,
      { p2: hipP, tone: TONES.DRAB, ao: [0.76, 0.94], mot: 0.14 });
    /* boot — squarer and darker than the leg, and the thing that keeps the
       figure standing ON the ground instead of ending at it */
    b.box(ank.clone().add(V(-0.045, -0.055, 0)),
      ank.clone().add(V(0.115, -0.082, 0)),
      sw * 1.00, sw * 0.62, sw * 0.86, sw * 0.40, sh, kne,
      { p2: hipP, tone: TONES.STEEL, ao: [0.82, 1.0], mot: 0.18 });
  }

  /*
   * THE RIFLE, and it is the single most important shape on this model.
   *
   * Held across the body, horizontal, at chest height, and rendered as its own
   * PART so it can swing up to the shoulder when the figure aims — which is the
   * other half of the read: a Cordon that has seen you visibly changes shape
   * before it fires.
   */
  const rifleY = shoY - 0.16;
  const rl = heavy ? 0.62 : 0.82;
  const rp = V(0.14, rifleY, 0.12);
  b.box(V(0.14, rifleY, 0.20), V(0.14, rifleY, 0.20 - rl),
    0.026, 0.030, 0.020, 0.024, PART.RIFLE, rp,
    { tone: TONES.STEEL, ao: [1.0, 0.88], mot: 0.12 });
  /* magazine, angled down and forward */
  b.box(V(0.14, rifleY - 0.02, -0.02), V(0.20, rifleY - 0.17, -0.05),
    0.018, 0.038, 0.016, 0.032, PART.RIFLE, rp,
    { tone: TONES.STEEL, ao: [1.0, 0.86], mot: 0.14 });
  /* stock at the butt end, and a low optic on the receiver: three boxes is
     enough for a weapon to stop being a stick */
  b.box(V(0.13, rifleY - 0.01, 0.20 - rl), V(0.11, rifleY - 0.05, 0.20 - rl - 0.16),
    0.024, 0.028, 0.020, 0.045, PART.RIFLE, rp,
    { tone: TONES.STEEL, ao: [0.9, 1.0], mot: 0.12 });
  b.box(V(0.175, rifleY + 0.035, 0.02), V(0.175, rifleY + 0.035, -0.08),
    0.014, 0.016, 0.012, 0.014, PART.RIFLE, rp,
    { tone: TONES.STEEL, ao: [1.0, 0.9], mot: 0.10 });

  /* Kit wobble: nothing is worn identically. */
  void r;
  return b.finish();
}

/* ------------------------------------------------------------------ shader */

export const CORDON_PARS = /* glsl */`
attribute float aPart;
attribute vec3  aPivot;
attribute vec3  aPivot2;
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
 *
 * Two-bone chains as in BoxRig: shins and forearms rotate about their own joint
 * (`aPivot`) and then about their parent's (`aPivot2`).
 */
export const CORDON_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
{
  float ph   = aAnim.x;
  float gait = aAnim.y;
  float aim  = aAnim.z;
  float dead = aAnim.w;
  float part = aPart + 0.5;

  float sL = sin(ph);
  float sR = sin(ph + 3.14159265);

  if (part > 10.0) {
    /* ---- rifle: carried low across the body, or up in the shoulder ----
       Rotating it about the chest pivot is enough — the arms follow it below,
       and the two together read as shouldering a weapon. */
    transformed = cdRotZ(transformed, aPivot, aim * 0.30);
    transformed = cdRotY(transformed, aPivot, -aim * 0.62);
    transformed.x += aim * 0.06;
  } else if (part > 6.0) {
    /* ---- legs: a walk, not a run. Duty cycle near 1, low amplitude, and the
       knee barely folds — soldiers on a post shift their weight, they do not
       lope, and that restraint is exactly what separates them from the Riven
       at the distance you first see either. */
    bool shin = part > 8.0;
    float s = (shin ? (part < 9.0) : (part < 7.0)) ? sL : sR;
    float hip = s * (0.10 + gait * 0.46);
    if (shin) {
      float knee = -gait * (0.05 + 0.34 * (0.5 - 0.5 * s));
      transformed = cdRotZ(transformed, aPivot, knee);
      transformed = cdRotZ(transformed, aPivot2, hip);
    } else {
      transformed = cdRotZ(transformed, aPivot, hip);
    }
  } else if (part > 2.0) {
    /* ---- arms: counter-swing while walking, but LOCKED when aiming, because
       both hands are on the weapon and a swinging arm would tear it out of
       them. That lock is a surprisingly strong tell at range. */
    bool fore = part > 4.0;
    bool left = fore ? (part < 5.0) : (part < 3.0);
    float s = left ? sR : sL;
    float sho = s * (0.10 + gait * 0.42) * (1.0 - aim) + aim * 0.34;
    if (fore) {
      /* the support hand comes up harder than the firing hand */
      float elbow = aim * (left ? 0.46 : 0.24);
      transformed = cdRotZ(transformed, aPivot, elbow);
      transformed = cdRotZ(transformed, aPivot2, sho);
      transformed = cdRotY(transformed, aPivot2, -aim * 0.30);
    } else {
      transformed = cdRotZ(transformed, aPivot, sho);
      transformed = cdRotY(transformed, aPivot, -aim * 0.30);
    }
  } else if (part > 1.0) {
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
  /* Weathered concrete: pale, and mottled hard, because a Jersey barrier that
     is one flat grey is the most obviously untextured thing a road can have. */
  const CONCRETE = { tone: [0.94, 0.93, 0.90], ao: [0.88, 1.0], mot: 0.34 };

  const barrier = (x, z, yaw) => {
    /* A Jersey barrier: 0.8 m tall, wider at the base. */
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = c * 1.0, hz = s * 1.0;
    b.box(V(x - hx, 0.02, z - hz), V(x + hx, 0.02, z + hz), 0.28, 0.02, 0.28, 0.02, P, O, CONCRETE);
    b.box(V(x - hx, 0.40, z - hz), V(x + hx, 0.40, z + hz), 0.16, 0.40, 0.16, 0.40, P, O, CONCRETE);
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
    b.box(V(dx, 0.0, dz), V(dx + (rand() - 0.5) * 0.1, 0.86, dz), 0.20, 0.20, 0.19, 0.19, P, O,
      { tone: TONES.STEEL, ao: [0.72, 1.0], mot: 0.30 });
  }

  /* The wrecked car shoved onto the verge — the thing that stopped first. */
  b.box(V(-5.4, 0.45, 3.2), V(-3.6, 0.45, 3.4), 0.48, 0.32, 0.48, 0.32, P, O,
    { tone: TONES.STEEL, ao: [0.7, 0.9], mot: 0.34 });
  b.box(V(-5.0, 0.86, 3.25), V(-4.1, 0.86, 3.35), 0.42, 0.26, 0.42, 0.26, P, O,
    { tone: TONES.STEEL, ao: [0.66, 0.86], mot: 0.34 });

  return b.finish();
}

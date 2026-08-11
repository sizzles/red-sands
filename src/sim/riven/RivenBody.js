import { Builder, V, lerpV, TONES, varyInstanceColour } from '../body/BoxRig.js';

export { varyInstanceColour };

/**
 * BROKEN ROAD — THE RIVEN, AS GEOMETRY
 * ============================================================================
 * Bipeds built on the shared box rig (body/BoxRig.js): tapered boxes merged
 * into one geometry, every vertex carrying which limb it belongs to (`aPart`),
 * the joint it swings on (`aPivot`) and that joint's parent (`aPivot2`), so the
 * whole run cycle happens in the vertex shader and a hundred of them cost one
 * draw call.
 *
 * Object space: +X forward (the way it is facing), +Y up, +Z to its left.
 * Origin on the ground between the feet. Metres, and honest ones — the
 * silhouette against a treeline at eighty metres is the only warning the player
 * gets, so the three types have to be distinguishable by shape alone.
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
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS MORE THAN SIX BOXES
 *
 * The first build was one rigid box per limb: six boxes, forty-eight vertices.
 * Standing next to a tree carrying a baked bark map, a normal map, per-instance
 * tint and a five-hundred-triangle canopy, it read as a placeholder — and it
 * was, in three specific ways, each with a different fix:
 *
 *   1. NO JOINTS. A limb hinged only at the hip is a pendulum. It cannot flex,
 *      so every degree of swing past about 45 read as the leg detaching, which
 *      capped the run cycle at an amplitude too small to be legible. Knees and
 *      elbows lift that cap, and a flexing shin is most of what separates a run
 *      from a shuffle at any distance.
 *   2. NO SURFACE. One flat colour over the whole body, in a world where
 *      everything else has spatial variation baked into it. Fixed with baked
 *      vertex colour — joint darkening, necrotic mottling, dark cloth.
 *   3. NO EXTREMITIES. Limbs tapered to a point at the ground. Hands, feet and
 *      a hanging jaw are four boxes each and they are what the silhouette is
 *      actually made of at the range these are fought at.
 *
 * The result is around twenty boxes rather than six — 160 vertices, 240
 * triangles. At the population this world runs, that is under 30k triangles for
 * every Riven alive at once, which is less than one hero outcrop.
 * ============================================================================
 */

export const PART = {
  TORSO: 0, HEAD: 1,
  ARM_L: 2, ARM_R: 3, FORE_L: 4, FORE_R: 5,
  LEG_L: 6, LEG_R: 7, SHIN_L: 8, SHIN_R: 9,
  RAG: 10,
};

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
    b.box(V(-0.32, hipY - 0.01, 0), V(-0.02, hipY + 0.03, 0), 0.105, 0.098, 0.130, 0.112,
      PART.TORSO, V(0, hipY, 0), { tone: TONES.NECRO, ao: [0.82, 1.0], mot: 0.22 });
    b.box(V(-0.02, hipY + 0.03, 0), V(0.26, shoY, 0), 0.130, 0.112, 0.140, 0.118,
      PART.TORSO, V(0, hipY, 0), { mot: 0.20 });
    /* Skull and a dropped jaw — the jaw is the whole face at this size. */
    b.box(V(0.26, shoY, 0), V(0.48, shoY - 0.03, 0), 0.084, 0.078, 0.060, 0.056,
      PART.HEAD, V(0.26, shoY, 0), { mot: 0.24 });
    b.box(V(0.34, shoY - 0.06, 0), V(0.50, shoY - 0.10, 0), 0.048, 0.024, 0.036, 0.020,
      PART.HEAD, V(0.26, shoY, 0), { tone: TONES.MAW, ao: [0.7, 1.0], mot: 0.10 });

    /* Forelimbs: upper + fore + a splayed hand, because a thing that runs on
       its knuckles is the read, and the knuckle is where it lives. */
    for (const [s, up, fo] of [[1, PART.ARM_L, PART.FORE_L], [-1, PART.ARM_R, PART.FORE_R]]) {
      const shoP = V(0.22, shoY - 0.02, s * 0.105);
      const elb = V(0.26, 0.24, s * 0.115);
      const wri = V(0.30, 0.055, s * 0.120);
      b.box(shoP, elb, 0.050, 0.050, 0.038, 0.038, up, shoP, { ao: [1.0, 0.72] });
      b.box(elb, wri, 0.038, 0.038, 0.032, 0.032, fo, elb, { p2: shoP, ao: [0.72, 0.92] });
      b.box(wri, V(0.375, 0.012, s * 0.122), 0.034, 0.030, 0.040, 0.016, fo, elb,
        { p2: shoP, tone: TONES.NECRO, ao: [0.9, 1.0], mot: 0.24 });
    }
    /* Hind limbs: the hock is high and far back, which is what makes it spring. */
    for (const [s, up, fo] of [[1, PART.LEG_L, PART.SHIN_L], [-1, PART.LEG_R, PART.SHIN_R]]) {
      const hipP = V(-0.26, hipY - 0.02, s * 0.095);
      const kne = V(-0.34, 0.22, s * 0.104);
      const ank = V(-0.24, 0.045, s * 0.108);
      b.box(hipP, kne, 0.058, 0.058, 0.040, 0.040, up, hipP, { ao: [1.0, 0.70] });
      b.box(kne, ank, 0.040, 0.040, 0.030, 0.030, fo, kne, { p2: hipP, ao: [0.70, 0.92] });
      b.box(ank, V(-0.17, 0.012, s * 0.110), 0.030, 0.026, 0.034, 0.014, fo, kne,
        { p2: hipP, tone: TONES.NECRO, ao: [0.9, 1.0], mot: 0.24 });
    }
    void r;
    return b.finish();
  }

  /*
   * THE FOUR UPRIGHT SHAPES.
   *
   * `harrow` covers the two heavy ones for proportion; `plated` and `keener`
   * then diverge where it matters. Each has to be identifiable as a SILHOUETTE,
   * because both mini-boss mechanics are positional and a player who cannot
   * tell which one they are looking at cannot choose the right answer:
   *
   *   keener  tall, thin, and its head is thrown BACK rather than carried
   *           forward — the only Riven whose face points at the sky. It is also
   *           the only one that walks backwards, so it is the wrong shape
   *           moving the wrong way at the back of a pack.
   *   cairn   a harrow with slabs across the chest and over each shoulder. The
   *           plate is not decoration: its outline is the hitbox rule, so the
   *           player can see the angle that does not work.
   */
  const plated = kind === 'cairn';
  const keener = kind === 'keener';
  const harrow = kind === 'harrow' || plated;
  const H = keener ? 1.94 : (harrow ? 2.15 : 1.62);
  const hipY = H * 0.50;
  const shoY = H * 0.83;
  const chestW = plated ? 0.34 : (harrow ? 0.30 : (keener ? 0.150 : 0.185));
  const chestD = plated ? 0.23 : (harrow ? 0.20 : (keener ? 0.115 : 0.135));

  /* Torso, pitched forward, in two segments so there is a waist. `lean` moves
     the shoulders ahead of the hips in X, and it is the whole silhouette: a
     person stands with them stacked. */
  /* The keener stands nearly UPRIGHT. Every other Riven leans into its run;
     this one is holding still and looking up, and that difference is most of
     what identifies it before it calls. */
  const lean = keener ? -0.06 : (harrow ? 0.24 : 0.17);
  const midY = hipY + (shoY - hipY) * 0.46;
  const pel = V(0, hipY, 0);
  const mid = V(lean * 0.40, midY, 0);
  const sho = V(lean, shoY, 0);
  b.box(pel, mid,
    harrow ? 0.19 : 0.135, harrow ? 0.15 : 0.115,
    harrow ? 0.185 : 0.128, harrow ? 0.145 : 0.104,
    PART.TORSO, pel, { tone: TONES.RAGS, ao: [0.88, 1.0], mot: 0.26 });
  b.box(mid, sho,
    harrow ? 0.185 : 0.128, harrow ? 0.145 : 0.104, chestW, chestD,
    PART.TORSO, pel, { tone: TONES.NECRO, ao: [1.0, 0.94], mot: 0.28 });

  /* Head, dropped forward and down off the shoulders, with a hanging jaw. The
     jaw is the only bright shape on the model and it is where the eye goes. */
  /* Neck: long on the keener, and the skull runs UP from it instead of
     forward and down, which is the head-thrown-back read. */
  const neck = keener ? 0.30 : (harrow ? 0.06 : 0.11);
  const skullA = V(lean + 0.02, shoY + neck, 0);
  const skullB = keener
    ? V(lean - 0.10, shoY + neck + 0.22, 0)
    : V(lean + (harrow ? 0.20 : 0.17), shoY + neck * (harrow ? 0.4 : 0.7), 0);
  b.box(skullA, skullB,
    harrow ? 0.115 : 0.090, harrow ? 0.110 : 0.088,
    harrow ? 0.085 : 0.062, harrow ? 0.090 : 0.070,
    PART.HEAD, sho, { mot: 0.26 });
  /* matted hair over the crown — one box, and it stops the skull reading as a
     smooth capsule from behind, which is the angle you see most of them from */
  b.box(lerpV(skullA, skullB, 0.05).add(V(0, harrow ? 0.075 : 0.062, 0)),
    lerpV(skullA, skullB, 0.62).add(V(0, harrow ? 0.055 : 0.046, 0)),
    harrow ? 0.104 : 0.082, harrow ? 0.030 : 0.026,
    harrow ? 0.074 : 0.056, harrow ? 0.026 : 0.022,
    PART.HEAD, sho, { tone: TONES.HAIR, mot: 0.34 });
  b.box(lerpV(skullA, skullB, 0.42).add(V(0, harrow ? -0.10 : -0.082, 0)),
    skullB.clone().add(V(0.02, harrow ? -0.11 : -0.090, 0)),
    harrow ? 0.062 : 0.046, harrow ? 0.030 : 0.024,
    harrow ? 0.050 : 0.036, harrow ? 0.024 : 0.019,
    PART.HEAD, sho, { tone: TONES.MAW, ao: [0.68, 1.0], mot: 0.12 });

  if (harrow) {
    /* Shoulder mass. Two lumps riding above the collar line: the harrow has to
       be legible as heavy from the range at which it is a silhouette, and mass
       across the shoulders is the only cue that survives that far. */
    for (const s of [1, -1]) {
      b.box(V(lean - 0.03, shoY - 0.02, s * (chestW * 0.55)),
        V(lean + 0.02, shoY + 0.10, s * (chestW + 0.05)),
        0.13, 0.10, 0.10, 0.08, PART.TORSO, pel, { tone: TONES.NECRO, mot: 0.30 });
    }
  }

  if (plated) {
    /*
     * THE PLATE, and its outline IS the rule. Three slabs standing proud of the
     * chest and each shoulder, covering the front and stopping at the collar so
     * the head is visibly bare. A player who can see where the armour ends can
     * work out both answers — go round it, or go over it — without being told.
     */
    const armour = { tone: [0.52, 0.50, 0.46], ao: [0.86, 1.0], mot: 0.36 };
    b.box(V(lean + 0.10, hipY + (shoY - hipY) * 0.34, 0),
      V(lean + 0.16, shoY - 0.06, 0),
      chestW * 1.02, chestD * 1.10, chestW * 0.92, chestD * 1.02,
      PART.TORSO, pel, armour);
    for (const s of [1, -1]) {
      b.box(V(lean + 0.02, shoY + 0.02, s * (chestW * 0.62)),
        V(lean + 0.09, shoY - 0.22, s * (chestW * 1.02)),
        0.14, 0.11, 0.12, 0.09, PART.TORSO, pel, armour);
    }
    /* a lower band across the gut, so the plate reads as courses rather than
       one smooth shell */
    b.box(V(lean + 0.06, hipY + 0.10, 0), V(lean + 0.11, hipY + 0.28, 0),
      chestW * 0.94, 0.10, chestW * 0.98, 0.09,
      PART.TORSO, pel, { tone: [0.46, 0.44, 0.41], ao: [0.9, 1.0], mot: 0.34 });
  }

  /* ---- ARMS. Long and hanging, with an elbow. The stray's fingertips reach
     below its knees, which no healthy human's do, and it is one of the
     cheapest tells there is. */
  const armLen = harrow ? H * 0.52 : H * 0.47;
  const uw = harrow ? 0.072 : 0.050, fw = harrow ? 0.056 : 0.038;
  for (const [s, up, fo] of [[1, PART.ARM_L, PART.FORE_L], [-1, PART.ARM_R, PART.FORE_R]]) {
    const px = lean - 0.01, pz = s * (chestW + 0.035);
    const drift = 0.10 + r() * 0.06;               // per-type, not per-instance
    const shoP = V(px, shoY - 0.04, pz);
    const elb = V(px - drift * 0.55, shoY - 0.04 - armLen * 0.52, pz * 1.06);
    const wri = V(px - drift, shoY - 0.04 - armLen, pz * 1.12);
    b.box(shoP, elb, uw, uw, fw * 1.12, fw * 1.12, up, shoP, { ao: [1.0, 0.70], mot: 0.20 });
    b.box(elb, wri, fw * 1.12, fw * 1.12, fw * 0.86, fw * 0.86, fo, elb,
      { p2: shoP, ao: [0.70, 0.90], mot: 0.20 });
    /* the hand, splayed — wider than the wrist and nearly flat */
    b.box(wri, wri.clone().add(V(-0.02, -(harrow ? 0.15 : 0.115), s * 0.012)),
      fw * 0.92, fw * 0.70, fw * 1.30, fw * 0.34, fo, elb,
      { p2: shoP, tone: TONES.NECRO, ao: [0.92, 1.0], mot: 0.30 });
  }

  /* ---- LEGS, with a knee. The knee is what buys the run cycle its amplitude:
     a rigid leg capped out around 45 degrees of hip swing before it stopped
     looking attached. */
  const tw = harrow ? 0.090 : 0.062, sw = harrow ? 0.062 : 0.044;
  for (const [s, up, sh] of [[1, PART.LEG_L, PART.SHIN_L], [-1, PART.LEG_R, PART.SHIN_R]]) {
    const pz = s * (harrow ? 0.115 : 0.082);
    const hipP = V(0, hipY - 0.02, pz);
    const kne = V(0.012, (hipY - 0.02) * 0.48, pz * 1.03);
    const ank = V(0.02, harrow ? 0.10 : 0.075, pz * 1.05);
    b.box(hipP, kne, tw, tw, sw * 1.10, sw * 1.10, up, hipP, { ao: [1.0, 0.72], mot: 0.18 });
    b.box(kne, ank, sw * 1.10, sw * 1.10, sw * 0.80, sw * 0.80, sh, kne,
      { p2: hipP, ao: [0.72, 0.92], mot: 0.18 });
    /* the foot, forward of the ankle: this is the box that makes it look like
       it is standing on the ground rather than sunk into it */
    b.box(ank.clone().add(V(-0.035, -(harrow ? 0.075 : 0.058), 0)),
      ank.clone().add(V(harrow ? 0.15 : 0.115, -(harrow ? 0.095 : 0.072), 0)),
      sw * 0.90, sw * 0.55, sw * 0.78, sw * 0.34, sh, kne,
      { p2: hipP, tone: TONES.RAGS, ao: [0.8, 1.0], mot: 0.20 });
  }

  /* ---- RAGS. Not decoration: the outline of a running figure in torn cloth
     is completely different from the outline of a bare articulated dummy, and
     it moves on its own axis, which is the cheapest possible way to make a
     shape look like it has more going on than it does. The harrow gets none —
     what makes it read is mass, and cloth softens mass. */
  if (!harrow) {
    const rag = { tone: TONES.RAGS, ao: [1.0, 0.72], mot: 0.42 };
    /* a tail off the back of the waist */
    b.box(V(-0.05, hipY + 0.06, 0), V(-0.17, hipY - 0.44, 0),
      0.155, 0.014, 0.120, 0.010, PART.RAG, V(-0.05, hipY + 0.06, 0), rag);
    /* two shreds hanging from the ribs */
    for (const s of [1, -1]) {
      const px = lean * 0.55 + (r() - 0.5) * 0.03;
      b.box(V(px, shoY - 0.16, s * (chestW * 0.92)),
        V(px - 0.05, hipY - 0.20 - r() * 0.16, s * (chestW * 1.06)),
        0.012, 0.085, 0.010, 0.062, PART.RAG, V(px, shoY - 0.16, s * (chestW * 0.92)), rag);
    }
  }

  return b.finish();
}

/* ------------------------------------------------------------------ shader */

export const RIVEN_PARS = /* glsl */`
attribute float aPart;
attribute vec3  aPivot;
attribute vec3  aPivot2;
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
 *
 * TWO-BONE CHAINS. Forearms and shins carry their own joint in `aPivot` and
 * their parent's in `aPivot2`, and are rotated about both in that order —
 * child first, then parent — which is a two-line forward kinematic chain with
 * no matrices and no bone palette. Everything else keeps the one-pivot path.
 */
export const RIVEN_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
{
  float ph   = aAnim.x;
  float gait = aAnim.y;
  float rage = aAnim.z;
  float dead = aAnim.w;
  float part = aPart + 0.5;

  /* One shared stride, so every limb agrees about which foot is down. */
  float sL = sin(ph);
  float sR = sin(ph + 3.14159265);

  if (part > 10.0) {
    /* ---- rags: lag behind the body and flutter on their own period. The
       phase offset by height is what makes the cloth travel down the panel
       rather than swinging as a board. */
    float sway = sin(ph * 0.85 + transformed.y * 3.2) * (0.06 + gait * 0.16);
    transformed = rvRotZ(transformed, aPivot, sway - rage * 0.22);
    transformed.z += sin(ph * 1.7 + transformed.y * 5.4) * (0.008 + gait * 0.022);
  } else if (part > 6.0) {
    /* ---- legs. Thighs hinge at the hip; shins hinge at the knee and are then
       carried by the hip. A walk and a run differ in DUTY CYCLE, not amplitude:
       a walk always has a foot down, a run has a flight phase, so the swing is
       fast and the stance is slow. Skewing the sine with its own square gives
       that asymmetry for one multiply. */
    bool shin = part > 8.0;
    float s = (shin ? (part < 9.0) : (part < 7.0)) ? sL : sR;
    float hip = (s * 0.62 + s * abs(s) * 0.30) * (0.14 + gait * (0.62 + rage * 0.34));
    if (shin) {
      /* The knee is straight at the front of the stride and folded hard behind
         it — heel toward the buttock — which is the single most recognisable
         thing about a run at any distance. Negative, because +Z rotation
         carries a point below the pivot forward. */
      float knee = -gait * (0.14 + 0.86 * (0.5 - 0.5 * s));
      transformed = rvRotZ(transformed, aPivot, knee);
      transformed = rvRotZ(transformed, aPivot2, hip);
    } else {
      transformed = rvRotZ(transformed, aPivot, hip);
    }
  } else if (part > 2.0) {
    /* ---- arms: counter-swing, elbow flexed, and thrown wide when charging.
       The elbow STRAIGHTENS as rage climbs, so the last thing the player sees
       before contact is both arms extending toward them. */
    bool fore = part > 4.0;
    float s = (fore ? (part < 5.0) : (part < 3.0)) ? sR : sL;
    float sho = s * (0.16 + gait * 0.50) * (1.0 + rage * 0.44);
    float side = ((fore ? (part < 5.0) : (part < 3.0)) ? 1.0 : -1.0) * rage * 0.46;
    if (fore) {
      float elbow = (0.62 - rage * 0.44) + s * 0.20 * gait;
      transformed = rvRotZ(transformed, aPivot, elbow);
      transformed = rvRotZ(transformed, aPivot2, sho);
      transformed = rvRotX(transformed, aPivot2, side);
      transformed.x += rage * 0.16 * max(0.0, aPivot2.y - transformed.y);
    } else {
      transformed = rvRotZ(transformed, aPivot, sho);
      transformed = rvRotX(transformed, aPivot, side);
      transformed.x += rage * 0.16 * max(0.0, aPivot.y - transformed.y);
    }
  } else if (part > 1.0) {
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

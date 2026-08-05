/**
 * Quality presets + global tunables.
 * FROZEN CONTRACT — systems read from `ctx.quality`. Do not rename fields.
 */

export const PRESETS = {
  /*
   * PHONE.
   *
   * Not "low, but a bit less" — the constraints are different in kind. A
   * mid-range phone GPU has perhaps a tenth the fill rate of a laptop and a
   * screen with three times the pixel density, so the thing that kills it is
   * never triangle count, it is FRAGMENTS. Hence the two numbers that do most
   * of the work here:
   *
   *   pixelRatio 0.62   render at ~0.4x the pixels and let the browser
   *                     upscale. This alone is worth more than every other
   *                     setting in this block combined.
   *   volumetrics off   the cloud raymarch is per-pixel and unbounded; it is
   *                     the single most expensive thing in the frame.
   *
   * TAA is off for a subtler reason: it needs a velocity buffer and a history
   * target, which is two more full-screen surfaces of bandwidth on a device
   * whose bottleneck IS bandwidth, and at 0.62 scale its benefit is mostly
   * lost to the upscale anyway. Draw distance is cut hard on the assumption
   * that a 6-inch screen resolves far less of the far field than a monitor.
   */
  mobile: {
    name: 'mobile',
    pixelRatio: 0.62,
    shadowCascades: 2,
    shadowMapSize: 1024,
    shadowDistance: 150,
    softShadows: false,
    ssao: false,
    ssr: false,
    volumetrics: false,
    volumetricSteps: 0,
    taa: false,
    motionBlur: false,
    dof: false,
    bloom: true,
    grassDensity: 0.14,
    grassDistance: 38,
    treeDistance: 620,
    terrainLodBias: 2.1,
    cloudSteps: 0,
    waterQuality: 0,
    particleBudget: 700,
    anisotropy: 2,
  },
  low: {
    name: 'low',
    pixelRatio: 1,
    shadowCascades: 2,
    shadowMapSize: 1024,
    shadowDistance: 220,
    softShadows: false,
    ssao: false,
    ssr: false,
    volumetrics: false,
    volumetricSteps: 0,
    taa: false,
    motionBlur: false,
    dof: false,
    bloom: true,
    grassDensity: 0.22,
    grassDistance: 55,
    treeDistance: 900,
    terrainLodBias: 1.6,
    cloudSteps: 0,
    waterQuality: 0,
    particleBudget: 1500,
    anisotropy: 4,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1,
    shadowCascades: 3,
    shadowMapSize: 1536,
    shadowDistance: 380,
    softShadows: true,
    ssao: true,
    ssr: false,
    volumetrics: true,
    volumetricSteps: 24,
    taa: true,
    motionBlur: false,
    dof: true,
    bloom: true,
    grassDensity: 0.55,
    grassDistance: 90,
    treeDistance: 1400,
    terrainLodBias: 1.15,
    cloudSteps: 48,
    waterQuality: 1,
    particleBudget: 5000,
    anisotropy: 8,
  },
  high: {
    name: 'high',
    pixelRatio: 1,
    shadowCascades: 4,
    shadowMapSize: 2048,
    shadowDistance: 620,
    softShadows: true,
    ssao: true,
    ssr: true,
    volumetrics: true,
    volumetricSteps: 48,
    taa: true,
    motionBlur: true,
    dof: true,
    bloom: true,
    grassDensity: 1.0,
    grassDistance: 135,
    treeDistance: 2200,
    terrainLodBias: 1.0,
    cloudSteps: 96,
    waterQuality: 2,
    particleBudget: 12000,
    anisotropy: 16,
  },
  ultra: {
    name: 'ultra',
    pixelRatio: 1.35,
    shadowCascades: 4,
    shadowMapSize: 3072,
    shadowDistance: 900,
    softShadows: true,
    ssao: true,
    ssr: true,
    volumetrics: true,
    volumetricSteps: 80,
    taa: true,
    motionBlur: true,
    dof: true,
    bloom: true,
    grassDensity: 1.5,
    grassDistance: 190,
    treeDistance: 3200,
    terrainLodBias: 0.82,
    cloudSteps: 144,
    waterQuality: 2,
    particleBudget: 24000,
    anisotropy: 16,
  },
};

/** World-scale constants. 1 unit = 1 metre. */
export const WORLD = {
  /** Terrain extent in metres (square, centred on origin). */
  size: 8192,
  /** Heightfield resolution used for simulation/erosion. */
  heightRes: 1024,
  /** Max terrain altitude in metres. The tallest cone tops out around 1235. */
  maxAltitude: 1300,
  /** Sea / river base level in metres. */
  waterLevel: 18,
  /**
   * Latitude used by the solar model, degrees. Central Oregon, not the
   * south-west desert this world used to be — which is worth more than a
   * geography note: nine degrees further north is a materially lower sun, so
   * shadows are longer all day, golden hour lasts a great deal longer, and the
   * winter sun never gets high enough to flatten the mountains out. The
   * overcast look this game wants is partly just a northern sun angle.
   */
  latitude: 43.9,
};

/**
 * Is this a touch device we should treat as a phone?
 *
 * Deliberately NOT a user-agent sniff. What matters is the combination of a
 * coarse pointer (so there is no mouse) and no hover (so it is not a laptop
 * with a touchscreen) — those two media queries together identify the class of
 * device this preset exists for, and they keep working when the UA string
 * changes, which it does constantly.
 *
 * `maxTouchPoints` is the fallback for browsers without the hover query, and a
 * desktop with a touch monitor failing into it is a survivable mistake: the
 * worst case is that somebody with a large machine gets a conservative preset
 * and can override it with ?quality= in one keystroke.
 */
export function isTouchDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 1;
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  if (coarse && noHover) return true;
  return (navigator.maxTouchPoints || 0) > 1 && coarse;
}

export function detectPreset() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && PRESETS[forced]) return PRESETS[forced];
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  /*
   * Phones report flattering core counts — an eight-core phone is four fast
   * cores and four that exist to read email — so the touch test comes FIRST
   * and outranks the hardware figures entirely. Detecting on cores alone put
   * modern handsets on the `high` preset, where they rendered a slideshow.
   */
  if (isTouchDevice()) return PRESETS.mobile;
  if (mem >= 8 && cores >= 8) return PRESETS.high;
  if (mem >= 4 && cores >= 4) return PRESETS.medium;
  return PRESETS.low;
}

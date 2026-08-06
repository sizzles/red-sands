import * as THREE from 'three';
import { YARD } from './compound/Yard.js';

/**
 * BROKEN ROAD — WHERE THE COMPOUND GOES
 * ============================================================================
 * Site selection, split out of `Compound` and run EARLY, and the reason is
 * ordering rather than tidiness.
 *
 * `Compound` cannot init before the Cordon it garrisons itself from, which puts
 * it at 91 — after Vegetation (40), Scatter (45) and Town (50). By then the
 * forest has already been placed. The result was visible in every screenshot of
 * the position: a two-storey glacial erratic standing against the curtain wall,
 * and pines growing out of the parade ground, because nothing that places
 * scenery had any idea the compound existed.
 *
 * Nothing about CHOOSING the site needs the Cordon, though. It needs the road
 * network and the height query, and both of those are ready at 35. So the
 * choice happens here at 36 and is published; `Compound` reads it back at 91
 * and only builds geometry. Everything in between — the forest, the boulders,
 * the road ribbon — gets to see the footprint before it commits.
 *
 * Published as `ctx.poi.get('compound_site')`:
 *   pos    world position, on the ground, at the gate line
 *   yaw    rotation about Y; +z of the compound's local frame runs along the road
 *   fwd    that +z as a world vector
 *   clear  radius inside which nothing may be scattered or grown
 * ============================================================================
 */

/**
 * Keep-out radius. The yard's own half-diagonal is ~33 m; this is that plus the
 * gabion revetment, the tower footprints and enough apron that the approach
 * reads as cleared ground rather than as a wall with a thicket against it.
 * A garrison that has not felled the trees around its own field of fire is not
 * a garrison anybody would be afraid of.
 */
export const COMPOUND_CLEAR = Math.hypot(YARD.halfX, YARD.halfZ) + 26;

export class CompoundSite {
  static id = 'compoundSite';

  constructor(ctx) {
    this.ctx = ctx;
    /** @type {{pos:THREE.Vector3, fwd:THREE.Vector3, yaw:number}|null} */
    this.site = null;
  }

  async init() {
    const ctx = this.ctx;
    if (!ctx.world.ready) return;
    const roads = ctx.get('roads');
    if (!roads || !roads.routes || !roads.routes.length) return;

    this._pickSite(roads);
    if (!this.site) return;

    ctx.poi.set('compound_site', {
      pos: this.site.pos.clone(),
      fwd: this.site.fwd.clone(),
      yaw: this.site.yaw,
      clear: COMPOUND_CLEAR,
    });
  }

  update() {}

  dispose() {}

  _pickSite(roads) {
    const ctx = this.ctx;
    const world = ctx.world;
    const townPOI = ctx.poi.get('town');
    const town = townPOI ? (townPOI.pos || townPOI) : new THREE.Vector3();

    let best = null;
    for (const r of roads.routes) {
      if (!r.cls || r.cls.name !== 'highway' || r.length < 200) continue;
      const end = r[r.length - 1];
      const d = Math.hypot(end.x - town.x, end.z - town.z);
      if (!best || d > best.d) best = { d, route: r };
    }
    if (!best) return;

    /*
     * SITING, and it is a design problem rather than a geometry one.
     *
     * The first version walked inward from the end of the route and took the
     * first point flat enough to build on. That reliably found somewhere flat,
     * and the flattest ground on any road is open plain — so the endgame
     * fortress ended up standing on a lakeside flat with nothing around it,
     * looking like a stock pen. Flat is a CONSTRAINT here, not the objective.
     *
     * What the shot actually needs is a PASS: ground that rises on both sides
     * of the road, so the compound plugs a gap the player can see is the only
     * way through. That is what makes the first sighting land — the wall reads
     * as closing something rather than as sitting on something.
     *
     * So: score every candidate, take the best, instead of taking the first
     * acceptable one. The flatness limit stays as a hard reject, but loose
     * enough that real terrain qualifies — the buried footings in Yard.js
     * absorb what is left of the cross-fall.
     */
    const pts = best.route;
    const ENCLOSE = 58;      // metres out to look for valley walls
    let pick = null;
    for (let i = pts.length - 10; i > pts.length * 0.50; i -= 3) {
      const p = pts[i];
      if (world.isWater(p.x, p.z)) continue;

      /* mean absolute deviation over a 22 m ring — the yard's own footprint */
      let rough = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        rough += Math.abs(
          world.getHeight(p.x + Math.cos(a) * 22, p.z + Math.sin(a) * 22) - p.y);
      }
      if (rough > 26) continue;

      /* Road direction here, and the perpendicular to look along. */
      const a2 = pts[Math.max(0, i - 4)], b2 = pts[Math.min(pts.length - 1, i + 4)];
      const fx = b2.x - a2.x, fz = b2.z - a2.z;
      const fl = Math.hypot(fx, fz) || 1;
      const nx = -fz / fl, nz = fx / fl;

      /* How enclosed: the SMALLER of the two shoulders, because a valley wall
         on one side only is a hillside, not a pass. */
      let riseL = 0, riseR = 0;
      for (const t of [0.55, 1.0]) {
        const d = ENCLOSE * t;
        riseL = Math.max(riseL, world.getHeight(p.x + nx * d, p.z + nz * d) - p.y);
        riseR = Math.max(riseR, world.getHeight(p.x - nx * d, p.z - nz * d) - p.y);
      }
      const pass = Math.min(riseL, riseR);

      /* Water in the immediate surroundings is disqualifying rather than
         merely unattractive: the garrison is meant to be blocking the road,
         and a shoreline gives the player an obvious way round the end of it. */
      let wet = false;
      for (let k = 0; k < 6 && !wet; k++) {
        const a = (k / 6) * Math.PI * 2;
        wet = world.isWater(p.x + Math.cos(a) * 70, p.z + Math.sin(a) * 70);
      }
      if (wet) continue;

      const score = pass - rough * 0.28;
      if (!pick || score > pick.score) pick = { score, p, i, fx, fz, fl };
    }

    /* Nothing scored at all — every candidate was wet or unbuildable. Rather
       than leave the game without an ending, take the flattest dry point. */
    if (!pick) {
      for (let i = pts.length - 10; i > pts.length * 0.50; i -= 3) {
        const p = pts[i];
        if (world.isWater(p.x, p.z)) continue;
        let rough = 0;
        for (let k = 0; k < 8; k++) {
          const a3 = (k / 8) * Math.PI * 2;
          rough += Math.abs(
            world.getHeight(p.x + Math.cos(a3) * 22, p.z + Math.sin(a3) * 22) - p.y);
        }
        const a2 = pts[Math.max(0, i - 4)], b2 = pts[Math.min(pts.length - 1, i + 4)];
        const fx = b2.x - a2.x, fz = b2.z - a2.z;
        const fl = Math.hypot(fx, fz) || 1;
        if (!pick || -rough > pick.score) pick = { score: -rough, p, i, fx, fz, fl };
      }
    }
    if (!pick) return;

    const { p, fx, fz, fl } = pick;
    this.site = {
      pos: new THREE.Vector3(p.x, world.getHeight(p.x, p.z), p.z),
      fwd: new THREE.Vector3(fx / fl, 0, fz / fl),
      yaw: Math.atan2(fx / fl, fz / fl),
    };
  }
}

import * as THREE from 'three';
import { rng } from '../core/Context.js';

/**
 * BROKEN ROAD — THE GARAGE
 * ============================================================================
 * Where scrap goes, and the only thing in the game that pushes back against the
 * depletion curve.
 *
 * THE PROBLEM THIS SOLVES
 * Every resource in this world is one-way. Fourteen stations hold three tanks
 * each and never refill; a hundred and ninety stashes are looted once. So the
 * ride gets longer, the margins get thinner, and nothing the player can do
 * changes the slope of that line. That is a survival slide, not a loop — it has
 * a shape but no way to answer it. The garage is the answer: every upgrade here
 * bends the curve back, and the loop closes.
 *
 * WHY THE BIKE AND NOT THE RIDER
 * There is no character progression in this game and there should not be. The
 * player has no stats to raise — no max health, no strength, no skills — so a
 * level number would be a second progression track running in parallel with the
 * machine, competing with it for the same scrap. Worse, experience points pay
 * you for kills, and this game's entire design argues the opposite: the noise
 * model says do not fight, and a system that rewards fighting would be telling
 * the player the game is wrong about itself.
 *
 * So everything is the bike, and every upgrade changes HOW YOU PLAY rather than
 * how big a number is:
 *
 *   TANK      further between stations. Buys reach.
 *   ECONOMY   the same tank lasts longer. Buys the slope of the curve itself.
 *   BAFFLE    a quieter exhaust. Buys STEALTH — it feeds straight into the
 *             Riven's perception model, which is keyed on `noise`, so this is
 *             the upgrade that changes what the world does to you rather than
 *             what you can do to it. At full baffling the bike is about as loud
 *             as a man sprinting, and the game becomes a different one.
 *   GEARING   top speed. The smallest effect, deliberately: speed is the thing
 *             players ask for and the thing that changes least about a run.
 *   TYRES     off-road grip, which is really "stop needing the Cordon's roads".
 *             It is an upgrade whose value is measured in avoided fights.
 *
 * Two of those five buy the ability to AVOID content. That ratio is on purpose.
 * ============================================================================
 */

/**
 * The upgrade tracks.
 *
 * `mult` is the multiplier at each level, index 0 being stock. Costs escalate
 * steeply enough that a full build of everything is not reachable in one
 * playthrough — the player has to decide what kind of rider they are, which is
 * the only interesting thing a shop can ask.
 */
export const TRACKS = {
  tank: {
    label: 'Tank', blurb: 'Further between stations',
    mult: [1.00, 1.28, 1.60, 2.00], cost: [0, 10, 22, 40],
  },
  economy: {
    label: 'Economy', blurb: 'The same tank, further',
    mult: [1.00, 0.86, 0.74, 0.62], cost: [0, 12, 26, 46],
  },
  baffle: {
    label: 'Baffles', blurb: 'A quieter exhaust',
    mult: [1.00, 0.78, 0.58, 0.40], cost: [0, 14, 30, 54],
  },
  gearing: {
    label: 'Gearing', blurb: 'Higher top speed',
    mult: [1.00, 1.07, 1.13, 1.20], cost: [0, 8, 18, 34],
  },
  tyres: {
    label: 'Tyres', blurb: 'Grip off the road',
    mult: [1.00, 1.12, 1.26, 1.42], cost: [0, 10, 22, 42],
  },
};

export const TRACK_KEYS = Object.keys(TRACKS);
/** How close you have to be to a bench to work on the bike. */
export const BENCH_RANGE = 3.4;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Garage {
  static id = 'garage';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x74b1e6d3) >>> 0);
    /** Current level per track, 0 = stock. */
    this.levels = {};
    for (const k of TRACK_KEYS) this.levels[k] = 0;
    this.benches = [];
    this._near = null;
    /** True while the upgrade panel is up. HUD reads it; Player freezes on it. */
    this.open = false;
    this._ready = false;
  }

  async init() {
    const ctx = this.ctx;
    ctx.on('ready', () => { this._siteBenches(); this._build(); this._ready = true; });

    this._onKey = (e) => {
      if (e.repeat) return;
      if (this.open) {
        /* 1..5 buy a track, anything else closes. Number keys rather than a
           cursor because this panel is read at a glance while something is
           probably walking toward you. */
        const n = '12345'.indexOf(e.key);
        if (n >= 0 && n < TRACK_KEYS.length) { this.buy(TRACK_KEYS[n]); return; }
        if (e.code === 'Escape' || e.code === 'KeyE') this.close();
        return;
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  /**
   * Where you can work on the bike.
   *
   * The town, and a handful of sheltered sites well off the road network. NOT
   * at the fuel stations: a bench where the petrol is would collapse the whole
   * loop into one stop, and the ride between the place you refuel and the place
   * you can improve the machine is most of what makes the map feel inhabited.
   */
  _siteBenches() {
    const ctx = this.ctx;
    const world = ctx.world;
    const roads = ctx.get('roads');
    const R = this.rand;
    /*
     * SEAT ON THE LOWEST CORNER, NOT THE CENTRE.
     *
     * A bench is one rigid mesh about a metre and a half across. Placed at the
     * height of its own centre it hangs off the downhill corner by however much
     * the ground falls under it — measured at up to 0.90 m on one of these
     * sites, which is a bench floating most of a metre in the air. Taking the
     * minimum under the footprint instead buries the uphill legs, which is
     * invisible, and the legs below run far enough down to cover it.
     *
     * The same mistake, and the same fix, as the compound's curtain wall.
     */
    /** Lowest and highest ground under the bench's footprint. */
    const foot = (x, z) => {
      let lo = Infinity, hi = -Infinity;
      for (const [dx, dz] of [[0, 0], [-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5], [1.1, 0.7]]) {
        const h = world.getHeight(x + dx, z + dz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      return { lo, hi, fall: hi - lo };
    };
    /**
     * SEAT ON THE LOWEST CORNER — and refuse the site if it is too steep to
     * seat at all.
     *
     * A bench is one rigid mesh about a metre and a half across, so placed at
     * the height of its own centre it hangs off the downhill corner by half the
     * fall under it. Taking the minimum instead buries the uphill legs, which
     * is invisible.
     *
     * But that only works while the fall is small. Measured, one of these sites
     * had 0.90 m of it — a fifty percent slope — and seating THAT at the
     * minimum puts the uphill end of the bench top at ground level. No seating
     * rule fixes a bench on a hillside; the answer is not to put one there, so
     * MAX_FALL rejects the site and the search tries somewhere else.
     */
    const MAX_FALL = 0.26;
    const put = (x, z, name) => {
      this.benches.push({
        pos: new THREE.Vector3(x, foot(x, z).lo, z),
        yaw: R() * Math.PI * 2, name,
      });
    };
    /** Nudge to the flattest spot within a few metres, for fixed placements. */
    const settle = (x, z) => {
      let best = { x, z, fall: foot(x, z).fall };
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const rad of [2.5, 5, 8]) {
          const nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
          const f = foot(nx, nz).fall;
          if (f < best.fall) best = { x: nx, z: nz, fall: f };
        }
      }
      return best;
    };

    const town = ctx.poi.get('town');
    if (town) {
      const p = town.pos || town;
      const st = settle(p.x + 6, p.z + 4);
      put(st.x, st.z, 'town');
    }
    const camp = ctx.poi.get('camp');
    if (camp) {
      const p = camp.pos || camp;
      const sc = settle(p.x + 3, p.z - 3);
      put(sc.x, sc.z, 'camp');
    }

    /* Four more on a jittered ring, rejected if they land on a road (a bench in
       the carriageway is a bench the Cordon drives past) or on bad ground. */
    const half = (world.size || 8192) * 0.5;
    let placed = 0;
    for (let i = 0; i < 40 && placed < 4; i++) {
      const a = (placed / 4) * Math.PI * 2 + R() * 1.1;
      const rad = half * (0.28 + R() * 0.42);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (world.isWater(x, z)) continue;
      if (world.getSlope(x, z) < 0.90) continue;
      const y = world.getHeight(x, z);
      if (y < (world.waterLevel || 18) + 2 || y > 700) continue;
      if (roads && roads.distance2 && roads.distance2(x, z) < 40 * 40) continue;
      if (foot(x, z).fall > MAX_FALL) continue;   // unbuildable cross-fall
      put(x, z, 'camp' + placed);
      placed++;
    }
    if (this.benches.length) {
      ctx.poi.set('bench', { pos: this.benches[0].pos.clone() });
    }
  }

  /** A trestle, a tool chest and a drum of oil. Enough to read as a workshop. */
  _build() {
    if (!this.benches.length) return;
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const mat = (proc && proc.material)
      ? proc.material('wood_weathered', {
        color: new THREE.Color(0.26, 0.22, 0.17), roughness: 0.94,
      })
      : new THREE.MeshStandardMaterial({ color: 0x42382c, roughness: 0.94 });
    this.mat = mat;

    const parts = [];
    const box = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      parts.push(g);
    };
    box(1.9, 0.09, 0.78, 0, 0.90, 0);            // bench top
    for (const [x, z] of [[-0.85, -0.30], [0.85, -0.30], [-0.85, 0.30], [0.85, 0.30]]) {
      box(0.09, 1.21, 0.09, x, 0.275, z);        // legs, buried 0.35
    }
    box(0.70, 0.55, 0.42, -0.55, 0.28, 0.72);    // tool chest
    box(0.42, 0.86, 0.42, 1.35, 0.43, 0.15);     // oil drum
    box(1.5, 0.06, 0.06, 0, 1.42, -0.42);        // a rack with parts hung on it
    for (const [x, h] of [[-0.5, 0.30], [0.1, 0.22], [0.55, 0.34]]) {
      box(0.05, h, 0.05, x, 1.42 - h * 0.5, -0.42);
    }

    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2), idx = new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, vo * 3);
      nrm.set(g.attributes.normal.array, vo * 3);
      uv.set(g.attributes.uv.array, vo * 2);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.InstancedMesh(geo, mat, this.benches.length);
    mesh.name = 'garage:bench';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < this.benches.length; i++) {
      const b = this.benches[i];
      _q.setFromAxisAngle(UP, b.yaw);
      _m.compose(b.pos, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    ctx.scene.add(mesh);
    this.mesh = mesh;
    const L = ctx.get('lighting');
    if (L && L.requestShadowCaster) L.requestShadowCaster(mesh);
  }

  /* -------------------------------------------------------------- contract */

  /** The multiplier a track currently supplies. Read every fixed step. */
  mult(track) {
    const T = TRACKS[track];
    if (!T) return 1;
    return T.mult[this.levels[track] || 0];
  }

  /** What the next level of a track costs, or null if it is maxed. */
  costOf(track) {
    const T = TRACKS[track];
    if (!T) return null;
    const next = (this.levels[track] || 0) + 1;
    return next < T.mult.length ? T.cost[next] : null;
  }

  /** The bench in range, or null. */
  nearest() { return this._near; }

  /**
   * Buy the next level of a track.
   * @returns {boolean} false if maxed, unaffordable, or nowhere to do the work
   */
  buy(track) {
    const hud = this.ctx.get('hud');
    const loot = this.ctx.get('loot');
    const T = TRACKS[track];
    if (!T || !this._near || !loot) return false;
    const cost = this.costOf(track);
    if (cost == null) {
      if (hud && hud.notify) hud.notify(`${T.label} is as good as it gets`);
      return false;
    }
    if (!loot.take('scrap', cost)) {
      if (hud && hud.notify) hud.notify(`Need ${cost} scrap`);
      return false;
    }
    this.levels[track] = (this.levels[track] || 0) + 1;
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('anvil', { position: this._near.pos, volume: 0.5, pitch: 1.1 });
    if (hud && hud.notify) {
      hud.notify(`${T.label} ${'I'.repeat(this.levels[track])} — ${T.blurb}`);
    }
    this.ctx.emit('upgraded', { track, level: this.levels[track] });
    return true;
  }

  openPanel() {
    if (!this._near) return false;
    this.open = true;
    return true;
  }

  close() { this.open = false; }

  /** Rough measure of how far along the build is, 0..1. For the endgame gate. */
  readiness() {
    let have = 0, max = 0;
    for (const k of TRACK_KEYS) {
      have += this.levels[k];
      max += TRACKS[k].mult.length - 1;
    }
    return max ? have / max : 0;
  }

  stats() {
    return { levels: { ...this.levels }, readiness: this.readiness() };
  }

  update() {
    if (!this._ready) return;
    const p = this.ctx.player.position;
    let near = null, nd = BENCH_RANGE * BENCH_RANGE;
    /* Only on foot: you cannot rebuild the machine while sitting on it. */
    if (this.ctx.player.mode === 'onFoot') {
      for (const b of this.benches) {
        const dx = b.pos.x - p.x, dz = b.pos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nd) { nd = d2; near = b; }
      }
    }
    this._near = near;
    /* Walking away closes the panel — nobody should have to find the key. */
    if (this.open && !near) this.open = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    if (this.mesh) {
      this.ctx.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.mat) this.mat.dispose();
  }
}

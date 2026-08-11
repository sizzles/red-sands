import * as THREE from 'three';
import { rng } from '../core/Context.js';

/**
 * BROKEN ROAD — THE GUNSMITH
 * ============================================================================
 * The other bench. The garage turns scrap into a better machine; this turns it
 * into a better rifle, and the two compete for the same scrap, which is the
 * whole point of having both.
 *
 * WHY IT IS A BENCH AND NOT A SHOP
 * There is no trader in this world and there should not be. Every resource here
 * depletes — stations never refill, a stash is looted once, and the arithmetic
 * of that is most of what makes riding anywhere a decision. A vendor with stock
 * is an infinite tap, and one infinite tap drains the meaning out of every
 * finite one. So scrap buys PERMANENT CAPABILITY and never consumables, exactly
 * as the garage does. You cannot buy bullets. You can buy a rifle that wastes
 * fewer of them.
 *
 * WHY THESE FIVE TRACKS
 * None of them is a damage number, and that is deliberate. The rifle already
 * kills a stray in one hit to the head and three to the body; making it four or
 * two changes nothing about how a fight goes. What decides fights here is the
 * AMMUNITION ECONOMY and the noise, so that is what is for sale:
 *
 *   RELOAD   You die during reloads, not between them. A lever gun thumbed
 *            one round at a time through a loading gate is the longest window
 *            of helplessness in the game.
 *   TUBE     Eight rounds is one pack of strays if you are calm and half a pack
 *            if you are not.
 *   SALVAGE  Brass recovered from stashes. Bends the depletion curve without
 *            breaking it, because it scales with how much you have already
 *            fired rather than with time.
 *   REPORT   The gunsmith's answer to the garage's baffles, and the same trick:
 *            it changes how the WORLD responds rather than what the gun does.
 *            A shot currently wakes everything inside 220 m. At full work that
 *            is 88 m, which is the difference between thinning a pack and
 *            calling the whole hillside down on yourself.
 *   SIGHTS   Tighter cone, so the hip shot you take when something is already
 *            on you is worth taking.
 * ============================================================================
 */

export const GUN_TRACKS = {
  reload: {
    label: 'Loading gate', blurb: 'Thumb them in faster',
    mult: [1.00, 0.84, 0.71, 0.60], cost: [0, 8, 18, 32],
  },
  tube: {
    label: 'Magazine tube', blurb: 'More before you stop',
    mult: [1.00, 1.25, 1.50, 1.75], cost: [0, 10, 22, 40],
  },
  salvage: {
    label: 'Reloading kit', blurb: 'Brass back out of the stashes',
    mult: [0.00, 0.18, 0.34, 0.50], cost: [0, 12, 26, 44],
  },
  report: {
    label: 'Baffled barrel', blurb: 'Heard less far',
    mult: [1.00, 0.74, 0.55, 0.40], cost: [0, 14, 30, 52],
  },
  sights: {
    label: 'Sights', blurb: 'Tighter from the hip',
    mult: [1.00, 0.80, 0.66, 0.54], cost: [0, 9, 20, 36],
  },
};

export const GUN_KEYS = Object.keys(GUN_TRACKS);
/** How close you have to be to the vice to work on the rifle. */
export const GUN_RANGE = 3.2;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Gunsmith {
  static id = 'gunsmith';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x51d3ae07) >>> 0);
    this.levels = {};
    for (const k of GUN_KEYS) this.levels[k] = 0;
    this.benches = [];
    this._near = null;
    /** True while the panel is up. HUD reads it; Player freezes on it. */
    this.open = false;
    this._ready = false;
  }

  async init() {
    const ctx = this.ctx;
    ctx.on('ready', () => { this._siteBenches(); this._build(); this._ready = true; });

    this._onKey = (e) => {
      if (e.repeat) return;
      if (!this.open) return;
      const n = '12345'.indexOf(e.key);
      if (n >= 0 && n < GUN_KEYS.length) { this.buy(GUN_KEYS[n]); return; }
      if (e.code === 'Escape' || e.code === 'KeyE') this.close();
    };
    window.addEventListener('keydown', this._onKey);
  }

  /**
   * Where the vices are.
   *
   * DELIBERATELY NOT WHERE THE BIKE BENCHES ARE. Two workbenches in one place
   * is one stop, and one stop is a menu; two places you have to choose between
   * is a map.
   *
   * The ring benches enforce 120 m. THE TOWN ONE CANNOT — the settlement is
   * only about 130 m across, so 120 would push it out of the town entirely and
   * a new player would never find a vice at all. What it does instead is site
   * itself diametrically opposite whatever corner the garage took, which is the
   * most separation the settlement has to give: about 55 m, a walk down the
   * street rather than a different journey. That is a real compromise and it is
   * worth naming rather than pretending the number is uniform.
   *
   * (The first cut hard-coded an offset and landed 17 m from the bike bench,
   * which is the exact failure this comment claims to prevent. It was caught by
   * a boot probe measuring the distance, not by looking at it.)
   */
  _siteBenches() {
    const ctx = this.ctx;
    const world = ctx.world;
    const roads = ctx.get('roads');
    const garage = ctx.get('garage');
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
    const put = (x, z, name) => {
      let y = world.getHeight(x, z);
      for (const [dx, dz] of [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5], [1.1, 0.7]]) {
        const h = world.getHeight(x + dx, z + dz);
        if (h < y) y = h;
      }
      this.benches.push({
        pos: new THREE.Vector3(x, y, z),
        yaw: R() * Math.PI * 2, name,
      });
    };
    /** Keep clear of the bike benches, or the two collapse into one stop. */
    const farFromGarage = (x, z) => {
      if (!garage || !garage.benches) return true;
      for (const b of garage.benches) {
        const dx = b.pos.x - x, dz = b.pos.z - z;
        if (dx * dx + dz * dz < 120 * 120) return false;
      }
      return true;
    };

    const town = ctx.poi.get('town');
    if (town) {
      const p = town.pos || town;
      /* Opposite the garage's corner, as far out as the settlement allows.
         Garage sites on the same `ready` event and inits first, so its benches
         are already placed by the time this runs. */
      let ox = -34, oz = -22;
      const gTown = (garage && garage.benches)
        ? garage.benches.find((b) => b.name === 'town') : null;
      if (gTown) {
        const dx = gTown.pos.x - p.x, dz = gTown.pos.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        ox = (-dx / l) * 48; oz = (-dz / l) * 48;
      }
      put(p.x + ox, p.z + oz, 'town');
    }

    const half = (world.size || 8192) * 0.5;
    let placed = 0;
    for (let i = 0; i < 48 && placed < 3; i++) {
      const a = (placed / 3) * Math.PI * 2 + 1.9 + R() * 1.2;
      const rad = half * (0.30 + R() * 0.40);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (world.isWater(x, z)) continue;
      if (world.getSlope(x, z) < 0.90) continue;
      const y = world.getHeight(x, z);
      if (y < (world.waterLevel || 18) + 2 || y > 700) continue;
      if (roads && roads.distance2 && roads.distance2(x, z) < 40 * 40) continue;
      if (!farFromGarage(x, z)) continue;
      put(x, z, 'shed' + placed);
      placed++;
    }
    if (this.benches.length) {
      ctx.poi.set('gunbench', { pos: this.benches[0].pos.clone() });
    }
  }

  /**
   * A vice on a bench, a rack of barrels and an ammunition crate.
   *
   * The silhouette has to be different from the garage's at a glance — that one
   * is a trestle with a drum beside it. This is the rack: three verticals above
   * the bench line, which is a shape the bike bench does not have anywhere.
   */
  _build() {
    if (!this.benches.length) return;
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const mat = (proc && proc.material)
      ? proc.material('wood_weathered', {
        color: new THREE.Color(0.30, 0.25, 0.19), roughness: 0.92,
      })
      : new THREE.MeshStandardMaterial({ color: 0x4a3d2e, roughness: 0.92 });
    this.mat = mat;

    const parts = [];
    const box = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      parts.push(g);
    };
    box(1.7, 0.10, 0.70, 0, 0.88, 0);              // bench top
    for (const [x, z] of [[-0.75, -0.26], [0.75, -0.26], [-0.75, 0.26], [0.75, 0.26]]) {
      box(0.10, 1.16, 0.10, x, 0.275, z);          // legs, buried 0.33
    }
    box(0.22, 0.26, 0.22, -0.58, 1.06, 0.02);      // the vice, jaws up
    box(0.30, 0.06, 0.10, -0.58, 1.22, 0.02);
    box(0.62, 0.34, 0.44, 0.66, 0.17, 0.60);       // ammunition crate
    box(0.66, 0.05, 0.48, 0.66, 0.36, 0.60);       // its lid, ajar
    /* the barrel rack — the tell */
    box(1.5, 0.07, 0.09, 0, 1.62, -0.40);
    for (const [x, h] of [[-0.52, 0.74], [-0.05, 0.66], [0.44, 0.80]]) {
      box(0.045, h, 0.045, x, 1.62 - h * 0.5, -0.40);
    }
    box(0.10, 0.90, 0.10, 0.95, 0.45, -0.40);      // a post the rack hangs off

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
    mesh.name = 'gunsmith:bench';
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
    const T = GUN_TRACKS[track];
    if (!T) return 1;
    return T.mult[this.levels[track] || 0];
  }

  /** What the next level of a track costs, or null if it is maxed. */
  costOf(track) {
    const T = GUN_TRACKS[track];
    if (!T) return null;
    const next = (this.levels[track] || 0) + 1;
    return next < T.mult.length ? T.cost[next] : null;
  }

  /** The bench in range, or null. */
  nearest() { return this._near; }

  buy(track) {
    const hud = this.ctx.get('hud');
    const loot = this.ctx.get('loot');
    const T = GUN_TRACKS[track];
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
    if (A && A.play) A.play('anvil', { position: this._near.pos, volume: 0.42, pitch: 1.35 });
    if (hud && hud.notify) {
      hud.notify(`${T.label} ${'I'.repeat(this.levels[track])} — ${T.blurb}`);
    }
    this.ctx.emit('gunUpgraded', { track, level: this.levels[track] });
    return true;
  }

  openPanel() {
    if (!this._near) return false;
    this.open = true;
    return true;
  }

  close() { this.open = false; }

  /** How far along the rifle is, 0..1. Feeds the compound's readiness call. */
  readiness() {
    let have = 0, max = 0;
    for (const k of GUN_KEYS) {
      have += this.levels[k];
      max += GUN_TRACKS[k].mult.length - 1;
    }
    return max ? have / max : 0;
  }

  stats() {
    return { levels: { ...this.levels }, readiness: this.readiness() };
  }

  update() {
    if (!this._ready) return;
    const p = this.ctx.player.position;
    let near = null, nd = GUN_RANGE * GUN_RANGE;
    /* On foot only — you do not work a vice from the saddle. */
    if (this.ctx.player.mode === 'onFoot') {
      for (const b of this.benches) {
        const dx = b.pos.x - p.x, dz = b.pos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nd) { nd = d2; near = b; }
      }
    }
    this._near = near;
    if (this.open && !near) this.open = false;
    void _v;
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

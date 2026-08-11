import * as THREE from 'three';
import { rng } from '../core/Context.js';

/**
 * BROKEN ROAD — SCAVENGING
 * ============================================================================
 * The economy is four things and they are all scarce:
 *
 *   fuel     petrol, in jerry cans. Refills the bike. Without it you walk.
 *   ammo     rifle rounds. Without them every fight is one you have to avoid.
 *   scrap    parts and wire. Repairs.
 *   meds     bandages and pills. The only way to get health back quickly.
 *
 * WHY IT IS PLACED AND NOT RANDOM
 * Every stash sits at a deterministic world position derived from a jittered
 * grid, filtered by whether that spot is somewhere a person would plausibly
 * have left something — near the road, near the town, near water, off the
 * open ground. Fixed positions mean the map becomes knowledge: "there is fuel
 * in the wreck by the river bend" is only useful if it is still true tomorrow.
 * Loot that respawns wherever the player happens to be standing teaches
 * nothing and is worth nothing.
 *
 * The catch — and it is deliberately a nasty one — is that the model that
 * decides where a nest goes and the model that decides where a stash goes are
 * BOTH "somewhere sheltered a person would have used". So the two correlate,
 * and the best loot in the world is disproportionately inside the worst places
 * to be. Nobody had to author that; it falls out of both systems being honest
 * about the same terrain.
 *
 * RENDERING
 * One InstancedMesh per container type, positions written once at init and
 * only touched again when something is looted. Cost is two draw calls and no
 * per-frame CPU beyond a proximity check against the handful of stashes
 * actually near the player.
 * ============================================================================
 */

/** What a stash can hold, and how the HUD should name it. */
export const RESOURCES = {
  fuel: { label: 'Fuel', max: 4 },
  ammo: { label: 'Rounds', max: 60 },
  scrap: { label: 'Scrap', max: 30 },
  meds: { label: 'Meds', max: 6 },
};

/**
 * Stash archetypes. `weight` is how common, `roll` is what it yields.
 * The rolls are deliberately lopsided: fuel is the bottleneck, so it comes in
 * ones and never in quantity, while ammo comes in useful handfuls. A player
 * should always be a little short of petrol and occasionally flush with
 * everything else.
 */
const KINDS = [
  {
    name: 'can', weight: 0.30, label: 'Fuel can',
    roll: () => ({ fuel: 1 }),
  },
  {
    name: 'crate', weight: 0.34, label: 'Supply crate',
    roll: (r) => ({ ammo: 4 + Math.floor(r() * 9), scrap: Math.floor(r() * 5) }),
  },
  {
    name: 'pack', weight: 0.24, label: 'Abandoned pack',
    roll: (r) => ({ meds: r() < 0.55 ? 1 : 0, scrap: 1 + Math.floor(r() * 4), ammo: Math.floor(r() * 5) }),
  },
  {
    name: 'wreck', weight: 0.12, label: 'Wrecked car',
    roll: (r) => ({ fuel: r() < 0.62 ? 1 : 0, scrap: 3 + Math.floor(r() * 7), ammo: Math.floor(r() * 4) }),
  },
];

/** How close you have to be to loot something. */
export const LOOT_RANGE = 2.4;
/** How many stashes exist in the world at once. */
const STASH_COUNT = 190;
/** Beyond this the mesh instance is parked; the stash itself persists. */
const DRAW_RANGE = 260;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const SIDE = new THREE.Vector3(1, 0, 0);
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class Loot {
  static id = 'loot';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x1d7f04c9) >>> 0);
    /** The player's pack. Read by HUD, Bike (fuel) and Weapon (ammo). */
    this.inventory = { fuel: 1, ammo: 24, scrap: 3, meds: 1 };
    /** Rounds fired since the last salvage. Feeds the gunsmith's kit. */
    this._spentTotal = 0;
    this.stashes = [];
    this._near = null;
    this._ready = false;
    this.looted = 0;
  }

  /* ------------------------------------------------------------------ init */

  async init() {
    const ctx = this.ctx;
    this._buildMeshes();
    ctx.on('ready', () => {
      this._place();
      this._ready = true;
    });
    this._onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyQ') this.useMeds();
    };
    window.addEventListener('keydown', this._onKey);
  }

  /**
   * Container geometry. Four crude shapes, but they are crude in *different*
   * silhouettes — the player has to be able to tell a fuel can from a crate at
   * thirty metres or scavenging becomes a chore of walking up to everything.
   */
  _buildMeshes() {
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const mk = (n, o) => (proc && proc.material ? proc.material(n, o)
      : new THREE.MeshStandardMaterial(o));

    const geos = {
      /* A jerry can: tall, narrow, unmistakable, and the one the player most
         wants to spot. Given a slight lean so it never reads as level-set. */
      can: (() => {
        const g = new THREE.BoxGeometry(0.17, 0.42, 0.30);
        const spout = new THREE.BoxGeometry(0.07, 0.09, 0.09);
        spout.translate(0, 0.24, 0.10);
        return mergeSafe([g, spout]);
      })(),
      crate: new THREE.BoxGeometry(0.62, 0.42, 0.44),
      pack: (() => {
        const g = new THREE.SphereGeometry(0.24, 10, 7);
        g.scale(1, 0.78, 0.72);
        return g;
      })(),
      wreck: (() => {
        /* Not a car — the burnt-out shell of one, which is all that is left. */
        const body = new THREE.BoxGeometry(1.85, 0.62, 0.95);
        body.translate(0, 0.42, 0);
        const cab = new THREE.BoxGeometry(0.95, 0.46, 0.86);
        cab.translate(-0.15, 0.90, 0);
        return mergeSafe([body, cab]);
      })(),
    };

    const mats = {
      can: mk('metal_rusted', { color: new THREE.Color(0.24, 0.17, 0.11), roughness: 0.88 }),
      crate: mk('wood_weathered', { color: new THREE.Color(0.22, 0.19, 0.15), roughness: 0.93 }),
      pack: mk('canvas_tent', { color: new THREE.Color(0.20, 0.19, 0.16), roughness: 0.95 }),
      wreck: mk('metal_rusted', { color: new THREE.Color(0.16, 0.14, 0.13), roughness: 0.92 }),
    };

    this.meshes = {};
    for (const k of Object.keys(geos)) {
      const cap = k === 'wreck' ? 40 : 90;
      const mesh = new THREE.InstancedMesh(geos[k], mats[k], cap);
      mesh.name = 'loot:' + k;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _HIDE);
      mesh.instanceMatrix.needsUpdate = true;
      ctx.scene.add(mesh);
      this.meshes[k] = { mesh, cap, used: 0 };
      const L = ctx.get('lighting');
      if (L && L.requestShadowCaster) L.requestShadowCaster(mesh);
    }
    this.mats = mats;
  }

  /* -------------------------------------------------------------- placement */

  /**
   * Score a candidate site for "would somebody have left something here".
   *
   * The features are all things the player can read from the saddle, which is
   * the point: the scoring is not a secret, it is a language. Flat ground near
   * water, in the trees, off the open pumice.
   */
  _siteScore(x, z) {
    const w = this.ctx.world;
    const slope = w.getSlope(x, z);
    if (slope < 0.86) return -1;                       // nothing balances on a bank
    const y = w.getHeight(x, z);
    if (y < (w.waterLevel || 18) + 1.2) return -1;     // not underwater
    if (y > 920) return -1;                            // not on the ice
    const surf = w.getSurface(x, z);
    let s = 1;
    s += (surf.grass || 0) * 0.6;                      // vegetated, sheltered
    s -= (surf.sand || 0) * 0.9;                       // open ash flats: exposed
    s -= (surf.snow || 0) * 1.2;
    s += (surf.dirt || 0) * 0.35;                      // tracks and washes
    return s;
  }

  /**
   * Scatter the stashes. Runs once, at `ready`, over a jittered grid: a grid
   * because it guarantees the whole map is covered rather than clumping the
   * way pure rejection sampling does, and jittered because a visible lattice
   * of loot would be worse than none at all.
   */
  _place() {
    const w = this.ctx.world;
    const half = (w.size || 8192) * 0.5;
    const R = this.rand;
    const G = Math.ceil(Math.sqrt(STASH_COUNT * 2.2));
    const cell = (half * 2) / G;
    const totalW = KINDS.reduce((t, k) => t + k.weight, 0);

    for (let j = 0; j < G && this.stashes.length < STASH_COUNT; j++) {
      for (let i = 0; i < G && this.stashes.length < STASH_COUNT; i++) {
        /* Two tries per cell, best site wins — enough to reject the obviously
           bad spots without turning placement into a search. */
        let bx = 0, bz = 0, bs = -1;
        for (let t = 0; t < 2; t++) {
          const x = -half + (i + R()) * cell;
          const z = -half + (j + R()) * cell;
          const s = this._siteScore(x, z) + R() * 0.4;
          if (s > bs) { bs = s; bx = x; bz = z; }
        }
        if (bs <= 0) continue;

        let r = R() * totalW, kind = KINDS[0];
        for (const k of KINDS) { r -= k.weight; if (r <= 0) { kind = k; break; } }
        /* A wreck belongs on something a vehicle could have reached. */
        if (kind.name === 'wreck' && w.getSlope(bx, bz) < 0.94) kind = KINDS[1];

        const slot = this.meshes[kind.name];
        if (!slot || slot.used >= slot.cap) continue;

        const st = {
          kind, index: slot.used++,
          pos: new THREE.Vector3(bx, w.getHeight(bx, bz), bz),
          yaw: R() * Math.PI * 2,
          tilt: (R() - 0.5) * 0.22,
          scale: 0.92 + R() * 0.2,
          contents: kind.roll(R),
          taken: false,
          drawn: false,
        };
        /* Drop anything empty rather than leaving a container that gives you
           nothing — an empty box is a broken promise, not a design choice. */
        let any = 0;
        for (const key in st.contents) any += st.contents[key] || 0;
        if (!any) st.contents = { scrap: 1 };
        this.stashes.push(st);
      }
    }
    this._writeAll();
    if (this.stashes.length) {
      this.ctx.poi.set('stash', { pos: this.stashes[0].pos.clone() });
    }
  }

  _writeAll() {
    for (const st of this.stashes) this._write(st);
    for (const k in this.meshes) this.meshes[k].mesh.instanceMatrix.needsUpdate = true;
  }

  _write(st) {
    const mesh = this.meshes[st.kind.name].mesh;
    if (st.taken || !st.drawn) { mesh.setMatrixAt(st.index, _HIDE); return; }
    _q.setFromAxisAngle(UP, st.yaw);
    _q2.setFromAxisAngle(SIDE, st.tilt);
    _q.multiply(_q2);
    _s.set(st.scale, st.scale, st.scale);
    _m.compose(st.pos, _q, _s);
    mesh.setMatrixAt(st.index, _m);
  }

  /* ----------------------------------------------------------------- frame */

  update() {
    if (!this._ready) return;
    const p = this.ctx.player.position;
    let near = null, nd = LOOT_RANGE * LOOT_RANGE;
    let dirty = {};

    for (const st of this.stashes) {
      if (st.taken) continue;
      const dx = st.pos.x - p.x, dz = st.pos.z - p.z;
      const d2 = dx * dx + dz * dz;
      /* Stream the instance in and out. The stash object always exists; only
         its matrix comes and goes, so nothing is ever forgotten. */
      const want = d2 < DRAW_RANGE * DRAW_RANGE;
      if (want !== st.drawn) {
        st.drawn = want;
        this._write(st);
        dirty[st.kind.name] = 1;
      }
      if (d2 < nd) { nd = d2; near = st; }
    }
    for (const k in dirty) this.meshes[k].mesh.instanceMatrix.needsUpdate = true;

    /* Only offer the prompt on foot — you do not rummage through a crate at
       fifty kilometres an hour. */
    this._near = (this.ctx.player.mode === 'onFoot') ? near : null;

    this._syncAmmo();
  }

  /**
   * Keep the rifle's spare rounds and the pack's ammo the same number.
   *
   * The weapon owns `reserve` and decrements it one cartridge at a time as the
   * loading gate animation runs, which is exactly the behaviour we want to
   * keep — so rather than reaching in and rewriting how it reloads, this
   * watches for the decrement, charges the pack for it, and writes the pack's
   * total back. The weapon never learns that an inventory exists, and the
   * inventory never has to understand a reload.
   */
  _syncAmmo() {
    const pl = this.ctx.get('player');
    const wp = pl && pl.weapon;
    if (!wp) return;
    if (this._lastReserve == null) {
      /* First frame: the pack is the authority, not the weapon's default. */
      this._lastReserve = this.inventory.ammo;
      wp.reserve = this.inventory.ammo;
      return;
    }
    const spent = this._lastReserve - wp.reserve;
    if (spent > 0) {
      this.take('ammo', Math.min(spent, this.inventory.ammo));
      /* Running tally of brass on the ground, for the salvage track above. */
      this._spentTotal = (this._spentTotal || 0) + spent;
    }
    wp.reserve = this.inventory.ammo;
    this._lastReserve = wp.reserve;
  }

  /* ------------------------------------------------------------- interface */

  /** The stash the player could take right now, or null. Read by the HUD. */
  nearest() { return this._near; }

  /**
   * Take the nearby stash.
   * @returns {object|null} what was gained, for the notification
   */
  collect(stash) {
    const st = stash || this._near;
    if (!st || st.taken) return null;
    /*
     * SALVAGE. The gunsmith's reloading kit turns a stash into slightly more
     * brass than it held, scaled by how much you have actually FIRED — it is a
     * fraction of your spent rounds, not a flat bonus, so it bends the
     * depletion curve without flattening it. A player who has not shot anything
     * gets nothing back, which is the property that keeps it honest.
     */
    const GS = this.ctx.get('gunsmith');
    const sal = GS ? GS.mult('salvage') : 0;
    if (sal > 0 && this._spentTotal > 0) {
      const back = Math.floor(this._spentTotal * sal);
      if (back > 0) {
        st.contents.ammo = (st.contents.ammo | 0) + back;
        this._spentTotal -= Math.round(back / sal);
      }
    }
    const gained = {};
    for (const k in st.contents) {
      const n = st.contents[k] | 0;
      if (!n) continue;
      const cap = RESOURCES[k] ? RESOURCES[k].max : 99;
      const before = this.inventory[k] || 0;
      const after = Math.min(cap, before + n);
      if (after > before) gained[k] = after - before;
      this.inventory[k] = after;
    }
    st.taken = true;
    this._write(st);
    this.meshes[st.kind.name].mesh.instanceMatrix.needsUpdate = true;
    this._near = null;
    this.looted++;

    const A = this.ctx.get('audio');
    if (A && A.play) A.play('leather', { position: st.pos, volume: 0.5, pitch: 1.05 });
    const hud = this.ctx.get('hud');
    if (hud && hud.notify) {
      const parts = Object.keys(gained).map((k) => `+${gained[k]} ${RESOURCES[k].label}`);
      hud.notify(parts.length ? parts.join('   ') : 'Nothing left');
    }
    /*
     * Rummaging is not quiet. Looting a crate is roughly as loud as walking,
     * which matters because the stashes and the nests are in the same kind of
     * place — see the header.
     */
    const F = this.ctx.get('riven');
    if (F && F.alarm) F.alarm(st.pos, 34, 0.5);
    this.ctx.emit('looted', { kind: st.kind.name, gained, position: st.pos.clone() });
    return gained;
  }

  /**
   * Spend from the pack.
   * @returns {boolean} false if there was not enough
   */
  take(resource, n = 1) {
    const have = this.inventory[resource] || 0;
    if (have < n) return false;
    this.inventory[resource] = have - n;
    return true;
  }

  /** Put something in, respecting the cap. @returns {number} how much fitted */
  give(resource, n = 1) {
    const cap = RESOURCES[resource] ? RESOURCES[resource].max : 99;
    const before = this.inventory[resource] || 0;
    this.inventory[resource] = Math.min(cap, before + n);
    return this.inventory[resource] - before;
  }

  /** Patch yourself up. Slow to matter, which is why it costs a bandage. */
  useMeds() {
    const hud = this.ctx.get('hud');
    if (!hud) return false;
    if ((hud.health || 1) > 0.985) {
      if (hud.notify) hud.notify('No need');
      return false;
    }
    if (!this.take('meds', 1)) {
      if (hud.notify) hud.notify('No bandages');
      return false;
    }
    hud.health = Math.min(1, (hud.health || 0) + 0.42);
    if (hud._coresHold != null) hud._coresHold = 3;
    if (hud.notify) hud.notify('Patched up');
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('leather', { position: this.ctx.player.position, volume: 0.4, pitch: 0.9 });
    return true;
  }

  /**
   * Something died and left what it was carrying. Infected were people, and
   * the things in their pockets are the reason to take the fight rather than
   * run from it — which is the only counterweight the ammo economy has.
   */
  dropFrom(pos, type) {
    const R = this.rand;
    if (R() > (type === 'harrow' ? 0.62 : 0.28)) return null;
    const gained = {};
    if (R() < 0.45) gained.ammo = 1 + Math.floor(R() * 3);
    if (R() < 0.30) gained.scrap = 1 + Math.floor(R() * 2);
    if (type === 'harrow' && R() < 0.4) gained.meds = 1;
    let any = 0;
    for (const k in gained) any += gained[k];
    if (!any) return null;
    for (const k in gained) this.give(k, gained[k]);
    const hud = this.ctx.get('hud');
    if (hud && hud.notify) {
      hud.notify(Object.keys(gained).map((k) => `+${gained[k]} ${RESOURCES[k].label}`).join('   '));
    }
    void pos;
    return gained;
  }

  stats() {
    let left = 0;
    for (const st of this.stashes) if (!st.taken) left++;
    return { inventory: { ...this.inventory }, remaining: left, looted: this.looted };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    for (const k in this.meshes) {
      const m = this.meshes[k].mesh;
      this.ctx.scene.remove(m);
      m.geometry.dispose();
    }
    for (const k in this.mats) this.mats[k].dispose();
  }
}

/** Merge without importing the utils module for two boxes. */
function mergeSafe(geos) {
  let total = 0, idxTotal = 0;
  for (const g of geos) { total += g.attributes.position.count; idxTotal += g.index.count; }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = new Uint16Array(idxTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : null;
    pos.set(p, vo * 3); nrm.set(n, vo * 3);
    if (u) uv.set(u, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
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

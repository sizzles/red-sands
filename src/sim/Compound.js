import * as THREE from 'three';
import { rng } from '../core/Context.js';
import { buildCompound, YARD } from './compound/CompoundBuild.js';

/**
 * BROKEN ROAD — THE COMPOUND, AND THE END OF THE GAME
 * ============================================================================
 * The Cordon's own position, built across the head of the pass — the only road
 * out of the valley. It is the map's destination and the game's ending.
 *
 * WHY THE GAME NEEDS ONE
 * Everything in this world depletes: stations never refill, stashes are looted
 * once, and the garage bends that curve but cannot reverse it. A world like
 * that with no terminal state is a slide with no bottom — the player eventually
 * runs out of reasons before they run out of fuel. The compound gives the
 * accumulation a purpose and the map an edge that means something, so "am I
 * ready yet?" becomes a question with an answer instead of a mood.
 *
 * WHAT IT IS NOT GATED ON
 * Not a level, not a quest flag, not a key item. There is no experience system
 * in this game on purpose (see Garage.js), and a door that opens because a
 * counter reached five is a door that teaches the player nothing. The compound
 * is open from the first minute and will simply kill you: it holds the densest
 * garrison in the world, in the open, with towers and floodlights. Readiness is
 * measured the only honest way — in the fuel to get here and back, the ammo to
 * get through, and how much bike you have bought. The HUD offers an assessment
 * when you arrive; it does not enforce one.
 *
 * THE GATE opens when the garrison inside is dead, and not before. That is the
 * whole objective and it needs no explanation beyond seeing it.
 *
 * AND THE RIVEN ARE INVITED. A fight here is the loudest thing that has ever
 * happened in this valley — a dozen rifles, in the open, at length — and
 * Cordon._fire alarms the Riven at 260 m every time one of them pulls a
 * trigger. Nobody scripted a third act; it arrives on its own, and the honest
 * way to take this place may well be to start the fight and then leave.
 * ============================================================================
 */

/** How far past the gate you have to get for it to count as out. */
const ESCAPE = 46;
/** Radius within which Cordon count as the garrison. */
const YARD_R = 40;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Compound {
  static id = 'compound';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x2b7fd105) >>> 0);
    this.site = null;
    /** 0 shut, 1 fully open. */
    this.gateOpen = 0;
    this.cleared = false;
    this.escaped = false;
    this._ready = false;
    this._seen = false;
    this._defenders = 0;
  }

  async init() {
    const ctx = this.ctx;
    if (!ctx.world.ready) return;
    const roads = ctx.get('roads');
    if (!roads || !roads.routes || !roads.routes.length) return;

    this._pickSite(roads);
    if (!this.site) return;
    this._build();
    this._garrison();
    this._ready = true;

    ctx.poi.set('compound', {
      pos: this.site.pos.clone().addScaledVector(this.site.fwd, -70).setY(
        ctx.world.getHeight(
          this.site.pos.x - this.site.fwd.x * 70,
          this.site.pos.z - this.site.fwd.z * 70) + 6),
      look: this.site.pos.clone(),
    });
  }

  /**
   * Put it at the far end of the pass.
   *
   * The pass highway is the one that climbs east over the volcanic crest, and
   * its far end is where the valley stops being the valley — so the compound
   * goes near that end, facing back down the road the player will arrive on.
   * Chosen by picking the highway whose end is furthest from the town, which
   * is robust to the router deciding to take a completely different line than
   * expected.
   */
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
     * Back off the very end of the route: the last points run into the map rim
     * where the terrain ramps into the distant ranges, and a compound built on
     * a 40% slope reads as a mistake however good the geometry is. Walk inward
     * until the ground under the whole footprint is flat enough to build on.
     */
    const pts = best.route;
    for (let i = pts.length - 12; i > pts.length * 0.55; i -= 4) {
      const p = pts[i];
      let rough = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        rough += Math.abs(
          world.getHeight(p.x + Math.cos(a) * 22, p.z + Math.sin(a) * 22) - p.y);
      }
      if (rough > 34) continue;
      if (world.isWater(p.x, p.z)) continue;
      const a2 = pts[Math.max(0, i - 4)], b2 = pts[Math.min(pts.length - 1, i + 4)];
      const fx = b2.x - a2.x, fz = b2.z - a2.z;
      const fl = Math.hypot(fx, fz) || 1;
      this.site = {
        pos: new THREE.Vector3(p.x, world.getHeight(p.x, p.z), p.z),
        fwd: new THREE.Vector3(fx / fl, 0, fz / fl),
        yaw: Math.atan2(fx / fl, fz / fl),
      };
      return;
    }
  }

  _build() {
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const mk = (n, o) => (proc && proc.material ? proc.material(n, o)
      : new THREE.MeshStandardMaterial(o));
    const wall = mk('stone_block', {
      color: new THREE.Color(0.26, 0.26, 0.25), roughness: 0.93,
    });
    const steel = mk('metal_rusted', {
      color: new THREE.Color(0.22, 0.21, 0.19), roughness: 0.86, metalness: 0.5,
    });
    this.mats = { wall, steel };

    const built = buildCompound(this.rand);
    this.built = built;

    _q.setFromAxisAngle(UP, this.site.yaw);
    _m.compose(this.site.pos, _q, _s);

    this.shell = new THREE.Mesh(built.shell, wall);
    this.shell.name = 'compound:shell';
    this.shell.castShadow = true;
    this.shell.receiveShadow = true;
    this.shell.applyMatrix4(_m);
    ctx.scene.add(this.shell);

    /* The gate gets its own node so it can be raised without touching the
       wall it sits in. */
    this.gateGroup = new THREE.Group();
    this.gateGroup.position.copy(this.site.pos);
    this.gateGroup.quaternion.copy(_q);
    this.gate = new THREE.Mesh(built.gate, steel);
    this.gate.name = 'compound:gate';
    this.gate.castShadow = true;
    this.gate.receiveShadow = true;
    this.gateGroup.add(this.gate);
    ctx.scene.add(this.gateGroup);

    const L = ctx.get('lighting');
    if (L && L.requestShadowCaster) {
      L.requestShadowCaster(this.shell);
      L.requestShadowCaster(this.gate);
    }

    /*
     * FLOODLIGHTS, on at every hour. They are the only artificial light in the
     * world besides the player's own headlight and the campfires, so at night
     * the compound is visible from the far side of the pass — which is the
     * point. A player should be able to see where the game ends long before
     * they are ready to go there.
     */
    this.lights = [];
    for (const lp of built.lamps) {
      const w = lp.clone().applyMatrix4(_m);
      const l = new THREE.PointLight(0xffe8c0, 26, 62, 1.7);
      l.position.copy(w);
      ctx.scene.add(l);
      this.lights.push(l);
      if (L && L.addLight) L.addLight(l, { flicker: 0.02, radius: 62, importance: 3.0 });
    }
  }

  /**
   * Hand the garrison to the Cordon rather than growing a second soldier AI.
   *
   * They are the same faction with the same behaviour; the only thing that
   * makes this place different is how many of them there are and that they are
   * standing in a walled yard. Reusing Cordon's posts means every rule the
   * player has already learned out on the highway still applies here, which is
   * exactly what the last fight of a game should be.
   */
  _garrison() {
    const cordon = this.ctx.get('cordon');
    if (!cordon || !cordon.addPost) return;
    _q.setFromAxisAngle(UP, this.site.yaw);
    for (const p of this.built.posts) {
      _v.set(p.x, 0, p.z).applyQuaternion(_q).add(this.site.pos);
      _v.y = this.ctx.world.getHeight(_v.x, _v.z);
      cordon.addPost(_v.clone(), this.site.yaw + Math.PI, 4, 'compound');
    }
  }

  /* ----------------------------------------------------------------- frame */

  update(dt) {
    if (!this._ready) return;
    const ctx = this.ctx;
    const p = ctx.player.position;
    const site = this.site;
    const d = p.distanceTo(site.pos);

    /* How much of the garrison is left. Counting live agents inside the yard
       rather than tracking kills means the state is self-correcting: it cannot
       drift out of sync with what the player can see. */
    const cordon = ctx.get('cordon');
    let live = 0;
    if (cordon && cordon._agents) {
      for (const a of cordon._agents) {
        if (!a.alive || a.state === 4) continue;
        if (a.pos.distanceTo(site.pos) < YARD_R) live++;
      }
    }
    this._defenders = live;

    /* First sight of it, once, from far enough out to be a reveal. */
    if (!this._seen && d < 340) {
      this._seen = true;
      const hud = ctx.get('hud');
      if (hud && hud.titleCard) hud.titleCard('The Pass', 'The only road out');
    }

    /*
     * The gate opens when the yard is empty and the player is close enough to
     * have been the reason. `_engagedOnce` stops it swinging open for someone
     * who has merely ridden past before anybody spawned — posts only man when
     * the player is within a few hundred metres, so an unvisited compound
     * legitimately has nobody in it.
     */
    if (d < YARD_R * 2.2) this._engagedOnce = true;
    if (!this.cleared && this._engagedOnce && live === 0 && d < YARD_R * 2.2) {
      this.cleared = true;
      const hud = ctx.get('hud');
      if (hud && hud.notify) hud.notify('The yard is quiet. The gate is coming up.');
      const A = ctx.get('audio');
      if (A && A.play) A.play('creak', { position: site.pos, volume: 0.8, pitch: 0.5 });
      ctx.emit('compoundCleared', { position: site.pos.clone() });
    }

    const want = this.cleared ? 1 : 0;
    if (this.gateOpen !== want) {
      this.gateOpen += (want - this.gateOpen) * Math.min(1, (dt || 1 / 60) * 0.6);
      if (Math.abs(want - this.gateOpen) < 0.004) this.gateOpen = want;
      if (this.gate) this.gate.position.y = this.gateOpen * (YARD.wallH + 0.6);
    }

    /*
     * OUT. Measured along the road axis rather than as a radius, because the
     * player has to leave through the gate and not simply wander round the
     * outside of the wall — riding round it is how you avoid the compound, and
     * avoiding the compound is not finishing the game.
     */
    if (this.cleared && !this.escaped) {
      _v.subVectors(p, site.pos);
      const along = _v.x * site.fwd.x + _v.z * site.fwd.z;
      const lateral = Math.abs(_v.x * -site.fwd.z + _v.z * site.fwd.x);
      if (along > ESCAPE && lateral < YARD.halfX) this._finish();
    }
  }

  _finish() {
    this.escaped = true;
    const ctx = this.ctx;
    const hud = ctx.get('hud');
    const loot = ctx.get('loot');
    const garage = ctx.get('garage');
    const bike = ctx.get('bike');
    if (hud && hud.titleCard) {
      hud.titleCard('Broken Road', 'You made it out');
    }
    if (hud && hud.notify) hud.notify('The valley is behind you.');
    const A = ctx.get('audio');
    if (A && A.play) A.play('piano', { volume: 0.6 });
    /* Publish the run so anything that wants to show a summary can. */
    ctx.emit('escaped', {
      position: ctx.player.position.clone(),
      elapsed: ctx.time ? ctx.time.elapsed : 0,
      fuel: bike ? bike.fuel : 0,
      inventory: loot ? { ...loot.inventory } : null,
      upgrades: garage ? { ...garage.levels } : null,
    });
  }

  /** For the HUD's objective line. */
  status() {
    if (!this._ready) return null;
    return {
      seen: this._seen,
      distance: this.site
        ? this.ctx.player.position.distanceTo(this.site.pos) : Infinity,
      defenders: this._defenders,
      cleared: this.cleared,
      escaped: this.escaped,
    };
  }

  dispose() {
    const ctx = this.ctx;
    const L = ctx.get('lighting');
    for (const l of (this.lights || [])) {
      if (L && L.removeLight) L.removeLight(l);
      ctx.scene.remove(l);
    }
    if (this.shell) { ctx.scene.remove(this.shell); this.shell.geometry.dispose(); }
    if (this.gateGroup) { ctx.scene.remove(this.gateGroup); }
    if (this.gate) this.gate.geometry.dispose();
    for (const k in (this.mats || {})) this.mats[k].dispose();
  }
}

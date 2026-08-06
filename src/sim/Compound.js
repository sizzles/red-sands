import * as THREE from 'three';
import { rng } from '../core/Context.js';
import { buildYard, YARD } from './compound/Yard.js';
import { injectWear, makeKitMaterials } from '../world/build/Wear.js';

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
    /* Siting happened at order 36, before the forest and the boulders were
       placed, so they could keep off it — see sim/CompoundSite.js. */
    const cs = ctx.get('compoundSite');
    if (!cs || !cs.site) return;
    this.site = cs.site;
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
  _build() {
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const sky = ctx.get('sky');
    const L = ctx.get('lighting');

    /*
     * MATERIALS — the same kit the town uses.
     *
     * `makeKitMaterials` wires each key to a procedural texture set with its
     * albedo, normal, roughness and AO maps, and `injectWear` splices in the
     * per-pixel weathering chunk that reads the `aWear` attribute Builder
     * writes. That is where the rust runs under every fixing, the dirt splash
     * off the ground and the sun bleaching on the copings come from — none of
     * it is authored here, all of it is derived from geometry.
     *
     * `hex` breaks the texture repeat stochastically; it is worth paying for on
     * the big flat block walls, which are exactly the surfaces where a visible
     * tile is most obvious, and not worth it on the small metal parts.
     */
    const { mk } = makeKitMaterials(proc, 16);
    const DEFS = [
      ['concrete', 'stone_block', { nrm: 1.4, hex: 2.4, color: 0xa8a79c }],
      /* `metal_rusted` is authored a long way toward orange, which is right for
         a hinge on a barn and wrong for fifteen metres of tower leg — the first
         build came back reading as scaffolding. The material colour pulls it
         to olive-grey and the vertex tones carry the variation from there. */
      ['rust', 'metal_rusted', {
        nrm: 1.15, metalness: 0.24, roughness: 0.86, color: 0x5f6459,
      }],
      ['iron', 'corrugated_iron', { nrm: 1.35, metalness: 0.30, roughness: 0.64 }],
      ['bag', 'canvas_tent', { nrm: 1.1, hex: 2.0 }],
      ['gravel', 'gravel', { nrm: 1.2, hex: 3.0 }],
    ];
    this.mats = new Map();
    for (const [key, tex, over] of DEFS) {
      const opts = { hex: over.hex || 0 };
      const clean = { ...over }; delete clean.hex;
      const m = mk(key, tex, clean);
      m.name = 'compound_' + key;
      injectWear(m, opts);
      if (sky && sky.injectAerialPerspective) sky.injectAerialPerspective(m);
      if (L && L.registerMaterial) L.registerMaterial(m);
      this.mats.set(key, m);
    }
    /* the floodlight lens: emissive, so the head reads as ON from any range
       even when the point light behind it has been demoted out of the local
       light budget (which is only 4 deep on the low preset) */
    const lamp = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: new THREE.Color(1.0, 0.90, 0.72),
      emissiveIntensity: 3.4, roughness: 0.5, vertexColors: true, dithering: true,
    });
    lamp.name = 'compound_lamp';
    this.mats.set('lamp', lamp);

    /* Builder buckets by material NAME, so what buildYard needs is a map from
       its own vocabulary to bucket keys, not the materials themselves. */
    const keys = { concrete: 'concrete', rust: 'rust', iron: 'iron', bag: 'bag', gravel: 'gravel', lamp: 'lamp' };

    const built = buildYard(this.site, this.rand, keys, ctx.world.getHeight);
    this.built = built;

    /* One mesh per material bucket. Five or six draw calls for the whole
       position, against the town's fifteen for a settlement. */
    this.group = new THREE.Group();
    this.group.name = 'compound';
    this.meshes = [];
    for (const [key, geo] of built.shell) {
      const m = new THREE.Mesh(geo, this.mats.get(key));
      m.name = 'compound:' + key;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
    }
    ctx.scene.add(this.group);
    this.shell = this.meshes[0] || null;

    /*
     * COLLISION AND CIRCULATION.
     *
     * Until this pass the compound registered no colliders at all: the player
     * could ride straight through the curtain wall, the towers and the shut
     * gate, which no screenshot was ever going to reveal. The kit now emits
     * proxies alongside the mesh from the same rules (see build/Builder.js),
     * so they cannot drift apart from the geometry they stand for.
     *
     * `walkable` is what makes a surface a floor rather than only a wall —
     * Physics.deckAt reports its top as ground, so the wall walk, the tower
     * decks and the depot roof are places the garrison and the player can
     * actually stand.
     */
    this.solids = [];
    const P = ctx.get('physics');
    if (P && P.addCollider) {
      for (const q of built.plan.solids) {
        this.solids.push(P.addCollider({
          shape: 'box',
          /* `addCollider` takes the CENTRE for a box (it is the base only for a
             capsule), and Builder.solid emits centres, so this passes straight
             through. Getting it wrong here buries every proxy by half its own
             height and puts every walkable top a half-thickness low. */
          position: new THREE.Vector3(q.x, q.y, q.z),
          halfExtents: { x: q.hx, y: q.hy, z: q.hz },
          axis: [q.ax, q.az],
          walkable: q.walkable,
          tag: 'compound:' + q.tag,
        }));
      }
    }
    /* R2: every level the compound builds must be reachable from the yard.
       Cheap enough to assert at runtime, and the one failure mode that looks
       completely correct in a render. */
    if (built.nav && !built.nav.ok) {
      // eslint-disable-next-line no-console
      console.warn('[compound] unreachable levels', built.nav.unreachable,
        'dangling links', built.nav.dangling);
    }

    /* The gate gets its own node so it can be raised without touching the wall
       it sits in. Built about its own origin, placed here. */
    this.gateGroup = new THREE.Group();
    this.gateGroup.name = 'compound:gate';
    _q.setFromAxisAngle(UP, this.site.yaw);
    this.gateGroup.quaternion.copy(_q);
    _v.set(built.gateAt.x, 0, built.gateAt.z).applyQuaternion(_q).add(this.site.pos);
    this.gateGroup.position.copy(_v);
    this._gateY0 = this.gateGroup.position.y;
    this._gateLift = (built.gateH || YARD.wallH) + 0.6;
    this.gateParts = [];
    for (const [key, geo] of built.gate) {
      const m = new THREE.Mesh(geo, this.mats.get(key));
      m.castShadow = true;
      m.receiveShadow = true;
      this.gateGroup.add(m);
      this.gateParts.push(m);
    }
    this.gate = this.gateGroup;
    ctx.scene.add(this.gateGroup);

    if (L && L.requestShadowCaster) {
      for (const m of this.meshes) L.requestShadowCaster(m);
      for (const m of this.gateParts) L.requestShadowCaster(m);
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
      const w = _v.set(lp.x, lp.y, lp.z).applyQuaternion(_q).add(this.site.pos).clone();
      /*
       * Intensity is not a taste value here, it is arithmetic. These sit on the
       * tower decks, 17 m up, and three.js attenuates by distance^decay — so the
       * 26 the ground-level lanterns use arrives at the yard as 26/17^1.7, or
       * about a fifth of a unit, which is why the first night shot had four
       * glowing heads and not one lit surface anywhere. Scaled by (17/3)^1.7 to
       * put the same illuminance on the ground that a lantern puts on a table,
       * with the range opened up to cover the approach as well as the yard.
       */
      const l = new THREE.PointLight(0xffe8c0, 460, 105, 1.7);
      l.position.copy(w);
      ctx.scene.add(l);
      this.lights.push(l);
      /* Importance well above anything else in the world: the local light pool
         is only four deep on the phone preset, and the one place where being
         demoted would be visible is the one place that has four lights. */
      if (L && L.addLight) L.addLight(l, { flicker: 0.02, radius: 105, importance: 6.0 });
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
    /*
     * AND ON THE WALL. The embrasures are at standing height behind the
     * fighting step for a reason, and until the garrison could be held up by
     * something other than the hillside there was nobody to fire through them.
     * The circulation graph already knows where every level is, so the posts
     * come straight off it rather than being placed by hand and drifting.
     */
    const nodes = this.built.plan && this.built.plan.nodes;
    if (!nodes) return;
    for (const [id, n] of nodes) {
      if (n.kind !== 'walk' && n.kind !== 'deck') continue;
      _v.set(n.x, n.y + 0.05, n.z);
      cordon.addPost(_v.clone(), this.site.yaw + Math.PI,
        n.kind === 'walk' ? 3 : 1, 'compound');
      void id;
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
      if (this.gateGroup) {
        /* Lift by the leaf's OWN height, not the design wall height — the
           coping is level and the ground is not, so a gate on the downhill side
           of the site is taller than 5.4 m and would still be blocking the road
           after a 6 m lift. */
        this.gateGroup.position.y = this._gateY0 + this.gateOpen * this._gateLift;
      }
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
    if (this.group) ctx.scene.remove(this.group);
    if (this.gateGroup) ctx.scene.remove(this.gateGroup);
    for (const m of (this.meshes || [])) m.geometry.dispose();
    for (const m of (this.gateParts || [])) m.geometry.dispose();
    if (this.mats) for (const m of this.mats.values()) m.dispose();
    const P = ctx.get('physics');
    if (P && P.removeCollider) for (const c of (this.solids || [])) P.removeCollider(c);
  }
}

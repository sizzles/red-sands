import * as THREE from 'three';
import { rng } from '../core/Context.js';
import { buildCordon, patchCordonAnim, buildRoadblock } from './cordon/CordonBody.js';

/**
 * BROKEN ROAD — THE CORDON
 * ============================================================================
 * What is left of the people who enforced the quarantine, still holding the
 * roads. The bills pasted on the town walls are theirs — EVACUATION, MUSTER
 * POINT, CHECKPOINT 4 MILES NORTH — and this is who posted them, still at the
 * checkpoint, still charging for the road, with nobody left to answer to.
 *
 * WHY THEY EXIST, MECHANICALLY
 * The road network handed the player a straight upgrade: faster, better grip,
 * smoother, and no cost at all. An upgrade with no price is not a decision, it
 * is a menu. The Cordon is the price. They hold the highways — the fast roads,
 * specifically, not the logging spurs — so the fastest way anywhere is also the
 * one somebody is watching, and the two-track through the timber is slow, rough
 * and safe. That is the trade the whole road system was missing.
 *
 * HOW THEY DIFFER FROM THE RIVEN, AND WHY IT MATTERS
 * Every rule is inverted, on purpose, so that the two enemies cannot be
 * answered the same way:
 *
 *                     THE RIVEN                THE CORDON
 *   sense by          SOUND                    SIGHT
 *   crouching         hides you                does nothing at close range
 *   the bike          the worst thing you own  irrelevant — they shoot it
 *   running away      works; you are faster    does not; bullets are faster
 *   the answer        be quiet, or ride        break line of sight, or shoot
 *
 * The consequence a player discovers about two hours in is that the two
 * factions are also each other's problem. A firefight is the loudest event in
 * the world (`_fire` alarms the Riven at 260 m, further than a rifle shot from
 * the player), and the Cordon will shoot at Riven that get close. Kiting a
 * pack onto a checkpoint is a legitimate way to take one, and nobody had to
 * script it — it falls out of both systems being honest about noise.
 * ============================================================================
 */

const POST = 0, ALERT = 1, ENGAGE = 2, ADVANCE = 3, DEAD = 4;

const TYPES = {
  trooper: {
    share: 0.72,
    /** Rifle: long reach, slow rate, real damage. */
    hp: 3, range: 72, fireEvery: 1.55, damage: 0.085, accuracy: 0.55,
    speed: 3.4, sight: 88, fov: 0.16,
    scale: [0.97, 1.04],
    colour: [0.088, 0.096, 0.086],
  },
  enforcer: {
    /* Close work. Twice the health, half the reach, and it advances rather than
       holding — the one that makes staying behind cover stop working. */
    share: 0.28,
    hp: 7, range: 26, fireEvery: 0.85, damage: 0.135, accuracy: 0.42,
    speed: 4.1, sight: 62, fov: 0.24,
    scale: [1.02, 1.09],
    colour: [0.074, 0.078, 0.074],
  },
};

/** Total strength by quality preset. */
const POPULATION = { mobile: 12, low: 16, medium: 24, high: 34, ultra: 46 };

/** Checkpoints hold this many; the rest patrol between them. */
const SQUAD_MIN = 2, SQUAD_MAX = 5;
/** Beyond this a squad is culled and its slots recycled. */
const DESPAWN = 340;
/** How far a shot is heard by the Riven. Further than the player's rifle. */
const GUNSHOT_ALARM = 260;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const _UP = new THREE.Vector3(0, 1, 0);

export class Cordon {
  static id = 'cordon';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x3c9f2b17) >>> 0);
    this.enabled = true;
    this._types = new Map();
    this._agents = [];
    this._posts = [];
    this._cursor = 0;
    this._ready = false;
    /** How many currently have eyes on the player. The HUD reads it. */
    this.engaged = 0;
    this.kills = 0;
  }

  /* ------------------------------------------------------------------ init */

  async init() {
    const ctx = this.ctx;
    const q = ctx.quality || {};
    const total = POPULATION[q.name] != null ? POPULATION[q.name] : POPULATION.medium;

    for (const name of Object.keys(TYPES)) {
      const def = TYPES[name];
      const count = Math.max(2, Math.round(total * def.share));
      const geo = buildCordon(name, this.rand);

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.colour[0], def.colour[1], def.colour[2]),
        roughness: 0.88, metalness: 0.04, fog: false, dithering: true,
      });
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
      depth.userData.rsNoAerial = true;
      depth.userData.rsNoGroundFX = true;
      patchCordonAnim(mat);
      patchCordonAnim(depth);

      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.name = 'cordon:' + name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      ctx.scene.add(mesh);

      const T = { name, def, mesh, mat, geo, anim, count, agents: [] };
      for (let i = 0; i < count; i++) {
        const a = {
          type: T, slot: i, alive: false,
          pos: new THREE.Vector3(), home: new THREE.Vector3(),
          yaw: 0, scale: 1, phase: this.rand() * 6.283,
          state: POST, gait: 0, aim: 0, speed: 0,
          hp: def.hp, dead: 0, deadT: 0,
          cool: 0, alertT: 0, shuffle: 0, dist: 1e9,
          target: null,
        };
        T.agents.push(a);
        this._agents.push(a);
        mesh.setMatrixAt(i, _HIDE);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this._types.set(name, T);
    }

    ctx.on('ready', () => {
      const L = ctx.get('lighting');
      const sky = ctx.get('sky');
      const clouds = ctx.get('clouds');
      for (const [, T] of this._types) {
        if (L && L.requestShadowCaster) L.requestShadowCaster(T.mesh);
        if (sky && sky.injectAerialPerspective) sky.injectAerialPerspective(T.mat);
        if (clouds && clouds.injectGroundFX) clouds.injectGroundFX(T.mat);
      }
      this._sitePosts();
      this._buildRoadblocks();
      this._populate();
      this._ready = true;
    });

    ctx.on('teleport', () => { this._despawnAll(); this._populate(); });
    /* A rifle report tells them exactly where you are — they are trained, and
       unlike the Riven they do not need to see you first to start looking. */
    ctx.on('gunshot', (e) => {
      const p = (e && e.position) || ctx.player.position;
      this.alarm(p, 190);
    });
  }

  /* ----------------------------------------------------------------- posts */

  /**
   * Where the checkpoints are.
   *
   * On the HIGHWAYS only, and that is the whole design: the Cordon holds the
   * fast roads. A checkpoint on a logging spur would tax a road nobody was
   * choosing for speed anyway, and would break the one clean trade the map
   * offers — quick and watched, or slow and safe.
   *
   * Spaced far enough apart that a player can always see the next one coming
   * before they are inside the last one's reach.
   */
  _sitePosts() {
    const R = this.ctx.get('roads');
    const world = this.ctx.world;
    if (!R || !R.routes || !R.routes.length) return;
    const rand = this.rand;

    for (let r = 0; r < R.routes.length; r++) {
      const pts = R.routes[r];
      if (!pts.cls || pts.cls.name !== 'highway') continue;
      /* Route points are 3.5 m apart; ~1.6 km between checkpoints. */
      const stride = Math.round(1600 / 3.5);
      for (let i = Math.round(stride * (0.3 + rand() * 0.4)); i < pts.length - 20; i += stride) {
        const p = pts[i];
        /* Not on top of a fuel station — the two would fight over the same
           ground and a checkpoint at the pumps makes refuelling impossible
           rather than tense. */
        let clash = false;
        for (const st of (R.stations || [])) {
          if (st.pos.distanceTo(p) < 90) { clash = true; break; }
        }
        if (clash) continue;
        const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
        const tx = b.x - a.x, tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        this._posts.push({
          pos: new THREE.Vector3(p.x, world.getHeight(p.x, p.z), p.z),
          yaw: Math.atan2(tx / tl, tz / tl),
          size: SQUAD_MIN + Math.floor(rand() * (SQUAD_MAX - SQUAD_MIN + 1)),
        });
      }
    }
    if (this._posts.length) {
      this.ctx.poi.set('checkpoint', { pos: this._posts[0].pos.clone() });
    }
  }

  _buildRoadblocks() {
    if (!this._posts.length) return;
    const ctx = this.ctx;
    const proc = ctx.get('procTextures');
    const mat = (proc && proc.material)
      ? proc.material('stone_block', {
        color: new THREE.Color(0.30, 0.30, 0.28), roughness: 0.94,
      })
      : new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.94 });
    this.blockMat = mat;

    const geo = buildRoadblock(this.rand);
    const mesh = new THREE.InstancedMesh(geo, mat, this._posts.length);
    mesh.name = 'cordon:roadblock';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < this._posts.length; i++) {
      const p = this._posts[i];
      _q.setFromAxisAngle(_UP, p.yaw);
      _m.compose(p.pos, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    ctx.scene.add(mesh);
    this.blockMesh = mesh;
    const L = ctx.get('lighting');
    if (L && L.requestShadowCaster) L.requestShadowCaster(mesh);
  }

  /* -------------------------------------------------------------- spawning */

  _despawnAll() {
    for (const a of this._agents) {
      a.alive = false; a.state = POST; a.dead = 0; a.deadT = 0;
      a.type.mesh.setMatrixAt(a.slot, _HIDE);
    }
    for (const [, T] of this._types) T.mesh.instanceMatrix.needsUpdate = true;
  }

  _freeSlot(T) {
    for (const a of T.agents) if (!a.alive) return a;
    return null;
  }

  /**
   * Man the checkpoints that are in range.
   *
   * Unlike the Riven, the Cordon does NOT thin out by day — they are people
   * doing a job, and the job runs round the clock. What changes at night is
   * that their sight range collapses, which is the only reason to ever run a
   * checkpoint in the dark.
   */
  _populate() {
    if (!this.ctx.world.ready || !this._posts.length) return;
    const p = this.ctx.player.position;
    const rand = this.rand;

    for (const post of this._posts) {
      const d = post.pos.distanceTo(p);
      if (d > DESPAWN - 40) continue;
      if (post.manned) continue;
      post.manned = [];
      for (let k = 0; k < post.size; k++) {
        /* Roughly three riflemen to one heavy. */
        const wantHeavy = rand() < 0.28;
        const T = this._types.get(wantHeavy ? 'enforcer' : 'trooper')
          || this._types.get('trooper');
        const a = this._freeSlot(T) || this._freeSlot(this._types.get('trooper'));
        if (!a) break;
        /* Spread them round the block, mostly on the far side of it from the
           road, because that is where you stand if you are stopping traffic. */
        const ang = post.yaw + Math.PI * 0.5 + (rand() - 0.5) * 2.4;
        const rad = 3.5 + rand() * 7;
        const x = post.pos.x + Math.cos(ang) * rad;
        const z = post.pos.z + Math.sin(ang) * rad;
        this._spawn(a, x, z, post);
        post.manned.push(a);
      }
    }
  }

  _spawn(a, x, z, post) {
    const world = this.ctx.world;
    const def = a.type.def;
    const rand = this.rand;
    a.alive = true;
    a.pos.set(x, world.getHeight(x, z), z);
    a.home.copy(a.pos);
    a.post = post;
    a.yaw = post ? post.yaw + (rand() - 0.5) * 1.6 : rand() * 6.283;
    a.scale = def.scale[0] + rand() * (def.scale[1] - def.scale[0]);
    a.state = POST;
    a.gait = 0; a.aim = 0; a.speed = 0;
    a.hp = def.hp; a.dead = 0; a.deadT = 0;
    a.cool = rand() * def.fireEvery;
    a.alertT = 0; a.shuffle = rand() * 4;
    a.target = null;
  }

  /* --------------------------------------------------------------- senses */

  /** Put everything in range on alert, facing a position. */
  alarm(pos, radius = 150) {
    const r2 = radius * radius;
    for (const a of this._agents) {
      if (!a.alive || a.state === DEAD) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      if (a.state === POST) { a.state = ALERT; a.alertT = 10; }
      else a.alertT = Math.max(a.alertT, 10);
      a.yaw = Math.atan2(pos.x - a.pos.x, pos.z - a.pos.z);
    }
  }

  /**
   * Can this one see the player?
   *
   * Sight, not sound — the inverse of the Riven, and the reason crouching in a
   * bush works on one faction and not the other. Range collapses at night
   * unless the player is lit, which is what makes the headlight a genuine
   * decision on a road they hold: you can see the corners, and so can they.
   */
  _canSee(a, p) {
    const def = a.type.def;
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    a.dist = d;
    if (d > def.sight) return false;
    const light = 0.30 + (this.ctx.env.daylight || 0) * 0.70;
    let reach = def.sight * light;
    const bike = this.ctx.get('bike');
    /* A headlight at night is a target marker. */
    if (bike && bike._beam > 0.5 && this.ctx.player.mode === 'mounted') reach = def.sight * 1.15;
    if (d > reach) return false;
    /* Facing cone, generous — they are looking for people on a road. */
    const f = Math.sin(a.yaw), g = Math.cos(a.yaw);
    const dot = d > 0.01 ? (dx * f + dz * g) / d : 1;
    if (dot < def.fov && d > 12) return false;
    /* Crouching helps only at range, and only if you are still. */
    const pl = this.ctx.get('player');
    if (pl && pl.crouch > 0.5 && d > 22 && (this.ctx.player.speed01 || 0) < 0.2) return false;
    return true;
  }

  /** The nearest Riven worth shooting at instead of the player. */
  _nearestRiven(a) {
    const RV = this.ctx.get('riven');
    if (!RV || !RV.nearestTo) return null;
    return RV.nearestTo(a.pos, 34);
  }

  /* ------------------------------------------------------------------ tick */

  update(dt) {
    if (!this._ready || !this.enabled) return;
    const h = Math.min(dt || 1 / 60, 0.1);
    const ctx = this.ctx;
    const p = ctx.player.position;

    this._repop = (this._repop || 0) + h;
    if (this._repop > 3) { this._repop = 0; this._populate(); }

    let engaged = 0;
    for (const [, T] of this._types) {
      let dirty = false;
      for (const a of T.agents) {
        if (!a.alive) continue;
        this._step(a, h, p);
        if (!a.alive) { dirty = true; continue; }
        if (a.state === ENGAGE || a.state === ADVANCE) engaged++;
        this._write(a);
        dirty = true;
      }
      if (dirty) {
        T.mesh.instanceMatrix.needsUpdate = true;
        T.anim.needsUpdate = true;
      }
    }
    this.engaged = engaged;
  }

  _step(a, h, p) {
    const def = a.type.def;
    const world = this.ctx.world;
    a.cool = Math.max(0, a.cool - h);

    if (a.state === DEAD) {
      a.dead = Math.min(1, a.dead + h * 3.2);
      a.deadT += h;
      a.gait = 0; a.aim = 0;
      if (a.deadT > 30) {
        a.alive = false;
        a.type.mesh.setMatrixAt(a.slot, _HIDE);
        if (a.post && a.post.manned) {
          const i = a.post.manned.indexOf(a);
          if (i >= 0) a.post.manned.splice(i, 1);
          if (!a.post.manned.length) a.post.manned = null;
        }
      }
      return;
    }

    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    a.dist = d;
    if (d > DESPAWN) {
      a.alive = false;
      a.type.mesh.setMatrixAt(a.slot, _HIDE);
      if (a.post) a.post.manned = null;
      return;
    }

    a.alertT = Math.max(0, a.alertT - h);
    const sees = this._canSee(a, p);
    let wantSpeed = 0, tx = a.home.x, tz = a.home.z, aimWant = 0;

    /* A Riven inside 34 m outranks the player: it is about to be on them, and
       they will deal with it first. This is what makes kiting a pack onto a
       checkpoint work. */
    const riven = (a.state !== POST) ? this._nearestRiven(a) : null;
    const shootRiven = riven && (!sees || riven.dist < d * 0.6);

    switch (a.state) {
      case POST: {
        /* Standing a post: small shuffles, weapon down, watching the road. */
        a.shuffle -= h;
        if (a.shuffle <= 0) {
          a.shuffle = 3 + this.rand() * 6;
          const ang = this.rand() * Math.PI * 2;
          tx = a.home.x + Math.cos(ang) * 2.5;
          tz = a.home.z + Math.sin(ang) * 2.5;
          a.target = new THREE.Vector3(tx, 0, tz);
        }
        if (a.target) { tx = a.target.x; tz = a.target.z; }
        wantSpeed = def.speed * 0.22;
        if (sees) { a.state = ENGAGE; a.alertT = 12; this._shout(a); }
        break;
      }
      case ALERT: {
        /* Heard something. Weapon half up, moving to look. */
        aimWant = 0.45;
        wantSpeed = def.speed * 0.55;
        if (sees) { a.state = ENGAGE; a.alertT = 12; this._shout(a); }
        else if (a.alertT <= 0) a.state = POST;
        break;
      }
      case ENGAGE: {
        aimWant = 1;
        const tgt = shootRiven ? riven.pos : p;
        tx = tgt.x; tz = tgt.z;
        const range = shootRiven ? Math.hypot(riven.pos.x - a.pos.x, riven.pos.z - a.pos.z) : d;
        /* Hold ground and shoot inside range; close the distance outside it. */
        wantSpeed = range > def.range * 0.85 ? def.speed * 0.8 : 0;
        if (a.cool <= 0 && range < def.range) this._fire(a, tgt, range, shootRiven ? riven : null);
        if (!sees && !shootRiven) {
          if (a.alertT <= 0) a.state = POST;
        } else a.alertT = 12;
        /* The enforcer closes. The rifleman does not. */
        if (a.type.name === 'enforcer' && d > 8) a.state = ADVANCE;
        break;
      }
      case ADVANCE: {
        aimWant = 0.75;
        const tgt = shootRiven ? riven.pos : p;
        tx = tgt.x; tz = tgt.z;
        wantSpeed = def.speed;
        const range = Math.hypot(tx - a.pos.x, tz - a.pos.z);
        if (a.cool <= 0 && range < def.range) this._fire(a, tgt, range, shootRiven ? riven : null);
        if (range < 7 || (!sees && !shootRiven && a.alertT <= 0)) a.state = ENGAGE;
        break;
      }
      default: break;
    }

    /* ---- move ----------------------------------------------------------- */
    const ddx = tx - a.pos.x, ddz = tz - a.pos.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 0.6 && wantSpeed > 0.01) {
      const nx = ddx / dd, nz = ddz / dd;
      const slope = world.getSlope(a.pos.x, a.pos.z);
      const climb = THREE.MathUtils.clamp(slope * 1.2, 0.45, 1);
      a.speed += (wantSpeed * climb - a.speed) * Math.min(1, h * 4);
      a.pos.x += nx * a.speed * h;
      a.pos.z += nz * a.speed * h;
    } else {
      a.speed += (0 - a.speed) * Math.min(1, h * 6);
    }
    /* Always FACE the thing being aimed at, whether or not moving toward it —
       a soldier who walks backwards while shooting is still pointing the rifle
       at you, and turning the body to the target is what sells that. */
    const faceX = (a.state >= ENGAGE) ? tx - a.pos.x : ddx;
    const faceZ = (a.state >= ENGAGE) ? tz - a.pos.z : ddz;
    if (Math.abs(faceX) + Math.abs(faceZ) > 0.05) {
      const want = Math.atan2(faceX, faceZ);
      let dy = want - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, h * (a.state >= ENGAGE ? 6 : 2.6));
    }
    a.pos.y = world.getHeight(a.pos.x, a.pos.z);

    a.phase += (a.speed * h) / 1.45 * 6.2831;
    a.gait += (THREE.MathUtils.clamp(a.speed / (def.speed * 0.8), 0, 1) - a.gait)
      * Math.min(1, h * 6);
    a.aim += (aimWant - a.aim) * Math.min(1, h * 5);
  }

  _shout(a) {
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('whistle', { position: a.pos, volume: 0.55, pitch: 1.1 });
  }

  /**
   * Take a shot.
   *
   * Hitscan with a probability, not a projectile: at these ranges a rifle round
   * is effectively instantaneous, and simulating the flight would only add a
   * dodge window that no player could use and that the AI would have to be
   * nerfed to compensate for.
   *
   * Accuracy falls with range and with how fast the target is moving, so riding
   * PAST a checkpoint at speed is a genuinely better answer than stopping to
   * fight one — which is the behaviour this whole faction exists to provoke.
   */
  _fire(a, tgt, range, rivenTarget) {
    const def = a.type.def;
    a.cool = def.fireEvery * (0.75 + this.rand() * 0.5);

    const A = this.ctx.get('audio');
    if (A && A.play) {
      A.play('gunshot', { position: a.pos, volume: 0.85, pitch: 0.95 + this.rand() * 0.1 });
    }
    const PT = this.ctx.get('particles');
    if (PT && PT.burst) {
      _v.set(a.pos.x + Math.sin(a.yaw) * 0.7, a.pos.y + 1.35, a.pos.z + Math.cos(a.yaw) * 0.7);
      PT.burst('muzzle', _v, 4, { scale: 0.5 });
    }
    /*
     * THE LOUDEST THING IN THE WORLD. A firefight carries further than the
     * player's own rifle (220 m) because there is more than one of them and
     * they keep going. This single line is what turns a checkpoint into a
     * place the Riven show up, and it is the most interesting emergent
     * behaviour in the game.
     */
    const RV = this.ctx.get('riven');
    if (RV && RV.alarm) RV.alarm(a.pos, GUNSHOT_ALARM, 1);

    if (rivenTarget) {
      if (RV && RV.applyHit) {
        RV.applyHit({ agent: rivenTarget, part: 'body', point: rivenTarget.pos.clone() }, 1);
      }
      return;
    }

    /* Hit or miss against the player. */
    const moving = this.ctx.player.speed01 || 0;
    let chance = def.accuracy
      * (1 - THREE.MathUtils.clamp(range / def.range, 0, 1) * 0.55)
      * (1 - moving * 0.45);
    if (this.ctx.player.mode === 'mounted') chance *= 0.75;
    if (this.rand() > chance) {
      /* A near miss is information: the crack tells you where they are. */
      if (PT && PT.burst) {
        PT.burst('dust', tgt.clone().add(new THREE.Vector3(
          (this.rand() - 0.5) * 2.4, 0, (this.rand() - 0.5) * 2.4)), 4, { scale: 0.4 });
      }
      return;
    }
    const hud = this.ctx.get('hud');
    if (hud) {
      if (hud.damage) hud.damage(def.damage);
      if (hud.hitFeedback) hud.hitFeedback('hit');
    }
    const PX = this.ctx.get('postfx');
    if (PX && PX.shake) PX.shake(0.5, 0.18);
    this.ctx.emit('cordonHit', { damage: def.damage, position: a.pos.clone(), type: a.type.name });
  }

  /* ---------------------------------------------------------------- render */

  _write(a) {
    _q.setFromAxisAngle(_UP, a.yaw);
    _s.set(a.scale, a.scale, a.scale);
    _m.compose(a.pos, _q, _s);
    a.type.mesh.setMatrixAt(a.slot, _m);
    const o = a.slot * 4;
    const arr = a.type.anim.array;
    arr[o] = a.phase;
    arr[o + 1] = a.gait;
    arr[o + 2] = a.aim;
    arr[o + 3] = a.dead;
  }

  /* -------------------------------------------------------------- gunplay */

  /** Same contract as Riven.raycast / Wildlife.raycastAnimals. */
  raycast(origin, dir, maxDist = 420) {
    let best = null;
    for (const a of this._agents) {
      if (!a.alive || a.state === DEAD) continue;
      const h = 1.72 * a.scale;
      const r = (a.type.name === 'enforcer' ? 0.42 : 0.34) * a.scale;
      _v.set(a.pos.x, a.pos.y + h * 0.5, a.pos.z).sub(origin);
      const t = _v.dot(dir);
      if (t < 0 || t > maxDist) continue;
      const off = _v.clone().sub(dir.clone().multiplyScalar(t)).negate();
      const dy = Math.max(0, Math.abs(off.y) - h * 0.5);
      const perp = Math.sqrt(off.x * off.x + off.z * off.z + dy * dy);
      if (perp > r) continue;
      if (!best || t < best.distance) {
        best = {
          agent: a, distance: t, species: a.type.name,
          part: off.y > h * 0.30 ? 'head' : 'body',
          point: origin.clone().addScaledVector(dir, t),
        };
      }
    }
    return best;
  }

  applyHit(hit, damage = 1) {
    const a = hit && hit.agent;
    if (!a || !a.alive || a.state === DEAD) return null;
    const head = hit.part === 'head';
    a.hp -= damage * (head ? 5 : 1);
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('hitmark', { position: hit.point, volume: 0.55, pitch: head ? 1.3 : 1 });
    const PT = this.ctx.get('particles');
    if (PT && PT.burst) PT.burst('dust', hit.point, head ? 8 : 5, { scale: 0.3 });

    if (a.hp <= 0) {
      a.state = DEAD; a.deadT = 0;
      this.kills++;
      if (A && A.play) A.play('bodyfall', { position: a.pos, volume: 0.6, pitch: 0.9 });
      /*
       * They carry what soldiers carry, and it is the best loot in the game —
       * which is the only thing that makes taking a checkpoint worth the
       * ammunition it costs.
       */
      const loot = this.ctx.get('loot');
      if (loot) {
        loot.give('ammo', 3 + Math.floor(this.rand() * 6));
        if (this.rand() < 0.45) loot.give('meds', 1);
        if (this.rand() < 0.30) loot.give('fuel', 1);
        const hud = this.ctx.get('hud');
        if (hud && hud.notify) hud.notify('Took their kit');
      }
      this.ctx.emit('cordonKilled', { position: a.pos.clone(), type: a.type.name });
      return { killed: true, species: a.type.name };
    }
    /* Being shot at makes them look for you whether or not they could see you. */
    if (a.state === POST) { a.state = ALERT; a.alertT = 14; }
    this.alarm(this.ctx.player.position, 90);
    return { killed: false, species: a.type.name };
  }

  stats() {
    let alive = 0;
    for (const a of this._agents) if (a.alive && a.state !== DEAD) alive++;
    return { alive, engaged: this.engaged, kills: this.kills, posts: this._posts.length };
  }

  dispose() {
    for (const [, T] of this._types) {
      this.ctx.scene.remove(T.mesh);
      T.geo.dispose(); T.mat.dispose();
    }
    if (this.blockMesh) {
      this.ctx.scene.remove(this.blockMesh);
      this.blockMesh.geometry.dispose();
    }
    if (this.blockMat) this.blockMat.dispose();
    this._types.clear();
    this._agents.length = 0;
  }
}

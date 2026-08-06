import * as THREE from 'three';
import { rng } from '../core/Context.js';
import { buildRiven, patchRivenAnim, varyInstanceColour } from './riven/RivenBody.js';

/**
 * BROKEN ROAD — THE RIVEN
 * ============================================================================
 * Not zombies exactly: fast, feral, and organised only in the sense that a
 * wolf pack is organised. They live in nests, they hunt at night, and the
 * loudest thing in the world is the bike you are riding.
 *
 * THE NAME is what survivors call them, not what they are — nobody left has the
 * means to find out what they are. `riven`, torn apart, which is the same word
 * the map uses for the gap north of the crest, because the people who named
 * one named the other.
 *
 * DESIGN — WHY PACKS AND NOT A HORDE
 * The famous version of this is three hundred of them at once. That is a
 * spectacle, and it is also a frame-budget catastrophe on a phone. So the unit
 * here is the PACK: three to twelve, spawned as a group around a nest, moving
 * as a group, and — crucially — SCREAMING as a group. Contagion (`_scream`)
 * means the practical size of a fight is not the pack you can see but every
 * pack within earshot of the one you woke, which produces the "oh no, how many
 * are there" moment the horde exists to produce, out of a population an order
 * of magnitude smaller.
 *
 * PERCEPTION, AND WHY THE BIKE IS THE REAL ENEMY
 * They hunt by sound first and sight second. `noise` is the single most
 * important number in this file:
 *
 *      crouching        0.25      barely audible
 *      walking          1.0
 *      sprinting        2.2
 *      RIDING           6 – 14    depending on the throttle
 *      a rifle shot     an instant 220 m alarm
 *
 * The bike is between six and fourteen times louder than a man walking. That
 * is the central tension of the whole game stated as one number: the thing
 * that lets you cover ground is the thing that tells everything where you are,
 * and the decision to shut the engine off and push is a real one because the
 * numbers make it real.
 *
 * BUDGET
 * One InstancedMesh per type, three types, everything animated in the vertex
 * shader (see RivenBody), so the whole population is three draw calls plus
 * three shadow draws. Only a slice of the population runs perception on any
 * given frame — the same round-robin trick Wildlife uses — so the AI cost is
 * flat in the population rather than linear.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */

const IDLE = 0, ALERT = 1, CHASE = 2, ATTACK = 3, DEAD = 4;

const TYPES = {
  /* The common one. A person, still shaped like a person, running. */
  stray: {
    /** Share of the population. */
    share: 0.72,
    speed: 5.9, speedIdle: 0.85, hp: 2, damage: 0.055, reach: 1.65,
    sight: 46, fov: 0.30, hearing: 34,
    scale: [0.94, 1.06],
    colour: [0.128, 0.118, 0.104],
    shadow: true,
  },
  skitter: {
    /* Faster than you, and short enough to be lost in undergrowth until it is
       inside your reach. It is the one that gets people killed. */
    share: 0.20,
    speed: 7.4, speedIdle: 1.2, hp: 1, damage: 0.035, reach: 1.35,
    sight: 34, fov: 0.10, hearing: 44,
    scale: [0.88, 1.02],
    colour: [0.104, 0.100, 0.092],
    shadow: true,
  },
  harrow: {
    /* Slow enough to outrun on foot and far too tough to trade with. It exists
       to make a fight a decision rather than a reflex. */
    share: 0.08,
    speed: 4.2, speedIdle: 0.7, hp: 9, damage: 0.19, reach: 2.15,
    sight: 40, fov: 0.36, hearing: 30,
    scale: [1.0, 1.12],
    colour: [0.140, 0.122, 0.100],
    shadow: true,
  },
};

/** Total population by quality preset. Small groups, not a mega-horde. */
const POPULATION = { mobile: 26, low: 34, medium: 58, high: 92, ultra: 128 };

/** Spawn ring around the player, metres. Nothing pops in inside `near`. */
const SPAWN_NEAR = 55, SPAWN_FAR = 235, DESPAWN = 320;

/** How far a scream carries, and how far it carries at night. */
const SCREAM_RADIUS = 62;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const _UP = new THREE.Vector3(0, 1, 0);

export class Riven {
  static id = 'riven';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x51ae37b1) >>> 0);
    this.enabled = true;
    this._types = new Map();
    this._agents = [];
    this._nests = [];
    this._cursor = 0;
    this._t = 0;
    this._ready = false;
    /** How loud the player is being right now, 0 .. ~14. Recomputed per frame. */
    this.noise = 1;
    /** Rolling count of how many are actively hunting — the HUD reads it. */
    this.hunting = 0;
    this.kills = 0;
    this._alarmT = 0;
  }

  /* ------------------------------------------------------------------ init */

  async init() {
    const ctx = this.ctx;
    const q = ctx.quality || {};
    const total = POPULATION[q.name] != null ? POPULATION[q.name] : POPULATION.medium;

    for (const name of Object.keys(TYPES)) {
      const def = TYPES[name];
      const count = Math.max(2, Math.round(total * def.share));
      const geo = buildRiven(name, this.rand);

      /* `vertexColors` is what carries the anatomy: RivenBody bakes joint
         shadow, necrotic mottling and dark cloth into the mesh as ratios around
         1.0, and three.js multiplies them in with no shader work of ours. The
         material colour stays the SPECIES colour and the per-instance colour
         set below is the INDIVIDUAL, so the three layers compose without any
         one of them having to know about the others. */
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.colour[0], def.colour[1], def.colour[2]),
        roughness: 0.92, metalness: 0, fog: false, dithering: true,
        vertexColors: true,
      });
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
      depth.userData.rsNoAerial = true;
      depth.userData.rsNoGroundFX = true;
      patchRivenAnim(mat);
      patchRivenAnim(depth);

      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.name = 'riven:' + name;
      mesh.castShadow = !!def.shadow;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      /* A pack of eight identical clones was the other half of why these read
         as placeholders. Narrow on purpose — different people in different
         light, not a bag of sweets. */
      varyInstanceColour(mesh, this.rand, 0.34);

      const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      ctx.scene.add(mesh);

      const T = { name, def, mesh, mat, geo, anim, count, agents: [] };
      for (let i = 0; i < count; i++) {
        const a = {
          type: T, slot: i, alive: false, pack: -1,
          pos: new THREE.Vector3(), vel: new THREE.Vector3(),
          yaw: 0, scale: 1, phase: this.rand() * 6.283,
          state: IDLE, rage: 0, gait: 0, speed: 0,
          hp: def.hp, dead: 0, deadT: 0,
          target: new THREE.Vector3(), wander: 0, senseT: 0,
          hitT: 0, screamT: 0, alertT: 0, lunge: 0,
          dist: 1e9,
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
        if (L && L.requestShadowCaster && T.def.shadow) L.requestShadowCaster(T.mesh);
        if (sky && sky.injectAerialPerspective) sky.injectAerialPerspective(T.mat);
        if (clouds && clouds.injectGroundFX) clouds.injectGroundFX(T.mat);
      }
      this._seedNests();
      this._populate();
      this._ready = true;
    });

    ctx.on('teleport', () => { this._despawnAll(); this._populate(); });
    /*
     * A rifle shot is the loudest single event in the world and it is heard by
     * everything, whether or not it could have seen you. This is the line that
     * makes a gun a last resort rather than a default.
     */
    ctx.on('gunshot', (e) => {
      const p = (e && e.position) || ctx.player.position;
      this.alarm(p, 220, 1);
    });
    /* Kicking the engine over is nearly as bad. */
    ctx.on('bikeStart', (e) => {
      this.alarm((e && e.position) || ctx.player.position, 95, 0.7);
    });
  }

  /* ----------------------------------------------------------------- nests */

  /**
   * Where they live.
   *
   * Nests are FIXED world positions, chosen once from a deterministic grid
   * jittered by noise and rejected where the ground is unsuitable. Fixed
   * matters: a player learns the map, and "there is a nest in the mill at the
   * bottom of that valley" is only knowledge if it is still true the next time
   * they ride past. Spawning packs at random around the player instead makes
   * the world uniformly dangerous, which is the same as it being uniformly
   * safe.
   */
  _seedNests() {
    const world = this.ctx.world;
    const R = this.rand;
    const half = (world.size || 8192) * 0.5;
    const GRID = 7;                       // 49 candidate cells
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const cx = -half + (i + 0.5) * (half * 2 / GRID) + (R() - 0.5) * 620;
        const cz = -half + (j + 0.5) * (half * 2 / GRID) + (R() - 0.5) * 620;
        const y = world.getHeight(cx, cz);
        /* No nests underwater, on a glacier, or on a slope nothing could
           shelter on. */
        if (y < (world.waterLevel || 18) + 2 || y > 900) continue;
        if (world.getSlope(cx, cz) < 0.80) continue;
        this._nests.push({
          pos: new THREE.Vector3(cx, y, cz),
          /* Nest strength decides pack size. A few big ones and a lot of
             small ones reads far better than a uniform sprinkle. */
          strength: 0.25 + R() * R() * 1.6,
          heat: 0,
        });
      }
    }
    this.ctx.poi.set('nest', { pos: this._nests.length ? this._nests[0].pos.clone() : new THREE.Vector3() });
  }

  /** The nest whose influence is strongest at a point, or null. */
  _nestNear(x, z, radius) {
    let best = null, bd = radius * radius;
    for (const n of this._nests) {
      const dx = n.pos.x - x, dz = n.pos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = n; }
    }
    return best;
  }

  /* -------------------------------------------------------------- spawning */

  _despawnAll() {
    for (const a of this._agents) {
      a.alive = false; a.state = IDLE; a.dead = 0; a.deadT = 0;
      a.type.mesh.setMatrixAt(a.slot, _HIDE);
    }
    for (const [, T] of this._types) T.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Fill empty slots with packs around whatever nests are in range.
   *
   * Population is modulated by the time of day: they are night hunters, and by
   * noon most of them are holed up. Riding the same road at 3am and at noon has
   * to feel like two different roads or the day/night cycle is decoration.
   */
  _populate() {
    if (!this.ctx.world.ready) return;
    const p = this.ctx.player.position;
    const night = 1 - (this.ctx.env.daylight || 0);
    const budget = 0.30 + night * 0.70;
    const R = this.rand;

    for (const [, T] of this._types) {
      const want = Math.round(T.count * budget);
      let live = 0;
      for (const a of T.agents) if (a.alive) live++;
      let need = want - live;
      if (need <= 0) continue;

      let guard = 0;
      while (need > 0 && guard++ < 64) {
        /* Pick a spawn point on the ring, then bias it toward a nest if one is
           near — which is how packs end up clustered without the spawner
           having to know anything about pack structure. */
        const ang = R() * Math.PI * 2;
        const rad = SPAWN_NEAR + R() * (SPAWN_FAR - SPAWN_NEAR);
        let cx = p.x + Math.cos(ang) * rad;
        let cz = p.z + Math.sin(ang) * rad;
        const nest = this._nestNear(cx, cz, 420);
        let size = 1 + Math.floor(R() * 3);
        if (nest) {
          cx = THREE.MathUtils.lerp(cx, nest.pos.x, 0.55);
          cz = THREE.MathUtils.lerp(cz, nest.pos.z, 0.55);
          size = 3 + Math.floor(R() * (9 * nest.strength));
        }
        size = Math.min(size, need, 12);
        const packId = (this._packSeq = (this._packSeq || 0) + 1);
        for (let k = 0; k < size; k++) {
          const a = this._freeSlot(T);
          if (!a) break;
          const sx = cx + (R() - 0.5) * 16, sz = cz + (R() - 0.5) * 16;
          this._spawn(a, sx, sz, packId);
          need--;
        }
      }
      T.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _freeSlot(T) {
    for (const a of T.agents) if (!a.alive) return a;
    return null;
  }

  _spawn(a, x, z, pack) {
    const world = this.ctx.world;
    const def = a.type.def;
    const R = this.rand;
    a.alive = true;
    a.pack = pack;
    a.pos.set(x, world.getHeight(x, z), z);
    a.vel.set(0, 0, 0);
    a.yaw = R() * Math.PI * 2;
    a.scale = def.scale[0] + R() * (def.scale[1] - def.scale[0]);
    a.state = IDLE;
    a.rage = 0; a.gait = 0; a.speed = 0;
    a.hp = def.hp; a.dead = 0; a.deadT = 0;
    a.wander = R() * 3;
    a.target.copy(a.pos);
    a.hitT = 0; a.screamT = 0; a.alertT = 0; a.lunge = 0;
  }

  /* --------------------------------------------------------------- senses */

  /**
   * How loud the player is being. Everything about stealth in this game is
   * this function.
   */
  _playerNoise() {
    const ctx = this.ctx;
    const pl = ctx.get('player');
    const bike = ctx.get('bike');
    if (ctx.player.mode === 'mounted' && bike && bike.running) {
      /*
       * The engine dominates completely. Even at idle it is louder than a man
       * sprinting; pinned, it is heard the better part of a kilometre away.
       *
       * BAFFLES ARE THE ONE UPGRADE THAT CHANGES THE GAME RATHER THAN THE
       * NUMBERS. Everything else the garage sells makes the bike better at
       * what it already does; this makes the WORLD respond to it differently,
       * because every perception test in this file is keyed on the value
       * returned here. Measured at full baffling: 2.4 at idle, which is a man
       * sprinting, and 5.6 pinned, against 14 stock. So it never makes the bike
       * quiet — you cannot sneak past anything at full throttle and you are not
       * meant to be able to — but it turns rolling on a closed throttle into a
       * genuine option, and a player who has bought it is playing a stealth
       * game on a motorcycle, which no other upgrade can offer.
       */
      const G = ctx.get('garage');
      const baffle = G ? G.mult('baffle') : 1;
      return (6 + (bike.throttle || 0) * 8) * baffle;
    }
    const sp = ctx.player.speed01 || 0;
    if (pl && pl.crouch > 0.5) return 0.25 + sp * 0.5;
    return 0.55 + sp * 1.9;
  }

  /**
   * Wake everything within `radius`, falling off with distance.
   * @param {THREE.Vector3} pos where the noise came from
   */
  alarm(pos, radius = 90, intensity = 1) {
    const r2 = radius * radius;
    for (const a of this._agents) {
      if (!a.alive || a.state === DEAD) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = (1 - Math.sqrt(d2) / radius) * intensity;
      if (k < 0.12) continue;
      a.target.set(pos.x, pos.y, pos.z);
      if (a.state === IDLE) { a.state = ALERT; a.alertT = 6 + k * 8; }
      else if (a.state === ALERT) a.alertT = Math.max(a.alertT, 6 + k * 8);
    }
  }

  /**
   * One of them has seen you and is screaming about it.
   *
   * This is the horde, compressed. The screamer does not just aggro itself; it
   * puts everything within SCREAM_RADIUS straight into CHASE with the player's
   * position already known, which chains through overlapping packs. Waking one
   * pack next to two others is how six become twenty-five without twenty-five
   * ever having to be simulated as a single group.
   */
  _scream(a, at) {
    if (a.screamT > 0) return;
    a.screamT = 3.2;
    const A = this.ctx.get('audio');
    if (A && A.play) {
      /* The coyote synth pitched hard down is a serviceable shriek, and it is
         the closest thing in the library to a mouth. */
      A.play('coyote', { position: a.pos, volume: 0.85, pitch: 0.42 + this.rand() * 0.18 });
    }
    const r2 = SCREAM_RADIUS * SCREAM_RADIUS;
    for (const b of this._agents) {
      if (!b.alive || b === a || b.state === DEAD || b.state === CHASE) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (dx * dx + dz * dz > r2) continue;
      b.state = CHASE;
      b.target.copy(at);
      b.alertT = 14;
    }
  }

  /**
   * Perception for one agent. Run on a round-robin slice, so this is cheap no
   * matter how many are alive.
   */
  _sense(a, p, step) {
    const def = a.type.def;
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    a.dist = d;

    /* --- hearing. Range scales with how loud the player is being, which is
       why the bike is the enemy and the crouch is the answer. */
    const heard = d < def.hearing * Math.min(3.2, 0.45 + this.noise * 0.55);

    /* --- sight. A cone, and only in daylight or at short range: they hunt at
       night by sound, which is what makes a headlight such a bad idea. */
    let seen = false;
    if (d < def.sight) {
      const f = Math.sin(a.yaw), g = Math.cos(a.yaw);
      const dot = d > 0.01 ? (dx * f + dz * g) / d : 1;
      const light = 0.35 + (this.ctx.env.daylight || 0) * 0.65;
      const bike = this.ctx.get('bike');
      /* A headlight in the dark is a beacon. Riding blacked out is slower and
         far more dangerous to do, and that trade is the point of the switch. */
      const lit = (bike && bike._beam > 0.5 && this.ctx.player.mode === 'mounted') ? 1.6 : 1;
      seen = dot > def.fov && d < def.sight * light * lit;
      if (seen) {
        /* Crouching in cover: at range, a still crouched figure is not
           resolved. */
        const pl = this.ctx.get('player');
        if (pl && pl.crouch > 0.5 && d > 14 && (this.ctx.player.speed01 || 0) < 0.15) seen = false;
      }
    }

    if (seen || (heard && d < 26)) {
      if (a.state !== CHASE && a.state !== ATTACK) {
        a.state = CHASE;
        this._scream(a, p);
      }
      a.target.set(p.x, p.y, p.z);
      a.alertT = 12;
    } else if (heard) {
      if (a.state === IDLE) { a.state = ALERT; a.alertT = 7; }
      /* Investigate roughly, not exactly: they know where the sound was, not
         where you are now. */
      a.target.set(p.x + (this.rand() - 0.5) * 12, p.y, p.z + (this.rand() - 0.5) * 12);
    }
    void step;
  }

  /* ------------------------------------------------------------------ tick */

  update(dt) {
    if (!this._ready || !this.enabled) return;
    const h = Math.min(dt || 1 / 60, 0.1);
    this._t += h;
    const ctx = this.ctx;
    const p = ctx.player.position;
    this.noise = this._playerNoise();

    /* Top the population up on a slow clock, and let the day/night budget
       drift the number rather than snapping it. */
    this._repop = (this._repop || 0) + h;
    if (this._repop > 2.5) { this._repop = 0; this._populate(); }

    /* Perception: a slice per frame. At 60 fps and a 90-strong population
       every agent is sensed about five times a second, which is far more
       often than a decision has to be made. */
    const slice = Math.max(4, Math.ceil(this._agents.length / 12));
    for (let k = 0; k < slice; k++) {
      const a = this._agents[this._cursor % this._agents.length];
      this._cursor++;
      if (a.alive && a.state !== DEAD) this._sense(a, p, h);
    }

    let hunting = 0;
    for (const [, T] of this._types) {
      let dirty = false;
      for (const a of T.agents) {
        if (!a.alive) continue;
        this._step(a, h, p);
        /*
         * RE-TEST `alive`. _step despawns anything that has wandered past
         * DESPAWN or finished rotting, and it does that by writing the hide
         * matrix — so falling straight through to _write() below put the
         * matrix back and resurrected it on the spot, one frame later, at the
         * position it was culled from.
         */
        if (!a.alive) { dirty = true; continue; }
        if (a.state === CHASE || a.state === ATTACK) hunting++;
        this._write(a);
        dirty = true;
      }
      if (dirty) {
        T.mesh.instanceMatrix.needsUpdate = true;
        T.anim.needsUpdate = true;
      }
    }
    this.hunting = hunting;
  }

  _step(a, h, p) {
    const def = a.type.def;
    const world = this.ctx.world;
    a.screamT = Math.max(0, a.screamT - h);
    a.hitT = Math.max(0, a.hitT - h);

    /* ---- dead: collapse, lie there a while, then free the slot ---------- */
    if (a.state === DEAD) {
      a.dead = Math.min(1, a.dead + h * 3.4);
      a.deadT += h;
      a.gait = 0; a.rage = 0;
      if (a.deadT > 26) {
        a.alive = false;
        a.type.mesh.setMatrixAt(a.slot, _HIDE);
      }
      return;
    }

    /* ---- cull anything that has wandered out of the world -------------- */
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    a.dist = d;
    if (d > DESPAWN) {
      a.alive = false;
      a.type.mesh.setMatrixAt(a.slot, _HIDE);
      return;
    }

    a.alertT = Math.max(0, a.alertT - h);
    let wantSpeed = 0;
    let tx = a.target.x, tz = a.target.z;

    switch (a.state) {
      case IDLE: {
        /* Shambling. They do not patrol — they mill about near where they
           are, which is what makes coming over a rise and finding a dozen of
           them standing in a field so unnerving. */
        a.wander -= h;
        if (a.wander <= 0) {
          a.wander = 2.5 + this.rand() * 5;
          const ang = this.rand() * Math.PI * 2;
          const r = 3 + this.rand() * 9;
          a.target.set(a.pos.x + Math.cos(ang) * r, 0, a.pos.z + Math.sin(ang) * r);
        }
        tx = a.target.x; tz = a.target.z;
        wantSpeed = def.speedIdle * 0.55;
        break;
      }
      case ALERT: {
        /* Heading toward whatever it heard, upright and looking. */
        wantSpeed = def.speedIdle * 1.7;
        if (a.alertT <= 0) a.state = IDLE;
        const dd = Math.hypot(tx - a.pos.x, tz - a.pos.z);
        if (dd < 2.5) { a.state = IDLE; a.wander = 0; }
        break;
      }
      case CHASE: {
        tx = p.x; tz = p.z;
        wantSpeed = def.speed;
        if (a.alertT <= 0 && d > def.sight) a.state = ALERT;
        if (d < def.reach) { a.state = ATTACK; a.lunge = 0; }
        break;
      }
      case ATTACK: {
        tx = p.x; tz = p.z;
        wantSpeed = def.speed * 0.35;
        a.lunge += h;
        /* A swing every ~0.85 s, and the damage lands on the swing rather
           than continuously, so being caught is a series of survivable hits
           rather than a bar draining. */
        if (a.lunge > 0.85) {
          a.lunge = 0;
          if (d < def.reach + 0.4) this._hitPlayer(a, def);
          else a.state = CHASE;
        }
        if (d > def.reach + 1.2) a.state = CHASE;
        break;
      }
      default: break;
    }

    /* ---- steering ------------------------------------------------------- */
    const ddx = tx - a.pos.x, ddz = tz - a.pos.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 0.35 && wantSpeed > 0.01) {
      const nx = ddx / dd, nz = ddz / dd;
      /* Slope: they are fast on the flat and no better than you uphill, which
         is the only reliable way to break contact on foot. */
      const slope = world.getSlope(a.pos.x, a.pos.z);
      const climb = THREE.MathUtils.clamp(slope * 1.25, 0.42, 1);
      const target = wantSpeed * climb;
      a.speed += (target - a.speed) * Math.min(1, h * 4.5);
      a.pos.x += nx * a.speed * h;
      a.pos.z += nz * a.speed * h;
      const want = Math.atan2(nx, nz);
      let dy = want - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, h * (a.state === CHASE ? 7 : 3.2));
    } else {
      a.speed += (0 - a.speed) * Math.min(1, h * 5);
    }
    a.pos.y = world.getHeight(a.pos.x, a.pos.z);

    /* ---- animation drive ------------------------------------------------ */
    /* Phase advances by DISTANCE, not time, so the feet never skate. */
    const stride = a.type.name === 'skitter' ? 0.85 : 1.35;
    a.phase += (a.speed * h) / stride * 6.2831;
    a.gait += (THREE.MathUtils.clamp(a.speed / (def.speed * 0.8), 0, 1) - a.gait)
      * Math.min(1, h * 6);
    const rageWant = (a.state === CHASE || a.state === ATTACK) ? 1
      : (a.state === ALERT ? 0.35 : 0);
    a.rage += (rageWant - a.rage) * Math.min(1, h * 3.5);

    /* ---- footfalls and voice -------------------------------------------- */
    if (a.speed > 2 && d < 46) {
      const beat = Math.floor(a.phase / Math.PI);
      if (beat !== a._beat) {
        a._beat = beat;
        const A = this.ctx.get('audio');
        if (A && A.play && this.rand() < 0.5) {
          A.play('footstep', { position: a.pos, volume: 0.16, pitch: 1.25 });
        }
      }
    }
    if (a.state === CHASE && d < 55 && this.rand() < h * 0.35) {
      const A = this.ctx.get('audio');
      if (A && A.play) A.play('dog', { position: a.pos, volume: 0.4, pitch: 0.55 });
    }
  }

  _hitPlayer(a, def) {
    const ctx = this.ctx;
    const hud = ctx.get('hud');
    /* Being on the bike and moving is genuine protection: they have to catch
       you first, and a glancing hit at speed is far less than a mauling on
       foot. It also means "get back on the bike" is always the right answer,
       which is the loop this game wants. */
    const moving = ctx.player.mode === 'mounted' ? (ctx.player.speed01 || 0) : 0;
    const dmg = def.damage * (1 - moving * 0.75);
    if (hud) {
      if (hud.damage) hud.damage(dmg);
      if (hud.hitFeedback) hud.hitFeedback('hit');
    }
    const PX = ctx.get('postfx');
    if (PX && PX.shake) PX.shake(0.35 + dmg * 2.2, 0.22);
    const A = ctx.get('audio');
    if (A && A.play) A.play('bodyfall', { position: a.pos, volume: 0.5, pitch: 1.3 });
    ctx.emit('rivenHit', { damage: dmg, position: a.pos.clone(), type: a.type.name });
  }

  /* ---------------------------------------------------------------- render */

  _write(a) {
    /* _UP is a module constant, not a fresh Vector3: this runs once per live
       agent per frame, and at a hundred agents an allocation here is six
       thousand vectors a second handed straight to the collector. */
    _q.setFromAxisAngle(_UP, a.yaw);
    _s.set(a.scale, a.scale, a.scale);
    _m.compose(a.pos, _q, _s);
    a.type.mesh.setMatrixAt(a.slot, _m);
    const o = a.slot * 4;
    const arr = a.type.anim.array;
    arr[o] = a.phase;
    arr[o + 1] = a.gait;
    arr[o + 2] = a.rage;
    arr[o + 3] = a.dead;
  }

  /* -------------------------------------------------------------- gunplay */

  /**
   * Nearest infected along a ray. Same shape as Wildlife.raycastAnimals so the
   * weapon can treat the two identically.
   *
   * The test is a capsule about the body axis rather than a sphere: a running
   * biped is 1.6 m tall and 0.4 m wide, and a sphere big enough to hit
   * reliably at the chest is big enough to catch shots that visibly missed
   * past the head.
   */
  raycast(origin, dir, maxDist = 420) {
    let best = null;
    for (const a of this._agents) {
      if (!a.alive || a.state === DEAD) continue;
      const h = a.type.name === 'skitter' ? 0.62 : (a.type.name === 'harrow' ? 2.0 : 1.55);
      const r = a.type.name === 'harrow' ? 0.55 : 0.34;
      /* Closest approach of the ray to the body's vertical segment. */
      _v.set(a.pos.x, a.pos.y + h * 0.5 * a.scale, a.pos.z).sub(origin);
      const t = _v.dot(dir);
      if (t < 0 || t > maxDist) continue;
      _v2.copy(dir).multiplyScalar(t).sub(_v);
      /* Allow the segment's own height in Y before counting the miss. */
      const dy = Math.max(0, Math.abs(_v2.y) - h * 0.5 * a.scale);
      const off = Math.sqrt(_v2.x * _v2.x + _v2.z * _v2.z + dy * dy);
      if (off > r * a.scale) continue;
      if (!best || t < best.distance) {
        best = {
          agent: a, distance: t, species: a.type.name,
          part: _v2.y > h * 0.28 * a.scale ? 'head' : 'body',
          point: origin.clone().addScaledVector(dir, t),
        };
      }
    }
    return best;
  }

  /**
   * Apply a hit. A head shot kills anything that is not a harrow outright,
   * which is what makes aiming worth the time it costs.
   */
  applyHit(hit, damage = 1) {
    const a = hit && hit.agent;
    if (!a || !a.alive || a.state === DEAD) return null;
    const head = hit.part === 'head';
    const dmg = damage * (head ? 6 : 1);
    a.hp -= dmg;
    a.hitT = 0.2;
    const PT = this.ctx.get('particles');
    if (PT && PT.burst) PT.burst('dust', hit.point, head ? 9 : 5, { scale: 0.34 });
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('hitmark', { position: hit.point, volume: 0.55, pitch: head ? 1.3 : 1 });

    if (a.hp <= 0) {
      a.state = DEAD;
      a.deadT = 0;
      this.kills++;
      if (A && A.play) A.play('bodyfall', { position: a.pos, volume: 0.6, pitch: 0.95 });
      const loot = this.ctx.get('loot');
      if (loot && loot.dropFrom) loot.dropFrom(a.pos, a.type.name);
      this.ctx.emit('rivenKilled', { position: a.pos.clone(), type: a.type.name });
      return { killed: true, species: a.type.name };
    }
    /* Anything that is shot at and survives knows exactly where the shot came
       from, and tells everyone. */
    if (a.state !== CHASE) {
      a.state = CHASE;
      a.target.copy(this.ctx.player.position);
      this._scream(a, this.ctx.player.position);
    }
    return { killed: false, species: a.type.name };
  }

  /**
   * Nearest live one to a point, within `radius`.
   *
   * Published because the Cordon needs it — they shoot at the Riven, and a
   * faction reaching into another system's `_agents` array is exactly the kind
   * of coupling that makes a later refactor break something three files away.
   *
   * @returns {{pos:THREE.Vector3, dist:number, agent:object}|null}
   */
  nearestTo(pos, radius = 40) {
    let best = null, bd = radius * radius;
    for (const a of this._agents) {
      if (!a.alive || a.state === DEAD) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best ? { pos: best.pos, dist: Math.sqrt(bd), agent: best } : null;
  }

  /** For the HUD: how much trouble the player is currently in. */
  stats() {
    let alive = 0;
    for (const a of this._agents) if (a.alive && a.state !== DEAD) alive++;
    return { alive, hunting: this.hunting, kills: this.kills, noise: this.noise };
  }

  dispose() {
    for (const [, T] of this._types) {
      this.ctx.scene.remove(T.mesh);
      T.geo.dispose(); T.mat.dispose();
    }
    this._types.clear();
    this._agents.length = 0;
  }
}

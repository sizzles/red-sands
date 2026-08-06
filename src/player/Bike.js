import * as THREE from 'three';
import { rng } from '../core/Context.js';
import { BIKE, buildBody, buildFront, buildWheel, assemble } from './bike/BikeBuild.js';
import { BikeAudio } from './bike/BikeAudio.js';
import { ContactShadow } from './rig/CharMaterial.js';
import { HorseCollider } from './horse/HorseCollider.js';

/**
 * BROKEN ROAD — THE BIKE
 * ============================================================================
 * The drifter's motorcycle: the thing you live on, and the thing that can
 * strand you.
 *
 * It deliberately presents the SAME public surface the horse it replaces did —
 * `state`, `yaw`, `speed01`, `renderPos`, `mounted`, `holdStill`, `syncPose()`
 * and `getSaddle()` — so Player's mount transition, mounted pose, camera rig
 * and audio hooks all work against it unchanged. Where the horse published
 * stirrup irons the bike publishes footpegs; where it published a saddle bone
 * the bike publishes the seat.
 *
 * HANDLING
 * The steering is a genuine bicycle model, not a car turned sideways:
 *
 *      yawRate = v · tan(steer) / wheelbase
 *
 * Everything that makes a bike feel like a bike falls out of that one line for
 * free. You cannot turn at a standstill. Turn radius grows with speed, so the
 * same handlebar input that flicks you round a tree at 5 m/s is a long lazy arc
 * at 25. And the lean follows from the same physics —
 *
 *      lean = atan(v · yawRate / g)
 *
 * — which is the real balance condition for a single-track vehicle, so the
 * bike banks by exactly as much as the corner actually demands. Faking the
 * lean off steering input instead is the usual shortcut and it is instantly
 * readable as wrong, because the bike then leans hardest where it is turning
 * least.
 *
 * FUEL
 * The tank is the survival loop. Full, it is about four minutes of hard riding
 * or ten of cruising, and it is deliberately not generous: running dry two
 * kilometres from a stash, at night, in the rain, with the engine noise no
 * longer masking anything, is the situation this whole game is arranged
 * around. Out of fuel you can still push the bike at walking pace, which keeps
 * it a setback rather than a softlock.
 * ============================================================================
 */

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
/** How close you have to be to get on. Matches the horse's old range. */
export const MOUNT_RANGE = 4.8;

/** Top speed in m/s, flat out on good ground. ~97 km/h. */
const TOP_SPEED = 27.0;
/** Cruising speed without the throttle pinned. */
const CRUISE = 13.5;
/** Reverse — walking the bike back with your feet down. */
const PADDLE = 1.6;
/** m/s², at the wheel. Falls off with speed via the (1 − v/TOP) term. */
const DRIVE = 8.4;
const BRAKE = 13.0;
/** Coast-down: rolling resistance plus a v² air term. */
const ROLL = 0.55, DRAG = 0.0062;
/**
 * What a road is worth.
 *
 * The top-speed gain is deliberately the SMALL half of this. A graded surface
 * is only about fourteen percent quicker flat out — what it really buys is
 * GRIP, and grip is worth far more than speed because it is what the loose
 * ground and the rain take away. Off the road on wet pumice the bike has 0.35
 * of its drive available and corners like a shopping trolley; on the state
 * route it has all of it in any weather. That difference, not the speedometer,
 * is why the long way round is worth taking.
 */
const ROAD_TOP_GAIN = 0.14;
const ROAD_GRIP_GAIN = 0.20;

/** Seconds of full throttle in one tank. */
const FUEL_SECONDS = 250;

/** Engine. Idle, redline, and where the gearbox changes up. */
const IDLE_RPM = 950, MAX_RPM = 8200;
const GEARS = [0, 3.4, 7.4, 12.2, 18.0, 27.5];

/** Seat and footpeg, in bike-local metres. See BikeBuild's axis convention. */
const SEAT = new THREE.Vector3(0, BIKE.seatY, BIKE.seatZ);
const PEG = new THREE.Vector3(0.235, 0.345, -0.055);
const GRIP = new THREE.Vector3(BIKE.barHalf - 0.045, BIKE.barY, BIKE.barZ);

export class Bike {
  static id = 'bike';

  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'bike';

    /* Same shape as the horse's state block — Physics.stepCharacter reads it. */
    this.state = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      radius: 0.42,
      height: 1.15,
      grounded: true,
      groundNormal: new THREE.Vector3(0, 1, 0),
      /* A bike gives up on a slope long before a horse does. cos 62 deg. */
      maxSlopeCos: 0.47,
      stepHeight: 0.30,
    };
    this.prevPos = new THREE.Vector3();
    this.renderPos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.speed01 = 0;
    this.mounted = false;
    this.holdStill = false;
    this.visible = true;

    /** 0..1 of a tank. */
    this.fuel = 0.72;
    /** True while the motor is running; false when dry or shut off. */
    this.running = false;
    this.rpm = 0;
    this.gear = 1;
    this.throttle = 0;
    this.headlightOn = false;
    /** 0..1 how much road is under the wheels. Written each fixed step. */
    this.onRoad = 0;
    this.roadClass = 0;
    this.grip = 1;

    /* Everything below is render-side smoothing, updated in _pose. */
    this.lean = 0;
    this.steer = 0;
    this.pitch = 0;
    this._wheelAng = 0;
    this._forkComp = 0;
    this._forkVel = 0;
    this._prevGroundY = 0;
    this._shake = 0;
    /**
     * Interface tag. Player checks this to switch from the equestrian seat
     * (sit back, hands on the horn) to a rider's crouch with hands on the bars.
     */
    this.isVehicle = true;
    this.gait = 'roll';
  }

  /* ==================================================================== init */

  async init() {
    const ctx = this.ctx;
    const rand = rng((ctx.seed ^ 0x8b1d) >>> 0);
    const proc = ctx.get('procTextures');

    const mats = this._materials(proc);
    this.mats = mats;

    const { parts, canGeo } = buildBody(rand);
    this.body = assemble(parts, {
      steel: mats.steel, engine: mats.engine, leather: mats.leather, canvas: mats.canvas,
    }, 'bikeBody');

    /* The spare fuel can is its own mesh so it can be hidden when spent — the
       player should be able to see from third person whether they are carrying
       a refill. */
    this.canMesh = new THREE.Mesh(canGeo, mats.steel);
    this.canMesh.castShadow = true;
    this.canMesh.visible = false;
    this.body.add(this.canMesh);

    /* Front assembly: built about the steering head with the rake taken out,
       so `steerPivot` rotates on Y to steer and `forkSlide` slides on Y for
       the suspension, and neither has to know about the other. */
    this.steerPivot = new THREE.Group();
    this.steerPivot.position.set(0, BIKE.headY, BIKE.headZ);
    this.steerPivot.rotation.x = BIKE.rake * 0;      // rake applied on the child
    this.forkSlide = new THREE.Group();
    this.forkSlide.rotation.x = -BIKE.rake;
    const front = assemble(buildFront(), { steel: mats.steel, glass: mats.lens }, 'bikeFront');
    this.forkSlide.add(front);
    this.steerPivot.add(this.forkSlide);

    this.wheelR = assemble(buildWheel(rand, { rear: true }),
      { rubber: mats.rubber, steel: mats.steel }, 'bikeWheelR');
    this.wheelF = assemble(buildWheel(rand, { rear: false }),
      { rubber: mats.rubber, steel: mats.steel }, 'bikeWheelF');
    this.wheelR.position.set(0, BIKE.wheelR, BIKE.rearAxle);
    /* The front wheel hangs off the fork, in the fork's own frame: straight
       down the leg from the steering head. */
    this.wheelF.position.set(0, -0.545, 0.048);
    this.forkSlide.add(this.wheelF);

    /** The part of the machine that leans. Everything except nothing, really —
     *  but keeping it as its own node means the lean never contaminates the
     *  yaw, which it would if both were written onto one Euler. */
    this.lean3 = new THREE.Group();
    this.lean3.add(this.body, this.steerPivot, this.wheelR);
    this.group.add(this.lean3);
    ctx.scene.add(this.group);

    const lighting = ctx.get('lighting');
    if (lighting && lighting.requestShadowCaster) {
      this.group.traverse((o) => { if (o.isMesh) lighting.requestShadowCaster(o); });
    }
    this._initHeadlight(lighting);

    this.contact = new ContactShadow(ctx, { radius: 1.5, strength: 0.72, res: 14 });
    ctx.scene.add(this.contact.mesh);

    this.audio = new BikeAudio(ctx.get('audio'));

    this._placeBesidePlayer();

    this.physics = ctx.get('physics');
    this.collider = new HorseCollider(this.physics);
    this.collider.update(this.state.position, this.yaw);
    if (this.physics && this.physics.addStepper) {
      this._stepFn = (h) => this._fixed(h);
      this.physics.addStepper(this._stepFn);
    }

    ctx.on('playerTeleported', () => { if (!this.holdStill) this._placeBesidePlayer(); });
    this._onKey = (e) => {
      const player = this.ctx.get('player');
      if (!player || player.trans) return;
      /*
       * Player's own E listener runs first (it inits before this system) and
       * stamps the frame when it consumed the press. Without that check, E
       * next to a fuel can parked beside the bike both looted the can AND
       * started the mount animation on the same frame.
       */
      if (player._actionClaimed === this.ctx.time.frame) return;
      if (e.code === 'KeyE') {
        if (player.mode === 'mounted') player.dismount();
        else if (player.mode === 'onFoot'
          && player.state.position.distanceTo(this.state.position) < MOUNT_RANGE) {
          player.mount(this);
          this._start();
        }
      } else if (e.code === 'KeyL' && !e.repeat) {
        this.headlightOn = !this.headlightOn;
      } else if (e.code === 'KeyF' && !e.repeat) {
        this.refuel();
      }
    };
    window.addEventListener('keydown', this._onKey);

    ctx.poi.set('bike', { pos: this.state.position.clone() });
    this._pose(0);
  }

  /**
   * Surfaces, all from the shared procedural library. Rubber is the only one
   * without a natural entry there, so it borrows leather's normal and cavity
   * detail and is driven almost to black at roughness 1 — which is genuinely
   * what a worn tyre is, optically.
   */
  _materials(proc) {
    const mk = (name, o) => (proc && proc.material
      ? proc.material(name, o)
      : new THREE.MeshStandardMaterial(o));
    const tyre = proc && proc.get
      ? new THREE.MeshStandardMaterial({
        map: null,
        normalMap: proc.get('leather').normalMap,
        color: new THREE.Color(0.030, 0.030, 0.033),
        roughness: 0.97, metalness: 0.0,
      })
      : new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.97 });
    return {
      steel: mk('metal_worn', { color: new THREE.Color(0.34, 0.33, 0.31), roughness: 0.62, metalness: 0.82 }),
      engine: mk('metal_rusted', { color: new THREE.Color(0.26, 0.23, 0.20), roughness: 0.78, metalness: 0.70 }),
      leather: mk('leather', { color: new THREE.Color(0.16, 0.13, 0.11), roughness: 0.86 }),
      canvas: mk('canvas_tent', { color: new THREE.Color(0.30, 0.29, 0.24), roughness: 0.95 }),
      rubber: tyre,
      /* The lens. Emissive is driven in _pose; at zero it is just dirty glass. */
      lens: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.30, 0.29, 0.26), roughness: 0.28, metalness: 0.1,
        emissive: new THREE.Color(1.0, 0.93, 0.78), emissiveIntensity: 0,
      }),
    };
  }

  /**
   * The headlight. A real spot rather than a glowing decal, because the whole
   * point of riding at night in this game is that the cone is the only thing
   * you can see by — and that it announces you from a very long way off.
   */
  _initHeadlight(lighting) {
    const l = new THREE.SpotLight(0xfff0d8, 0, 62, 0.44, 0.45, 1.4);
    l.position.set(0, 0, 0);
    l.target = new THREE.Object3D();
    this.group.add(l, l.target);
    this.headlight = l;
    if (lighting && lighting.addLight) {
      lighting.addLight(l, { flicker: 0.04, radius: 62, importance: 2.4 });
    }
  }

  /* ------------------------------------------------------------- placement */

  /** Park the bike a couple of metres off the player, on the flattest ground. */
  _placeBesidePlayer() {
    const player = this.ctx.get('player');
    const world = this.ctx.world;
    const p = player ? player.state.position : new THREE.Vector3();
    const yaw = player ? player.yaw : 0;
    const fwd = _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const rgt = _rgt.set(-fwd.z, 0, fwd.x);
    let best = null;
    for (let i = 0; i < 9; i++) {
      const side = 2.20 + (i % 3) * 0.35;
      const ahead = 1.5 + Math.floor(i / 3) * 0.55;
      const x = p.x + rgt.x * side + fwd.x * ahead;
      const z = p.z + rgt.z * side + fwd.z * ahead;
      const y0 = world.getHeight(x, z);
      let rough = 0;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        rough += Math.abs(world.getHeight(x + Math.cos(a), z + Math.sin(a)) - y0);
      }
      const n = world.getNormal(x, z, _v2);
      const score = -rough * 2.4 + n.y * 3.0;
      if (!best || score > best.score) best = { x, z, y: y0, score };
    }
    this.state.position.set(best.x, best.y, best.z);
    this.prevPos.copy(this.state.position);
    this.renderPos.copy(this.state.position);
    this.state.velocity.set(0, 0, 0);
    this.yaw = yaw + 2.30;
    this.speed = 0;
    this._prevGroundY = best.y;
  }

  /* ------------------------------------------------------------------ fuel */

  /** Kick it over. No-op if the tank is dry. */
  _start() {
    if (this.fuel <= 0.001) {
      const hud = this.ctx.get('hud');
      if (hud && hud.notify) hud.notify('Tank’s dry');
      return false;
    }
    if (!this.running) {
      this.running = true;
      this.rpm = IDLE_RPM;
      if (this.audio) this.audio.kick();
      this.ctx.emit('bikeStart', { position: this.state.position.clone() });
    }
    return true;
  }

  /**
   * Empty a jerry can into the tank.
   * @returns {boolean} false if there was nothing to pour or nowhere to put it
   */
  refuel(amount = 0.5) {
    const loot = this.ctx.get('loot');
    if (this.fuel > 0.985) {
      const hud = this.ctx.get('hud');
      if (hud && hud.notify) hud.notify('Tank’s full');
      return false;
    }
    if (loot && loot.take && !loot.take('fuel', 1)) {
      const hud = this.ctx.get('hud');
      if (hud && hud.notify) hud.notify('No fuel to pour');
      return false;
    }
    this.fuel = Math.min(1, this.fuel + amount);
    const A = this.ctx.get('audio');
    if (A && A.play) A.play('clink', { position: this.state.position, volume: 0.4, pitch: 0.7 });
    const hud = this.ctx.get('hud');
    if (hud && hud.notify) hud.notify('Fuelled up');
    if (!this.running && this.mounted) this._start();
    return true;
  }

  /* --------------------------------------------------------- fixed update */

  _fixed(h) {
    const s = this.state;
    this.prevPos.copy(s.position);
    const player = this.ctx.get('player');
    const ridden = this.mounted && player && !this.holdStill;

    let steerWant = 0;
    if (ridden) {
      const i = player.input;
      const dry = this.fuel <= 0.0005;
      if (dry && this.running) {
        this.running = false;
        const hud = this.ctx.get('hud');
        if (hud && hud.notify) hud.notify('Out of fuel');
        this.ctx.emit('bikeStall', { position: s.position.clone() });
      }
      if (!this.running && i.f > 0 && !dry) this._start();

      /* Shift is the throttle rather than a separate key: it keeps the control
         scheme identical to the on-foot sprint, and it means the same finger
         does "go faster" everywhere in the game. */
      const want = i.f > 0 ? (i.sprint ? 1 : 0.55) : 0;
      this.throttle += (want - this.throttle) * Math.min(1, h * 7.5);
      steerWant = -i.r;

      const grade = this._grade();

      /* --- the road ------------------------------------------------------ */
      const roads = this.ctx.get('roads');
      const q = roads ? roads.query(s.position.x, s.position.z) : null;
      const onRoad = q ? q.on : 0;
      const roadClass = q ? q.speed : 1;
      this.onRoad = onRoad;
      this.roadClass = onRoad > 0.02 ? roadClass : 0;

      /* Traction. Loose ground and wet ground both cost drive, and the wet
         term is why the rain matters mechanically and not only visually.
         A made surface removes the loose term entirely — that is what "made"
         means — and halves what the rain costs, because asphalt drains. */
      const surf = this.ctx.world.getSurface(s.position.x, s.position.z);
      const loose = ((surf.sand || 0) * 0.55 + (surf.dirt || 0) * 0.18
        + (surf.snow || 0) * 0.62) * (1 - onRoad);
      const wet = (this.ctx.env.wetness || 0) * (0.22 - onRoad * 0.11);
      const grip = Math.min(1.15,
        Math.max(0.35, 1 - loose - wet) * (1 + onRoad * ROAD_GRIP_GAIN));
      this.grip = grip;

      let a = 0;
      if (this.running) {
        /* Torque falls off toward top speed, and a bike will not pull a steep
           grade in the same gear it cruises in. */
        a += this.throttle * DRIVE * grip * Math.max(0, 1 - this.speed / TOP_SPEED);
      } else if (i.f > 0) {
        /* Pushing it. Slow, and it is meant to hurt. */
        a += this.speed < PADDLE ? 1.4 : 0;
      }
      if (i.f < 0) {
        a -= this.speed > 0.4 ? BRAKE * grip : 2.4;
        if (this.speed <= 0.05) this.speed = Math.max(-PADDLE, this.speed - 1.6 * h);
      }
      /* Gravity along the slope. A 20% grade costs about 2 m/s². */
      a -= grade * 9.81;
      a -= ROLL * Math.sign(this.speed) + DRAG * this.speed * Math.abs(this.speed);

      this.speed += a * h;
      const roadK = 1 + onRoad * roadClass * ROAD_TOP_GAIN;
      const top = this.running
        ? TOP_SPEED * roadK * (this.throttle > 0.7 ? 1 : CRUISE / TOP_SPEED)
        : PADDLE;
      this.speed = THREE.MathUtils.clamp(this.speed, -PADDLE, Math.max(PADDLE, top));
      if (!this.running && this.speed > PADDLE) this.speed = Math.max(PADDLE, this.speed - 3.0 * h);
      if (Math.abs(this.speed) < 0.02 && i.f === 0) this.speed = 0;

      /* --- steering: the bicycle model ---------------------------------- */
      const maxSteer = 0.86 / (1 + Math.abs(this.speed) * 0.30);
      const target = steerWant * maxSteer;
      this.steer += (target - this.steer) * Math.min(1, h * 9);
      let yawRate = (this.speed * Math.tan(this.steer)) / BIKE.wheelbase;
      /* Below walking pace you are dabbing your feet, not steering — allow a
         pivot the bicycle model cannot give, or parking is impossible. */
      if (Math.abs(this.speed) < 1.4) yawRate += steerWant * 1.15 * (1 - Math.abs(this.speed) / 1.4);
      this.yaw += yawRate * h;
      this._yawRate = yawRate;

      const f = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      s.velocity.x = f.x * this.speed;
      s.velocity.z = f.z * this.speed;
      s.snap = 0.30 + Math.abs(this.speed) * 0.05;

      /* --- burn ---------------------------------------------------------- */
      if (this.running) {
        const burn = (0.12 + this.throttle * 0.88) / FUEL_SECONDS;
        this.fuel = Math.max(0, this.fuel - burn * h);
      }
    } else {
      const k = this.holdStill ? 0 : Math.max(0, 1 - 3.2 * h);
      this.speed *= k;
      this.throttle = 0;
      this.steer *= Math.max(0, 1 - 4 * h);
      this._yawRate = 0;
      s.velocity.x *= k;
      s.velocity.z *= k;
      if (this.running && !this.mounted) this.running = false;
    }

    /* --- move ------------------------------------------------------------- */
    const c = this.collider;
    if (c) c.suspend();
    if (this.physics) this.physics.stepCharacter(s, h);
    else s.position.y = this.ctx.world.getHeight(s.position.x, s.position.z);
    if (c) {
      const rider = this.ctx.get('player');
      const busy = this.mounted || this.holdStill || (rider && rider.trans)
        || this.ctx.player.mode === 'mounted';
      if (!busy) c.resume(s.position);
      c.update(s.position, this.yaw);
    }

    const sp = Math.hypot(s.velocity.x, s.velocity.z);
    this.speed01 = THREE.MathUtils.clamp(sp / TOP_SPEED, 0, 1);
    this._updateEngine(sp, h);
  }

  /** Grade under the wheels: rise per metre travelled, signed. */
  _grade() {
    const n = this.state.groundNormal;
    if (!Number.isFinite(n.y) || n.y < 0.05) return 0;
    const f = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const g = -(n.x * f.x + n.z * f.z) / n.y;
    return Number.isFinite(g) ? THREE.MathUtils.clamp(g, -1.2, 1.2) : 0;
  }

  /**
   * Gearbox and revs.
   *
   * The gearbox exists purely so the engine note falls when it changes up.
   * Without it the pitch is a single monotonic ramp from idle to redline across
   * the whole speed range, which sounds like an electric motor — and the
   * saw-tooth of revs climbing and dropping is most of what makes acceleration
   * feel like acceleration.
   */
  _updateEngine(sp, h) {
    if (!this.running) {
      this.rpm += (0 - this.rpm) * Math.min(1, h * 3.5);
      return;
    }
    let g = 1;
    for (let i = GEARS.length - 1; i >= 1; i--) {
      if (sp >= GEARS[i - 1]) { g = i; break; }
    }
    this.gear = g;
    const lo = GEARS[g - 1], hi = GEARS[g];
    const frac = hi > lo ? THREE.MathUtils.clamp((sp - lo) / (hi - lo), 0, 1) : 0;
    /* Blipping: on a closed throttle the revs sit lower in the band than they
       do pulling hard at the same road speed. */
    const target = IDLE_RPM + (MAX_RPM - IDLE_RPM) * (0.22 + frac * 0.78)
      * (0.72 + this.throttle * 0.28);
    this.rpm += (target - this.rpm) * Math.min(1, h * 6.5);
  }

  /* ================================================================ update */

  update(dt) {
    this.syncPose(dt);
    const A = this.audio;
    if (A) {
      const d = this.ctx.camera.position.distanceTo(this.renderPos);
      const near = THREE.MathUtils.clamp(1 - (d - 6) / 55, 0, 1);
      A.update(this.rpm, this.throttle, this.running ? near : 0);
    }
  }

  /** Idempotent per frame — Player calls it before reading the seat. */
  syncPose(dt) {
    const f = this.ctx.time ? this.ctx.time.frame : -1;
    if (f >= 0 && this._posedFrame === f) return;
    this._posedFrame = f;
    const a = this.physics ? this.physics.alpha : 1;
    this.renderPos.lerpVectors(this.prevPos, this.state.position, a);
    this._pose(dt);
  }

  /* ------------------------------------------------------------- animation */

  _pose(dt) {
    const h = Math.min(dt || 1 / 60, 1 / 30);
    const world = this.ctx.world;
    const base = this.renderPos;
    const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    /*
     * ATTITUDE FROM THE CONTACT PATCHES. The bike does not sit on the ground
     * height at its own centre — it sits on two points 1.5 m apart, and taking
     * the pitch from those is what stops it burying its nose crossing a ditch
     * and what makes cresting a rise read as cresting a rise.
     */
    const rx = base.x + fwd.x * BIKE.rearAxle, rz = base.z + fwd.z * BIKE.rearAxle;
    const fx = base.x + fwd.x * BIKE.frontAxle, fz = base.z + fwd.z * BIKE.frontAxle;
    const ry = world.getHeight(rx, rz), fy = world.getHeight(fx, fz);
    const pitchTarget = Math.atan2(ry - fy, BIKE.wheelbase);
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, h * 12);
    const groundY = Math.min(ry, fy) + Math.abs(ry - fy) * 0.5;

    /* --- lean: the real balance condition ------------------------------- */
    const yawRate = this._yawRate || 0;
    let leanTarget = Math.atan2(Math.abs(this.speed) * yawRate, 9.81);
    leanTarget = THREE.MathUtils.clamp(leanTarget, -0.62, 0.62);
    /* Parked, it is on its side stand, tipped over toward the rider's left. */
    if (!this.mounted && Math.abs(this.speed) < 0.05) leanTarget = 0.17;
    this.lean += (leanTarget - this.lean) * Math.min(1, h * 7.5);

    /* --- suspension ------------------------------------------------------ */
    const dY = groundY - this._prevGroundY;
    this._prevGroundY = groundY;
    /* Spring-damper driven by how hard the ground just moved under the wheel
       plus a share of the braking dive, in metres of fork travel. */
    /*
     * A ROAD IS SMOOTH, and the suspension is where the player feels that.
     * The terrain under the road is the same lumpy heightfield it always was —
     * the roadbed is draped, not graded (see Roads.js for why) — so without
     * this the state route rides exactly like the field beside it and the
     * whole system reads as a texture with a speed buff attached. Damping the
     * fork input by how much road is under the wheel puts the difference back
     * where it belongs: on the bars.
     */
    const roadSmooth = 1 - (this.onRoad || 0) * 0.72;
    const impulse = THREE.MathUtils.clamp(-dY * 4.5, -1, 1) * BIKE.forkTravel * roadSmooth;
    const dive = THREE.MathUtils.clamp(-this._accelEst() * 0.012, -0.4, 0.9) * BIKE.forkTravel;
    const want = THREE.MathUtils.clamp(impulse + dive, -BIKE.forkTravel, BIKE.forkTravel);
    this._forkVel += (want - this._forkComp) * 190 * h - this._forkVel * 17 * h;
    this._forkComp = THREE.MathUtils.clamp(this._forkComp + this._forkVel * h,
      -BIKE.forkTravel, BIKE.forkTravel);

    /* --- engine shake ---------------------------------------------------- */
    /* A big twin idling shakes the whole machine visibly; the vibration
       smooths out as the revs rise, which is the opposite of what people
       expect and exactly what real engines do. */
    const t = this.ctx.time ? this.ctx.time.elapsed : 0;
    const idleness = this.running
      ? 1 - THREE.MathUtils.clamp((this.rpm - IDLE_RPM) / 2600, 0, 0.82) : 0;
    this._shake = idleness * 0.0042 * (0.6 + this.throttle * 0.8);
    const shakeY = Math.sin(t * 47.0) * this._shake;
    const shakeR = Math.sin(t * 39.0 + 1.1) * this._shake * 2.4;

    /* --- write the transforms -------------------------------------------- */
    this.group.position.set(base.x, groundY + shakeY, base.z);
    this.group.rotation.set(0, this.yaw, 0);
    this.lean3.rotation.set(this.pitch, 0, this.lean + shakeR);
    this.lean3.position.y = -this._forkComp * 0.30;

    this.steerPivot.rotation.y = this.steer * 0.72;
    this.forkSlide.position.y = -this._forkComp;

    const spin = (this.speed / BIKE.wheelR) * h;
    this._wheelAng += spin;
    this.wheelR.rotation.x = this._wheelAng;
    this.wheelF.rotation.x = this._wheelAng;

    this.group.updateMatrixWorld(true);
    this._updateHeadlight(fwd);
    this._updateContact(rx, ry, rz, fx, fy, fz);
    this._updateVisibility();
  }

  /** Longitudinal acceleration estimate, m/s², for the brake dive. */
  _accelEst() {
    const prev = this._spPrev || 0;
    this._spPrev = this.speed;
    const dt = this.ctx.time ? Math.max(1e-3, this.ctx.time.dt) : 1 / 60;
    const a = (this.speed - prev) / dt;
    this._accelSm = (this._accelSm || 0) * 0.85 + a * 0.15;
    return this._accelSm;
  }

  _updateHeadlight(fwd) {
    const on = this.headlightOn && this.running;
    const l = this.headlight;
    if (!l) return;
    /* Auto: nobody wants to remember a light switch, so it comes on by itself
       in the dark and L only overrides. */
    const dark = 1 - (this.ctx.env.daylight || 0);
    const want = (on || (this.running && dark > 0.55)) ? 1 : 0;
    this._beam = (this._beam || 0) + (want - (this._beam || 0)) * 0.12;
    l.intensity = this._beam * 46;
    l.visible = this._beam > 0.02;
    const p = this.renderPos;
    l.position.set(p.x + fwd.x * 0.72, p.y + 0.95, p.z + fwd.z * 0.72);
    /* Aimed slightly down — a headlight on the horizon lights nothing you are
       about to ride into. */
    l.target.position.set(p.x + fwd.x * 26, p.y + 0.10, p.z + fwd.z * 26);
    l.target.updateMatrixWorld();
    if (this.mats && this.mats.lens) this.mats.lens.emissiveIntensity = this._beam * 7;
  }

  _updateContact(rx, ry, rz, fx, fy, fz) {
    if (!this.contact) return;
    _v.set(rx, ry, rz); _v2.set(fx, fy, fz);
    this.contact.update([_v, _v2], [0.40, 0.34], [1, 1]);
  }

  _updateVisibility() {
    const cam = this.ctx.camera;
    const rig = this.ctx.get('camera');
    let vis = true;
    if (rig && rig.freeCam) {
      const d = cam.position.distanceTo(this.renderPos);
      vis = d > 1.6 && d < 90;
      const pl = this.ctx.get('player');
      if (pl && pl.visible === false) vis = false;
    }
    this.visible = vis;
    this.group.visible = vis;
    if (!vis && this.contact) this.contact.mesh.visible = false;
  }

  /* ------------------------------------------------------------ rider API */

  /**
   * Where the rider sits, and where their boots and hands go.
   *
   * Deliberately the same contract the horse's `getSaddle()` published, so
   * Player's mounted pose and mount/dismount transition work against either
   * without a branch:
   *
   *   position/quaternion   the seat, carrying the machine's live pitch and lean
   *   stirrupL/R            footpegs
   *   bobMetres             suspension travel this frame, so the rider absorbs
   *                         the bumps through hip and knee exactly as the
   *                         equestrian pose already absorbs the horse's stride
   *   freq                  ZERO, always. Player gates its whole gait-rocking
   *                         chain on this, and a rider posting to an engine is
   *                         the single funniest bug this conversion can produce.
   *
   * `gripL/R` and `vehicle` are additive: Player uses them to put the hands on
   * the bars instead of over a saddle horn.
   */
  getSaddle(out) {
    const r = out || this._seatOut || (this._seatOut = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      stirrupL: new THREE.Vector3(), stirrupR: new THREE.Vector3(),
      gripL: new THREE.Vector3(), gripR: new THREE.Vector3(),
    });
    this.lean3.updateMatrixWorld(true);
    const M = this.lean3.matrixWorld;
    r.position.copy(SEAT).applyMatrix4(M);
    r.quaternion.setFromRotationMatrix(M);
    r.stirrupL.copy(PEG).applyMatrix4(M);
    r.stirrupR.set(-PEG.x, PEG.y, PEG.z).applyMatrix4(M);
    /* Grips are on the FRONT assembly, so they move with the steering — and
       the rider's hands follow them, which is most of what sells the steering
       as something the rider is doing rather than something happening to them. */
    this.steerPivot.updateMatrixWorld(true);
    const F = this.forkSlide.matrixWorld;
    r.gripL.set(GRIP.x - BIKE.barHalf + 0.290, 0.090, -0.055).applyMatrix4(F);
    r.gripR.set(-(GRIP.x - BIKE.barHalf + 0.290), 0.090, -0.055).applyMatrix4(F);
    r.bobMetres = -this._forkComp * 0.30;
    r.gaitPhase = 0;
    r.gait = 'roll';
    r.speed01 = this.speed01;
    r.freq = 0;
    r.vehicle = true;
    return r;
  }

  /** For the HUD and anything else that wants to show the machine's state. */
  status() {
    return {
      fuel: this.fuel, running: this.running, rpm: this.rpm, gear: this.gear,
      speed: this.speed, speedKph: this.speed * 3.6, headlight: this._beam > 0.5,
      onRoad: this.onRoad || 0, grip: this.grip || 1,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    if (this.physics && this._stepFn) this.physics.removeStepper(this._stepFn);
    if (this.collider) this.collider.dispose();
    if (this.audio) this.audio.dispose();
    const lighting = this.ctx.get('lighting');
    if (lighting && lighting.removeLight && this.headlight) lighting.removeLight(this.headlight);
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const k in (this.mats || {})) this.mats[k].dispose();
    if (this.contact) this.contact.dispose();
    this.ctx.scene.remove(this.group);
  }
}

import * as THREE from 'three';
import { buildRoadNetwork, RoadIndex, CLASS } from './roads/Network.js';
import { buildStation, siteStations, PUMP_RANGE } from './roads/Stations.js';
import { rng } from '../core/Context.js';

/**
 * BROKEN ROAD — ROADS
 * ============================================================================
 * Owns the road network: where it goes, what class each road is, where the fuel
 * stations are, and the query every other system asks of it.
 *
 * IT DOES NOT DRAW THE ROAD SURFACE. Scatter already streams a ground ribbon
 * around the player with a cross-section, wear, cavity dirt and the terrain's
 * own ground-detail material, and duplicating that here would mean two ribbons
 * fighting over the same z-range. So this system publishes the plan and Scatter
 * renders it — which is also why Roads must init BEFORE Scatter and before
 * Vegetation, both of which need to keep off it.
 *
 * WHY THE ROADBED IS DRAPED AND NOT GRADED
 * The obvious move is to flatten the terrain under the road with Terrain's
 * `addHeightOverride`, the way the town's street does. It was measured and
 * rejected: `getHeight` consults overrides with a LINEAR SCAN, and it is the
 * hottest function in the engine (physics twice per character per fixed step,
 * foot IK four more times, plus scatter, wildlife and audio). One town pad
 * costs four compares. A road network chunked finely enough to grade would add
 * on the order of a hundred and forty footprints to that scan, on every query,
 * forever.
 *
 * So the roads follow the ground instead, and the router earns that by
 * punishing gradient quadratically — a least-effort path is smooth by
 * construction, which is most of what grading would have bought. What it costs
 * is cuttings and embankments, and a Cascade logging road does not have many of
 * those anyway.
 *
 * WHAT THE ROAD IS WORTH
 * `speedFactor()` is the whole point. On the state route the bike will do about
 * 108 km/h against 97 across country, it holds grip in the wet, and its
 * suspension stops working — and those three together are what make choosing
 * the long way round on the road, rather than the short way over the hill, a
 * real decision.
 * ============================================================================
 */

/** How far off the running surface the speed bonus survives, metres. */
const SHOULDER = 1.9;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Roads {
  static id = 'roads';

  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng((ctx.seed ^ 0x6ad3f107) >>> 0);
    /** Route polylines, each tagged `cls`, `halfWidth`, `speed`. */
    this.routes = [];
    /** @type {RoadIndex|null} */
    this.index = null;
    /** Fuel stations, with their remaining reserve. */
    this.stations = [];
    this._near = null;
    this._ready = false;
  }

  /* ------------------------------------------------------------------ init */

  async init() {
    const ctx = this.ctx;
    if (!ctx.world.ready) return;          // terrain failed; degrade quietly

    this.routes = buildRoadNetwork(ctx, ctx.seed);
    this.index = new RoadIndex(this.routes, 48);

    this._buildStations();
    this._registerPOIs();
    this._ready = true;
  }

  /* -------------------------------------------------------------- stations */

  _buildStations() {
    const ctx = this.ctx;
    const world = ctx.world;
    const sites = siteStations(this.routes, world, this.rand);
    if (!sites.length) return;

    const proc = ctx.get('procTextures');
    const mk = (n, o) => (proc && proc.material ? proc.material(n, o)
      : new THREE.MeshStandardMaterial(o));

    const structMat = mk('metal_worn', {
      color: new THREE.Color(0.30, 0.30, 0.29), roughness: 0.86, metalness: 0.35,
    });
    /*
     * The sign is the only saturated colour in this world and it is spent
     * deliberately. Everything else in the palette is grey-green mud precisely
     * so that this reads from a kilometre away through rain — it is a
     * navigation aid before it is set dressing. Emissive is low but non-zero
     * even by day: the ones still on their own generator are the ones with
     * fuel, and the player learns that within about two stops.
     */
    const signMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.52, 0.16, 0.09),
      emissive: new THREE.Color(0.85, 0.28, 0.14),
      emissiveIntensity: 0.9,
      roughness: 0.62, metalness: 0.0,
    });
    this.mats = { structMat, signMat };

    const built = buildStation(this.rand);
    this.structMesh = new THREE.InstancedMesh(built.structure, structMat, sites.length);
    this.signMesh = new THREE.InstancedMesh(built.sign, signMat, sites.length);
    for (const m of [this.structMesh, this.signMesh]) {
      m.name = 'roads:' + (m === this.signMesh ? 'sign' : 'station');
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      ctx.scene.add(m);
    }

    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      _q.setFromAxisAngle(UP, s.yaw);
      _m.compose(s.pos, _q, _s);
      this.structMesh.setMatrixAt(i, _m);
      this.signMesh.setMatrixAt(i, _m);

      /* Pump positions in world space, so the interaction test is a distance
         to the thing the player can actually see rather than to a site centre
         thirteen metres away. */
      const pumps = built.pumps.map((p) => {
        const w = p.clone().applyQuaternion(_q).add(s.pos);
        return w;
      });
      this.stations.push({
        index: i, pos: s.pos.clone(), yaw: s.yaw, pumps,
        tanks: s.tanks, maxTanks: s.tanks, route: s.route,
      });
    }
    this.structMesh.instanceMatrix.needsUpdate = true;
    this.signMesh.instanceMatrix.needsUpdate = true;

    const L = ctx.get('lighting');
    if (L && L.requestShadowCaster) {
      L.requestShadowCaster(this.structMesh);
    }
  }

  _registerPOIs() {
    const ctx = this.ctx;
    if (this.stations.length) {
      const s = this.stations[0];
      ctx.poi.set('station', {
        pos: new THREE.Vector3(s.pos.x, s.pos.y + 1.6, s.pos.z),
        look: new THREE.Vector3(s.pos.x, s.pos.y + 4.0, s.pos.z),
      });
    }
    /* A viewpoint down the state route, for the capture harness and because it
       is the single most characteristic frame this world has. */
    for (const r of this.routes) {
      if (!r.cls || r.cls.name !== 'highway' || r.length < 120) continue;
      const a = r[Math.floor(r.length * 0.30)];
      const b = r[Math.floor(r.length * 0.30) + 40];
      ctx.poi.set('road', {
        pos: new THREE.Vector3(a.x, a.y + 1.9, a.z),
        look: new THREE.Vector3(b.x, b.y + 1.6, b.z),
      });
      break;
    }
  }

  /* -------------------------------------------------------------- contract */

  /**
   * How much of a road the player is on.
   *
   * @returns {{on:number, speed:number, d:number, tx:number, tz:number}}
   *   `on` is 0 off-road, 1 on the running surface, easing out over the
   *   shoulder so a rider drifting onto the verge loses the bonus gradually
   *   instead of falling off a cliff edge in the handling model.
   */
  query(x, z) {
    const out = this._out || (this._out = { on: 0, speed: 1, d: 1e9, tx: 0, tz: 1 });
    out.on = 0; out.speed = 1; out.d = 1e9; out.tx = 0; out.tz = 1;
    if (!this.index) return out;
    const n = this.index.nearest(x, z);
    if (!n) return out;
    out.d = n.d;
    out.tx = n.tx; out.tz = n.tz;
    out.speed = n.speed;
    const half = n.half;
    if (n.d <= half) out.on = 1;
    else if (n.d < half + SHOULDER) out.on = 1 - (n.d - half) / SHOULDER;
    return out;
  }

  /** Cheap keep-out test for the vegetation and scatter bakes. */
  distance2(x, z) {
    return this.index ? this.index.distance2(x, z) : 1e9;
  }

  /** The station whose pumps the player is standing at, or null. */
  nearestStation() { return this._near; }

  /**
   * Draw fuel. Fills the tank from the station's reserve.
   *
   * @returns {boolean} false if the station is dry or the tank is already full
   */
  usePump(station) {
    const st = station || this._near;
    const hud = this.ctx.get('hud');
    const bike = this.ctx.get('bike');
    if (!st || !bike) return false;
    if (st.tanks <= 0) {
      if (hud && hud.notify) hud.notify('Pumps are dry');
      return false;
    }
    if (bike.fuel > 0.985) {
      if (hud && hud.notify) hud.notify('Tank’s full');
      return false;
    }
    /* One draw fills the tank and costs the station one of its reserve,
       however much was actually needed. Charging by the litre would reward
       topping up every few hundred metres, which is tedious and is not the
       decision this system exists to create. */
    st.tanks -= 1;
    bike.fuel = 1;
    if (!bike.running && bike.mounted) bike._start();

    const A = this.ctx.get('audio');
    if (A && A.play) A.play('clink', { position: st.pos, volume: 0.5, pitch: 0.72 });
    if (hud && hud.notify) {
      hud.notify(st.tanks > 0 ? `Tank full — ${st.tanks} left here` : 'Tank full — pumps dry now');
    }
    /*
     * A working pump is a generator, and a generator is a noise. Refuelling is
     * the loudest thing you can do standing still, and stations are on the
     * highway where the infected already are.
     */
    const F = this.ctx.get('freakers');
    if (F && F.alarm) F.alarm(st.pos, 78, 0.75);
    this.ctx.emit('refuelled', { position: st.pos.clone(), left: st.tanks });
    return true;
  }

  /** For the HUD and the save/debug surfaces. */
  stats() {
    let fuelLeft = 0;
    for (const s of this.stations) fuelLeft += s.tanks;
    return {
      routes: this.routes.length,
      stations: this.stations.length,
      tanksLeft: fuelLeft,
      onRoad: this._lastOn || 0,
    };
  }

  /* ----------------------------------------------------------------- frame */

  update() {
    if (!this._ready) return;
    const p = this.ctx.player.position;

    /* Nearest usable pump. Only a handful of stations exist, so this is a flat
       scan and it is cheaper than maintaining an index for fourteen points. */
    let near = null, nd = PUMP_RANGE * PUMP_RANGE;
    for (const st of this.stations) {
      if (st.tanks <= 0) continue;
      for (const pump of st.pumps) {
        const dx = pump.x - p.x, dz = pump.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nd) { nd = d2; near = st; }
      }
    }
    this._near = near;

    const q = this.query(p.x, p.z);
    this._lastOn = q.on;
  }

  dispose() {
    for (const m of [this.structMesh, this.signMesh]) {
      if (!m) continue;
      this.ctx.scene.remove(m);
      m.geometry.dispose();
    }
    for (const k in (this.mats || {})) this.mats[k].dispose();
  }
}

export { CLASS };

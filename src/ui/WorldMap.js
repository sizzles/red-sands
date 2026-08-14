import { WORLD } from '../core/Config.js';

/**
 * BROKEN ROAD — THE MAP
 * ============================================================================
 * An 8 km square is too big to hold in your head, and this one has no
 * landmarks you did not find yourself. So: a map you draw by walking.
 *
 * WHY FOG OF WAR AND NOT A MAP
 * A complete map given at the start answers the only question this game asks —
 * where is it safe to go — before the player has earned an opinion. Fog turns
 * the map into a record of where you have been, which in a survival game is
 * the same thing as a record of what you survived. It also makes the ridges
 * worth climbing: reveal radius grows with altitude, so the cheapest way to
 * chart a valley is to look down into it from above, which is exactly what a
 * person would do.
 *
 * WHAT IS DRAWN, AND WHAT IT COSTS
 * The terrain plate is baked ONCE, at first open, by downsampling rasters the
 * terrain system already has in memory: the 2048² heightfield, the 1024² splat
 * weights and the 1024² water mask. Nothing is queried through world.getHeight
 * — 260,000 of those calls would add a second to a boot that is already
 * thirty-three, and every value is sitting in a typed array anyway.
 *
 * The fog is a 256² byte grid, so the whole thing is 64 KB and a reveal is a
 * few dozen byte writes. It is composited to its own canvas only while the map
 * is open, and only a few times a second, because a fog edge that updates at
 * 60 Hz looks exactly like one that updates at 4.
 *
 * POIs appear only once the ground under them has been seen. A marker for a
 * place you have not found is a spoiler with a compass bearing.
 * ============================================================================
 */

const CORE = WORLD.size;               // 8192 m playable square, centred on 0
const HALF = CORE / 2;

/** Fog cells across the world. 256 -> 32 m per cell, 64 KB total. */
const FOG_RES = 256;
/** Baked terrain plate resolution. */
const PLATE = 640;

/** Metres revealed at sea level, and how much altitude adds. */
const SEE_BASE = 95, SEE_PER_M = 0.62, SEE_MAX = 300;

/* The map's own ink. Deliberately the HUD's warm paper rather than a satnav:
   this is a thing the drifter is keeping, not a thing the world is telling. */
const INK = [232, 222, 202];
const PAPER = [26, 24, 22];

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** What each POI is called on the map, and whether it is worth a label. */
const POI_LABELS = {
  town: 'Town', station: 'Fuel', stash: 'Stash', nest: 'Nest',
  compound: 'The Pass', compound_site: 'The Pass', camp: 'Camp',
  checkpoint: 'Checkpoint', bench: 'Garage', gunbench: 'Gunsmith',
  bike: 'Bike', river: 'River', forest: 'Forest',
};
/** Drawn but never labelled — they would crowd the plate. */
const POI_SILENT = new Set(['forest_fwd', 'forest_stand', 'player_fwd',
  'player_ots', 'river_down', 'town_center', 'town_end', 'camp_fire', 'road']);

export class WorldMap {
  static id = 'worldMap';

  constructor(ctx) {
    this.ctx = ctx;
    this.open = false;
    /** 0..1 open/close envelope, so it does not snap. */
    this.a = 0;
    this.canvas = null;
    this.c2d = null;
    /** Baked terrain plate; null until the map is first opened. */
    this._plate = null;
    /** Discovery, 0..255 per cell. */
    this.fog = new Uint8Array(FOG_RES * FOG_RES);
    this._fogCanvas = null;
    this._fogDirty = true;
    this._fogT = 0;
    this._seen = 0;
    this._lastMark = { x: 1e9, z: 1e9 };
  }

  async init() {
    const ctx = this.ctx;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
      + 'pointer-events:none;z-index:40;display:none';
    (ctx.renderer.domElement.parentElement || document.body).appendChild(cv);
    this.canvas = cv;
    this.c2d = cv.getContext('2d');
    this.resize(window.innerWidth, window.innerHeight);

    this._onKey = (e) => {
      if (e.code === 'KeyM' && !e.repeat) {
        this.open = !this.open;
        if (this.open) { this._bake(); this._fogDirty = true; }
      } else if (e.code === 'Escape' && this.open) {
        this.open = false;
      }
    };
    window.addEventListener('keydown', this._onKey);

    /* Reveal where we start, so the map is never blank on first open. */
    this._mark(ctx.player.position.x, ctx.player.position.z);
  }

  resize() {
    const cv = this.canvas;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    cv.width = Math.floor(this.cssW * dpr);
    cv.height = Math.floor(this.cssH * dpr);
    if (this.c2d) this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------------------------------------------ fog */

  /**
   * Reveal around a world point.
   *
   * The radius grows with altitude because that is the one piece of map-making
   * a person actually does: you climb something to see what is on the other
   * side. It is an approximation — true visibility would need a horizon walk
   * per cell, which is a raycast budget this does not have — but it produces
   * the behaviour that matters, which is that ridges are worth the detour.
   */
  _mark(x, z) {
    const world = this.ctx.world;
    const y = world && world.getHeight ? world.getHeight(x, z) : 0;
    const r = Math.min(SEE_MAX, SEE_BASE + Math.max(0, y - WORLD.waterLevel) * SEE_PER_M);
    const cell = CORE / FOG_RES;
    const cx = (x + HALF) / cell, cz = (z + HALF) / cell;
    const rc = r / cell;
    const i0 = Math.max(0, Math.floor(cx - rc)), i1 = Math.min(FOG_RES - 1, Math.ceil(cx + rc));
    const j0 = Math.max(0, Math.floor(cz - rc)), j1 = Math.min(FOG_RES - 1, Math.ceil(cz + rc));
    const F = this.fog;
    let gained = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - cx, dz = j + 0.5 - cz;
        const d = Math.sqrt(dx * dx + dz * dz) / rc;
        if (d > 1) continue;
        /* Soft edge: full out to 70% of the radius, falling away past it, so
           the frontier reads as haze rather than as a stencil. */
        const v = Math.round(255 * clamp01((1 - d) / 0.3));
        const k = j * FOG_RES + i;
        if (v > F[k]) { if (F[k] === 0) gained++; F[k] = v; this._fogDirty = true; }
      }
    }
    this._seen += gained;
  }

  /** 0..1 of the world charted. Cheap enough to expose; the HUD may want it. */
  get explored() { return this._seen / (FOG_RES * FOG_RES); }

  /* ---------------------------------------------------------------- plate */

  /**
   * Bake the terrain plate from rasters the terrain system already holds.
   *
   * Elevation shading plus a hillshade off the heightfield gradient, tinted by
   * the splat weights so forest, rock and river read differently, and the
   * water mask painted over the top. One pass, about 400k samples, ~80 ms —
   * and it happens on first open rather than at boot, because a player who
   * never presses M should not pay for it.
   */
  _bake() {
    if (this._plate) return;
    const T = this.ctx.get('terrain');
    if (!T || !T.H) return;
    const H = T.H;
    const HR = Math.round(Math.sqrt(H.length));       // 2048
    const SR = T.splatRes || 1024;
    const A = T.splatA, B = T.splatB, WM = T.waterMask;

    const cv = document.createElement('canvas');
    cv.width = PLATE; cv.height = PLATE;
    const g = cv.getContext('2d');
    const img = g.createImageData(PLATE, PLATE);
    const D = img.data;

    /* Elevation range, so the shading uses the range this world actually has
       rather than a guessed one. */
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < H.length; i += 7) {
      const v = H[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = Math.max(1, hi - lo);

    const hAt = (ix, iz) => H[Math.min(HR - 1, Math.max(0, iz)) * HR
      + Math.min(HR - 1, Math.max(0, ix))];

    for (let py = 0; py < PLATE; py++) {
      for (let px = 0; px < PLATE; px++) {
        const u = px / (PLATE - 1), v = py / (PLATE - 1);
        const ix = Math.round(u * (HR - 1)), iz = Math.round(v * (HR - 1));
        const h = hAt(ix, iz);
        const t = clamp01((h - lo) / span);

        /* Hillshade from the local gradient, lit from the north-west the way
           every paper map in the world is lit. */
        const gx = hAt(ix + 2, iz) - hAt(ix - 2, iz);
        const gz = hAt(ix, iz + 2) - hAt(ix, iz - 2);
        const shade = clamp01(0.5 + (-gx * 0.6 - gz * 0.6) * 0.05);

        /* Biome tint from the splat weights. */
        const si = Math.round(v * (SR - 1)) * SR + Math.round(u * (SR - 1));
        const s4 = si * 4;
        const grass = A ? (A[s4] + A[s4 + 1]) / 255 : 0.5;
        const rock = A ? (A[s4 + 3] || 0) / 255 : 0;
        const sand = B ? (B[s4 + 1] || 0) / 255 : 0;

        /* Base: a warm ochre low ground rising to pale rock. */
        let r = 92 + t * 120 + rock * 40 + sand * 30;
        let gg = 88 + t * 112 - grass * 14 + sand * 22;
        let b = 72 + t * 104 - grass * 26;
        r *= shade + 0.35; gg *= (shade + 0.35); b *= (shade + 0.35);

        if (WM && WM[Math.round(v * (SR - 1)) * SR + Math.round(u * (SR - 1))]) {
          r = 44; gg = 62; b = 78;
        }

        const o = (py * PLATE + px) * 4;
        D[o] = Math.min(255, r); D[o + 1] = Math.min(255, gg);
        D[o + 2] = Math.min(255, b); D[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this._plate = cv;
  }

  _buildFogCanvas() {
    if (!this._fogCanvas) {
      const cv = document.createElement('canvas');
      cv.width = FOG_RES; cv.height = FOG_RES;
      this._fogCanvas = cv;
    }
    const g = this._fogCanvas.getContext('2d');
    const img = g.createImageData(FOG_RES, FOG_RES);
    const D = img.data, F = this.fog;
    for (let i = 0; i < F.length; i++) {
      const o = i * 4;
      D[o] = PAPER[0]; D[o + 1] = PAPER[1]; D[o + 2] = PAPER[2];
      /* Never fully transparent even when seen: a faint wash over everything
         keeps the plate sitting under the ink rather than glowing through it. */
      D[o + 3] = 255 - Math.round(F[i] * 0.88);
    }
    g.putImageData(img, 0, 0);
    this._fogDirty = false;
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    const ctx = this.ctx;
    const p = ctx.player.position;

    /* Mark as we go, but only when we have actually moved a cell's worth —
       marking every frame from a standstill is thousands of redundant writes
       a second for no new ground. */
    const dx = p.x - this._lastMark.x, dz = p.z - this._lastMark.z;
    if (dx * dx + dz * dz > 18 * 18) {
      this._lastMark.x = p.x; this._lastMark.z = p.z;
      this._mark(p.x, p.z);
    }

    const want = this.open ? 1 : 0;
    this.a += (want - this.a) * Math.min(1, dt * 12);
    const vis = this.a > 0.004;
    if (this.canvas.style.display !== (vis ? 'block' : 'none')) {
      this.canvas.style.display = vis ? 'block' : 'none';
    }
    if (!vis) return;

    this._fogT += dt;
    if (this._fogDirty && this._fogT > 0.25) { this._fogT = 0; this._buildFogCanvas(); }
    this._draw();
  }

  _draw() {
    const c = this.c2d, W = this.cssW, H = this.cssH;
    const A = this.a;
    c.clearRect(0, 0, W, H);

    /* Dim the game behind it. Not black: you are reading a map, not pausing. */
    c.fillStyle = rgba([0, 0, 0], 0.55 * A);
    c.fillRect(0, 0, W, H);

    const pad = Math.min(W, H) * 0.06;
    const size = Math.min(W, H) - pad * 2;
    const x0 = (W - size) / 2, y0 = (H - size) / 2;

    c.save();
    c.globalAlpha = A;

    /* plate */
    if (this._plate) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this._plate, x0, y0, size, size);
    } else {
      c.fillStyle = rgba(PAPER, 1);
      c.fillRect(x0, y0, size, size);
    }

    /* fog */
    if (this._fogCanvas) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this._fogCanvas, x0, y0, size, size);
    }

    /* frame */
    c.strokeStyle = rgba(INK, 0.5);
    c.lineWidth = 1.5;
    c.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);

    const toScreen = (wx, wz) => ({
      x: x0 + ((wx + HALF) / CORE) * size,
      y: y0 + ((wz + HALF) / CORE) * size,
    });
    const seenAt = (wx, wz) => {
      const i = Math.floor(((wx + HALF) / CORE) * FOG_RES);
      const j = Math.floor(((wz + HALF) / CORE) * FOG_RES);
      if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) return 0;
      return this.fog[j * FOG_RES + i];
    };

    /* POIs, but only where the ground has been seen. */
    c.font = '500 12px ui-sans-serif, system-ui, sans-serif';
    c.textAlign = 'center';
    for (const [key, poi] of this.ctx.poi) {
      if (POI_SILENT.has(key)) continue;
      const v = poi && (poi.isVector3 ? poi : poi.pos);
      if (!v) continue;
      if (seenAt(v.x, v.z) < 40) continue;
      const s = toScreen(v.x, v.z);
      c.fillStyle = rgba(INK, 0.92);
      c.beginPath();
      c.arc(s.x, s.y, 3, 0, Math.PI * 2);
      c.fill();
      const label = POI_LABELS[key];
      if (label) {
        c.fillStyle = rgba(INK, 0.62);
        c.fillText(label, s.x, s.y - 7);
      }
    }

    /* the drifter, and which way he is facing */
    const p = this.ctx.player.position;
    const s = toScreen(p.x, p.z);
    const yaw = this.ctx.player.yaw || 0;
    c.fillStyle = rgba([236, 178, 92], 1);
    c.beginPath();
    c.moveTo(s.x + Math.sin(yaw) * 7, s.y + Math.cos(yaw) * 7);
    c.lineTo(s.x + Math.sin(yaw + 2.5) * 5, s.y + Math.cos(yaw + 2.5) * 5);
    c.lineTo(s.x + Math.sin(yaw - 2.5) * 5, s.y + Math.cos(yaw - 2.5) * 5);
    c.closePath();
    c.fill();

    /* legend */
    c.textAlign = 'left';
    c.fillStyle = rgba(INK, 0.55);
    c.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    c.fillText(`${(this.explored * 100).toFixed(1)}% charted`, x0, y0 - 10);
    c.textAlign = 'right';
    c.fillText('M to close', x0 + size, y0 - 10);

    c.restore();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}

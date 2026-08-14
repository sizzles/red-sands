import { isTouchDevice } from '../core/Config.js';

/**
 * BROKEN ROAD — TOUCH CONTROLS
 * ============================================================================
 * A DOM overlay: a movement stick on the left, look-drag anywhere on the
 * right, and a column of action buttons. It is DOM and not canvas on purpose —
 * the HUD's 2D canvas is redrawn every frame, and putting eight static buttons
 * in it would mean repainting them sixty times a second on the device least
 * able to afford it. As elements they are composited by the browser and cost
 * the render loop exactly nothing.
 *
 * HOW IT DRIVES THE GAME
 * Two different mechanisms, chosen per input for a reason:
 *
 *   ANALOG (stick, look)   written into `player.touch`, which Player's
 *                          `_readInput` merges with the keyboard. A stick is
 *                          not a key — pretending it is throws away the
 *                          gradient between a nudge and a shove, and on a bike
 *                          that gradient is the throttle.
 *
 *   DISCRETE (E, R, fire)  dispatched as real KeyboardEvent / MouseEvent on
 *                          `window`. Every one of those actions already has a
 *                          listener somewhere — Weapon binds mousedown, Player
 *                          and Bike bind KeyE, Loot binds KeyQ — and
 *                          synthesising the event means all of that logic,
 *                          including its priority ordering, runs unchanged
 *                          instead of being reimplemented here and drifting.
 *
 * The context-sensitive button relabels itself (RIDE / OFF / LOOT / SKIN) off
 * the same state the HUD prompt reads, because a fixed grid of cryptic buttons
 * is how mobile ports of this kind of game usually fail.
 * ============================================================================
 */

const CSS = `
.tc-root{position:fixed;inset:0;z-index:40;pointer-events:none;
  font:600 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;
  color:#e8e2d6;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  touch-action:none;}
.tc-root *{box-sizing:border-box;}
.tc-stick{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:max(20px,env(safe-area-inset-bottom));
  width:132px;height:132px;border-radius:50%;pointer-events:auto;
  background:radial-gradient(circle,rgba(20,22,20,.30),rgba(20,22,20,.12) 70%,transparent 72%);
  border:1px solid rgba(232,226,214,.20);}
.tc-nub{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;
  border-radius:50%;background:rgba(232,226,214,.26);border:1px solid rgba(232,226,214,.42);
  transition:background .12s;}
.tc-stick.on .tc-nub{background:rgba(232,226,214,.42);}
.tc-btns{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));
  display:flex;flex-direction:column-reverse;align-items:flex-end;gap:10px;pointer-events:none;}
.tc-row{display:flex;gap:10px;align-items:center;pointer-events:none;}
.tc-b{pointer-events:auto;display:flex;align-items:center;justify-content:center;text-align:center;
  border-radius:50%;background:rgba(20,22,20,.34);border:1px solid rgba(232,226,214,.26);
  letter-spacing:.06em;text-transform:uppercase;padding:0 4px;
  transition:background .09s,transform .09s;}
.tc-b:active,.tc-b.on{background:rgba(232,226,214,.36);transform:scale(.94);}
.tc-b.big{width:78px;height:78px;font-size:12px;}
.tc-b.sm{width:54px;height:54px;font-size:10px;}
.tc-b.hide{opacity:0;pointer-events:none;}
.tc-b.fire{background:rgba(122,34,26,.42);border-color:rgba(226,150,120,.40);}
.tc-look{position:absolute;right:0;top:0;bottom:0;width:56%;pointer-events:auto;}
.tc-hint{position:absolute;left:50%;top:14%;transform:translateX(-50%);
  padding:10px 18px;border-radius:4px;background:rgba(16,18,16,.62);
  font-size:13px;letter-spacing:.10em;text-transform:uppercase;opacity:0;transition:opacity .3s;}
.tc-hint.on{opacity:1;}
`;

export class TouchControls {
  static id = 'touch';

  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = false;
    /** Merged into Player.input each fixed step. */
    this.axes = { f: 0, r: 0, sprint: false, active: false };
    this._touches = new Map();
    this._els = {};
    this._lastLabel = '';
  }

  async init() {
    const force = new URLSearchParams(location.search).get('touch');
    if (force === '0') return;
    if (!isTouchDevice() && force !== '1') return;
    this.enabled = true;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this._style = style;

    const root = document.createElement('div');
    root.className = 'tc-root';
    root.innerHTML = `
      <div class="tc-look"></div>
      <div class="tc-stick"><div class="tc-nub"></div></div>
      <div class="tc-btns">
        <div class="tc-row">
          <div class="tc-b sm" data-a="crouch">Crouch</div>
          <div class="tc-b big fire" data-a="fire">Fire</div>
        </div>
        <div class="tc-row">
          <div class="tc-b sm" data-a="reload">R</div>
          <div class="tc-b sm" data-a="aim">Aim</div>
          <div class="tc-b big" data-a="use">Ride</div>
        </div>
        <div class="tc-row">
          <div class="tc-b sm" data-a="meds">Med</div>
          <div class="tc-b sm" data-a="light">Lamp</div>
          <div class="tc-b sm" data-a="boost">Run</div>
        </div>
      </div>
      <div class="tc-hint">Rotate to landscape</div>`;
    document.body.appendChild(root);
    this.root = root;

    this._els.stick = root.querySelector('.tc-stick');
    this._els.nub = root.querySelector('.tc-nub');
    this._els.look = root.querySelector('.tc-look');
    this._els.use = root.querySelector('[data-a="use"]');
    this._els.hint = root.querySelector('.tc-hint');
    this._els.buttons = [...root.querySelectorAll('.tc-b')];

    this._bindStick();
    this._bindLook();
    this._bindButtons();

    /* Hand the analog axes to Player, and go fullscreen on the first tap —
       mobile browsers hide the address bar only on a user gesture, and the
       hundred pixels it occupies are worth having. */
    const pl = this.ctx.get('player');
    if (pl) pl.touch = this.axes;
    this._onFirst = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
      window.removeEventListener('touchstart', this._onFirst);
    };
    window.addEventListener('touchstart', this._onFirst, { passive: true });

    /* The canvas click handler requests pointer lock, which on touch does
       nothing useful and can swallow the first tap. */
    this._onCanvasTouch = (e) => e.preventDefault();
    if (this.ctx.canvas) {
      this.ctx.canvas.addEventListener('touchstart', this._onCanvasTouch, { passive: false });
    }
  }

  /* ----------------------------------------------------------------- stick */

  _bindStick() {
    const el = this._els.stick;
    const R = 52;                       // travel, px
    let id = null, cx = 0, cy = 0;

    const down = (t, rect) => {
      id = t.identifier;
      /* Recentre on the touch rather than on the widget: on a small screen
         nobody's thumb lands where the art says the stick is, and a stick that
         jumps to meet the thumb is the single biggest usability win available
         here. */
      cx = t.clientX; cy = t.clientY;
      el.classList.add('on');
      void rect;
    };
    const move = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this._els.nub.style.transform = `translate(${dx}px,${dy}px)`;
      const nx = dx / R, ny = dy / R;
      this.axes.r = Math.max(-1, Math.min(1, nx));
      this.axes.f = Math.max(-1, Math.min(1, -ny));
      this.axes.active = true;
      /* Push the stick past 80% and you are running — no separate sprint
         button needed for the common case, though one exists for the thumb
         that prefers it. */
      this.axes.sprint = this._boost || (-ny > 0.80);
    };
    const up = () => {
      id = null;
      el.classList.remove('on');
      this._els.nub.style.transform = '';
      this.axes.f = 0; this.axes.r = 0;
      this.axes.active = false;
      this.axes.sprint = this._boost || false;
    };

    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (id === null) { down(e.changedTouches[0]); move(e.changedTouches[0]); }
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (id === null) return;
      for (const t of e.changedTouches) if (t.identifier === id) { e.preventDefault(); move(t); }
    }, { passive: false });
    const end = (e) => {
      if (id === null) return;
      for (const t of e.changedTouches) if (t.identifier === id) up();
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }

  /* ------------------------------------------------------------------ look */

  _bindLook() {
    const el = this._els.look;
    let id = null, px = 0, py = 0;
    /* Roughly matched to the mouse sensitivity in Player, scaled up because a
       thumb travels far less than a mouse does. */
    const SENS_X = 0.0052, SENS_Y = 0.0042;

    el.addEventListener('touchstart', (e) => {
      if (id !== null) return;
      const t = e.changedTouches[0];
      id = t.identifier; px = t.clientX; py = t.clientY;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (id === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        e.preventDefault();
        const dx = t.clientX - px, dy = t.clientY - py;
        px = t.clientX; py = t.clientY;
        const pl = this.ctx.get('player');
        if (!pl) return;
        pl.yaw -= dx * SENS_X;
        while (pl.yaw > Math.PI) pl.yaw -= Math.PI * 2;
        while (pl.yaw < -Math.PI) pl.yaw += Math.PI * 2;
        pl.pitch = Math.max(-1.15, Math.min(0.95, pl.pitch - dy * SENS_Y));
        pl._yawTarget = pl.yaw;
        pl._lookIdle = 0;
      }
    }, { passive: false });

    const end = (e) => {
      if (id === null) return;
      for (const t of e.changedTouches) if (t.identifier === id) id = null;
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  /* --------------------------------------------------------------- buttons */

  _key(code, down) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      code, key: code, bubbles: true,
    }));
  }

  _mouse(button, down) {
    window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', {
      button, bubbles: true,
    }));
  }

  _bindButtons() {
    for (const b of this._els.buttons) {
      const action = b.dataset.a;
      const press = (on) => {
        b.classList.toggle('on', on);
        this._act(action, on);
      };
      b.addEventListener('touchstart', (e) => { e.preventDefault(); press(true); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); press(false); }, { passive: false });
      b.addEventListener('touchcancel', () => press(false));
    }
  }

  _act(action, on) {
    switch (action) {
      /* Held actions: fire, aim, crouch, run. These have to be press-and-hold
         because the underlying systems are edge-and-level driven — the trigger
         is held for a follow-up shot, the sights stay up while the button is
         down — and faking a hold with a tap would break both. */
      case 'fire': this._mouse(0, on); break;
      case 'aim': this._mouse(2, on); break;
      case 'crouch': this._key('ControlLeft', on); break;
      case 'boost':
        this._boost = on;
        this.axes.sprint = on || this.axes.sprint;
        if (!on) this.axes.sprint = false;
        break;
      /* Edge actions: only on press. */
      case 'use': if (on) this._key('KeyE', true), this._key('KeyE', false); break;
      case 'reload': if (on) this._key('KeyR', true), this._key('KeyR', false); break;
      case 'meds': if (on) this._key('KeyQ', true), this._key('KeyQ', false); break;
      case 'light': if (on) this._key('KeyL', true), this._key('KeyL', false); break;
      default: break;
    }
  }

  /* ----------------------------------------------------------------- frame */

  update() {
    if (!this.enabled) return;
    const ctx = this.ctx;

    /* Relabel the context button off the same state the HUD prompt uses, so
       the two never disagree. */
    let label = 'Ride';
    const mounted = ctx.player.mode === 'mounted';
    if (mounted) {
      label = 'Off';
    } else {
      const loot = ctx.get('loot');
      const roads = ctx.get('roads');
      const pl = ctx.get('player');
      if (roads && roads.nearestStation && roads.nearestStation()) label = 'Fuel';
      else if (loot && loot.nearest && loot.nearest()) label = 'Loot';
      else if (pl && pl.carcass) label = 'Skin';
      else if (pl && pl.pickup) label = 'Take';
    }
    if (label !== this._lastLabel) {
      this._lastLabel = label;
      if (this._els.use) this._els.use.textContent = label;
    }

    /* Aiming down the sights from the saddle is not a thing, so hide the
       buttons that cannot do anything rather than leaving dead controls under
       the player's thumb. */
    const hideAim = mounted;
    for (const b of this._els.buttons) {
      if (b.dataset.a === 'aim' || b.dataset.a === 'reload') {
        b.classList.toggle('hide', hideAim);
      }
      if (b.dataset.a === 'light') {
        b.classList.toggle('hide', !mounted);
      }
    }

    if (this._els.hint) {
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      this._els.hint.classList.toggle('on', portrait);
    }
  }

  dispose() {
    if (this.root) this.root.remove();
    if (this._style) this._style.remove();
    if (this.ctx.canvas && this._onCanvasTouch) {
      this.ctx.canvas.removeEventListener('touchstart', this._onCanvasTouch);
    }
    window.removeEventListener('touchstart', this._onFirst);
    const pl = this.ctx.get('player');
    if (pl && pl.touch === this.axes) pl.touch = null;
  }
}

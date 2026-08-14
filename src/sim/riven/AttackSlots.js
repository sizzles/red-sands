/**
 * BROKEN ROAD — ATTACK SLOTS
 * ============================================================================
 * How many of them may commit to you at once, and who.
 *
 * WHY A CROWD NEEDS AN ARBITER
 * The naive horde is the one this game shipped: every Riven inside its reach
 * independently decides to swing, so ten of them land ten hits in the same
 * second and there is nothing a player can do about any of it. The fight has
 * no shape. You cannot read it, cannot prioritise, cannot back off — you can
 * only lose health at a rate proportional to how many bodies fit around you,
 * which is a geometry problem rather than a combat one.
 *
 * The fix every good crowd-fighting game uses is the same: a small number of
 * ATTACK TICKETS. Two or three of the crowd are committed at any moment and
 * everyone else circles, presses, feints and waits their turn. The pressure is
 * unchanged — you are still surrounded — but the THREAT is legible, because
 * the ones who mean it right now are the ones moving at you.
 *
 * WHAT IT ALSO BUYS
 * Cost. The expensive part of a horde is not standing in it, it is the
 * close-quarters logic every committed agent runs. Bounding commitment bounds
 * that work regardless of how many bodies are on screen, so forty Riven cost
 * about what six do.
 *
 * WEIGHT, NOT COUNT
 * Tickets are spent by weight, so a cairn — slow, plated, twice your mass —
 * costs the whole ring on its own and fights you alone while the strays circle.
 * A keener costs nothing and takes nothing: its standoff is an order of
 * magnitude past its reach, so it never commits and must never hold a ticket
 * it cannot use.
 *
 * HYSTERESIS IS THE WHOLE CRAFT
 * A ring that re-sorts every frame produces a shimmering crowd that lurches in
 * and out of commitment and reads far worse than no ring at all. So a ticket
 * is held for a minimum time before it can be taken away, a fresh swing puts
 * its owner on cooldown and yields the ticket to somebody else, and an
 * incumbent gets a scoring bonus purely for already having it.
 *
 * This module imports nothing. It is arithmetic over plain agent objects, so
 * the conformance suite can drive it with synthetic crowds and a port
 * reimplements one file.
 * ============================================================================
 */

/** Tuning. Weights are in ticket units; see `cost` on the type defs. */
export const RING = {
  /** Total ticket weight that may be committed at once. */
  budget: 3,
  /** Metres past `reach` within which an agent competes for a ticket at all. */
  band: 3.2,
  /** Metres from the player the uncommitted hold. */
  radius: 4.0,
  /** Seconds a ticket is safe from being revoked. */
  minHold: 0.9,
  /** Seconds an agent sits out after a swing before competing again. */
  cooldown: 1.5,
  /** Score bonus for already holding a ticket. Pure anti-shimmer. */
  incumbency: 6.0,
  /**
   * Score bonus per ticket of weight ABOVE one.
   *
   * Without it a heavy agent starves. Weight decides what a ticket costs but
   * says nothing about who gets offered one, so a cairn — slower than the
   * strays, and needing the entire ring free at once — arrives to find three
   * light incumbents in possession and never swings again. Measured on a
   * twelve-agent crowd: the cairn landed zero blows in four seconds.
   *
   * At 4.0 a cairn outranks incumbency, so it takes the ring as soon as the
   * incumbents' minHold expires — up to 0.9 s of the strays getting their
   * blows in first, and then a duel. That delay is the right read: the big one
   * wades through its own crowd to reach you.
   */
  heavy: 4.0,
  /** Radians per second the circlers orbit at. */
  orbit: 0.55,
};

/**
 * The ring.
 *
 * One instance for the whole world: the player faces one crowd, not one crowd
 * per species, and a budget split per type would let three types field three
 * full rings.
 */
export class SlotRing {
  /** @param {() => number} rand seeded; used only to scatter orbit phases */
  constructor(rand, cfg) {
    this.cfg = Object.assign({}, RING, cfg || {});
    this.rand = rand || (() => 0.5);
    /** Reused every frame — this runs at 60 Hz with a crowd in it. */
    this._cand = [];
    /** Committed weight last tick, for the HUD and for probes. */
    this.committed = 0;
    this.holders = 0;
  }

  /**
   * Decide who is committed this tick.
   *
   * Call ONCE per frame, before the per-agent step, with every live agent.
   * Writes `a.slot` (bool), and maintains `a.slotT`, `a.swingCD`, `a.ringPhase`
   * and `a.ringDir`. Reads `a.pos`, `a.state`, `a.type.def.reach` and
   * `a.type.def.slotCost`.
   *
   * @param {Iterable<object>} agents every live agent, any type
   * @param {number} px player x
   * @param {number} pz player z
   * @param {number} h  seconds since the last call
   * @param {number} deadState the state value meaning "dead", so this module
   *        needs no opinion about the state enum beyond skipping corpses
   */
  update(agents, px, pz, h, deadState) {
    const C = this.cfg;
    const cand = this._cand;
    cand.length = 0;

    for (const a of agents) {
      if (!a.alive || a.state === deadState) { a.slot = false; continue; }
      const def = a.type.def;
      const cost = def.slotCost == null ? 1 : def.slotCost;

      a.swingCD = Math.max(0, (a.swingCD || 0) - h);
      if (a.ringDir === undefined) {
        /* A fixed side and phase per agent, so a circler orbits consistently
           instead of jittering across the player's front every time it is
           re-evaluated. */
        a.ringDir = this.rand() < 0.5 ? -1 : 1;
        a.ringPhase = this.rand() * Math.PI * 2;
      }

      /* Cost zero means "never commits" — a keener holds a standoff an order
         of magnitude past its reach and would sit on a ticket forever. */
      if (cost <= 0) { a.slot = false; a.slotT = 0; continue; }

      const dx = a.pos.x - px, dz = a.pos.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > def.reach + C.band) {
        a.slot = false; a.slotT = 0;
        continue;
      }

      if (a.slot) a.slotT = (a.slotT || 0) + h;

      /*
       * Nearest first, incumbents protected, and anybody who just swung is
       * pushed to the back so a single agent cannot monopolise the ring by
       * standing closest.
       */
      let score = -d;
      if (cost > 1) score += (cost - 1) * C.heavy;
      if (a.slot) score += C.incumbency;
      if (a.slot && (a.slotT || 0) < C.minHold) score += 1000;   // unrevokable
      if (a.swingCD > 0) score -= 8 + a.swingCD * 2;
      cand.push({ a, score, cost });
    }

    cand.sort(cmpScore);

    let spent = 0, held = 0;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (spent + c.cost <= C.budget) {
        if (!c.a.slot) c.a.slotT = 0;
        c.a.slot = true;
        spent += c.cost;
        held++;
      } else {
        c.a.slot = false;
        c.a.slotT = 0;
      }
    }
    this.committed = spent;
    this.holders = held;
    return spent;
  }

  /**
   * Where an uncommitted agent should stand: on the ring, on its own side,
   * drifting round. Writes into `out` as {x, z}.
   *
   * The drift is deliberately slow. Fast orbiting reads as a carousel; at
   * half a radian a second it reads as a crowd looking for a way in.
   */
  circlePoint(a, px, pz, t, out) {
    const C = this.cfg;
    const ang = (a.ringPhase || 0) + t * C.orbit * (a.ringDir || 1);
    out.x = px + Math.cos(ang) * C.radius;
    out.z = pz + Math.sin(ang) * C.radius;
    return out;
  }

  /** Called when a committed agent lands a swing: yield, and sit out. */
  spend(a) {
    a.swingCD = this.cfg.cooldown;
    a.slot = false;
    a.slotT = 0;
  }
}

function cmpScore(x, y) { return y.score - x.score; }

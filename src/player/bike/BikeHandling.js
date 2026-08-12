/**
 * BROKEN ROAD — BIKE GEOMETRY AND HANDLING
 * ============================================================================
 * The machine as numbers: its dimensions, and the model that turns rider input
 * into a yaw rate and a lean angle.
 *
 * This module imports NOTHING. Not three.js, not the context, not a clock. It
 * is plain arithmetic over doubles, which buys two things:
 *
 *   it is testable in node in microseconds, so the conformance suite covers
 *   the handling the same way it covers the build grammar; and
 *
 *   it ports. Everything that makes this bike feel like a bike lives here, so
 *   a reimplementation in another language reimplements one file and diffs the
 *   numbers, rather than trying to infer the model out of a renderer.
 *
 * Bike.js owns the throttle, the fuel, the gearbox and every transform;
 * BikeBuild.js owns the mesh. Both read their dimensions from BIKE below, so
 * the thing you steer and the thing you see are the same machine by
 * construction.
 *
 * ----------------------------------------------------------------------------
 * THE MODEL, IN THREE LINES
 *
 *   yawRate = v · tan(steer) / wheelbase        where you go
 *   lean    = atan(v · yawRate / g)             how far over you are
 *   a_lat   = v · yawRate  ≤  LAT_GRIP · grip   whether the bike can do it
 *
 * The first is the bicycle model and it gives the whole character of a
 * single-track vehicle for free: you cannot turn at a standstill, and the same
 * bar input that flicks you round a tree at 5 m/s is a long lazy arc at 25.
 *
 * The second is the real balance condition, so the bike banks by exactly what
 * the corner demands. Faking lean off stick input is the usual shortcut and it
 * reads as wrong instantly, because the bike then leans hardest where it is
 * turning least.
 *
 * The third is the one that was missing. Without it the first two will happily
 * describe a bike pulling four g through a corner at 97 km/h while its lean
 * sits pinned against a visual clamp — turning four times harder than it is
 * leaning. See MAX_LEAN.
 * ============================================================================
 */

/** Geometry, in metres. A real mid-size road bike, measured. */
export const BIKE = {
  wheelbase: 1.515,
  rearAxle: -0.660,
  frontAxle: 0.855,
  wheelR: 0.335,          // tyre outer radius
  tyre: 0.072,            // section
  rimR: 0.215,
  /** Steering head: the point the fork rotates about, and the rake off vertical. */
  headY: 0.985,
  headZ: 0.660,
  rake: 0.475,            // 27.2 degrees
  /**
   * Yoke offset: how far the fork legs sit AHEAD of the steering axis. On a
   * real bike this is the one number a designer tunes after the rake is fixed,
   * because rake and offset together give trail — and trail, not rake, is what
   * the machine actually handles on. 48 mm is a standard-issue road figure.
   */
  forkOffset: 0.048,
  seatY: 0.815,
  seatZ: -0.115,
  barY: 1.075,
  barZ: 0.545,
  barHalf: 0.335,
  /** Suspension travel available to the fork, metres. */
  forkTravel: 0.135,
};

/**
 * TRAIL — how far behind the steering axis the front contact patch sits, in
 * metres. Falls straight out of the three numbers above:
 *
 *      trail = (R·sin θ − offset) / cos θ
 *
 * where θ is the rake off vertical. With this geometry it comes to 118 mm,
 * squarely in road-bike territory (a cruiser runs 100–130, a sports bike
 * 90–100, a chopper 200-plus and handles like a shopping trolley for it).
 *
 * It matters because trail is the entire self-centring mechanism of a
 * single-track vehicle. The contact patch is dragged behind the axis it pivots
 * about, exactly like a castor, so any steer angle generates a torque trying to
 * straighten it — one growing with the square of road speed. That is why a bike
 * tracks straight hands-off at 90 km/h and flops onto its lock in a car park.
 */
export const TRAIL = (BIKE.wheelR * Math.sin(BIKE.rake) - BIKE.forkOffset)
  / Math.cos(BIKE.rake);

/**
 * THE CORNERING LIMIT, stated once.
 *
 * What stops this machine is not the tyre — it is the footpeg. Any bike with
 * mid controls grounds its hardware around forty degrees, well before road
 * rubber runs out, and a stripped 650 twin on knobblies is not the exception.
 * So the limit is a LEAN ANGLE, and the lateral acceleration is that angle read
 * as a number rather than a second opinion about it:
 *
 *      a_lat = g · tan(lean)
 *
 * Deriving one from the other matters because they were previously two
 * independent constants that disagreed — a visual clamp at 0.62 rad and a
 * steering curve permitting about 4 g. Two numbers for one quantity is two
 * numbers to get wrong. Now the pegs touching down IS the limit, and seeing
 * them down means you are at it.
 */
export const MAX_LEAN = 0.70;                       // 40.1 degrees
export const LAT_GRIP = 9.81 * Math.tan(MAX_LEAN);  // 8.26 m/s², 0.84 g

/** Fork lock, radians. 40 degrees, and you will only ever see it parking. */
export const STEER_LOCK = 0.70;
/**
 * Steering dynamics. SPRING is the residual centring that is NOT trail —
 * friction in the head bearings and the rider's own arms — so the bars still
 * come back at a standstill. TRAIL_GAIN converts trail-per-wheelbase and v²
 * into spring rate; DAMP is the steering damper plus forearms.
 */
export const STEER_SPRING = 6.0, TRAIL_GAIN = 0.50, STEER_DAMP = 4.5;
/**
 * Below this, in m/s, you are dabbing your feet rather than steering. The
 * bicycle model cannot pivot a stationary bike and without an override parking
 * is impossible.
 */
export const DAB_SPEED = 1.4, DAB_RATE = 1.15;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The tightest steer angle the tyres can hold at this speed.
 *
 * A steady turn of radius R at speed v pulls v²/R sideways, and every newton of
 * it comes through two contact patches the size of a credit card. So the
 * tightest corner available is the one whose lateral acceleration the rubber
 * still has:
 *
 *      a_lat = v² · tan(steer) / wheelbase   ≤   LAT_GRIP · grip
 *
 * inverted here. Below about 3 m/s the answer exceeds the fork lock and the
 * lock takes over, which is the correct crossover — a bike at walking pace is
 * limited by its steering stops, not by grip.
 *
 * This is where `grip` reaches the corners, and it is the point of the whole
 * function. Rain, pumice and the tyre upgrade previously scaled only drive and
 * braking, so a surface could not be felt where a rider feels one first.
 *
 * @param {number} speed  m/s, signed
 * @param {number} grip   0..1.2 from the traction model
 * @returns {number} radians, positive
 */
export function maxSteerFor(speed, grip) {
  const av = Math.abs(speed);
  const holdable = Math.atan((LAT_GRIP * grip * BIKE.wheelbase) / Math.max(1.2, av * av));
  return Math.min(STEER_LOCK, holdable);
}

/**
 * Advance the steering by one fixed step.
 *
 * The steady-state angle says where the bars end up; TRAIL says how they get
 * there and what happens when you let go. Modelled as a spring whose stiffness
 * grows with v², the whole family of real behaviours falls out of one line:
 * heavy and self-centring at 25 m/s, light at 8, and at walking pace the trail
 * term is gone entirely and only the head-bearing friction remains.
 *
 * Rider torque is scaled by the same stiffness, so the steady state stays
 * steerWant · maxSteer: trail governs the transient, the tyre governs the
 * destination.
 *
 * @param {{steer:number, vel:number}} S  mutated in place
 * @param {number} steerWant  −1..1 rider input
 * @param {number} speed      m/s, signed
 * @param {number} grip       0..1.2
 * @param {number} h          fixed step, seconds
 * @returns {number} the new steer angle, radians
 */
export function steerStep(S, steerWant, speed, grip, h) {
  const av = Math.abs(speed);
  const maxSteer = maxSteerFor(speed, grip);
  const align = STEER_SPRING + (TRAIL / BIKE.wheelbase) * av * av * TRAIL_GAIN;
  /* Damping is capped relative to the step so an explicit integrator cannot be
     driven unstable by a long frame. */
  const damp = Math.min(0.92 / h, STEER_DAMP + av * 0.35);
  const rider = steerWant * maxSteer * align;
  S.vel += (rider - S.steer * align - S.vel * damp) * h;
  S.steer = clamp(S.steer + S.vel * h, -STEER_LOCK, STEER_LOCK);
  return S.steer;
}

/**
 * Yaw rate from the bicycle model, plus the low-speed dab.
 * @returns {number} rad/s
 */
export function yawRateFor(speed, steer, steerWant) {
  let y = (speed * Math.tan(steer)) / BIKE.wheelbase;
  const av = Math.abs(speed);
  if (av < DAB_SPEED) y += steerWant * DAB_RATE * (1 - av / DAB_SPEED);
  return y;
}

/** The balance condition. Clamped at MAX_LEAN as a backstop, never a limiter. */
export function leanFor(speed, yawRate) {
  return clamp(Math.atan2(Math.abs(speed) * yawRate, 9.81), -MAX_LEAN, MAX_LEAN);
}

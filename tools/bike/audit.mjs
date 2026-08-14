#!/usr/bin/env node
import {
  BIKE, TRAIL, MAX_LEAN, LAT_GRIP, STEER_LOCK, MASS,
  TOP_SPEED, DRIVE, DRIVE_FADE, BRAKE, ROLL, DRAG,
  maxSteerFor, steerStep, yawRateFor, leanFor,
} from '../../src/player/bike/BikeHandling.js';

/**
 * BROKEN ROAD — BIKE PHYSICS AUDIT
 * ============================================================================
 *   node tools/bike/audit.mjs          print the audit
 *   node tools/bike/audit.mjs --strict exit 1 if anything is out of range
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is NOT a comparison against remembered spec sheets. Quoting "the Bonneville
 * has 27 degrees of rake" from memory and calling the model validated is how you
 * end up confidently wrong, and a number I half-remember is worse than no
 * number because it looks like evidence.
 *
 * What it does instead is convert the model's arbitrary tuning constants into
 * PHYSICAL QUANTITIES that have known ranges, and check those:
 *
 *   DRAG and ROLL are dimensionless nuisances until you multiply by a mass and
 *   a speed, at which point they become ENGINE POWER IN KILOWATTS, and a
 *   650 twin makes a known amount of that.
 *
 *   BRAKE is a number until you divide by g, at which point it is a friction
 *   coefficient, and rubber on tarmac has a known one.
 *
 *   DRIVE is a number until you integrate it, at which point it is a
 *   0-100 km/h time, which is on the back of every road test ever printed.
 *
 * The second half checks the model against ITSELF: the bicycle model, the
 * balance condition and the grip limit are three statements about one corner,
 * and they have to agree to floating point. They did not, once — the lean
 * clamp and the cornering limit were independent constants that disagreed by a
 * factor of five, and no amount of riding it made that visible.
 * ============================================================================
 */

const G = 9.81;
const STRICT = process.argv.includes('--strict');
let fails = 0, warns = 0;

const fmt = (v, n = 2) => (typeof v === 'number' ? v.toFixed(n) : String(v));

/** A derived quantity, its plausible range, and why that range. */
function check(label, value, lo, hi, unit, why) {
  const ok = value >= lo && value <= hi;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${fmt(value).padStart(9)} ${unit.padEnd(7)}`
    + ` expected ${fmt(lo)}..${fmt(hi)}`);
  if (!ok) console.log(`       ${why}`);
  return ok;
}

/** An identity that must hold exactly, not approximately. */
function identity(label, a, b, tol = 1e-9) {
  const d = Math.abs(a - b);
  const ok = d <= tol;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${fmt(a, 6).padStart(9)} vs ${fmt(b, 6)}`
    + `   delta ${d.toExponential(2)}`);
  return ok;
}

console.log('BIKE PHYSICS AUDIT');
console.log('='.repeat(74));

/* ---------------------------------------------------------------- geometry */
console.log('\nGEOMETRY — derived from wheelbase, rake, offset and wheel radius');
const trailMM = TRAIL * 1000;
check('trail', trailMM, 80, 140, 'mm',
  'Under 80 mm is a race bike that tank-slaps; over 140 is a chopper. A road '
  + 'bike lives in between, and trail is what the machine handles on.');
check('wheelbase', BIKE.wheelbase * 1000, 1350, 1650, 'mm',
  'Shorter than 1350 is a minibike, longer than 1650 is a tourer or a trike.');
check('rake', (BIKE.rake * 180) / Math.PI, 22, 34, 'deg',
  'Steeper than 22 is unrideable on a road; slacker than 34 is a chopper.');
check('seat height', BIKE.seatY * 1000, 680, 900, 'mm',
  'Below 680 you cannot fit a rider under the bars; above 900 nobody can '
  + 'reach the ground at a stop.');
/*
 * RIM and OVERALL are different numbers and the first cut of this check
 * conflated them: it took the outer tyre radius, doubled it, and compared the
 * answer against the range for RIM sizes. The bike failed a test that was
 * wrong. A 17-inch rim carries an overall diameter around 25 inches, and both
 * have to be checked separately or the units go unpoliced.
 */
check('rim diameter', BIKE.rimR * 2 * 39.37, 15, 22, 'in',
  'Motorcycle rims are 16 to 21 inches. This is the unit check on the whole '
  + 'geometry table: confuse metres and inches anywhere and it shows here.');
check('overall wheel diameter', BIKE.wheelR * 2 * 39.37, 22, 29, 'in',
  'Rim plus two sidewalls. A road bike is 23-25; a dual-sport on a tall front '
  + 'runs to 27.');

/* -------------------------------------------------------------- longitudinal */
console.log('\nLONGITUDINAL — the tuning constants as physical quantities');
console.log(`  (nominal all-up mass ${MASS} kg: a stripped 650 twin plus a rider and a full tank)`);

/* Top speed the model actually settles at: drive = resistance. */
let vTop = 0;
for (let v = 0; v < 120; v += 0.01) {
  const drive = DRIVE * Math.max(0, 1 - v / DRIVE_FADE);
  const resist = ROLL + DRAG * v * v;
  if (drive <= resist) { vTop = v; break; }
}
check('drag-limited top speed', vTop * 3.6, 90, 190, 'km/h',
  'Where thrust and resistance actually balance, ignoring the gearing clamp. '
  + 'This has to sit ABOVE the gearing limit or the clamp is decorative and '
  + 'the bike is really a slower machine than it claims — which it was, by a '
  + 'third, until this check was written.');
check('gearing limit', TOP_SPEED * 3.6, 80, 190, 'km/h',
  'What the game clamps to. Must be the LOWER of the two, so the number in '
  + 'the design is the number the player gets.');
if (vTop < TOP_SPEED) {
  fails++;
  console.log('  FAIL the gearing clamp is never reached — drag binds first, so '
    + `the real top speed is ${fmt(vTop * 3.6)} km/h, not ${fmt(TOP_SPEED * 3.6)}`);
}

/* Power to hold top speed. This is the number that makes DRAG mean something. */
const powerTopKW = (MASS * (ROLL + DRAG * vTop * vTop) * vTop) / 1000;
check('power to hold top speed', powerTopKW, 5, 30, 'kW',
  'The whole point of this audit: DRAG is arbitrary until you multiply it out '
  + 'into watts. NOTE this is the power REQUIRED at top speed, not the power '
  + 'the engine makes — a 650 twin has far more than this and spends the '
  + 'surplus accelerating. The first version of this check compared against '
  + 'engine output and failed a correct model for it. Holding 100 km/h on a '
  + 'naked bike takes about 10 kW; needing 60 would mean the drag curve is '
  + 'wrong even if the top speed happens to look right.');

/* 0-100 km/h by integrating the model the game actually runs. */
let v = 0, t = 0;
const h = 1 / 240;
const TARGET_KPH = 80;
while (v < TARGET_KPH / 3.6 && t < 60) {
  const a = DRIVE * Math.max(0, 1 - v / DRIVE_FADE) - ROLL - DRAG * v * v;
  if (a <= 0) break;
  v += a * h; t += h;
}
check(`0-${TARGET_KPH} km/h`, t, 3.0, 9.0, 's',
  'Integrated from the same drive curve the game uses. Measured to 80 rather '
  + 'than 100 because this machine tops out near 100 and the last few km/h '
  + 'take forever on any bike — a 0-100 figure would be measuring the asymptote '
  + 'rather than the acceleration.');

/* Braking, as a friction coefficient. */
check('peak braking', BRAKE / G, 0.55, 1.05, 'g',
  'BRAKE divided by g is a tyre friction coefficient. Road rubber tops out '
  + 'around 1.0 and a two-wheeler cannot use all of it without going over the '
  + 'front, so anything above 1.05 is not braking, it is a wall.');
const stop100 = (100 / 3.6) ** 2 / (2 * BRAKE);
check('stop from 100 km/h', stop100, 30, 70, 'm',
  'Falls out of the braking figure. Published road-test stops from 100 km/h '
  + 'sit around 40 m; much under 30 is impossible on two wheels.');

/* ------------------------------------------------------------------ lateral */
console.log('\nLATERAL — the corner');
check('max lean', (MAX_LEAN * 180) / Math.PI, 30, 50, 'deg',
  'Ground clearance stops a road bike with mid controls around 40 degrees, '
  + 'well before the tyre runs out.');
check('max lateral', LAT_GRIP / G, 0.5, 1.15, 'g',
  'The lean angle read as an acceleration. Above 1.15 g the tyre is doing '
  + 'something rubber does not do.');

/* The three statements about one corner, which must agree exactly. */
console.log('\n  the bicycle model, the balance condition and the grip limit');
console.log('  are three descriptions of the same corner and must agree exactly:');
for (const speed of [8, 15, 22, 27]) {
  const S = { steer: 0, vel: 0 };
  for (let k = 0; k < 600; k++) steerStep(S, 1, speed, 1, 1 / 60);
  const yawRate = yawRateFor(speed, S.steer, 1);
  const aLat = speed * yawRate;
  const radius = BIKE.wheelbase / Math.tan(S.steer);
  identity(`v=${speed} a_lat vs v^2/R`, aLat, (speed * speed) / radius, 1e-6);
  identity(`v=${speed} lean vs atan(a/g)`, leanFor(speed, yawRate), Math.atan(aLat / G), 1e-9);
  if (aLat > LAT_GRIP * 1.001) {
    fails++;
    console.log(`  FAIL v=${speed} pulls ${fmt(aLat)} m/s2, over the ${fmt(LAT_GRIP)} limit`);
  }
}

/* Self-centring must strengthen with speed — that is what trail IS. */
console.log('\n  trail must make the steering self-centre harder the faster you go:');
let prev = Infinity;
for (const speed of [3, 8, 15, 22, 27]) {
  const S = { steer: 0, vel: 0 };
  for (let k = 0; k < 600; k++) steerStep(S, 1, speed, 1, 1 / 60);
  const start = Math.abs(S.steer);
  let half = Infinity;
  for (let k = 0; k < 900; k++) {
    steerStep(S, 0, speed, 1, 1 / 60);
    if (Math.abs(S.steer) <= start * 0.5) { half = k / 60; break; }
  }
  const ok = half <= prev + 1e-9;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} v=${String(speed).padStart(2)} m/s   `
    + `half-life ${fmt(half, 3)} s`);
  prev = half;
}

/* Steering must be lock-limited at walking pace and grip-limited at speed. */
console.log('\n  the limit must hand over from the fork lock to the tyre:');
const lowLimited = maxSteerFor(2, 1) >= STEER_LOCK - 1e-9;
const highLimited = maxSteerFor(25, 1) < STEER_LOCK * 0.2;
if (!lowLimited || !highLimited) fails++;
console.log(`  ${lowLimited ? 'ok  ' : 'FAIL'} at 2 m/s the FORK LOCK binds`
  + `   (${fmt(maxSteerFor(2, 1), 3)} rad vs lock ${fmt(STEER_LOCK, 3)})`);
console.log(`  ${highLimited ? 'ok  ' : 'FAIL'} at 25 m/s the TYRE binds`
  + `      (${fmt(maxSteerFor(25, 1), 4)} rad)`);

/* Grip must reach the corner, or the surface model is decorative. */
const dry = maxSteerFor(15, 1), wet = maxSteerFor(15, 0.35);
const bites = wet < dry * 0.45;
if (!bites) fails++;
console.log(`  ${bites ? 'ok  ' : 'FAIL'} losing grip costs the corner`
  + `    (wet corners at ${fmt((wet / dry) * 100, 0)}% of dry)`);

console.log('\n' + '='.repeat(74));
console.log(fails ? `${fails} CHECK(S) FAILED` : 'all checks passed');
if (warns) console.log(`${warns} warning(s)`);
process.exit(STRICT && fails ? 1 : 0);

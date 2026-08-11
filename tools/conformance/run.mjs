#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBES, SEED, SIG, VERSION } from './probes.mjs';

/**
 * BROKEN ROAD — CONFORMANCE RUNNER
 * ============================================================================
 *   node tools/conformance/run.mjs            check against the golden file
 *   node tools/conformance/run.mjs --write    accept current output as golden
 *   node tools/conformance/run.mjs --list     what is covered, and why
 *
 * Exit code 0 if everything matches, 1 if anything drifted. See probes.mjs for
 * what a probe is and why the precision is what it is.
 *
 * The `--write` flag is deliberately explicit and deliberately verbose about
 * what changed. A golden file that is easy to overwrite without reading is a
 * golden file that records whatever the bug did.
 * ============================================================================
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden.json');

/** Round to `sig` significant figures; see the PRECISION note in probes.mjs. */
function sigRound(v, sig) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (v === 0) return 0;
  const m = 10 ** (sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * m) / m;
}

function normalise(v) {
  if (typeof v === 'number') return sigRound(v, SIG);
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    /* Sorted keys, so a golden diff is never noise from property order. */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalise(v[k]);
    return out;
  }
  return v;
}

function collect() {
  const probes = {};
  for (const p of PROBES) {
    try {
      probes[p.id] = normalise(p.run());
    } catch (e) {
      probes[p.id] = { __error: String(e && e.message ? e.message : e) };
    }
  }
  return { version: VERSION, seed: SEED, sig: SIG, probes };
}

/** Every leaf path where two trees differ, as `path: a -> b` strings. */
function diff(a, b, at = '', out = []) {
  if (out.length > 200) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push(`${at}: ${ta} -> ${tb}`); return out; }
  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${at}.length: ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${at}.${k}: MISSING -> ${JSON.stringify(b[k])}`); continue; }
      if (!(k in b)) { out.push(`${at}.${k}: ${JSON.stringify(a[k])} -> MISSING`); continue; }
      diff(a[k], b[k], `${at}.${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return out;
}

/* ------------------------------------------------------------------- main */

const arg = process.argv[2] || '';

if (arg === '--list') {
  console.log(`conformance v${VERSION}, seed ${SEED}, ${SIG} significant figures\n`);
  for (const p of PROBES) {
    console.log('  ' + p.id);
    console.log('      ' + (p.why || '').replace(/\s+/g, ' ').trim());
  }
  process.exit(0);
}

const now = collect();

const failed = Object.entries(now.probes).filter(([, v]) => v && v.__error);
if (failed.length) {
  console.error('PROBES THREW:');
  for (const [id, v] of failed) console.error('  ' + id + ': ' + v.__error);
  process.exit(1);
}

if (arg === '--write') {
  let previous = null;
  try { previous = JSON.parse(readFileSync(GOLDEN, 'utf8')); } catch { /* first run */ }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  if (previous) {
    const d = diff(previous.probes, now.probes);
    console.log(d.length
      ? `golden updated — ${d.length} value(s) changed:\n  ` + d.slice(0, 40).join('\n  ')
      : 'golden updated — no values changed');
  } else {
    console.log(`golden written: ${PROBES.length} probes`);
  }
  process.exit(0);
}

let golden;
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
} catch {
  console.error('No golden file. Run:  node tools/conformance/run.mjs --write');
  process.exit(1);
}

if (golden.version !== VERSION) {
  console.error(`golden is version ${golden.version}, probes are version ${VERSION}.`);
  console.error('A probe changed MEANING — re-read it, then --write deliberately.');
  process.exit(1);
}

const d = diff(golden.probes, now.probes);
if (!d.length) {
  console.log(`conformance OK — ${PROBES.length} probes, seed ${SEED}`);
  process.exit(0);
}
console.error(`CONFORMANCE FAILED — ${d.length} value(s) drifted:\n`);
for (const line of d.slice(0, 60)) console.error('  ' + line);
if (d.length > 60) console.error(`  ... and ${d.length - 60} more`);
console.error('\nIf the change is intended:  node tools/conformance/run.mjs --write');
process.exit(1);

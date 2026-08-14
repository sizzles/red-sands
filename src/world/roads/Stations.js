import * as THREE from 'three';

/**
 * BROKEN ROAD — FUEL STATIONS
 * ============================================================================
 * The one place on the map that reliably has what you need, sited where roads
 * actually put them: on the highway, at intervals, on the flattest ground
 * within reach of the carriageway.
 *
 * WHY THEY ARE FINITE
 * A pump that refills forever turns the fuel economy into a formality — you
 * would learn one station and never leave its orbit. Each station holds a fixed
 * number of tanks and does not recover, so the map is a slowly emptying
 * resource and the ride keeps having to go further. There are enough of them,
 * and enough jerry cans in the world besides, that this can never strand you
 * permanently; what it can do is make the third hour a longer ride than the
 * first, which is the whole arc the game wants.
 *
 * WHAT THEY LOOK LIKE
 * A canopy on four posts, two pump islands under it, a kiosk, and a pole sign
 * high enough to be the thing you see first. That last part is the actual
 * design requirement: from the saddle at 90 km/h in the rain, the sign is the
 * only part of the station the player will ever spot in time to stop, so it is
 * built tall and given the only saturated colour in the world.
 * ============================================================================
 */

/** How many tank-fills a station holds when the world is generated. */
export const STATION_TANKS = 3;
/** How close you have to be to the pumps to use them. */
export const PUMP_RANGE = 5.2;

const _v = new THREE.Vector3();

/* -------------------------------------------------------------- primitives */

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function post(x, z, h, r = 0.09) {
  const g = new THREE.CylinderGeometry(r, r * 1.12, h, 8);
  g.translate(x, h * 0.5, z);
  return g;
}

/**
 * Build one station's geometry, in station-local space with the origin on the
 * ground at the centre of the forecourt and +Z along the road.
 *
 * @returns {{ structure: THREE.BufferGeometry, sign: THREE.BufferGeometry,
 *             pumps: Array<THREE.Vector3> }}
 */
export function buildStation(rand) {
  const S = [];        // concrete, steel, kiosk — one material
  const F = [];        // the sign face, which gets the emissive material

  /* --- forecourt slab. Slightly proud of the ground so the station reads as
     made rather than as props standing in a field. */
  S.push(box(13.0, 0.16, 9.4, 0, 0.08, 0));

  /* --- canopy: four posts and a deck 4.4 m up ------------------------- */
  const CH = 4.4;
  for (const [px, pz] of [[-4.6, -3.0], [4.6, -3.0], [-4.6, 3.0], [4.6, 3.0]]) {
    S.push(post(px, pz, CH, 0.13));
  }
  S.push(box(11.6, 0.42, 8.2, 0, CH + 0.21, 0));
  /* fascia band, deeper at the front — the bit that catches a headlight */
  S.push(box(11.9, 0.62, 0.18, 0, CH + 0.10, 4.20));
  S.push(box(11.9, 0.62, 0.18, 0, CH + 0.10, -4.20));

  /* --- two pump islands ------------------------------------------------ */
  const pumps = [];
  for (const ix of [-2.5, 2.5]) {
    S.push(box(1.5, 0.22, 4.2, ix, 0.27, 0));                 // island kerb
    for (const iz of [-1.1, 1.1]) {
      S.push(box(0.52, 1.32, 0.44, ix, 1.04, iz));            // pump body
      S.push(box(0.44, 0.30, 0.08, ix, 1.52, iz + 0.24));     // display head
      /* hose loop, as a squashed torus on its side */
      const hose = new THREE.TorusGeometry(0.20, 0.032, 5, 10, Math.PI);
      hose.rotateY(Math.PI / 2);
      hose.translate(ix + 0.30, 1.20, iz);
      S.push(hose);
      pumps.push(new THREE.Vector3(ix, 0, iz));
    }
  }

  /* --- kiosk, off the back of the forecourt ---------------------------- */
  const kw = 5.6 + rand() * 1.2;
  S.push(box(kw, 3.0, 4.2, -1.2, 1.5, -7.4));
  S.push(box(kw + 0.5, 0.22, 4.6, -1.2, 3.10, -7.4));         // parapet
  S.push(box(1.05, 2.10, 0.10, -3.0, 1.05, -5.26));           // door

  /* --- the pole sign ---------------------------------------------------
   * 8.5 m to the top. This is the only object at a station that matters at
   * range, so it is the tallest thing on the site by a factor of two and it is
   * placed at the road edge rather than at the building. */
  const PX = 6.4, PZ = 3.6;
  S.push(post(PX, PZ, 8.5, 0.16));
  S.push(box(0.24, 2.0, 2.9, PX, 7.3, PZ));                    // sign box
  F.push(box(0.06, 1.7, 2.5, PX + 0.16, 7.3, PZ));             // face, both sides
  F.push(box(0.06, 1.7, 2.5, PX - 0.16, 7.3, PZ));

  return {
    structure: mergeAll(S),
    sign: mergeAll(F),
    pumps,
  };
}

/** Minimal merge — avoids pulling BufferGeometryUtils in for a pile of boxes. */
function mergeAll(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------ siting */

/**
 * Choose where the stations go.
 *
 * Walks the highway routes at a fixed interval and, at each one, searches a
 * short arc off both shoulders for ground flat enough to pour a forecourt on.
 * A station on a 15° slope reads as a mistake immediately, so a candidate that
 * cannot find level ground is skipped entirely rather than placed badly — it is
 * better to have a longer gap between stations than an obviously wrong one.
 *
 * @returns {Array<{pos:THREE.Vector3, yaw:number, tanks:number, route:number}>}
 */
export function siteStations(routes, world, rand, { interval = 1150, maxCount = 14 } = {}) {
  const out = [];
  for (let r = 0; r < routes.length && out.length < maxCount; r++) {
    const pts = routes[r];
    /* Highways only. A fuel station down a logging spur is a station nobody
       will ever find, and the spurs are where you are supposed to run out. */
    if (!pts.cls || pts.cls.name !== 'highway') continue;

    /* Route points are resampled to 3.5 m, so the stride is the interval in
       points. Offset the first one so the two halves of the state route do not
       both put a station on the town's doorstep. */
    const stride = Math.max(8, Math.round(interval / 3.5));
    for (let i = Math.round(stride * (0.45 + rand() * 0.3)); i < pts.length - 6; i += stride) {
      if (out.length >= maxCount) break;
      const p = pts[i];
      const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const sx = -tz, sz = tx;              // road normal

      let best = null;
      for (let k = 0; k < 8; k++) {
        const side = k < 4 ? 1 : -1;
        const off = 11 + (k % 4) * 3.5;     // clear of the carriageway
        const cx = p.x + sx * side * off;
        const cz = p.z + sz * side * off;
        if (world.isWater(cx, cz)) continue;
        const y0 = world.getHeight(cx, cz);
        /* Roughness over the actual footprint, not a point sample: the
           forecourt is 13 × 9 m and it is the corners that give it away. */
        let rough = 0;
        for (let c = 0; c < 8; c++) {
          const ang = (c / 8) * Math.PI * 2;
          rough += Math.abs(world.getHeight(cx + Math.cos(ang) * 6.5,
            cz + Math.sin(ang) * 6.5) - y0);
        }
        const score = -rough;
        if (!best || score > best.score) best = { x: cx, z: cz, y: y0, score, side };
      }
      /* Reject anything worse than about 1 m of mean deviation across the pad. */
      if (!best || best.score < -8.0) continue;

      out.push({
        pos: new THREE.Vector3(best.x, best.y, best.z),
        /* Face the forecourt at the road: +Z local is along the road, so the
           yaw is the road tangent's bearing. */
        yaw: Math.atan2(tx, tz) + (best.side > 0 ? 0 : Math.PI),
        tanks: STATION_TANKS,
        route: r,
      });
    }
  }
  return out;
}

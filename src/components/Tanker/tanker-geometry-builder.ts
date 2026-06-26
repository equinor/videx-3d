import * as THREE from 'three';

interface TankerHullParams {
  length: number; // meters
  width: number; // meters (beam)
  height: number; // meters (draft + freeboard)
  waterline: number; // meters below keel
  lengthSegments: number; // 6 = very low poly, 12 = medium poly, 24 = high poly
  profileSegments: number; // 4 = very low poly, 8 = medium poly, 16 = high poly
  bowLength: number; // fraction of ship length occupied by the bow (0.1-0.4)
  bowRoundness: number; // 0 = sharp stem, 1 = full/rounded bow at deck level
}

const DEFAULTS: TankerHullParams = {
  length: 253,
  width: 44.2,
  height: 20,
  waterline: 13,
  lengthSegments: 6,
  profileSegments: 4,
  bowLength: 0.2,
  bowRoundness: 0.6,
};

// Smooth interpolation helper (smoothstep between edge0 and edge1).
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Creates a THREE.BufferGeometry for an oil tanker hull
 * Uses a loft/sweep approach: sweep a cross-section profile along the ship's length
 * and adding bow and stern sections to close the hull.
 *
 * Coordinate frame: origin at the waterline, midship. Bow faces +X, vertical is +Y,
 * starboard is +Z. Keel sits at y = -waterline, deck at y = height - waterline.
 */
export function createTankerHull(
  params?: Partial<TankerHullParams>,
): THREE.BufferGeometry {
  const {
    length,
    width,
    height,
    waterline,
    lengthSegments,
    profileSegments,
    bowLength,
    bowRoundness,
  } = {
    ...DEFAULTS,
    ...params,
  };

  const halfBeam = width / 2;
  const deckY = height - waterline; // freeboard above waterline
  const keelY = -waterline; // bottom of the hull

  // Boxiness of the cross-section (higher = more rectangular with a tight bilge).
  const sectionExponent = 4;
  const invN = 2 / sectionExponent;

  // --- Bow tuning -----------------------------------------------------------
  const bowStart = 1 - bowLength; // fraction of length where the bow begins
  const stemRake = length * 0.04; // forward lean of the stem at deck level
  const sheer = deckY * 0.18; // deck rise toward bow & stern
  // --- Bulbous bow (separate rounded bulb at the forefoot) ------------------
  const bulbRadius = halfBeam * 0.18; // bulb radius
  const bulbProtrude = bulbRadius * 1.4; // how far the rounded nose pokes past the stem
  const bulbBodyLength = bulbRadius * 3.2; // body length buried back into the bow
  // --- Stern tuning ---------------------------------------------------------
  const sternStart = 0.28; // fraction from the stern where the run begins
  const transomWidth = 0.6; // beam fraction at the transom
  const sternRise = waterline * 0.55; // how much the keel lifts aft (cutaway)
  // -------------------------------------------------------------------------

  const stationCount = Math.max(2, Math.floor(lengthSegments) + 1);
  const halfProfile = Math.max(2, Math.floor(profileSegments));
  const ringCount = 2 * halfProfile + 1; // starboard deck edge -> keel -> port deck edge

  const positions: number[] = [];
  const uvs: number[] = [];

  // Build a grid of ring vertices, one ring per longitudinal station.
  for (let s = 0; s < stationCount; s++) {
    // Cluster stations toward the bow and stern (where the shaping happens)
    // using a cosine distribution, so the low-poly budget isn't wasted on the
    // straight parallel midbody.
    const even = s / (stationCount - 1);
    const t = 0.5 - 0.5 * Math.cos(even * Math.PI); // 0 = stern, 1 = bow
    const x = -length / 2 + t * length;

    // Longitudinal width scaling: full beam through the parallel midbody,
    // a fine elliptical entry at the bow and a tapering rounded run aft.
    let widthScale = 1;
    if (t < sternStart) {
      // Run: taper from full beam to a rounded transom.
      const a = smoothstep(0, sternStart, t); // 0 transom -> 1 midbody
      widthScale = transomWidth + (1 - transomWidth) * Math.sqrt(a);
    }

    // Bow convergence factor: 0 outside the bow, 1 at the very stem.
    const b = t > bowStart ? smoothstep(bowStart, 1, t) : 0;

    // Keel line: lift the run aft (cutaway). The bow keeps a near-level keel so
    // the bulb stays below the waterline.
    let stationKeelY = keelY;
    if (t < sternStart) {
      stationKeelY = keelY + (1 - smoothstep(0, sternStart, t)) * sternRise;
    }

    // Deck sheer: raise the deck line gently toward both ends.
    const sheerFrac = Math.pow(Math.abs(t - 0.5) * 2, 2); // 0 midship -> 1 ends
    const stationDeckY = deckY + sheerFrac * sheer;

    const stationHalfBeam = halfBeam * widthScale;

    // Bow shaping factor (0 outside the bow, 1 at the very stem).
    const bow = b;

    for (let r = 0; r < ringCount; r++) {
      // Map ring index to a quarter-section angle, mirrored across the keel.
      const side = r <= halfProfile ? 1 : -1;
      const local =
        r <= halfProfile
          ? r / halfProfile
          : (2 * halfProfile - r) / halfProfile;
      const phi = local * (Math.PI / 2); // 0 = deck edge, PI/2 = keel centerline

      // Bow plan convergence with flare. In plan view the bow converges to a
      // single vertical stem line at ALL heights (deck included), so it
      // self-closes cleanly with no cap and no overhanging deck flap. Flare is
      // created by converging the upper rings later than the lower ones, giving
      // fuller V-sections toward the bow.
      //  - bowRoundness 0 -> sharp pointy stem, little flare
      //  - bowRoundness 1 -> full, rounded, strongly flared bow
      let bowWidth = 1;
      if (b > 0) {
        const heightFrac = 1 - local; // 0 = keel, 1 = deck edge
        const n = 1 + (1.5 + 4 * bowRoundness) * heightFrac;
        bowWidth = Math.pow(Math.max(0, 1 - Math.pow(b, n)), 1 / n);
      }

      const z =
        side * stationHalfBeam * bowWidth * Math.pow(Math.cos(phi), invN);
      const y =
        stationDeckY -
        (stationDeckY - stationKeelY) * Math.pow(Math.sin(phi), invN);

      // Bow longitudinal shaping: a raked stem - the deck edge leans forward in
      // a continuous sweep, more than the waterline (the bulb is separate).
      let xBow = 0;
      if (bow > 0) {
        const aboveFrac = Math.max(0, y) / Math.max(deckY, 1e-3); // 0 waterline -> 1 deck
        xBow = aboveFrac * stemRake * bow;
      }

      positions.push(x + xBow, y, z);
      uvs.push(t, r / (ringCount - 1));
    }
  }

  // --- Build faces ----------------------------------------------------------
  // The rings form an open-topped "U" (starboard deck edge -> keel -> port deck
  // edge). Three surfaces close it into a watertight, correctly-shaded hull:
  //   1. hull skin  - connect consecutive rings (no top wrap)
  //   2. end caps   - close the U + deck chord at bow and stern
  //   3. deck       - a separate flat slab on top (own vertices -> sharp edge)
  //
  // Triangles are sorted into four material groups so the hull can be colored
  // by region: lower hull (anti-foul), a thin boot-top stripe at the waterline,
  // the upper hull, and the top deck. The boot-top band is a horizontal slice
  // of the SAME hull surface (different material) - no coplanar overlap, so no
  // z-fighting.
  const lowerIdx: number[] = []; // group 0 - below the waterline
  const stripeIdx: number[] = []; // group 1 - boot-top stripe
  const upperIdx: number[] = []; // group 2 - above the stripe
  const deckIdx: number[] = []; // group 3 - top deck slab

  // Boot-top stripe band (meters, relative to the waterline at y = 0).
  const stripeBottom = -0.6;
  const stripeTop = 0.4;

  // Each hull triangle is CUT against the two horizontal boot-top planes so the
  // color boundaries are perfectly straight (constant world Y) all along the
  // hull, including the sheered/cut-away ends. Crossing vertices are cached per
  // edge so the cut introduces no shading seam (welded boundary).
  const crossCache = new Map<string, number>();
  const crossVertex = (i: number, j: number, h: number): number => {
    const key = i < j ? `${i}_${j}_${h}` : `${j}_${i}_${h}`;
    const cached = crossCache.get(key);
    if (cached !== undefined) return cached;
    const yi = positions[i * 3 + 1];
    const yj = positions[j * 3 + 1];
    const t = (h - yi) / (yj - yi);
    const idx = positions.length / 3;
    positions.push(
      positions[i * 3] + (positions[j * 3] - positions[i * 3]) * t,
      h,
      positions[i * 3 + 2] + (positions[j * 3 + 2] - positions[i * 3 + 2]) * t,
    );
    uvs.push(
      uvs[i * 2] + (uvs[j * 2] - uvs[i * 2]) * t,
      uvs[i * 2 + 1] + (uvs[j * 2 + 1] - uvs[i * 2 + 1]) * t,
    );
    crossCache.set(key, idx);
    return idx;
  };

  // Sutherland-Hodgman clip of a vertex-index polygon by a horizontal plane,
  // keeping the side at/above (keepAbove) or at/below the plane height h.
  const clip = (poly: number[], h: number, keepAbove: boolean): number[] => {
    if (poly.length === 0) return poly;
    const out: number[] = [];
    for (let k = 0; k < poly.length; k++) {
      const cur = poly[k];
      const nxt = poly[(k + 1) % poly.length];
      const yCur = positions[cur * 3 + 1];
      const yNxt = positions[nxt * 3 + 1];
      const curIn = keepAbove ? yCur >= h : yCur <= h;
      const nxtIn = keepAbove ? yNxt >= h : yNxt <= h;
      if (curIn) out.push(cur);
      if (curIn !== nxtIn) out.push(crossVertex(cur, nxt, h));
    }
    return out;
  };

  // Fan-triangulate a convex polygon (order preserved by clip -> winding kept).
  const emit = (poly: number[], bucket: number[]) => {
    for (let k = 1; k + 1 < poly.length; k++) {
      bucket.push(poly[0], poly[k], poly[k + 1]);
    }
  };

  // Cut one hull triangle into the three height bands and emit to each bucket.
  const pushHullTri = (a: number, b: number, c: number) => {
    const tri = [a, b, c];
    emit(clip(tri, stripeTop, true), upperIdx); // above the stripe
    const belowTop = clip(tri, stripeTop, false);
    emit(clip(belowTop, stripeBottom, true), stripeIdx); // boot-top band
    emit(clip(belowTop, stripeBottom, false), lowerIdx); // below the waterline
  };

  // 1. Hull skin: connect consecutive U-rings (do NOT wrap r across the top).
  for (let s = 0; s < stationCount - 1; s++) {
    const ringA = s * ringCount;
    const ringB = (s + 1) * ringCount;
    for (let r = 0; r < ringCount - 1; r++) {
      const a = ringA + r;
      const b = ringA + r + 1;
      const c = ringB + r;
      const d = ringB + r + 1;
      pushHullTri(a, d, c);
      pushHullTri(a, b, d);
    }
  }

  // 2. Stern cap only: the transom has real width, so close it with a fan. The
  // bow needs no cap - its plan width converges to a stem line and self-closes.
  // The cap DUPLICATES its end-ring vertices so its normals stay independent of
  // the hull skin (sharp crease, no smeared blend).
  const addCap = (station: number, forward: boolean) => {
    const ringStart = station * ringCount;
    const dupBase = positions.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let r = 0; r < ringCount; r++) {
      const px = positions[(ringStart + r) * 3];
      const py = positions[(ringStart + r) * 3 + 1];
      const pz = positions[(ringStart + r) * 3 + 2];
      positions.push(px, py, pz);
      uvs.push(forward ? 1 : 0, r / (ringCount - 1));
      cx += px;
      cy += py;
      cz += pz;
    }
    const centerIndex = positions.length / 3;
    positions.push(cx / ringCount, cy / ringCount, cz / ringCount);
    uvs.push(forward ? 1 : 0, 0.5);
    for (let r = 0; r < ringCount; r++) {
      const a = dupBase + r;
      const rNext = (r + 1) % ringCount; // wrap closes the deck chord
      const bNext = dupBase + rNext;
      if (forward) {
        pushHullTri(centerIndex, a, bNext);
      } else {
        pushHullTri(centerIndex, bNext, a);
      }
    }
  };
  addCap(0, false); // stern transom

  // 3. Deck: a separate flat slab, RECESSED below the hull's top edge so a
  // small bulwark lip runs around the deck perimeter. The hull skin rises to
  // the top edge (bulwark top); a thin inner wall drops from there to the
  // lowered deck, and the deck slab spans the lowered edges. All vertices are
  // duplicated so every crease stays sharp.
  //
  // The recessed edge is found by dropping ALONG the hull skin (interpolating
  // toward the next ring inboard), NOT straight down: the sides flare and the
  // bow rakes outward toward the top edge, so a straight drop would leave the
  // deck poking OUTSIDE the hull. A small extra inboard nudge keeps the deck
  // just inside the skin (visible lip, no coplanar z-fighting).
  const bulwarkHeight = Math.min(1.2, deckY * 0.12); // lip height / deck recess
  const bulwarkInset = bulwarkHeight * 0.35; // inboard nudge off the hull skin

  // Recessed deck-edge point for a station, following the hull skin inboard.
  const recessedEdge = (
    s: number,
    starboard: boolean,
  ): [number, number, number] => {
    const r0 = starboard ? 0 : ringCount - 1; // top deck edge
    const r1 = starboard ? 1 : ringCount - 2; // next ring inboard/down
    const i0 = (s * ringCount + r0) * 3;
    const i1 = (s * ringCount + r1) * 3;
    const x0 = positions[i0];
    const y0 = positions[i0 + 1];
    const z0 = positions[i0 + 2];
    const x1 = positions[i1];
    const y1 = positions[i1 + 1];
    const z1 = positions[i1 + 2];
    const drop = y0 - y1;
    const frac = drop > 1e-4 ? Math.min(1, bulwarkHeight / drop) : 0;
    let x = x0 + (x1 - x0) * frac;
    const y = y0 + (y1 - y0) * frac;
    let z = z0 + (z1 - z0) * frac;
    // Nudge inboard along the hull's local inward slope (XZ of r0 -> r1).
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    x += (dx / len) * bulwarkInset;
    z += (dz / len) * bulwarkInset;
    return [x, y, z];
  };

  const deckBase = positions.length / 3;
  for (let s = 0; s < stationCount; s++) {
    const sb = s * ringCount * 3; // starboard deck edge (r = 0)
    const pt = (s * ringCount + ringCount - 1) * 3; // port deck edge (last r)
    const sLow = recessedEdge(s, true);
    const pLow = recessedEdge(s, false);
    // Six vertices per station so EVERY crease is hard (no averaged normals):
    //   0,1 bulwark top   (shared by the wall only)
    //   2,3 wall bottom   (wall edge - vertical normal)
    //   4,5 deck edge     (deck slab edge - up normal), same position as 2,3
    // Bulwark-top duplicates (at the hull's top edge).
    positions.push(positions[sb], positions[sb + 1], positions[sb + 2]);
    positions.push(positions[pt], positions[pt + 1], positions[pt + 2]);
    // Recessed edge for the inner wall.
    positions.push(sLow[0], sLow[1], sLow[2]);
    positions.push(pLow[0], pLow[1], pLow[2]);
    // Recessed edge for the deck slab (duplicate -> sharp wall/deck corner).
    positions.push(sLow[0], sLow[1], sLow[2]);
    positions.push(pLow[0], pLow[1], pLow[2]);
    const u = s / (stationCount - 1);
    uvs.push(u, 0, u, 1, u, 0, u, 1, u, 0, u, 1);
  }
  for (let s = 0; s < stationCount - 1; s++) {
    const sbTopA = deckBase + s * 6;
    const ptTopA = sbTopA + 1;
    const sbWallA = sbTopA + 2;
    const ptWallA = sbTopA + 3;
    const sbDeckA = sbTopA + 4;
    const ptDeckA = sbTopA + 5;
    const sbTopB = deckBase + (s + 1) * 6;
    const ptTopB = sbTopB + 1;
    const sbWallB = sbTopB + 2;
    const ptWallB = sbTopB + 3;
    const sbDeckB = sbTopB + 4;
    const ptDeckB = sbTopB + 5;
    // Starboard inner bulwark wall (faces inboard, -z).
    deckIdx.push(sbTopA, sbTopB, sbWallA);
    deckIdx.push(sbTopB, sbWallB, sbWallA);
    // Port inner bulwark wall (faces inboard, +z).
    deckIdx.push(ptTopA, ptWallA, ptTopB);
    deckIdx.push(ptTopB, ptWallA, ptWallB);
    // Deck slab across the lowered edges (faces up, +Y).
    deckIdx.push(sbDeckA, sbDeckB, ptDeckA);
    deckIdx.push(ptDeckA, sbDeckB, ptDeckB);
  }

  // --- Bulbous bow: a separate rounded bulb at the forefoot ----------------
  // A compact, blunt bulb protruding forward from the stem, resting on the keel
  // line. Its resolution follows the hull's segment settings and its tail is
  // buried back inside the bow (hidden). Built as its own surface so its smooth
  // normals don't bleed into the hull shading.
  {
    const stemX = length / 2; // x of the bowmost station
    const noseX = stemX + bulbProtrude; // rounded nose pokes forward of the stem
    const noseCapLen = bulbRadius; // length of the hemispherical nose cap
    const bodyFrontX = noseX - noseCapLen; // where the nose cap meets the body
    const tailX = stemX - bulbBodyLength; // tail buried back inside the hull

    // Match the hull's tessellation so the bulb scales with the poly budget.
    const rings = Math.max(6, Math.floor(lengthSegments) * 2);
    const segs = Math.max(6, 2 * halfProfile);
    const noseFrac = 0.4; // front fraction of the rings forming the rounded cap

    const base = positions.length / 3;
    for (let i = 0; i <= rings; i++) {
      const f = i / rings; // 0 = buried tail, 1 = nose tip
      let ex: number;
      let rad: number;
      if (f >= 1 - noseFrac) {
        // Rounded nose cap: a smooth hemisphere so the tip stays blunt.
        const q = (f - (1 - noseFrac)) / noseFrac; // 0 = cap base, 1 = tip
        const ang = (q * Math.PI) / 2;
        ex = bodyFrontX + noseCapLen * Math.sin(ang);
        rad = bulbRadius * Math.cos(ang);
      } else {
        // Body: a straight, constant-radius cylinder running back into the hull.
        const q = f / (1 - noseFrac); // 0 = tail, 1 = cap base
        ex = tailX + (bodyFrontX - tailX) * q;
        rad = bulbRadius;
      }
      // Center each ring so its bottom always sits on the keel line: the bulb's
      // underside runs straight out along the keel from tail to nose, with the
      // rounding happening on the top and sides.
      const cy = keelY + rad;
      for (let j = 0; j <= segs; j++) {
        const u = (j / segs) * Math.PI * 2;
        const py = cy + rad * Math.cos(u);
        const pz = rad * Math.sin(u);
        positions.push(ex, py, pz);
        uvs.push(j / segs, f);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * (segs + 1) + j;
        const b2 = a + 1;
        const c = a + (segs + 1);
        const d = c + 1;
        // The bulb sits below the waterline -> lower-hull (anti-foul) group.
        lowerIdx.push(a, b2, c);
        lowerIdx.push(b2, d, c);
      }
    }
  }

  // Concatenate the buckets and register one material group per region. The
  // material array on the mesh maps: 0 = lower hull, 1 = boot-top stripe,
  // 2 = upper hull, 3 = top deck.
  const indices = [...lowerIdx, ...stripeIdx, ...upperIdx, ...deckIdx];

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  let groupStart = 0;
  geometry.addGroup(groupStart, lowerIdx.length, 0);
  groupStart += lowerIdx.length;
  geometry.addGroup(groupStart, stripeIdx.length, 1);
  groupStart += stripeIdx.length;
  geometry.addGroup(groupStart, upperIdx.length, 2);
  groupStart += upperIdx.length;
  geometry.addGroup(groupStart, deckIdx.length, 3);

  return geometry;
}

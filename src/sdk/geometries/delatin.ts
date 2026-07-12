const nullHeight = -1000;
/**
 * Modified version of Mapbox Delatin library: https://github.com/mapbox/delatin
 * Copyright (c) 2019, Michael Fogleman, Vladimir Agafonkin
 */
export class Delatin {
  data: Float32Array;
  width: number;
  height: number;
  coords: number[] = []; // vertex coordinates (x, y)
  triangles: number[] = []; // mesh triangle indices
  nullValue: number;

  private _queue: number[] = [];
  private _queueIndices: number[] = [];
  private _errors: number[] = [];
  private _halfedges: number[] = [];
  private _candidates: number[] = [];
  private _invalidPoints: Set<number>;

  private _rms: number[] = [];
  private _pending: number[] = [];
  private _pendingLen: number = 0;
  private _rmsSum: number = 0;

  // --- Constrained Delaunay (CDT) state ---
  // Once the greedy refinement is done (see run) we enter a "constraint phase":
  // every existing triangle then lives in the error queue and the pending list is
  // empty, so newly created triangles must NOT be pushed to the pending list (the
  // error machinery is inactive from here on).
  private _constraintPhase = false;
  // explicit heights for inserted (non-grid) points, keyed by vertex index
  private _explicitHeights = new Map<number, number>();
  // locked (constraint) edges, keyed by _edgeKey(a, b); never flipped by _legalize
  private _constrained = new Set<number>();
  // scratch: vertex a constraint segment passes through (set by
  // `_collectCrossingEdges`), so `constrainEdge` can split there instead of the
  // brute fallback.
  private _lastSplit = -1;

  constructor(data: Float32Array, width: number, nullValue = -1) {
    this.data = data;
    this.width = width;
    this.height = this.data.length / width;

    this.nullValue = nullValue;
    this._invalidPoints = new Set();

    const x1 = this.width - 1;
    const y1 = this.height - 1;
    const p0 = this._addPoint(0, 0);
    const p1 = this._addPoint(x1, 0);
    const p2 = this._addPoint(0, y1);
    const p3 = this._addPoint(x1, y1);

    // add initial two triangles
    const t0 = this._addTriangle(p3, p0, p2, -1, -1, -1);
    this._addTriangle(p0, p3, p1, t0, -1, -1);
    this._flush();
  }

  // refine the mesh until its maximum error gets below the given one
  run(maxError = 1) {
    while (this.getMaxError() > maxError) {
      this.refine();
    }
  }

  // Removes triangles where one or more vertices contains a null value (nullValue)
  removeInvalidTriangles() {
    const validTriangles: number[] = [];
    for (let i = 0; i < this.triangles.length; i += 3) {
      const ai = this.triangles[i];
      const bi = this.triangles[i + 1];
      const ci = this.triangles[i + 2];

      if (
        !this._invalidPoints.has(ai) &&
        !this._invalidPoints.has(bi) &&
        !this._invalidPoints.has(ci)
      ) {
        validTriangles.push(
          this.triangles[i],
          this.triangles[i + 1],
          this.triangles[i + 2],
        );
      }
    }

    // const faces = []
    // for (let i = 0; i < validTriangles.length; i +=3 ) {
    //   const index = validTriangles[i]
    //   const x = this.coords[index * 2]
    //   const y = this.coords[index * 2 + 1]

    //   const face = {
    //     indices: [index, validTriangles[i + 1], validTriangles[i + 2]],
    //     order: [x, y],
    //   }
    //   faces.push(face)
    // }

    // faces.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    // console.log(faces)
    // const sortedIndices: number[] = []
    // faces.forEach(face => {
    //   sortedIndices.push(...face.indices)
    // })
    // this.triangles = sortedIndices

    this.triangles = validTriangles;
  }

  // refine the mesh with a single point
  refine() {
    this._step();
    this._flush();
  }

  // max error of the current mesh
  getMaxError() {
    return this._errors[0];
  }

  // root-mean-square deviation of the current mesh
  getRMSD() {
    return this._rmsSum > 0
      ? Math.sqrt(this._rmsSum / (this.width * this.height))
      : 0;
  }

  // height value at a given position
  heightAt(x: number, y: number) {
    const h = this.data[this.width * y + x];
    return h === this.nullValue ? nullHeight : h;
  }

  // rasterize a triangle, find its max error, and queue it for processing
  private _findCandidate(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    t: number,
  ) {
    // triangle bounding box
    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);

    // forward differencing variables
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY);
    let w01 = orient(p2x, p2y, p0x, p0y, minX, minY);
    let w02 = orient(p0x, p0y, p1x, p1y, minX, minY);
    const a01 = p1y - p0y;
    const b01 = p0x - p1x;
    const a12 = p2y - p1y;
    const b12 = p1x - p2x;
    const a20 = p0y - p2y;
    const b20 = p2x - p0x;

    // pre-multiplied z values at vertices
    const a = orient(p0x, p0y, p1x, p1y, p2x, p2y);
    const z0 = this.heightAt(p0x, p0y) / a;
    const z1 = this.heightAt(p1x, p1y) / a;
    const z2 = this.heightAt(p2x, p2y) / a;

    // iterate over pixels in bounding box
    let maxError = 0;
    let mx = 0;
    let my = 0;
    let rms = 0;
    for (let y = minY; y <= maxY; y++) {
      // compute starting offset
      let dx = 0;
      if (w00 < 0 && a12 !== 0) {
        dx = Math.max(dx, Math.floor(-w00 / a12));
      }
      if (w01 < 0 && a20 !== 0) {
        dx = Math.max(dx, Math.floor(-w01 / a20));
      }
      if (w02 < 0 && a01 !== 0) {
        dx = Math.max(dx, Math.floor(-w02 / a01));
      }

      let w0 = w00 + a12 * dx;
      let w1 = w01 + a20 * dx;
      let w2 = w02 + a01 * dx;

      let wasInside = false;

      for (let x = minX + dx; x <= maxX; x++) {
        // check if inside triangle
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          wasInside = true;

          // Skip no-data pixels: their sentinel height (nullHeight) would create a
          // huge artificial error and force the greedy refinement to insert a vertex
          // at essentially every hole node — a massive, slow mesh on holey grids.
          // Holes are handled by the fill (positions) / constraint-cut phase instead,
          // so the refinement should follow only valid data.
          const raw = this.data[this.width * y + x];
          if (raw !== this.nullValue) {
            // compute z using barycentric coordinates
            const z = z0 * w0 + z1 * w1 + z2 * w2;
            const dz = Math.abs(z - raw);
            rms += dz * dz;
            if (dz > maxError) {
              maxError = dz;
              mx = x;
              my = y;
            }
          }
        } else if (wasInside) {
          break;
        }

        w0 += a12;
        w1 += a20;
        w2 += a01;
      }

      w00 += b12;
      w01 += b20;
      w02 += b01;
    }

    if (
      (mx === p0x && my === p0y) ||
      (mx === p1x && my === p1y) ||
      (mx === p2x && my === p2y)
    ) {
      maxError = 0;
    }

    // update triangle metadata
    this._candidates[2 * t] = mx;
    this._candidates[2 * t + 1] = my;
    this._rms[t] = rms;

    // add triangle to priority queue
    this._queuePush(t, maxError, rms);
  }

  // process the next triangle in the queue, splitting it with a new point
  private _step() {
    // pop triangle with highest error from priority queue
    const t = this._queuePop();

    const px = this._candidates[2 * t];
    const py = this._candidates[2 * t + 1];

    const pn = this._addPoint(px, py);

    this._splitAt(pn, t);
  }

  // split triangle `t` at the already-added point `pn`, which must lie inside `t`
  // or on one of its edges. Reused by the greedy step and by point insertion.
  private _splitAt(pn: number, t: number) {
    const e0 = t * 3 + 0;
    const e1 = t * 3 + 1;
    const e2 = t * 3 + 2;

    const p0 = this.triangles[e0];
    const p1 = this.triangles[e1];
    const p2 = this.triangles[e2];

    const ax = this.coords[2 * p0];
    const ay = this.coords[2 * p0 + 1];
    const bx = this.coords[2 * p1];
    const by = this.coords[2 * p1 + 1];
    const cx = this.coords[2 * p2];
    const cy = this.coords[2 * p2 + 1];
    const px = this.coords[2 * pn];
    const py = this.coords[2 * pn + 1];

    if (orient(ax, ay, bx, by, px, py) === 0) {
      this._handleCollinear(pn, e0);
    } else if (orient(bx, by, cx, cy, px, py) === 0) {
      this._handleCollinear(pn, e1);
    } else if (orient(cx, cy, ax, ay, px, py) === 0) {
      this._handleCollinear(pn, e2);
    } else {
      const h0 = this._halfedges[e0];
      const h1 = this._halfedges[e1];
      const h2 = this._halfedges[e2];

      const t0 = this._addTriangle(p0, p1, pn, h0, -1, -1, e0);
      const t1 = this._addTriangle(p1, p2, pn, h1, -1, t0 + 1);
      const t2 = this._addTriangle(p2, p0, pn, h2, t0 + 2, t1 + 1);

      this._legalize(t0);
      this._legalize(t1);
      this._legalize(t2);
    }
  }

  private _addPoint(x: number, y: number) {
    const i = this.coords.length >> 1;
    this.coords.push(x, y);
    if (this.heightAt(x, y) === nullHeight) {
      this._invalidPoints.add(i);
    }
    return i;
  }

  private _addTriangle(
    a: number,
    b: number,
    c: number,
    ab: number,
    bc: number,
    ca: number,
    e = this.triangles.length,
  ) {
    const t = e / 3; // new triangle index

    // add triangle vertices
    this.triangles[e + 0] = a;
    this.triangles[e + 1] = b;
    this.triangles[e + 2] = c;

    // add triangle halfedges
    this._halfedges[e + 0] = ab;
    this._halfedges[e + 1] = bc;
    this._halfedges[e + 2] = ca;

    // link neighboring halfedges
    if (ab >= 0) {
      this._halfedges[ab] = e + 0;
    }
    if (bc >= 0) {
      this._halfedges[bc] = e + 1;
    }
    if (ca >= 0) {
      this._halfedges[ca] = e + 2;
    }

    // init triangle metadata
    this._candidates[2 * t + 0] = 0;
    this._candidates[2 * t + 1] = 0;
    this._queueIndices[t] = -1;
    this._rms[t] = 0;

    // add triangle to pending queue for later rasterization (skipped during the
    // constraint phase, where the error machinery is inactive)
    if (!this._constraintPhase) {
      this._pending[this._pendingLen++] = t;
    }

    // return first halfedge index
    return e;
  }

  private _flush() {
    const coords = this.coords;
    for (let i = 0; i < this._pendingLen; i++) {
      const t = this._pending[i];
      // rasterize triangle to find maximum pixel error
      const a = 2 * this.triangles[t * 3 + 0];
      const b = 2 * this.triangles[t * 3 + 1];
      const c = 2 * this.triangles[t * 3 + 2];
      this._findCandidate(
        coords[a],
        coords[a + 1],
        coords[b],
        coords[b + 1],
        coords[c],
        coords[c + 1],
        t,
      );
    }
    this._pendingLen = 0;
  }

  private _legalize(a: number) {
    // if the pair of triangles doesn't satisfy the Delaunay condition
    // (p1 is inside the circumcircle of [p0, pl, pr]), flip them,
    // then do the same check/flip recursively for the new pair of triangles
    //
    //           pl                    pl
    //          /||\                  /  \
    //       al/ || \bl            al/    \a
    //        /  ||  \              /      \
    //       /  a||b  \    flip    /___ar___\
    //     p0\   ||   /p1   =>   p0\---bl---/p1
    //        \  ||  /              \      /
    //       ar\ || /br             b\    /br
    //          \||/                  \  /
    //           pr                    pr

    const b = this._halfedges[a];

    if (b < 0) {
      return;
    }

    const a0 = a - (a % 3);
    const b0 = b - (b % 3);
    const al = a0 + ((a + 1) % 3);
    const ar = a0 + ((a + 2) % 3);
    const bl = b0 + ((b + 2) % 3);
    const br = b0 + ((b + 1) % 3);
    const p0 = this.triangles[ar];
    const pr = this.triangles[a];
    const pl = this.triangles[al];
    const p1 = this.triangles[bl];
    const coords = this.coords;

    // never flip a locked constraint edge
    if (this._isConstrained(pr, pl)) {
      return;
    }

    if (
      !inCircle(
        coords[2 * p0],
        coords[2 * p0 + 1],
        coords[2 * pr],
        coords[2 * pr + 1],
        coords[2 * pl],
        coords[2 * pl + 1],
        coords[2 * p1],
        coords[2 * p1 + 1],
      )
    ) {
      return;
    }

    const hal = this._halfedges[al];
    const har = this._halfedges[ar];
    const hbl = this._halfedges[bl];
    const hbr = this._halfedges[br];

    this._queueRemove(a0 / 3);
    this._queueRemove(b0 / 3);

    const t0 = this._addTriangle(p0, p1, pl, -1, hbl, hal, a0);
    const t1 = this._addTriangle(p1, p0, pr, t0, har, hbr, b0);

    this._legalize(t0 + 1);
    this._legalize(t1 + 2);
  }

  private _handleCollinear(pn: number, a: number) {
    const a0 = a - (a % 3);
    const al = a0 + ((a + 1) % 3);
    const ar = a0 + ((a + 2) % 3);
    const p0 = this.triangles[ar];
    const pr = this.triangles[a];
    const pl = this.triangles[al];
    const hal = this._halfedges[al];
    const har = this._halfedges[ar];

    const b = this._halfedges[a];

    if (b < 0) {
      const t0 = this._addTriangle(pn, p0, pr, -1, har, -1, a0);
      const t1 = this._addTriangle(p0, pn, pl, t0, -1, hal);
      this._legalize(t0 + 1);
      this._legalize(t1 + 2);
      return;
    }

    const b0 = b - (b % 3);
    const bl = b0 + ((b + 2) % 3);
    const br = b0 + ((b + 1) % 3);
    const p1 = this.triangles[bl];
    const hbl = this._halfedges[bl];
    const hbr = this._halfedges[br];

    this._queueRemove(b0 / 3);

    const t0 = this._addTriangle(p0, pr, pn, har, -1, -1, a0);
    const t1 = this._addTriangle(pr, p1, pn, hbr, -1, t0 + 1, b0);
    const t2 = this._addTriangle(p1, pl, pn, hbl, -1, t1 + 1);
    const t3 = this._addTriangle(pl, p0, pn, hal, t0 + 2, t2 + 1);

    this._legalize(t0);
    this._legalize(t1);
    this._legalize(t2);
    this._legalize(t3);
  }

  // ---------------------------------------------------------------------------
  // Constrained Delaunay (CDT) support
  // ---------------------------------------------------------------------------

  /**
   * Enter the constraint phase. Call after `run(maxError)` and before inserting
   * arbitrary points / enforcing constraint edges.
   */
  beginConstraints() {
    this._constraintPhase = true;
  }

  private _edgeKey(a: number, b: number) {
    // vertex counts stay well below 2^25, so this stays within Number precision
    return a < b ? a * 33554432 + b : b * 33554432 + a;
  }

  private _isConstrained(a: number, b: number) {
    if (this._constrained.size === 0) return false;
    return this._constrained.has(this._edgeKey(a, b));
  }

  private _lockEdge(a: number, b: number) {
    this._constrained.add(this._edgeKey(a, b));
  }

  /** Whether vertex `i` has an explicit (inserted) height rather than a grid one. */
  isExplicit(i: number) {
    return this._explicitHeights.has(i);
  }

  /**
   * Height of vertex `i`, honoring explicit heights set for inserted points and
   * falling back to the grid sample otherwise.
   */
  vertexHeight(i: number) {
    const h = this._explicitHeights.get(i);
    if (h !== undefined) return h;
    return this.heightAt(this.coords[2 * i], this.coords[2 * i + 1]);
  }

  private _addConstraintPoint(x: number, y: number, height: number) {
    const i = this.coords.length >> 1;
    this.coords.push(x, y);
    this._explicitHeights.set(i, height);
    return i;
  }

  // Locate the triangle containing (x, y) via linear scan. Triangles are CCW, so
  // a point is inside when it is left-of (>= 0) all three directed edges. Returns
  // the containing triangle index and, if the point coincides with a vertex, that
  // vertex index (so the caller can skip insertion).
  private _locate(x: number, y: number): { t: number; vertex: number } {
    const tris = this.triangles;
    const coords = this.coords;
    for (let e = 0; e < tris.length; e += 3) {
      const a = tris[e];
      const b = tris[e + 1];
      const c = tris[e + 2];
      const ax = coords[2 * a];
      const ay = coords[2 * a + 1];
      const bx = coords[2 * b];
      const by = coords[2 * b + 1];
      const cx = coords[2 * c];
      const cy = coords[2 * c + 1];
      if (
        orient(ax, ay, bx, by, x, y) >= 0 &&
        orient(bx, by, cx, cy, x, y) >= 0 &&
        orient(cx, cy, ax, ay, x, y) >= 0
      ) {
        if (Math.abs(x - ax) < 1e-9 && Math.abs(y - ay) < 1e-9)
          return { t: e / 3, vertex: a };
        if (Math.abs(x - bx) < 1e-9 && Math.abs(y - by) < 1e-9)
          return { t: e / 3, vertex: b };
        if (Math.abs(x - cx) < 1e-9 && Math.abs(y - cy) < 1e-9)
          return { t: e / 3, vertex: c };
        return { t: e / 3, vertex: -1 };
      }
    }
    return { t: -1, vertex: -1 };
  }

  /**
   * Insert an arbitrary point with an explicit height, returning its vertex index
   * (or the index of a coincident existing vertex). Requires the constraint phase.
   */
  insertPoint(x: number, y: number, height: number) {
    const loc = this._locate(x, y);
    if (loc.vertex >= 0) return loc.vertex;
    if (loc.t < 0) return -1;
    const pn = this._addConstraintPoint(x, y, height);
    this._splitAt(pn, loc.t);
    return pn;
  }

  // Find a halfedge belonging to the undirected edge (u, v), or -1 if absent.
  private _findEdge(u: number, v: number) {
    const tris = this.triangles;
    for (let e = 0; e < tris.length; e++) {
      const a = tris[e];
      const b = tris[nextEdge(e)];
      if ((a === u && b === v) || (a === v && b === u)) return e;
    }
    return -1;
  }

  // Unconditional (non-Delaunay) flip of the edge at halfedge `a`.
  private _flip(a: number) {
    const b = this._halfedges[a];
    if (b < 0) return;

    const a0 = a - (a % 3);
    const b0 = b - (b % 3);
    const al = a0 + ((a + 1) % 3);
    const ar = a0 + ((a + 2) % 3);
    const bl = b0 + ((b + 2) % 3);
    const br = b0 + ((b + 1) % 3);

    const p0 = this.triangles[ar];
    const pr = this.triangles[a];
    const pl = this.triangles[al];
    const p1 = this.triangles[bl];

    const hal = this._halfedges[al];
    const har = this._halfedges[ar];
    const hbl = this._halfedges[bl];
    const hbr = this._halfedges[br];

    this._queueRemove(a0 / 3);
    this._queueRemove(b0 / 3);

    const t0 = this._addTriangle(p0, p1, pl, -1, hbl, hal, a0);
    this._addTriangle(p1, p0, pr, t0, har, hbr, b0);
  }

  /**
   * Enforce the constraint edge (u, v): flip the edges the segment crosses until
   * (u, v) is itself an edge, then lock it so `_legalize` never flips it.
   *
   * Uses a walk (Lawson edge insertion): starting at `u` it gathers only the edges
   * the segment actually crosses and flips a convex one each pass, so the cost is
   * proportional to the number of crossings rather than the whole mesh. The rare
   * degenerate case the walk can't resolve (segment through a vertex, a boundary,
   * or no flippable crossing) falls back to the brute scan.
   */
  constrainEdge(u: number, v: number) {
    if (u === v || u < 0 || v < 0) return;
    this._constrainEdgeImpl(u, v, 0);
  }

  private _constrainEdgeImpl(u: number, v: number, depth: number) {
    if (u === v || u < 0 || v < 0) return;
    const coords = this.coords;

    this._lastSplit = -1;
    let crossings = this._collectCrossingEdges(u, v);
    if (crossings === null) {
      // The segment runs through an intermediate vertex — enforce the two halves.
      if (this._lastSplit >= 0 && depth < 96) {
        const w = this._lastSplit;
        this._constrainEdgeImpl(u, w, depth + 1);
        this._constrainEdgeImpl(w, v, depth + 1);
        return;
      }
      this._constrainEdgeBrute(u, v);
      return;
    }

    const ux = coords[2 * u];
    const uy = coords[2 * u + 1];
    const vx = coords[2 * v];
    const vy = coords[2 * v + 1];
    let flips = 0;
    const maxFlips = crossings.length * crossings.length + 16;
    while (crossings.length > 0) {
      // Choose a convex crossing edge to flip, preferring one whose flip removes a
      // crossing (its new diagonal no longer meets the segment). Preferring such a
      // "reducing" flip shrinks the crossing set every step, so the loop converges
      // instead of oscillating between equivalent configurations.
      let chosen = -1;
      for (const he of crossings) {
        const o = this._halfedges[he];
        if (o < 0) continue;
        const pr = this.triangles[he];
        const pl = this.triangles[nextEdge(he)];
        if (this._isConstrained(pr, pl)) continue;
        const p0 = this.triangles[prevEdge(he)];
        const p1 = this.triangles[prevEdge(o)];
        const p0x = coords[2 * p0];
        const p0y = coords[2 * p0 + 1];
        const p1x = coords[2 * p1];
        const p1y = coords[2 * p1 + 1];
        // convex quad iff the new diagonal (p0, p1) properly crosses (pr, pl)
        if (
          !segmentsIntersect(
            p0x,
            p0y,
            p1x,
            p1y,
            coords[2 * pr],
            coords[2 * pr + 1],
            coords[2 * pl],
            coords[2 * pl + 1],
          )
        )
          continue;
        if (!segmentsIntersect(ux, uy, vx, vy, p0x, p0y, p1x, p1y)) {
          chosen = he; // reducing flip — take it immediately
          break;
        }
        if (chosen < 0) chosen = he; // otherwise remember the first convex one
      }
      if (chosen < 0 || ++flips > maxFlips) {
        // Nothing flippable this pass (degenerate) — fall back to the brute method.
        this._constrainEdgeBrute(u, v);
        return;
      }
      this._flip(chosen);
      this._lastSplit = -1;
      const next = this._collectCrossingEdges(u, v);
      if (next === null) {
        if (this._lastSplit >= 0 && depth < 96) {
          const w = this._lastSplit;
          this._constrainEdgeImpl(u, w, depth + 1);
          this._constrainEdgeImpl(w, v, depth + 1);
          return;
        }
        this._constrainEdgeBrute(u, v);
        return;
      }
      crossings = next;
    }
    this._lockEdge(u, v);
  }

  // Whether vertex `w` lies (near-collinearly) strictly between `u` and `v`.
  private _onSegment(u: number, v: number, w: number): boolean {
    if (w === u || w === v) return false;
    const c = this.coords;
    const ax = c[2 * u];
    const ay = c[2 * u + 1];
    const bx = c[2 * v];
    const by = c[2 * v + 1];
    const wx = c[2 * w];
    const wy = c[2 * w + 1];
    const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    if (len2 === 0) return false;
    // strictly between by projection onto (u, v)
    const dot = (wx - ax) * (bx - ax) + (wy - ay) * (by - ay);
    if (dot <= 1e-9 || dot >= len2 - 1e-9) return false;
    // near-collinear: perpendicular distance small relative to the segment length
    const cross = (bx - ax) * (wy - ay) - (by - ay) * (wx - ax);
    return cross * cross <= 1e-4 * len2;
  }

  // Walk from `u` toward `v`, returning the halfedges of the edges the segment
  // properly crosses (in order). Returns an empty array when (u, v) is already an
  // edge, or null when the walk cannot resolve it. In the null case, when the
  // segment passes through an intermediate vertex, `_lastSplit` is set to it so the
  // caller can split the constraint there rather than fall back to the brute scan.
  private _collectCrossingEdges(u: number, v: number): number[] | null {
    const tris = this.triangles;
    const hs = this._halfedges;
    const coords = this.coords;
    const ux = coords[2 * u];
    const uy = coords[2 * u + 1];
    const vx = coords[2 * v];
    const vy = coords[2 * v + 1];
    const crosses = (p: number, q: number) =>
      segmentsIntersect(
        ux,
        uy,
        vx,
        vy,
        coords[2 * p],
        coords[2 * p + 1],
        coords[2 * q],
        coords[2 * q + 1],
      );

    // Starting triangle: the one incident to `u` that the segment leaves through.
    let start = -1;
    let startSplit = -1;
    for (let e = 0; e < tris.length; e++) {
      if (tris[e] !== u) continue;
      const oe = nextEdge(e); // the edge opposite `u`
      const b = tris[oe];
      const c = tris[nextEdge(oe)];
      if (b === v || c === v) return []; // (u, v) already an edge
      if (crosses(b, c)) {
        start = oe;
        break;
      }
      // A neighbour of `u` sitting on the segment is a candidate split point.
      if (startSplit < 0 && this._onSegment(u, v, b)) startSplit = b;
      if (startSplit < 0 && this._onSegment(u, v, c)) startSplit = c;
    }
    if (start < 0) {
      this._lastSplit = startSplit;
      return null;
    }

    const crossings = [start];
    let oe = start;
    const maxSteps = tris.length;
    for (let step = 0; step <= maxSteps; step++) {
      const tw = hs[oe];
      if (tw < 0) return null; // boundary before reaching `v`
      const apex = tris[prevEdge(tw)];
      if (apex === v) return crossings;
      const b = tris[nextEdge(tw)]; // shared-edge endpoints on the far triangle
      const c = tris[tw];
      if (crosses(b, apex)) {
        oe = nextEdge(tw);
      } else if (crosses(apex, c)) {
        oe = prevEdge(tw);
      } else {
        // Segment exits through the apex vertex — split the constraint there.
        if (this._onSegment(u, v, apex)) this._lastSplit = apex;
        return null;
      }
      crossings.push(oe);
    }
    return null;
  }

  // Brute constraint enforcement: scan-and-flip across the whole mesh (O(E) per
  // flip). Kept as a robust fallback for the degenerate cases the walk declines.
  private _constrainEdgeBrute(u: number, v: number) {
    if (this._findEdge(u, v) >= 0) {
      this._lockEdge(u, v);
      return;
    }
    const coords = this.coords;
    const ux = coords[2 * u];
    const uy = coords[2 * u + 1];
    const vx = coords[2 * v];
    const vy = coords[2 * v + 1];

    let guard = 0;
    const maxIter = this.triangles.length * 3 + 16;
    while (this._findEdge(u, v) < 0) {
      if (++guard > maxIter) break;
      let flipped = false;
      const hs = this._halfedges;
      for (let e = 0; e < hs.length; e++) {
        const o = hs[e];
        if (o < 0 || o < e) continue; // each undirected interior edge once
        const pr = this.triangles[e];
        const pl = this.triangles[nextEdge(e)];
        if (pr === u || pr === v || pl === u || pl === v) continue;
        if (this._isConstrained(pr, pl)) continue;
        // does edge (pr, pl) properly cross the segment (u, v)?
        if (
          !segmentsIntersect(
            ux,
            uy,
            vx,
            vy,
            coords[2 * pr],
            coords[2 * pr + 1],
            coords[2 * pl],
            coords[2 * pl + 1],
          )
        )
          continue;
        // only flip convex quads (new diagonal (p0, p1) must cross the old one)
        const a0 = e - (e % 3);
        const b0 = o - (o % 3);
        const p0 = this.triangles[a0 + ((e + 2) % 3)];
        const p1 = this.triangles[b0 + ((o + 2) % 3)];
        if (
          !segmentsIntersect(
            coords[2 * p0],
            coords[2 * p0 + 1],
            coords[2 * p1],
            coords[2 * p1 + 1],
            coords[2 * pr],
            coords[2 * pr + 1],
            coords[2 * pl],
            coords[2 * pl + 1],
          )
        )
          continue;
        this._flip(e);
        flipped = true;
        break;
      }
      if (!flipped) break; // no convex crossing edge available
    }
    this._lockEdge(u, v);
  }

  /**
   * Remove triangles whose centroid fails the `isInside` predicate (in grid
   * coordinates). Used to trim the triangulation to the constraint polygon,
   * including holes (predicate = inside outer ring minus holes).
   */
  removeExteriorTriangles(isInside: (x: number, y: number) => boolean) {
    const tris = this.triangles;
    const coords = this.coords;
    const kept: number[] = [];
    for (let e = 0; e < tris.length; e += 3) {
      const a = tris[e];
      const b = tris[e + 1];
      const c = tris[e + 2];
      const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
      const cy =
        (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
      if (isInside(cx, cy)) kept.push(a, b, c);
    }
    this.triangles = kept;
  }

  // priority queue methods
  private _queuePush(t: number, error: number, rms: number) {
    const i = this._queue.length;
    this._queueIndices[t] = i;
    this._queue.push(t);
    this._errors.push(error);
    this._rmsSum += rms;
    this._queueUp(i);
  }

  private _queuePop() {
    const n = this._queue.length - 1;
    this._queueSwap(0, n);
    this._queueDown(0, n);
    return this._queuePopBack();
  }

  private _queuePopBack() {
    const t = this._queue.pop()!;
    this._errors.pop();
    this._rmsSum -= this._rms[t];
    this._queueIndices[t] = -1;
    return t;
  }

  private _queueRemove(t: number) {
    const i = this._queueIndices[t];
    if (i < 0) {
      // During the constraint phase, triangles created after the greedy pass are
      // neither queued nor pending, so there is nothing to remove.
      if (this._constraintPhase) {
        return;
      }
      const it = this._pending.indexOf(t);
      if (it !== -1) {
        this._pending[it] = this._pending[--this._pendingLen];
      } else {
        throw new Error('Broken triangulation (something went wrong).');
      }
      return;
    }
    const n = this._queue.length - 1;
    if (n !== i) {
      this._queueSwap(i, n);
      if (!this._queueDown(i, n)) {
        this._queueUp(i);
      }
    }
    this._queuePopBack();
  }

  private _queueLess(i: number, j: number) {
    return this._errors[i] > this._errors[j];
  }

  private _queueSwap(i: number, j: number) {
    const pi = this._queue[i];
    const pj = this._queue[j];
    this._queue[i] = pj;
    this._queue[j] = pi;
    this._queueIndices[pi] = j;
    this._queueIndices[pj] = i;
    const e = this._errors[i];
    this._errors[i] = this._errors[j];
    this._errors[j] = e;
  }

  private _queueUp(j0: number) {
    let j = j0;
    while (true) {
      const i = (j - 1) >> 1;
      if (i === j || !this._queueLess(j, i)) {
        break;
      }
      this._queueSwap(i, j);
      j = i;
    }
  }

  private _queueDown(i0: number, n: number) {
    let i = i0;
    while (true) {
      const j1 = 2 * i + 1;
      if (j1 >= n || j1 < 0) {
        break;
      }
      const j2 = j1 + 1;
      let j = j1;
      if (j2 < n && this._queueLess(j2, j1)) {
        j = j2;
      }
      if (!this._queueLess(j, i)) {
        break;
      }
      this._queueSwap(i, j);
      i = j;
    }
    return i > i0;
  }
}

function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  return (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);
}

// next halfedge within a triangle (edges are stored in groups of three)
function nextEdge(e: number) {
  return e % 3 === 2 ? e - 2 : e + 1;
}

// previous halfedge within a triangle
function prevEdge(e: number) {
  return e % 3 === 0 ? e + 2 : e - 1;
}

// Proper segment intersection: true when segments (a, b) and (c, d) cross in their
// interiors. Shared endpoints or collinear touching do not count as a crossing.
function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function inCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
) {
  const dx = ax - px;
  const dy = ay - py;
  const ex = bx - px;
  const ey = by - py;
  const fx = cx - px;
  const fy = cy - py;

  const ap = dx * dx + dy * dy;
  const bp = ex * ex + ey * ey;
  const cp = fx * fx + fy * fy;

  return (
    dx * (ey * cp - bp * fy) -
      dy * (ex * cp - bp * fx) +
      ap * (ex * fy - ey * fx) <
    0
  );
}

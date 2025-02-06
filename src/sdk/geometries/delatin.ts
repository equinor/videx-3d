const nullHeight = -1000
/**
 * Modified version of Mapbox Delatin library: https://github.com/mapbox/delatin
 * Copyright (c) 2019, Michael Fogleman, Vladimir Agafonkin
 */
export class Delatin {
  data: Float32Array
  width: number
  height: number
  coords: number[] = [] // vertex coordinates (x, y)
  triangles: number[] = [] // mesh triangle indices
  nullValue: number

  private _queue: number[] = []
  private _queueIndices: number[] = []
  private _errors: number[] = []
  private _halfedges: number[] = []
  private _candidates: number[] = []
  private _invalidPoints: Set<number>

  private _rms: number[] = []
  private _pending: number[] = []
  private _pendingLen: number = 0
  private _rmsSum: number = 0

  constructor(data: Float32Array, width: number, nullValue = -1) {
    this.data = data
    this.width = width
    this.height = this.data.length / width

    this.nullValue = nullValue
    this._invalidPoints = new Set()

    const x1 = this.width - 1
    const y1 = this.height - 1
    const p0 = this._addPoint(0, 0)
    const p1 = this._addPoint(x1, 0)
    const p2 = this._addPoint(0, y1)
    const p3 = this._addPoint(x1, y1)

    // add initial two triangles
    const t0 = this._addTriangle(p3, p0, p2, -1, -1, -1)
    this._addTriangle(p0, p3, p1, t0, -1, -1)
    this._flush()
  }

  // refine the mesh until its maximum error gets below the given one
  run(maxError = 1) {
    while (this.getMaxError() > maxError) {
      this.refine()
    }
  }

  // Removes triangles where one or more vertices contains a null value (nullValue)
  removeInvalidTriangles() {
    const validTriangles: number[] = []
    for (let i = 0; i < this.triangles.length; i += 3) {
      const ai = this.triangles[i]
      const bi = this.triangles[i + 1]
      const ci = this.triangles[i + 2]

      if (
        !this._invalidPoints.has(ai) &&
        !this._invalidPoints.has(bi) &&
        !this._invalidPoints.has(ci)
      ) {
        validTriangles.push(
          this.triangles[i],
          this.triangles[i + 1],
          this.triangles[i + 2]
        )
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

    this.triangles = validTriangles
  }

  // refine the mesh with a single point
  refine() {
    this._step()
    this._flush()
  }

  // max error of the current mesh
  getMaxError() {
    return this._errors[0]
  }

  // root-mean-square deviation of the current mesh
  getRMSD() {
    return this._rmsSum > 0
      ? Math.sqrt(this._rmsSum / (this.width * this.height))
      : 0
  }

  // height value at a given position
  heightAt(x: number, y: number) {
    const h = this.data[this.width * y + x]
    return h === this.nullValue ? nullHeight : h
  }

  // rasterize a triangle, find its max error, and queue it for processing
  private _findCandidate(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    t: number
  ) {
    // triangle bounding box
    const minX = Math.min(p0x, p1x, p2x)
    const minY = Math.min(p0y, p1y, p2y)
    const maxX = Math.max(p0x, p1x, p2x)
    const maxY = Math.max(p0y, p1y, p2y)

    // forward differencing variables
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY)
    let w01 = orient(p2x, p2y, p0x, p0y, minX, minY)
    let w02 = orient(p0x, p0y, p1x, p1y, minX, minY)
    const a01 = p1y - p0y
    const b01 = p0x - p1x
    const a12 = p2y - p1y
    const b12 = p1x - p2x
    const a20 = p0y - p2y
    const b20 = p2x - p0x

    // pre-multiplied z values at vertices
    const a = orient(p0x, p0y, p1x, p1y, p2x, p2y)
    const z0 = this.heightAt(p0x, p0y) / a
    const z1 = this.heightAt(p1x, p1y) / a
    const z2 = this.heightAt(p2x, p2y) / a

    // iterate over pixels in bounding box
    let maxError = 0
    let mx = 0
    let my = 0
    let rms = 0
    for (let y = minY; y <= maxY; y++) {
      // compute starting offset
      let dx = 0
      if (w00 < 0 && a12 !== 0) {
        dx = Math.max(dx, Math.floor(-w00 / a12))
      }
      if (w01 < 0 && a20 !== 0) {
        dx = Math.max(dx, Math.floor(-w01 / a20))
      }
      if (w02 < 0 && a01 !== 0) {
        dx = Math.max(dx, Math.floor(-w02 / a01))
      }

      let w0 = w00 + a12 * dx
      let w1 = w01 + a20 * dx
      let w2 = w02 + a01 * dx

      let wasInside = false

      for (let x = minX + dx; x <= maxX; x++) {
        // check if inside triangle
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          wasInside = true

          // compute z using barycentric coordinates
          const z = z0 * w0 + z1 * w1 + z2 * w2
          const h = this.heightAt(x, y)
          const dz = Math.abs(z - h)
          rms += dz * dz
          if (dz > maxError) {
            maxError = dz
            mx = x
            my = y
          }
        } else if (wasInside) {
          break
        }

        w0 += a12
        w1 += a20
        w2 += a01
      }

      w00 += b12
      w01 += b20
      w02 += b01
    }

    if (
      (mx === p0x && my === p0y) ||
      (mx === p1x && my === p1y) ||
      (mx === p2x && my === p2y)
    ) {
      maxError = 0
    }

    // update triangle metadata
    this._candidates[2 * t] = mx
    this._candidates[2 * t + 1] = my
    this._rms[t] = rms

    // add triangle to priority queue
    this._queuePush(t, maxError, rms)
  }

  // process the next triangle in the queue, splitting it with a new point
  private _step() {
    // pop triangle with highest error from priority queue
    const t = this._queuePop()

    const e0 = t * 3 + 0
    const e1 = t * 3 + 1
    const e2 = t * 3 + 2

    const p0 = this.triangles[e0]
    const p1 = this.triangles[e1]
    const p2 = this.triangles[e2]

    const ax = this.coords[2 * p0]
    const ay = this.coords[2 * p0 + 1]
    const bx = this.coords[2 * p1]
    const by = this.coords[2 * p1 + 1]
    const cx = this.coords[2 * p2]
    const cy = this.coords[2 * p2 + 1]
    const px = this._candidates[2 * t]
    const py = this._candidates[2 * t + 1]

    const pn = this._addPoint(px, py)

    if (orient(ax, ay, bx, by, px, py) === 0) {
      this._handleCollinear(pn, e0)
    } else if (orient(bx, by, cx, cy, px, py) === 0) {
      this._handleCollinear(pn, e1)
    } else if (orient(cx, cy, ax, ay, px, py) === 0) {
      this._handleCollinear(pn, e2)
    } else {
      const h0 = this._halfedges[e0]
      const h1 = this._halfedges[e1]
      const h2 = this._halfedges[e2]

      const t0 = this._addTriangle(p0, p1, pn, h0, -1, -1, e0)
      const t1 = this._addTriangle(p1, p2, pn, h1, -1, t0 + 1)
      const t2 = this._addTriangle(p2, p0, pn, h2, t0 + 2, t1 + 1)

      this._legalize(t0)
      this._legalize(t1)
      this._legalize(t2)
    }
  }

  private _addPoint(x: number, y: number) {
    const i = this.coords.length >> 1
    this.coords.push(x, y)
    if (this.heightAt(x, y) === nullHeight) {
      this._invalidPoints.add(i)
    }
    return i
  }

  private _addTriangle(
    a: number,
    b: number,
    c: number,
    ab: number,
    bc: number,
    ca: number,
    e = this.triangles.length
  ) {
    const t = e / 3 // new triangle index

    // add triangle vertices
    this.triangles[e + 0] = a
    this.triangles[e + 1] = b
    this.triangles[e + 2] = c

    // add triangle halfedges
    this._halfedges[e + 0] = ab
    this._halfedges[e + 1] = bc
    this._halfedges[e + 2] = ca

    // link neighboring halfedges
    if (ab >= 0) {
      this._halfedges[ab] = e + 0
    }
    if (bc >= 0) {
      this._halfedges[bc] = e + 1
    }
    if (ca >= 0) {
      this._halfedges[ca] = e + 2
    }

    // init triangle metadata
    this._candidates[2 * t + 0] = 0
    this._candidates[2 * t + 1] = 0
    this._queueIndices[t] = -1
    this._rms[t] = 0

    // add triangle to pending queue for later rasterization
    this._pending[this._pendingLen++] = t

    // return first halfedge index
    return e
  }

  private _flush() {
    const coords = this.coords
    for (let i = 0; i < this._pendingLen; i++) {
      const t = this._pending[i]
      // rasterize triangle to find maximum pixel error
      const a = 2 * this.triangles[t * 3 + 0]
      const b = 2 * this.triangles[t * 3 + 1]
      const c = 2 * this.triangles[t * 3 + 2]
      this._findCandidate(
        coords[a],
        coords[a + 1],
        coords[b],
        coords[b + 1],
        coords[c],
        coords[c + 1],
        t
      )
    }
    this._pendingLen = 0
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

    const b = this._halfedges[a]

    if (b < 0) {
      return
    }

    const a0 = a - (a % 3)
    const b0 = b - (b % 3)
    const al = a0 + ((a + 1) % 3)
    const ar = a0 + ((a + 2) % 3)
    const bl = b0 + ((b + 2) % 3)
    const br = b0 + ((b + 1) % 3)
    const p0 = this.triangles[ar]
    const pr = this.triangles[a]
    const pl = this.triangles[al]
    const p1 = this.triangles[bl]
    const coords = this.coords

    if (
      !inCircle(
        coords[2 * p0],
        coords[2 * p0 + 1],
        coords[2 * pr],
        coords[2 * pr + 1],
        coords[2 * pl],
        coords[2 * pl + 1],
        coords[2 * p1],
        coords[2 * p1 + 1]
      )
    ) {
      return
    }

    const hal = this._halfedges[al]
    const har = this._halfedges[ar]
    const hbl = this._halfedges[bl]
    const hbr = this._halfedges[br]

    this._queueRemove(a0 / 3)
    this._queueRemove(b0 / 3)

    const t0 = this._addTriangle(p0, p1, pl, -1, hbl, hal, a0)
    const t1 = this._addTriangle(p1, p0, pr, t0, har, hbr, b0)

    this._legalize(t0 + 1)
    this._legalize(t1 + 2)
  }

  private _handleCollinear(pn: number, a: number) {
    const a0 = a - (a % 3)
    const al = a0 + ((a + 1) % 3)
    const ar = a0 + ((a + 2) % 3)
    const p0 = this.triangles[ar]
    const pr = this.triangles[a]
    const pl = this.triangles[al]
    const hal = this._halfedges[al]
    const har = this._halfedges[ar]

    const b = this._halfedges[a]

    if (b < 0) {
      const t0 = this._addTriangle(pn, p0, pr, -1, har, -1, a0)
      const t1 = this._addTriangle(p0, pn, pl, t0, -1, hal)
      this._legalize(t0 + 1)
      this._legalize(t1 + 2)
      return
    }

    const b0 = b - (b % 3)
    const bl = b0 + ((b + 2) % 3)
    const br = b0 + ((b + 1) % 3)
    const p1 = this.triangles[bl]
    const hbl = this._halfedges[bl]
    const hbr = this._halfedges[br]

    this._queueRemove(b0 / 3)

    const t0 = this._addTriangle(p0, pr, pn, har, -1, -1, a0)
    const t1 = this._addTriangle(pr, p1, pn, hbr, -1, t0 + 1, b0)
    const t2 = this._addTriangle(p1, pl, pn, hbl, -1, t1 + 1)
    const t3 = this._addTriangle(pl, p0, pn, hal, t0 + 2, t2 + 1)

    this._legalize(t0)
    this._legalize(t1)
    this._legalize(t2)
    this._legalize(t3)
  }

  // priority queue methods
  private _queuePush(t: number, error: number, rms: number) {
    const i = this._queue.length
    this._queueIndices[t] = i
    this._queue.push(t)
    this._errors.push(error)
    this._rmsSum += rms
    this._queueUp(i)
  }

  private _queuePop() {
    const n = this._queue.length - 1
    this._queueSwap(0, n)
    this._queueDown(0, n)
    return this._queuePopBack()
  }

  private _queuePopBack() {
    const t = this._queue.pop()!
    this._errors.pop()
    this._rmsSum -= this._rms[t]
    this._queueIndices[t] = -1
    return t
  }

  private _queueRemove(t: number) {
    const i = this._queueIndices[t]
    if (i < 0) {
      const it = this._pending.indexOf(t)
      if (it !== -1) {
        this._pending[it] = this._pending[--this._pendingLen]
      } else {
        throw new Error('Broken triangulation (something went wrong).')
      }
      return
    }
    const n = this._queue.length - 1
    if (n !== i) {
      this._queueSwap(i, n)
      if (!this._queueDown(i, n)) {
        this._queueUp(i)
      }
    }
    this._queuePopBack()
  }

  private _queueLess(i: number, j: number) {
    return this._errors[i] > this._errors[j]
  }

  private _queueSwap(i: number, j: number) {
    const pi = this._queue[i]
    const pj = this._queue[j]
    this._queue[i] = pj
    this._queue[j] = pi
    this._queueIndices[pi] = j
    this._queueIndices[pj] = i
    const e = this._errors[i]
    this._errors[i] = this._errors[j]
    this._errors[j] = e
  }

  private _queueUp(j0: number) {
    let j = j0
    while (true) {
      const i = (j - 1) >> 1
      if (i === j || !this._queueLess(j, i)) {
        break
      }
      this._queueSwap(i, j)
      j = i
    }
  }

  private _queueDown(i0: number, n: number) {
    let i = i0
    while (true) {
      const j1 = 2 * i + 1
      if (j1 >= n || j1 < 0) {
        break
      }
      const j2 = j1 + 1
      let j = j1
      if (j2 < n && this._queueLess(j2, j1)) {
        j = j2
      }
      if (!this._queueLess(j, i)) {
        break
      }
      this._queueSwap(i, j)
      i = j
    }
    return i > i0
  }
}

function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
) {
  return (bx - cx) * (ay - cy) - (by - cy) * (ax - cx)
}

function inCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number
) {
  const dx = ax - px
  const dy = ay - py
  const ex = bx - px
  const ey = by - py
  const fx = cx - px
  const fy = cy - py

  const ap = dx * dx + dy * dy
  const bp = ex * ex + ey * ey
  const cp = fx * fx + fy * fy

  return (
    dx * (ey * cp - bp * fy) -
      dy * (ex * cp - bp * fx) +
      ap * (ex * fy - ey * fx) <
    0
  )
}

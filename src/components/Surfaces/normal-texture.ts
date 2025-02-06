import { rotate3d } from 'curve-interpolator'
import { DataTexture, LinearFilter } from 'three'
import {
  crossVec3,
  normalizeVec3,
  subVec3, Vec3
} from '../../sdk'

function triangleNormal(p0: Vec3, p1: Vec3, p2: Vec3) {
  const a = subVec3(p0, p1)
  const b = subVec3(p0, p2)
  return normalizeVec3(crossVec3(a, b))
}

function calculateNormals(
  data: Float32Array,
  columns: number,
  xScale: number,
  yScale: number,
  nullValue: number = -1
) {
  const rows = data.length / columns
  const w = columns - 1
  const h = rows - 1

  let i = 0

  const value = (x: number, y: number) => data[y * columns + x]
  const result: Vec3[] = new Array(w * h)

  for (let y0 = 0; y0 < h; y0++) {
    const y1 = y0 + 1
    const yc = y0 + 0.5
    for (let x0 = 0; x0 < w; x0++) {
      const x1 = x0 + 1
      const xc = x0 + 0.5
      const z00 = value(x0, y0)
      if (z00 !== nullValue) {
        const z01 = value(x0, y1)
        const z10 = value(x1, y0)
        const z11 = value(x1, y1)


        const zc = (z00 + z01 + z10 + z11) / 4
        const p00: Vec3 = [x0 * xScale, y0 * yScale, z00]
        const p01: Vec3 = [x0 * xScale, y1 * yScale, z01]
        const p10: Vec3 = [x1 * xScale, y0 * yScale, z10]
        const p11: Vec3 = [x1 * xScale, y1 * yScale, z11]
        const pc: Vec3 = [xc * xScale, yc * yScale, zc]
        const n0 = triangleNormal(pc, p00, p10)
        const n1 = triangleNormal(pc, p10, p11)
        const n2 = triangleNormal(pc, p11, p01)
        const n3 = triangleNormal(pc, p01, p00)

        const n = normalizeVec3([
          n0[0] + n1[0] + n2[0] + n3[0],
          n0[2] + n1[2] + n2[2] + n3[2],
          n0[1] + n1[1] + n2[1] + n3[1],
        ])

        result[i++] = n
      } else {
        result[i++] = [0, 0, 0]
      }
    }
  }
  return { normals: result, columns: w }
}

export function createNormalTexture(
  data: Float32Array,
  width: number,
  xScale: number,
  yScale: number,
  rotation: number,
  nullValue: number = -1,
) {
  const { normals, columns } = calculateNormals(data, width, xScale, yScale, nullValue)

  const buffer = new Uint8Array(normals.length * 4)

  // const sw = columns / 2
  // const sh = normals.length / columns / 2
  // const smaller = new Uint8Array(sw * sh * 4)

  // for (let tc = 0; tc < sw; tc++) {
  //   const sc = tc * 2
  //   for (let tr = 0; tr < sh; tr++) {
  //     const sr = tr * 2
  //     const si = sr * columns + sc
  //     const n0 = normals[si]
  //     const n1 = normals[si + 1]
  //     const n2 = normals[si + columns]
  //     const n3 = normals[si + columns + 1]

  //     // const n = normalizeVec3([
  //     //   n0[0] + n1[0] + n2[0] + n3[0],
  //     //   n0[1] + n1[1] + n2[1] + n3[1],
  //     //   n0[2] + n1[2] + n2[2] + n3[2],
  //     // ])

  //     const n = n0
  //     const r = Math.floor(((n[0] + 1) / 2) * 255)
  //     const g = Math.floor(((n[1] + 1) / 2) * 255)
  //     const b = Math.floor(((n[2] + 1) / 2) * 255)
  //     const ti = (tr * sw + tc) * 4
  //     smaller[ti] = r
  //     smaller[ti + 1] = g
  //     smaller[ti + 2] = b
  //     smaller[ti + 3] = 255
  //   }
  // }

  for (let i = 0; i < normals.length; i++) {
    const n = rotate3d(normals[i], [0, 1, 0],  rotation * (Math.PI / 180)) as Vec3
    const r = Math.floor(((n[0] + 1) / 2) * 255)
    const g = Math.floor(((n[1] + 1) / 2) * 255)
    const b = Math.floor(((n[2] + 1) / 2) * 255)

    const j = i * 4
    buffer[j] = r
    buffer[j + 1] = g
    buffer[j + 2] = b
    buffer[j + 3] = 255
  }

  const h = normals.length / columns
  const normalTexture = new DataTexture(buffer, columns, h)

  //const normalTexture = new DataTexture(smaller, sw, sh)
  normalTexture.minFilter = LinearFilter
  normalTexture.magFilter = LinearFilter
  normalTexture.flipY = true
  normalTexture.anisotropy = 4
  normalTexture.needsUpdate = true

  return normalTexture
}

import { DataTexture, LinearFilter } from 'three'
import {
  crossVec3,
  normalizeVec3,
  rotateVec3,
  subVec3,
  toRGB,
  Vec3
} from '../../sdk'

export function triangleNormal(p0: Vec3, p1: Vec3, p2: Vec3) {
  const a = subVec3(p0, p1)
  const b = subVec3(p0, p2)
  return normalizeVec3(crossVec3(a, b))
}

export function elevationMapToRGBA(
  data: Float32Array,
  nullValue: number = -1,
) {
  const buffer = new Uint8Array(data.length * 4)
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    const rgb = v === nullValue ? [0, 0, 0] : toRGB(v)
    const j = i * 4
    buffer[j] = rgb[0]
    buffer[j + 1] = rgb[1]
    buffer[j + 2] = rgb[2]
    buffer[j + 3] = v === -1 ? 0 : 255
  }

  return buffer
}

export function elevationMapNormalsToRGBA(
  data: Float32Array,
  columns: number,
  xScale: number,
  yScale: number,
  rotation: number = 0,
  nullValue: number = -1,
) {
  const rows = data.length / columns
  const w = columns - 1
  const h = rows - 1
  const buffer = new Uint8Array(w * h * 4)

  let i = 0

  const value = (x: number, y: number) => data[y * columns + x]
  
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

        const rn = rotateVec3(n, [0, 1, 0], rotation * (Math.PI / 180))
        const r = Math.floor(((rn[0] + 1) / 2) * 255)
        const g = Math.floor(((rn[1] + 1) / 2) * 255)
        const b = Math.floor(((rn[2] + 1) / 2) * 255)

        buffer[i] = r
        buffer[i + 1] = g
        buffer[i + 2] = b
        buffer[i + 3] = 255
      } else {
        buffer[i] = 0
        buffer[i + 1] = 0
        buffer[i + 2] = 0
        buffer[i + 3] = 0
      }
      i+=4
    }
  }
  return buffer
}

export function createNormalTexture(
  buffer: Uint8Array,
  width: number,
  height: number,
) {
 
  const normalTexture = new DataTexture(buffer, width, height)

  normalTexture.minFilter = LinearFilter
  normalTexture.magFilter = LinearFilter
  normalTexture.flipY = true
  normalTexture.anisotropy = 4
  normalTexture.needsUpdate = true

  return normalTexture
}

export function createElevationTexture(
  buffer: Uint8Array,
  width: number,
  height: number,
) {
  const elevationTexture = new DataTexture(buffer, width, height)
  elevationTexture.minFilter = LinearFilter
  elevationTexture.magFilter = LinearFilter
  //tex.anisotropy = 4
  elevationTexture.needsUpdate = true
  elevationTexture.flipY = true

  return elevationTexture
}

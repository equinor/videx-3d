import {
  abs,
  EPSILON,
  Fn,
  min,
  mul,
  saturate,
  select,
  sub,
  vec3,
  vec4,
} from 'three/tsl'
import { Node } from 'three/webgpu'

export const hue2rgb = /*@__PURE__*/ Fn<Node>(([H]) => {
  const R = abs(H.mul(6).sub(3)).sub(1)
  const G = sub(2, abs(H.mul(6).sub(2)))
  const B = sub(2, abs(H.mul(6).sub(4)))

  return saturate(vec3(R, G, B))
})

export const hsl2rgb = /*@__PURE__*/ Fn<Node>(([HSL]) => {
  const RGB = hue2rgb(HSL.x)
  const C = sub(1, abs(mul(2, HSL.z).sub(1))).mul(HSL.y)

  return RGB.sub(0.5).mul(C).add(HSL.z)
})

export const rgb2hsv = /*@__PURE__*/ Fn<Node>(([RGB]) => {
  // Based on work by Sam Hocevar and Emil Persson

  const P = select(
    RGB.g.lessThan(RGB.b),
    vec4(RGB.bg, -1.0, 2.0 / 3.0),
    vec4(RGB.gb, 0.0, -1.0 / 3.0),
  )
  const Q = select(RGB.r.lessThan(P.x), vec4(P.xyw, RGB.r), vec4(RGB.r, P.yzx))
  const C = Q.x.sub(min(Q.w, Q.y))
  const H = abs(Q.w.sub(Q.y).div(mul(6, C).add(EPSILON)).add(Q.z))

  return vec3(H, C, Q.x)
})

export const rgb2hsl = /*@__PURE__*/ Fn<Node>(([RGB]) => {
  const HCV = rgb2hsv(RGB)
  const L = HCV.z.sub(HCV.y.mul(0.5))
  const S = HCV.y.div(sub(1, abs(L.mul(2).sub(1))).add(EPSILON))

  return vec3(HCV.x, S, L)
})

export const hsv2rgb = /*@__PURE__*/ Fn<Node>(([HSV]) => {
  const RGB = hue2rgb(HSV.x)

  return RGB.sub(1).mul(HSV.y).add(1).mul(HSV.z)
})

import {
  clamp,
  dot,
  Fn,
  materialColor,
  mix,
  normalView,
  positionView,
  positionViewDirection,
  pow,
  saturate,
} from 'three/tsl'
import { hsv2rgb, rgb2hsl } from './color-conversions'

export const depthShade = Fn(() => {
  const diffuseColor = materialColor
  const depthFactor = saturate(dot(normalView, positionViewDirection))

  const darkenFactor = clamp(positionView.z.div(5000.0), 0.1, 0.8)

  const hsv = rgb2hsl(diffuseColor)
  hsv.z.assign(hsv.z.mul(darkenFactor))
  const mixColor = hsv2rgb(hsv)

  return mix(mixColor, diffuseColor, pow(depthFactor, 0.8))
})

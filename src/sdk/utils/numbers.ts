export function clamp(value: number, min = 0, max = 1): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function lerp(from: number, to: number, t: number) {
  t = clamp(t, 0, 1)
  return (1 - t) * from + t * to
}

export function inverseLerp(v: number, minValue: number, maxValue: number) {
  return (v - minValue) / (maxValue - minValue)
}

export function remap(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
) {
  const t = inverseLerp(v, inMin, inMax)
  return lerp(outMin, outMax, t)
}

export const toRGB = (v: number) => {
  const m = Math.round(v * 1000)
  const r = Math.floor(m / 65536)
  const g = Math.floor(m / 256) - r * 256
  const b = Math.floor(m) - r * 65536 - g * 256
  return [r, g, b]
}

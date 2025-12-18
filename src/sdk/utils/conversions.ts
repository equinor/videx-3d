import { Vec2 } from '../types/common'

export function feetToMeters(feet: number): number {
  return feet / 3.28084
}

export function degreesToRadians(deg: number): number {
  return deg * (Math.PI / 180)
}

export const screenToNormalizedDevice = (
  pos: Vec2,
  width = 1,
  height = 1
): Vec2 => [(pos[0] / width) * 2 - 1, -(pos[1] / height) * 2 + 1]

export const normalizedDeviceToScreen = (
  pos: Vec2,
  width = 1,
  height = 1
): Vec2 => [((pos[0] + 1) / 2) * width, ((1 - pos[1]) / 2) * height]

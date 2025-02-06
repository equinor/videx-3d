import { Vec2 } from '../../../sdk'

export const getGridPositionFromUV = (uvX: number, uvY: number, size: Vec2, gridScale: Vec2, originOffset: Vec2): Vec2 | null => {
  const centerX = size[0] * 0.5
  const centerY = size[1] * 0.5
  const [originX, originY] = originOffset

  const curX = uvX * size[0]
  const curY = uvY * size[1]

  const posX = (curX - (centerX + originX)) * gridScale[0]
  const posY = (curY - (centerY + originY)) * gridScale[1]

  return [posX, posY]
}

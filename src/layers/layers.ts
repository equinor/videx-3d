import { Layers } from 'three'

export const LAYERS = {
  NOT_EMITTER: 29,
  EMITTER: 30,
  OCCLUDER: 31,
}

export function createLayers(...values: number[]) {
  const layers = new Layers()
  values.forEach(value => layers.enable(value))
  return layers
}
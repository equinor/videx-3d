import { Layers } from 'three'

export const LAYERS = {
  NOT_EMITTER: 29,  // can be used to exclude an object from being used as an event emitter
  EMITTER: 30,      // used internally to flag an object as an event emitter
  OCCLUDER: 31,     // object will be considered in occlusion checks in the annotations system
}

export function createLayers(...values: number[]) {
  const layers = new Layers()
  values.forEach(value => layers.enable(value))
  return layers
}
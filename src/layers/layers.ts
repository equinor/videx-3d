import { Layers } from 'three';

export const LAYERS = {
  OIT_EXCLUDED: 25, // excludes an OIT-capable object from the transparency passes; it is drawn in the opaque pass with its material properties left intact (depthWrite/transparent unchanged)
  FORCE_OPAQUE: 26, // forces an OIT-capable object to be rendered as a depth-writing opaque occluder by the OITRenderPass, even when its material is transparent
  OVERLAY: 27, // always-on-top objects, rendered last by the OITRenderPass (after the transparent layers)
  EMISSIVE: 28, // additive/glow objects, rendered between the opaque and transparent passes so transparent surfaces in front attenuate them
  NOT_EMITTER: 29, // can be used to exclude an object from being used as an event emitter
  EMITTER: 30, // used internally to flag an object as an event emitter
};

export function createLayers(...values: number[]) {
  const layers = new Layers();
  values.forEach(value => layers.enable(value));
  return layers;
}

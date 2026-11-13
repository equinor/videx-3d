import { DoubleSide, ShaderMaterial, Uniform } from 'three';
import type { WaterBody } from '../../sdk/materials/water-body';
import fragmentShader from './shaders/deep-fragment.glsl';
import vertexShader from './shaders/deep-vertex.glsl';

/**
 * The deep water under an `Ocean`'s surface where nothing else lies under it: drawn with the
 * surface's geometry on the far plane, opaque, so it hides nothing, and whatever lies in the
 * water (its bed, its walls, the data) draws over it, faded by its own path through the water.
 * Its colour is the water's own (`WaterBody`), seen as water too deep to see through.
 */
export class OceanDeepMaterial extends ShaderMaterial {
  isOceanDeepMaterial = true;

  constructor(water: WaterBody) {
    super({
      vertexShader,
      fragmentShader,
      side: DoubleSide,
      depthWrite: false,
      uniforms: { uMasterOpacity: new Uniform(1) },
    });
    water.bind(this.uniforms);
  }

  /** the Ocean's own `opacity` */
  set masterOpacity(value: number) {
    this.uniforms.uMasterOpacity.value = value;
  }
}

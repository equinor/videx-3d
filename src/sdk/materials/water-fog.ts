import { Color, IUniform, Vector3, Vector4 } from 'three';

/**
 * A body of water that fogs what is seen through it, as uniforms (see
 * `shaderLib/water-fog.glsl`): the `Sky`'s sea hands out its own, and a `ChunkMaterial`
 * given them fogs the same way. Every material is given the same objects, so a change
 * to the water reaches them all without a rebuild.
 */
export type WaterFogUniforms = {
  /** the world's up direction, normalised */
  up: IUniform<Vector3>;
  /** the water surface's height along `up` */
  level: IUniform<number>;
  /** the seabed's depth below `level`: what lies deeper is fogged by the water above it only */
  depth: IUniform<number>;
  /** how quickly the water tints what is seen through it, per world unit; 0 for none */
  density: IUniform<number>;
  shallowColor: IUniform<Color>;
  deepColor: IUniform<Color>;
  /** 0 (night) to 1 (day): how much light the water itself carries */
  daylight: IUniform<number>;
  /** scales the water's own colour */
  intensity: IUniform<number>;
  /**
   * Where the camera is: 1 in the water, so what lies above it is seen through water all
   * the way; -1 in the ground, where nothing it sees is; 0 in the air
   */
  camera: IUniform<number>;
  /** where the cutaway through the water in front of the view is measured from: on its plane, below the camera */
  cutawayAnchor: IUniform<Vector3>;
  /** which way the cutaway reaches from its anchor, level and normalised */
  cutawayHeading: IUniform<Vector3>;
  /** how far ahead its edge runs, its scale (0 for no cutaway), its edge's width, and the opacity of the water left in it */
  cutawayShape: IUniform<Vector4>;
  /** two waves along its edge: amplitude, angular frequency (radians per world unit) and phase */
  cutawayWaveA: IUniform<Vector3>;
  cutawayWaveB: IUniform<Vector3>;
};

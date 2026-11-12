import { DoubleSide, ShaderMaterial, Uniform, Vector4 } from 'three';
import type { OceanMaterial } from '../ocean-material';
import type { SeaWaveBake } from '../sea-wave-bake';
import vertexShader from '../shaders/vertex.glsl';
import fragmentShader from './shaders/sea-core-fragment.glsl';

/**
 * The wave core's prototype surface (debug only): `water`'s uniform objects, shared, for its
 * sun, colours, Fresnel and glint, and `bake`'s layers for its waves. Flagged
 * `isSeaCoreMaterial` for the sea bench's draw groups.
 */
export function createSeaCoreMaterial(
  water: OceanMaterial,
  bake: SeaWaveBake,
): ShaderMaterial {
  const layers = bake.layers;
  const uniforms: ShaderMaterial['uniforms'] = {
    ...water.uniforms,
    uSeaLayers: new Uniform(
      layers.map(
        ({ layer }) =>
          new Vector4(
            1 / layer.size,
            Math.cos(layer.angle),
            Math.sin(layer.angle),
            layer.texels,
          ),
      ),
    ),
    uSeaLayerVariance: new Uniform(layers.map(() => 0)),
    uSeaResidual: new Uniform(0),
  };
  layers.forEach((baked, i) => {
    uniforms[`uSeaSurface${i}`] = new Uniform(baked.surface);
  });
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines: {
      OCEAN_WAVE_COUNT: (water.uniforms.uWaveA.value as unknown[]).length,
      OCEAN_CONTACT_COUNT: water.contactCount,
      SEA_LAYERS: layers.length,
      SEA_HEX: '',
    },
    transparent: true,
    side: DoubleSide,
  });
  material.fog = true;
  material.opacity = water.opacity;
  Object.assign(material, { isSeaCoreMaterial: true });
  return material;
}

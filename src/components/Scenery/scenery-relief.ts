import {
  FloatType,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedShortType,
  type WebGLRenderer,
} from 'three';
import { colorRampTexture } from '../../common/color-ramps';
import { drawsSharedTextures } from '../../common/shared-textures';
import fragmentShader from './shaders/relief-fragment.glsl';
import sceneryVertexShader from './shaders/scenery-vertex.glsl';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryReliefAtlas } from './scenery-relief-atlas';
import { scenerySeaDefines } from './scenery-stage';

// One step of a 24-bit depth buffer, in window depth.
const FIXED_24_STEP = 2 ** -24;

/**
 * The overview behind the relief drawn from tiles, for a far plane short of the
 * farthest ground in view: the relief's own tiles, read per pixel through `atlas` (indexed
 * in `geoTileSquare`'s coordinates: longitude east, latitude south), above the sea past
 * `uReliefReach`, looked as the tiles look them, flat on the globe's sea, on a fullscreen
 * layer (`createSceneryGeometry`) just inside the far plane (`sceneryReliefFarStep`), so only
 * where nothing nearer is drawn: from anywhere, the far side of the Earth included. It writes
 * its depth there and is drawn before the sky's background (`SCENERY_RELIEF_OVERVIEW_ORDER`),
 * whose layers lie on the far plane: they are shaded only where it is not drawn. Drawn after
 * them, it covered them: from space the sky and the sea's layer were shaded under all of it
 * (2026-11-25: 1.85 fragments a pixel, ~7 ms of a 19 ms frame at 2440 × 2050). Land as the
 * tiles draw it (see `relief-fragment.glsl`). It inherits the sky material's uniform objects,
 * so it follows every change to the sky, its globe and its water; a change to the sky's
 * defines needs a new one.
 *
 * @param atlas the tiles chosen for the overview (`SceneryReliefAtlas`), read as they change
 * @param base the height where no layer has data, metres over the sea (`ReliefLayersSource.base`, the tiles')
 * @param looks the relief's looks (`SceneryReliefLooks.texture`): each layer takes its own,
 * as on the tiles
 */
export function createSceneryReliefFarMaterial(
  scenery: SceneryMaterial,
  atlas: SceneryReliefAtlas,
  base: number,
  looks: Texture,
) {
  const defines = scenerySeaDefines(scenery);
  defines.RELIEF_FAR = '';
  defines.SCENERY_INSIDE_FAR = '';
  const uniforms = Object.create(scenery.uniforms) as Record<string, Uniform>;
  Object.assign(uniforms, atlas.uniforms);
  uniforms.uReliefBase = new Uniform(base);
  uniforms.uReliefReach = new Uniform(1e30);
  uniforms.uReliefLowest = new Uniform(0);
  uniforms.uReliefHandoverMin = new Uniform(0.8);
  uniforms.uReliefLook = new Uniform(looks);
  uniforms.uColorRamps = new Uniform(colorRampTexture);
  uniforms.uSceneryInsideFar = new Uniform(FIXED_24_STEP);
  const material = drawsSharedTextures(
    new ShaderMaterial({
      vertexShader: sceneryVertexShader,
      fragmentShader,
      uniforms,
      defines,
      lights: true,
      dithering: true,
    }),
  );
  // Just inside the far plane of the buffer it is drawn into, each draw.
  const watch = material.onBeforeRender;
  material.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    object,
    group,
  ) => {
    uniforms.uSceneryInsideFar.value = sceneryReliefFarStep(renderer);
    watch.call(material, renderer, scene, camera, geometry, object, group);
  };
  return material;
}

/**
 * How far inside the far plane, in window depth, the overview lies in the depth buffer
 * `renderer` draws into now: one step of that buffer, so the layers on the far plane fail the
 * depth test under it, and no more, so what lies just short of the far plane stays in front.
 * A fixed-point buffer's — the canvas's (24 bits in practice), or a render target's unless its
 * `DepthTexture` is `FloatType` — is 2^-24, or 2^-16 for `UnsignedShortType`: anything finer
 * rounds to the far plane, and the sky is drawn over it. A float one's is an fp32 step under 1;
 * reversed it is near 0, as fine as a float goes: one 24-bit step there puts everything past
 * 2^24 near planes (1700 km at 0.1 m) behind it.
 */
export function sceneryReliefFarStep(renderer: WebGLRenderer): number {
  const type = renderer.getRenderTarget()?.depthTexture?.type;
  if (type === UnsignedShortType) return 2 ** -16;
  if (type === FloatType && renderer.state.buffers.depth.getReversed())
    return 1e-30;
  return FIXED_24_STEP;
}

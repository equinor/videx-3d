import type { Material } from 'three';
import skyCurveShader from './shaders/sky-curve.glsl';
import type { SkyMaterial } from './sky-material';

// After three's own: the vertex lowered along the world's Y, in view space, where everything
// after the anchor (log depth, the view position lit materials and OIT read) picks it up.
const DROP_VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 skyCurveLocal = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  skyCurveLocal = batchingMatrix * skyCurveLocal;
  #endif
  #ifdef USE_INSTANCING
  skyCurveLocal = instanceMatrix * skyCurveLocal;
  #endif
  vec2 skyCurveXZ = (modelMatrix * skyCurveLocal).xz;
  mvPosition.xyz -= skyCurveDrop(skyCurveXZ) * viewMatrix[1].xyz;
  gl_Position = projectionMatrix * mvPosition;
}`;

/**
 * Lower what `material` draws with the Earth's curve, per vertex, exactly as the sky lowers
 * its sea and a stage's relief (`SkyMaterial.curveDrop` on the CPU): for what is long and
 * lies outside the field — a route to shore, a coastline — which `SkyAnchor`, placing
 * content rigidly about its middle, would leave floating off the curve from afar.
 * Nothing moves over the flat disc about the scene, nor without `curvedHorizon`.
 *
 * Any material three builds with `#include <project_vertex>` (every stock one): patches
 * its `onBeforeCompile`, after whatever it held, and binds the sky's uniforms by reference
 * so nothing is copied per frame. Returns the material.
 *
 * ⚠️ Not for content under a `SkyAnchor` or an occupant's `anchor`: it would drop twice.
 * Apply it after `makeOitCompatible`, so the depth OIT sorts by is the dropped one. GPU
 * picking draws with materials of its own, so picks the flat position. Assumes the default
 * `up` (+Y).
 *
 * @group Components
 */
export function applySkyCurve<T extends Material>(
  material: T,
  sky: SkyMaterial,
): T {
  const before = material.onBeforeCompile;
  // The key before patching: three's default is the hook's source, which is now this one
  // for every material patched, whatever each held before.
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    shader.uniforms.uSkyCurvature = sky.uniforms.uSkyCurvature;
    shader.uniforms.uSkyFlat = sky.uniforms.uSkyFlat;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${skyCurveShader}`)
      .replace('#include <project_vertex>', DROP_VERTEX);
  };
  material.customProgramCacheKey = () => `${key}|sky-curve`;
  material.needsUpdate = true;
  return material;
}

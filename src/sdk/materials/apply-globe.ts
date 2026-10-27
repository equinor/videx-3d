import type { Material } from 'three';
import type { Globe } from '../projection/globe';
import globeShader from './shaderLib/globe.glsl';

// After three's own: the vertex carried onto the globe from where it lies in the world —
// its X/Z the map point, its height along up over the sea's level — and projected again, so
// everything after the anchor (log depth, the view position lit materials and OIT read)
// picks it up.
const PLACE_VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 globeLocal = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  globeLocal = batchingMatrix * globeLocal;
  #endif
  #ifdef USE_INSTANCING
  globeLocal = instanceMatrix * globeLocal;
  #endif
  vec3 globeWorld = (modelMatrix * globeLocal).xyz;
  vec3 globePlaced = globePlace(globeWorld.xz, dot(globeWorld, uGlobeUp) - globeLevel());
  mvPosition = viewMatrix * vec4(globePlaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}`;

/**
 * Place what `material` draws on `globe`, per vertex: its world X/Z taken as the map point
 * and its height over the sea's level kept along up there (`Globe.place`), exactly as a
 * `SceneryStage`'s relief and the sky's sea lie on it. For what is long and lies beyond the
 * globe's flat disc — a route to shore, a coastline — which an anchor, placing content
 * rigidly about one point, would leave off the globe from afar. Nothing moves over the disc,
 * nor with the globe off; and nothing depends on the camera.
 *
 * Any material three builds with `#include <project_vertex>` (every stock one): patches
 * its `onBeforeCompile`, after whatever it held, and binds the globe's uniforms by
 * reference so nothing is copied per frame. Returns the material.
 *
 * ⚠️ Not for content under a `SceneryAnchor` or a stage occupant's `anchor`: it would be placed
 * twice. Apply it after `makeOitCompatible`, so the depth OIT sorts by is the placed one.
 * GPU picking draws with materials of its own, so picks the flat position. Normals are not
 * turned. Assumes the default `up` (+Y).
 *
 * @group Materials
 */
export function applyGlobe<T extends Material>(material: T, globe: Globe): T {
  const before = material.onBeforeCompile;
  // The key before patching: three's default is the hook's source, which is now this one
  // for every material patched, whatever each held before.
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, globe.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${globeShader}`)
      .replace('#include <project_vertex>', PLACE_VERTEX);
  };
  material.customProgramCacheKey = () => `${key}|globe`;
  material.needsUpdate = true;
  return material;
}

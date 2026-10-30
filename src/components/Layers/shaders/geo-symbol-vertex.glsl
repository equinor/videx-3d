// GeoSymbols' own material (geo-symbol-fragment.glsl): an instanced mesh (instanceMatrix,
// instanceColor) on the globe, its world position and height over the sea handed on for the
// water over it. Each symbol is widened here, never raised, to `uSymbolMinPixels` across on
// screen (0: as built), so its matrix is made only when it moves on the Earth.

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/tube-segment.glsl

uniform vec2 resolution;
uniform float uSymbolMinPixels;

varying vec3 vSymbolColor;
varying vec3 vSymbolNormal;
varying vec3 vSymbolUp;
varying vec3 vSymbolWorld;
varying float vSymbolHeight;
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#endif

void main() {
  mat4 placed = modelMatrix * instanceMatrix;
  // Across as built, and the least across on screen there: widened to it, not raised.
  float built = length(placed[0].xyz);
  float least = tubeMinWorldRadius(viewMatrix * placed[3], uSymbolMinPixels, resolution);
  float widen = built > 0.0 ? max(least / built, 1.0) : 1.0;
  vec3 local = vec3(position.x * widen, position.y, position.z * widen);
  vec3 localNormal = vec3(normal.x / widen, normal.y, normal.z / widen);
  vec4 world = placed * vec4(local, 1.0);
  // Widened, never raised: each vertex as high over the globe as built over the symbol's
  // foot, so a wide one follows the globe's curve rather than stand off it at its rim (from
  // 9000 km a 6 pixel disc is 60 km across, its rim 75 m over its foot's level). The water
  // over it is taken at that height too.
  float foot = globeAltitude(placed[3].xyz);
  float over = foot + position.y * length(placed[1].xyz);
  if(widen > 1.0)
    world.xyz += globeUpAt(world.xyz) * (over - globeAltitude(world.xyz));
  #ifdef USE_INSTANCING_COLOR
  vSymbolColor = instanceColor;
  #else
  vSymbolColor = vec3(1.0);
  #endif
  vSymbolNormal = normalize(mat3(placed) * localNormal);
  vSymbolUp = globeUpAt(world.xyz);
  vSymbolWorld = world.xyz;
  vSymbolHeight = over;
  vec4 view = viewMatrix * world;
  #ifdef USE_OIT
  vViewPosition = -view.xyz;
  #endif
  gl_Position = projectionMatrix * view;
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (as the tubes').
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}

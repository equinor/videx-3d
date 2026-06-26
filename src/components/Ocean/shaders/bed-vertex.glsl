// Ocean sea-bed vertex shader.
//
// Passes the world-space normal/position (for sun shading and the water tint)
// and the view position (for OIT depth + log-depth) through to the fragment.

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;

  #include <logdepthbuf_vertex>
}

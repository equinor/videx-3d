// Sky vertex shader: a clip-space fullscreen triangle.
//
// The view ray is rebuilt from the active camera, so the sky has no size, no
// depth range and no position - it works for the main camera, a jittered (TAA)
// projection and each face of a CubeCamera alike.

#include <fog_pars_vertex>

varying vec3 vSkyDirection;

void main() {
  // A point of NDC depth 0 on each corner's ray: at a fixed depth, view positions are affine
  // in NDC for a perspective projection, so the interpolated direction is exact. Not the far
  // plane: with one far enough from the near (a far plane of 50 000 km over a near one of
  // 0.1 m), -(f + n) / (f - n) rounds to -1 in 32-bit floats, its w to 0, and the ray flips.
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 0.0, 1.0);
  vSkyDirection = mat3(inverse(viewMatrix)) * (view.xyz / view.w);

  #ifdef USE_FOG
    // Far beyond any fog range, so the sky turns to the fog colour once fog has density.
    vFogDepth = 1e5;
  #endif

  #ifdef SKY_AT_FAR
  // On the far plane, so a depth test leaves it only where nothing nearer is drawn.
  gl_Position = vec4(position.xy, 1.0, 1.0);
  #else
  gl_Position = vec4(position.xy, 0.0, 1.0);
  #endif
}

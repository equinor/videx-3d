// Sky vertex shader: a clip-space fullscreen triangle.
//
// The view ray is rebuilt from the active camera, so the sky has no size, no
// depth range and no position - it works for the main camera, a jittered (TAA)
// projection and each face of a CubeCamera alike.

#include <fog_pars_vertex>
#include ../../../sdk/materials/shaderLib/depth.glsl

varying vec3 vSceneryDirection;
#ifdef SCENERY_INSIDE_FAR
// How far inside the far plane, in window depth: one step of the depth buffer drawn into.
uniform float uSceneryInsideFar;
#endif

void main() {
  // A point of NDC depth 0 on each corner's ray: at a fixed depth, view positions are affine
  // in NDC for a perspective projection, so the interpolated direction is exact. Not the far
  // plane: with one far enough from the near (a far plane of 50 000 km over a near one of
  // 0.1 m), -(f + n) / (f - n) rounds to -1 in 32-bit floats, its w to 0, and the ray flips.
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 0.0, 1.0);
  vSceneryDirection = mat3(inverse(viewMatrix)) * (view.xyz / view.w);

  #ifdef USE_FOG
    // Far beyond any fog range, so the sky turns to the fog colour once fog has density.
    vFogDepth = 1e5;
  #endif

  #if defined(SCENERY_INSIDE_FAR)
  // Just inside the far plane (depthInsideFarNdc): drawn before the layers on it, writing its
  // depth, it leaves them only where it is not drawn.
  gl_Position = vec4(position.xy, depthInsideFarNdc(uSceneryInsideFar), 1.0);
  #elif defined(SCENERY_AT_FAR)
  // On the far plane, so a depth test leaves it only where nothing nearer is drawn: z = w, or
  // z = 0 with a reversed depth buffer.
  gl_Position = vec4(position.xy, DEPTH_FAR_NDC, 1.0);
  #else
  gl_Position = vec4(position.xy, 0.0, 1.0);
  #endif
}

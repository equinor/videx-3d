// The standard pick fragment shader (`EventEmitter/shaders/pick_frag.glsl`) behind the
// same cut tests `chunk-frag.glsl` makes, so geometry that is cut away is not picked.

uniform int side;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

#ifdef CHUNK_SECTION
varying float vSectionDist;
#endif

#ifdef CHUNK_FENCE
uniform vec2 fenceParams;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;   // object XZ -> uv
uniform vec2 fenceSize;   // grid size in texels
varying vec3 vObjectPos;
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif

#ifdef CHUNK_FENCE_OVERLAY_ONLY
uniform vec4 overlayRect;
uniform vec4 overlayParams;
varying float vFenceAlong;
#ifndef CHUNK_FENCE
varying vec3 vObjectPos;
#endif
#endif

void main() {
  #ifdef CHUNK_SECTION
  if (vSectionDist > 0.0) discard;
  #endif

  #ifdef CHUNK_FENCE
  if (fenceParams.x > 0.5) {
    float fenceAt = fenceSide(fenceMap, fenceToUv, fenceSize, vObjectPos.xz);
    if (fenceParams.y * fenceAt < 0.0) discard;
  }
  #endif

  // Same test as `chunk-frag.glsl`: nothing is there where the overlay has no data.
  #ifdef CHUNK_FENCE_OVERLAY_ONLY
  {
    vec2 at = vec2(
      (vFenceAlong - overlayRect.x) / (overlayRect.y - overlayRect.x),
      (vObjectPos.y - overlayRect.z) / (overlayRect.w - overlayRect.z)
    );
    bool inside = at.x >= 0.0 && at.x <= 1.0 && at.y >= 0.0 && at.y <= 1.0;
    if (!(overlayParams.z > 0.0 && inside)) discard;
  }
  #endif

  if(side == 1 && gl_FrontFacing || side == 0 && !gl_FrontFacing) {
    discard;
  }
  gl_FragColor = vec4(vEmitterId, vWorldPosition);
}

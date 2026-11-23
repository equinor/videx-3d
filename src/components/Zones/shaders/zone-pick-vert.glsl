#define PICK_MATERIAL

// The standard pick vertex shader (`EventEmitter/shaders/pick_vertex.glsl`) plus the
// cut varyings `zone-vert.glsl` computes, so a zone is picked with its cut applied.

uniform float emitterId;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

attribute vec2 xz;
attribute float y;

#ifdef ZONE_SECTION
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#if defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY_ONLY) || defined(ZONE_HEIGHT_CLIP)
varying vec3 vObjectPos;
#endif

#ifdef ZONE_FENCE_OVERLAY_ONLY
varying float vFenceAlong;
#endif

#include <common>
#include <uv_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>

  vec3 transformed = position + vec3(xz.x, y, xz.y);
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vec4 worldPosition = vec4(transformed, 1.0);

	#ifdef USE_BATCHING

  worldPosition = batchingMatrix * worldPosition;

	#endif

	#ifdef USE_INSTANCING

  worldPosition = instanceMatrix * worldPosition;

  #endif

  vWorldPosition = (modelMatrix * worldPosition).xyz;

  vEmitterId = emitterId + float(gl_InstanceID);

  #ifdef ZONE_SECTION
  vSectionDist = dot(sectionPlane.xyz, transformed) + sectionPlane.w;
  #endif

  #if defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY_ONLY) || defined(ZONE_HEIGHT_CLIP)
  vObjectPos = transformed;
  #endif

  #ifdef ZONE_FENCE_OVERLAY_ONLY
  vFenceAlong = uv.x;
  #endif
}

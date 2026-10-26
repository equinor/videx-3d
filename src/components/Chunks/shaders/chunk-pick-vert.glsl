#define PICK_MATERIAL

// The standard pick vertex shader (`EventEmitter/shaders/pick_vertex.glsl`) plus the
// cut varyings `chunk-vert.glsl` computes, so a chunk is picked with its cut applied.

uniform float emitterId;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

attribute vec2 xz;
attribute float y;

#ifdef CHUNK_SECTION
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#if defined(CHUNK_FENCE) || defined(CHUNK_FENCE_OVERLAY_ONLY) || defined(CHUNK_HEIGHT_CLIP)
varying vec3 vObjectPos;
#endif

#ifdef CHUNK_FENCE_OVERLAY_ONLY
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

  #ifdef CHUNK_SECTION
  vSectionDist = dot(sectionPlane.xyz, transformed) + sectionPlane.w;
  #endif

  #if defined(CHUNK_FENCE) || defined(CHUNK_FENCE_OVERLAY_ONLY) || defined(CHUNK_HEIGHT_CLIP)
  vObjectPos = transformed;
  #endif

  #ifdef CHUNK_FENCE_OVERLAY_ONLY
  vFenceAlong = uv.x;
  #endif
}

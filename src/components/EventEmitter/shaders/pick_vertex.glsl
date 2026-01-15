#define PICK_MATERIAL

uniform float emitterId;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

#include <common>
#include <uv_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>

	#include <begin_vertex>
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
}
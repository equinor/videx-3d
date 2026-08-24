#define PICK_MATERIAL

uniform float emitterId;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

// Split cap layout (see ChunkMaterial): caps carry a shared xz + per-layer y and no
// position. The absent attribute defaults to 0 (see PickingMaterial), so this
// resolves position-based objects and split caps alike.
attribute vec2 xz;
attribute float y;

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
}

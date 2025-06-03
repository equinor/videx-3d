#define RIBBON_MATERIAL

uniform float angle;
uniform float width;
uniform float offset;

attribute vec3 tangent;
attribute vec3 binormal;

varying vec3 vViewPosition;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

mat4 rotation3d(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat4(
    oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
    oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
    oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
    0.0,                                0.0,                                0.0,                                1.0
  );
}

void main() {

	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>

  mat4 rotation = rotation3d(tangent, angle);

  vec3 direction = (rotation * vec4(binormal, 0.0)).xyz;

  vec4 worldPosition = (modelMatrix * vec4(position, 1.0));
  
  float dist = width;
  
  dist = dist + (uv.x > 0.5 ? -offset : offset);

  worldPosition.xyz = worldPosition.xyz + dist * direction;

	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>

  vec3 objectNormal =(rotation * vec4(normal, 1.0)).xyz;

	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>

	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

	vViewPosition = - mvPosition.xyz;

	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>

  vUv = uv;
  
}

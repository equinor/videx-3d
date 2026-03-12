#define SEISMIC_MATERIAL

varying vec3 vViewPosition;
varying vec2 vUv;

#include <common>
#include <fog_pars_vertex>
#include <normal_pars_fragment>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>

	#include <begin_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;
  vUv = uv;
	#include <worldpos_vertex>
	#include <fog_vertex>
}
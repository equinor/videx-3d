#define MESH_SURFACE_MATERIAL

uniform mat3 gridUvMat;

varying vec3 vViewPosition;
varying vec2 vGridUv;

// Where the geometry is not fully described by the grid (a chunk cap, whose
// heights have been resampled, hole-filled and sealed), the mesh itself carries
// what the elevation texture cannot. ⚠️ `nodata` rather than `covered`: an
// attribute the geometry does not have reads as 0, which must mean "grid is fine".
#ifdef USE_GEOMETRY_FALLBACK
attribute float nodata;
varying float vNodata;
varying float vGeoDepth;
varying vec3 vGeoNormal;
#endif

#include <common>
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

void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>

	#include <beginnormal_vertex>
  #include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;
  vGridUv = (gridUvMat * vec3(uv, 1.0)).xy;

  #ifdef USE_GEOMETRY_FALLBACK
  vNodata = nodata;
  // Depth is positive-down while scene Y is not, and the grid encodes
  // `value = referenceDepth - depth`, so the two agree at `depth = -y`.
  vGeoDepth = -transformed.y;
  vGeoNormal = normalize(transformedNormal);
  #endif

	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}
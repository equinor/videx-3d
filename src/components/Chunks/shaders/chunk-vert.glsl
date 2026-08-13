#define PHONG
#define CHUNK_MATERIAL

varying vec3 vViewPosition;

#ifdef CHUNK_DETAIL
// World position drives the procedural detail, so the pattern is anchored in the
// scene rather than in each surface's own UV space (that is what removes the
// per-surface repeat/scale problem), and so a cap and the wall below it carry the
// same pattern at the same scale across their shared edge. It is the WORLD position
// deliberately: under a vertical exaggeration (`scale={[1,k,1]}` on the stack) the
// pattern then stays square on screen instead of being stretched with the geometry.
varying vec3 vWorldPosition;

#ifdef CHUNK_WALL
// Unit-relative height, 1 on the wall's top edge and 0 on its base (see
// `buildRingWalls`). Lets bedding follow the unit rather than absolute depth.
attribute float wallV;
varying float vWallV;
#endif
#endif

#ifdef CHUNK_WATER_TINT
uniform vec3 waterTintParams; // x: water level, y: strength, z: 1 / depth scale
// How far this vertex lies below the water level, in metres. Taken from the
// OBJECT position, not the world one: the stack can carry a vertical
// exaggeration, which would rescale a world-space depth away from metres.
varying float vWaterDepth;
#endif

#ifdef CHUNK_SECTION
// xyz: plane normal, pointing at the half-space that is cut away; w: constant.
// ⚠️ OBJECT space, not world: the CPU builds the cut face from the chunk's own
// vertex data, so testing anywhere else would let the two disagree under a
// vertical exaggeration. Three.js' own clipping planes are unusable here for a
// different reason — `Material.copy` deep-clones a `Plane`, so the four OIT pass
// variants would each snapshot it and a moving plane would freeze.
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#include <common>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <shadowmap_pars_vertex>
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

  #ifdef CHUNK_DETAIL
  vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #ifdef CHUNK_WALL
  vWallV = wallV;
  #endif
  #endif

  #ifdef CHUNK_WATER_TINT
  vWaterDepth = waterTintParams.x - transformed.y;
  #endif

  #ifdef CHUNK_SECTION
  vSectionDist = dot(sectionPlane.xyz, transformed) + sectionPlane.w;
  #endif

  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}

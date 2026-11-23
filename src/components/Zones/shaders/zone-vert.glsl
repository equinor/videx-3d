#define PHONG
#define ZONE_MATERIAL

varying vec3 vViewPosition;

#ifdef SURFACE_DETAIL
// World position drives the procedural detail, so the pattern is anchored in the
// scene rather than in each surface's own UV space (that is what removes the
// per-surface repeat/scale problem), and so a cap and the wall below it carry the
// same pattern at the same scale across their shared edge. It is the WORLD position
// deliberately: under a vertical exaggeration (`scale={[1,k,1]}` on the stack) the
// pattern then stays square on screen instead of being stretched with the geometry.
varying vec3 vWorldPosition;
#endif

#ifdef SURFACE_DETAIL
#ifdef ZONE_WALL
// Unit-relative height, 1 on the wall's top edge and 0 on its base (see
// `buildRingWalls`). Lets bedding follow the unit rather than absolute depth.
attribute float wallV;
varying float vWallV;
#endif
#endif

#ifdef ZONE_WATER_TINT
uniform vec3 waterTintParams; // x: water level, y: strength, z: 1 / depth scale
// How far this vertex lies below the water level, in metres. Taken from the
// OBJECT position, not the world one: the stack can carry a vertical
// exaggeration, which would rescale a world-space depth away from metres.
varying float vWaterDepth;
#endif

#ifdef ZONE_SECTION
// xyz: plane normal, pointing at the half-space that is cut away; w: constant.
// ⚠️ OBJECT space, not world: the CPU builds the cut face from the zone's own
// vertex data, so testing anywhere else would let the two disagree under a
// vertical exaggeration. Three.js' own clipping planes are unusable here for a
// different reason — `Material.copy` deep-clones a `Plane`, so the four OIT pass
// variants would each snapshot it and a moving plane would freeze.
uniform vec4 sectionPlane;
varying float vSectionDist;
#endif

#if defined(ZONE_CONTACTS) || defined(ZONE_BATHYMETRY) || defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY) || defined(ZONE_TILE_DEBUG) || defined(ZONE_TILE_LEVELS) || defined(ZONE_HEIGHT_CLIP) || defined(ZONE_WATER_SECTION) || defined(ZONE_WATER_FENCE)
// OBJECT space for the same reason the water tint's depth is: a depth grid is in
// metres, and a vertical exaggeration would rescale a world-space height away from
// them. XZ locates the texture, Y is what a contact line is drawn against.
varying vec3 vObjectPos;
#endif

#ifdef ZONE_FENCE_OVERLAY
// Metres along the fence curve: a fence face's `uv.x` (see `buildFenceRibbons`).
varying float vFenceAlong;
#endif

#ifdef ZONE_NORMAL_MAP
uniform mat3 capNormalToUv; // object XZ -> uv
varying vec2 vCapNormalUv;
#endif

// Split cap layout: a cap carries a SHARED xz + per-layer y instead of a full
// position (walls and cut faces keep position). Both resolve below — the absent
// attribute defaults to 0 (see `ZoneMaterial.defaultAttributeValues`), so a cap is
// `xz + y` and a wall is `position`, with no separate shader variant.
attribute vec2 xz;
attribute float y;

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

  vec3 transformed = position + vec3(xz.x, y, xz.y);
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;

  #ifdef ZONE_NORMAL_MAP
  vCapNormalUv = (capNormalToUv * vec3(transformed.xz, 1.0)).xy;
  #endif

  #ifdef SURFACE_DETAIL
  vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #ifdef ZONE_WALL
  vWallV = wallV;
  #endif
  #endif

  #ifdef ZONE_WATER_TINT
  vWaterDepth = waterTintParams.x - transformed.y;
  #endif

  #ifdef ZONE_SECTION
  vSectionDist = dot(sectionPlane.xyz, transformed) + sectionPlane.w;
  #endif

  #if defined(ZONE_CONTACTS) || defined(ZONE_BATHYMETRY) || defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY) || defined(ZONE_TILE_DEBUG) || defined(ZONE_TILE_LEVELS) || defined(ZONE_HEIGHT_CLIP) || defined(ZONE_WATER_SECTION) || defined(ZONE_WATER_FENCE)
  vObjectPos = transformed;
  #endif

  #ifdef ZONE_FENCE_OVERLAY
  vFenceAlong = uv.x;
  #endif

  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}

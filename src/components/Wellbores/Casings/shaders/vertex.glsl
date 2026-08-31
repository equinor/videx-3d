#define CASING_STANDARD

uniform float sizeMultiplier;
uniform float innerRadius;
uniform float sliceOffset;
uniform float sliceAngle;
uniform bool autoSlicePosition;
uniform float mapUvWorld; // 0 = normalized UVs for the base map group, 1 = world distance
uniform float normalMapUvWorld; // 0 = normalized UVs for normal/bump maps, 1 = world distance
uniform float wellLength; // real-world trajectory length (metres), for world-scaled V

attribute vec3 vertex;
attribute float id;
attribute vec3 positionA;
attribute vec3 positionB;
attribute vec3 tangentA;
attribute vec3 tangentB;
attribute vec2 curvePositionA;
attribute vec2 curvePositionB;
attribute float outerRadiusA;
attribute float outerRadiusB;

varying vec3 vViewPosition;
varying float vWall;
varying float vCurvePos;
varying float vSectionPos;
varying float vSectionLength;
varying float vFragRadius;
varying vec3 vWorldPos; // world-space position, for world-stable seamless weathering
// World-space radial direction (points from the tube axis outward through this
// vertex), used for light-direction-dependent shading. Deliberately built from a
// FIXED reference vector rather than the camera-relative one below, so it stays
// physically fixed in world space even when autoSlicePosition rotates the visible
// slice to face the camera every frame.
varying vec3 vWorldRadial;
// World-space well axis (curve tangent), used to project the light into the tube's
// cross-section plane for the directional cast shadow.
varying vec3 vWorldAxis;
// World-space ACTUAL displayed radial (built from k, the real surface radial the
// geometry uses). Unlike vWorldRadial it follows the camera-relative slice when
// autoSlicePosition is on, so it matches where the fragment is actually drawn - used
// for the world-pinned brushed rails (identical to vWorldRadial when autoSlice is off).
varying vec3 vWorldRadialDisplay;
varying vec2 vWorldUv; // world-scaled (object-distance) UV, drives the procedural micro-normal

#include <common>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

mat4 rotation3d(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0, oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0, oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec3 cameraPositionLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;

  vec3 objectNormal = normal;

  vec3 segmentPosition = mix(positionA, positionB, vertex.y);
  vec3 segmentTangent = mix(tangentA, tangentB, vertex.y);
  vec2 segementCurvePosition = mix(curvePositionA, curvePositionB, vertex.y);
  float segmentRadius = sizeMultiplier * mix(innerRadius, mix(outerRadiusA, outerRadiusB, vertex.y), vertex.z);

  vec3 planeNormal = normalize(segmentTangent.xyz);
  vec3 slicePositionVector = autoSlicePosition ? segmentPosition.xyz - cameraPositionLocal : vec3(0.0, 0.0, 1.0);

  float offsetAngle = (0.5 - vertex.x) * (2. * PI - sliceAngle) + sliceOffset;

  if(vertex.z == 1.0 && id == 0.0) {
    float segmentLength = length(positionA - positionB);
    float deltaRadius = (outerRadiusB - outerRadiusA) * sizeMultiplier;
    float normalOffsetAngle = atan(deltaRadius, segmentLength);
    mat4 m = rotation3d(vec3(-1.0, 0.0, 0.0), normalOffsetAngle);
    objectNormal = normalize((m * vec4(objectNormal, 0.0)).xyz);
  }

  mat4 rotMat = rotation3d(segmentTangent, offsetAngle);

  float a = dot(slicePositionVector, planeNormal);
  vec3 directionalPoint = normalize(slicePositionVector.xyz - vec3(a * planeNormal.x, a * planeNormal.y, a * planeNormal.z));

  // Identical construction to directionalPoint/k above, but always anchored to the
  // fixed vec3(0,0,1) reference (never the camera-relative one autoSlicePosition
  // swaps in), giving a stable world-space radial for shading. When autoSlicePosition
  // is false this is exactly k, so behaviour is unchanged in the common case.
  float shadingA = dot(vec3(0.0, 0.0, 1.0), planeNormal);
  vec3 shadingDirectionalPoint = normalize(vec3(0.0, 0.0, 1.0) - vec3(shadingA * planeNormal.x, shadingA * planeNormal.y, shadingA * planeNormal.z));
  vec3 shadingK = normalize((rotMat * vec4(shadingDirectionalPoint, 1.0)).xyz);
  vWorldRadial = normalize(mat3(modelMatrix) * shadingK);
  vWorldAxis = normalize(mat3(modelMatrix) * segmentTangent);

  vec3 k = normalize((rotMat * vec4(directionalPoint, 1.0)).xyz);
  vWorldRadialDisplay = normalize(mat3(modelMatrix) * k);
  vec3 j = segmentTangent;
  vec3 i = normalize(cross(j, k));

  mat3 transformationMatrix = inverse(mat3(i, j, k));

  vWall = vertex.z;
  vCurvePos = segementCurvePosition.y;
  vSectionPos = segementCurvePosition.x;
  // Physical length of THIS section in metres. Within a segment the section-relative
  // coord (curvePosition.x) and the whole-well coord (curvePosition.y) are both linear
  // in curve position, so their ratio is the section's whole-well fraction; times the
  // well length gives metres. Lets the fragment shader draw an edge-shading band of a
  // fixed world distance regardless of how long the section is.
  vSectionLength = wellLength * abs(curvePositionB.y - curvePositionA.y) / max(abs(curvePositionB.x - curvePositionA.x), 1e-6);
  vFragRadius = segmentRadius;

  // Procedural UVs, two sets so each texture type can pick its units (mapUvWorld /
  // normalMapUvWorld): *Norm is a normalized 0..1 tiling coord (mesh-fixed, stable under
  // autoSlicePosition); *World is object-space DISTANCE units so a texture's repeat becomes
  // a density consistent across sections of different radius/length. Per face:
  //   walls -> U = azimuth (world: arc length; norm: vertex.x), V = along-trajectory distance
  //   caps  -> Cartesian cross-section position (no polar swirl / no centre singularity)
  //   edges -> U = radial thickness, V = along-trajectory distance
  // The azimuth is world-pinned via casingAz below (rotates with the slice under
  // autoSlicePosition) yet stays continuous across the arc - see the casingAz comment.
  // World-pinned azimuth = the parametric mesh azimuth (offsetAngle) + the autoslice TURN:
  // the signed angle the camera-facing directionalPoint has rotated from the fixed
  // (0,0,1)-based reference (shadingDirectionalPoint), measured around the tangent. This
  // pins the pattern to WORLD azimuth (it rotates with the slice under autoSlicePosition)
  // while staying a CONTINUOUS coordinate across the arc: offsetAngle is linear across the
  // arc and the turn is a single per-cross-section scalar, so there is NO azimuthal atan2
  // branch-cut fan (the previous approach interpolated a per-vertex atan2 of the surface
  // radial, whose +-PI wrap fanned across the straddling triangles). Any residual wrap sits
  // at the parametric seam (offsetAngle at the slice gap) = the removed wedge = hidden.
  // When autoSlicePosition is off, directionalPoint == shadingDirectionalPoint so the turn
  // is exactly 0 -> casingAz == -offsetAngle (the clean, verified-good case).
  float sliceTurn = atan(dot(cross(shadingDirectionalPoint, directionalPoint), planeNormal), dot(shadingDirectionalPoint, directionalPoint));
  float casingAz = -offsetAngle + sliceTurn;
  float casingAxial = vCurvePos * wellLength;
  vec2 casingUvNorm;
  vec2 casingUvWorld;
  if(id < 2.0) {
    casingUvNorm = vec2(vertex.x, vCurvePos);
    casingUvWorld = vec2(casingAz * vFragRadius, casingAxial);
  } else if(id < 4.0) {
    // Cap (flat annular face): CARTESIAN cross-section position, no polar swirl. WORLD uses
    // (cos, sin) of casingAz (world-pinned -> rotates under autoSlice, consistent with the
    // walls' world U). NORMALIZED uses the PARAMETRIC angle (offsetAngle) so it stays a
    // stable, mesh-fixed tiling coord. The radial magnitude uses the REAL radius fraction
    // (vFragRadius / outerRadius), inner/outer..1 and never 0, so the inner edge does NOT
    // collapse to the UV centre (that collapse made every azimuth meet at (0.5,0.5) -> the
    // coloured pinwheel/singularity).
    vec2 capParam = vec2(cos(offsetAngle), sin(offsetAngle));
    vec2 capWorldDir = vec2(cos(casingAz), sin(casingAz));
    float capOuterR = sizeMultiplier * mix(outerRadiusA, outerRadiusB, vertex.y);
    float capRNorm = vFragRadius / max(capOuterR, 1e-4);
    casingUvNorm = capParam * capRNorm * 0.5 + 0.5;
    casingUvWorld = capWorldDir * vFragRadius;
  } else {
    casingUvNorm = vec2(vertex.z, vertex.y);
    casingUvWorld = vec2(vFragRadius, casingAxial);
  }
  vec2 casingMapUv = mapUvWorld > 0.5 ? casingUvWorld : casingUvNorm;
  vec2 casingNormalUv = normalMapUvWorld > 0.5 ? casingUvWorld : casingUvNorm;
  vWorldUv = casingUvWorld;
  #if defined( USE_UV ) || defined( USE_ANISOTROPY )
  vUv = casingMapUv;
  #endif
  #ifdef USE_MAP
  vMapUv = (mapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_ALPHAMAP
  vAlphaMapUv = (alphaMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_LIGHTMAP
  vLightMapUv = (lightMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_AOMAP
  vAoMapUv = (aoMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_BUMPMAP
  vBumpMapUv = (bumpMapTransform * vec3(casingNormalUv, 1.0)).xy;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = (normalMapTransform * vec3(casingNormalUv, 1.0)).xy;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = (emissiveMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_METALNESSMAP
  vMetalnessMapUv = (metalnessMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = (roughnessMapTransform * vec3(casingMapUv, 1.0)).xy;
  #endif

	#include <color_vertex>

  objectNormal = normalize(objectNormal * transformationMatrix);

	#include <defaultnormal_vertex>
	#include <normal_vertex>

  vec3 transformed = segmentPosition.xyz + k * segmentRadius;
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;

	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;

	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}
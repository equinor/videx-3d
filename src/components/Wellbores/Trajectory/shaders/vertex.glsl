#define TRAJECTORY_MATERIAL

uniform float sizeMultiplier;
uniform float radius;
uniform float minPixelRadius;
uniform vec2 resolution;

// Texture-map UV controls (only used when USE_MAP is defined).
uniform bool uvWorld;     // false = normalized UV, true = world units (metres)
uniform float wellLength; // full measured length of the wellbore in metres
uniform float measuredTop; // measured depth (MSL) at the top of the trajectory (metres)

attribute vec3 vertex;
attribute float capSign;
attribute vec3 positionA;
attribute vec3 positionB;
attribute vec3 tangentA;
attribute vec3 tangentB;
attribute vec3 normalA;
attribute vec3 normalB;
attribute vec2 curvePositionA;
attribute vec2 curvePositionB;

varying vec3 vViewPosition;
// Measured depth (MSL) in metres at this vertex. Always emitted (not gated on USE_MAP)
// so procedural depth patterns (e.g. depth-marker bands) work without a texture.
varying float vAxial;

#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
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
  vec3 segmentPosition = mix(positionA, positionB, vertex.y);
  vec3 segmentTangent = normalize(mix(tangentA, tangentB, vertex.y));

  // Build the ring basis from the STABLE (rotation-minimizing) frame normal supplied
  // by the generator, rotated around the tangent. Using the frame normal instead of a
  // fixed world axis avoids the ring collapsing/twisting into a "ribbon" where the
  // tangent aligns with that axis (near-horizontal sections). k is the outward radial
  // direction for this vertex and doubles as the surface normal.
  float offsetAngle = (0.5 - vertex.x) * 2.0 * PI;
  vec3 directionalPoint = normalize(mix(normalA, normalB, vertex.y));
  mat4 rotMat = rotation3d(segmentTangent, offsetAngle);
  vec3 k = normalize((rotMat * vec4(directionalPoint, 1.0)).xyz);

  // End caps (capSign = -1 start / +1 end) face along the segment tangent; the tube
  // wall (capSign = 0) faces radially outward along k.
  vec3 objectNormal = abs(capSign) > 0.5 ? normalize(segmentTangent) * capSign : k;

  // Procedural map UV (the geometry carries no `uv` attribute, so the stock
  // <uv_vertex> is replaced).
  //   WALL: U wraps around the tube, V runs along the curve.
  //     'normalized' = azimuth 0..1 x global curve position 0..1 (texture fits the well).
  //     'world'      = circumference metres x measured-depth metres, so map.repeat sets a
  //                    world-consistent texel density independent of tube length/radius
  //                    (the true world radius is used, not the minPixelRadius floor).
  //   CAP: Cartesian cross-section position (mirrors the casing caps), so the texture maps
  //     ACROSS the disc instead of smearing a single texel row around the rim (every rim
  //     vertex shares the same along-curve V). vertex.z is the radial fraction (0 = centre
  //     on the axis, 1 = rim). The azimuth uses capAz = -offsetAngle to match the casing
  //     `casingAz` convention (trajectories have no camera-facing slice, so world and
  //     parametric azimuth coincide) — this keeps the cap's azimuthal direction consistent
  //     with the wall U and with the casings.
  //     'normalized' = the unit disc fitted into 0..1 (centre -> 0.5,0.5).
  //     'world'      = Cartesian metres from the axis (matches the wall's world density).

  // Along-curve parameter (0..1 global) and the absolute measured depth (MSL) in metres,
  // computed unconditionally so both the world-UV V axis and the depth-marker pattern can
  // reuse them.
  float uvAlong = mix(curvePositionA.y, curvePositionB.y, vertex.y);
  vAxial = measuredTop + uvAlong * wellLength;

  #ifdef USE_MAP
  vec2 uvBase;
  if(abs(capSign) > 0.5) {
    float capAz = -offsetAngle;
    vec2 capDir = vec2(cos(capAz), sin(capAz));
    if(uvWorld) {
      uvBase = capDir * (vertex.z * radius * sizeMultiplier);
    } else {
      uvBase = capDir * vertex.z * 0.5 + 0.5;
    }
  } else if(uvWorld) {
    float circumference = 2.0 * PI * radius * sizeMultiplier;
    uvBase = vec2(vertex.x * circumference, uvAlong * wellLength);
  } else {
    uvBase = vec2(vertex.x, uvAlong);
  }
  vMapUv = (mapTransform * vec3(uvBase, 1.0)).xy;
  #endif
  #include <color_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>

  // Screen-space minimum radius. Convert the desired pixel radius into the world-space
  // radius that projects to that many pixels at the axis point's depth. Works for both
  // perspective (clip.w = -viewZ) and orthographic (clip.w = 1) projections.
  vec4 mvAxis = modelViewMatrix * vec4(segmentPosition, 1.0);
  vec4 clipAxis = projectionMatrix * mvAxis;
  float ndcPerPixel = 2.0 / resolution.y;
  float minWorldRadius = (minPixelRadius * ndcPerPixel) * clipAxis.w / projectionMatrix[1][1];
  float effectiveRadius = max(radius * sizeMultiplier, minWorldRadius);

  // vertex.z is the radial scale: 1 along the tube wall / at a cap rim, 0 at a cap
  // centre (which sits exactly on the centreline).
  vec3 transformed = segmentPosition + k * (effectiveRadius * vertex.z);

  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;

  #include <worldpos_vertex>
  #include <fog_vertex>
}

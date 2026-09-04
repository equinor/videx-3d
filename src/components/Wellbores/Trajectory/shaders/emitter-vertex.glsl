#define TRAJECTORY_EMITTER

uniform float emitterId;

uniform float sizeMultiplier;
uniform float radius;
uniform float minPixelRadius;
uniform vec2 resolution;

attribute vec3 vertex;
attribute vec3 positionA;
attribute vec3 positionB;
attribute vec3 tangentA;
attribute vec3 tangentB;
attribute vec3 normalA;
attribute vec3 normalB;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

mat4 rotation3d(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0, oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0, oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0, 0.0, 0.0, 0.0, 1.0);
}

// Mirrors the visual vertex shader's tube/caps reconstruction so the picking
// silhouette matches exactly what is drawn — including the screen-space minimum
// radius floor (see TrajectoryEmitterMaterial: `resolution` is set to the pick
// render-target size so the floor resolves to the same world radius as on screen).
void main() {
  vec3 segmentPosition = mix(positionA, positionB, vertex.y);
  vec3 segmentTangent = normalize(mix(tangentA, tangentB, vertex.y));

  float offsetAngle = (0.5 - vertex.x) * 2.0 * PI;
  vec3 directionalPoint = normalize(mix(normalA, normalB, vertex.y));
  mat4 rotMat = rotation3d(segmentTangent, offsetAngle);
  vec3 k = normalize((rotMat * vec4(directionalPoint, 1.0)).xyz);

  vec4 mvAxis = modelViewMatrix * vec4(segmentPosition, 1.0);
  vec4 clipAxis = projectionMatrix * mvAxis;
  float ndcPerPixel = 2.0 / resolution.y;
  float minWorldRadius = (minPixelRadius * ndcPerPixel) * clipAxis.w / projectionMatrix[1][1];
  float effectiveRadius = max(radius * sizeMultiplier, minWorldRadius);

  vec3 transformed = segmentPosition + k * (effectiveRadius * vertex.z);

  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vec4 worldPosition = vec4(transformed, 1.0);
  vWorldPosition = (modelMatrix * worldPosition).xyz;
  vEmitterId = emitterId;
}

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
#include ../../../../sdk/materials/shaderLib/tube-segment.glsl

// Mirrors the visual vertex shader's tube/caps reconstruction so the picking
// silhouette matches exactly what is drawn — including the screen-space minimum
// radius floor (see TrajectoryEmitterMaterial: `resolution` is set to the pick
// render-target size so the floor resolves to the same world radius as on screen).
void main() {
  vec3 segmentPosition = mix(positionA, positionB, vertex.y);
  vec3 segmentTangent = normalize(mix(tangentA, tangentB, vertex.y));

  vec3 directionalPoint = normalize(mix(normalA, normalB, vertex.y));
  vec3 k = tubeRingDirection(directionalPoint, segmentTangent, tubeRingAngle(vertex.x));

  vec4 mvAxis = modelViewMatrix * vec4(segmentPosition, 1.0);
  float minWorldRadius = tubeMinWorldRadius(mvAxis, minPixelRadius, resolution);
  float effectiveRadius = max(radius * sizeMultiplier, minWorldRadius);

  vec3 transformed = segmentPosition + k * (effectiveRadius * vertex.z);

  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vec4 worldPosition = vec4(transformed, 1.0);
  vWorldPosition = (modelMatrix * worldPosition).xyz;
  vEmitterId = emitterId;
}

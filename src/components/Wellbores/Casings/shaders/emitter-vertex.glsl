#define CASING_EMITTER

uniform float emitterId;

uniform float sizeMultiplier;
uniform float innerRadius;
uniform float sliceOffset;
uniform float sliceAngle;
uniform bool autoSlicePosition;

attribute vec3 vertex;
attribute float id;
attribute vec3 positionA;
attribute vec3 positionB;
attribute vec3 tangentA;
attribute vec3 tangentB;
attribute float outerRadiusA;
attribute float outerRadiusB;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

#include <common>
#include <uv_pars_vertex>
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

  vec3 k = normalize((rotMat * vec4(directionalPoint, 1.0)).xyz);

  vec3 transformed = segmentPosition.xyz + k * segmentRadius;

  #ifdef USE_ALPHAHASH

  vPosition = vec3(transformed);

  #endif

	#include <project_vertex> 
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vec4 worldPosition = vec4(transformed, 1.0);

  vWorldPosition = (modelMatrix * worldPosition).xyz;
  vEmitterId = emitterId;
}
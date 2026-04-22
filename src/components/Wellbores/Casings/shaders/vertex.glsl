#define STANDARD

uniform float sizeMultiplier;
uniform float radius;
uniform float innerRadius;
uniform float sliceOffset;
uniform float sliceAngle;
uniform bool autoSlicePosition;

attribute vec3 vertex;
attribute float id;
attribute vec3 color;
attribute vec3 positionA;
attribute vec3 positionB;
attribute vec3 normalA;
attribute vec3 normalB;
attribute vec3 tangentA;
attribute vec3 tangentB;
attribute vec2 curvePositionA;
attribute vec2 curvePositionB;
attribute float outerRadiusA;
attribute float outerRadiusB;

varying vec3 vViewPosition;

#ifdef USE_TRANSMISSION

varying vec2 vUv;
varying vec3 vWorldPosition;

#endif

#include <common>
//#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
//#include <morphtarget_pars_vertex>
//#include <skinning_pars_vertex>
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
  vec3 segmentNormal = mix(normalA, normalB, vertex.y);
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

  float uvOffset = sliceAngle / (4.0 * PI);
  vec2 transformedUv = uv.xy;
  if(id <= 3.0) {
    transformedUv.x = mix(uvOffset, 1.0 - uvOffset, uv.x);
  }
  if(id <= 1.0 || id >= 4.0) {
    transformedUv.y = segementCurvePosition.x;
  }

  mat4 rotMat = rotation3d(segmentTangent, offsetAngle);

  float a = dot(slicePositionVector, planeNormal);
  vec3 directionalPoint = normalize(slicePositionVector.xyz - vec3(a * planeNormal.x, a * planeNormal.y, a * planeNormal.z));

  vec3 k = normalize((rotMat * vec4(directionalPoint, 1.0)).xyz);
  vec3 j = segmentTangent;
  vec3 i = normalize(cross(j, k));

  mat3 transformationMatrix = inverse(mat3(i, j, k));

  #if defined( USE_UV ) || defined( USE_ANISOTROPY )

  vUv = vec3(uv, 1).xy;

  // correct uvs based on slice angle and curve position
  #endif
  #ifdef USE_MAP

  vMapUv = (mapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_ALPHAMAP

  vAlphaMapUv = (alphaMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_LIGHTMAP

  vLightMapUv = (lightMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_AOMAP

  vAoMapUv = (aoMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_BUMPMAP

  vBumpMapUv = (bumpMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_NORMALMAP

  vNormalMapUv = (normalMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_DISPLACEMENTMAP

  vDisplacementMapUv = (displacementMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_EMISSIVEMAP

  vEmissiveMapUv = (emissiveMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_METALNESSMAP

  vMetalnessMapUv = (metalnessMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_ROUGHNESSMAP

  vRoughnessMapUv = (roughnessMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_ANISOTROPYMAP

  vAnisotropyMapUv = (anisotropyMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_CLEARCOATMAP

  vClearcoatMapUv = (clearcoatMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_CLEARCOAT_NORMALMAP

  vClearcoatNormalMapUv = (clearcoatNormalMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_CLEARCOAT_ROUGHNESSMAP

  vClearcoatRoughnessMapUv = (clearcoatRoughnessMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_IRIDESCENCEMAP

  vIridescenceMapUv = (iridescenceMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_IRIDESCENCE_THICKNESSMAP

  vIridescenceThicknessMapUv = (iridescenceThicknessMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_SHEEN_COLORMAP

  vSheenColorMapUv = (sheenColorMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_SHEEN_ROUGHNESSMAP

  vSheenRoughnessMapUv = (sheenRoughnessMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_SPECULARMAP

  vSpecularMapUv = (specularMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_SPECULAR_COLORMAP

  vSpecularColorMapUv = (specularColorMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_SPECULAR_INTENSITYMAP

  vSpecularIntensityMapUv = (specularIntensityMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_TRANSMISSIONMAP

  vTransmissionMapUv = (transmissionMapTransform * vec3(transformedUv, 1)).xy;

  #endif
  #ifdef USE_THICKNESSMAP

  vThicknessMapUv = (thicknessMapTransform * vec3(transformedUv, 1)).xy;

  #endif

	#include <color_vertex>

  objectNormal = normalize(objectNormal * transformationMatrix);

	#include <defaultnormal_vertex> //skip
	#include <normal_vertex> //skip

  vec3 transformed = segmentPosition.xyz + k * segmentRadius;

  #ifdef USE_ALPHAHASH

  vPosition = vec3(transformed);

  #endif

	#include <displacementmap_vertex> //skip
	#include <project_vertex> // replace/skip
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vViewPosition = -mvPosition.xyz;

	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>

#ifdef USE_TRANSMISSION

  vWorldPosition = worldPosition.xyz;

#endif
}
#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../../sdk/materials/shaderLib/rotation.glsl

uniform vec3 direction;
uniform float width;
uniform float offset;

attribute vec2 position2;
attribute vec4 point0;
attribute vec4 point1;
attribute vec3 tangent0;
attribute vec3 tangent1;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vTangent;

flat varying int instanceID;

void main() {
  vec4 curveDirection = modelViewMatrix * vec4(direction, 0.0);
  vec4 p0 = modelViewMatrix * vec4(point0.xyz, 1.0);
  vec4 p1 = modelViewMatrix * vec4(point1.xyz, 1.0);

  vec3 tangent = (modelViewMatrix * vec4(mix(tangent0, tangent1, position2.x), 0.0)).xyz;
  vec3 binormal = normalize(cross(normalize(curveDirection.xyz), vec3(0.0, 0.0, -1.0)));
  vec3 normal = normalize(cross(tangent, binormal));
  vec3 point = mix(p0.xyz, p1.xyz, position2.x) + binormal * position2.y * width + binormal * offset;

  gl_Position = projectionMatrix * vec4(point, 1.0);

  vUv = vec2(position2.y + 0.5, 1.0 - mix(point0.w, point1.w, position2.x));
  vNormal = normal;
  vTangent = tangent;
  
  instanceID = gl_InstanceID;

  #include <logdepthbuf_vertex>
}
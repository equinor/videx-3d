attribute float curveLength;

varying float vLength;
varying vec2 vUv;
varying vec3 vModelPosition;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec4 modelPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelPosition;

  #include <logdepthbuf_vertex>  

  vModelPosition = vModelPosition.xyz;
  vLength = curveLength;
  vUv = uv;
}
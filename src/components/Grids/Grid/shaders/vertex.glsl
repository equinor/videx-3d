#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;

void main() {

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING

  mvPosition = instanceMatrix * mvPosition;

  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;

  vUv = uv;

  #include <logdepthbuf_vertex>
}
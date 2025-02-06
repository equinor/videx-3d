#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vPosition;
varying vec3 vCamera;

void main() {  
  mat4 instanceModelMatrix = modelMatrix * instanceMatrix;
  vec4 modelPosition = instanceModelMatrix * vec4(position.xyz, 1.0);
  vec4 cameraPosition = inverse(instanceModelMatrix) * vec4(cameraPosition, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;

  gl_Position = projectionMatrix * viewPosition;
  
  #include <logdepthbuf_vertex>

  vPosition = position.xyz;
  vCamera = cameraPosition.xyz;
}
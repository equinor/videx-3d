// See cube-view-vertex.glsl.

uniform samplerCube uCubeViewMap;

varying vec3 vCubeDirection;

void main() {
  gl_FragColor = vec4(textureCube(uCubeViewMap, normalize(vCubeDirection)).rgb, 1.0);

  #include <colorspace_fragment>
}

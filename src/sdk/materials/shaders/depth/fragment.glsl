#include <common>
#include <packing>

varying vec2 vUv;
uniform sampler2D depthTexture;
uniform float cameraFar;
uniform float cameraNear;

float linearizeDepth(in float depth) {
  float a = cameraFar / (cameraFar - cameraNear);
  float b = cameraFar * cameraNear / (cameraNear - cameraFar);

  return a + b / depth;
}

float linearizeLogDepth(in float depth) {
  float z = exp2(depth * log2(cameraFar + 1.0)) - 1.0;
  return linearizeDepth(z);
}

// assumes perspective camera
void main() {
  float depth = texture(depthTexture, vUv).r;
  float viewZ;
  #if defined( USE_LOGARITHMIC_DEPTH_BUFFER ) || defined( USE_LOGDEPTHBUF ) // USE_LOGDEPTHBUF used to support THREE version <= 0.179 
  viewZ = linearizeLogDepth(depth);
  #else
  viewZ = depth;
  #endif

  gl_FragColor = packDepthToRGBA(viewZ);
}

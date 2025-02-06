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

float reconstructDepth(const in float depth) {
  return pow(2.0, depth * log2(cameraFar + 1.0)) - 1.0;
}

float getDepth(vec2 uv) {
  float depth = texture2D(depthTexture, uv).x;
  #if defined( USE_LOGDEPTHBUF )
      return linearizeDepth(reconstructDepth(depth));
  #else
      return texture2D(depthTexture, uv).x;
  #endif
}

// may need to also include check if camera was persepective camera
void main() {
	gl_FragColor = packDepthToRGBA(getDepth(vUv));
}

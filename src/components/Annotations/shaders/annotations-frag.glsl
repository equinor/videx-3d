uniform float logDepthBufFC;
uniform sampler2D depthTexture;
uniform sampler2D dataTexture;
uniform mat4 pMatrix;
uniform mat4 vMatrix;
uniform vec2 resolution;

varying vec2 vUv;

layout(location = 0) out float value;

const float epsilon = 1e-8;
const vec4 viewSpace = vec4(-0.99, 0.99, -0.99, 0.99);

bool isPerspectiveMatrix(mat4 m) {
  return m[2][3] == -1.0;
}

void main() {
  vec4 instance = texture2D(dataTexture, vUv);

  vec3 position = instance.xyz;
  vec4 clipSpace = pMatrix * vMatrix * vec4(position, 1.0);
  vec3 ndc = clipSpace.xyz / clipSpace.w;

  bool inViewSpace = (ndc.z >= 0. &&
    ndc.z <= 1. &&
    ndc.x >= viewSpace.x &&
    ndc.x <= viewSpace.y &&
    ndc.y >= viewSpace.z &&
    ndc.y <= viewSpace.w);

  // offset position towards camera according to occlusion radius 
  float offsetRadius = instance.w;
  vec3 offsetDirection = normalize(cameraPosition - position);
  vec3 offsetPosition = position + offsetDirection * offsetRadius;

  vec4 offsetClip = pMatrix * vMatrix * vec4(offsetPosition, 1.0);
  vec3 offsetNdc = offsetClip.xyz / offsetClip.w;
  float pointDepth = offsetNdc.z * 0.5 + 0.5;

  // USE_LOGDEPTHBUF used to support THREE version <= 0.179 
  #if defined( USE_LOGARITHMIC_DEPTH_BUFFER ) || defined( USE_LOGDEPTHBUF ) 
  pointDepth = isPerspectiveMatrix(pMatrix) ? log2(1.0 + offsetClip.w) * logDepthBufFC * 0.5 : pointDepth;
  #endif

  vec2 uvDepth = offsetNdc.xy * 0.5 + 0.5;

  // The depth buffer is rendered with a sub-pixel TAA jitter, so a point near a
  // silhouette edge can flip between the foreground occluder and the background
  // from frame to frame. Sample a small neighbourhood and keep the farthest
  // depth, i.e. treat the point as occluded only if every tap occludes it. This
  // makes the test tolerant to the (<= 1 texel) jitter and biases borderline
  // labels towards staying visible instead of flickering.
  vec2 texel = 1.0 / resolution;
  float sceneDepth = 0.0;
  for(int y = -1; y <= 1; y++) {
    for(int x = -1; x <= 1; x++) {
      float d = texture2D(depthTexture, uvDepth + vec2(float(x), float(y)) * texel).r;
      sceneDepth = max(sceneDepth, d);
    }
  }

  value = 0.0;
  if((sceneDepth + epsilon) < pointDepth)
    value += 1.0 / 255.0;
  if(inViewSpace)
    value += 2.0 / 255.0;

}

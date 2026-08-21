precision highp float;

// Explicit NxN box downsample of the supersampled buffer, written straight to
// the screen. Used as an A/B reference against the mipmap-based OutputPass so the
// only variable is the resample filter. Because this is a RawShaderMaterial the
// renderer does not apply output colour-space conversion for us, so we encode
// sRGB in-shader (driven by the outputColorSpace uniform). Tone mapping is NOT
// applied here — use it with tone mapping = none for a clean resample comparison.
uniform sampler2D map;
uniform vec2 texelSize; // 1 / buffer size
uniform int factor; // integer supersample ratio (1..8)
uniform int outputColorSpace; // 0 = linear, 1 = sRGB

in vec2 vUv;

out vec4 outColor;

const int MAX_FACTOR = 8;

vec3 linearToSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  int n = factor < 1 ? 1 : (factor > MAX_FACTOR ? MAX_FACTOR : factor);
  float start = -(float(n) - 1.0) * 0.5;

  vec3 sum = vec3(0.0);
  for(int j = 0; j < MAX_FACTOR; j++) {
    if(j >= n)
      break;
    for(int i = 0; i < MAX_FACTOR; i++) {
      if(i >= n)
        break;
      vec2 off = (vec2(float(i), float(j)) + start) * texelSize;
      // Force LOD 0 so the auto-selected mip does not defeat the explicit box.
      sum += textureLod(map, vUv + off, 0.0).rgb;
    }
  }

  vec3 col = sum / float(n * n);
  if(outputColorSpace == 1)
    col = linearToSRGB(col);
  outColor = vec4(col, 1.0);
}

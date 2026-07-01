precision highp float;

// FXAA (Fast Approximate Anti-Aliasing), Timothy Lottes' console/PC-quality
// variant, operating directly on the pipeline's linear FP16 buffer. Edge
// detection uses a cheap perceptual luma (sqrt of linear luminance) so the
// thresholds behave as they would on an sRGB image, but the actual blend is done
// on the linear texels (RGBA, so transparent silhouettes are anti-aliased too).
// Flat regions are passed through unchanged, so the resolver is an exact identity
// away from edges and never shifts brightness. Because everything stays linear
// there is no LDR clamp — HDR values above 1 survive.
uniform sampler2D source; // linear FP16
uniform vec2 resolution; // 1.0 / buffer size (texel size)

varying vec2 vUv;

#define FXAA_SPAN_MAX 8.0
#define FXAA_REDUCE_MUL (1.0 / 8.0)
#define FXAA_REDUCE_MIN (1.0 / 128.0)
#define FXAA_EDGE_THRESHOLD (1.0 / 8.0)
#define FXAA_EDGE_THRESHOLD_MIN (1.0 / 24.0)

// Perceptual-ish luma from linear rgb (cheap ~gamma-2 curve) so edge thresholds
// behave like they do on an sRGB image, without a separate encode pass.
float luma(vec3 c) {
  return sqrt(dot(c, vec3(0.299, 0.587, 0.114)));
}

void main() {
  vec2 inv = resolution;

  vec4 sM = texture2D(source, vUv);
  vec3 cNW = texture2D(source, vUv + vec2(-1.0, -1.0) * inv).rgb;
  vec3 cNE = texture2D(source, vUv + vec2(1.0, -1.0) * inv).rgb;
  vec3 cSW = texture2D(source, vUv + vec2(-1.0, 1.0) * inv).rgb;
  vec3 cSE = texture2D(source, vUv + vec2(1.0, 1.0) * inv).rgb;

  float lNW = luma(cNW);
  float lNE = luma(cNE);
  float lSW = luma(cSW);
  float lSE = luma(cSE);
  float lM = luma(sM.rgb);

  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

  // Flat region: nothing to anti-alias — pass the centre through unchanged.
  if(lMax - lMin < max(FXAA_EDGE_THRESHOLD_MIN, lMax * FXAA_EDGE_THRESHOLD)) {
    gl_FragColor = sM;
    return;
  }

  // Edge direction from the luma gradient across the 2x2 neighbourhood.
  vec2 dir;
  dir.x = -((lNW + lNE) - (lSW + lSE));
  dir.y = ((lNW + lSW) - (lNE + lSE));

  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * FXAA_REDUCE_MUL, FXAA_REDUCE_MIN);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX)) * inv;

  // Two-tap and four-tap averages along the edge; pick the narrower blend unless it
  // over/undershoots the local luma range (then fall back to the wider average).
  vec4 rgbaA = 0.5 *
    (texture2D(source, vUv + dir * (1.0 / 3.0 - 0.5)) +
    texture2D(source, vUv + dir * (2.0 / 3.0 - 0.5)));
  vec4 rgbaB = rgbaA * 0.5 +
    0.25 *
    (texture2D(source, vUv + dir * -0.5) +
    texture2D(source, vUv + dir * 0.5));

  float lB = luma(rgbaB.rgb);
  gl_FragColor = (lB < lMin || lB > lMax) ? rgbaA : rgbaB;
}

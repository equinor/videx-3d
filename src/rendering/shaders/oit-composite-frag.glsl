precision highp float;

uniform sampler2D accumTexture;

varying vec2 vUv;

void main() {
  vec4 accum = texture2D(accumTexture, vUv);

  // accum.a = sum of optical-depth weights b = -ln(1 - alpha). With no transparent
  // tail fragments the weight sum is zero → nothing to composite.
  float weightSum = accum.a;
  if(weightSum <= 0.0) {
    discard;
  }

  // Guard against NaN/Inf from extreme weights (no isinf() in GLSL ES 1.0).
  if(!(accum.r <= 1e20 && accum.r >= -1e20))
    accum.rgb = vec3(weightSum);
  if(!(accum.g <= 1e20 && accum.g >= -1e20))
    accum.rgb = vec3(weightSum);
  if(!(accum.b <= 1e20 && accum.b >= -1e20))
    accum.rgb = vec3(weightSum);

  // Weighted-average colour over the tail fragments.
  vec3 averageColor = accum.rgb / max(weightSum, 1e-5);

  // Coverage recovered from the summed optical depth:
  //   coverage = 1 - exp(-sum(b)) = 1 - prod(1 - alpha)
  // identical to a separate (ZERO, ONE_MINUS_SRC_COLOR) reveal pass.
  float coverage = 1.0 - exp(-weightSum);

  // Standard premultiplied-alpha composite: src = (averageColor, coverage). The pass
  // uses blend funcs
  //   RGB:   (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
  //   alpha: (ONE,       ONE_MINUS_SRC_ALPHA)
  // giving:
  //   dst.rgb' = averageColor * coverage + dst.rgb * (1 - coverage)
  //   dst.a'   = coverage     + dst.a    * (1 - coverage)
  gl_FragColor = vec4(averageColor, coverage);
}

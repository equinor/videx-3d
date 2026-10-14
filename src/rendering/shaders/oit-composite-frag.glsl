precision highp float;

uniform sampler2D accumTexture;
#ifdef MERGED_FRONT
// Front layer written by the tail pass into its second attachment (same encoding).
uniform sampler2D frontTexture;
#endif
// Farther tail slices (TAIL_SLICES > 1); accumTexture then holds the nearest slice.
#if TAIL_SLICES > 1
uniform sampler2D slice1Texture;
#endif
#if TAIL_SLICES > 2
uniform sampler2D slice2Texture;
#endif

varying vec2 vUv;

// Resolve a b-weighted sum (rgb = sum(rgb * b), a = sum(b), b = -ln(1 - alpha)) into
// a premultiplied colour: the weighted-average colour times the coverage
//   coverage = 1 - exp(-sum(b)) = 1 - prod(1 - alpha)
// identical to a separate (ZERO, ONE_MINUS_SRC_COLOR) reveal pass.
vec4 resolveWeighted(vec4 sum) {
  float weightSum = sum.a;
  if(weightSum <= 0.0)
    return vec4(0.0);

  // Guard against NaN/Inf from extreme weights (no isinf() in GLSL ES 1.0).
  if(!(sum.r <= 1e20 && sum.r >= -1e20))
    sum.rgb = vec3(weightSum);
  if(!(sum.g <= 1e20 && sum.g >= -1e20))
    sum.rgb = vec3(weightSum);
  if(!(sum.b <= 1e20 && sum.b >= -1e20))
    sum.rgb = vec3(weightSum);

  float coverage = 1.0 - exp(-weightSum);
  return vec4(sum.rgb / max(weightSum, 1e-5) * coverage, coverage);
}

// Premultiplied `near` over premultiplied `far`.
vec4 over(vec4 near, vec4 far) {
  return near + (1.0 - near.a) * far;
}

void main() {
  vec4 color = vec4(0.0);
  #if TAIL_SLICES > 2
  color = resolveWeighted(texture2D(slice2Texture, vUv));
  #endif
  #if TAIL_SLICES > 1
  color = over(resolveWeighted(texture2D(slice1Texture, vUv)), color);
  #endif
  color = over(resolveWeighted(texture2D(accumTexture, vUv)), color);

  #ifdef MERGED_FRONT
  color = over(resolveWeighted(texture2D(frontTexture, vUv)), color);
  #endif

  // No transparent fragments at this pixel → nothing to composite.
  if(color.a <= 0.0)
    discard;

  // Premultiplied-alpha over, with blend funcs (ONE, ONE_MINUS_SRC_ALPHA) for both
  // RGB and alpha:
  //   dst.rgb' = color.rgb + dst.rgb * (1 - color.a)
  //   dst.a'   = color.a   + dst.a   * (1 - color.a)
  gl_FragColor = color;
}

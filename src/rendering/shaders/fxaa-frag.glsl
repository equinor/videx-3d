precision highp float;

uniform sampler2D source;
uniform vec2 invResolution;

varying vec2 vUv;

// FXAA 3.11 high-quality (PC) preset by Timothy Lottes (NVIDIA), public
// domain. Compared to the compact "console" variant this performs proper
// edge-end searching along the detected edge plus a sub-pixel low-pass
// blend, giving noticeably cleaner long edges and thin features. Operates
// in straight RGBA; alpha is preserved.

// Local contrast required to apply FXAA.
//   1/3  - too little (faster)
//   1/4  - low quality
//   1/8  - high quality (default)
//   1/16 - overkill
#define FXAA_EDGE_THRESHOLD (1.0 / 8.0)

// Trims the algorithm from processing darks.
//   1/32 - visible limit
//   1/16 - high quality (default)
//   1/12 - upper limit (start of visible unfiltered edges)
#define FXAA_EDGE_THRESHOLD_MIN (1.0 / 16.0)

// Choose the amount of sub-pixel aliasing removal.
//   1.0  - upper limit (softer)
//   0.75 - default amount of filtering
//   0.50 - lower limit (sharper, less sub-pixel aliasing removal)
//   0.0  - completely off
#define FXAA_SUBPIX 0.75

// Number of edge search steps. More steps resolve longer near-horizontal /
// near-vertical edges. This matches the "quality 39" extreme preset.
#define FXAA_SEARCH_STEPS 12

float fxaaLuma(vec3 rgb) {
  // Perceptual luma; the green-channel approximation Lottes uses is replaced
  // by a full weighted luma because the source is linear HDR rather than
  // gamma-encoded sRGB.
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 inv = invResolution;
  vec4 centre = texture2D(source, vUv);

  float lumaM = fxaaLuma(centre.rgb);
  float lumaN = fxaaLuma(texture2D(source, vUv + vec2(0.0, -1.0) * inv).rgb);
  float lumaS = fxaaLuma(texture2D(source, vUv + vec2(0.0, 1.0) * inv).rgb);
  float lumaE = fxaaLuma(texture2D(source, vUv + vec2(1.0, 0.0) * inv).rgb);
  float lumaW = fxaaLuma(texture2D(source, vUv + vec2(-1.0, 0.0) * inv).rgb);

  float rangeMin = min(lumaM, min(min(lumaN, lumaS), min(lumaE, lumaW)));
  float rangeMax = max(lumaM, max(max(lumaN, lumaS), max(lumaE, lumaW)));
  float range = rangeMax - rangeMin;

  // Early out on areas with little contrast.
  if(range < max(FXAA_EDGE_THRESHOLD_MIN, rangeMax * FXAA_EDGE_THRESHOLD)) {
    gl_FragColor = centre;
    return;
  }

  // Sample the four diagonal corners.
  float lumaNW = fxaaLuma(texture2D(source, vUv + vec2(-1.0, -1.0) * inv).rgb);
  float lumaNE = fxaaLuma(texture2D(source, vUv + vec2(1.0, -1.0) * inv).rgb);
  float lumaSW = fxaaLuma(texture2D(source, vUv + vec2(-1.0, 1.0) * inv).rgb);
  float lumaSE = fxaaLuma(texture2D(source, vUv + vec2(1.0, 1.0) * inv).rgb);

  float lumaNS = lumaN + lumaS;
  float lumaWE = lumaW + lumaE;

  // Determine whether the edge is horizontal or vertical.
  float edgeHorz = abs((-2.0 * lumaN) + lumaNW + lumaNE) +
    abs((-2.0 * lumaM) + lumaWE) * 2.0 +
    abs((-2.0 * lumaS) + lumaSW + lumaSE);
  float edgeVert = abs((-2.0 * lumaW) + lumaNW + lumaSW) +
    abs((-2.0 * lumaM) + lumaNS) * 2.0 +
    abs((-2.0 * lumaE) + lumaNE + lumaSE);
  bool horzSpan = edgeHorz >= edgeVert;

  // Pick the neighbour on the steeper side of the edge.
  float luma1 = horzSpan ? lumaN : lumaW;
  float luma2 = horzSpan ? lumaS : lumaE;
  float gradient1 = luma1 - lumaM;
  float gradient2 = luma2 - lumaM;
  bool is1Steepest = abs(gradient1) >= abs(gradient2);
  float gradientScaled = 0.25 * max(abs(gradient1), abs(gradient2));

  // Step half a texel along the gradient toward the edge.
  float stepLength = horzSpan ? inv.y : inv.x;
  float lumaLocalAvg = 0.0;
  if(is1Steepest) {
    stepLength = -stepLength;
    lumaLocalAvg = 0.5 * (luma1 + lumaM);
  } else {
    lumaLocalAvg = 0.5 * (luma2 + lumaM);
  }

  vec2 currentUv = vUv;
  if(horzSpan) {
    currentUv.y += stepLength * 0.5;
  } else {
    currentUv.x += stepLength * 0.5;
  }

  // Search along the edge in both directions until the local luma average is
  // no longer matched, which marks the edge ends.
  vec2 offset = horzSpan ? vec2(inv.x, 0.0) : vec2(0.0, inv.y);
  vec2 uv1 = currentUv - offset;
  vec2 uv2 = currentUv + offset;

  float lumaEnd1 = fxaaLuma(texture2D(source, uv1).rgb) - lumaLocalAvg;
  float lumaEnd2 = fxaaLuma(texture2D(source, uv2).rgb) - lumaLocalAvg;
  bool reached1 = abs(lumaEnd1) >= gradientScaled;
  bool reached2 = abs(lumaEnd2) >= gradientScaled;
  bool reachedBoth = reached1 && reached2;

  if(!reached1) {
    uv1 -= offset;
  }
  if(!reached2) {
    uv2 += offset;
  }

  if(!reachedBoth) {
    for(int i = 0; i < FXAA_SEARCH_STEPS; i++) {
      if(!reached1) {
        lumaEnd1 = fxaaLuma(texture2D(source, uv1).rgb) - lumaLocalAvg;
      }
      if(!reached2) {
        lumaEnd2 = fxaaLuma(texture2D(source, uv2).rgb) - lumaLocalAvg;
      }
      reached1 = abs(lumaEnd1) >= gradientScaled;
      reached2 = abs(lumaEnd2) >= gradientScaled;
      if(!reached1) {
        uv1 -= offset;
      }
      if(!reached2) {
        uv2 += offset;
      }
      if(reached1 && reached2) {
        break;
      }
    }
  }

  // Distance from the current pixel to each edge end.
  float distance1 = horzSpan ? (vUv.x - uv1.x) : (vUv.y - uv1.y);
  float distance2 = horzSpan ? (uv2.x - vUv.x) : (uv2.y - vUv.y);
  bool isDirection1 = distance1 < distance2;
  float distanceFinal = min(distance1, distance2);
  float edgeLength = distance1 + distance2;

  // Pick the closer edge end and verify the luma variation is consistent.
  float lumaEndClosest = isDirection1 ? lumaEnd1 : lumaEnd2;
  bool isLumaCentreSmaller = (lumaM - lumaLocalAvg) < 0.0;
  bool correctVariation = (lumaEndClosest < 0.0) != isLumaCentreSmaller;

  // Sub-pixel offset based on proximity to the edge end.
  float pixelOffset = -distanceFinal / edgeLength + 0.5;
  float finalOffset = correctVariation ? pixelOffset : 0.0;

  // Sub-pixel aliasing: a 3x3 low-pass estimate that handles thin features
  // and isolated pixels the edge search alone cannot resolve.
  float lumaAverage = (1.0 / 12.0) *
    (2.0 * (lumaNS + lumaWE) + (lumaNW + lumaNE + lumaSW + lumaSE));
  float subPixelOffset1 = clamp(abs(lumaAverage - lumaM) / range, 0.0, 1.0);
  float subPixelOffset2 = (-2.0 * subPixelOffset1 + 3.0) * subPixelOffset1 * subPixelOffset1;
  float subPixelOffsetFinal = subPixelOffset2 * subPixelOffset2 * FXAA_SUBPIX;

  finalOffset = max(finalOffset, subPixelOffsetFinal);

  // Apply the computed offset perpendicular to the edge.
  vec2 finalUv = vUv;
  if(horzSpan) {
    finalUv.y += finalOffset * stepLength;
  } else {
    finalUv.x += finalOffset * stepLength;
  }

  vec4 result = texture2D(source, finalUv);
  gl_FragColor = vec4(result.rgb, centre.a);
}

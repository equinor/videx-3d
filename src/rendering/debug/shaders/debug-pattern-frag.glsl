precision highp float;

// Test-signal generator for the pipeline debug harness. Writes *linear* values
// into the (RGBA16F) pipeline buffer at the supersampled resolution, so the
// downstream output pass (tone mapping + output colour-space encode) can be
// verified in isolation from any scene geometry.
uniform vec2 uResolution; // buffer size in pixels (already supersampled)
uniform int uPattern;
uniform float uScale;

varying vec2 vUv;

const float PI = 3.141592653589793;

void main() {
  vec2 uv = vUv;
  vec2 px = uv * uResolution;
  vec3 col = vec3(0.0);

  if(uPattern == 0) {
    // Zone plate: radial frequency chirp. uScale maps to the local spatial
    // frequency (cycles/pixel) reached at the corner — uScale ~= 16 puts Nyquist
    // (0.5 c/px) there, higher values push aliasing rings inward.
    float rmax = 0.5 * length(uResolution);
    vec2 c = px - 0.5 * uResolution;
    float r = length(c);
    float cornerFreq = uScale / 32.0;
    float phase = cornerFreq * PI * r * r / max(rmax, 1.0);
    col = vec3(0.5 + 0.5 * cos(phase));
  } else if(uPattern == 1) {
    // 1px grid lines every uScale buffer pixels.
    float period = max(uScale, 2.0);
    vec2 g = mod(px, period);
    col = vec3(g.x < 1.0 || g.y < 1.0 ? 1.0 : 0.0);
  } else if(uPattern == 2) {
    // Checkerboard with cell size uScale buffer pixels.
    float period = max(uScale, 1.0);
    vec2 cell = floor(px / period);
    col = vec3(mod(cell.x + cell.y, 2.0));
  } else if(uPattern == 3) {
    // Horizontal linear ramp 0..1 — reveals the output encode curve and banding.
    col = vec3(uv.x);
  } else if(uPattern == 4) {
    // Vertical colour bars: black, R, G, B, yellow, cyan, magenta, white.
    int i = int(floor(uv.x * 8.0));
    if(i <= 0)
      col = vec3(0.0);
    else if(i == 1)
      col = vec3(1.0, 0.0, 0.0);
    else if(i == 2)
      col = vec3(0.0, 1.0, 0.0);
    else if(i == 3)
      col = vec3(0.0, 0.0, 1.0);
    else if(i == 4)
      col = vec3(1.0, 1.0, 0.0);
    else if(i == 5)
      col = vec3(0.0, 1.0, 1.0);
    else if(i == 6)
      col = vec3(1.0, 0.0, 1.0);
    else
      col = vec3(1.0);
  } else if(uPattern == 5) {
    // Gray step wedge, uScale steps, equal *linear* increments.
    float steps = max(uScale, 2.0);
    col = vec3(floor(uv.x * steps) / (steps - 1.0));
  } else {
    // 18% middle-gray card (linear) — classic tone-mapping reference.
    col = vec3(0.18);
  }

  gl_FragColor = vec4(col, 1.0);
}

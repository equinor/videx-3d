// The sea's waves drawn into a layer's tile (SeaWaveBake): every wave of the layer's table
// summed at each texel, in the wave plane, so the tile repeats exactly as its waves do.
precision highp float;
precision highp int;

// One texel a wave: (kx, kz, a·cos φ, a·sin φ), its height a·cos(k·x + φ) (SeaState).
uniform highp sampler2D uWaves;
uniform int uCount;
// The tile's size (metres), and its turn in the wave plane (cos, sin).
uniform float uSize;
uniform vec2 uTurn;

in vec2 vUv;

// x, y: the slope ∂h/∂x, ∂h/∂z; z: the height (metres); w: the slope's square, |∇h|², which
// filtered down the mips with the slope leaves the slopes a pixel cannot show as variance.
layout(location = 0) out highp vec4 gSurface;

void main() {
  vec2 local = vUv * uSize;
  vec2 p = vec2(uTurn.x * local.x - uTurn.y * local.y, uTurn.y * local.x + uTurn.x * local.y);
  float h = 0.0;
  vec2 slope = vec2(0.0);
  for(int i = 0; i < uCount; i++) {
    vec4 w = texelFetch(uWaves, ivec2(i, 0), 0);
    float phase = dot(w.xy, p);
    float c = cos(phase);
    float s = sin(phase);
    h += w.z * c - w.w * s;
    slope -= w.xy * (w.z * s + w.w * c);
  }
  gSurface = vec4(slope, h, dot(slope, slope));
}

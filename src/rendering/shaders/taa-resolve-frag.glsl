precision highp float;

// Temporal accumulation resolve: blend the freshly-rendered (jittered) frame
// into the running history average. `blend` is the weight of the CURRENT frame
// (1.0 on a reset, 1/n while converging). Operates in linear HDR (RGBA passed
// through unchanged), so this must run before the OutputPass.
uniform sampler2D current;
uniform sampler2D history;
uniform float blend;

varying vec2 vUv;

void main() {
  vec4 c = texture2D(current, vUv);
  vec4 h = texture2D(history, vUv);
  gl_FragColor = mix(h, c, blend);
}

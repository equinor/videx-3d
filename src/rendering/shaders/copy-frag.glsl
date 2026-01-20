precision highp float;

uniform float opacity;

uniform sampler2D source;

varying vec2 vUv;

void main() {

  vec4 texel = texture2D(source, vUv);
  gl_FragColor = opacity * texel;

}

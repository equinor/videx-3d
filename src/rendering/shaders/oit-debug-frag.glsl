precision highp float;

uniform sampler2D source;
// 0 = rgb, 1 = red channel as grayscale, 2 = normalized depth (near = bright)
uniform int mode;

varying vec2 vUv;

void main() {
  vec4 texel = texture2D(source, vUv);
  vec3 color;
  if(mode == 1) {
    color = vec3(texel.r);
  } else if(mode == 2) {
    color = vec3(1.0 - texel.r);
  } else {
    color = texel.rgb;
  }
  gl_FragColor = vec4(color, 1.0);
}

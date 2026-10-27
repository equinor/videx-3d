// A label's text from the atlas: its fill's coverage in red, its halo's in green.

uniform sampler2D uAtlas;
// Its colour, in display (sRGB) values.
uniform vec3 uColor;
// The halo's colour, in display values, and its alpha.
uniform vec4 uHaloColor;

varying vec2 vUv;
varying float vOpacity;

#include <logdepthbuf_pars_fragment>

vec3 displayToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  #include <logdepthbuf_fragment>

  // A finer mip than the footprint asks for: small text stays crisp, not heavy.
  vec2 coverage = texture2D(uAtlas, vUv, -0.5).rg;
  float fill = coverage.r;
  float halo = coverage.g * uHaloColor.a * (1.0 - fill);
  float alpha = (fill + halo) * vOpacity;
  if (alpha < 0.002) discard;
  // Fill over halo in display colours, as a canvas draws them. Mixed in linear light, a
  // label a few pixels high, its fill and halo sharing every pixel, reads as its fill alone.
  vec3 display = (uColor * fill + uHaloColor.rgb * halo) / (fill + halo);
  // Premultiplied.
  gl_FragColor = vec4(displayToLinear(display) * alpha, alpha);

  // No-ops into the pipeline's linear buffer; on screen, as three's own materials are.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}

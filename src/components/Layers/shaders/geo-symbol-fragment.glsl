// GeoSymbols' own material: each symbol's colour, shaded by how much each face turns up
// (unlit, as the tubes are, so the colour reads the same in any light), and, with
// GEO_SYMBOL_WATER, seen through a Scenery's sea as the seabed under it is (geo-water.glsl).

#include <common>
#include <logdepthbuf_pars_fragment>
#ifdef GEO_SYMBOL_WATER
#include ../../Scenery/shaders/sky.glsl
#include ./geo-water.glsl
#endif
#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

varying vec3 vSymbolColor;
varying vec3 vSymbolNormal;
varying vec3 vSymbolUp;
varying vec3 vSymbolWorld;
varying float vSymbolHeight;

void main() {
  #include <logdepthbuf_fragment>
  float facing = dot(normalize(vSymbolNormal), normalize(vSymbolUp));
  vec3 rgb = vSymbolColor * (0.6 + 0.4 * max(facing, 0.0));
  float alpha = 1.0;
  #ifdef GEO_SYMBOL_WATER
  rgb = geoThroughWater(rgb, alpha, vSymbolWorld, vSymbolHeight);
  // Opaque, the cutaway takes all of it or none.
  if(alpha < 0.5)
    discard;
  #endif
  gl_FragColor = vec4(rgb, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}

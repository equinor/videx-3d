// GeoTubes (geo-tube-vertex.glsl): each feature's colour, darkened toward the silhouette
// (tube-rim.glsl), unlit as a Trajectory is, so the colour reads the same from any side;
// and, with GEO_TUBE_WATER, seen through a Scenery's sea as the seabed under it is
// (geo-water.glsl).

#include <common>
#include <logdepthbuf_pars_fragment>
#ifdef GEO_TUBE_WATER
#include ../../Scenery/shaders/sky.glsl
#include ./geo-water.glsl
#endif
#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif
#include ../../../sdk/materials/shaderLib/tube-rim.glsl

uniform vec3 shadingColor;
uniform float shadingStrength;
uniform float shadingFalloff;
uniform float uTubeOpacity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec4 vTubeColor;
varying vec3 vTubeWorld;
varying float vTubeHeight;

void main() {
  #include <logdepthbuf_fragment>
  vec3 rgb = mix(vTubeColor.rgb, shadingColor, tubeRimDarken(vNormal, vViewPosition, shadingStrength, shadingFalloff));
  float alpha = vTubeColor.a * uTubeOpacity;
  #ifdef GEO_TUBE_WATER
  rgb = geoThroughWater(rgb, alpha, vTubeWorld, vTubeHeight);
  #endif
  // Opaque, the cutaway takes all of it or none.
  #ifdef OPAQUE
  if(alpha < 0.5 * vTubeColor.a * uTubeOpacity)
    discard;
  #endif
  if(alpha <= 0.0)
    discard;
  gl_FragColor = vec4(rgb, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef OPAQUE
  gl_FragColor.a = 1.0;
  #endif
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}

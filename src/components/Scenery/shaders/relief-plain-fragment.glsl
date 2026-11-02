// The relief drawn from tiles without a sky (a GeoRelief with no Scenery in its World): land
// and seabed coloured as its looks say (relief-look.glsl), lit by the scene's lights, and
// nothing of the sea, the air or the void — no water over the seabed, no haze, no lid from
// below. The seabed's own colour and shine are uniforms of its own (the sea's defaults).
// The tiles are relief-fragment.glsl's (relief-tiles-vertex.glsl, relief-tiles.glsl); with a
// see-through area, RELIEF_STAGE_AROUND leaves it out and RELIEF_SEE_THROUGH draws it alone;
// RELIEF_SEE_THROUGH_ALL draws every tile see-through (uReliefOpacity). RELIEF_NO_LAND and
// RELIEF_NO_SEABED leave out the ground at or above the sea's level, and below it.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <dithering_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include ../../../sdk/materials/shaderLib/scene-light.glsl
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ./relief-tiles.glsl
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif
#include ./relief-look.glsl

// The seabed where the looks give it no ramp, and its shine; the ambient light facing up
// (x) and down (y), on the land too (see sceneBlinnPhong).
uniform vec3 uReliefBedColor;
uniform vec3 uReliefBedSpecular;
uniform float uReliefBedShininess;
uniform vec2 uReliefBedAmbient;
// Metres below the sea the seabed's colour starts darkening from (the relief's base).
uniform float uReliefBedDepth;
// How much of what lies beneath it a see-through draw hides: everywhere (x), and over the
// stage's area (y), where the lower of the two holds.
uniform vec2 uReliefOpacity;
// How far from the camera the tiles draw it: its far plane, onto which the vertex shader
// clamps what lies past it.
uniform float uReliefReach;

varying vec3 vReliefWorld;
varying vec2 vReliefPlane;
varying vec3 vReliefUp;

void main() {
  #include <logdepthbuf_fragment>
  vec3 world = vReliefWorld;
  // The tile's normal, along true east, up and true south where it lies on the globe.
  vec3 tileNormal = reliefTileNormal();
  vec3 up = normalize(vReliefUp);
  vec3 east = normalize(vReliefEast - up * dot(vReliefEast, up));
  vec3 normal = normalize(east * tileNormal.x + up * tileNormal.y + cross(east, up) * tileNormal.z);
  float height = reliefTileSurfaceHeight();
  bool under = height < 0.0;
  // The look of the layer that gave the nearest node, and the height's footprint for the
  // contours, before anything branches.
  int look = reliefTileLayer();
  look = look < textureSize(uReliefLook, 0).x ? look : 0;
  float gHeight = contourGradient(height);

  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 albedo = reliefLookAlbedo(height, look, uReliefBedColor, uReliefBedDepth);
  vec3 color = sceneBlinnPhong(albedo, under ? uReliefBedSpecular : RELIEF_LAND_SPECULAR, under ? uReliefBedShininess : RELIEF_LAND_SHININESS, uReliefBedAmbient, position, normalize(mat3(viewMatrix) * normal));
  color = reliefContours(color, height, gHeight, look);
  #if defined(RELIEF_DEBUG_TILES) || defined(RELIEF_DEBUG_LAYERS)
  color = reliefTileDebug(color);
  #endif
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>

  // Once the derivatives above are taken: past the far plane, the other draw's, cut away,
  // or a part left out — judged by the ground, on a skirt the tile's edge it hangs from: a
  // land tile's skirt dropping below the sea's level is not seabed.
  bool left = length(world - cameraPosition) > uReliefReach || reliefTileLeftToOther(world) || reliefCutAway();
  #if defined(RELIEF_NO_LAND) || defined(RELIEF_NO_SEABED)
  float ground = reliefTileHeight();
  #endif
  #ifdef RELIEF_NO_LAND
  left = left || ground >= 0.0;
  #endif
  #ifdef RELIEF_NO_SEABED
  left = left || ground < 0.0;
  #endif
  if(left)
    discard;
  #if defined(RELIEF_SEE_THROUGH_ALL)
  gl_FragColor.a = reliefTileInRegion(world) ? min(uReliefOpacity.x, uReliefOpacity.y) : uReliefOpacity.x;
  #elif defined(RELIEF_SEE_THROUGH)
  gl_FragColor.a = min(uReliefOpacity.x, uReliefOpacity.y);
  #endif
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}

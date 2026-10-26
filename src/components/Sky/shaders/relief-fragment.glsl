// A stage's relief (SkyBoxStage `relief`): land where it rises above the sea, seabed below
// it, coloured flat or by height, lit by the scene's lights as the stage's seabed
// is. The seabed is seen through the water as the stage's is; the land, and a dry seabed,
// through the air, turning blue with distance before it fades into the horizon.
// RELIEF_RAMP colours the land by height and darkens the seabed with depth. One of:
// RELIEF_TILES draws it from tiles (relief-tiles-vertex.glsl), which cover everything, the
// stage's own area included; with a see-through seabed, RELIEF_STAGE_AROUND leaves that
// area out and RELIEF_SEE_THROUGH draws it alone, at the sea's seabed opacity
// (relief-tiles.glsl). RELIEF_OCCUPANTS keeps the cutaway off the ground over the stage's
// occupants, and RELIEF_CUT_OCCUPANT cuts it with one of them, inside its outline.
// RELIEF_FAR draws the overview past the tiles' reach instead, on a fullscreen layer: what
// a map of the first layer holds above the sea, flat on the curved sea, per pixel.

#include <common>
#ifndef RELIEF_FAR
#include <logdepthbuf_pars_fragment>
#endif
#include <dithering_pars_fragment>
#include ./sky.glsl
#ifdef RELIEF_FAR
#include ./relief.glsl
#else
#include ./relief-tiles.glsl
#endif
#ifdef USE_OIT
// View-space position, which the OIT pipeline sorts by.
varying vec3 vViewPosition;
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

// The land's shine, faint: rock and soil, not water.
#define RELIEF_LAND_SPECULAR vec3(0.02)
#define RELIEF_LAND_SHININESS 8.0
// How much more of each channel than of green the air takes: it scatters blue most, so
// distant land turns blue before it fades into the horizon. Kept mild: more and the land's
// own colour is lost.
#define RELIEF_AIR_SPREAD vec3(0.75, 1.0, 1.5)

#ifdef RELIEF_RAMP
// The land by height: green lowland, umber upland and grey high ground, eased between these heights.
#define RELIEF_RAMP_LOW vec3(0.0497, 0.1022, 0.0273)
#define RELIEF_RAMP_MID vec3(0.1845, 0.1470, 0.0844)
#define RELIEF_RAMP_HIGH vec3(0.4851, 0.4735, 0.4342)
#define RELIEF_RAMP_HEIGHTS vec3(0.0, 600.0, 1500.0)
// How far below the stage's seabed the seabed's colour darkens to half.
#define RELIEF_RAMP_DEEP 600.0
#else
uniform vec3 uReliefLandColor;
#endif

// How far from the camera the tiles draw it: past it, the stage's sea ends, and so do the tiles.
uniform float uReliefReach;
#ifdef RELIEF_FAR
varying vec3 vSkyDirection;
#else
varying vec3 vReliefWorld;
varying vec2 vReliefPlane;
#endif

vec3 reliefAlbedo(float height, float weight) {
  #ifdef RELIEF_RAMP
  vec3 land = mix(RELIEF_RAMP_LOW, RELIEF_RAMP_MID, smoothstep(RELIEF_RAMP_HEIGHTS.x, RELIEF_RAMP_HEIGHTS.y, height));
  land = mix(land, RELIEF_RAMP_HIGH, smoothstep(RELIEF_RAMP_HEIGHTS.y, RELIEF_RAMP_HEIGHTS.z, height));
  // From the stage's own seabed down, so the two meet in one colour.
  vec3 bed = uSkyOceanBedColor * mix(1.0, 0.5, smoothstep(uSkyOceanDepth, uSkyOceanDepth + RELIEF_RAMP_DEEP, -height));
  #else
  vec3 land = uReliefLandColor;
  vec3 bed = uSkyOceanBedColor;
  #endif
  vec3 color = mix(bed, land, smoothstep(-1.0, 1.0, height));
  // Into the stage's own seabed where the relief eases into it; land keeps its colour.
  return mix(uSkyOceanBedColor, color, max(weight, smoothstep(-1.0, 1.0, height)));
}

// The depth of the point `t` along this pixel's view ray `dir`, as the stage writes the curved sea's.
#ifndef RELIEF_FAR
float reliefDepthAt(vec3 dir, float t) {
  vec3 view = mat3(viewMatrix) * dir * t;
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  return vIsPerspective == 0.0 ? gl_FragCoord.z : log2(1.0 - view.z) * logDepthBufFC * 0.5;
  #else
  vec4 clip = projectionMatrix * vec4(view, 1.0);
  return 0.5 * clip.z / clip.w + 0.5;
  #endif
}
#endif

// `color` seen through the air from the camera, `dist` along `dir`, channel by channel:
// into the sky's blue over short paths and the horizon's colour over long ones. Looking
// down, into the sky overhead as seen from the sea, as the sea's haze does
// (skyOceanThroughAir), so the sun's side cannot show as a wedge below.
vec3 reliefThroughAir(vec3 color, vec3 dir, float dist, float blend) {
  float haze = skyAirHaze(cameraPosition, dir, dist);
  if(haze <= 0.0)
    return color;
  vec3 level = dir - uSkyUp * dot(dir, uSkyUp);
  float n2 = dot(level, level);
  vec3 way = n2 > 1e-8 ? level * inversesqrt(n2) : uSkyEast;
  // The sky some 25 degrees up along the view's bearing.
  vec3 blue = skySurfaceAt(normalize(way + uSkyUp * 0.47), blend, 0.0);
  vec3 horizon = skyHorizonColor(way, blend);
  float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
  float toward = pow(n2, 2.0 + 14.0 * dusk);
  if(toward < 0.999) {
    vec3 overhead = skySurfaceAt(uSkyUp, blend, 0.0);
    blue = mix(overhead, blue, toward);
    horizon = mix(overhead, horizon, toward);
  }
  float depth = -log(max(1.0 - haze, 1e-4));
  vec3 kept = exp(-depth * RELIEF_AIR_SPREAD);
  vec3 scatter = mix(blue, horizon, 1.0 - exp(-depth));
  return color * kept + scatter * (1.0 - kept);
}

void main() {
  float altitude = dot(cameraPosition, uSkyUp) - uSkyOceanLevel;
  #ifdef RELIEF_FAR
  vec3 dir = normalize(vSkyDirection);
  vec3 hit = skyOceanReach(cameraPosition, dir, max(altitude, 1e-3));
  float dist = hit.x;
  vec3 world = cameraPosition + dir * dist;
  vec2 xz = world.xz;
  #else
  #include <logdepthbuf_fragment>
  #ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = gl_FragCoord.z;
  #endif

  vec3 world = vReliefWorld;
  vec3 toPoint = world - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  vec2 xz = vReliefPlane;
  #endif
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, uSkyUp)));

  #ifdef RELIEF_FAR
  // The slope from the map, as finely as the pixel sees it.
  float footprint = max(length(fwidth(xz)), uReliefMapFrame.z);
  // Only where the sea is met past the tiles. Every derivative is taken above.
  if(altitude <= 0.0 || hit.z > 0.5 || dist < uReliefReach)
    discard;
  float lod = min(log2(footprint / uReliefMapFrame.z), uReliefMapFrame.w);
  float bed = -uSkyOceanDepth;
  float west = reliefGround(xz - vec2(footprint, 0.0), lod, bed).x;
  float east = reliefGround(xz + vec2(footprint, 0.0), lod, bed).x;
  float north = reliefGround(xz - vec2(0.0, footprint), lod, bed).x;
  float south = reliefGround(xz + vec2(0.0, footprint), lod, bed).x;
  vec3 normal = normalize(vec3(west - east, 2.0 * footprint, north - south));
  // Land or sea by the map at this pixel.
  vec2 ground = reliefGround(xz, lod, bed);
  #else
  bool staged = skyOceanStaged(dir, cameraPosition, 1.0, false);
  vec3 normal = reliefTileNormal();
  vec2 ground = vec2(reliefTileHeight(), 1.0);
  #endif
  float height = ground.x;
  bool under = height < 0.0;
  bool water = uSkyOceanWater > 0.5;
  #ifdef RELIEF_FAR
  // The background's own sea and seabed show where the map holds nothing, or water covers it.
  if(ground.y <= 0.0 || (under && water))
    discard;
  #endif
  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 color = sceneBlinnPhong(reliefAlbedo(height, ground.y), under ? uSkyOceanBedSpecular : RELIEF_LAND_SPECULAR, under ? uSkyOceanBedShininess : RELIEF_LAND_SHININESS, uSkyOceanBedAmbient, position, normalize(mat3(viewMatrix) * normal));
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  color /= max(uSkyIntensity, 1e-4);

  #ifdef RELIEF_FAR
  color = reliefThroughAir(color, dir, dist, blend);
  #else
  // The triangles miss the curved sea by up to tens of metres, more the coarser they are
  // and the farther the camera is from the scene (the curve follows the view). So the
  // ground's height decides which of the two shows: the seabed stays behind the sea, and
  // where the sea would be met over land there is none, so the land comes in front of it.
  float sea = water && altitude > 0.0 ? skyOceanReach(cameraPosition, dir, altitude).x : 0.0;
  // The cutaway takes the seabed in front of the view, and the water over it, as over the
  // stage's own; the land stands.
  float cutaway = skyOceanCutawayAlong(cameraPosition, world);
  float seabed = under ? skyOceanCutawaySeabed(cutaway) : 1.0;
  #ifdef RELIEF_OCCUPANTS
  // Over an occupant the cutaway takes the water, not the ground, as over its own seabed.
  if(reliefOnOccupant(xz))
    seabed = 1.0;
  #endif
  if(under && water) {
    // Through the water over it, from where the view enters it.
    color *= waterFogDim(-height, uSkyOceanFogDensity);
    float below = altitude > 0.0 ? max(dist - sea, 0.0) : skyOceanPathBelowSurface(cameraPosition, world);
    float path = skyOceanCutawayPath(below, skyOceanCutawayWall(cameraPosition, dir), skyOceanCutawayWater(cutaway));
    color = skyOceanFog(color, path, skyOceanLight(0.5 * (-height + max(-altitude, 0.0))));
    if(altitude > 0.0 && sea > dist)
      gl_FragDepth = reliefDepthAt(dir, sea * 1.0001);
  } else if(altitude > 0.0) {
    color = reliefThroughAir(color, dir, dist, blend);
    // Also where the land only just clears the sea: there the two depths tie, and the sea
    // won. The tile holds its own ground only. Land met within a couple of its cells of the
    // sea stands for the sea's point; past that, the ground there decides when the tile
    // holds it, and else the sea is met over open water well in front: the land lies past
    // the horizon, and stays behind.
    bool clears = height >= 0.0 && (dist - sea < 2.0 * reliefTileCell() || reliefTileClearsAt((cameraPosition + dir * sea).xz));
    if(water && sea < dist * 1.0001 && clears)
      gl_FragDepth = reliefDepthAt(dir, min(sea, dist) * 0.9999);
  }
  // Bitten through: the void, as the background draws it through the gap.
  if(seabed < 1.0)
    color = mix(skyOceanThroughCutaway(skyAbyssGradient(dot(dir, uSkyUp)), dir, cameraPosition), color, seabed);
  #endif

  #if defined(RELIEF_DEBUG_TILES) || defined(RELIEF_DEBUG_LAYERS)
  color = reliefTileDebug(color);
  #endif
  gl_FragColor = vec4(color, 1.0);
  gl_FragColor.rgb = skyDebugTint(gl_FragColor.rgb, vec3(0.95, 0.6, 0.1));
  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Its smooth gradients over large areas, dark at dusk, step in 8 bits otherwise.
  #include <dithering_fragment>

  #ifndef RELIEF_FAR
  // Once the derivatives above are taken. Seabed under water only where the stage's sea
  // covers it: past it the background's sea lies behind.
  bool past = under && water && altitude > 0.0 ? !staged : dist > uReliefReach;
  if(seabed < 1e-3 || past || reliefTileSkirtHidden() || reliefTileLeftToOther(xz) || reliefCutAway())
    discard;
  #endif

  #ifdef RELIEF_SEE_THROUGH
  // As the stage's see-through seabed is: at the sea's seabed opacity, bitten by the cutaway.
  gl_FragColor.a = seabed * uSkyOceanSeabedOpacity;
  #endif
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}

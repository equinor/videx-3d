// A stage's relief (SceneryStage `relief`): land where it rises above the sea, seabed below
// it, coloured as its look says (sky-relief-look.ts: flat, or by height through a colour
// ramp, with contour lines), the relief's own or, from tiles, its layers', lit by the
// scene's lights as the stage's seabed is. The seabed is seen through the water as the
// stage's is; the land, and a dry seabed, through the air, turning blue with distance
// before it fades into the horizon. One of:
// RELIEF_TILES draws it from tiles (relief-tiles-vertex.glsl), which cover everything, the
// stage's own area included; with a see-through seabed, RELIEF_STAGE_AROUND leaves that
// area out and RELIEF_SEE_THROUGH draws it alone, at the sea's seabed opacity
// (relief-tiles.glsl). RELIEF_OCCUPANTS keeps the cutaway off the ground over the stage's
// occupants, and RELIEF_CUT_OCCUPANT cuts it with one of them, inside its outline.
// RELIEF_FAR draws the overview past the tiles' reach instead, on a fullscreen layer: what
// a map of the first layer in longitude and latitude holds above the sea, flat on the
// globe's sea, per pixel, wherever on the Earth.

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
#include ../../../sdk/materials/shaderLib/color-ramp.glsl
#include ../../../sdk/materials/shaderLib/contours.glsl

// The land's shine, faint: rock and soil, not water.
#define RELIEF_LAND_SPECULAR vec3(0.02)
#define RELIEF_LAND_SHININESS 8.0
// How much more of each channel than of green the air takes: it scatters blue most, so
// distant land turns blue before it fades into the horizon. Kept mild: more and the land's
// own colour is lost.
#define RELIEF_AIR_SPREAD vec3(0.75, 1.0, 1.5)

// The looks (SkyReliefLooks): a column per look, 0 the relief's own and 1 + i its layer
// i's, of five rows:
//   0: the land's ramp: its row of the colour ramps (-1 for a flat colour), its low and
//      high heights, 1 to run it backwards (colorRampAt)
//   1: the land's flat colour, linear; and how contours shade (ContourColorMode)
//   2: the seabed's ramp, as the land's; its row -1 for the sea's seabed colour darkened
//      with depth, -2 for it plain
//   3: contours: metres apart (0 for none), width in pixels, every how many a major line,
//      1 on the seabed too
//   4: the contours' colour, linear; and how strongly they shade
uniform highp sampler2D uReliefLook;
uniform sampler2D uColorRamps;
// How far below the stage's seabed the sea's seabed colour darkens to half.
#define RELIEF_BED_DARKEN 600.0

// How far from the camera the tiles draw it: past it, the stage's sea ends, and so do the tiles.
uniform float uReliefReach;
#ifdef RELIEF_FAR
varying vec3 vSkyDirection;
#else
varying vec3 vReliefWorld;
varying vec2 vReliefPlane;
varying vec3 vReliefUp;
#endif

// A row of look `look` (uReliefLook).
vec4 reliefLookRow(int look, int row) {
  return texelFetch(uReliefLook, ivec2(look, row), 0);
}

// The colour of ground `height` metres from the sea's level by look `look`; `weight` how
// much of the relief, against the stage's own seabed, it gets.
vec3 reliefAlbedo(float height, float weight, int look) {
  vec4 landRamp = reliefLookRow(look, 0);
  vec4 bedRamp = reliefLookRow(look, 2);
  vec3 land = landRamp.x >= 0.0 ? colorRampAt(uColorRamps, landRamp, height) : reliefLookRow(look, 1).rgb;
  vec3 bed = uSkyOceanBedColor;
  if(bedRamp.x >= 0.0)
    bed = colorRampAt(uColorRamps, bedRamp, height);
  else if(bedRamp.x > -1.5)
    // From the stage's own seabed down, so the two meet in one colour.
    bed *= mix(1.0, 0.5, smoothstep(uSkyOceanDepth, uSkyOceanDepth + RELIEF_BED_DARKEN, -height));
  vec3 color = mix(bed, land, smoothstep(-1.0, 1.0, height));
  // Into the stage's own seabed where the relief eases into it; land keeps its colour.
  return mix(uSkyOceanBedColor, color, max(weight, smoothstep(-1.0, 1.0, height)));
}

// `color` with look `look`'s contour lines over it, for ground `height` metres from the
// sea's level, `gHeight` its gradient on screen (contourGradient), `dist` from the camera;
// on the seabed only if the look says so. They fade out over the last fifth of the tiles'
// reach: past it the overview, which has none, draws the ground.
vec3 reliefContours(vec3 color, float height, float gHeight, float dist, int look) {
  vec4 lines = reliefLookRow(look, 3);
  if(lines.x <= 0.0 || (height < 0.0 && lines.w < 0.5))
    return color;
  vec4 shade = reliefLookRow(look, 4);
  float cover = contourCover(height, gHeight, lines.x, lines.y, lines.z);
  cover *= 1.0 - smoothstep(0.8 * uReliefReach, uReliefReach, dist);
  return contourShade(color, cover, int(reliefLookRow(look, 1).w + 0.5), shade.w, shade.rgb);
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
  vec3 look = globeCameraLook();
  vec3 level = dir - look * dot(dir, look);
  float n2 = dot(level, level);
  vec3 way = n2 > 1e-8 ? level * inversesqrt(n2) : uSkyEast;
  // The sky some 25 degrees up along the view's bearing.
  vec3 blue = skySurfaceAt(normalize(way + look * 0.47), blend, 0.0);
  vec3 horizon = skyHorizonColor(way, blend);
  float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
  float toward = pow(n2, 2.0 + 14.0 * dusk);
  if(toward < 0.999) {
    vec3 overhead = skySurfaceAt(look, blend, 0.0);
    blue = mix(overhead, blue, toward);
    horizon = mix(overhead, horizon, toward);
  }
  float depth = -log(max(1.0 - haze, 1e-4));
  vec3 kept = exp(-depth * RELIEF_AIR_SPREAD);
  vec3 scatter = mix(blue, horizon, 1.0 - exp(-depth));
  return color * kept + scatter * (1.0 - kept);
}

void main() {
  float altitude = skyOceanCameraAltitude();
  #ifdef RELIEF_FAR
  vec3 dir = normalize(vSkyDirection);
  vec3 hit = skyOceanReach(cameraPosition, dir, max(altitude, 1e-3));
  float dist = hit.x;
  vec3 world = cameraPosition + dir * dist;
  // Where it lies on the Earth: its longitude and latitude, in degrees.
  vec2 offset = globeSphereOffset(world);
  vec2 lonLat = globeGeographicAt(offset).yx * (180.0 / PI);
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
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));

  #ifdef RELIEF_FAR
  // The slope from the map, as finely as the pixel sees the ground: degrees east and north
  // a pixel spans, no finer than a texel north–south.
  float metresPerDegree = uGlobe.x * PI / 180.0;
  float footprint = max(length(fwidth(world)), uReliefMapFrame.w * metresPerDegree);
  vec2 span = footprint / metresPerDegree * vec2(1.0 / max(cos(radians(lonLat.y)), 1e-3), 1.0);
  // Only where the sea is met past the tiles. Every derivative is taken above.
  if(altitude <= 0.0 || hit.z > 0.5 || dist < uReliefReach)
    discard;
  float lod = clamp(log2(max(span.x / uReliefMapFrame.z, span.y / uReliefMapFrame.w)), 0.0, uReliefMapSize.z);
  float bed = -uSkyOceanDepth;
  float west = reliefGround(lonLat - vec2(span.x, 0.0), lod, bed).x;
  float east = reliefGround(lonLat + vec2(span.x, 0.0), lod, bed).x;
  float north = reliefGround(lonLat + vec2(0.0, span.y), lod, bed).x;
  float south = reliefGround(lonLat - vec2(0.0, span.y), lod, bed).x;
  // Along true east, up and true south where it lies on the globe, as the tiles' normals.
  vec3 up = globeUpAt(world);
  vec3 trueEast = globeGeodeticEast(offset);
  trueEast = normalize(trueEast - up * dot(trueEast, up));
  vec3 normal = normalize(trueEast * (west - east) + up * (2.0 * footprint) + cross(trueEast, up) * (north - south));
  // Land or sea by the map at this pixel.
  vec2 ground = reliefGround(lonLat, lod, bed);
  #else
  // The sea along the view, from above the water: both for the stage's test below and for
  // which of the sea and the ground shows.
  float sea = uSkyOceanWater > 0.5 && altitude > 0.0 ? skyOceanReach(cameraPosition, dir, altitude).x : 0.0;
  // Only taken from above the water, with water: where the stage's test reaches the sea.
  bool staged = skyOceanStagedAlong(dir, cameraPosition, sea, 1.0, false);
  // The tile's normal, along true east, up and true south where it lies on the globe.
  vec3 tileNormal = reliefTileNormal();
  vec3 up = normalize(vReliefUp);
  vec3 east = normalize(vReliefEast - up * dot(vReliefEast, up));
  vec3 normal = normalize(east * tileNormal.x + up * tileNormal.y + cross(east, up) * tileNormal.z);
  vec2 ground = vec2(reliefTileHeight(), 1.0);
  #endif
  float height = ground.x;
  bool under = height < 0.0;
  bool water = uSkyOceanWater > 0.5;
  #ifdef RELIEF_FAR
  // The overview is the relief's first layer: the relief's own look.
  int look = 0;
  // The background's own sea and seabed show where the map holds nothing, or water covers it.
  if(ground.y <= 0.0 || (under && water))
    discard;
  #else
  // The look of the layer that gave the nearest node (the relief's own for the base, and
  // for layers past those the table holds), and the height's footprint for the contours,
  // before anything branches.
  int look = reliefTileLayer();
  look = look < textureSize(uReliefLook, 0).x ? look : 0;
  float gHeight = contourGradient(height);
  #endif
  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 albedo = reliefAlbedo(height, ground.y, look);
  vec3 color = sceneBlinnPhong(albedo, under ? uSkyOceanBedSpecular : RELIEF_LAND_SPECULAR, under ? uSkyOceanBedShininess : RELIEF_LAND_SHININESS, uSkyOceanBedAmbient, position, normalize(mat3(viewMatrix) * normal));
  // From high up, as the sun lights it where it lies (skyFromSpaceOver): the same for every
  // pixel, so the branch is uniform.
  bool fromSpace = skyFromSpace() > 0.0;
  vec3 lit = fromSpace ? skySpaceGround(albedo, normal, world) : color;
  #ifndef RELIEF_FAR
  // Lines over the lit ground, under the air and the water it is seen through.
  color = reliefContours(color, height, gHeight, dist, look);
  lit = fromSpace ? reliefContours(lit, height, gHeight, dist, look) : color;
  #endif
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  color /= max(uSkyIntensity, 1e-4);
  lit /= max(uSkyIntensity, 1e-4);

  #ifdef RELIEF_FAR
  // From high up, as lit where it lies (skyFromSpaceOver): dark over the Earth's night side.
  color = skyFromSpaceOver(reliefThroughAir(color, dir, dist, blend), lit, world);
  #else
  // The triangles' chords sag under the globe's sea, by up to tens of metres on the coarse
  // tiles far off. So the ground's height decides which of the two shows: the seabed stays
  // behind the sea, and where the sea would be met over land there is none, so the land
  // comes in front of it (`sea`, above).
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
    color = skyFromSpaceOver(reliefThroughAir(color, dir, dist, blend), lit, world);
    // Also where the land only just clears the sea: there the two depths tie, and the sea
    // won. The tile holds its own ground only. Land met within a couple of its cells of the
    // sea stands for the sea's point; past that, the ground there decides when the tile
    // holds it, and else the sea is met over open water well in front: the land lies past
    // the horizon, and stays behind.
    bool clears = height >= 0.0 && (dist - sea < 2.0 * reliefTileCell() || reliefTileClearsAt(cameraPosition + dir * sea));
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

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
// RELIEF_FAR draws the overview past the tiles' reach instead, on a fullscreen layer: the
// relief's own tiles read per pixel through an index of those chosen for it
// (relief-atlas.glsl), above the sea, flat on the globe's sea, wherever on the Earth.
// RELIEF_FROM_BELOW draws the tiles' undersides alone (their back faces), while the camera
// is under the ground: the void's lid, shaded as the void draws its own (its main, below).

#include <common>
#ifndef RELIEF_FAR
#include <logdepthbuf_pars_fragment>
#endif
#include <dithering_pars_fragment>
#include ./sky.glsl
#ifdef RELIEF_FAR
#include ./relief-atlas.glsl
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
// The deepest ground in, metres over the sea (0 or below): where the overview hands over.
uniform float uReliefLowest;
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
// sea's level, `gHeight` its gradient on screen (contourGradient); on the seabed only if
// the look says so. The tiles and the overview past them draw the same lines, so they run
// on across where one hands over to the other.
vec3 reliefContours(vec3 color, float height, float gHeight, int look) {
  vec4 lines = reliefLookRow(look, 3);
  if(lines.x <= 0.0 || (height < 0.0 && lines.w < 0.5))
    return color;
  vec4 shade = reliefLookRow(look, 4);
  float cover = contourCover(height, gHeight, lines.x, lines.y, lines.z);
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

#ifdef RELIEF_FROM_BELOW
// From under the ground, the relief is the void's lid: what the camera sees of it is its
// underside, and nothing above it — not the water, the land, nor a trench's floor deeper
// than the camera, which its walls' undersides stand in front of. Shaded as the lid the
// background and a stage's flat seabed draw from below (with walls the sand's underside in
// their haze, without the void's own lid), facing the way it faces, so its shape shows in
// the walls' raking light, and darkened with the camera's depth as they are: where it lies
// level, the relief and the flat lid past it meet in one colour. A skirt is shaded as the
// lid it hangs from, so a crack between tiles shows none.
void main() {
  #include <logdepthbuf_fragment>
  vec3 world = vReliefWorld;
  vec3 toPoint = world - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  float height = reliefTileHeight();
  // The way its underside faces: down its tile's normal, along true east, up and true south.
  vec3 tileNormal = reliefTileNormal();
  vec3 up = normalize(vReliefUp);
  vec3 east = normalize(vReliefEast - up * dot(vReliefEast, up));
  vec3 surface = -normalize(east * tileNormal.x + up * tileNormal.y + cross(east, up) * tileNormal.z);
  // Before any pixel leaves: the lid's derivatives.
  #ifdef SKY_ABYSS_WALLS
  float lidFootprint = skyAbyssLidFootprint(world);
  #else
  // Its shape in the raking light, as much as the lid has not faded into the horizon.
  float near = uSkyAbyssFadeDistance > 0.0 ? exp(-dist / uSkyAbyssFadeDistance) : 1.0;
  vec3 color = skyAbyssCeiling(world, dist) * mix(1.0, skyAbyssLidRake(surface), near);
  // Below the horizon (a trench's floor deeper than the camera) it fades into the depths the
  // background draws there, not into the lid's horizon colour, so far off it is gone.
  if(dot(dir, uSkyUp) < 0.0)
    color += (skyAbyssDepths(dir) - uSkyAbyssHorizonColor) * (1.0 - near);
  #endif
  // The cutaway bites the seabed from below too, as it does a stage's; not over an occupant.
  float seabed = height < 0.0 ? skyOceanCutawaySeabed(skyOceanCutawayAlong(cameraPosition, world)) : 1.0;
  #ifdef RELIEF_OCCUPANTS
  if(reliefOnOccupant(vReliefPlane))
    seabed = 1.0;
  #endif
  // Below the camera's level, where the background draws the void's depths, only what lies
  // deeper than the camera: a trench's walls seen across the void. Ground higher than the
  // camera is met below its level only as the globe curves it away, past where the
  // background's flat lid ends at the horizon: left to the depths, as the lid leaves it.
  bool curvedAway = dot(dir, globeCameraUp()) <= 0.0 && height > skyOceanCameraAltitude();
  if(seabed < 1e-3 || curvedAway || reliefTileLeftToOther(vReliefPlane) || reliefCutAway())
    discard;
  #ifdef SKY_ABYSS_WALLS
  // The walls' fill stands in front of the lid here, or, from under their foot, the rock
  // that runs on down below it (skyAbyssWallStartUnder): the background draws both.
  vec4 wallStart = skyAbyssWallStartUnder(cameraPosition, dir);
  if((wallStart.y > 0.0 && wallStart.x < dist) || wallStart.w < dist)
    discard;
  vec3 color = skyAbyssLidFacing(cameraPosition, dir, dist, lidFootprint, surface);
  #endif
  if(uSkyAbyssDarkening > 0.0)
    color *= exp(min(skyOceanCameraAltitude() + uSkyOceanDepth, 0.0) / uSkyAbyssDarkening);
  #if defined(RELIEF_DEBUG_TILES) || defined(RELIEF_DEBUG_LAYERS)
  color = reliefTileDebug(color);
  #endif

  gl_FragColor = vec4(color, 1.0);
  gl_FragColor.rgb = skyDebugTint(gl_FragColor.rgb, vec3(0.95, 0.6, 0.1));
  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>

  #ifdef RELIEF_SEE_THROUGH
  gl_FragColor.a = seabed * uSkyOceanSeabedOpacity;
  #endif
  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
#else
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
  #ifndef SKY_NO_GRATICULE
  // Where it lies on the Earth, for the lines over it, before anything branches.
  GraticuleAt graticule = graticuleAt(world);
  #endif

  #ifdef RELIEF_FAR
  // The ground from the tiles (the index's coordinates: east and south), and the slope as
  // finely as the pixel sees it: degrees east and north a pixel spans, no finer than the
  // cell of the tile there.
  vec2 atlasAt = vec2(lonLat.x, -lonLat.y);
  vec4 merged = reliefAtlasGround(atlasAt);
  float metresPerDegree = uGlobe.x * PI / 180.0;
  float pixel = length(fwidth(world));
  float footprint = max(pixel, (merged.w > 0.0 ? merged.w : 180.0) * metresPerDegree);
  vec2 span = footprint / metresPerDegree * vec2(1.0 / max(cos(radians(lonLat.y)), 1e-3), 1.0);
  // Finer than a cell, the pixel takes what the tiles take: the height's gradient on screen
  // and their own normals, so the two meet without a seam; spanning cells, averages a
  // footprint wide. The gradient before anything branches.
  float gExact = contourGradient(merged.x);
  float cellMetres = merged.w * metresPerDegree;
  float fine = 1.0 - smoothstep(1.0, 2.0, pixel / max(cellMetres, 1e-3));
  // Handed over where the tiles' ground passes their reach. The ground lies past where the
  // view meets the sea's level, by up to its depth, so the view's meeting with the deepest
  // ground in (`uReliefLowest`) decides: past the reach, drawn. Where the tiles draw as well
  // they lie nearer, and win by depth; the sea's level alone left a ring to the background.
  vec3 deepest = skyOceanReach(cameraPosition, dir, max(altitude, 1e-3) - min(uReliefLowest, 0.0));
  float handover = deepest.z > 0.5 ? 1e30 : deepest.x;
  // Only where the sea is met past the tiles, and a tile is in. Every derivative is taken above.
  if(altitude <= 0.0 || hit.z > 0.5 || handover < uReliefReach || merged.w <= 0.0)
    discard;
  float west = reliefAtlasGround(atlasAt - vec2(span.x, 0.0)).x;
  float east = reliefAtlasGround(atlasAt + vec2(span.x, 0.0)).x;
  float north = reliefAtlasGround(atlasAt - vec2(0.0, span.y)).x;
  float south = reliefAtlasGround(atlasAt + vec2(0.0, span.y)).x;
  // Along true east, up and true south where it lies on the globe, as the tiles' normals.
  vec3 up = globeUpAt(world);
  vec3 trueEast = globeGeodeticEast(offset);
  trueEast = normalize(trueEast - up * dot(trueEast, up));
  vec3 sampled = normalize(trueEast * (west - east) + up * (2.0 * footprint) + cross(trueEast, up) * (north - south));
  vec3 own = reliefAtlasNormal(atlasAt);
  vec3 normal = normalize(mix(sampled, trueEast * own.x + up * own.y + cross(trueEast, up) * own.z, fine));
  // Land or sea at this pixel, how much of it a layer gave, and the look of the layer that gave it.
  vec2 ground = merged.xy;
  // The height's change over a pixel for the contours (contourGradient), from the samples
  // a footprint apart: past a discard, derivatives are not to be had.
  float gHeight = mix(0.5 * length(vec2(east - west, north - south)) * min(pixel / footprint, 1.0), gExact, fine);
  #else
  // The sea along the view, from above the water: both for the stage's test below and for
  // which of the sea and the ground shows; z 1 where the view only grazes it (skyOceanReach).
  vec3 seaHit = uSkyOceanWater > 0.5 && altitude > 0.0 ? skyOceanReach(cameraPosition, dir, altitude) : vec3(0.0, 0.0, 1.0);
  float sea = seaHit.x;
  // Only taken from above the water, with water: where the stage's test reaches the sea.
  bool staged = skyOceanStagedAlong(dir, cameraPosition, sea, 1.0, false);
  // The tile's normal, along true east, up and true south where it lies on the globe.
  vec3 tileNormal = reliefTileNormal();
  vec3 up = normalize(vReliefUp);
  vec3 east = normalize(vReliefEast - up * dot(vReliefEast, up));
  vec3 normal = normalize(east * tileNormal.x + up * tileNormal.y + cross(east, up) * tileNormal.z);
  vec2 ground = vec2(reliefTileSurfaceHeight(), 1.0);
  #endif
  float height = ground.x;
  bool under = height < 0.0;
  bool water = uSkyOceanWater > 0.5;
  #ifndef RELIEF_FAR
  // Seen through the water: the seabed, and from in the water everything, land included.
  bool seenInWater = water && (under || altitude <= 0.0);
  #endif
  #ifdef RELIEF_FAR
  // The look of the layer that gave it, as the tiles' (reliefTileLayer).
  int look = int(merged.z + 0.5);
  look = look < textureSize(uReliefLook, 0).x ? look : 0;
  // The background's own sea and seabed show where no layer gave it, or water covers it.
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
  // The scene's lights are the field's: far round the Earth, where the sun has set, the
  // ground is dark as by night (skyDayFrom).
  color *= skyDayFrom(uSkyUp, up);
  // From high up, as the sun lights it where it lies (skyFromSpaceOver): the same for every
  // pixel, so the branch is uniform.
  bool fromSpace = skyFromSpace() > 0.0;
  vec3 lit = fromSpace ? skySpaceGround(albedo, normal, world) : color;
  // Lines over the lit ground, under the air and the water it is seen through.
  color = reliefContours(color, height, gHeight, look);
  lit = fromSpace ? reliefContours(lit, height, gHeight, look) : color;
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
  // Land the view reaches only through the sea's surface (met, not grazed) lies past the
  // horizon, behind the globe's bulge: left to what the sea draws in front of it, whether a
  // stage's or the background's (`clears`, below).
  bool beyond = false;
  if(seenInWater) {
    // Through the water over it, from where the view enters it; land, from in the water,
    // through the water the view crosses before it leaves the sea.
    color *= waterFogDim(max(-height, 0.0), uSkyOceanFogDensity);
    float below = altitude > 0.0 ? max(dist - sea, 0.0) : skyOceanPathBelowSurface(cameraPosition, world);
    float path = skyOceanCutawayPath(below, skyOceanCutawayWall(cameraPosition, dir), skyOceanCutawayWater(cutaway));
    color = skyOceanFog(color, path, skyOceanLight(0.5 * (max(-height, 0.0) + max(-altitude, 0.0))));
    if(altitude > 0.0 && sea > dist)
      gl_FragDepth = reliefDepthAt(dir, sea * 1.0001);
  } else if(altitude > 0.0) {
    color = skyFromSpaceOver(reliefThroughAir(color, dir, dist, blend), lit, world);
    // Also where the land only just clears the sea: there the two depths tie, and the sea
    // won. Where the tile holds the point the view meets the sea, its ground there decides:
    // land in front of the sea, or open water, and the land met past it lies past the
    // horizon, reached only under the sea where the coarse tiles' chords sag. Where it does
    // not, land met within a couple of its cells of the sea stands for the sea's point, and
    // past that the sea is met over open water well in front. Land past the horizon used to
    // keep its own depth for the stage's sea to hide, but the stage leaves a few pixels at
    // the horizon to the background, and none far off or from space.
    float ground = reliefTileGroundAt(cameraPosition + dir * sea);
    bool clears = height >= 0.0 && (ground > 0.5 || (ground < -0.5 && dist - sea < 2.0 * reliefTileCell()));
    if(water && sea < dist * 1.0001 && clears)
      gl_FragDepth = reliefDepthAt(dir, min(sea, dist) * 0.9999);
    beyond = water && seaHit.z < 0.5 && sea < dist && !clears;
  }
  // Bitten through: the void, as the background draws it through the gap.
  if(seabed < 1.0)
    color = mix(skyOceanThroughCutaway(skyAbyssGradient(dot(dir, uSkyUp)), dir, cameraPosition), color, seabed);
  #endif

  #if defined(RELIEF_DEBUG_TILES) || defined(RELIEF_DEBUG_LAYERS)
  color = reliefTileDebug(color);
  #endif
  #ifndef SKY_NO_GRATICULE
  // Over what is seen of the Earth from the air: land, or a dry seabed; under water, the
  // sea's surface draws them.
  #ifdef RELIEF_FAR
  if(!(under && water))
  #else
  if(!seenInWater)
  #endif
    color = graticuleOver(color, graticule);
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
  if(seabed < 1e-3 || past || beyond || reliefTileLeftToOther(xz) || reliefCutAway())
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
#endif

// An endless sea for the sky: a wavy surface at uScenerySeaLevel over a flat seabed
// uScenerySeaDepth below it. Seen from the air, the surface carries the water down to the seabed
// under it (the scene's ground where its maps cover, ground-map.glsl, else that depth), and
// what lies under it is only dimmed by the daylight its depth leaves it; from in the water,
// what is seen fades by its own path through the water. The surface is shaded by the Water component's own code from
// an WaterMaterial's uniforms (see SceneryMaterial.linkWater), so the two look the same.
// The background finds both planes per pixel; a stage (SceneryStage) draws the same
// functions on real geometry, which is how the scene gets water in front of it.
// Below the seabed the abyss takes over. The seabed is lit by the scene's lights with a
// ZoneMaterial's model and options, so an occupant's own seabed can continue it.
//
// ⚠️ The shared shading takes screen-space derivatives: call these functions under
// uniform control flow, and pick a result only afterwards. Skipping them is safe only
// where every pixel of the 2x2 quad discards the result (see scenerySeaStaged's `sure`).

#include ../../Water/shaders/water-surface.glsl
#include ../../../sdk/materials/shaderLib/water-charts.glsl
#include <bsdfs>
#include <lights_pars_begin>
#include ../../../sdk/materials/shaderLib/scene-light.glsl
#include ../../../sdk/materials/shaderLib/surface-detail.glsl
#include ../../../sdk/materials/shaderLib/ground-map.glsl

#define SCENERY_SEA_WATER_IOR 1.333

// uScenerySeaLevel, uScenerySeaDepth and uScenerySeaBuried: scenery.glsl, which every layer reads.
// So are water-fog.glsl and the cutaway's shape and cuts (uScenerySeaCutaway{Anchor, Heading,
// Shape, WaveA, WaveB, Cuts}).
uniform vec3 uScenerySeabedColor;
uniform vec3 uScenerySeabedSpecular;
uniform float uScenerySeabedShininess;
uniform vec2 uScenerySeabedAmbient; // x: facing up, y: facing down
// The water's optics (water-optics.ts): its extinction per world unit per channel, nil where
// the seabed lies dry (waterExtinctionOf), and its colour (linear).
uniform vec3 uScenerySeaExtinction;
uniform vec3 uScenerySeaWaterColor;
uniform float uScenerySeaWater; // 0: no water, the seabed lies dry (SceneryMaterial.seaWater)
uniform float uScenerySeabed; // 0: no seabed, the void lies below the water; from the void its lid still hides it (SceneryMaterial.seabed)
uniform float uScenerySeabedOpacity; // how much of the void beyond the seabed it hides (SceneryMaterial.seabedOpacity)
// How the cutaway (scenery.glsl) is drawn on the sea's surface.
uniform vec4 uScenerySeaCutawayRim; // colour, and width in pixels
uniform vec2 uScenerySeaCutawayShadow; // opacity, and width in world units
uniform vec2 uScenerySeaCutawayGrip; // 1 to draw the grip on the rim, and its scale

// A point's height over the sea, over the globe (globeHeight).
float scenerySeaAltitude(vec3 p) {
  return globeHeight(p) - uScenerySeaLevel;
}

// The same of a view's `origin`: the camera, or a point straight along up from it
// (globeViewHeight), from the camera's uniform.
float scenerySeaViewAltitude(vec3 origin) {
  return globeViewHeight(origin) - uScenerySeaLevel;
}

// The camera's height over the sea, from its uniform.
float scenerySeaCameraAltitude() {
  return globeCameraHeight() - uScenerySeaLevel;
}

WaterFogCutaway scenerySeaCutawayParams() {
  return WaterFogCutaway(uScenerySeaCutawayAnchor, uScenerySeaCutawayHeading, uScenerySeaCutawayShape, uScenerySeaCutawayWaveA, uScenerySeaCutawayWaveB);
}

// How much the cutaway covers a sight line from `a` through `b`, where it meets the cutaway's
// plane: the surface from above the water, the seabed from in it.
float scenerySeaCutawayAlong(vec3 a, vec3 b) {
  return waterFogCutawayAlong(scenerySeaCutawayParams(), a, b, uSceneryUp);
}

// How much of the water, and of the seabed, shows where the cutaway covers `cutaway` of it.
float scenerySeaCutawayWater(float cutaway) {
  return 1.0 - cutaway * uScenerySeaCutawayCuts.x;
}

float scenerySeaCutawaySeabed(float cutaway) {
  return 1.0 - cutaway * uScenerySeaCutawayCuts.y;
}

// How far a view ray from `origin` runs before the water: from in it, the cutaway leaves none
// nearer than the wall standing on its edge (see waterFogCutawayWall).
float scenerySeaCutawayWall(vec3 origin, vec3 dir) {
  if(scenerySeaViewAltitude(origin) > 0.0 || uScenerySeaCutawayCuts.x <= 0.0)
    return 0.0;
  return waterFogCutawayWall(scenerySeaCutawayParams(), origin, dir, uSceneryUp);
}

// How much of a stretch `t` long from `origin` stays water, `wall` the cutaway's along it:
// what the cut leaves before the wall, and `beyond` of the rest.
float scenerySeaCutawayPath(float t, float wall, float beyond) {
  return max(t - wall, 0.0) * beyond + min(t, wall) * (1.0 - uScenerySeaCutawayCuts.x);
}

// Pixels from the cutaway's rim to `p` on its plane, seen from `origin` (negative inside), and
// along it from the middle of the view, where the grip sits. Measured on distances over the
// range: toward the horizon a pixel's footprint outgrows the distance itself, which put the
// rim all along it. ⚠️ Derivatives.
vec2 scenerySeaCutawayRimAt(vec3 p, vec3 origin) {
  WaterFogCutaway cutaway = scenerySeaCutawayParams();
  if(cutaway.shape.y <= 0.0)
    return vec2(1e9);
  float range = distance(p, origin);
  float g = (waterFogCutawayEdge(cutaway, p, uSceneryUp) + 0.5 * cutaway.shape.z) / range;
  float s = dot(p - cutaway.anchor, cross(cutaway.heading, uSceneryUp)) / range;
  // Toward the horizon the derivatives fail and would put the grip there too: only near the edge.
  float along = s / max(length(vec2(dFdx(s), dFdy(s))), 1e-12);
  return vec2(g / max(length(vec2(dFdx(g), dFdy(g))), 1e-12), abs(g) < 0.5 ? along : 1e9);
}

// Pixels from `p` to the segment from `a` to `b`.
float scenerySeaSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// The grip's two strokes across the rim, —/—/—, `rimAt` pixels across and along it: how much
// of the pixel they cover, and their dark outline.
vec2 scenerySeaCutawayGrip(vec2 rimAt) {
  float k = uScenerySeaCutawayGrip.y;
  vec2 q = rimAt.yx;
  float d = min(scenerySeaSegment(q, vec2(-7.0, -8.0) * k, vec2(-1.0, 8.0) * k), scenerySeaSegment(q, vec2(1.0, -8.0) * k, vec2(7.0, 8.0) * k));
  return clamp(vec2(1.25, 2.5) * k + 0.5 - d, 0.0, 1.0);
}

// The seabed's own colour at `world`, `depth` under the surface: with a relief
// (SCENERY_SEABED_LOOK), its tiles are the seabed and this one shows only where none is drawn
// yet or past their edge: plain, in the relief's own look by the ground's height there (the
// ground map's, else `depth` down). Else the sea's seabed colour; its detail is scenerySeabed's.
vec3 scenerySeabedAlbedo(vec3 world, float depth) {
  #ifdef SCENERY_SEABED_LOOK
  float covered;
  float ground = groundMapHeight(world, covered);
  return reliefLookAlbedo(covered > 0.5 ? ground : -depth, 0, uScenerySeabedColor, uScenerySeaDepth);
  #else
  return uScenerySeabedColor;
  #endif
}

// `surface` seen through the air, fading into the air's light: the horizon's colour along the
// view's bearing toward the horizon; looking down, the sky overhead as seen from the sea,
// which also has no bearing, so the sun's side cannot show as a wedge where all of them meet.
// At twilight the horizon's glow keeps to the far sea, and the air below is the dusk overhead.
// The colours from the air's lookup (sky-air-colors.glsl).
// From high up, as space sees it where it lies (skyFromSpaceOver): the sea, or `dry`, the
// seabed as the relief's ground is lit there, so the two meet without a seam at its reach.
// `keep` is how much of `surface.rgb` the result keeps: the rest is the air's own.
vec4 scenerySeaThroughAirOver(vec4 surface, vec3 origin, vec3 dir, float dist, bool dry, out float keep) {
  // Toward the open hollow's rim its air is draining into it (hollowAir): the surface loses
  // the sky's light, and its haze.
  float air = hollowAir(origin + dir * dist);
  surface.rgb *= mix(HOLLOW_AIR_GROUND, 1.0, air);
  float haze = skyAirHaze(origin, dir, dist) * air;
  vec4 near = surface;
  keep = 1.0;
  if(haze > 0.0) {
    vec3 look = globeCameraLook();
    vec3 level = dir - look * dot(dir, look);
    float n2 = dot(level, level);
    vec3 horizon = n2 > 1e-8 ? skyAirHorizon(level) : vec3(0.0);
    float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
    float toward = pow(n2, 2.0 + 14.0 * dusk);
    if(toward < 0.999)
      horizon = mix(skyAirOverhead(), horizon, toward);
    float alpha = haze + (1.0 - haze) * surface.a;
    near = vec4((haze * horizon + (1.0 - haze) * surface.a * surface.rgb) / alpha, alpha);
    keep = (1.0 - haze) * surface.a / alpha;
  }
  float space = skyFromSpace();
  if(space <= 0.0)
    return near;
  keep *= 1.0 - space;
  vec3 p = origin + dir * dist;
  vec3 up = globeUpAt(p);
  // The ground keeps the scene's scale, as a lit surface does (scenerySeabed).
  vec3 lit = dry ? skySpaceGround(scenerySeabedAlbedo(p, uScenerySeaDepth), up, p) / max(uSceneryIntensity, 1e-4) : skySpaceSea(dir, up);
  return vec4(skyFromSpaceOver(near.rgb, lit, p), mix(near.a, 1.0, space));
}

vec4 scenerySeaThroughAirOver(vec4 surface, vec3 origin, vec3 dir, float dist, bool dry) {
  float keep;
  return scenerySeaThroughAirOver(surface, origin, dir, dist, dry, keep);
}

vec4 scenerySeaThroughAir(vec4 surface, vec3 origin, vec3 dir, float dist) {
  return scenerySeaThroughAirOver(surface, origin, dir, dist, false);
}

// The surface seen from above at `p`, `surface` its colour and opacity, with the cutaway
// marked on it: the water cut away, a shadow inside the edge over what shows through, the
// rim along it and the grip on the rim. `rimAt` is scenerySeaCutawayRimAt there.
vec4 scenerySeaCutawayMark(vec4 surface, vec3 p, vec2 rimAt) {
  WaterFogCutaway cutaway = scenerySeaCutawayParams();
  if(cutaway.shape.y <= 0.0)
    return surface;
  float across = waterFogCutawayEdge(cutaway, p, uSceneryUp);
  float covered = (1.0 - smoothstep(-cutaway.shape.z, 0.0, across)) * uScenerySeaCutawayCuts.x;
  float water = surface.a * (1.0 - covered);

  // Both from the middle of the edge's fade, where the rim runs.
  float within = 1.0 - smoothstep(-1.0, 1.0, rimAt.x);
  float inside = max(-(across + 0.5 * cutaway.shape.z), 0.0) / max(uScenerySeaCutawayShadow.y, 1e-3);
  float shadow = uScenerySeaCutawayShadow.x * within * (1.0 - smoothstep(0.0, 1.0, inside));
  float rim = uScenerySeaCutawayRim.w > 0.0 ? clamp(0.5 * uScenerySeaCutawayRim.w + 0.5 - abs(rimAt.x), 0.0, 1.0) : 0.0;

  // The water over the shadow, the rim over both, the grip and its outline over all.
  float under = water + shadow * (1.0 - water);
  float alpha = rim + under * (1.0 - rim);
  vec3 color = surface.rgb * water * (1.0 - rim) + uScenerySeaCutawayRim.rgb * rim;
  if(uScenerySeaCutawayGrip.x > 0.5) {
    vec2 grip = scenerySeaCutawayGrip(rimAt);
    float outline = 0.45 * grip.y;
    alpha = grip.x + (outline + alpha * (1.0 - outline)) * (1.0 - grip.x);
    color = uScenerySeaCutawayRim.rgb * grip.x + color * (1.0 - outline) * (1.0 - grip.x);
  }
  return vec4(alpha > 0.0 ? color / alpha : vec3(0.0), alpha);
}

// Where a view ray from a view's `origin` (the camera, or a point straight along up from
// it), `height` above a level of the sea (its surface or its seabed), meets it: flat over the
// disc about the scene, the globe beyond (globeReach). How far along the ray, 0, and 1 if the
// ray misses it; a miss takes the grazing hit, so the derivatives stay continuous. Flat
// without the curve, a miss taking the mirrored hit.
vec3 scenerySeaReach(vec3 origin, vec3 dir, float height) {
  float y = dot(dir, uSceneryUp);
  if(uSceneryCurvature <= 0.0 || height <= 0.0 || !globeOn())
    return vec3(height / max(abs(y), 1e-6), 0.0, y < 0.0 ? 0.0 : 1.0);
  // The level `height` under the origin lies as far under the sea's as the origin is over it.
  vec2 reach = globeReach(origin, dir, height - scenerySeaViewAltitude(origin));
  return vec3(reach.x, 0.0, reach.y);
}

// `depth` below the surface, no deeper than the water's light is taken (water-fog.glsl's
// WATER_DARKEST): however deep a relief's trench goes, its ground stays dark blue but seen.
float scenerySeaLitDepth(float depth) {
  return waterLitDepth(depth, uScenerySeaExtinction);
}

// Daylight left `depth` below the surface; night keeps a little, as the sky does.
vec3 scenerySeaLight(float depth) {
  return waterFogLight(scenerySeaLitDepth(depth), uScenerySeaExtinction, uSkyDaylight);
}

// The water's own light along a sight line `path` long from `fromDepth` to `toDepth`, taken
// where the line gathers it (waterLitAlong).
vec3 scenerySeaLightAlong(float fromDepth, float toDepth, float path) {
  return scenerySeaLight(waterLitAlong(fromDepth, toDepth, path, uScenerySeaExtinction));
}

// How much of its light what lies `depth` below the surface keeps, by the water over it.
vec3 scenerySeaDim(float depth) {
  return waterFogDim(scenerySeaLitDepth(max(depth, 0.0)), uScenerySeaExtinction);
}

// How deep a view from `origin` takes the water's light at: its own depth; from a trench, the
// camera's, however far up its view is started (sceneryViewOrigin), so the water about it is lit
// as the relief's ground in it is.
float scenerySeaViewDepth(vec3 origin) {
  float depth = max(-scenerySeaViewAltitude(origin), 0.0);
  return uScenerySeaTrench > 0.5 ? max(depth, -scenerySeaCameraAltitude()) : depth;
}

// Where scenerySeaStaged tests a view ray from a view's `origin`: how far along it, the level it
// tests (the surface from above the water, else the seabed). From above it, on the curved sea
// (scenerySeaReach): a caller that has reached that level already passes its own to
// scenerySeaStagedAlong instead. `met` is whether the ray meets that level, not only grazes
// its curve.
float scenerySeaStagedReach(vec3 dir, vec3 origin, out bool met) {
  float altitude = scenerySeaViewAltitude(origin);
  bool surface = altitude > 0.0 && uScenerySeaWater > 0.5;
  float height = surface ? altitude : altitude + uScenerySeaDepth;
  // Down or up from the origin's own level, which far off the globe tilts. A view's origin
  // is the camera, or straight along up from it over the disc, where up is the camera's.
  // One return: the D3D compiler takes an early one for an uninitialised value.
  float t = -height / max(abs(dot(dir, globeCameraUp())), 1e-6);
  met = true;
  if(height > 0.0) {
    vec3 reach = scenerySeaReach(origin, dir, height);
    t = reach.x;
    met = reach.z < 0.5;
  }
  return t;
}

float scenerySeaStagedReach(vec3 dir, vec3 origin) {
  bool met;
  return scenerySeaStagedReach(dir, origin, met);
}

// scenerySeaStaged, from where the ray meets the level it tests, `t` along it
// (scenerySeaStagedReach). ⚠️ Derivatives.
bool scenerySeaStagedAlong(vec3 dir, vec3 origin, float t, float inset, bool sure) {
  float bedAltitude = scenerySeaViewAltitude(origin) + uScenerySeaDepth;
  float y = dot(dir, globeCameraUp());
  vec2 p = scenerySeaPlane(origin + dir * t);
  // Selected, not scaled: fwidth(t) is infinite at the horizon.
  float dy = sure ? 2.0 * fwidth(y) : 0.0;
  float dt = sure ? 2.0 * fwidth(t) : 0.0;
  float texel = max(length(fwidth(p)), 1e-3);
  bool reaches = bedAltitude < 0.0 ? y > dy : y < -dy;
  return reaches && scenerySeaOnStage(p, t + dt, inset * texel);
}

// Whether a stage draws the sea where this view ray first reaches it (the surface from
// above the water, else the seabed), more than `inset` pixels inside its edge. The stage
// and the background both take this test. `sure` adds a margin that holds for the
// pixel's neighbours too, so a quad can skip work by it. ⚠️ Derivatives.
// From above a level, its reach is measured on the curved sea, as a relief's is: on the
// flat plane it would run on past the far plane near the horizon.
bool scenerySeaStaged(vec3 dir, vec3 origin, float inset, bool sure) {
  return scenerySeaStagedAlong(dir, origin, scenerySeaStagedReach(dir, origin), inset, sure);
}

// How far up a view ray along `dir` runs on in the water (waterFacing): bent down as it
// enters from a camera in the air.
float scenerySeaFacing(vec3 dir) {
  return waterFacing(dot(dir, globeCameraUp()), scenerySeaCameraAltitude() > 0.0);
}

// `color` seen through `dist` of water, faded by the water along a view ray `dir` (waterFog).
vec3 scenerySeaFog(vec3 color, float dist, vec3 light, vec3 dir) {
  return waterFog(color, dist, uScenerySeaExtinction, uScenerySeaWaterColor, light, scenerySeaFacing(dir));
}

// What lies below the seabed's level, seen by a ray going down along `dir`: the void.
vec3 scenerySeaVoid(vec3 dir) {
  #ifdef SCENERY_VOID
  return sceneryVoidDepths(dir);
  #else
  return uSkyNadirColor;
  #endif
}

// Whether the sea has a seabed at `p`: everywhere while it is on; peeled, only around the
// hollow's opening (hollow.glsl), where the crust stays whole, whether the hollow is drawn yet
// or not.
bool scenerySeabedAt(vec3 p) {
  return uScenerySeabed > 0.5 || (uSceneryHollow.y > 0.5 && hollowInside(p) <= 0.0);
}

// How much of what lies beyond the seabed it hides at `bedPoint` where the cutaway covers
// `cutaway` of it: none without one.
float scenerySeaFloorShown(float cutaway, vec3 bedPoint) {
  return scenerySeabedAt(bedPoint) ? scenerySeaCutawaySeabed(cutaway) * uScenerySeabedOpacity : 0.0;
}

// What a ray reaches at the seabed's level, at `bedPoint`, as a layer over the void beyond
// (premultiplied, its alpha how much of the void it hides): the `bed`, as much as it shows
// there. `cutaway` is how much of it the cutaway covers there.
vec4 scenerySeaFloorOver(vec3 bed, float cutaway, vec3 bedPoint) {
  float shown = scenerySeaFloorShown(cutaway, bedPoint);
  return vec4(bed * shown, shown);
}

// scenerySeaFog of a layer (premultiplied) over what lies behind it (waterFogOver).
vec4 scenerySeaFogOver(vec4 layer, float dist, vec3 light, vec3 dir) {
  return waterFogOver(layer, dist, uScenerySeaExtinction, uScenerySeaWaterColor, light, scenerySeaFacing(dir));
}

// A layer of the sea over the void beyond it (premultiplied), with that void filled in:
// without an abyss there is no layer of the void's own to draw it (sceneryVoidLayer).
vec4 scenerySeaOverVoid(vec4 layer, vec3 dir) {
  return vec4(layer.rgb + scenerySeaVoid(dir) * (1.0 - layer.a), 1.0);
}

// The seabed at `world`, `depth` under the surface, facing `up` (its up there, globeUpAt):
// lit by the scene's lights, and dimmed by the water over it. The lights are the field's:
// far round the Earth, where the sun has set, it is dark as by night, as the relief's ground
// is (skyDayFrom). Its colour scenerySeabedAlbedo's; under a relief without the seabed's detail,
// which no one would see. ⚠️ Derivatives.
vec3 scenerySeabed(vec3 world, vec3 up, float depth) {
  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 normal = normalize(mat3(viewMatrix) * up);
  vec3 albedo = scenerySeabedAlbedo(world, depth);
  #if defined(SURFACE_DETAIL) && !defined(SCENERY_SEABED_LOOK)
  albedo *= surfaceDetail(normal, world, position, 0.0, true);
  #endif
  vec3 lit = sceneBlinnPhong(albedo, uScenerySeabedSpecular, uScenerySeabedShininess, uScenerySeabedAmbient, position, normal) * skyDayFrom(uSceneryUp, up);
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  return lit * scenerySeaDim(depth) / max(uSceneryIntensity, 1e-4);
}

// How far the segment from a view's origin `a` to `b` runs through the water.
float scenerySeaWaterPath(vec3 a, vec3 b) {
  float ha = scenerySeaViewAltitude(a);
  float hb = scenerySeaAltitude(b);
  return waterFogPath(ha, hb, length(b - a), -uScenerySeaDepth, 0.0);
}

// How far the segment from a view's origin `a` to `b` runs below the sea surface: the water
// over a seabed point `b`, however deep it lies.
float scenerySeaPathBelowSurface(vec3 a, vec3 b) {
  float ha = scenerySeaViewAltitude(a);
  float hb = scenerySeaAltitude(b);
  return waterFogPath(ha, hb, length(b - a), -1e30, 0.0);
}

// The light the water between the camera and a seabed point `bedDepth` down carries, along a
// sight line `path` long through it: taken where the line gathers it (waterLitAlong).
vec3 scenerySeabedPathLight(vec3 origin, float bedDepth, float path) {
  return scenerySeaLightAlong(scenerySeaViewDepth(origin), bedDepth, path);
}

// How far down the seabed lies under the sea point `world`: the scene's ground (ground-map.glsl)
// where its maps cover, else the sea's own depth.
float scenerySeaDepthAt(vec3 world) {
  float covered;
  float height = groundMapHeight(world, covered);
  return covered > 0.5 ? max(-height, 0.0) : uScenerySeaDepth;
}

// The water under a sea point with its seabed `depth` down (scenerySeaDepthAt) and `up` there,
// seen from the air along `dir`: a layer (premultiplied) between what the surface reflects and
// what lies under it, down to that seabed, lit where the line gathers its light (water-fog.glsl's
// waterUnderSurface). Far off, where the waves' detail has faded by `flatness`
// (waterFlatness), water too deep to see through, seen from any height alike. No derivatives.
vec4 scenerySeaWaterUnder(float depth, vec3 up, vec3 dir, float flatness) {
  if(uScenerySeaWater < 0.5)
    return vec4(0.0);
  float facing = dot(dir, up);
  float path = waterPathDown(depth, facing);
  vec4 water = waterUnderSurface(path, facing, uScenerySeaExtinction, uScenerySeaWaterColor, scenerySeaLightAlong(0.0, depth, path));
  if(flatness > 0.0)
    water = mix(water, waterUnderSurface(1e6, facing, uScenerySeaExtinction, uScenerySeaWaterColor, scenerySeaLightAlong(0.0, depth, 1e6)), flatness);
  return water;
}

// The waves at a point of the sea, `dist` along the view ray. Each read of the waves
// compiles to a full copy of it, so a shader shading both sides takes it once.
struct ScenerySeaWave {
  vec3 normal;
  vec2 slope;
  float height;
  // the still water's depth there (scenerySeaDepthAt), which the waves shoal and break by
  float depth;
  // the surf's (waterShoreFoam): the depth it reads, that's change across the pixel, and how
  // squarely the waves meet the shore
  float shoreDepth;
  float shoreWidth;
  float shoreAlign;
  vec2 crest; // the foam's texture (waterWaves)
  float flatness;
  float rough;
  vec3 up; // the sea's own up there, which the globe tilts
  vec2 p; // where it lies in its chart
  float keep; // how much of the waves its chart keeps there (WaterChart): 0 where two meet
};

// The waves at the sea point `delta` from the camera, where the sea's up is `up` (globeUpAt),
// `texel` world units a pixel there: in its chart (water-charts.glsl), turned onto the globe
// there, calm on the strip where two charts meet. Once: a second read of the waves, to
// cross-fade two charts, cost the stage 1.4–2 ms at the field (D3D), even where no pixel ran it.
ScenerySeaWave scenerySeaWave(vec3 delta, vec3 up, float texel, float dist) {
  ScenerySeaWave wave;
  WaterChart chart = waterChartAt(delta);
  wave.flatness = waterFlatness(dist);
  wave.keep = chart.keep;
  wave.up = up;
  wave.p = waterChartCoords(chart.index, delta);
  wave.depth = scenerySeaDepthAt(cameraPosition + delta);
  vec3 n = waterWaves(wave.p, 1.0 - (1.0 - wave.flatness) * chart.keep, wave.depth, wave.slope, wave.height, wave.crest, wave.rough);
  // The scene's ground has no grid to step across: the bed's slope from the depth's derivatives.
  wave.shoreAlign = waterShoreAlign(waterDepthSlope(wave.depth, wave.p));
  wave.shoreDepth = waterShoreDepth(wave.depth, wave.shoreAlign);
  wave.shoreWidth = fwidth(wave.shoreDepth);
  wave.normal = waterChartNormal(chart.index, n, up);
  return wave;
}

// World units a pixel spans at the sea point `delta` from the camera, for the waves.
float scenerySeaTexel(vec3 delta) {
  return max(length(fwidth(delta)), 1e-3);
}

// The optical depth, straight down to the seabed, past which the water lets through too little
// of it to show (e^-6, a quarter of a per cent, in its clearest channel).
#define SCENERY_SEA_HIDDEN 6.0

// Whether the surface, seen from above the water, hides all that lies under it: the water
// down to the seabed lets almost nothing through even straight down, the shortest way (it
// bends steeper as it enters); and no cutaway takes the water. The water's own light then
// stands for the seabed, which needs no shading.
bool scenerySeaSurfaceHides() {
  vec3 e = uScenerySeaExtinction;
  return uScenerySeaWater > 0.5 && uScenerySeaBuried < 0.5 && uScenerySeaCutawayShape.y <= 0.0 && scenerySeaCameraAltitude() > 0.0 && uScenerySeaDepth * min(e.x, min(e.y, e.z)) >= SCENERY_SEA_HIDDEN;
}

// The clouds' bake's (uScenerySeaClouds) coarsest level: its side, BAKE_SIZE in scenery-clouds.ts, is 128.
#define SCENERY_SEA_CLOUD_LODS 7.0
// The least cloud base its blur is reckoned from (world units).
#define SCENERY_SEA_CLOUD_BASE 100.0
// How much of the sky the weather far off hides where a level is all cloud: low, middle, and
// high (thin, of ice).
#define SCENERY_SEA_CLOUD_LEVELS vec3(0.9, 0.6, 0.25)

// The clouds the sea reflects along `r` at `world` (`up` there, `texel` world units per pixel),
// premultiplied, over `sky`, the sky it reflects there. Their bake (uScenerySeaClouds), read by
// direction alone, shows them as from the scene: from over the sea point it blows them up by
// its height over the point against their base, one cloud across half the sea from high up;
// so read as blurred as that, on its mips. Far from the scene, where the weather is another's,
// the cover the weather systems give there (uScenerySeaCloudMap), coloured as the baked clouds
// overhead are on average (with none there, a grey as bright as the sky).
vec4 scenerySeaReflectedClouds(vec3 r, vec3 sky, vec3 world, vec3 up, float texel) {
  float over = max(dot(cameraPosition - world, up), 0.0);
  float lod = clamp(log2(max(over / max(uScenerySeaCloudBase, SCENERY_SEA_CLOUD_BASE), 1.0)), 0.0, SCENERY_SEA_CLOUD_LODS);
  vec4 clouds = textureLod(uScenerySeaClouds, r, lod);
  float weight = uScenerySeaCloudFar.x * smoothstep(uScenerySeaCloudFar.y, uScenerySeaCloudFar.z, length(up - uSceneryUp) * uGlobe.x);
  if(weight <= 0.0)
    return clouds;
  vec4 map = textureLod(uScenerySeaCloudMap, uScenerySeaCloudEarth * up, log2(max(2.0 * texel * uScenerySeaCloudFar.w, 1.0)));
  vec3 clear = 1.0 - map.rba * SCENERY_SEA_CLOUD_LEVELS;
  float cover = 1.0 - clear.x * clear.y * clear.z;
  vec4 mean = textureLod(uScenerySeaClouds, globeCameraLook(), SCENERY_SEA_CLOUD_LODS);
  vec3 grey = vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722)));
  vec3 colour = mix(grey, mean.rgb / max(mean.a, 1e-4), smoothstep(0.02, 0.1, mean.a));
  return mix(clouds, vec4(colour * cover, cover), weight);
}

// The surface seen from above at plane point `p` (the field's wave plane: the stage, the
// contacts), with its `wave` there, at `world`: its colour, and how much of what lies under it
// that covers: the sky it reflects by Fresnel, the sun's glint and the foam, over the water
// down to the seabed under it (scenerySeaWaterUnder). What lies under it (the seabed, the relief,
// a layer, the void) is only dimmed by the daylight its depth leaves it. `texel` is world units
// per pixel. ⚠️ Derivatives.
vec4 scenerySeaSurfaceOf(ScenerySeaWave wave, vec2 p, float texel, vec3 dir, float blend, vec3 world) {
  vec3 normal = wave.normal;
  float night = mix(SKY_NIGHT_LEVEL, 1.0, uSkyDaylight);
  // The share of the light reaching the sea here through the clouds (cloud-shadow.glsl). Under
  // their shadow the glint goes, and the water's own light loses the sun's share of the daylight
  // (skySunShare): the darker sea a shadow shows, most from above, where the surface reflects
  // little of the sky.
  float through = skyCloudLightAt(world, texel);
  float shade = skyCloudShadowFrom(through);
  float waterShade = 1.0 - skySunShare(dot(uSkySunDirection, wave.up)) * (1.0 - through);

  vec3 V = -dir;
  float ndvAA;
  float fresnel = waterFresnel(normal, V, ndvAA);

  vec3 r = reflect(dir, normal);
  // Gusts and slicks (waterWaves) turn the reflection and how much there is of it, in the
  // colour only: what the surface covers stays the mean's.
  r = waterRoughReflect(r, wave.up, wave.rough);
  float roughFresnel = waterRoughFresnel(fresnel, ndvAA, wave.rough);
  // Steep waves can tip a reflection below the sea's horizon; mirror it back up. Then the sky
  // it sees is the one over that sea's own horizon, turned onto the up the sky is seen by
  // (globeCameraLook): far off, into the field's frame, it fell below the camera's horizon.
  r -= 2.0 * min(dot(r, wave.up), 0.0) * wave.up;
  r = globeTurnFrom(r, wave.up, globeCameraLook());
  // Over the sky, the clouds it reflects (scenerySeaReflectedClouds). At low quality
  // (WATER_PLAIN_SKY) the sky's gradient alone, in the daylight where the camera is: no
  // twilight's glow nor the sun's halo in it.
  #ifdef WATER_PLAIN_SKY
  vec3 reflected = skyGradientSeen(normalize(r), blend, 0.0, uSkyDaylight);
  #else
  vec3 reflected = scenerySurfaceAt(normalize(r), blend, 0.0);
  #endif
  if(uScenerySeaCloudsOn > 0.5) {
    vec4 clouds = scenerySeaReflectedClouds(normalize(r), reflected, world, wave.up, texel);
    reflected = reflected * (1.0 - clouds.a) + clouds.rgb;
  }
  // The glint is the scene's light's, which is the field's: far round the Earth only while it
  // stands over the sea's horizon there (skyLightFrom).
  float glint = skyLightFrom(normalize(uSunDirection), uSceneryUp, wave.up) * shade;
  vec4 surface = vec4(reflected * uReflectionIntensity * roughFresnel + waterGlint(normal, V, glint, wave.rough, p, texel), fresnel);
  vec4 water = scenerySeaWaterUnder(wave.depth, wave.up, dir, wave.flatness);
  water.rgb *= waterShade;
  surface = waterLayerOver(surface, water);
  // The sun's (or the moon's) light through the crests, out of the water toward the eye, as the
  // glint has it.
  if(uScenerySeaWater > 0.5)
    surface.rgb += waterCrestLight(normal, V, wave.height, wave.flatness, fresnel, uScenerySeaExtinction, uScenerySeaWaterColor, uSunColor * glint, wave.up);

  float foamFar;
  // The surf where the waves break on a shore (waterShoreFoam), as the Water's.
  float shoreFoam = waterShoreFoam(wave.shoreDepth, wave.shoreWidth, wave.shoreAlign, p, texel);
  // Where the foam's life holds (its square in the camera's chart, wave.p), a share of the
  // whitecaps breaks afresh, the rest is the foam it holds, as the Water's.
  #ifdef WATER_FOAM_LIFE
  vec3 foamLife = waterFoamLifeAt(wave.p);
  float windFoam = waterWindFoamWithLife(foamLife.z);
  #else
  float windFoam = waterWindFoam();
  #endif
  float coverage = max(max(windFoam, waterContactFoam(p, uTime)), shoreFoam);
  float shoreWeight = shoreFoam / max(coverage, 1e-4);
  float foamBlend = waterFoam(wave.crest, wave.p, texel, coverage, foamFar);
  float foamOpacity = foamBlend * (1.0 - clamp(mix(foamFar * uFoamLook.x, waterShoreFade(foamFar), shoreWeight), 0.0, 1.0));
  #ifdef WATER_FOAM_LIFE
  foamOpacity = waterFoamLifeOver(foamOpacity, foamLife, wave.crest, wave.p, texel, foamFar);
  #endif
  // Lit, the foam takes the sky's light toward the wave's normal (a second look at the sky, so
  // only where there is foam) and the sun's as the glint has it; unlit, it is dimmed by night.
  vec3 foamSky = vec3(0.0);
  if(foamOpacity > 0.001 && uFoamLook.z > 0.0) {
    vec3 toward = globeTurnFrom(normal, wave.up, globeCameraLook());
    #ifdef WATER_PLAIN_SKY
    foamSky = skyGradientSeen(toward, blend, 0.0, uSkyDaylight);
    #else
    foamSky = scenerySurfaceAt(toward, blend, 0.0);
    #endif
  }
  surface = waterFoamOver(surface, uFoamColor * mix(night, 1.0, uFoamLook.z), normal, foamOpacity, foamSky, uSunColor * glint);
  // Lit as the sky the camera sees is (its daylight, its reflection): far round the Earth,
  // where the sun has set, dark as by night (skyDayFrom).
  surface.rgb *= skyDayFrom(globeCameraLook(), wave.up);

  // ⚠️ Debug views (foamTuning.debug): opaque, in place of the surface. One return: from
  // within the branch, Direct3D took the function's value for one that may be left unset.
  vec4 seen = waterStraight(surface);
  if(uFoamGrain.w > 0.5)
    seen = vec4(waterDebugView(seen.rgb, wave.crest, foamBlend), 1.0);
  return seen;
}

// The surface seen from below, its `normal` facing down, `depth` under it: the sky
// through Snell's window, and beyond it the water mirrored. Not yet fogged.
vec3 scenerySeaUndersideOf(vec3 normal, vec3 dir, float blend, float depth) {
  vec3 farWater = uScenerySeaWaterColor * scenerySeaLight(depth) * waterGlow(dot(reflect(dir, normal), globeCameraUp()));
  vec3 exitDir = refract(dir, normal, SCENERY_SEA_WATER_IOR);
  if(dot(exitDir, exitDir) <= 0.0)
    return farWater;
  // On the air side, so the window's rim fades to the mirror instead of cutting off.
  float fresnel = waterFresnelAt(dot(exitDir, -normal));
  return mix(scenerySurface(normalize(exitDir), blend), farWater, fresnel);
}

// The same at the sea point `delta` from the camera, where the sea's up is `up`, `dist`
// along the view ray. ⚠️ Derivatives.
vec3 scenerySeaUnderside(vec3 delta, vec3 up, float texel, float dist, vec3 dir, float blend, float depth) {
  return scenerySeaUndersideOf(-scenerySeaWave(delta, up, texel, dist).normal, dir, blend, depth);
}

// What is seen from `origin`, in the water, along `dir`, as a layer over the void beyond
// the seabed (premultiplied): the surface's underside above, the seabed below, water all
// round: `bed` as shaded where the view reaches it, `tBed` along (scenerySeabedReach). Both
// level under the camera (globeCameraUp): far off the globe tilts the field's up away.
// ⚠️ Derivatives.
vec4 scenerySeaInWaterOver(vec3 origin, vec3 dir, float blend, float tBed, vec3 bed) {
  float altitude = scenerySeaViewAltitude(origin);
  float y = dot(dir, globeCameraUp());
  float ay = max(abs(y), 1e-6);
  float wall = scenerySeaCutawayWall(origin, dir);

  // Rays that miss a plane take the mirrored hit, so the derivatives stay continuous.
  float tSurface = -altitude / ay;
  vec3 delta = origin - cameraPosition + dir * tSurface;
  // From a trench, as deep as the camera is: its view starts just over the sea's own seabed
  // (sceneryViewOrigin), but the water up to the surface is the camera's.
  float depth = scenerySeaViewDepth(origin);
  vec3 underside = scenerySeaUnderside(delta, globeUpAt(origin + dir * tSurface), scenerySeaTexel(delta), tSurface, dir, blend, depth);
  float pathUp = scenerySeaCutawayPath(depth / ay, wall, 1.0);
  vec3 above = scenerySeaFog(underside, pathUp, scenerySeaLightAlong(depth, 0.0, pathUp), dir);

  // In a trench the sea's own seabed lies over the camera: below, water, down to the relief's
  // ground, which is drawn over it. One return: from within the branch, Direct3D took the
  // function's value for one that may be left unset.
  vec4 below;
  if(uScenerySeaTrench > 0.5) {
    below = scenerySeaFogOver(vec4(0.0), 1e6, scenerySeaLight(depth), dir);
  } else {
    vec3 bedPoint = origin + dir * tBed;
    float cutaway = scenerySeaCutawayAlong(origin, bedPoint);
    float pathDown = scenerySeaCutawayPath(tBed, wall, scenerySeaCutawayWater(cutaway));
    below = scenerySeaFogOver(scenerySeaFloorOver(bed, cutaway, bedPoint), pathDown, scenerySeabedPathLight(origin, uScenerySeaDepth, pathDown), dir);
  }
  return y > 0.0 ? vec4(above, 1.0) : below;
}

// Whether the background needs its view in the water from a camera at `origin`: in the
// water. From the void below, seabed or not, its lid hides the water (sceneryVoid).
bool scenerySeaNeedsWaterView(vec3 origin) {
  float altitude = scenerySeaViewAltitude(origin);
  return uScenerySeaWater > 0.5 && altitude <= 0.0 && altitude + uScenerySeaDepth > 0.0;
}

// Whether the background sees the seabed from `origin`: from anywhere above it.
bool scenerySeaSeesBed(vec3 origin) {
  return scenerySeaViewAltitude(origin) + uScenerySeaDepth > 0.0;
}

// Where the background's view along `dir` from `origin` reaches the seabed: x along it, z
// 1 where it misses it (scenerySeaReach). From in the water (`inWater`) straight to its
// plane, level under the camera (globeCameraUp), the mirrored hit for a ray going up so the
// derivatives stay continuous; else as scenerySeaReach finds it. The bed is shaded once there
// (scenerySeabed): each call compiles a full copy of its detail.
vec3 scenerySeabedReach(vec3 origin, vec3 dir, bool inWater) {
  float altitude = scenerySeaViewAltitude(origin);
  if(inWater)
    return vec3(max(altitude + uScenerySeaDepth, 0.0) / max(abs(dot(dir, globeCameraUp())), 1e-6), 0.0, 0.0);
  return scenerySeaReach(origin, dir, altitude + uScenerySeaDepth);
}

// From the air, or from below a dry sea's level, where a view along `dir` from `origin`
// meets the water (`reach`, the seabed's scenerySeabedReach): x how far along it, y 1 where it
// misses the sea. Rays that never reach the water take the mirrored hits, so the derivatives
// stay continuous. Dry, the bed is the same distance away from below the sea level too.
// Beyond the scene both fall away with the Earth's curve: above the sea's horizon there is
// neither, though the seabed's is lower. The sea's layer and the void's under it both take it.
vec2 scenerySeaFromAirReach(vec3 origin, vec3 dir, vec3 reach) {
  float altitude = scenerySeaViewAltitude(origin);
  bool wet = altitude > 0.0 && uScenerySeaWater > 0.5;
  vec3 surface = scenerySeaReach(origin, dir, altitude);
  return vec2(surface.x, (wet ? surface.z : reach.z) < 0.5 ? 0.0 : 1.0);
}

// The background's sea seen from the air, or from below a dry sea's level, for a camera at
// `origin` looking along `dir`: only the seabed, as a layer over the void beyond it
// (premultiplied). The surface is a layer of its own, blended over it (and over a stage) by
// the GPU, so the sky and a stage composite it the same way: it carries the water
// (scenerySeaWaterUnder). The seabed is `bed`, as shaded where the view reaches it (`reach`,
// scenerySeabedReach), dimmed by the daylight its depth leaves it. `reached` is whether the view
// meets the sea at all: nothing where it does not.
vec4 scenerySeaFromAir(vec3 dir, vec3 origin, float blend, vec3 reach, vec3 bed, out bool reached) {
  bool wet = scenerySeaViewAltitude(origin) > 0.0 && uScenerySeaWater > 0.5;
  vec2 surface = scenerySeaFromAirReach(origin, dir, reach);
  vec3 bedPoint = origin + dir * reach.x;
  float cutaway = scenerySeaCutawayAlong(origin, bedPoint);
  vec4 seen = scenerySeaFloorOver(bed, cutaway, bedPoint);
  // Dry, from high up: through the air and as space sees it, as the relief's ground past
  // which it shows. Eased in by the same share, so nothing changes in the air. Over an
  // opaque surface the air's light is what it adds to the share of it that it keeps.
  float space = skyFromSpace();
  if(!wet && space > 0.0) {
    float keep;
    vec3 air = scenerySeaThroughAirOver(vec4(vec3(0.0), 1.0), origin, dir, reach.x, true, keep).rgb;
    seen = mix(seen, vec4(keep * seen.rgb + air, 1.0 - keep * (1.0 - seen.a)), space);
  }

  reached = surface.y < 0.5;
  return reached ? seen : vec4(0.0);
}

// A view down through a gap the cutaway opened in a stage's seabed, as a layer over what
// lies below it (premultiplied): the water it left, down to the seabed's level. Nothing
// outside the cutaway.
vec4 scenerySeaThroughCutawayOver(vec3 dir, vec3 origin) {
  float down = -dot(dir, uSceneryUp);
  if(uScenerySeaCutawayShape.y <= 0.0 || down <= 0.0)
    return vec4(0.0);
  float bedAltitude = scenerySeaViewAltitude(origin) + uScenerySeaDepth;
  vec3 bedPoint = origin + dir * (max(bedAltitude, 0.0) / down);
  float cutaway = scenerySeaCutawayAlong(origin, bedPoint);
  float path = scenerySeaPathBelowSurface(origin, bedPoint) * scenerySeaCutawayWater(cutaway) * cutaway;
  return scenerySeaFogOver(vec4(0.0), path, scenerySeabedPathLight(origin, uScenerySeaDepth, path), dir);
}

// `color` seen down through a gap the cutaway opened in a stage's seabed (as
// scenerySeaThroughCutawayOver). Untouched outside the cutaway.
vec3 scenerySeaThroughCutaway(vec3 color, vec3 dir, vec3 origin) {
  vec4 water = scenerySeaThroughCutawayOver(dir, origin);
  return water.rgb + color * (1.0 - water.a);
}

// What a stage leaves the background along a view ray (scenerySeaStaged), as each of the
// background's layers takes it: whether the stage draws the sea there (`staged`); surely so
// for the pixel's neighbours too, so the sea's own work is skipped there (`skip`); and
// whether the ray runs below the sea's curved horizon (`below`), from a little below it, so
// none of what the stage leaves is the void. ⚠️ Derivatives: both tests are taken whatever
// they find.
struct ScenerySeaStagedView {
  bool staged;
  bool skip;
  bool below;
};

ScenerySeaStagedView scenerySeaStagedView(vec3 dir, vec3 origin) {
  float y = dot(dir, globeCameraLook());
  float dy = fwidth(y);
  // The ray's reach found once for both tests. Kept a few pixels inside the stage's rim, so
  // the rim still has the seabed behind it. Without a seabed there is nothing to leave to
  // the stage, nor from inside an occupant's. From in the water a ray that only grazes the
  // seabed's curve, just under the level, meets no stage: nothing lies under the water's
  // layer to show there, so it is the water's own.
  bool met;
  float stagedAt = scenerySeaStagedReach(dir, origin, met);
  bool staged = scenerySeaStagedAlong(dir, origin, stagedAt, 4.0, false);
  bool surely = scenerySeaStagedAlong(dir, origin, stagedAt, 8.0, true);
  ScenerySeaStagedView view;
  view.staged = staged && (met || !scenerySeaNeedsWaterView(origin)) && uScenerySeabed > 0.5 && uScenerySeaBuried < 0.5;
  view.skip = view.staged && surely;
  view.below = y < (uSceneryCurvature > 0.0 ? skyHorizon(dir) - 2.0 * dy : 0.0);
  return view;
}

// Whether the void shows along a view, under the sea the background draws (scenerySeaFloorOver:
// no seabed, a see-through one or the cutaway taking it) or through a stage's gaps below the
// horizon (scenerySeaThroughCutawayOver), from a camera above the seabed: where the void's layer
// is drawn under the sea's (sceneryVoidLayer). The same tests as the sea's layers take.
bool scenerySeaShowsVoid(vec3 dir, vec3 origin, ScenerySeaStagedView staged) {
  if(staged.staged && staged.below)
    return true;
  if(staged.skip || !scenerySeaSeesBed(origin))
    return false;
  bool water = scenerySeaNeedsWaterView(origin);
  vec3 reach = scenerySeabedReach(origin, dir, water);
  bool floor = water ? dot(dir, globeCameraUp()) <= 0.0 : scenerySeaFromAirReach(origin, dir, reach).y < 0.5;
  vec3 bedPoint = origin + dir * reach.x;
  // Into the hollow's open opening: what lies there the hollow's walls and floor draw; a view
  // they leave passes through the hollow and out over its rim, never to meet the seabed's
  // sphere again: the sky's, not the void's.
  if(hollowOpenAt(bedPoint))
    return false;
  return floor && scenerySeaFloorShown(scenerySeaCutawayAlong(origin, bedPoint), bedPoint) < 1.0;
}


// The background's sea surface, as its own layer: colour, and the opacity to blend it
// with. Nothing where the ray misses it or a stage draws it. ⚠️ Derivatives.
vec4 scenerySeaSurfaceLayer(vec3 dir, vec3 origin, float blend) {
  float altitude = scenerySeaViewAltitude(origin);
  if(altitude <= 0.0)
    return vec4(0.0);

  float y = dot(dir, globeCameraLook());
  // How far apart two pixels look (radians), for easing the horizon.
  float pixel = length(fwidth(dir));
  vec3 reach = scenerySeaReach(origin, dir, altitude);
  float t = reach.x;
  vec2 p = scenerySeaPlane(origin + dir * t);
  float texel = max(length(fwidth(p)), 1e-3);
  vec3 delta = origin - cameraPosition + dir * t;
  float waveTexel = scenerySeaTexel(delta);
  vec2 rimAt = scenerySeaCutawayRimAt(origin + dir * t, origin);
  // Skipped where hidden with a margin, so a quad's pixels that still shade are hidden too
  // and the derivatives they take across the skipped ones never show. From the level the
  // camera sees the sky by (globeCameraLook): its own far off, where the field's is not up.
  float over = y - skyHorizonAt(dir, altitude);
  if(over >= 2.0 * fwidth(y) || scenerySeaOnStage(p, t + 2.0 * fwidth(t), 4.0 * texel))
    return vec4(0.0);
  ScenerySeaWave wave = scenerySeaWave(delta, globeUpAt(origin + dir * t), waveTexel, t);
  vec4 surface = scenerySeaSurfaceOf(wave, p, waveTexel, dir, blend, origin + dir * t);
  // The band a pixel inside the stage's edge too, which the stage leaves to this layer:
  // the same test on both sides (scenerySeaStaged), so every pixel is drawn exactly once. All
  // zero, so a colour from those derivatives cannot reach the blend. With no sky it reaches on
  // past the horizon by a fringe it eases out over, as a stage's surface (SCENERY_SEA_HORIZON_EDGE).
  float fringe = reach.z < 0.5 ? 1.0 : uScenerySky < 0.5 ? smoothstep(-SCENERY_SEA_HORIZON_EDGE * pixel, 0.0, globeBelowHorizon(origin, dir, 0.0)) : 0.0;
  if(fringe <= 0.0 || scenerySeaOnStage(p, t, texel))
    return vec4(0.0);
  vec4 seen = scenerySeaCutawayMark(scenerySeaThroughAir(surface, origin, dir, t), origin + dir * t, rimAt);
  // Straight colour: only its alpha.
  seen.a *= fringe;
  return seen;
}

// How far before a point, as a share of its distance, the view must cross a level of the sea
// for the point to lie past the Earth's curve from the camera (scenerySeaCover).
#define SCENERY_SEA_COVER_PAST_CURVE 1e-3

// How much of the sea the background draws lies between the camera and `world`, `height`
// metres over the sea's level (0 to 1): its surface, from above the water, over what lies
// under it; its seabed, from anywhere above it, water or none, over what lies below it; and
// either over what lies past the Earth's curve, where the view crosses it first. The two
// blended as the GPU blends their layers. The background lies on the far plane, so it hides
// nothing by depth: what is drawn under the sea or its seabed takes this to hide itself
// (geo-water.glsl), and needs no depth, so it holds past the far plane too.
// Nothing where a stage draws the sea along the view (its surface is drawn over what lies
// under it, its seabed hides what lies below by depth); nor the seabed where a relief's tiles
// draw it (by depth); nor from below the seabed or in rock under a stage's ground, where the
// void's lid decides what shows (layerShownAt). No derivatives: call it anywhere.
float scenerySeaCover(vec3 world, float height) {
  float altitude = scenerySeaCameraAltitude();
  if(altitude + uScenerySeaDepth <= 0.0 || uScenerySeaBuried > 0.5)
    return 0.0;
  vec3 toPoint = world - cameraPosition;
  float dist = length(toPoint);
  vec3 dir = toPoint / max(dist, 1e-6);
  // The stage draws both where it draws the level it tests (scenerySeaStaged). Taken a little
  // inside its edge, so the band its own test leaves to the background is covered: twice in
  // that band, where the sea is opaque.
  float stagedAt = scenerySeaStagedReach(dir, cameraPosition);
  if(dot(dir, globeCameraUp()) < 0.0 && scenerySeaOnStage(scenerySeaPlane(cameraPosition + dir * stagedAt), stagedAt, 0.01 * stagedAt))
    return 0.0;

  // The heights are the layer's own, as laid, not found from its depth: what lies on a level
  // is not below it, with a little to spare for a height found on the GPU (a symbol's foot).
  const float margin = 2.0;
  float pastCurve = dist * (1.0 - SCENERY_SEA_COVER_PAST_CURVE);
  bool fromAir = uScenerySeaWater > 0.5 && altitude > 0.0;
  float cutaway = scenerySeaCutawayAlong(cameraPosition, world);
  float surface = 0.0;
  if(fromAir) {
    vec3 reach = scenerySeaReach(cameraPosition, dir, altitude);
    if(height < -margin || (reach.z < 0.5 && reach.x < pastCurve)) {
      // As the surface layer covers it (scenerySeaSurfaceOf), on a calm sea: by its reflection,
      // over the water under it.
      vec3 at = cameraPosition + dir * reach.x;
      vec3 up = globeUpAt(at);
      float facing = clamp(dot(up, -dir), 0.0, 1.0);
      float reflection = waterFresnelAt(facing);
      float water = scenerySeaWaterUnder(scenerySeaDepthAt(at), up, dir, waterFlatness(reach.x)).a;
      float opacity = 1.0 - (1.0 - reflection) * (1.0 - water);
      surface = opacity * scenerySeaCutawayWater(cutaway);
    }
  }
  // From in the water, the seabed straight below the camera's level, as the water's layer has it.
  bool inWater = uScenerySeaWater > 0.5 && altitude <= 0.0;
  // From the air over water, and over a dry sea, the background's seabed lies as deep as the
  // ground map has it under the point (scenerySeaLayer), give or take half a texel of it on a slope:
  // only what lies deeper than that is below it. Coarse far out, so data on the true seabed is
  // never taken for under it. Else the sea's own depth.
  bool dry = uScenerySeaWater < 0.5;
  float floorDepth = uScenerySeaDepth;
  if(fromAir || dry) {
    float covered;
    float cell;
    float ground = groundMapHeight(world, covered, cell);
    if(covered > 0.5)
      floorDepth = max(-ground, 0.0) + 0.5 * cell;
  }
  vec3 bedReach = fromAir || dry ? scenerySeaReach(cameraPosition, dir, altitude + floorDepth) : scenerySeabedReach(cameraPosition, dir, inWater);
  bool below = height < -floorDepth - margin || (!inWater && bedReach.z < 0.5 && bedReach.x < pastCurve);
  // A relief's tiles draw the seabed out to their reach, but from the air through water,
  // where only a stage's area shows theirs.
  bool reliefBed = uScenerySeaReliefReach > 0.0 && !fromAir && min(bedReach.x, dist) < uScenerySeaReliefReach;
  float bed = below && !reliefBed ? scenerySeaFloorShown(cutaway, cameraPosition + dir * min(bedReach.x, dist)) : 0.0;
  return 1.0 - (1.0 - surface) * (1.0 - bed);
}

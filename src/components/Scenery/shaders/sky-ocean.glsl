// An endless sea for the sky: a wavy surface at uSkyOceanLevel over a flat seabed
// uSkyOceanDepth below it. The surface is shaded by the Ocean component's own code from
// an OceanMaterial's uniforms (see SceneryMaterial.linkOcean), so the two look the same.
// The background finds both planes per pixel; a stage (SceneryStage) draws the same
// functions on real geometry, which is how the scene gets water in front of it.
// Below the seabed the abyss takes over. The seabed is lit by the scene's lights with a
// ChunkMaterial's model and options, so an occupant's own seabed can continue it.
//
// ⚠️ The shared shading takes screen-space derivatives: call these functions under
// uniform control flow, and pick a result only afterwards. Skipping them is safe only
// where every pixel of the 2x2 quad discards the result (see skyOceanStaged's `sure`).

#include ../../Ocean/shaders/ocean-surface.glsl
#include ../../../sdk/materials/shaderLib/ocean-charts.glsl
#include <bsdfs>
#include <lights_pars_begin>
#include ../../../sdk/materials/shaderLib/scene-light.glsl
#include ../../../sdk/materials/shaderLib/surface-detail.glsl
#include ../../../sdk/materials/shaderLib/water-fog.glsl

#define SKY_OCEAN_WATER_IOR 1.333
// Over the sea, the camera's heights over which the water turns opaque (world units).
#define SKY_OCEAN_OPAQUE vec2(2000.0, 5000.0)

// uSkyOceanLevel, uSkyOceanDepth and uSkyOceanBuried: sky.glsl, which every layer reads.
uniform vec3 uSkyOceanBedColor;
uniform vec3 uSkyOceanBedSpecular;
uniform float uSkyOceanBedShininess;
uniform vec2 uSkyOceanBedAmbient; // x: facing up, y: facing down
uniform float uSkyOceanFogDensity; // per world unit
uniform float uSkyOceanWater; // 0: no water, the seabed lies dry (SceneryMaterial.oceanWater)
uniform float uSkyOceanSeabed; // 0: no seabed, the void lies below the water; from the void its lid still hides it (SceneryMaterial.oceanSeabed)
uniform float uSkyOceanSeabedOpacity; // how much of the void beyond the seabed it hides (SceneryMaterial.oceanSeabedOpacity)
// The cutaway through the water and the seabed in front of the view (see WaterFogCutaway, Sky's `cutaway`).
uniform vec3 uSkyOceanCutawayAnchor;
uniform vec3 uSkyOceanCutawayHeading;
uniform vec3 uSkyOceanCutawayShape;
uniform vec3 uSkyOceanCutawayWaveA;
uniform vec3 uSkyOceanCutawayWaveB;
uniform vec4 uSkyOceanCutawayRim; // colour, and width in pixels
uniform vec2 uSkyOceanCutawayShadow; // opacity, and width in world units
uniform vec2 uSkyOceanCutawayCuts; // how much of the water it cuts (1 all, 0 none), and whether the seabed (1 or 0)
uniform vec2 uSkyOceanCutawayGrip; // 1 to draw the grip on the rim, and its scale

// A point's height over the sea, over the globe (globeHeight).
float skyOceanAltitude(vec3 p) {
  return globeHeight(p) - uSkyOceanLevel;
}

// The same of a view's `origin`: the camera, or a point straight along up from it
// (globeViewHeight), from the camera's uniform.
float skyOceanViewAltitude(vec3 origin) {
  return globeViewHeight(origin) - uSkyOceanLevel;
}

// The camera's height over the sea, from its uniform.
float skyOceanCameraAltitude() {
  return globeCameraHeight() - uSkyOceanLevel;
}

WaterFogCutaway skyOceanCutawayParams() {
  return WaterFogCutaway(uSkyOceanCutawayAnchor, uSkyOceanCutawayHeading, uSkyOceanCutawayShape, uSkyOceanCutawayWaveA, uSkyOceanCutawayWaveB);
}

// How much the cutaway covers a sight line from `a` through `b`, where it meets the cutaway's
// plane: the surface from above the water, the seabed from in it.
float skyOceanCutawayAlong(vec3 a, vec3 b) {
  return waterFogCutawayAlong(skyOceanCutawayParams(), a, b, uSkyUp);
}

// How much of the water, and of the seabed, shows where the cutaway covers `cutaway` of it.
float skyOceanCutawayWater(float cutaway) {
  return 1.0 - cutaway * uSkyOceanCutawayCuts.x;
}

float skyOceanCutawaySeabed(float cutaway) {
  return 1.0 - cutaway * uSkyOceanCutawayCuts.y;
}

// How far a view ray from `origin` runs before the water: from in it, the cutaway leaves none
// nearer than the wall standing on its edge (see waterFogCutawayWall).
float skyOceanCutawayWall(vec3 origin, vec3 dir) {
  if(skyOceanViewAltitude(origin) > 0.0 || uSkyOceanCutawayCuts.x <= 0.0)
    return 0.0;
  return waterFogCutawayWall(skyOceanCutawayParams(), origin, dir, uSkyUp);
}

// How much of a stretch `t` long from `origin` stays water, `wall` the cutaway's along it:
// what the cut leaves before the wall, and `beyond` of the rest.
float skyOceanCutawayPath(float t, float wall, float beyond) {
  return max(t - wall, 0.0) * beyond + min(t, wall) * (1.0 - uSkyOceanCutawayCuts.x);
}

// Pixels from the cutaway's rim to `p` on its plane, seen from `origin` (negative inside), and
// along it from the middle of the view, where the grip sits. Measured on distances over the
// range: toward the horizon a pixel's footprint outgrows the distance itself, which put the
// rim all along it. ⚠️ Derivatives.
vec2 skyOceanCutawayRimAt(vec3 p, vec3 origin) {
  WaterFogCutaway cutaway = skyOceanCutawayParams();
  if(cutaway.shape.y <= 0.0)
    return vec2(1e9);
  float range = distance(p, origin);
  float g = (waterFogCutawayEdge(cutaway, p, uSkyUp) + 0.5 * cutaway.shape.z) / range;
  float s = dot(p - cutaway.anchor, cross(cutaway.heading, uSkyUp)) / range;
  // Toward the horizon the derivatives fail and would put the grip there too: only near the edge.
  float along = s / max(length(vec2(dFdx(s), dFdy(s))), 1e-12);
  return vec2(g / max(length(vec2(dFdx(g), dFdy(g))), 1e-12), abs(g) < 0.5 ? along : 1e9);
}

// Pixels from `p` to the segment from `a` to `b`.
float skyOceanSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// The grip's two strokes across the rim, —/—/—, `rimAt` pixels across and along it: how much
// of the pixel they cover, and their dark outline.
vec2 skyOceanCutawayGrip(vec2 rimAt) {
  float k = uSkyOceanCutawayGrip.y;
  vec2 q = rimAt.yx;
  float d = min(skyOceanSegment(q, vec2(-7.0, -8.0) * k, vec2(-1.0, 8.0) * k), skyOceanSegment(q, vec2(1.0, -8.0) * k, vec2(7.0, 8.0) * k));
  return clamp(vec2(1.25, 2.5) * k + 0.5 - d, 0.0, 1.0);
}

// `surface` seen through the air, fading into the air's light: the horizon's colour along the
// view's bearing toward the horizon; looking down, the sky overhead as seen from the sea,
// which also has no bearing, so the sun's side cannot show as a wedge where all of them meet.
// At twilight the horizon's glow keeps to the far sea, and the air below is the dusk overhead.
// From high up, as space sees it where it lies (skyFromSpaceOver): the sea, or `dry`, the
// seabed as the relief's ground is lit there, so the two meet without a seam at its reach.
// `keep` is how much of `surface.rgb` the result keeps: the rest is the air's own.
vec4 skyOceanThroughAirOver(vec4 surface, vec3 origin, vec3 dir, float dist, float blend, bool dry, out float keep) {
  float haze = skyAirHaze(origin, dir, dist);
  vec4 near = surface;
  keep = 1.0;
  if(haze > 0.0) {
    vec3 look = globeCameraLook();
    vec3 level = dir - look * dot(dir, look);
    float n2 = dot(level, level);
    vec3 horizon = n2 > 1e-8 ? skyHorizonColor(level * inversesqrt(n2), blend) : vec3(0.0);
    float dusk = min(uSkyTwilight.x * uSkyTwilight.y, 1.0);
    float toward = pow(n2, 2.0 + 14.0 * dusk);
    if(toward < 0.999)
      horizon = mix(skySurfaceAt(look, blend, 0.0), horizon, toward);
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
  // The ground keeps the scene's scale, as a lit surface does (skyOceanBed).
  vec3 lit = dry ? skySpaceGround(uSkyOceanBedColor, up, p) / max(uSkyIntensity, 1e-4) : skySpaceSea(dir, up);
  return vec4(skyFromSpaceOver(near.rgb, lit, p), mix(near.a, 1.0, space));
}

vec4 skyOceanThroughAirOver(vec4 surface, vec3 origin, vec3 dir, float dist, float blend, bool dry) {
  float keep;
  return skyOceanThroughAirOver(surface, origin, dir, dist, blend, dry, keep);
}

vec4 skyOceanThroughAir(vec4 surface, vec3 origin, vec3 dir, float dist, float blend) {
  return skyOceanThroughAirOver(surface, origin, dir, dist, blend, false);
}

// The surface seen from above at `p`, `surface` its colour and opacity, with the cutaway
// marked on it: the water cut away, a shadow inside the edge over what shows through, the
// rim along it and the grip on the rim. `rimAt` is skyOceanCutawayRimAt there.
vec4 skyOceanCutawayMark(vec4 surface, vec3 p, vec2 rimAt) {
  WaterFogCutaway cutaway = skyOceanCutawayParams();
  if(cutaway.shape.y <= 0.0)
    return surface;
  float across = waterFogCutawayEdge(cutaway, p, uSkyUp);
  float covered = (1.0 - smoothstep(-cutaway.shape.z, 0.0, across)) * uSkyOceanCutawayCuts.x;
  float water = surface.a * (1.0 - covered);

  // Both from the middle of the edge's fade, where the rim runs.
  float within = 1.0 - smoothstep(-1.0, 1.0, rimAt.x);
  float inside = max(-(across + 0.5 * cutaway.shape.z), 0.0) / max(uSkyOceanCutawayShadow.y, 1e-3);
  float shadow = uSkyOceanCutawayShadow.x * within * (1.0 - smoothstep(0.0, 1.0, inside));
  float rim = uSkyOceanCutawayRim.w > 0.0 ? clamp(0.5 * uSkyOceanCutawayRim.w + 0.5 - abs(rimAt.x), 0.0, 1.0) : 0.0;

  // The water over the shadow, the rim over both, the grip and its outline over all.
  float under = water + shadow * (1.0 - water);
  float alpha = rim + under * (1.0 - rim);
  vec3 color = surface.rgb * water * (1.0 - rim) + uSkyOceanCutawayRim.rgb * rim;
  if(uSkyOceanCutawayGrip.x > 0.5) {
    vec2 grip = skyOceanCutawayGrip(rimAt);
    float outline = 0.45 * grip.y;
    alpha = grip.x + (outline + alpha * (1.0 - outline)) * (1.0 - grip.x);
    color = uSkyOceanCutawayRim.rgb * grip.x + color * (1.0 - outline) * (1.0 - grip.x);
  }
  return vec4(alpha > 0.0 ? color / alpha : vec3(0.0), alpha);
}

// Where a view ray from a view's `origin` (the camera, or a point straight along up from
// it), `height` above a level of the sea (its surface or its seabed), meets it: flat over the
// disc about the scene, the globe beyond (globeReach). How far along the ray, 0, and 1 if the
// ray misses it; a miss takes the grazing hit, so the derivatives stay continuous. Flat
// without the curve, a miss taking the mirrored hit.
vec3 skyOceanReach(vec3 origin, vec3 dir, float height) {
  float y = dot(dir, uSkyUp);
  if(uSkyCurvature <= 0.0 || height <= 0.0 || !globeOn())
    return vec3(height / max(abs(y), 1e-6), 0.0, y < 0.0 ? 0.0 : 1.0);
  // The level `height` under the origin lies as far under the sea's as the origin is over it.
  vec2 reach = globeReach(origin, dir, height - skyOceanViewAltitude(origin));
  return vec3(reach.x, 0.0, reach.y);
}

// Daylight left `depth` below the surface; night keeps a little, as the sky does.
float skyOceanLight(float depth) {
  return waterFogLight(depth, uSkyOceanFogDensity, uSkyDaylight);
}

// Where skyOceanStaged tests a view ray from a view's `origin`: how far along it, the level it
// tests (the surface from above the water, else the seabed). From above it, on the curved sea
// (skyOceanReach): a caller that has reached that level already passes its own to
// skyOceanStagedAlong instead. `met` is whether the ray meets that level, not only grazes
// its curve.
float skyOceanStagedReach(vec3 dir, vec3 origin, out bool met) {
  float altitude = skyOceanViewAltitude(origin);
  bool surface = altitude > 0.0 && uSkyOceanWater > 0.5;
  float height = surface ? altitude : altitude + uSkyOceanDepth;
  // Down or up from the origin's own level, which far off the globe tilts. A view's origin
  // is the camera, or straight along up from it over the disc, where up is the camera's.
  // One return: the D3D compiler takes an early one for an uninitialised value.
  float t = -height / max(abs(dot(dir, globeCameraUp())), 1e-6);
  met = true;
  if(height > 0.0) {
    vec3 reach = skyOceanReach(origin, dir, height);
    t = reach.x;
    met = reach.z < 0.5;
  }
  return t;
}

float skyOceanStagedReach(vec3 dir, vec3 origin) {
  bool met;
  return skyOceanStagedReach(dir, origin, met);
}

// skyOceanStaged, from where the ray meets the level it tests, `t` along it
// (skyOceanStagedReach). ⚠️ Derivatives.
bool skyOceanStagedAlong(vec3 dir, vec3 origin, float t, float inset, bool sure) {
  float bedAltitude = skyOceanViewAltitude(origin) + uSkyOceanDepth;
  float y = dot(dir, globeCameraUp());
  vec2 p = skyOceanPlane(origin + dir * t);
  // Selected, not scaled: fwidth(t) is infinite at the horizon.
  float dy = sure ? 2.0 * fwidth(y) : 0.0;
  float dt = sure ? 2.0 * fwidth(t) : 0.0;
  float texel = max(length(fwidth(p)), 1e-3);
  bool reaches = bedAltitude < 0.0 ? y > dy : y < -dy;
  return reaches && skyOceanOnStage(p, t + dt, inset * texel);
}

// Whether a stage draws the sea where this view ray first reaches it (the surface from
// above the water, else the seabed), more than `inset` pixels inside its edge. The stage
// and the background both take this test. `sure` adds a margin that holds for the
// pixel's neighbours too, so a quad can skip work by it. ⚠️ Derivatives.
// From above a level, its reach is measured on the curved sea, as a relief's is: on the
// flat plane it would run on past the far plane near the horizon.
bool skyOceanStaged(vec3 dir, vec3 origin, float inset, bool sure) {
  return skyOceanStagedAlong(dir, origin, skyOceanStagedReach(dir, origin), inset, sure);
}

// `color` seen through `dist` of water, tinted as the Ocean's water body tints it.
vec3 skyOceanFog(vec3 color, float dist, float light) {
  return waterFog(color, dist, uSkyOceanFogDensity, uShallowColor, uDeepColor, light);
}

// What lies below the seabed's level, seen by a ray going down along `dir`: the void.
vec3 skyOceanVoid(vec3 dir) {
  #ifdef SKY_ABYSS
  return skyAbyssDepths(dir);
  #else
  return uSkyNadirColor;
  #endif
}

// How much of what lies beyond the seabed it hides where the cutaway covers `cutaway` of it:
// none without one.
float skyOceanFloorShown(float cutaway) {
  return uSkyOceanSeabed > 0.5 ? skyOceanCutawaySeabed(cutaway) * uSkyOceanSeabedOpacity : 0.0;
}

// What a ray reaches at the seabed's level, as a layer over the void beyond (premultiplied,
// its alpha how much of the void it hides): the `bed`, as much as it shows there. `cutaway` is
// how much of it the cutaway covers there.
vec4 skyOceanFloorOver(vec3 bed, float cutaway) {
  float shown = skyOceanFloorShown(cutaway);
  return vec4(bed * shown, shown);
}

// skyOceanFog of a layer (premultiplied) over what lies behind it (waterFogOver).
vec4 skyOceanFogOver(vec4 layer, float dist, float light) {
  return waterFogOver(layer, dist, uSkyOceanFogDensity, uShallowColor, uDeepColor, light);
}

// A layer of the sea over the void beyond it (premultiplied), with that void filled in:
// without an abyss there is no layer of the void's own to draw it (skyAbyssLayer).
vec4 skyOceanOverVoid(vec4 layer, vec3 dir) {
  return vec4(layer.rgb + skyOceanVoid(dir) * (1.0 - layer.a), 1.0);
}

// The seabed at `world`, `depth` under the surface, facing `up` (its up there, globeUpAt):
// lit by the scene's lights, and dimmed by the water over it. The lights are the field's:
// far round the Earth, where the sun has set, it is dark as by night, as the relief's ground
// is (skyDayFrom). ⚠️ Derivatives.
vec3 skyOceanBed(vec3 world, vec3 up, float depth) {
  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 normal = normalize(mat3(viewMatrix) * up);
  vec3 albedo = uSkyOceanBedColor;
  #ifdef SURFACE_DETAIL
  albedo *= surfaceDetail(normal, world, position, 0.0, true);
  #endif
  vec3 lit = sceneBlinnPhong(albedo, uSkyOceanBedSpecular, uSkyOceanBedShininess, uSkyOceanBedAmbient, position, normal) * skyDayFrom(uSkyUp, up);
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  return lit * waterFogDim(depth, uSkyOceanFogDensity) / max(uSkyIntensity, 1e-4);
}

// How far the segment from a view's origin `a` to `b` runs through the water.
float skyOceanWaterPath(vec3 a, vec3 b) {
  float ha = skyOceanViewAltitude(a);
  float hb = skyOceanAltitude(b);
  return waterFogPath(ha, hb, length(b - a), -uSkyOceanDepth, 0.0);
}

// How far the segment from a view's origin `a` to `b` runs below the sea surface: the water
// over a seabed point `b`, however deep it lies.
float skyOceanPathBelowSurface(vec3 a, vec3 b) {
  float ha = skyOceanViewAltitude(a);
  float hb = skyOceanAltitude(b);
  return waterFogPath(ha, hb, length(b - a), -1e30, 0.0);
}

// The light the water between the camera and a seabed point `bedDepth` down carries:
// taken half way down.
float skyOceanBedPathLight(vec3 origin, float bedDepth) {
  float depth = max(-skyOceanViewAltitude(origin), 0.0);
  return skyOceanLight(0.5 * (bedDepth + depth));
}

// The waves at a point of the sea, `dist` along the view ray. Each wave sum compiles to a
// full copy of it and its detail, so a shader shading both sides takes it once.
struct SkyOceanWave {
  vec3 normal;
  vec2 slope;
  float height;
  vec2 np;
  float flatness;
  float rough;
  vec3 up; // the sea's own up there, which the globe tilts
  vec2 p; // where it lies in its chart, for the tonal patches
  float keep; // how much of the waves its chart keeps there (OceanChart): 0 where two meet
};

// The waves at the sea point `delta` from the camera, where the sea's up is `up` (globeUpAt),
// `texel` world units a pixel there: in its chart (ocean-charts.glsl), turned onto the globe
// there, calm on the strip where two charts meet. Once: a second wave sum, to cross-fade
// two charts, cost the stage 1.4–2 ms at the field (D3D), even where no pixel ran it.
SkyOceanWave skyOceanWave(vec3 delta, vec3 up, float texel, float dist) {
  SkyOceanWave wave;
  OceanChart chart = oceanChartAt(delta);
  wave.flatness = oceanFlatness(dist);
  wave.keep = chart.keep;
  wave.up = up;
  wave.p = oceanChartCoords(chart.index, delta);
  vec3 n = oceanWaveNormal(wave.p, texel, 1.0 - (1.0 - wave.flatness) * chart.keep, wave.slope, wave.height, wave.np, wave.rough);
  wave.normal = oceanChartNormal(chart.index, n, up);
  return wave;
}

// World units a pixel spans at the sea point `delta` from the camera, for the waves.
float skyOceanTexel(vec3 delta) {
  return max(length(fwidth(delta)), 1e-3);
}

// The surface seen from above at plane point `p` (the field's wave plane: the stage, the
// contacts), with its `wave` there: its colour, and how much of what lies under it that
// covers. `texel` is world units per pixel. ⚠️ Derivatives.
vec4 skyOceanSurfaceOf(SkyOceanWave wave, vec2 p, float texel, vec3 dir, float blend) {
  float flatness = wave.flatness;
  vec3 normal = wave.normal;
  float night = mix(SKY_NIGHT_LEVEL, 1.0, uSkyDaylight);

  vec3 V = -dir;
  float ndvAA;
  float fresnel = oceanFresnel(normal, V, ndvAA);
  vec3 waterColor = mix(uShallowColor, uDeepColor, clamp(ndvAA, 0.0, 1.0)) * night;
  float tonalReflect;
  float tonalSpec;
  // In the wave's chart, and calm with it where two charts meet.
  oceanTonal(wave.p, 1.0 - (1.0 - flatness) * wave.keep, waterColor, tonalReflect, tonalSpec);

  vec3 r = reflect(dir, normal);
  // Steep waves can tip a reflection below the sea's horizon; mirror it back up. Then the sky
  // it sees is the one over that sea's own horizon, turned onto the up the sky is seen by
  // (globeCameraLook): far off, into the field's frame, it fell below the camera's horizon.
  r -= 2.0 * min(dot(r, wave.up), 0.0) * wave.up;
  r = globeTurnFrom(r, wave.up, globeCameraLook());
  // The glint is the scene's light's, which is the field's: far round the Earth only while it
  // stands over the sea's horizon there (skyLightFrom).
  float glint = skyLightFrom(normalize(uSunDirection), uSkyUp, wave.up);
  vec3 surface = oceanShade(normal, V, waterColor, skySurfaceAt(normalize(r), blend, 0.0), fresnel, tonalReflect, tonalSpec * glint, wave.rough);

  float foamFar;
  float coverage = max(oceanWindFoam(wave.slope, wave.height), oceanContactFoam(p, uTime));
  float foamBlend = oceanFoam(wave.np, texel, coverage, foamFar);
  float foamOpacity = foamBlend * (1.0 - clamp(foamFar * OCEAN_FOAM_FAR_FADE, 0.0, 1.0));
  surface = mix(surface, uFoamColor * night, foamOpacity);
  // Lit as the sky the camera sees is (its daylight, its reflection): far round the Earth,
  // where the sun has set, dark as by night (skyDayFrom).
  surface *= skyDayFrom(globeCameraLook(), wave.up);

  // Far off, where its detail has faded, and from a few kilometres up, the water hides what lies under it.
  float above = skyOceanCameraAltitude();
  float opacity = mix(uOpacity, 1.0, max(flatness, smoothstep(SKY_OCEAN_OPAQUE.x, SKY_OCEAN_OPAQUE.y, above)));
  return vec4(surface, max(mix(opacity, 1.0, fresnel), foamOpacity));
}

// The surface seen from below, its `normal` facing down, `depth` under it: the sky
// through Snell's window, and beyond it the water mirrored. Not yet fogged.
vec3 skyOceanUndersideOf(vec3 normal, vec3 dir, float blend, float depth) {
  vec3 farWater = uDeepColor * skyOceanLight(depth);
  vec3 exitDir = refract(dir, normal, SKY_OCEAN_WATER_IOR);
  if(dot(exitDir, exitDir) <= 0.0)
    return farWater;
  // On the air side, so the window's rim fades to the mirror instead of cutting off.
  // Clamped to 1: straight up through a flat surface it rounds over, and pow() of the
  // negative base is NaN.
  float fresnel = pow(1.0 - clamp(dot(exitDir, -normal), 0.0, 1.0), uFresnelPower);
  return mix(skySurface(normalize(exitDir), blend), farWater, fresnel);
}

// The same at the sea point `delta` from the camera, where the sea's up is `up`, `dist`
// along the view ray. ⚠️ Derivatives.
vec3 skyOceanUnderside(vec3 delta, vec3 up, float texel, float dist, vec3 dir, float blend, float depth) {
  return skyOceanUndersideOf(-skyOceanWave(delta, up, texel, dist).normal, dir, blend, depth);
}

// What is seen from `origin`, in the water, along `dir`, as a layer over the void beyond
// the seabed (premultiplied): the surface's underside above, the seabed below, water all
// round: `bed` as shaded where the view reaches it, `tBed` along (skyOceanBedReach). Both
// level under the camera (globeCameraUp): far off the globe tilts the field's up away.
// ⚠️ Derivatives.
vec4 skyOceanInWaterOver(vec3 origin, vec3 dir, float blend, float tBed, vec3 bed) {
  float altitude = skyOceanViewAltitude(origin);
  float y = dot(dir, globeCameraUp());
  float ay = max(abs(y), 1e-6);
  float wall = skyOceanCutawayWall(origin, dir);

  // Rays that miss a plane take the mirrored hit, so the derivatives stay continuous.
  float tSurface = -altitude / ay;
  vec3 delta = origin - cameraPosition + dir * tSurface;
  vec3 underside = skyOceanUnderside(delta, globeUpAt(origin + dir * tSurface), skyOceanTexel(delta), tSurface, dir, blend, -altitude);
  vec3 above = skyOceanFog(underside, skyOceanCutawayPath(tSurface, wall, 1.0), skyOceanLight(-0.5 * altitude));

  vec3 bedPoint = origin + dir * tBed;
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  vec4 below = skyOceanFogOver(skyOceanFloorOver(bed, cutaway), skyOceanCutawayPath(tBed, wall, skyOceanCutawayWater(cutaway)), skyOceanBedPathLight(origin, uSkyOceanDepth));

  return y > 0.0 ? vec4(above, 1.0) : below;
}

// Whether the background needs its view in the water from a camera at `origin`: in the
// water. From the void below, seabed or not, its lid hides the water (skyAbyss).
bool skyOceanNeedsWaterView(vec3 origin) {
  float altitude = skyOceanViewAltitude(origin);
  return uSkyOceanWater > 0.5 && altitude <= 0.0 && altitude + uSkyOceanDepth > 0.0;
}

// Whether the background sees the seabed from `origin`: from anywhere above it.
bool skyOceanSeesBed(vec3 origin) {
  return skyOceanViewAltitude(origin) + uSkyOceanDepth > 0.0;
}

// Where the background's view along `dir` from `origin` reaches the seabed: x along it, z
// 1 where it misses it (skyOceanReach). From in the water (`inWater`) straight to its
// plane, level under the camera (globeCameraUp), the mirrored hit for a ray going up so the
// derivatives stay continuous; else as skyOceanReach finds it. The bed is shaded once there
// (skyOceanBed): each call compiles a full copy of its detail.
vec3 skyOceanBedReach(vec3 origin, vec3 dir, bool inWater) {
  float altitude = skyOceanViewAltitude(origin);
  if(inWater)
    return vec3(max(altitude + uSkyOceanDepth, 0.0) / max(abs(dot(dir, globeCameraUp())), 1e-6), 0.0, 0.0);
  return skyOceanReach(origin, dir, altitude + uSkyOceanDepth);
}

// From the air, or from below a dry sea's level, where a view along `dir` from `origin`
// meets the water (`reach`, the seabed's skyOceanBedReach): x how far along it, y 1 where it
// misses the sea. Rays that never reach the water take the mirrored hits, so the derivatives
// stay continuous. Dry, the bed is the same distance away from below the sea level too.
// Beyond the scene both fall away with the Earth's curve: above the sea's horizon there is
// neither, though the seabed's is lower. The sea's layer and the void's under it both take it.
vec2 skyOceanFromAirReach(vec3 origin, vec3 dir, vec3 reach) {
  float altitude = skyOceanViewAltitude(origin);
  bool wet = altitude > 0.0 && uSkyOceanWater > 0.5;
  vec3 surface = skyOceanReach(origin, dir, altitude);
  return vec2(surface.x, (wet ? surface.z : reach.z) < 0.5 ? 0.0 : 1.0);
}

// The background's sea seen from the air, or from below a dry sea's level, for a camera at
// `origin` looking along `dir`: only the seabed through the water, as a layer over the void
// beyond it (premultiplied). The surface is a layer of its own, blended over it (and over a
// stage) by the GPU, so the sky and a stage composite it the same way. The seabed is `bed`,
// as shaded where the view reaches it (`reach`, skyOceanBedReach). `reached` is whether the
// view meets the sea at all: nothing where it does not.
vec4 skyOceanFromAir(vec3 dir, vec3 origin, float blend, vec3 reach, vec3 bed, out bool reached) {
  float altitude = skyOceanViewAltitude(origin);
  float ay = max(abs(dot(dir, uSkyUp)), 1e-6);
  bool wet = altitude > 0.0 && uSkyOceanWater > 0.5;
  vec2 surface = skyOceanFromAirReach(origin, dir, reach);
  // Dry, the fog is off.
  float path = wet && uSkyCurvature > 0.0 ? max(reach.x - surface.x, 0.0) : uSkyOceanDepth / ay;
  vec3 bedPoint = origin + dir * reach.x;
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  vec4 seen = skyOceanFogOver(skyOceanFloorOver(bed, cutaway), path * skyOceanCutawayWater(cutaway), skyOceanBedPathLight(origin, uSkyOceanDepth));
  // Dry, from high up: through the air and as space sees it, as the relief's ground past
  // which it shows. Eased in by the same share, so nothing changes in the air. Over an
  // opaque surface the air's light is what it adds to the share of it that it keeps.
  float space = skyFromSpace();
  if(!wet && space > 0.0) {
    float keep;
    vec3 air = skyOceanThroughAirOver(vec4(vec3(0.0), 1.0), origin, dir, reach.x, blend, true, keep).rgb;
    seen = mix(seen, vec4(keep * seen.rgb + air, 1.0 - keep * (1.0 - seen.a)), space);
  }

  reached = surface.y < 0.5;
  return reached ? seen : vec4(0.0);
}

// A view down through a gap the cutaway opened in a stage's seabed, as a layer over what
// lies below it (premultiplied): the water it left, down to the seabed's level. Nothing
// outside the cutaway.
vec4 skyOceanThroughCutawayOver(vec3 dir, vec3 origin) {
  float down = -dot(dir, uSkyUp);
  if(uSkyOceanCutawayShape.y <= 0.0 || down <= 0.0)
    return vec4(0.0);
  float bedAltitude = skyOceanViewAltitude(origin) + uSkyOceanDepth;
  vec3 bedPoint = origin + dir * (max(bedAltitude, 0.0) / down);
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  float path = skyOceanPathBelowSurface(origin, bedPoint) * skyOceanCutawayWater(cutaway) * cutaway;
  return skyOceanFogOver(vec4(0.0), path, skyOceanBedPathLight(origin, uSkyOceanDepth));
}

// `color` seen down through a gap the cutaway opened in a stage's seabed (as
// skyOceanThroughCutawayOver). Untouched outside the cutaway.
vec3 skyOceanThroughCutaway(vec3 color, vec3 dir, vec3 origin) {
  vec4 water = skyOceanThroughCutawayOver(dir, origin);
  return water.rgb + color * (1.0 - water.a);
}

// What a stage leaves the background along a view ray (skyOceanStaged), as each of the
// background's layers takes it: whether the stage draws the sea there (`staged`); surely so
// for the pixel's neighbours too, so the sea's own work is skipped there (`skip`); and
// whether the ray runs below the sea's curved horizon (`below`), from a little below it, so
// none of what the stage leaves is the void. ⚠️ Derivatives: both tests are taken whatever
// they find.
struct SkyOceanStagedView {
  bool staged;
  bool skip;
  bool below;
};

SkyOceanStagedView skyOceanStagedView(vec3 dir, vec3 origin) {
  float y = dot(dir, globeCameraLook());
  float dy = fwidth(y);
  // The ray's reach found once for both tests. Kept a few pixels inside the stage's rim, so
  // the rim still has the seabed behind it. Without a seabed there is nothing to leave to
  // the stage, nor from inside an occupant's. From in the water a ray that only grazes the
  // seabed's curve, just under the level, meets no stage: nothing lies under the water's
  // layer to show there, so it is the water's own.
  bool met;
  float stagedAt = skyOceanStagedReach(dir, origin, met);
  bool staged = skyOceanStagedAlong(dir, origin, stagedAt, 4.0, false);
  bool surely = skyOceanStagedAlong(dir, origin, stagedAt, 8.0, true);
  SkyOceanStagedView view;
  view.staged = staged && (met || !skyOceanNeedsWaterView(origin)) && uSkyOceanSeabed > 0.5 && uSkyOceanBuried < 0.5;
  view.skip = view.staged && surely;
  view.below = y < (uSkyCurvature > 0.0 ? skyHorizon(dir) - 2.0 * dy : 0.0);
  return view;
}

// Whether the void shows along a view, under the sea the background draws (skyOceanFloorOver:
// no seabed, a see-through one or the cutaway taking it) or through a stage's gaps below the
// horizon (skyOceanThroughCutawayOver), from a camera above the seabed: where the void's layer
// is drawn under the sea's (skyAbyssLayer). The same tests as the sea's layers take.
bool skyOceanShowsVoid(vec3 dir, vec3 origin, SkyOceanStagedView staged) {
  if(staged.staged && staged.below)
    return true;
  if(staged.skip || !skyOceanSeesBed(origin))
    return false;
  bool water = skyOceanNeedsWaterView(origin);
  vec3 reach = skyOceanBedReach(origin, dir, water);
  bool floor = water ? dot(dir, globeCameraUp()) <= 0.0 : skyOceanFromAirReach(origin, dir, reach).y < 0.5;
  return floor && skyOceanFloorShown(skyOceanCutawayAlong(origin, origin + dir * reach.x)) < 1.0;
}


// The background's sea surface, as its own layer: colour, and the opacity to blend it
// with. Nothing where the ray misses it or a stage draws it. ⚠️ Derivatives.
vec4 skyOceanSurfaceLayer(vec3 dir, vec3 origin, float blend) {
  float altitude = skyOceanViewAltitude(origin);
  if(altitude <= 0.0)
    return vec4(0.0);

  float y = dot(dir, globeCameraLook());
  vec3 reach = skyOceanReach(origin, dir, altitude);
  float t = reach.x;
  vec2 p = skyOceanPlane(origin + dir * t);
  float texel = max(length(fwidth(p)), 1e-3);
  #ifndef SKY_NO_GRATICULE
  // Where it lies on the Earth, for the lines over it, before anything branches.
  GraticuleAt graticule = graticuleAt(origin + dir * t);
  #endif
  vec3 delta = origin - cameraPosition + dir * t;
  float waveTexel = skyOceanTexel(delta);
  vec2 rimAt = skyOceanCutawayRimAt(origin + dir * t, origin);
  // Skipped where hidden with a margin, so a quad's pixels that still shade are hidden too
  // and the derivatives they take across the skipped ones never show. From the level the
  // camera sees the sky by (globeCameraLook): its own far off, where the field's is not up.
  float over = y - skyHorizonAt(dir, altitude);
  if(over >= 2.0 * fwidth(y) || skyOceanOnStage(p, t + 2.0 * fwidth(t), 4.0 * texel))
    return vec4(0.0);
  SkyOceanWave wave = skyOceanWave(delta, globeUpAt(origin + dir * t), waveTexel, t);
  vec4 surface = skyOceanSurfaceOf(wave, p, waveTexel, dir, blend);
  // The band a pixel inside the stage's edge too, which the stage leaves to this layer:
  // the same test on both sides (skyOceanStaged), so every pixel is drawn exactly once. All
  // zero, so a colour from those derivatives cannot reach the blend.
  if(reach.z > 0.5 || skyOceanOnStage(p, t, texel))
    return vec4(0.0);
  vec4 seen = skyOceanCutawayMark(skyOceanThroughAir(surface, origin, dir, t, blend), origin + dir * t, rimAt);
  #ifndef SKY_NO_GRATICULE
  seen.rgb = graticuleOver(seen.rgb, graticule);
  #endif
  return seen;
}

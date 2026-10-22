// An endless sea for the sky: a wavy surface at uSkyOceanLevel over a flat seabed
// uSkyOceanDepth below it. The surface is shaded by the Ocean component's own code from
// an OceanMaterial's uniforms (see SkyMaterial.linkOcean), so the two look the same.
// The background finds both planes per pixel; a stage (SkyBoxStage) draws the same
// functions on real geometry, which is how the scene gets water in front of it.
// Below the seabed the abyss takes over. The seabed is lit by the scene's lights with a
// ChunkMaterial's model and options, so an occupant's own seabed can continue it.
//
// ⚠️ The shared shading takes screen-space derivatives: call these functions under
// uniform control flow, and pick a result only afterwards. Skipping them is safe only
// where every pixel of the 2x2 quad discards the result (see skyOceanStaged's `sure`).

#include ../../Ocean/shaders/ocean-surface.glsl
#include <bsdfs>
#include <lights_pars_begin>
#include ../../../sdk/materials/shaderLib/scene-light.glsl
#include ../../../sdk/materials/shaderLib/surface-detail.glsl
#include ../../../sdk/materials/shaderLib/water-fog.glsl

#define SKY_OCEAN_WATER_IOR 1.333
// Over the sea, the camera's heights over which the water turns opaque (world units).
#define SKY_OCEAN_OPAQUE vec2(2000.0, 5000.0)

uniform float uSkyOceanLevel; // along uSkyUp
uniform float uSkyOceanDepth;
uniform vec3 uSkyOceanBedColor;
uniform vec3 uSkyOceanBedSpecular;
uniform float uSkyOceanBedShininess;
uniform vec2 uSkyOceanBedAmbient; // x: facing up, y: facing down
uniform float uSkyOceanFogDensity; // per world unit
uniform float uSkyOceanBuried; // 1: the camera is inside an occupant's seabed above the sea's (SkyMaterial.oceanBuried)
uniform float uSkyOceanWater; // 0: no water, the seabed lies dry (SkyMaterial.oceanWater)
uniform float uSkyOceanSeabed; // 0: no seabed, the void lies below the water (SkyMaterial.oceanSeabed)
uniform float uSkyOceanSeabedOpacity; // how much of the void beyond the seabed it hides (SkyMaterial.oceanSeabedOpacity)
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
  if(dot(origin, uSkyUp) > uSkyOceanLevel || uSkyOceanCutawayCuts.x <= 0.0)
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
vec4 skyOceanThroughAir(vec4 surface, vec3 origin, vec3 dir, float dist, float blend) {
  float haze = skyAirHaze(origin, dir, dist);
  if(haze <= 0.0)
    return surface;
  vec3 level = dir - uSkyUp * dot(dir, uSkyUp);
  float n2 = dot(level, level);
  vec3 horizon = n2 > 1e-8 ? skyHorizonColor(level * inversesqrt(n2), blend) : vec3(0.0);
  float toward = n2 * n2;
  if(toward < 0.999)
    horizon = mix(skySurfaceAt(uSkyUp, blend, 0.0), horizon, toward);
  float alpha = haze + (1.0 - haze) * surface.a;
  return vec4((haze * horizon + (1.0 - haze) * surface.a * surface.rgb) / alpha, alpha);
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

// A +Y-up vector of the wave plane, in the world.
vec3 skyOceanLift(vec3 v) {
  return uSkyEast * v.x + uSkyUp * v.y - uSkyNorth * v.z;
}

// Where a view ray from `origin`, `height` above a level of the sea (its surface or its
// seabed), meets it: flat over the disc about the scene (uSkyFlat), falling away with the
// Earth's curve beyond. How far along the ray, how steeply the level falls away from the
// camera there, and 1 if the ray misses it; a miss takes the mirrored or the grazing hit,
// so the derivatives stay continuous.
vec3 skyOceanReach(vec3 origin, vec3 dir, float height) {
  float y = dot(dir, uSkyUp);
  float plane = height / max(abs(y), 1e-6);
  float missed = y < 0.0 ? 0.0 : 1.0;
  if(uSkyCurvature <= 0.0 || height <= 0.0)
    return vec3(plane, 0.0, missed);
  vec3 level = dir - uSkyUp * y;
  float c = length(level);
  float run = c > 1e-6 ? skyFlatRun(origin, level / c) : uSkyFlat.w;
  // Down before the disc's edge.
  if(height * c + y * run <= 0.0)
    return vec3(plane, 0.0, missed);
  // Past it, k/2 (c t - run)^2 below the level: k/2 c^2 t^2 + b t + h = 0, its nearer root.
  float k = uSkyCurvature;
  float b = y - k * c * run;
  float h = height + 0.5 * k * run * run;
  float d = b * b - 2.0 * k * c * c * h;
  float t = 2.0 * h / (abs(b) + sqrt(max(d, 0.0)));
  return vec3(t, k * max(c * t - run, 0.0), b < 0.0 && d >= 0.0 ? 0.0 : 1.0);
}

// `normal` on the sea where it falls away from a camera looking along `dir` by `fall`
// (skyOceanReach), tipped with it: at the horizon the view then grazes it.
vec3 skyOceanTilt(vec3 normal, vec3 dir, float fall) {
  if(fall <= 0.0)
    return normal;
  vec3 level = dir - uSkyUp * dot(dir, uSkyUp);
  return normalize(normal + level * (fall * inversesqrt(max(dot(level, level), 1e-12))));
}

// Daylight left `depth` below the surface; night keeps a little, as the sky does.
float skyOceanLight(float depth) {
  return waterFogLight(depth, uSkyOceanFogDensity, uSkyDaylight);
}

// Whether a stage draws the sea where this view ray first reaches it (the surface from
// above the water, else the seabed), more than `inset` pixels inside its edge. The stage
// and the background both take this test. `sure` adds a margin that holds for the
// pixel's neighbours too, so a quad can skip work by it. ⚠️ Derivatives.
bool skyOceanStaged(vec3 dir, vec3 origin, float inset, bool sure) {
  float altitude = dot(origin, uSkyUp) - uSkyOceanLevel;
  float bedAltitude = altitude + uSkyOceanDepth;
  float y = dot(dir, uSkyUp);
  bool surface = altitude > 0.0 && uSkyOceanWater > 0.5;
  float t = abs(surface ? altitude : bedAltitude) / max(abs(y), 1e-6);
  vec2 p = skyOceanPlane(origin + dir * t);
  // Selected, not scaled: fwidth(t) is infinite at the horizon.
  float dy = sure ? 2.0 * fwidth(y) : 0.0;
  float dt = sure ? 2.0 * fwidth(t) : 0.0;
  float texel = max(length(fwidth(p)), 1e-3);
  bool reaches = bedAltitude < 0.0 ? y > dy : y < -dy;
  return reaches && skyOceanOnStage(p, t + dt, inset * texel);
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

// What a ray reaches at the seabed's level: the `bed`, or the void (`depths`) where there
// is none, and through it as much as its opacity leaves. `cutaway` is how much of it the
// cutaway covers there.
vec3 skyOceanFloor(vec3 bed, vec3 depths, float cutaway) {
  float shown = uSkyOceanSeabed > 0.5 ? skyOceanCutawaySeabed(cutaway) * uSkyOceanSeabedOpacity : 0.0;
  return mix(depths, bed, shown);
}

// From the void below a sea without a seabed, `color` recedes into the void's horizon
// over the distance the ray crosses the void, as the lid does.
vec3 skyOceanThroughVoid(vec3 color, vec3 origin, vec3 dir) {
  #ifdef SKY_ABYSS
  float under = uSkyOceanLevel - uSkyOceanDepth - dot(origin, uSkyUp);
  if(uSkyOceanSeabed > 0.5 || under <= 0.0)
    return color;
  float reach = under / max(dot(dir, uSkyUp), 1e-6);
  return mix(uSkyAbyssHorizonColor, color, exp(-reach / uSkyAbyssFadeDistance));
  #else
  return color;
  #endif
}

// The seabed at `world`, `depth` under the surface, facing `up` (the slope it lies on):
// lit by the scene's lights, and dimmed by the water over it. ⚠️ Derivatives.
vec3 skyOceanBed(vec3 world, vec3 up, float depth) {
  vec3 position = (viewMatrix * vec4(world, 1.0)).xyz;
  vec3 normal = normalize(mat3(viewMatrix) * up);
  vec3 albedo = uSkyOceanBedColor;
  #ifdef SURFACE_DETAIL
  albedo *= surfaceDetail(normal, world, position, 0.0, true);
  #endif
  vec3 lit = sceneBlinnPhong(albedo, uSkyOceanBedSpecular, uSkyOceanBedShininess, uSkyOceanBedAmbient, position, normal);
  // The sky's own scale is applied to everything it draws, last; a lit surface keeps the scene's.
  return lit * waterFogDim(depth, uSkyOceanFogDensity) / max(uSkyIntensity, 1e-4);
}

// How far the segment from `a` to `b` runs through the water.
float skyOceanWaterPath(vec3 a, vec3 b) {
  float ha = dot(a, uSkyUp) - uSkyOceanLevel;
  float hb = dot(b, uSkyUp) - uSkyOceanLevel;
  return waterFogPath(ha, hb, length(b - a), -uSkyOceanDepth, 0.0);
}

// How far the segment from `a` to `b` runs below the sea surface: the water over a
// seabed point `b`, however deep it lies.
float skyOceanPathBelowSurface(vec3 a, vec3 b) {
  float ha = dot(a, uSkyUp) - uSkyOceanLevel;
  float hb = dot(b, uSkyUp) - uSkyOceanLevel;
  return waterFogPath(ha, hb, length(b - a), -1e30, 0.0);
}

// The light the water between the camera and a seabed point `bedDepth` down carries:
// taken half way down.
float skyOceanBedPathLight(vec3 origin, float bedDepth) {
  float depth = max(uSkyOceanLevel - dot(origin, uSkyUp), 0.0);
  return skyOceanLight(0.5 * (bedDepth + depth));
}

// The waves at plane point `p`, `dist` along the view ray. Each call compiles to a full
// copy of the wave sum and its detail, so a shader shading both sides takes it once.
// ⚠️ Derivatives.
struct SkyOceanWave {
  vec3 normal;
  vec2 slope;
  float height;
  vec2 np;
  float flatness;
  float rough;
};

SkyOceanWave skyOceanWave(vec2 p, float texel, float dist) {
  SkyOceanWave wave;
  wave.flatness = oceanFlatness(dist);
  wave.normal = skyOceanLift(oceanWaveNormal(p, texel, wave.flatness, wave.slope, wave.height, wave.np, wave.rough));
  return wave;
}

// The surface seen from above at plane point `p`, with its `wave` there: its colour,
// and how much of what lies under it that covers. `texel` is world units per pixel.
// ⚠️ Derivatives.
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
  oceanTonal(p, flatness, waterColor, tonalReflect, tonalSpec);

  vec3 r = reflect(dir, normal);
  // Steep waves can tip a reflection below the horizon; mirror it back up. As seen from the
  // sea: a level horizon, under all the air.
  r -= 2.0 * min(dot(r, uSkyUp), 0.0) * uSkyUp;
  vec3 surface = oceanShade(normal, V, waterColor, skySurfaceAt(normalize(r), blend, 0.0), fresnel, tonalReflect, tonalSpec, wave.rough);

  float foamFar;
  float coverage = max(oceanWindFoam(wave.slope, wave.height), oceanContactFoam(p, uTime));
  float foamBlend = oceanFoam(wave.np, texel, coverage, foamFar);
  float foamOpacity = foamBlend * (1.0 - clamp(foamFar * OCEAN_FOAM_FAR_FADE, 0.0, 1.0));
  surface = mix(surface, uFoamColor * night, foamOpacity);

  // Far off, where its detail has faded, and from a few kilometres up, the water hides what lies under it.
  float above = dot(cameraPosition, uSkyUp) - uSkyOceanLevel;
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
  float fresnel = pow(1.0 - max(dot(exitDir, -normal), 0.0), uFresnelPower);
  return mix(skySurface(normalize(exitDir), blend), farWater, fresnel);
}

// The same at plane point `p`, `dist` along the view ray. ⚠️ Derivatives.
vec3 skyOceanUnderside(vec2 p, float texel, float dist, vec3 dir, float blend, float depth) {
  return skyOceanUndersideOf(-skyOceanWave(p, texel, dist).normal, dir, blend, depth);
}

// What is seen from `origin`, in the water, along `dir`: the surface's underside above,
// the seabed `bedDepth` down below, water all round. `travelled` is how far the view ray
// came to reach `origin`; `depths` the void along it (skyOceanVoid). ⚠️ Derivatives.
vec3 skyOceanInWater(vec3 origin, vec3 dir, float blend, float travelled, float bedDepth, vec3 depths) {
  float altitude = dot(origin, uSkyUp) - uSkyOceanLevel;
  float y = dot(dir, uSkyUp);
  float ay = max(abs(y), 1e-6);
  float wall = skyOceanCutawayWall(origin, dir);

  // Rays that miss a plane take the mirrored hit, so the derivatives stay continuous.
  float tSurface = -altitude / ay;
  vec2 p = skyOceanPlane(origin + dir * tSurface);
  float texel = max(length(fwidth(p)), 1e-3);
  vec3 underside = skyOceanUnderside(p, texel, travelled + tSurface, dir, blend, -altitude);
  vec3 above = skyOceanFog(underside, skyOceanCutawayPath(tSurface, wall, 1.0), skyOceanLight(-0.5 * altitude));

  float tBed = max(altitude + bedDepth, 0.0) / ay;
  vec3 bedPoint = origin + dir * tBed;
  vec3 bed = skyOceanBed(bedPoint, uSkyUp, bedDepth);
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  vec3 ground = skyOceanFloor(bed, depths, cutaway);
  vec3 below = skyOceanFog(ground, skyOceanCutawayPath(tBed, wall, skyOceanCutawayWater(cutaway)), skyOceanBedPathLight(origin, bedDepth));

  return y > 0.0 ? above : below;
}

// Whether the background needs its view in the water from a camera at `origin`: in the
// water, or under a sea with no seabed.
bool skyOceanNeedsWaterView(vec3 origin) {
  float altitude = dot(origin, uSkyUp) - uSkyOceanLevel;
  bool inWater = altitude <= 0.0 && altitude + uSkyOceanDepth > 0.0;
  bool underSea = altitude + uSkyOceanDepth < 0.0 && uSkyOceanSeabed < 0.5;
  return uSkyOceanWater > 0.5 && (inWater || underSea);
}

// That view: from the camera in the water, or from where a ray up from the void enters a
// sea with no seabed. Each call compiles a full copy of the waves, so it is taken once
// (see skyOcean and skyOceanFromBelow). ⚠️ Derivatives.
vec3 skyOceanWaterView(vec3 dir, vec3 origin, float blend, vec3 depths) {
  float under = uSkyOceanLevel - uSkyOceanDepth - dot(origin, uSkyUp);
  float reach = max(under, 0.0) / max(abs(dot(dir, uSkyUp)), 1e-6);
  return skyOceanInWater(origin + dir * reach, dir, blend, reach, uSkyOceanDepth, depths);
}

// The background's sea, for a camera at `origin` looking along `dir`, `inWater` its view
// from in the water (skyOceanWaterView) and `depths` the void along it (skyOceanVoid).
// From above the water it is only the seabed: the surface is a layer of its own, blended
// over it (and over a stage) by the GPU, so the sky and a stage composite it the same way.
vec3 skyOcean(vec3 color, vec3 dir, vec3 origin, vec3 inWater, vec3 depths) {
  float altitude = dot(origin, uSkyUp) - uSkyOceanLevel;
  if(altitude + uSkyOceanDepth <= 0.0)
    return color;
  if(altitude <= 0.0 && uSkyOceanWater > 0.5) {
    // Up through the cutaway's cut, which takes the surface over it too: the sky.
    float rise = dot(dir, uSkyUp);
    bool through = rise > 0.0 && skyOceanCutawayWall(origin, dir) * rise > -altitude;
    return through ? mix(inWater, color, uSkyOceanCutawayCuts.x) : inWater;
  }

  float y = dot(dir, uSkyUp);
  float ay = max(abs(y), 1e-6);
  // Rays that never reach the water take the mirrored hits, so the derivatives stay
  // continuous; they are discarded at the end. Dry, the bed is the same distance away
  // from below the sea level too, and the fog is off. Beyond the scene both fall away with
  // the Earth's curve: above the sea's horizon there is neither, though the seabed's is lower.
  vec3 reach = skyOceanReach(origin, dir, altitude + uSkyOceanDepth);
  bool wet = altitude > 0.0 && uSkyOceanWater > 0.5;
  vec3 surface = skyOceanReach(origin, dir, altitude);
  float missed = wet ? surface.z : reach.z;
  float path = wet && uSkyCurvature > 0.0 ? max(reach.x - surface.x, 0.0) : uSkyOceanDepth / ay;
  vec3 bedPoint = origin + dir * reach.x;
  vec3 bed = skyOceanBed(bedPoint, uSkyUp, uSkyOceanDepth);
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  vec3 ground = skyOceanFloor(bed, depths, cutaway);
  vec3 seen = skyOceanFog(ground, path * skyOceanCutawayWater(cutaway), skyOceanBedPathLight(origin, uSkyOceanDepth));

  return missed < 0.5 ? seen : color;
}

// `color` seen down through a gap the cutaway opened in a stage's seabed: under the water it
// left, down to the seabed's level. Untouched outside the cutaway.
vec3 skyOceanThroughCutaway(vec3 color, vec3 dir, vec3 origin) {
  float down = -dot(dir, uSkyUp);
  if(uSkyOceanCutawayShape.y <= 0.0 || down <= 0.0)
    return color;
  float bedAltitude = dot(origin, uSkyUp) - uSkyOceanLevel + uSkyOceanDepth;
  vec3 bedPoint = origin + dir * (max(bedAltitude, 0.0) / down);
  float cutaway = skyOceanCutawayAlong(origin, bedPoint);
  float path = skyOceanPathBelowSurface(origin, bedPoint) * skyOceanCutawayWater(cutaway) * cutaway;
  return skyOceanFog(color, path, skyOceanBedPathLight(origin, uSkyOceanDepth));
}

// A sea without a seabed, seen from the void below it: no lid, the water from the
// seabed's level up (`inWater`, see skyOceanWaterView); `open` (the sky) where it is dry.
vec3 skyOceanFromBelow(vec3 dir, vec3 origin, vec3 open, vec3 inWater) {
  return skyOceanThroughVoid(uSkyOceanWater > 0.5 ? inWater : open, origin, dir);
}

// The background's sea surface, as its own layer: colour, and the opacity to blend it
// with. Nothing where the ray misses it or a stage draws it. ⚠️ Derivatives.
vec4 skyOceanSurfaceLayer(vec3 dir, vec3 origin, float blend) {
  float altitude = dot(origin, uSkyUp) - uSkyOceanLevel;
  if(altitude <= 0.0)
    return vec4(0.0);

  float y = dot(dir, uSkyUp);
  // Where a stage draws it is told on the flat plane, as the stage's geometry lies.
  float plane = altitude / max(abs(y), 1e-6);
  vec2 onPlane = skyOceanPlane(origin + dir * plane);
  float planeTexel = max(length(fwidth(onPlane)), 1e-3);
  vec3 reach = skyOceanReach(origin, dir, altitude);
  float t = reach.x;
  vec2 p = skyOceanPlane(origin + dir * t);
  float texel = max(length(fwidth(p)), 1e-3);
  vec2 rimAt = skyOceanCutawayRimAt(origin + dir * t, origin);
  // Skipped where hidden with a margin, so a quad's pixels that still shade are hidden too
  // and the derivatives they take across the skipped ones never show.
  float over = y - skyHorizonAt(dir, origin, altitude);
  if(over >= 2.0 * fwidth(y) || skyOceanOnStage(onPlane, plane + 2.0 * fwidth(plane), 4.0 * planeTexel))
    return vec4(0.0);
  SkyOceanWave wave = skyOceanWave(p, texel, t);
  wave.normal = skyOceanTilt(wave.normal, dir, reach.y);
  vec4 surface = skyOceanSurfaceOf(wave, p, texel, dir, blend);
  // The band a pixel inside the stage's edge too, which the stage leaves to this layer:
  // the same test on both sides, so every pixel is drawn exactly once. All zero, so a
  // colour from those derivatives cannot reach the blend.
  if(reach.z > 0.5 || skyOceanOnStage(onPlane, plane, planeTexel))
    return vec4(0.0);
  return skyOceanCutawayMark(skyOceanThroughAir(surface, origin, dir, t, blend), origin + dir * t, rimAt);
}

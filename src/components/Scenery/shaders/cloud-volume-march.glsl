// The 3D clouds (SceneryCloudVolume), marched along each pixel's view ray through each cloud
// layer's shell about the Earth's centre, at a share of the screen's resolution. Written as
// premultiplied linear colour and alpha, and as depth log2 of the distance to their front
// (CLOUD_FRONT): the composite (cloud-volume-composite.glsl) draws them over the scene at that
// depth.
// One colour attachment, so ANGLE compiles its pixel shader once (scenery.md, Performance).
//
// One field on the globe, at every distance (documents/clouds.md). Close up each step reads
// the coverage and the puffs that roughen its edge; further off the noise's coarser levels
// average them, the coverage's edge widens by the spread the averaging lost, and the steps
// lengthen, until from space a layer is a sample or two of its mean: the clouds draped over
// the Earth. What a step hides is worked out per chord of a cloud along the view
// (cloudExtinction), so a mean of cloud and clear sky hides what the clouds would, not a haze
// of their density. Over the ground (a relief's: the clouds' terrain) the layers rise with its
// broad height, gain cover up the slopes the wind blows up near the scene, and each view ends
// where it meets the ground, so what stands in a layer is veiled by the cloud in front of it
// and hides the cloud behind.

#include <common>
#include ./sky-gradient.glsl

uniform float uSkyHorizonBlend;
uniform vec3 uSkyEast;
uniform vec3 uSkyMoonDirection;
uniform vec3 uSkyMoonColor;
uniform float uSkyMoonPhase;
uniform float uSkySunRadiance;

uniform sampler3D uCloudNoise; // CloudNoise: r shape, g puffs, b wisps, a broad
uniform float uCloudNoiseSize; // texels along a side of its tile
// Blue noise (createBlueNoise), read by pixel: what jitters each run's first step.
uniform sampler2D uCloudBlueNoise;
// The noise volumes (cloud-noise-volume.glsl): the shape's (r Perlin-Worley, gba Worley at
// three scales) and the detail's (rgb Worley at three scales, a wisps).
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;
// The detail volume's period (world units), and the texels along the shape volume's side.
uniform vec2 uCloudVolumes;
uniform mat3 uCloudEarth; // world -> fixed on the Earth
uniform mat3 uCloudTurn; // fixed on the Earth -> the coverage's broad octave's frame
uniform vec3 uCloudCameraEarth; // the camera from the sphere's centre, fixed on the Earth
// The scene's up, fixed on the Earth: for the globe off, and toward the middle of the scene
// (the disc's centre).
uniform vec3 uCloudUpEarth;
// Where the camera lies in each pattern (CLOUD_OFFSET_*), from 64-bit floats: in its tile for
// the noise's, modulo 289 cells for the procedural ones. What is added to a point's offset
// from the camera, over the period, to read the pattern there.
uniform vec3 uCloudOffsets[4 * CLOUD_LAYERS + 3];
// The layers, one at each level from the ground up (cloudVolumeSlots in
// scenery-cloud-volume.ts), each as its type looks (CloudLook there):
// its base and top over the sea's sphere, its cover, and its level (0 low, 1 middle, 2 high:
// the cloud map's channel far off, cloudMapAt);
uniform vec4 uCloudLayers[CLOUD_LAYERS];
// its extinction in cloud (1 / world unit), its edge's softness, how far its coverage's level
// rises toward its tops (heaped), and how far it lines up into rows (uCloudRows);
uniform vec4 uCloudLooks[CLOUD_LAYERS];
// its billows' and detail's reach (in the coverage's standard deviations), how much flatter
// its billows are than they are broad, and how much they take of the Worley billows;
uniform vec4 uCloudShapes[CLOUD_LAYERS];
// its coverage's period and its shape volume's (world units), and its density up the layer:
// all of it from the first share of its thickness up, none again from the second to its top;
uniform vec4 uCloudForms[CLOUD_LAYERS];
// how far it is drawn out along the wind (1 / stretch − 1: cloudStretched), its detail at its
// base (wisps 1, or its billows' undersides 0), the optical depth straight up through the
// layers over it, and how far its base rises and falls (a share of its thickness);
uniform vec4 uCloudStyles[CLOUD_LAYERS];
// across its rows (along the wind, or across it), fixed on the Earth, over their spacing (xyz),
// and where the camera lies among them (w).
uniform vec4 uCloudRows[CLOUD_LAYERS];
// and its wind at its level, fixed on the Earth: the way it blows (xyz), which its clouds are
// drawn out along and drift with, and its speed (w, m/s).
uniform vec4 uCloudWinds[CLOUD_LAYERS];
uniform int uCloudLayerCount;
uniform float uCloudQuantiles[17]; // the coverage's distribution (CloudNoise.coverage)
// The coverage's standard deviation and its mean.
uniform vec2 uCloudCoverage;
// The weather far off (scenery-cloud-map.ts): over the Earth, fixed on it, the share of the
// ground under cloud (r) and how thick it is (g). As the clock runs, two drawings of it some
// time apart, blended (cloudMapRead): the older, the newer, the newer's share, and how long ago
// each was drawn (weather seconds).
uniform samplerCube uCloudMap;
uniform samplerCube uCloudMapNext;
uniform vec3 uCloudMapTimes;
// The weather systems' strength (0 to 1), how far from the middle of the scene the scene's
// layers start giving way to them and where they have (world units), and the map's texels per
// world unit.
uniform vec4 uCloudWeather;
// The period of the field that warps where the coverage is read (world units).
uniform float uCloudWarp;
// The ground (scenery-cloud-terrain.ts), fixed on the Earth: over all of it its height over the
// sea (r, metres; the sea's level under the sea) and its slope east and north (g, b); about the
// camera its height alone, finer, on a square on the plane touching the Earth at its middle,
// reaching uCloudTerrainNearReach (a tangent) from it to its sides. uCloudTerrain: x 1 with the
// Earth's, y the highest ground, z 1 with the map about the camera.
uniform samplerCube uCloudTerrainMap;
uniform sampler2D uCloudTerrainNear;
uniform vec3 uCloudTerrainNearCentre;
uniform vec3 uCloudTerrainNearEast;
uniform vec3 uCloudTerrainNearNorth;
uniform float uCloudTerrainNearReach;
uniform vec4 uCloudTerrain;
// The wind at the scene, fixed on the Earth: the way it blows (xyz), and its speed (w, m/s).
uniform vec4 uCloudWind;
// The most steps, the shortest step (world units), the step's growth with distance, a
// pixel's angle (radians).
uniform vec4 uCloudMarch;
// Samples toward the light close up (2): further off, one.
uniform int uCloudLightSamples;
// Frames drawn so far (by this camera), for the jitter that moves on each frame.
uniform float uCloudFrame;
uniform vec3 uCloudColor;

varying vec3 vCloudDirection;

// Each layer's patterns, four to a layer from 4 × its index (CLOUD_OFFSET_* + 4 l): its
// coverage, its broad octave, its second tap and its shape volume; then those all share.
#define CLOUD_OFFSET_COVERAGE 0
#define CLOUD_OFFSET_BROAD 1
#define CLOUD_OFFSET_SECOND 2
#define CLOUD_OFFSET_SHAPE 3
#define CLOUD_OFFSET_DETAIL (4 * CLOUD_LAYERS)
#define CLOUD_OFFSET_SCENE (4 * CLOUD_LAYERS + 1)
#define CLOUD_OFFSET_WARP (4 * CLOUD_LAYERS + 2)
// The noise volumes' means and standard deviations (measured, scenery-cloud-noise.ts): their
// Perlin-Worley (shape r), billows (shape gba, weighted), fine billows (detail rgb, weighted)
// and wisps (detail a). Each moves an edge in standard deviations of its own.
#define CLOUD_BODY vec2(0.736, 0.094)
#define CLOUD_BILLOWS vec2(0.471, 0.099)
#define CLOUD_FINE vec2(0.487, 0.093)
#define CLOUD_WISPS vec2(0.501, 0.149)
// What share of their spread the volumes keep at a level of detail (measured on their mips): 1
// less a smoothstep between these levels, for the shape volume's and for the detail volume's.
#define CLOUD_SHAPE_KEPT vec2(1.5, 6.0)
#define CLOUD_DETAIL_KEPT vec2(0.5, 4.5)
// Texels along a side of the detail volume (CLOUD_DETAIL_SIZE in scenery-cloud-noise.ts).
#define CLOUD_DETAIL_SIZE 32.0
// How much an edge widens per spread a footprint's averaging lost: a ramp as steep at its middle
// as a normal distribution's share above a level.
#define CLOUD_SPREAD_WIDTH 1.25
// The coverage's second tap of the noise's tile, read turned as the broad octave is: its
// period over the first's, and its weight, as much as the first's (or the first's period shows
// in rows seen from high up); and its broad octave: its period over the first's, and its
// weight (cloud-noise.ts). Two taps at periods no whole number apart, so the tile does not
// repeat seen from high up.
#define CLOUD_SECOND 1.618
#define CLOUD_SECOND_WEIGHT 0.5
#define CLOUD_BROAD 3.1
#define CLOUD_BROAD_WEIGHT 0.35
// Where the scene's layers give way to the weather systems, the border is moved by up to this
// far (world units, y) by a field of this period (x), so it follows no circle: defined by the
// renderer (SCENE_WARP, PERIOD_SCENE_WARP).
// How far rows move the coverage's level (in its standard deviations), at a layer's rows of 1.
#define CLOUD_ROWS 1.2
// The weather systems' cloud's density against the layer's, from the map's thinnest to its
// thickest: 2 to these powers. No thinner: a veil any more see-through showed the layer's own
// coverage tile through it as a crosshatch from high up.
#define CLOUD_MAP_DENSITY vec2(-1.5, 0.5)
// The middle and high levels' thickness far off (as the map's, between CLOUD_MAP_DENSITY's
// ends), from a veil (x) to the systems' hearts (y), as the low level's thickness there goes
// from z to w: at one middle thickness, they lay flat white sheets over the low clouds' shading
// wherever the map had them, and the Earth seen from space was evenly white. Thinner than the
// map's thinnest: they cover the low level's coverage tile only from high up, where it is its mean.
#define CLOUD_MAP_UPPER vec4(-1.0, 0.5, 0.2, 0.9)
// How much of the weather systems' density the samples toward the light leave out (a power of
// it): most, so a veil is no brighter than a deep shield, only more see-through.
#define CLOUD_MAP_LIGHT 0.8
// Over the last of the cover from this share up (and the first, up to 1 less it), the level
// the coverage must pass is eased into all's (none's), and what a step hides into whole
// cloud's (cloudThreshold, cloudExtinction): jumping, the map's texels a step short of whole
// (bilinear between 254 and 255) drew its whole regions flat and pale, with stairs round them.
#define CLOUD_WHOLE 0.97
// Far off, where a pixel spans this share of a layer's thickness and more, the clouds' depth is
// where the view enters the layer, not their front: what reaches into the layer (an ice sheet,
// a mountain range) is hidden there as from over the clouds. Their front, which noise and
// motion move about, flickered against it.
#define CLOUD_ENTRY_DEPTH vec2(0.25, 1.0)
// A cell of the coverage's pattern spans this share of its period: a cloud's breadth.
#define CLOUD_CELL 0.25
// The level of the noise from which a footprint takes the coverage's pattern as its mean: past
// it, nothing of the tile's pattern is read (cloudAt). The broad octave (cloudSlow), CLOUD_BROAD
// times broader, is kept for this many levels more: the clusters the clouds gather in stay as
// the clouds themselves blur into their mean, where a smaller image of the clouds (a lower
// quality) had lost them a few hundred kilometres sooner than a larger.
#define CLOUD_MEAN_LOD 4.0
#define CLOUD_BROAD_LODS 2.0
// The share of the broad octave's reach kept once the tile's pattern is its mean: all of it drew
// the clusters as round blobs from 1000 km up, polka dots over the sea.
#define CLOUD_BROAD_FAR 0.5
#define CLOUD_FAR 1e30
// The most a grazing view stretches a pixel's footprint over a layer. The noise is filtered for
// the geometric mean of the footprint's two sides over the layer, so at most 4 times wider: the
// longer side alone would blur the clouds and change them as the view tilts.
#define CLOUD_STRETCH 16.0
// Where along the view what lies behind is drawn over the clouds (their depth): where they hide
// this share of it. Their front, rather than where their light comes from on average, which
// lies inside whatever reaches into the layer (a mountain) and so flickers against it.
#define CLOUD_FRONT 0.1
// In cloud a step spans at most this optical depth (but no shorter than this share of the
// shortest step): where the view enters a cloud from clear air with a longer one, it steps
// back and goes in again with these, so a cloud's front is not wherever a step happened to
// land, a pixel's noise the frames have to average away.
#define CLOUD_STEP_DEPTH 2.0
#define CLOUD_STEP_FLOOR 0.5
// The most a step grows per unit of distance, however long the runs. Grown to fit a view along a
// layer from inside it (30–150 km of it), the steps a few kilometres off were a kilometre long,
// a cumulus's breadth, and which clouds they landed in changed as the camera moved: patches came
// and went. What the steps do not reach, the tail takes at once (the march's slabs).
#define CLOUD_GROWTH_MOST 0.06
// The samples toward the light take in at least this share of the span each stands for: the
// billows they cross, not each one's crevices, which flicker from frame to frame as the view's
// samples move.
#define CLOUD_LIGHT_BLUR 0.3
// The light scattered many times over inside a cloud: its share of the sun's, and how fast it
// falls off with the optical depth toward the sun (1 / (1 + y depth), against e^(−depth)).
#define CLOUD_MULTIPLE vec2(0.2, 0.3)
// The sun's weight against the sky's.
#define CLOUD_SUN 0.95
// The sky's light: how far overhead is toward the zenith's blue from the horizon's; the
// ground's below, and how much of overhead's reaches the underside anyway, off the clouds and
// the air around; and its weight. Less of it with the sun low (CLOUD_SKY_LOW at 5°, all from
// 30°).
#define CLOUD_SKY vec4(0.85, 0.7, 0.5, 1.3)
#define CLOUD_SKY_LOW 0.5
// Under a deck (cloudLight's `deck`: the optical depth straight up to the open sky): how fast
// the sky's blue is lost (e^(−x deck)), how fast the grey light the deck lets through, many
// times scattered, dims (1 / (1 + y deck)), and how much of the sun's light falling on the
// deck's top it carries against the sky's.
#define CLOUD_DECK vec3(0.6, 0.12, 0.6)
// A layer whose whole thickness is optically thinner than this (cirrus, a veil) takes no
// samples toward the light, and three steps a run: lit as if even up to its top.
#define CLOUD_THIN 3.0
// The ground: the share of its broad height the low layer rises by, as cloud bases rise over
// high ground (the middle layer by half as much, the high one, of ice near the tropopause, not
// at all: cloudRiseOf), read at the level of its map (some 110 km) that also gives the broad
// slopes; how fast (m/s) the wind blowing up those slopes lifts the air for the scene's layers
// to gain all of this much cover (down them, to lose it); and near the camera, how far under
// the ground about it (its map's, smoothed) the camera may lie before the ground there is let
// down to it (metres), and over what distance from the camera that fades (world units).
#define CLOUD_TERRAIN_RISE 0.8
#define CLOUD_TERRAIN_LOD 2.5
// Where a view's runs are tightened to the rise along them: how many places along each run the
// broad ground is read at, and how much spare (metres) is left either side of the rise found.
#define CLOUD_TERRAIN_ALONG 5
#define CLOUD_TERRAIN_SPARE 100.0
#define CLOUD_UPSLOPE vec2(0.4, 0.3)
#define CLOUD_TERRAIN_SLACK 30.0
#define CLOUD_TERRAIN_SLACK_FADE vec2(1000.0, 5000.0)

// Where a view from the camera — from `o`, its offset from the sphere's centre, `height` over
// the sea's sphere — runs below `altitude` over it: (from, to) along `dir`, from > to where it
// never does. |o|² − r² is written from the heights, so it keeps its precision near the
// Earth; with the globe off, below the plane `altitude` up.
vec2 cloudBelow(vec3 o, vec3 dir, float height, float altitude) {
  if(!globeOn()) {
    float rise = dot(dir, uGlobeUp);
    float to = (altitude - height) / (abs(rise) > 1e-6 ? rise : 1e-6);
    if(height < altitude)
      return vec2(-CLOUD_FAR, rise > 0.0 ? to : CLOUD_FAR);
    return rise < 0.0 ? vec2(to, CLOUD_FAR) : vec2(1.0, -1.0);
  }
  float R = uGlobe.x;
  float b = dot(o, dir);
  float c = (height - altitude) * (2.0 * R + height + altitude);
  float d = b * b - c;
  if(d < 0.0)
    return vec2(1.0, -1.0);
  float q = -b - (b >= 0.0 ? 1.0 : -1.0) * sqrt(d);
  float other = abs(q) > 1e-6 ? c / q : 0.0;
  return vec2(min(q, other), max(q, other));
}

// The runs of a view inside the layer between `span.x` and `span.y` over the sea's sphere, up
// to where it meets the `ground`: the one before it dips under the base, and the one after
// it comes back up; each (from, to), empty where from >= to.
void cloudRuns(vec3 o, vec3 dir, float height, vec2 span, float ground, out vec2 near, out vec2 far) {
  vec2 top = cloudBelow(o, dir, height, span.y);
  vec2 base = cloudBelow(o, dir, height, span.x);
  bool under = base.x < base.y && base.y > 0.0;
  near = vec2(max(top.x, 0.0), min(min(top.y, under ? base.x : top.y), ground));
  far = under ? vec2(max(base.y, 0.0), min(top.y, ground)) : vec2(1.0, -1.0);
}

// Stefan Gustavson's permutation polynomial modulo 289 (webgl-noise, MIT).
vec4 cloudPermute(vec4 x) {
  return mod(((x * 34.0) + 10.0) * x, 289.0);
}

// Value noise in [0, 1) at `p` in cells, smooth, repeating only every 289 cells: the twin of
// cloudValueNoise in cloud-noise.ts. For the broad patterns, which the noise's tile, a few
// clouds across, would repeat in a grid seen from high up.
float cloudValueNoise(vec3 p) {
  vec3 f = floor(p);
  vec3 i = mod(f, 289.0);
  vec3 j = mod(i + 1.0, 289.0);
  vec3 u = p - f;
  u = u * u * (3.0 - 2.0 * u);
  vec4 x = vec4(i.x, j.x, i.x, j.x);
  vec4 y = vec4(i.y, i.y, j.y, j.y);
  vec4 near = cloudPermute(cloudPermute(cloudPermute(vec4(i.z)) + y) + x) / 289.0;
  vec4 far = cloudPermute(cloudPermute(cloudPermute(vec4(j.z)) + y) + x) / 289.0;
  vec4 h = mix(near, far, u.z);
  vec2 rows = mix(h.xz, h.yw, u.x);
  return mix(rows.x, rows.y, u.y);
}

// The level the coverage must pass for cloud to lie over `cover` of the ground: its
// distribution's quantile at 1 − cover (cloudCoverageThreshold). None at 0, all at 1, whatever
// the edge's width: past the distribution's ends, eased into over the last of the cover
// (CLOUD_WHOLE), so the level does not jump as the last gap closes or the last cloud goes.
// Jumping, the map's texels a step short of whole drew its whole regions' edges as stairs.
float cloudThreshold(float cover) {
  float x = clamp(1.0 - cover, 0.0, 1.0) * 16.0;
  int i = int(min(floor(x), 15.0));
  float level = mix(uCloudQuantiles[i], uCloudQuantiles[i + 1], x - float(i));
  level -= smoothstep(CLOUD_WHOLE, 1.0, cover);
  return mix(level, 2.0, 1.0 - smoothstep(0.0, 1.0 - CLOUD_WHOLE, cover));
}

// The share of the coverage's distribution over `level`: the cover cloudThreshold takes it
// for.
float cloudAbove(float level) {
  if(level <= uCloudQuantiles[0])
    return 1.0;
  if(level >= uCloudQuantiles[16])
    return 0.0;
  int i = 0;
  for(int s = 8; s >= 1; s /= 2)
    if(level >= uCloudQuantiles[i + s])
      i += s;
  float a = uCloudQuantiles[i];
  float b = uCloudQuantiles[i + 1];
  return 1.0 - (float(i) + clamp((level - a) / max(b - a, 1e-6), 0.0, 1.0)) / 16.0;
}

// The share of the ground's broad height `layer` rises by (CLOUD_TERRAIN_RISE): by its level.
float cloudRiseOf(vec4 layer) {
  return CLOUD_TERRAIN_RISE * max(1.0 - 0.5 * layer.w, 0.0);
}

// The broad ground about a column at `upEarth` (unit, fixed on the Earth): its height over the
// sea (x) and its slope east and north (yz), at CLOUD_TERRAIN_LOD. None without the ground.
vec4 cloudTerrainBroad(vec3 upEarth) {
  if(uCloudTerrain.x < 0.5)
    return vec4(0.0);
  return textureLod(uCloudTerrainMap, upEarth, CLOUD_TERRAIN_LOD);
}

// How much the wind at the scene lifts the air up the ground `broad` (cloudTerrainBroad) at
// `upEarth`: 1 up it at CLOUD_UPSLOPE.x and more, −1 as fast down it.
float cloudUpslope(vec4 broad, vec3 upEarth) {
  vec3 axis = abs(upEarth.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 east = normalize(cross(axis, upEarth));
  vec3 north = cross(upEarth, east);
  float rise = uCloudWind.w * dot(uCloudWind.xyz, east * broad.y + north * broad.z);
  return clamp(rise / CLOUD_UPSLOPE.x, -1.0, 1.0);
}

// The ground at `upEarth` (unit, fixed on the Earth), metres over the sea (the sea's level
// under it): the map about the camera's where it reaches, eased into the Earth's toward its
// sides.
float cloudGround(vec3 upEarth) {
  float earth = textureLod(uCloudTerrainMap, upEarth, 0.0).r;
  if(uCloudTerrain.z < 0.5)
    return earth;
  float facing = dot(upEarth, uCloudTerrainNearCentre);
  if(facing <= 0.0)
    return earth;
  vec2 across = vec2(dot(upEarth, uCloudTerrainNearEast), dot(upEarth, uCloudTerrainNearNorth)) / (facing * uCloudTerrainNearReach);
  float edge = max(abs(across.x), abs(across.y));
  if(edge >= 1.0)
    return earth;
  float near = textureLod(uCloudTerrainNear, across * 0.5 + 0.5, 0.0).r;
  return mix(near, earth, smoothstep(0.85, 1.0, edge));
}

// How fast the weather systems travel east at `s`, the sine of the latitude (m/s): the twin of
// weatherSystemDrift (weather-systems.ts): the trades' easterlies, the westerlies of the storm
// tracks, weaker toward the poles.
#define CLOUD_MAP_DRIFT vec2(-5.0, 12.0)
// Where the older drawing of the map gives way to the newer (cloudMapRead): a value noise of
// cells some 1/x radians across (some 400 km) picks when, and each place takes y of the time
// between them.
#define CLOUD_MAP_DISSOLVE vec2(16.0, 0.3)
float cloudMapDrift(float s) {
  float a = degrees(asin(clamp(abs(s), 0.0, 1.0)));
  return CLOUD_MAP_DRIFT.x + (CLOUD_MAP_DRIFT.y - CLOUD_MAP_DRIFT.x) * smoothstep(18.0, 35.0, a) * (1.0 - 0.6 * smoothstep(60.0, 80.0, a));
}

// Where what lies at `way` (fixed on the Earth, z toward the north pole) lay `seconds` before:
// back along the systems' drift, a turn about the pole.
vec3 cloudMapBack(vec3 way, float seconds) {
  float across = max(length(way.xy), 0.05);
  float turn = -cloudMapDrift(way.z) * seconds / (uGlobe.x * across);
  float c = cos(turn);
  float s = sin(turn);
  return vec3(c * way.x - s * way.y, s * way.x + c * way.y, way.z);
}

// The cloud map at `way` at the level `lod`, as the clock has it: each drawing read where its
// cloud has drifted to since (cloudMapBack), and the older giving way to the newer place by place
// (CLOUD_MAP_DISSOLVE), each over a share of the time between them at a time of its own: blended
// everywhere at once, two drawings hours apart halved each other's cloud into a grey veil.
vec4 cloudMapRead(vec3 way, float lod) {
  float share = uCloudMapTimes.x;
  if(share > 0.0) {
    float at = cloudValueNoise(way * CLOUD_MAP_DISSOLVE.x + 17.0) * (1.0 - CLOUD_MAP_DISSOLVE.y);
    share = smoothstep(at, at + CLOUD_MAP_DISSOLVE.y, share);
  }
  vec4 older = vec4(0.0);
  if(share < 1.0)
    older = textureLod(uCloudMap, cloudMapBack(way, uCloudMapTimes.y), lod);
  if(share <= 0.0)
    return older;
  vec4 newer = textureLod(uCloudMapNext, cloudMapBack(way, uCloudMapTimes.z), lod);
  return mix(older, newer, share);
}

// The weather systems' cloud at `way` (unit, fixed on the Earth) in the cloud map at level of
// detail `lod`, at a layer's `level` (0 low, 1 middle, 2 high: uCloudLayers.w): its cover (x),
// and how thick (y): the low level's own; the higher ones' by how deep the system is under them
// (the low level's thickness, CLOUD_MAP_UPPER).
vec2 cloudMapAt(vec3 way, float lod, float level) {
  vec4 map = cloudMapRead(way, lod);
  if(level < 0.5)
    return map.rg;
  return vec2(level < 1.5 ? map.b : map.a, mix(CLOUD_MAP_UPPER.x, CLOUD_MAP_UPPER.y, smoothstep(CLOUD_MAP_UPPER.z, CLOUD_MAP_UPPER.w, map.g)));
}

// The weather about the column whose foot is `column` (from the camera, fixed on the Earth), as
// a footprint `spread` across (world units) takes it in: `layer`'s cover there (x), how dense
// its cloud is against the layer's own (y), and how much of it is the scene's own (z: where
// its rows show). About the scene, its layers' cover, more up the ground the wind blows up and
// less down it (`upslope`, cloudUpslope; none gained where the layer has none); some hundreds
// of kilometres off, the weather systems' at the layer's level (the cloud map), at their
// strength. Between, a border warped so it follows no circle.
vec3 cloudWeather(vec4 layer, vec3 column, float spread, float upslope) {
  float own = layer.z;
  if(upslope != 0.0)
    own = clamp(own + CLOUD_UPSLOPE.y * upslope * (upslope > 0.0 ? smoothstep(0.0, 0.1, own) : 1.0), 0.0, 1.0);
  float strength = uCloudWeather.x;
  if(strength <= 0.0)
    return vec3(own, 1.0, 1.0);
  vec3 way = normalize(uCloudCameraEarth + column);
  float away = length(way - uCloudUpEarth) * uGlobe.x;
  float near = uCloudWeather.y;
  float far = uCloudWeather.z;
  float scene = 0.0;
  if(away < far + CLOUD_SCENE_WARP.y) {
    float warp = 0.0;
    if(away > near - CLOUD_SCENE_WARP.y)
      warp = (2.0 * cloudValueNoise(column / CLOUD_SCENE_WARP.x + uCloudOffsets[CLOUD_OFFSET_SCENE]) - 1.0) * CLOUD_SCENE_WARP.y;
    scene = 1.0 - smoothstep(near, far, away + warp);
  }
  vec2 systems = vec2(0.0, 0.5);
  if(scene < 1.0)
    systems = cloudMapAt(way, log2(max(2.0 * spread * uCloudWeather.w, 1.0)), layer.w);
  float weight = strength * (1.0 - scene);
  return vec3(mix(own, systems.x, weight), mix(1.0, exp2(mix(CLOUD_MAP_DENSITY.x, CLOUD_MAP_DENSITY.y, systems.y)), weight), 1.0 - weight);
}

// Whether the weather leaves `layer` clear all along a run `span` of a view along `dirEarth`
// (fixed on the Earth): the scene's layers' cover reaches none of it, and the cloud map's level
// spanning it holds none at the layer's level.
bool cloudRunClear(vec4 layer, vec3 dirEarth, vec2 span) {
  float strength = uCloudWeather.x;
  if(strength <= 0.0 || (strength < 1.0 && layer.z > 0.0))
    return false;
  float middle = 0.5 * (span.x + span.y);
  float run = span.y - span.x;
  vec3 way = normalize(uCloudCameraEarth + dirEarth * middle);
  if(layer.z > 0.0 && length(way - uCloudUpEarth) * uGlobe.x - 0.5 * run < uCloudWeather.z + CLOUD_SCENE_WARP.y)
    return false;
  return cloudMapAt(way, log2(max(run * uCloudWeather.w, 1.0)) + 2.0, layer.w).x < 0.002;
}

// A layer's look (uCloudLooks and the rest), read once a step, and where its patterns' offsets
// start (CLOUD_OFFSET_*).
struct CloudKind {
  vec4 look;
  vec4 shapes;
  vec4 forms;
  vec4 styles;
  vec4 rows;
  vec4 wind;
  int offsets;
};

CloudKind cloudKindOf(int l) {
  return CloudKind(uCloudLooks[l], uCloudShapes[l], uCloudForms[l], uCloudStyles[l], uCloudRows[l], uCloudWinds[l], 4 * l);
}

// `v`, fixed on the Earth, in the frame a layer of `kind` reads its patterns in: drawn out
// along its wind as far as its type is (styles.x). Its wind's way at the scene, the same all
// over the Earth: far off, where the weather systems lay the cover, the clouds' look stands
// for theirs.
vec3 cloudStretched(vec3 v, CloudKind kind) {
  return v + kind.wind.xyz * (dot(v, kind.wind.xyz) * kind.styles.x);
}

// What varies slowly in the coverage about a point `offset` from the camera (fixed on the
// Earth), `altitude` over the sea's sphere, where its up is `upEarth`, in `layer` (of `kind`):
// where a broad, smooth field moves the place its pattern is read (xyz, world units), and its
// broad octave there (w). Both change little over a cloud, so the samples toward the light
// take the view's. The warp, by up to a third of a tile, keeps the tiles, a few clouds across,
// from lining up into a grid seen from high up; once the footprint (`spread`: its lod) takes in
// most of a tile the pattern fades into its mean (cloudAt), and needs none.
vec4 cloudSlow(vec3 offset, float altitude, vec3 upEarth, vec4 layer, CloudKind kind, float spread) {
  float period = kind.forms.x;
  vec3 column = offset - upEarth * (altitude - layer.x);
  vec3 warp = vec3(0.0);
  if(spread < 4.0)
    warp = (textureLod(uCloudNoise, column / uCloudWarp + uCloudOffsets[CLOUD_OFFSET_WARP], 0.0).rba - 0.5) * period * 0.6;
  vec3 turned = uCloudTurn * cloudStretched(column + warp, kind) / (period * CLOUD_BROAD);
  return vec4(warp, cloudValueNoise(turned + uCloudOffsets[kind.offsets + CLOUD_OFFSET_BROAD]));
}

// The level of the noise a footprint `footprint` across (world units, as stretched over the
// layer) takes in of a coverage of `period`: two texels to a footprint, as the edge's
// threshold turns one texel to a pixel into streaks along the foreshortened direction from
// high up.
float cloudLod(float period, float footprint) {
  return max(log2(2.0 * footprint * uCloudNoiseSize / period), 0.0);
}

// The density a layer of `kind` has `h` up it (0 its base, 1 its top), against its own, where
// the weather gives it `density` and its pattern is `c` (the coverage, against the `level` it
// must pass): up from its base and down to its top (forms.z, forms.w). A deck (styles.w) is
// thinner toward its cells' edges, and in the pattern's troughs where it is overcast, its base
// raised and its top lowered as far, and less dense: lighter and darker patches underneath and
// lumps on top.
float cloudProfile(float h, float c, float level, CloudKind kind, float density) {
  float margin = (c - max(level, uCloudCoverage.y - 1.5 * uCloudCoverage.x)) / uCloudCoverage.x;
  float thin = kind.styles.w * clamp(1.0 - 0.5 * margin, 0.0, 1.0);
  return smoothstep(thin, thin + kind.forms.z, h) * (1.0 - smoothstep(kind.forms.w - thin, 1.0 - thin, h)) * density * (1.0 - 1.5 * thin);
}

// The cloud at a point `offset` from the camera (fixed on the Earth), `altitude` over the sea's
// sphere, where its up is `upEarth`, in `layer` (with its `look`) under the `weather` there
// (cloudWeather), with its slowly varying part `slow` (cloudSlow): how far into the cloud it
// lies across its edge (x: −1 at its outer side, 1 at its inner, in the edge's widths;
// cloudShare), the density in cloud by its height and the weather (y, against the layer's
// own), and its height up the layer (z). The edge is the coverage's, at the level `lod` of the
// noise (cloudLod, for the footprint as stretched over the layer); the billows, the detail and
// the streets take the level for a footprint `footprint` across. With `puffs`, the edge is
// roughened by the detail as far as the footprint resolves it; without (toward the light), the
// detail is taken as averaged away. Its layer's `kind` shapes it.
vec3 cloudAt(vec3 offset, float altitude, vec3 upEarth, vec4 layer, CloudKind kind, vec3 weather, vec4 slow, float lod, float footprint, bool puffs) {
  float thickness = max(layer.y - layer.x, 1.0);
  float h = (altitude - layer.x) / thickness;
  // Off the layer; a hair over its shells, as a run's ends lie, is on it.
  if(h < -0.01 || h > 1.01)
    return vec3(-8.0, 0.0, clamp(h, 0.0, 1.0));
  h = clamp(h, 0.0, 1.0);
  vec4 look = kind.look;
  vec4 shapes = kind.shapes;
  vec4 forms = kind.forms;
  vec3 above = upEarth * (altitude - layer.x);
  vec3 foot = offset - above;
  vec3 column = cloudStretched(foot + slow.xyz, kind);

  // The coverage, at the level of the noise the footprint over the layer takes in: two taps of
  // the tile, the second turned and broader. Once a footprint takes in most of a tile, its
  // coarser levels still hold the tile's own pattern, which repeats every few pixels as a grid:
  // into the coverage's mean instead, which the widened edge below turns into the cover; there
  // (CLOUD_MEAN_LOD) nothing is read. The broad octave's part of it (`broad`, about its mean)
  // stays further, and moves the mean, and the cover far off, with it (CLOUD_BROAD_LODS).
  float period = forms.x;
  int first = kind.offsets;
  float broad = CLOUD_BROAD_FAR * CLOUD_BROAD_WEIGHT * (slow.w - 0.5) * (1.0 - smoothstep(CLOUD_MEAN_LOD, CLOUD_MEAN_LOD + CLOUD_BROAD_LODS, lod));
  float c = uCloudCoverage.y + broad;
  float shape = uCloudCoverage.y;
  if(lod < CLOUD_MEAN_LOD) {
    shape = textureLod(uCloudNoise, column / period + uCloudOffsets[first + CLOUD_OFFSET_COVERAGE], lod).r;
    vec3 turned = uCloudTurn * column / (period * CLOUD_SECOND) + uCloudOffsets[first + CLOUD_OFFSET_SECOND];
    shape = mix(shape, textureLod(uCloudNoise, turned, max(lod - log2(CLOUD_SECOND), 0.0)).r, CLOUD_SECOND_WEIGHT);
    c = mix(mix(shape, slow.w, CLOUD_BROAD_WEIGHT), uCloudCoverage.y + broad, smoothstep(2.0, CLOUD_MEAN_LOD, lod));
  }
  float sigma = uCloudCoverage.x;

  // The billows' and the detail's reach, and how much of them the footprint resolves (below).
  float shapePeriod = forms.y;
  float shapeLod = max(log2(2.0 * footprint * uCloudVolumes.y / shapePeriod), 0.0);
  float billowsKept = 1.0 - smoothstep(CLOUD_SHAPE_KEPT.x, CLOUD_SHAPE_KEPT.y, shapeLod);
  float billowsReach = shapes.x * sigma * mix(0.4, 1.0, smoothstep(0.0, 0.4, h));
  float detailLod = max(log2(2.0 * footprint * CLOUD_DETAIL_SIZE / uCloudVolumes.x), 0.0);
  // The samples toward the light take none: as if averaged away.
  float detailKept = puffs ? 1.0 - smoothstep(CLOUD_DETAIL_KEPT.x, CLOUD_DETAIL_KEPT.y, detailLod) : 0.0;
  float detailReach = shapes.y * sigma;

  // Heaped clouds (cumulus) build up where the pattern is strongest: the level rises toward
  // their tops. Sheets keep it, and keep their cover as their billows and detail resolve: its
  // level as much further from the coverage's mean as their spread with the coverage's is wider
  // than the coverage's alone, or a broken deck's spread pulled its cover toward half.
  float threshold = cloudThreshold(weather.x);
  float resolved = billowsReach * billowsKept * billowsReach * billowsKept + detailReach * detailKept * detailReach * detailKept;
  threshold = uCloudCoverage.y + (threshold - uCloudCoverage.y) * mix(sqrt(1.0 + resolved / (sigma * sigma)), 1.0, look.z);
  float rise = look.z * pow(h, 1.5);
  float level = threshold + max(1.0 - threshold, 0.0) * 0.95 * rise;
  // The coverage's own spread the coarser levels averaged away: all of it once it is its mean.
  float coverageLost = sigma * smoothstep(0.0, CLOUD_MEAN_LOD, lod);
  float profile = cloudProfile(h, c, level, kind, weather.y);

  // Once the coverage is its mean, the share of a footprint in cloud is the share of the
  // coverage's distribution over the level (cloudAbove): the cover is the weather's at every
  // distance, whatever the edge's width. On the way there, the resolved edge blends into it.
  float far = smoothstep(2.0, CLOUD_MEAN_LOD, lod);
  float edgeFar = far > 0.0 ? 2.0 * cloudAbove(level - broad) - 1.0 : 0.0;
  if(far >= 1.0)
    return vec3(edgeFar, profile, h);

  // Rows (look.w): cumulus in a fresh wind line up into streets along it, altocumulus into
  // billows across it: in patches, which wander with the coverage and are broken by it into
  // clouds. About the scene, as far as the footprint resolves them.
  float rows = 0.0;
  float rowsLost = 0.0;
  if(look.w > 0.0 && weather.z > 0.0) {
    float across = dot(foot, kind.rows.xyz) + kind.rows.w + 0.6 * slow.w + 0.3 * (shape - uCloudCoverage.y) / sigma;
    // The footprint over the layer the coverage's level stands for. Rows of the clouds, so no
    // further than the clouds are resolved themselves.
    float spread = exp2(lod) * period / (2.0 * uCloudNoiseSize);
    float rowsKept = (1.0 - smoothstep(0.25, 0.5, spread * length(kind.rows.xyz))) * (1.0 - smoothstep(1.0, 3.0, lod));
    float reach = weather.z * look.w * CLOUD_ROWS * sigma * smoothstep(0.25, 0.65, slow.w);
    rows = reach * rowsKept * sin(6.2831853 * across);
    // A sine's variance: half its amplitude squared.
    rowsLost = 0.5 * reach * reach * (1.0 - rowsKept * rowsKept);
  }
  c += rows;

  // The billows, read in 3D where the point lies, flattened by shapes.z: least at the base, so
  // it stays flat, most up the cloud. And the detail that roughens them close up: at the base
  // wisps or the billows' undersides (uCloudStyles.y), billows above. Each at the level of its
  // volume two texels to a footprint takes in, whose averaging calms it as a footprint takes in
  // more of them (CLOUD_*_KEPT); the edge widens by the spread lost, so a footprint's share in
  // cloud stays what it was. No fade of their own: the clouds keep their shapes as the view
  // moves off and back, coarser, not other.
  vec3 lifted = offset + above * (shapes.z - 1.0);
  float lost = coverageLost * coverageLost + billowsReach * billowsReach * (1.0 - billowsKept * billowsKept) + detailReach * detailReach * (1.0 - detailKept * detailKept) + rowsLost;
  // The edge widens by the spread the coarser levels averaged away, each a variance of its
  // own: what share of the footprint is cloud, not whether its mean is.
  float width = sqrt(look.y * look.y + CLOUD_SPREAD_WIDTH * CLOUD_SPREAD_WIDTH * lost);

  // Too far under the level for even the billows to reach: clear, without reading them.
  float reach = 2.0 * (billowsReach * billowsKept + detailReach * detailKept);
  if(c < level - width - reach)
    return vec3(mix((c - level + reach) / width, edgeFar, far), profile, h);
  if(billowsKept > 0.0) {
    vec4 s = textureLod(uCloudShape, cloudStretched(lifted, kind) / shapePeriod + uCloudOffsets[first + CLOUD_OFFSET_SHAPE], shapeLod);
    float billows = (dot(s.gba, vec3(0.625, 0.25, 0.125)) - CLOUD_BILLOWS.x) / CLOUD_BILLOWS.y;
    float body = (s.r - CLOUD_BODY.x) / CLOUD_BODY.y;
    c += billowsReach * mix(body, billows, shapes.w);
  }
  if(detailKept > 0.0) {
    vec4 d = textureLod(uCloudDetail, lifted / uCloudVolumes.x + uCloudOffsets[CLOUD_OFFSET_DETAIL], detailLod);
    float fine = (dot(d.rgb, vec3(0.625, 0.25, 0.125)) - CLOUD_FINE.x) / CLOUD_FINE.y;
    float wisps = (d.a - CLOUD_WISPS.x) / CLOUD_WISPS.y;
    fine = mix(mix(-fine, wisps, kind.styles.y), fine, smoothstep(0.1, 0.5, h));
    c += detailReach * fine;
  }
  // A deck's base and top as its billows and detail roughen them.
  if(kind.styles.w > 0.0)
    profile = cloudProfile(h, c, level, kind, weather.y);
  return vec3(mix((c - level) / width, edgeFar, far), profile, h);
}

// The share of a footprint in cloud at a point `edge` into it (cloudAt's x): a ramp across
// the edge.
float cloudShare(float edge) {
  return clamp(0.5 + 0.5 * edge, 0.0, 1.0);
}

// The integral of clamp(u, 0, 1) from 0 to `u`.
float cloudRamp(float u) {
  return u <= 0.0 ? 0.0 : (u >= 1.0 ? u - 0.5 : 0.5 * u * u);
}

// The mean share in cloud along a step whose edge value runs straight from `a` to `b`: where
// within the step the view crosses the edge, not on which side a sample fell, so the steps
// do not slice the clouds into layers.
float cloudShareAlong(float a, float b) {
  float ua = 0.5 + 0.5 * a;
  float ub = 0.5 + 0.5 * b;
  if(abs(ub - ua) < 1e-4)
    return clamp(0.5 * (ua + ub), 0.0, 1.0);
  return (cloudRamp(ub) - cloudRamp(ua)) / (ub - ua);
}

// What a step hides of what lies behind it, as an extinction: `sigma` in cloud, over the
// share `cover` of its footprint the clouds take. Per chord of a cloud along the view
// (`chord` long), the clear share lets all through and the cloud e^(−σ chord): as long as
// the clouds are resolved (cover 0 or 1) it is σ itself; once they are not, it hides what
// they would, side by side with the sky between them. Eased into σ over the last of the
// cover (CLOUD_WHOLE), so it does not jump as the last gap closes.
float cloudExtinction(float sigma, float cover, float chord) {
  if(cover >= 0.999)
    return sigma;
  float kept = 1.0 - cover * (1.0 - exp(-sigma * chord));
  return mix(-log(max(kept, 1e-6)) / chord, sigma, smoothstep(CLOUD_WHOLE, 1.0, cover));
}

// A cloud's chord along `way`, where its up is `up`: across its `thickness`, or its `breadth`.
float cloudChord(vec3 way, vec3 up, float thickness, float breadth) {
  float upward = abs(dot(way, up));
  return 1.0 / (upward / thickness + sqrt(max(1.0 - upward * upward, 0.0)) / breadth + 1e-9);
}

// The longest step in cloud of extinction `sigma` (CLOUD_STEP_DEPTH).
float cloudStepIn(float sigma) {
  return max(uCloudMarch.y * CLOUD_STEP_FLOOR, CLOUD_STEP_DEPTH / sigma);
}

// 4π times Henyey-Greenstein's phase function: 1 all round for g = 0.
float cloudPhase(float cosine, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosine, 1.5);
}

// Where the light comes from for a point whose up is `up`: the sun while it is up there, the
// moon once its light is gone (skyMoonlight's hand-over, so it shows nothing).
vec3 cloudLightWay(vec3 up) {
  return dot(up, uSkySunDirection) > -0.105 ? uSkySunDirection : uSkyMoonDirection;
}

// The light a cloud scatters toward the camera along `dir` at a point `h` up its layer (0 its
// base, 1 its top), where its up is `up` and the cloud toward the light is `depth` deep
// (optical depth): by the sun, or the moon by night, and by the sky above and the sea below.
// Each lit where the point lies, so from high up the night side's clouds are dark and those on
// the terminator glow.
//
// The light that comes straight through, by the phase, falls off as e^(−depth); the light
// scattered many times over inside a cloud far slower (CLOUD_MULTIPLE), and evenly all round,
// so a cloud's shaded side is lit through it rather than left to the ambient. The sky's light
// is mostly the blue overhead, and reaches the underside too, off the clouds and the air
// around: their shadows take its blue in daylight, not a grey. About sunrise and sunset the
// sky lights them less (CLOUD_SKY_LOW), so the sun's colour carries. Under a deck, `deck` deep
// (the optical depth straight up from the point to the open sky, through its own layer and those
// over it), the sky's blue gives way to the grey light the deck lets through, many times
// scattered, dimmer the deeper it is (CLOUD_DECK): an overcast's grey underside.
vec3 cloudLight(vec3 dir, vec3 up, float h, float depth, float deck) {
  float sine = dot(up, uSkySunDirection);
  float elevation = degrees(asin(clamp(sine, -1.0, 1.0)));
  float daylight = smoothstep(-6.0, 10.0, elevation);
  float twilight = smoothstep(-12.0, -3.0, elevation) * (1.0 - smoothstep(1.0, 12.0, elevation));
  float dusk = min(uSkyTwilight.x * twilight, 1.0);
  vec3 sun = mix(skySunColorAt(sine), SKY_TWILIGHT_LIGHT, dusk) * daylight * (uSkySunRadiance > 1.0 ? 2.0 : 1.0);
  float moonUp = smoothstep(-0.02, 0.05, dot(up, uSkyMoonDirection));
  vec3 moon = uSkyMoonColor * (1.0 - smoothstep(-12.0, -6.0, elevation)) * uSkyMoonPhase * moonUp * 0.25;
  vec3 light = cloudLightWay(up);
  vec3 direct = light == uSkySunDirection ? sun : moon;
  float cosine = dot(dir, light);
  float phase = min(mix(cloudPhase(cosine, -0.3), cloudPhase(cosine, 0.6), 0.7), 4.0);
  float through = phase * exp(-depth) + CLOUD_MULTIPLE.x / (1.0 + CLOUD_MULTIPLE.y * depth);

  // The sky above and the sea below, as dark as the night is where it lies.
  float dayLevel = mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up));
  vec3 overhead = mix(uSkyHorizonColor, uSkyZenithColor, CLOUD_SKY.x) * dayLevel;
  vec3 under = mix(mix(uSkyGroundColor, uSkyHorizonColor, 0.5) * CLOUD_SKY.y * dayLevel, overhead, CLOUD_SKY.z);
  vec3 ambient = mix(under, overhead, smoothstep(0.0, 1.0, h));
  // About sunrise and sunset their undersides catch the glow, most toward the sun.
  float facing = 0.5 + 0.5 * dot(dir, uSkySunDirection);
  ambient += SKY_TWILIGHT_ORANGE * dusk * 0.25 * facing * facing * (1.0 - h);
  ambient *= CLOUD_SKY.w * mix(CLOUD_SKY_LOW, 1.0, smoothstep(5.0, 30.0, elevation));
  if(deck > 0.0) {
    vec3 onTop = direct * max(dot(up, light), 0.0) * CLOUD_DECK.z + ambient;
    float grey = dot(onTop, vec3(0.2126, 0.7152, 0.0722)) / (1.0 + CLOUD_DECK.y * deck);
    ambient = mix(vec3(grey), ambient, exp(-CLOUD_DECK.x * deck));
  }

  return uCloudColor * (direct * through * CLOUD_SUN + ambient);
}

// `color` seen through the air from the camera, `dist` along `dir`, as the relief is
// (reliefThroughAir): into the sky's blue over short paths and the horizon's colour over long
// ones; looking down, into the sky overhead.
vec3 cloudThroughAir(vec3 color, vec3 dir, float dist, float blend) {
  float haze = skyAirHaze(cameraPosition, dir, dist);
  if(haze <= 0.0)
    return color;
  vec3 look = globeCameraLook();
  vec3 level = dir - look * dot(dir, look);
  float n2 = dot(level, level);
  vec3 way = n2 > 1e-8 ? level * inversesqrt(n2) : uSkyEast;
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
  vec3 kept = exp(-depth * vec3(0.75, 1.0, 1.5));
  vec3 scatter = mix(blue, horizon, 1.0 - exp(-depth));
  return color * kept + scatter * (1.0 - kept);
}

// From space, as lit where they lie (`lit`), under the little air over them: its share above
// `altitude`. In the air, `near`.
vec3 cloudFromSpace(vec3 near, vec3 lit, vec3 p, float altitude) {
  float space = skyFromSpace();
  if(space <= 0.0)
    return near;
  vec3 up = globeUpAt(p);
  float over = uSkyAir.y > 0.0 ? exp(-max(altitude, 0.0) / uSkyAir.y) : 1.0;
  float haze = skySpaceHaze(p, up) * over;
  vec3 air = skySpaceAir(haze, dot(uSkySunDirection, up)) * mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up));
  return mix(near, mix(lit, air, haze), space);
}

#ifndef CLOUD_SHADOW
void main() {
  vec3 dir = normalize(vCloudDirection);
  // Derivatives first, before anything branches.
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));

  float R = uGlobe.x;
  float height = globeOn() ? uGlobeCamera.z : globeCameraHeight() - globeLevel();
  vec3 o = uGlobeCameraRadial.xyz * (R + height);
  vec2 reach = globeReach(cameraPosition, dir, 0.0);
  float ground = reach.y < 0.5 ? reach.x : CLOUD_FAR;
  vec3 dirEarth = uCloudEarth * dir;
  // The ground, on the globe: the layers rise over it by up to this much, and the view ends
  // where it meets it. Under the ground about it (its map's, smoothed: in a narrow valley),
  // the camera lets it down by as much near by.
  bool terrain = uCloudTerrain.x > 0.5 && globeOn();
  float slack = 0.0;
  if(terrain && height < uCloudTerrain.y + CLOUD_TERRAIN_SLACK)
    slack = max(cloudGround(normalize(uCloudCameraEarth)) - height + CLOUD_TERRAIN_SLACK, 0.0);

  // Each layer's runs along the view, nearest first: but those the weather leaves clear all
  // along. A uniform count keeps the loop a loop in Direct3D.
  vec4 runs[2 * CLOUD_LAYERS];
  int count = 0;
  for(int l = 0; l < uCloudLayerCount; l++) {
    vec4 layer = uCloudLayers[l];
    // Clear here and everywhere else.
    if(layer.z <= 0.0 && uCloudWeather.x <= 0.0)
      continue;
    float riseShare = terrain ? cloudRiseOf(layer) : 0.0;
    float riseMost = riseShare * uCloudTerrain.y;
    vec2 spans[2];
    cloudRuns(o, dir, height, layer.xy + vec2(0.0, riseMost), ground, spans[0], spans[1]);
    // Over the ground, only as far up as the layer rises along this view: its broad rise
    // read along the runs that could hold it, so a view through a layer over the sea steps
    // through the layer, not through the rise over the highest ground anywhere.
    if(riseMost > 0.0) {
      vec2 rises = vec2(CLOUD_FAR, -CLOUD_FAR);
      for(int s = 0; s < 2; s++) {
        vec2 span = spans[s];
        if(span.x >= span.y)
          continue;
        for(int k = 0; k < CLOUD_TERRAIN_ALONG; k++) {
          float along = mix(span.x, span.y, float(k) / float(CLOUD_TERRAIN_ALONG - 1));
          vec3 point = uCloudCameraEarth + dirEarth * along;
          float rise = riseShare * cloudTerrainBroad(normalize(point)).x;
          rises = vec2(min(rises.x, rise), max(rises.y, rise));
        }
      }
      if(rises.x <= rises.y)
        cloudRuns(o, dir, height, layer.xy + rises + vec2(-CLOUD_TERRAIN_SPARE, CLOUD_TERRAIN_SPARE), ground, spans[0], spans[1]);
    }
    for(int s = 0; s < 2; s++) {
      vec2 span = spans[s];
      // Flagged where the layer is optically thin all through (CLOUD_THIN).
      if(span.x < span.y && !cloudRunClear(layer, dirEarth, span))
        runs[count++] = vec4(span, float(l), uCloudLooks[l].x * (layer.y - layer.x) < CLOUD_THIN ? 1.0 : 0.0);
    }
  }
  for(int i = 1; i < 2 * CLOUD_LAYERS; i++) {
    if(i >= count)
      break;
    vec4 run = runs[i];
    int j = i - 1;
    while(j >= 0 && runs[j].x > run.x) {
      runs[j + 1] = runs[j];
      j--;
    }
    runs[j + 1] = run;
  }

  // Each step from the last sample to the next: its share in cloud integrated between the two
  // (cloudShareAlong), lit as its two ends are, each as far as it is cloud. The steps lie at
  // the same distances for every pixel but for each run's first, of a length of its own: so
  // their ends do not line up into shells across the image. Blue noise, moved on by the golden
  // ratio each frame: what the temporal resolve leaves of it is a fine, even grain, where
  // interleaved gradient noise leaves streaks.
  float blue = texelFetch(uCloudBlueNoise, ivec2(gl_FragCoord.xy) & CLOUD_BLUE_NOISE_MASK, 0).r;
  float jitter = fract(blue + 0.6180339887 * uCloudFrame);
  vec3 color = vec3(0.0);
  float transmit = 1.0;
  float depthSum = 0.0;
  float weightSum = 0.0;
  float front = -1.0;
  float entry = 0.0;
  float entryThickness = 1.0;
  int current = 0;
  float t = count > 0 ? runs[0].x : 0.0;
  bool started = false;
  bool first = true;
  float lastEdge = -8.0;
  float lastProfile = 0.0;
  vec3 lastLight = vec3(0.0);
  // The extinction over the last step, where it was in cloud: it bounds the next
  // (CLOUD_STEP_DEPTH). And a cloud a step from clear air landed in, too long a step in, so
  // stepped back from: up to where, and its extinction there.
  float lastSigma = 0.0;
  float entered = -1.0;
  float enteredSigma = 0.0;
  // Steps grow through clear air, and shrink again at the next cloud.
  float skip = 1.0;
  int steps = int(uCloudMarch.x);
  // Steps growing with distance, at least fast enough for the runs to fit the steps there are
  // (those through optically thin layers take three steps a run, and none of the rest), but no
  // faster than CLOUD_GROWTH_MOST: the last steps, one for each run left, are the tail.
  float reachStart = 1e30;
  float reachEnd = 0.0;
  int thinRuns = 0;
  for(int k = 0; k < 2 * CLOUD_LAYERS; k++) {
    if(k >= count)
      break;
    if(runs[k].w > 0.5) {
      thinRuns++;
      continue;
    }
    reachStart = min(reachStart, runs[k].x);
    reachEnd = max(reachEnd, runs[k].y);
  }
  reachStart = reachEnd > 0.0 ? max(reachStart, uCloudMarch.y) : 1.0;
  reachEnd = max(reachEnd, reachStart);
  float growth = clamp(log(reachEnd / reachStart) / (0.8 * float(max(steps - 3 * thinRuns, 1))), uCloudMarch.z, CLOUD_GROWTH_MOST);

  for(int i = 0; i < steps; i++) {
    if(current >= count || transmit < 0.01)
      break;
    vec4 run = runs[current];
    int l = int(run.z);
    vec4 layer = uCloudLayers[l];
    CloudKind kind = cloudKindOf(l);
    vec4 look = kind.look;
    float period = kind.forms.x;
    float thickness = max(layer.y - layer.x, 1.0);
    float breadth = period * CLOUD_CELL;

    // Longer the further off, but at least three to a run, whose ends lie on the layer's
    // shells where it has no density, and in cloud no deeper than CLOUD_STEP_DEPTH; a run's
    // first sample at its start, its second a step of a length of its own on.
    float stride = 0.0;
    bool thin = run.w > 0.5;
    // A thin layer crossed in a run short against its billows (seen steeply), or whose pattern
    // the footprint takes as its mean all along it (from its start, where the footprint is
    // least): one sample at its middle stands for all of it, a slab, integrated at once. So do
    // the last steps, one for each run left (the tail): what the steps did not reach of a run,
    // from where they got to, at the pattern's mean.
    bool tail = i >= steps - (count - current);
    float from = started ? t : run.x;
    bool slab = tail || (!started && thin && (run.y - run.x < 0.5 * kind.forms.y || cloudLod(period, max(uCloudMarch.w * run.x, 1.0)) >= CLOUD_MEAN_LOD));
    if(started) {
      stride = min(max(uCloudMarch.y, growth * t) * skip, (run.y - run.x) / 3.0);
      float sigmaAhead = lastSigma > 0.0 ? lastSigma : (t < entered ? enteredSigma : 0.0);
      if(sigmaAhead > 0.0)
        stride = min(stride, cloudStepIn(sigmaAhead));
      // Through a thin layer, three steps.
      if(thin)
        stride = (run.y - run.x) / 3.0;
      if(first)
        stride *= 0.25 + jitter;
      stride = min(stride, run.y - t);
    }
    float at = slab ? 0.5 * (from + run.y) : t + stride;

    // Where it lies: its height over the sea's sphere, its up, and its offset from the camera
    // fixed on the Earth.
    vec3 x = o + dir * at;
    float r = length(x);
    float altitude = globeOn() ? r - R : height + dot(dir, uGlobeUp) * at;
    vec3 up = globeOn() ? x / r : uGlobeUp;
    vec3 offset = dirEarth * at;
    vec3 upEarth = globeOn() ? (uCloudCameraEarth + offset) / r : uCloudUpEarth;
    // Over the ground: the view ends where it meets it (all beyond is hidden), and the layer
    // rises over it; about the scene, gaining cover up the slopes the wind blows up.
    float upslope = 0.0;
    if(terrain) {
      if(altitude < uCloudTerrain.y) {
        float slackHere = slack * (1.0 - smoothstep(CLOUD_TERRAIN_SLACK_FADE.x, CLOUD_TERRAIN_SLACK_FADE.y, at));
        if(altitude < cloudGround(upEarth) - slackHere)
          break;
      }
      vec4 broad = cloudTerrainBroad(upEarth);
      layer.xy += cloudRiseOf(layer) * broad.x;
      if(uCloudWind.w > 0.0)
        upslope = cloudUpslope(broad, upEarth);
    }
    float footprint = max(uCloudMarch.w * at, 1.0);
    // Stretched over the layer as the view grazes it (CLOUD_STRETCH). The tail at the pattern's
    // mean, as one sample stands for all it takes.
    float spread = footprint * sqrt(min(1.0 / max(abs(dot(dir, up)), 1e-3), CLOUD_STRETCH));
    float lod = tail ? max(cloudLod(period, spread), CLOUD_MEAN_LOD) : cloudLod(period, spread);
    // The weather over the column: about the scene its layers', far off the systems'.
    vec3 weather = cloudWeather(layer, offset - upEarth * (altitude - layer.x), spread, upslope);
    vec4 slow = vec4(0.0);
    vec3 cloud = vec3(-8.0, 0.0, clamp((altitude - layer.x) / thickness, 0.0, 1.0));
    if(weather.x > 0.001) {
      // At each step: kept along the view instead, the warp would move with the camera, and
      // the clouds with it. None where even the broad octave is its mean (cloudAt).
      if(lod < CLOUD_MEAN_LOD + CLOUD_BROAD_LODS)
        slow = cloudSlow(offset, altitude, upEarth, layer, kind, lod);
      // The coverage, a pattern on the layer, by the footprint as stretched over it; the
      // billows and the detail, in 3D, by the ray's own.
      cloud = cloudAt(offset, altitude, upEarth, layer, kind, weather, slow, lod, footprint, true);
    }

    // Landed in cloud from clear air with a longer step than it takes: back, and in again with
    // shorter ones (once per cloud: up to where it landed).
    if(!slab && started && stride > 0.0 && lastEdge <= -1.0 && cloud.x > -1.0 && t >= entered) {
      float sigmaHere = cloudExtinction(look.x * cloud.y, cloudShare(cloud.x), cloudChord(dir, up, thickness, breadth));
      if(sigmaHere > 0.0 && stride > 1.5 * cloudStepIn(sigmaHere)) {
        entered = at;
        enteredSigma = sigmaHere;
        skip = 1.0;
        continue;
      }
    }

    // Its light, where it is cloud at all.
    vec3 scattered = vec3(0.0);
    if(cloud.x > -1.0) {
      // Toward the light: close up two samples, the cloud it crosses close by and further
      // in; further off, one across both. With the view's weather, warp and broad octave,
      // which change little over a cloud. Across a heaped cloud's thickness; through a sheet,
      // its deck, on to its top (heap, look.z): an overcast's base lies in its shadow.
      vec3 light = cloudLightWay(up);
      vec3 lightEarth = uCloudEarth * light;
      float lightChord = cloudChord(light, up, thickness, breadth);
      float rising = max(dot(light, up), 0.1);
      float path = mix(clamp(max(layer.y - altitude, 0.0) / rising, 0.05 * thickness, 4.0 * thickness), thickness, look.z);
      // Toward the light, the weather systems' cloud as dense as the layer's, but for a share
      // (CLOUD_MAP_LIGHT): thinned as much, a thin veil was lit through and outshone the deep
      // cloud about it, bright rims round every system seen from space.
      float lightDensity = pow(weather.y, -CLOUD_MAP_LIGHT);
      // The tail's at the pattern's mean, as its own sample is: through a heaped layer it is
      // lit by what lies toward the light, not as a thin layer is (as if even up to its top,
      // which darkened a layer's far edge).
      float lightLod = tail ? max(cloudLod(period, footprint), CLOUD_MEAN_LOD) : cloudLod(period, footprint);
      // A uniform count keeps the loop a loop in Direct3D, rather than a copy of the sample
      // per iteration inlined in the march's own loop (scenery.md, Performance). A thin layer
      // takes none: as if even up to its top.
      int samples = thin ? 0 : (footprint < 0.1 * thickness ? uCloudLightSamples : 1);
      float depth = thin ? look.x * cloud.y * lightDensity * cloudShare(cloud.x) * path : 0.0;
      for(int k = 0; k < uCloudLightSamples; k++) {
        if(k >= samples)
          break;
        float d = path * (samples == 1 ? 0.3 : (k == 0 ? 0.1 : 0.45));
        float span = path * (samples == 1 ? 0.7 : (k == 0 ? 0.2 : 0.5));
        vec3 xk = x + light * d;
        float rk = length(xk);
        float altitudeK = globeOn() ? rk - R : altitude + dot(light, uGlobeUp) * d;
        vec3 offsetK = offset + lightEarth * d;
        vec3 upK = globeOn() ? (uCloudCameraEarth + offsetK) / rk : uCloudUpEarth;
        vec3 there = cloudAt(offsetK, altitudeK, upK, layer, kind, weather, slow, lightLod, max(footprint, span * CLOUD_LIGHT_BLUR), false);
        depth += cloudExtinction(look.x * there.y * lightDensity, cloudShare(there.x), lightChord) * span;
      }
      // The deck over it: through its own layer up, a sheet's (heap, look.z), as the samples
      // toward the light found it on the way to its top, and through the layers over it, which
      // the light crosses too.
      float above = kind.styles.z;
      float deck = (1.0 - look.z) * depth * rising * 1.4 + above;
      scattered = cloudLight(dir, up, cloud.z, depth + above / rising, deck);
    }

    // A slab (above): all of the run (from where the steps got to) at once, as its middle has
    // it — its density there taken down to the profile's mean up the layer — and on to the next.
    if(slab) {
      float share = cloudShare(cloud.x);
      float runLength = run.y - from;
      if(share > 0.0) {
        float sigma = cloudExtinction(look.x * cloud.y * 0.5 * (1.0 + kind.forms.w - kind.forms.z), share, cloudChord(dir, up, thickness, breadth));
        float transmitStep = exp(-sigma * runLength);
        float absorbed = transmit * (1.0 - transmitStep);
        color += absorbed * scattered;
        if(weightSum <= 0.0) {
          entry = run.x;
          entryThickness = thickness;
        }
        depthSum += absorbed * at;
        weightSum += absorbed;
        if(front < 0.0 && transmit * transmitStep < 1.0 - CLOUD_FRONT)
          front = from + runLength * clamp((transmit - 1.0 + CLOUD_FRONT) / max(absorbed, 1e-6), 0.0, 1.0);
        transmit *= transmitStep;
      }
      current++;
      started = false;
      first = true;
      skip = 1.0;
      lastSigma = 0.0;
      if(current < count)
        t = runs[current].x;
      continue;
    }

    if(started && stride > 0.0) {
      float share = cloudShareAlong(lastEdge, cloud.x);
      lastSigma = 0.0;
      if(share > 0.0) {
        float sigma = look.x * 0.5 * (lastProfile + cloud.y);
        lastSigma = cloudExtinction(sigma, share, cloudChord(dir, up, thickness, breadth));
        float transmitStep = exp(-lastSigma * stride);
        float absorbed = transmit * (1.0 - transmitStep);
        // Each end's light as far as it is cloud: one outside it has none to give.
        float near = cloudShare(lastEdge);
        float far = cloudShare(cloud.x);
        color += absorbed * (near * lastLight + far * scattered) / max(near + far, 1e-4);
        // Where the view entered the first layer it found cloud in, and how thick that is.
        if(weightSum <= 0.0) {
          entry = run.x;
          entryThickness = thickness;
        }
        depthSum += absorbed * (t + 0.5 * stride);
        weightSum += absorbed;
        // Where within the step they come to hide CLOUD_FRONT of what lies behind.
        if(front < 0.0 && transmit * transmitStep < 1.0 - CLOUD_FRONT)
          front = t + stride * clamp((transmit - 1.0 + CLOUD_FRONT) / max(absorbed, 1e-6), 0.0, 1.0);
        transmit *= transmitStep;
      }
      skip = max(lastEdge, cloud.x) > -2.0 ? 1.0 : min(skip * 1.5, 3.0);
      first = false;
    }
    started = true;
    lastEdge = cloud.x;
    lastProfile = cloud.y;
    lastLight = scattered;
    t = at;

    if(t >= run.y - 1e-3) {
      current++;
      started = false;
      first = true;
      skip = 1.0;
      lastSigma = 0.0;
      if(current < count)
        t = runs[current].x;
    }
  }
  float alpha = 1.0 - transmit;
  if(alpha < 1e-4) {
    gl_FragColor = vec4(0.0);
    gl_FragDepth = 1.0;
    return;
  }
  // Where their light comes from on average: hazed over that distance.
  float mean = depthSum / max(weightSum, 1e-6);
  vec3 lit = color / alpha;
  vec3 p = cameraPosition + dir * mean;
  vec3 seen = cloudFromSpace(cloudThroughAir(lit, dir, mean, blend), lit, p, globeAltitude(p));
  gl_FragColor = vec4(seen * alpha, alpha);
  // Their front (CLOUD_FRONT), where they hide that much at all; far off, where the view entered
  // their layer from outside it (CLOUD_ENTRY_DEPTH). As log2 over CLOUD_DEPTH_RANGE: the
  // composite reads it.
  float depth = front >= 0.0 ? front : mean;
  float coarse = entry > 0.0 ? smoothstep(CLOUD_ENTRY_DEPTH.x, CLOUD_ENTRY_DEPTH.y, uCloudMarch.w * depth / entryThickness) : 0.0;
  depth = mix(depth, min(entry, depth), coarse);
  gl_FragDepth = clamp(log2(max(depth, 1.0)) / CLOUD_DEPTH_RANGE, 0.0, 0.999999);
}
#else
// The clouds' shadows (CloudVolumeRenderer.updateShadow): for the ground under each texel of
// a square about the camera's foot, the share of the light (the sun's, or the moon's) that
// reaches it through the layers, marched toward the light across each, as the march's own
// samples toward the light read them: the same coverage, weather and ground.
uniform vec4 uCloudShadowPlace; // its middle (world), and how far it reaches to its sides
uniform vec3 uCloudShadowEast;
uniform vec3 uCloudShadowNorth;
uniform float uCloudShadowSize; // texels along its side

// Samples across each layer toward the light.
#define CLOUD_SHADOW_SAMPLES 8

void main() {
  vec2 st = gl_FragCoord.xy / uCloudShadowSize * 2.0 - 1.0;
  float R = uGlobe.x;
  float height = globeOn() ? uGlobeCamera.z : globeCameraHeight() - globeLevel();
  vec3 o = uGlobeCameraRadial.xyz * (R + height);
  // The square's point, then the ground under it: from the camera (world), and from the
  // sphere's centre.
  vec3 point = uCloudShadowPlace.xyz + (uCloudShadowEast * st.x + uCloudShadowNorth * st.y) * uCloudShadowPlace.w;
  vec3 delta = point - cameraPosition;
  vec3 up = globeOn() ? normalize(o + delta) : uGlobeUp;
  vec3 upEarth = globeOn() ? normalize(uCloudCameraEarth + uCloudEarth * delta) : uCloudUpEarth;
  bool terrain = uCloudTerrain.x > 0.5 && globeOn();
  float ground = terrain ? max(cloudGround(upEarth), 0.0) : 0.0;
  if(globeOn())
    delta = up * (R + ground) - o;
  else
    delta += up * (ground - height - dot(delta, uGlobeUp));
  vec3 oGround = o + delta;

  vec3 light = cloudLightWay(up);
  // Under the horizon there is no light to shade.
  if(dot(light, up) <= 0.0) {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 lightEarth = uCloudEarth * light;
  float texel = 2.0 * uCloudShadowPlace.w / uCloudShadowSize;
  float depth = 0.0;
  for(int l = 0; l < uCloudLayerCount; l++) {
    vec4 layer = uCloudLayers[l];
    if(layer.z <= 0.0 && uCloudWeather.x <= 0.0)
      continue;
    CloudKind kind = cloudKindOf(l);
    vec4 look = kind.look;
    float period = kind.forms.x;
    float thickness = max(layer.y - layer.x, 1.0);
    float breadth = period * CLOUD_CELL;
    // Across the layer as it rises over the ground here, toward the light.
    float rise = terrain ? cloudRiseOf(layer) * cloudTerrainBroad(upEarth).x : 0.0;
    float start = max(cloudBelow(oGround, light, ground, layer.x + rise).y, 0.0);
    float end = cloudBelow(oGround, light, ground, layer.y + rise).y;
    if(end <= start || end >= CLOUD_FAR)
      continue;
    float segment = (end - start) / float(CLOUD_SHADOW_SAMPLES);
    float footprint = max(texel, segment * CLOUD_LIGHT_BLUR);
    float chord = cloudChord(light, up, thickness, breadth);
    for(int k = 0; k < CLOUD_SHADOW_SAMPLES; k++) {
      float t = start + (float(k) + 0.5) * segment;
      vec3 x = oGround + light * t;
      float r = length(x);
      float altitude = globeOn() ? r - R : ground + dot(light, uGlobeUp) * t;
      vec3 offset = uCloudEarth * delta + lightEarth * t;
      vec3 upK = globeOn() ? (uCloudCameraEarth + offset) / r : uCloudUpEarth;
      vec4 layerK = layer;
      float upslope = 0.0;
      if(terrain) {
        vec4 broad = cloudTerrainBroad(upK);
        layerK.xy += cloudRiseOf(layer) * broad.x;
        if(uCloudWind.w > 0.0)
          upslope = cloudUpslope(broad, upK);
      }
      float lod = cloudLod(period, footprint);
      vec3 weather = cloudWeather(layerK, offset - upK * (altitude - layerK.x), footprint, upslope);
      if(weather.x <= 0.001)
        continue;
      vec4 slow = lod < CLOUD_MEAN_LOD + CLOUD_BROAD_LODS ? cloudSlow(offset, altitude, upK, layerK, kind, lod) : vec4(0.0);
      vec3 cloud = cloudAt(offset, altitude, upK, layerK, kind, weather, slow, lod, footprint, false);
      depth += cloudExtinction(look.x * cloud.y, cloudShare(cloud.x), chord) * segment;
    }
  }
  gl_FragColor = vec4(exp(-depth), 0.0, 0.0, 1.0);
}
#endif
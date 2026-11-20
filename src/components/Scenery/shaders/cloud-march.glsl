// The 3D clouds (SceneryClouds), marched along each pixel's view ray through up to three
// cloud levels' shells about the Earth's centre (low, middle, high: CLOUD_LEVELS_MOST), at a
// share of the screen's resolution. Written as premultiplied linear colour and alpha, and as
// depth log2 of the distance to their front (CLOUD_FRONT): the composite
// (cloud-composite.glsl) draws them over the scene at that depth. One colour attachment,
// so ANGLE compiles its pixel shader once (scenery.md, Performance).
//
// Each level is rounded masses of many sizes, from a map of the cover fixed to the Earth
// (scenery-cloud-cover.ts: a tile of noise, each level reading it at its own scale, turn and
// stretch, drifting with its own wind, read on through it as its clouds form and fade) and a
// profile up its shell: the higher, the more cover a column needs to reach it, so the clouds
// are domed over flat bases and round off below the shell's top. Its look (its type's: how
// soft, lumpy, towering, massed, stretched and dense) comes in uniforms, so a type is data, not
// code.
//
// Stable as the camera moves, however fast and far (documents/clouds.md, "The march"): what a
// point holds and how it is lit are functions of where it lies and of the footprint it is seen
// over (the view's cone, its level of detail), nothing else of the view (cloudDensity,
// cloudLight); and the march's steps are short enough to resolve what they read
// (cloudMarchRuns), so it hardly matters where they fall. Nothing is jittered. The levels' runs
// along a view are marched front to back.

#include <common>
#include ./sky-gradient.glsl
#include ./cloud-field.glsl
#include ./cloud-light.glsl

// Reads of the shape volume a step through cloud takes (cloudDensity): the march's quality's
// (CloudsQualityLevel.shapeReads, its own program); 2 in the programs that read none of it.
#ifndef CLOUD_SHAPE_READS
#define CLOUD_SHAPE_READS 2
#endif

// The march's steps (cloudMarchRuns): x its steps along a run at the quality (for the cost
// view), y how many steps up a level's depth, z the optical depth a step through cloud hides,
// w the angle a pixel of the clouds' image spans (radians).
uniform vec4 uCloudMarch;
// All the steps' lengths times this: 1, less for a reference march (debugging).
uniform float uCloudStepScale;
// 0 drawn, 1 the march's cost (its steps over uCloudMarch.x), 2 unlit (white, as opaque as the
// clouds are), 3 a global weather's map: each level's cover where the view meets the sea (low
// red, middle green, high blue).
uniform int uCloudDebug;
// The screen's derivatives over the full image's pixels: 1, or 0.5 in the interleaved march's
// quarter image (scenery-clouds.ts, `temporal`).
uniform float uCloudDerivative;
// 1 hazed by the air between them and the camera, 0 not.
uniform float uCloudAir;
// The cover volume (CloudCoverVolume): (patches, masses), with mipmaps,
// repeating every way, read on the Earth's curved surface where each column stands
// (cloudFootOf), so the clouds are fixed to the Earth and keep their shape anywhere on it. Laid
// on the plane touching the Earth at the weather's middle instead (a 2D map, 2026-11-09), they
// were squashed far round the Earth (60 times, 83° from the middle) and past 90° not reached.
uniform sampler3D uCloudCover;
// The spread of the cover each level of the cover volume's mipmaps averages away (patches,
// masses; CloudCoverVolume.spread): measured at its texels' middles, once. The volume's squares
// read filtered between texels held the filter's own spread as well (w(1 − w)(a − b)² between
// two texels a and b: none at a texel's middle, the most halfway), which drew the volume's grid
// into every cloud's edge, and through a cover map baked from it at a grid of its own, a moiré
// some kilometres across (2026-11-11).
uniform vec2 uCloudCoverSpread[CLOUD_COVER_LODS];
// The levels drawn (a uniform count keeps the loops loops in Direct3D), from the ground up;
// each one's shell (base and top over the sea, m; its extinction in cloud, 1 / m; its steps
// along a run), the cover its columns need (at its base: its share under cloud, softCoverLevel;
// at its top: its tallest clouds'), its edge's width and how far that need climbs over its
// upper part (cover); its look (the masses' weight against the patches, how far the lumps move
// the cover, a cloud's size in m for how cloud and sky mixed hide what lies behind, the cover
// volume's texel in m); its pattern on the Earth: from metres fixed on the Earth to its cover
// volume's tiles (turned as its wind has carried it about the Earth's centre, stretched along
// it), and where the camera lies in it, from 64-bit floats (in the cover, its broad read, and
// the lumps' two tilings: four a level), each read on through its noise as the clouds form and
// fade (scenery-clouds.ts, updateCamera).
uniform int uCloudLevelCount;
uniform vec4 uCloudShells[CLOUD_LEVELS_MOST];
uniform vec4 uCloudNeeds[CLOUD_LEVELS_MOST];
uniform vec4 uCloudLooks[CLOUD_LEVELS_MOST];
uniform mat3 uCloudTurns[CLOUD_LEVELS_MOST];
uniform vec3 uCloudPlaces[4 * CLOUD_LEVELS_MOST];
// The field's frame to the Earth's (columns: east, north and up at the weather's middle), and
// the sea's radius (m).
uniform mat3 uCloudFieldEarth;
uniform float uCloudEarthRadius;
// Stretches toward the light (cloudLight): a uniform count, so Direct3D keeps the loop a loop
// rather than copying the march into each turn.
uniform int uCloudLightSamples;
// The march's turns at most (cloudMarchRuns): as many as its runs' steps can take, so none is cut
// short; a uniform count, so Direct3D keeps the loop a loop.
uniform int uCloudMarchMost;
// The clouds' scale (relative).
uniform float uCloudScale;
// The local weather's outline: the share of its radius its cloud gives way over, and how far a
// broad noise pushes its edge in and out (a share of its radius).
uniform vec2 uCloudLocalShape;
// Each level's kind: its chain of types' first row (uCloudType*, uCloudCoverTable), its last
// place along the chain, its channel of the cloud map (0 low, 1 middle, 2 high), and its index;
// the way its wind blows (fixed on the Earth, at the weather's middle) and its speed (m/s); and
// a local weather's level's cover.
uniform vec4 uCloudKinds[CLOUD_LEVELS_MOST];
uniform vec4 uCloudWinds[CLOUD_LEVELS_MOST];
uniform float uCloudCovers[CLOUD_LEVELS_MOST];
// Each type's row: its cover's quantiles (softCoverTexel: the cover its columns need for a
// share under cloud), one a texel, filtered linearly; its edge's width and how far its lumps
// move the cover (cover), how far it towers, and its masses' weight; its base, its tops at no
// cover and at full cover (m), and its extinction (1 / m); and the most its cover reaches.
uniform sampler2D uCloudCoverTable;
uniform vec4 uCloudTypeLooks[CLOUD_TYPES];
uniform vec4 uCloudTypeHeights[CLOUD_TYPES];
uniform vec4 uCloudTypeMore[CLOUD_TYPES];
// The ground under the clouds (CloudTerrain, scenery-cloud-terrain.ts), fixed on the Earth: over
// all of it its height over the sea (r, metres; the sea's level under the sea) and its slope east
// and north (g, b); about the camera its height alone, finer, on a square on the plane touching
// the Earth at its middle, reaching uCloudTerrainNearReach (a tangent) from it to its sides.
// uCloudTerrain: x 1 with the Earth's, y the highest ground, z 1 with the map about the camera.
uniform samplerCube uCloudTerrainMap;
uniform sampler2D uCloudTerrainNear;
uniform vec3 uCloudTerrainNearCentre;
uniform vec3 uCloudTerrainNearEast;
uniform vec3 uCloudTerrainNearNorth;
uniform float uCloudTerrainNearReach;
uniform vec4 uCloudTerrain;
// A local weather's light maps (CloudFieldMap, scenery-cloud-field-map.ts): a layer a level, a texel
// a ray toward the light through its shell from where it leaves its base, on the field over the
// weather's disc (uCloudLightArea: the map's middle on the field, its half-width (m), its texels
// a side); in each the optical depth from its base, and from a quarter, half and three quarters
// of the way up, to the shell's top (cloudLightMapMain). The newer drawing faded in over the
// older (uCloudLightFade: the newer's share), each read where the level's wind has carried its
// clouds since it was drawn (uCloudLightDrift, m on the field: a level's newer, then its older).
// How the light is had (uCloudLightMode): 0 marched (cloudLight), 1 from the map
// (SceneryClouds's `lightMap`).
uniform highp sampler2DArray uCloudLightNewer;
uniform highp sampler2DArray uCloudLightOlder;
uniform vec4 uCloudLightArea;
uniform float uCloudLightFade;
uniform vec2 uCloudLightDrift[2 * CLOUD_LEVELS_MOST];
uniform int uCloudLightMode;
// A local weather's cover maps (CloudFieldMap, scenery-cloud-field-map.ts): a layer a level, on
// the field over the weather's disc (uCloudCoverArea: the map's middle on the field, its
// half-width (m), its texels a side), each texel the level's mean cover over it as cloudCoverAt
// reads it from the cover volume (two reads of it): the pattern alone, the weather's edge
// applied after. The newer drawing faded in over the older (uCloudCoverFade), each read where
// the level's wind has carried its clouds since it was drawn (uCloudCoverDrift, as the light
// maps'). Read instead of the volume within it (cloudCoverOf) once one is drawn
// (uCloudCoverMode 1).
uniform highp sampler2DArray uCloudCoverNewer;
uniform highp sampler2DArray uCloudCoverOlder;
uniform vec4 uCloudCoverArea;
uniform float uCloudCoverFade;
uniform vec2 uCloudCoverDrift[2 * CLOUD_LEVELS_MOST];
uniform int uCloudCoverMode;

#if defined(CLOUD_GLOBAL)
// A global weather (scenery-cloud-weather.ts): the weather systems' cloud over the whole Earth
// (scenery-cloud-map.ts), fixed on it, the share under low cloud (r) and how thick it is (g),
// and under cloud at the middle level (b) and the high (a); two drawings some time apart,
// blended (cloudMapRead): the older, the newer, the newer's share, and how long ago each was
// drawn (weather seconds). The same drawings' types (half as many texels a side): each level's
// place along its chain, over the chain's last (r low, g middle, b high).
uniform samplerCube uCloudMap;
uniform samplerCube uCloudMapNext;
uniform samplerCube uCloudTypes;
uniform samplerCube uCloudTypesNext;
uniform vec3 uCloudMapTimes;
// The cloud map's texels a metre.
uniform float uCloudMapTexels;
// How far the level covering most dominates where it lies (cloudLayersInProportion), whether a
// level's look follows its place along its chain (1) or is its chain's first (0), and whether
// the low cloud's thickness sets how deep and dense the cloud is (1) or its type alone (0).
uniform vec4 uCloudGlobal;
// The weather about the camera, baked (CloudPlaceMap, scenery-cloud-place-map.ts): the cloud map
// and its types as cloudPlace reads them (both drawings, drifted, the newer dissolved in), on a
// gnomonic map of the Earth about the camera's foot (uCloudPlaceAxes: its east, north and up
// there, fixed on the Earth), layer 0 the cloud map, 1 the types. uCloudPlaceArea: the map's
// half-width (as a tangent), its texels a side, a texel at its middle (m), and whether it is on.
// Read once where the drawings take two cube reads each, a value noise and the drift's turns.
uniform highp sampler2DArray uCloudPlaceMap;
uniform mat3 uCloudPlaceAxes;
uniform vec4 uCloudPlaceArea;
#endif

varying vec3 vCloudDirection;

// Where along the view what lies behind is drawn over the clouds (their depth): where they hide
// this share of it.
#define CLOUD_FRONT 0.1
// Over this many of the march's pixels a run fades in below its level's top's horizon
// (cloudTopCover).
#define CLOUD_TOP_EDGE 1.0
// Over this share of a level's depth its base fades in.
#define CLOUD_BASE_FADE 0.05
// x: a step is no longer than this many of the pixel's footprints there (cloudMarchRuns), the
// pattern resolved along the view as the footprint resolves it across. y: the lumps (the shape
// volume) are read where the footprint resolves features this share of the volume's tile across
// (its broadest), their spread taken instead where it does not (cloudDensity). z: the march stops
// once this share of the light comes through, as opaque as that from there on: at 5 % rather than
// 1 %, 0.77–0.89 of the time through an overcast, unseen (2026-11-10). Uniforms, so a choice of
// them is the same program.
uniform vec3 uCloudDetail;
// A step longer than this many of the steps through the cloud it found is walked again, as short
// as those (cloudMarchRuns).
#define CLOUD_AGAIN 1.5
// No step is shorter than this many texels of the shape volume (the least its lumps change over)
// but where the cloud it finds asks for it: clear air is walked no finer, and a step that comes
// into cloud is walked again, as short as the cloud asks (CLOUD_AGAIN).
#define CLOUD_STEP_TEXELS 8.0
// Past a step finding no cloud, the march looks ahead (cloudMarchRuns) only where the point was
// clear by this many of the edge's deviations however its lumps fell (gClear); nearer cloud, it
// walks on.
#define CLOUD_CLEAR 4.0
// The first stretch toward the light: a cloud's skin (m, at scale 1), how its lit side and its
// shaded side differ; and the light read through a level's own cloud up to its top, but no
// further than this many of its clouds' sizes (cloudLight).
#define CLOUD_LIGHT_SKIN 200.0
#define CLOUD_LIGHT_REACH 6.0
// The lumps' second tiling: this many times broader (turned, CLOUD_LUMPS_TURN).
#define CLOUD_LUMP_BROADER 1.618
// The clouds' tops round off from this share of a level's depth up (cloudDensity).
#define CLOUD_ROUNDED 0.5
// How the cover a column needs rises up a level (a power): domed tops over flat bases.
#define CLOUD_DOME 2.0
// By a level's top, the cover a column needs is past the most any reaches by this many of the
// lumps' and the edge's widths (a global weather's, place by place: ROUND_REACH).
#define CLOUD_ROUND_REACH 3.0
// A level is cut by another covering more (cloudPlace) eased in over this much cover either side
// of a tie: the twin of CLOUD_LAYERS_TIE (weather.ts).
#define CLOUD_TIE 0.1
// The weather systems' drift east (m/s) in the trades and in the storm tracks: the twin of
// weatherSystemDrift (weather-systems.ts). Where the older drawing of the map gives way to the
// newer (cloudMapRead): a value noise of cells some 1/x radians across (some 400 km) picks when,
// and each place takes y of the time between them.
#define CLOUD_MAP_DRIFT vec2(-5.0, 12.0)
#define CLOUD_MAP_DISSOLVE vec2(16.0, 0.3)
// The density of the weather systems' cloud by how thick the low cloud is (a power of 2: a thin
// veil to a deep system's heart), and the middle and high levels' by how deep the system is
// under them: from x to y as the low cloud's thickness goes from z to w.
#define CLOUD_MAP_DENSITY vec2(-1.5, 0.5)
#define CLOUD_MAP_UPPER vec4(-1.0, 0.5, 0.2, 0.9)
// How deep a global weather's cloud reaches up its type's heights by the low cloud's thickness:
// from this share of them, thin, to all, deep.
#define CLOUD_MAP_SHALLOW 0.35
// A point whose share in cloud is less than CLOUD_LEAST holds none (cloudDensity): the clouds'
// soft edge never quite reaches nothing, and gated on a far smaller share, every step through the
// clear air between them was lit, each light read with the levels over it.
#define CLOUD_LEAST 1e-3
// The most the lumps' noise reaches, in its deviations (cloudDensity): both reads at 1.
#define CLOUD_LUMPS_MOST ((1.0 - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y * 1.41421356)
// The ground (CloudTerrain): the share of its broad height the low level rises by, as cloud bases
// rise over high ground, so a level meant to lie 1000 m up does not lie on a plateau (Greenland's
// ice). The middle and high levels keep their heights, and mountains rise through them; nor does
// a view end where it meets the ground: the scene's own depth hides what lies behind the relief
// (cloudRiseOf). Read at the level of its map some 220 km across, the broad lie of the land, and
// along a view only every CLOUD_TERRAIN_REREAD (x metres, or y of the distance where that is
// farther), taken in a straight line between: read every turn, finer, with the view ending where it
// met the ground, the ground was 9–23 % of the march (RTX A1000, 2026-11-17). Where a view's runs
// are tightened to the rise along them, how many places along each run it is read at and how much
// spare (metres) is left either side.
#define CLOUD_TERRAIN_RISE 0.8
#define CLOUD_TERRAIN_LOD 3.5
#define CLOUD_TERRAIN_REREAD vec2(20000.0, 0.1)
#define CLOUD_TERRAIN_ALONG 5
#define CLOUD_TERRAIN_SPARE 100.0

// The view, set once by main: from the camera (world: its offset from the sphere's centre, and
// its height over the sea), its way (world, and on the field's frame), how its clouds are lit
// (cloudLightingAt) and the light's way on the field's frame, and what it has gathered so far:
// premultiplied colour, what it still lets through, where its light comes from (weighed), its
// front, and its steps.
vec3 gO;
vec3 gDir;
vec3 gD;
float gHeight;
CloudLighting gLighting;
vec3 gWay;
vec3 gColor = vec3(0.0);
float gTransmit = 1.0;
float gDepthSum = 0.0;
float gWeight = 0.0;
float gFront = -1.0;
float gCost = 0.0;
// The ground (set by main): whether there is any, and the broad ground's height under the step
// being marched (cloudTerrainBroad's x).
bool gTerrain = false;
vec4 gBroad = vec4(0.0);

// A cloud level (the uniforms' `l`th). In a global weather, its shell's base and top, its
// extinction, its need and its look's masses and lumps are its place's (cloudPlace), read once a
// step (cloudMarchRuns).
struct CloudLevel {
  vec4 shell;
  vec4 need;
  vec4 look;
  mat3 turn;
  vec3 place;
  vec3 broad;
  vec3 lump;
  vec3 lump2;
  vec4 kind;
  vec4 wind;
  float cover;
};

CloudLevel cloudLevel(int l) {
  CloudLevel L;
  L.shell = uCloudShells[l];
  L.need = uCloudNeeds[l];
  L.look = uCloudLooks[l];
  L.turn = uCloudTurns[l];
  L.place = uCloudPlaces[4 * l];
  L.broad = uCloudPlaces[4 * l + 1];
  L.lump = uCloudPlaces[4 * l + 2];
  L.lump2 = uCloudPlaces[4 * l + 3];
  L.kind = uCloudKinds[l];
  L.wind = uCloudWinds[l];
  L.cover = uCloudCovers[l];
  return L;
}

// The up at `p` (on the field's frame), fixed on the Earth (the frame the ground and the weather
// systems' map are drawn in).
vec3 cloudUpEarthOf(vec3 p) {
  return normalize(uCloudFieldEarth * vec3(p.xy, p.z + 1.0 / max(uCloudInvRadius, 1e-12)));
}

// The broad ground under a column whose up is `upEarth` (fixed on the Earth): its height over
// the sea (x) and its slope east and north (yz), at CLOUD_TERRAIN_LOD.
vec4 cloudTerrainBroad(vec3 upEarth) {
  return textureLod(uCloudTerrainMap, upEarth, CLOUD_TERRAIN_LOD);
}

// The ground under a column whose up is `upEarth`, metres over the sea (the sea's level under
// it): the map about the camera's where it reaches, eased into the Earth's toward its sides.
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

// The share of the ground's broad height level `kind`'s shell rises by: the low level's alone (its
// channel, 0); the middle and high levels keep their heights, and mountains rise through them.
float cloudRiseOf(vec4 kind) {
  return kind.z < 0.5 ? CLOUD_TERRAIN_RISE : 0.0;
}

// Where to read the cover a column needs for `share` under cloud from a row of
// uCloudCoverTable: softCoverTexel (soft-clouds.ts).
float cloudCoverTexel(float share) {
  return ((1.0 - clamp(share, 0.0, 1.0)) * float(CLOUD_QUANTILES) + 0.5) / float(CLOUD_QUANTILES + 1);
}

// The cover a column of level `L` needs for `cover` under cloud, at its base (x) and at its top
// (y), and how far it climbs on over the level's upper part (w), its type's rows `r0` and `r1`
// `w` of the way between them; its edge's width (z) kept.
vec4 cloudNeedOf(CloudLevel L, float cover, int r0, int r1, float w) {
  vec4 look = mix(uCloudTypeLooks[r0], uCloudTypeLooks[r1], w);
  float highest = mix(uCloudTypeMore[r0].x, uCloudTypeMore[r1].x, w);
  float row = (float(r0) + w * float(r1 - r0) + 0.5) / float(CLOUD_TYPES);
  float needBase = textureLod(uCloudCoverTable, vec2(cloudCoverTexel(cover), row), 0.0).r;
  float needTop = textureLod(uCloudCoverTable, vec2(cloudCoverTexel(cover * (0.02 + 0.3 * look.z)), row), 0.0).r;
  needTop = max(needTop, needBase + 1e-4);
  return vec4(needBase, needTop, look.x, max(highest + CLOUD_ROUND_REACH * (look.y + look.x) - needTop, 0.0));
}

#if defined(CLOUD_GLOBAL)
// How fast the weather systems travel east at `s`, the sine of the latitude (m/s): the twin of
// weatherSystemDrift (weather-systems.ts): the trades' easterlies, the westerlies of the storm
// tracks, weaker toward the poles.
float cloudMapDrift(float s) {
  float a = degrees(asin(clamp(abs(s), 0.0, 1.0)));
  return CLOUD_MAP_DRIFT.x + (CLOUD_MAP_DRIFT.y - CLOUD_MAP_DRIFT.x) * smoothstep(18.0, 35.0, a) * (1.0 - 0.6 * smoothstep(60.0, 80.0, a));
}

// Where what lies at `way` (fixed on the Earth, z toward the north pole) lay `seconds` before:
// back along the systems' drift, a turn about the pole.
vec3 cloudMapBack(vec3 way, float seconds) {
  float across = max(length(way.xy), 0.05);
  float turn = -cloudMapDrift(way.z) * seconds / (uCloudEarthRadius * across);
  float c = cos(turn);
  float s = sin(turn);
  return vec3(c * way.x - s * way.y, s * way.x + c * way.y, way.z);
}

// The newer drawing's share of the cloud map at `way` (unit, fixed on the Earth), as the clock
// has it: the older giving way to the newer place by place (CLOUD_MAP_DISSOLVE), each over a
// share of the time between them at a time of its own: blended everywhere at once, two
// drawings hours apart halved each other's cloud into a grey veil.
float cloudMapShare(vec3 way) {
  float share = uCloudMapTimes.x;
  if(share > 0.0) {
    float at = cloudValueNoise(way * CLOUD_MAP_DISSOLVE.x + 17.0) * (1.0 - CLOUD_MAP_DISSOLVE.y);
    share = smoothstep(at, at + CLOUD_MAP_DISSOLVE.y, share);
  }
  return share;
}

// A map drawn of the weather (the cloud map, or its types) at `way` at the level `lod`, from
// its `older` and `newer` drawings, each read where its cloud has drifted to since
// (cloudMapBack), the newer's `share` of it (cloudMapShare).
vec4 cloudMapBlend(samplerCube older, samplerCube newer, vec3 way, float lod, float share) {
  vec4 before = vec4(0.0);
  if(share < 1.0)
    before = textureLod(older, cloudMapBack(way, uCloudMapTimes.y), lod);
  if(share <= 0.0)
    return before;
  return mix(before, textureLod(newer, cloudMapBack(way, uCloudMapTimes.z), lod), share);
}

// Level `L` as the weather systems have it at `p` (on the field's frame), read over `extent`
// (m): its cover there (none: false), kept in proportion to the level covering most there; its
// place along its chain of types, its look and its heights the types' between which it lies;
// the cover its columns need from its cover; its extinction, and with the low cloud's thickness
// (uCloudGlobal.z) how deep and dense it is.
bool cloudPlace(inout CloudLevel L, vec3 p, float extent) {
  vec3 way = normalize(uCloudFieldEarth * vec3(p.xy, p.z + uCloudEarthRadius));
  float lod = log2(max(2.0 * extent * uCloudMapTexels, 1.0));
  // From the map baked about the camera where it reaches (CloudPlaceMap), at the same footprint.
  vec3 baked = vec3(-1.0);
  float bakedLod = 0.0;
#if !defined(CLOUD_PLACE_MAP)
  float facing = dot(way, uCloudPlaceAxes[2]);
  if(uCloudPlaceArea.w > 0.5 && facing > 0.0) {
    vec2 at = vec2(dot(way, uCloudPlaceAxes[0]), dot(way, uCloudPlaceAxes[1])) / (facing * uCloudPlaceArea.x) * 0.5 + 0.5;
    if(all(greaterThanEqual(at, vec2(0.0))) && all(lessThanEqual(at, vec2(1.0)))) {
      baked = vec3(at, 0.0);
      bakedLod = log2(max(2.0 * extent / uCloudPlaceArea.z, 1.0));
    }
  }
#endif
  float blend = 0.0;
  vec4 m = vec4(0.0);
  if(baked.x >= 0.0)
    m = textureLod(uCloudPlaceMap, baked, bakedLod);
  else {
    blend = cloudMapShare(way);
    m = cloudMapBlend(uCloudMap, uCloudMapNext, way, lod, blend);
  }
  int channel = int(L.kind.z);
  vec3 covers = vec3(m.r, m.b, m.a);
  vec3 mine = vec3(equal(ivec3(0, 1, 2), ivec3(channel)));
  float cover = dot(covers, mine);
  // Cut by each level covering more, by as much as it covers, eased in over CLOUD_TIE of cover
  // either side of a tie (cloudLayersInProportion): cut by the most-covering level alone, two
  // levels near full cover flipped which one ruled texel by texel, and the other's cloud came
  // and went in slabs along the map's texels.
  vec3 over = covers * smoothstep(vec3(cover - CLOUD_TIE), vec3(cover + CLOUD_TIE), covers);
  over *= 1.0 - mine;
  cover *= 1.0 - uCloudGlobal.x * max(over.x, max(over.y, over.z));
  if(cover < 0.003)
    return false;
  float place = 0.0;
  if(uCloudGlobal.y > 0.5 && L.kind.y > 0.0) {
    vec4 t = vec4(0.0);
    if(baked.x >= 0.0)
      t = textureLod(uCloudPlaceMap, vec3(baked.xy, 1.0), bakedLod);
    else
      t = cloudMapBlend(uCloudTypes, uCloudTypesNext, way, max(lod - 1.0, 0.0), blend);
    place = (channel == 0 ? t.r : (channel == 1 ? t.g : t.b)) * L.kind.y;
  }
  float i = min(floor(place), max(L.kind.y - 1.0, 0.0));
  float w = clamp(place - i, 0.0, 1.0);
  int r0 = int(L.kind.x + i);
  int r1 = L.kind.y > 0.0 ? r0 + 1 : r0;
  vec4 look = mix(uCloudTypeLooks[r0], uCloudTypeLooks[r1], w);
  vec4 heights = mix(uCloudTypeHeights[r0], uCloudTypeHeights[r1], w);
  // The rows between them, filtered.
  L.need = cloudNeedOf(L, cover, r0, r1, w);
  L.look.x = look.w;
  L.look.y = look.y;
  float base = heights.x;
  float top = mix(heights.y, heights.z, cover);
  float extinction = heights.w;
  if(uCloudGlobal.z > 0.5) {
    float thickness = channel == 0 ? m.g : smoothstep(CLOUD_MAP_UPPER.z, CLOUD_MAP_UPPER.w, m.g);
    top = base + (top - base) * mix(CLOUD_MAP_SHALLOW, 1.0, thickness);
    vec2 range = channel == 0 ? CLOUD_MAP_DENSITY : CLOUD_MAP_UPPER.xy;
    extinction *= exp2(mix(range.x, range.y, thickness));
  }
  L.shell.x = base;
  L.shell.y = max(top, base + 1.0);
  L.shell.z = extinction;
  return true;
}

#else
// A local weather's levels are as their uniforms have them everywhere.
bool cloudPlace(inout CloudLevel L, vec3 p, float extent) {
  return true;
}
#endif

// Level `L` at `p` (on the field's frame) over the broad ground under the step (gBroad), read
// over `extent` (m): placed (cloudPlace; none there: false), and its shell raised by its share of
// the ground's height (cloudRiseOf). A global weather's map has the ground's lift and its lee
// already (cloud-map.glsl).
bool cloudSet(inout CloudLevel L, vec3 p, float extent) {
  if(!cloudPlace(L, p, extent))
    return false;
  if(gTerrain)
    L.shell.xy += cloudRiseOf(L.kind) * gBroad.x;
  return true;
}

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

// The runs of a view inside a shell between `span.x` and `span.y` over the sea's sphere, up
// to where it meets the `ground`: the one before it dips under the base, and the one after
// it comes back up; each (from, to), empty where from >= to.
void cloudRuns(vec3 o, vec3 dir, float height, vec2 span, float ground, out vec2 near, out vec2 far) {
  vec2 top = cloudBelow(o, dir, height, span.y);
  vec2 base = cloudBelow(o, dir, height, span.x);
  bool under = base.x < base.y && base.y > 0.0;
  near = vec2(max(top.x, 0.0), min(min(top.y, under ? base.x : top.y), ground));
  far = under ? vec2(max(base.y, 0.0), min(top.y, ground)) : vec2(1.0, -1.0);
}

// How much of a pixel `pixel` (radians) across, along `dir`, a run through a shell topped at
// `top` covers. Seen from above, that top is a sphere's edge, and a view grazing it runs
// hundreds of kilometres through the shell (2√(2Rδ) for δ under its top: 22 km at 10 m, 290 km
// at 1.6 km), so its cloud turns from none to opaque within a pixel: along the Earth's limb it
// stood in steps, 1 / its slope apart, at any resolution and any number of steps (2026-11-19).
// Eased over CLOUD_TOP_EDGE of them below that edge; 1 from inside the shell, or with the
// globe off.
float cloudTopCover(vec3 dir, float top, float pixel) {
  return clamp(globeBelowHorizon(cameraPosition, dir, -top) / (CLOUD_TOP_EDGE * pixel), 0.0, 1.0);
}

// The stretch of a view along `d` (on the field's frame) within the local weather's radius of
// its axis (the line from the Earth's centre through its middle): its near and far distance,
// x > y where it passes outside. What lies outside holds no cloud, and is not marched.
vec2 cloudLocalSpan(vec3 d) {
  vec2 o = uCloudCamera.xy;
  float a = dot(d.xy, d.xy);
  float b = dot(o, d.xy);
  float outside = dot(o, o) - uCloudLocalRadius * uCloudLocalRadius;
  if(a < 1e-12)
    return outside <= 0.0 ? vec2(0.0, CLOUD_FAR) : vec2(1.0, 0.0);
  float disc = b * b - a * outside;
  if(disc < 0.0)
    return vec2(1.0, 0.0);
  float s = sqrt(disc);
  return vec2((-b - s) / a, (-b + s) / a);
}

// The up at `t` along the view (world).
vec3 cloudUpAt(float t) {
  return globeOn() ? normalize(gO + gDir * t) : uGlobeUp;
}

// The sine of the light's height over the horizon at `p` (on the field's frame), by its own up
// there: by the field's (up at the weather's middle) it stood a degree off 100 km away, nine
// 1000 km away, much of a low sun's height.
float cloudRisingAt(vec3 p) {
  if(uCloudInvRadius <= 0.0)
    return gWay.z;
  return dot(gWay, normalize(vec3(p.xy, p.z + 1.0 / uCloudInvRadius)));
}

// The broad noise pushing the local weather's edge in and out at `field` (fixed on the Earth),
// −1 to 1: the cover volume's patches, read as a plane a few across it. It changes over tens of kilometres,
// so it is read once a step along a view (gEdgeNoise), not in every sample of it.
float cloudEdgeNoise(vec2 field) {
  if(uCloudLocalShape.y <= 0.0)
    return 0.0;
  return clamp(3.0 * textureLod(uCloudCover, vec3(field / (3.0 * uCloudLocalRadius) + 0.29, 0.37), 1.0).r, -1.0, 1.0);
}
float gEdgeNoise = 0.0;

// How far inside the local weather `field` lies (fixed on the Earth): 1 well inside, 0 beyond
// its edge. Its edge is pushed in and out by gEdgeNoise, so it is no circle; never past its
// radius, so what lies outside need not be marched.
float cloudLocalEdge(vec2 field) {
#if defined(CLOUD_GLOBAL)
  return 1.0;
#endif
  float wobble = uCloudLocalShape.y;
  float outer = 1.0 - wobble;
  return 1.0 - smoothstep(outer - uCloudLocalShape.x, outer, length(field) / uCloudLocalRadius + wobble * gEdgeNoise);
}

// What a step from `t`, `len` long, of extinction `sigma` lit `light`, hides and adds.
void cloudAdd(float t, float len, float sigma, vec3 light) {
  if(sigma <= 0.0 || len <= 0.0)
    return;
  float through = exp(-sigma * len);
  float absorbed = gTransmit * (1.0 - through);
  gColor += absorbed * light;
  gDepthSum += absorbed * (t + 0.5 * len);
  gWeight += absorbed;
  // Where within the step they come to hide CLOUD_FRONT of what lies behind.
  if(gFront < 0.0 && gTransmit * through < 1.0 - CLOUD_FRONT)
    gFront = t + len * clamp((gTransmit - 1.0 + CLOUD_FRONT) / max(absorbed, 1e-6), 0.0, 1.0);
  gTransmit *= through;
}

// The up at `p` (on the field's frame): from the Earth's centre through it; the field's with the
// globe off.
vec3 cloudUpOf(vec3 p) {
  return uCloudInvRadius > 0.0 ? normalize(vec3(p.xy, p.z + 1.0 / uCloudInvRadius)) : vec3(0.0, 0.0, 1.0);
}

// Where the column through the point `o` from the camera (on the field's frame), whose up is
// `up` and which lies `altitude` over the sea, stands on the sea's sphere: from the camera,
// fixed on the Earth (m). A level's pattern lies there, the same all up the column.
vec3 cloudFootOf(vec3 o, vec3 up, float altitude) {
  return uCloudFieldEarth * (o - up * altitude);
}

// The spread of the cover volume's patches (x) and masses (y) a read at the level `lod` of its
// mipmaps averages away (uCloudCoverSpread), linear between its levels as the read is.
vec2 cloudCoverSpreadAt(float lod) {
  float x = clamp(lod, 0.0, float(CLOUD_COVER_LODS - 1));
  int i = int(min(floor(x), float(CLOUD_COVER_LODS - 2)));
  return mix(uCloudCoverSpread[i], uCloudCoverSpread[i + 1], x - float(i));
}

// The spread of level `L`'s cover over `extent` (m) about its mean: what its reads of the cover
// volume (cloudCoverAt) average away, weighed as their means are. The same everywhere at a
// footprint: what a footprint holds about its mean, as the volume holds it on average.
float cloudSpreadOf(CloudLevel L, float extent) {
  float lod = log2(max(extent / L.look.w, 1.0));
  vec2 fine = cloudCoverSpreadAt(lod);
  float broad = cloudCoverSpreadAt(max(lod - log2(CLOUD_PATCHES_BROADER), 0.0)).x;
  float w = L.look.x;
  float f = CLOUD_PATCHES_FINE;
  return broad + f * f * fine.x + w * w * fine.y;
}

// Level `L`'s cover's mean and spread over `extent` (m) about where a column stands (`foot`,
// cloudFootOf): the volume read there for the masses and the fine patches, and a second time
// CLOUD_PATCHES_BROADER times broader, turned, for the broad patches, which the fine ones run on
// from (CLOUD_PATCHES_FINE); the spread they average away (cloudSpreadOf). A 3D texture is
// filtered every way alike, so a stretch of a view is read over all of its extent: read narrower,
// at its middle, what lay between its samples was skipped, and grains came and went as the view
// moved.
vec2 cloudCoverAt(CloudLevel L, vec3 foot, float extent) {
  vec3 at = L.turn * foot;
  float lod = log2(max(extent / L.look.w, 1.0));
  vec2 c = textureLod(uCloudCover, at + L.place, lod).xy;
  float b = textureLod(uCloudCover, CLOUD_PATCHES_TURN * at / CLOUD_PATCHES_BROADER + L.broad, max(lod - log2(CLOUD_PATCHES_BROADER), 0.0)).x;
  return vec2(b + CLOUD_PATCHES_FINE * c.x + L.look.x * c.y, cloudSpreadOf(L, extent));
}

// As cloudCoverAt, the column at `field` (on the field): from a local weather's cover map where
// it reaches (uCloudCoverMode), one read of a 2D map for its two of the 3D volume (two while a
// newer drawing fades in); else from the volume.
vec2 cloudCoverOf(CloudLevel L, vec3 foot, vec2 field, float extent) {
#if !defined(CLOUD_GLOBAL) && !defined(CLOUD_COVER_MAP)
  float side = 2.0 * uCloudCoverArea.z;
  int layer = int(L.kind.w);
  vec2 on = (field - uCloudCoverArea.xy) / side + 0.5;
  vec2 at = on - uCloudCoverDrift[2 * layer] / side;
  bool mapped = uCloudCoverMode > 0 && all(greaterThanEqual(at, vec2(0.0))) && all(lessThanEqual(at, vec2(1.0)));
  vec2 seen = vec2(0.0);
  if(mapped) {
    float lod = log2(max(extent * uCloudCoverArea.w / side, 1.0));
    float cover = textureLod(uCloudCoverNewer, vec3(at, L.kind.w), lod).x;
    if(uCloudCoverFade < 1.0)
      cover = mix(textureLod(uCloudCoverOlder, vec3(on - uCloudCoverDrift[2 * layer + 1] / side, L.kind.w), lod).x, cover, uCloudCoverFade);
    seen = vec2(cover, cloudSpreadOf(L, extent));
  } else
    seen = cloudCoverAt(L, foot, extent);
  // One return. Returned from within the map's branch, Direct3D warned of an unset value
  // (X4000), and the march was slower: 1.67 ms against 1.33 (Timelapse at noon, the cover map
  // on, 2026-11-20). The volume in a loop run once or not at all was slower still (2.14).
  return seen;
#else
  return cloudCoverAt(L, foot, extent);
#endif
}

// The normal distribution's CDF at `z` (Abramowitz and Stegun 7.1.26, its tail taken directly so
// it keeps its precision far out): the share of a stretch's columns whose cover, spread normally
// about its mean, passes what they need. A normal blurred is a wider normal, so a stretch read
// whole holds what its parts do on average. The logistic it replaced did not: in the faint tail,
// read over a long step, the clouds came out 2 to 20 times what its parts held, a glow about and
// between them (2026-11-10).
float cloudNormalCdf(float z) {
  float x = abs(z) * 0.70710678;
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float tail = 0.5 * t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-x * x);
  return z < 0.0 ? tail : 1.0 - tail;
}

// The extinction (1 / m) of level `L` at the point `o` from the camera (on the field's frame),
// seen over a footprint `w` wide (m): the view's cone there, or what a sample toward the light
// stands for. The footprint is all it takes from the view, as the level of detail of what it
// reads: never the step it is read for, its length, its slope or where it begins. So the clouds
// keep their shape and their light however the march is laid out, and change only as the
// footprint grows (documents/clouds.md, "The march"). In a global weather, `L` as the weather
// systems have it there (cloudSet, by the caller). `lumps`: the shape volume read where the
// footprint resolves it (the view), or its spread taken instead (toward the light).
//
// Its share in cloud is the share of the footprint's columns whose cover passes what they need at
// its height: the cover's mean and spread over the footprint (cloudCoverOf), the lumps where the
// footprint resolves them, a normal edge (cloudNormalCdf: a normal blurred is a wider normal, so a
// footprint read whole holds what its parts do on average). The footprint spans `w` up and down
// too, up to the level's depth: what the need climbs over that widens the edge, so a view grazing
// a level's top far off takes the share its pixel holds there rather than all or none.
//
// Cloud the footprint resolves hides as its density. Cloud and sky mixed across it (the spread it
// holds across the view, against the edge's own width) hide as rays passing through clouds or
// between them, in chunks of a cloud's size (L.look.z, fixed): a broken field seen from afar lets
// through what lies between its clouds, not a haze of their mean.
//
// It leaves in gClear how far clear the point is however the lumps fall there (the edge's
// deviations): over CLOUD_CLEAR, the air about it is taken as clear enough to look ahead
// (cloudMarchRuns).
float gClear = 0.0;

float cloudDensity(CloudLevel L, vec3 o, float w, bool lumps) {
  vec3 p = uCloudCamera + o;
  float altitude = cloudAltitudeOf(p);
  float depth = L.shell.y - L.shell.x;
  float u = (altitude - L.shell.x) / depth;
  gClear = 1e3;
  if(u <= 0.0 || u >= 1.0)
    return 0.0;
  float base = smoothstep(0.0, CLOUD_BASE_FADE * depth, altitude - L.shell.x);
  vec2 field = cloudFieldOf(p);
  vec3 up = cloudUpOf(p);
  vec2 c = cloudCoverOf(L, cloudFootOf(o, up, altitude), field, w);
  // The cover the column needs here, domed over the level's lower part, and over its upper part
  // climbing on (as the square of the way up it) past the most any column reaches by its top
  // (need.w): each cloud's top rounds off at a height of its own cover's, and none reaches the
  // level's top, which would cut the tallest flat. And how fast it climbs, for the footprint's
  // spread up the level.
  float span = L.need.y - L.need.x;
  float need = L.need.x + span * pow(u, CLOUD_DOME);
  float slope = span * CLOUD_DOME * pow(max(u, 0.05), CLOUD_DOME - 1.0) / depth;
  float rounding = max(u - CLOUD_ROUNDED, 0.0) / (1.0 - CLOUD_ROUNDED);
  need += L.need.w * rounding * rounding;
  slope += L.need.w * 2.0 * rounding / ((1.0 - CLOUD_ROUNDED) * depth);
  float tall = min(w, depth);
  float spread = c.y + slope * slope * tall * tall / 12.0;
  // The lumps where the footprint resolves them, as features uCloudDetail.y of the shape volume's
  // tile across; their spread where it does not. Their tile is the cover's over CLOUD_LUMP_TILES,
  // turned and stretched with it.
  float tile = L.look.w * CLOUD_COVER_SIZE / CLOUD_LUMP_TILES;
  float keep = lumps ? 1.0 - smoothstep(0.15, 0.5, w / (uCloudDetail.y * tile)) : 0.0;
  float lumpSpread = L.look.y * L.look.y * (1.0 - keep * keep);
  float soft = L.need.z * L.need.z;
  float scale = inversesqrt(soft + spread + lumpSpread);
  // Toward the local weather's edge, fewer and smaller clouds: the need raised, by its edge past
  // the most any column reaches. Faded instead, they turned see-through, a haze from far off.
  float inside = cloudLocalEdge(field);
  float apart = (1.0 - inside) * (span + L.need.w + 4.0 * sqrt(soft + spread + lumpSpread));
  float fade = base * smoothstep(0.0, 0.15, inside);
  float mean = c.x;
  // How far clear the point is however the lumps fall (in the edge's deviations, gClear): the most
  // they add, against what the point needs.
  float most = mean + L.look.y * keep * CLOUD_LUMPS_MOST - need - apart;
  gClear = -most * scale;
  if(keep > 0.0) {
    // In clear air, not read: with the most the lumps add, the share would be no more than
    // CLOUD_LEAST, taken as none.
    if(fade * cloudNormalCdf(most * scale) <= CLOUD_LEAST)
      return 0.0;
    // Read twice, the second turned and CLOUD_LUMP_BROADER times broader, at equal weight: one
    // tiling's period showed as a grid over a whole deck. In 3D where the point lies, fixed on
    // the Earth. Once at the lower qualities (CLOUD_SHAPE_READS 1: plainer, as stable; a sixth
    // less of the march), its deviation from the mean as the two's sum has it.
    vec3 at = L.turn * (uCloudFieldEarth * o) * CLOUD_LUMP_TILES;
    vec3 q = at + L.lump;
    float lod = max(log2(max(w, 1.0) * CLOUD_SHAPE_TEXELS / tile), 0.0);
#if CLOUD_SHAPE_READS > 1
    float broader = tile * CLOUD_LUMP_BROADER;
    vec3 q2 = CLOUD_LUMPS_TURN * at / CLOUD_LUMP_BROADER + L.lump2;
    float lod2 = max(log2(max(w, 1.0) * CLOUD_SHAPE_TEXELS / broader), 0.0);
    float n = textureLod(uCloudShape, q, lod).r + textureLod(uCloudShape, q2, lod2).r;
    n = (0.5 * n - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y * 1.41421356;
#else
    float n = (textureLod(uCloudShape, q, lod).r - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y;
#endif
    mean += L.look.y * keep * n;
  }
  float share = fade * cloudNormalCdf((mean - need - apart) * scale);
  if(share <= CLOUD_LEAST)
    return 0.0;
  // What of the spread lies across the footprint: the cover's (within a footprint narrower than a
  // texel of the cover, its interpolation's, as the footprint's share of the texel squared) and
  // the lumps it does not resolve.
  float across = min(w / L.look.w, 1.0);
  float mixed = c.y * across * across + lumpSpread;
  float unresolved = mixed / (soft + mixed);
  float sigma = L.shell.z;
  float chunk = L.look.z;
  float through = -log(max(1.0 - share * (1.0 - exp(-sigma * chunk)), 1e-6)) / chunk;
  return mix(sigma * share, through, unresolved);
}

// A light map's optical depth from `h` up its level's shell (0 its base, 1 its top) to the top,
// from a texel's four (cloudLightMapMain): linear between them, none at the top.
float cloudLightProfile(vec4 depths, float h) {
  float x = clamp(h, 0.0, 1.0) * 4.0;
  float i = min(floor(x), 3.0);
  vec4 pick = vec4(equal(vec4(i), vec4(0.0, 1.0, 2.0, 3.0)));
  return mix(dot(depths, pick), dot(vec4(depths.yzw, 0.0), pick), x - i);
}

// Level `L`'s optical depth toward the light from the point `p` (on the field's frame) `h` up its
// shell (0 its base, 1 its top) to `h1` up it, along the ray toward the light: from its light
// maps, read over `across` (m), the newer faded in over the older. Along a ray, height up the
// shell and distance go together as the map was drawn (`r`: the light's rise at the weather's
// middle).
float cloudLightFromMap(CloudLevel L, vec3 p, float h, float h1, float across) {
  float depth = L.shell.y - L.shell.x;
  float r = max(gWay.z, 0.05);
  vec2 field = cloudFieldOf(p - gWay * (h * depth / r));
  float side = 2.0 * uCloudLightArea.z;
  float lod = log2(max(across * uCloudLightArea.w / side, 1.0));
  int layer = int(L.kind.w);
  vec2 at = (field - uCloudLightArea.xy) / side + 0.5;
  vec4 newer = textureLod(uCloudLightNewer, vec3(at - uCloudLightDrift[2 * layer] / side, float(layer)), lod);
  float tau = cloudLightProfile(newer, h) - cloudLightProfile(newer, h1);
  if(uCloudLightFade < 1.0) {
    vec4 older = textureLod(uCloudLightOlder, vec3(at - uCloudLightDrift[2 * layer + 1] / side, float(layer)), lod);
    tau = mix(cloudLightProfile(older, h) - cloudLightProfile(older, h1), tau, uCloudLightFade);
  }
  return max(tau, 0.0);
}

// The light's crossing of each level over the points lit along this pixel's view (cloudLight):
// where it crossed its shell's middle, and its optical depth there (w; under 0 for none yet). A
// crossing is read over a quarter of its length at least, so the crossings of points lit close
// together read the same cloud: within CLOUD_CROSS_REUSE of that footprint of the last read, it
// is taken as read (2026-11-16: global weather 6–15 % less of the march, local the same; the
// image as a march four times finer has it). Only the second and third levels drawn are crossed
// (the lowest is under every other), each its own slot: kept in arrays indexed by level,
// Direct3D left them in indexable registers and a local weather's march took 10–25 % longer.
// Cleared for each pixel (their initialisers).
#define CLOUD_CROSS_REUSE 0.5
vec4 gCrossSecond = vec4(0.0, 0.0, 0.0, -1.0);
vec4 gCrossThird = vec4(0.0, 0.0, 0.0, -1.0);

// The light the point `o` from the camera, in level `l` placed as `L`, scatters toward it, seen
// over a footprint `w` wide (m). The optical depth toward the light (gWay): through its own level
// in uCloudLightSamples stretches, the first a cloud's skin (CLOUD_LIGHT_SKIN), the rest growing
// geometrically up to its top or CLOUD_LIGHT_REACH clouds' sizes (or from its light maps:
// `lightMap`); then across each level over it, where the light crosses its middle (the last
// point's crossing again where it lies close: gCrossSecond, gCrossThird). Each stretch is read
// once at its middle over a footprint of its own length (half of it; a quarter of a crossing), or
// `w` where wider, through cloudDensity: like the view's own, what the light passes is the same
// however the view's steps fall. One loop over all of them, with a uniform count, so the
// density's reads are compiled into it once.
vec3 cloudLight(CloudLevel L, int l, vec3 o, float w) {
  vec3 p = uCloudCamera + o;
  float altitude = cloudAltitudeOf(p);
  float depth = L.shell.y - L.shell.x;
  float rising = cloudRisingAt(p);
  float h = clamp((altitude - L.shell.x) / depth, 0.0, 1.0);
  float toTop = max(L.shell.y - altitude, 0.0) / max(rising, 0.05);
  float reach = min(toTop, CLOUD_LIGHT_REACH * L.look.z);
  float skin = min(CLOUD_LIGHT_SKIN * uCloudScale, reach);
  int own = uCloudLightSamples;
  float tau = 0.0;
#if !defined(CLOUD_GLOBAL)
  if(uCloudLightMode > 0) {
    tau += cloudLightFromMap(L, p, h, min(h + reach * max(gWay.z, 0.05) / depth, 1.0), w);
    own = 0;
  }
#endif
  // The levels over it the light crosses: none with the light under their horizon.
  int over = rising > 0.02 ? uCloudLevelCount - 1 - l : 0;
  float grow = own > 1 ? pow(max(reach / max(skin, 1.0), 1.0), 1.0 / float(own - 1)) : 1.0;
  float before = 0.0;
  float d = skin;
  for(int j = 0; j < uCloudLightSamples + CLOUD_LEVELS_MOST; j++) {
    if(j >= own + over)
      break;
    CloudLevel K = L;
    int crossing = -1;
    vec3 q = o;
    float len = 0.0;
    float foot = w;
    if(j < own) {
      len = d - before;
      q = o + gWay * (before + 0.5 * len);
      foot = max(w, 0.5 * len);
      before = d;
      d *= grow;
    } else {
      int c = l + 1 + j - own;
      K = cloudLevel(c);
      vec3 middle = o + gWay * ((0.5 * (K.shell.x + K.shell.y) - altitude) / rising);
      float across = max(w, 0.25 * (K.shell.y - K.shell.x) / rising);
      vec4 last = c == 1 ? gCrossSecond : gCrossThird;
      if(last.w >= 0.0 && distance(middle, last.xyz) < CLOUD_CROSS_REUSE * across) {
        tau += last.w;
        continue;
      }
      if(c == 1)
        gCrossSecond = vec4(middle, 0.0);
      else
        gCrossThird = vec4(middle, 0.0);
      crossing = c;
#if defined(CLOUD_GLOBAL)
      // As the weather systems have it where the light crosses its shell's middle: read at the
      // middle of the whole shell, it was over the top of a place's lower cloud, and the shadow
      // came and went in sharp straight edges where that cloud's top passed it.
      if(!cloudPlace(K, uCloudCamera + middle, across))
        continue;
#endif
      // Raised over the broad ground under the point, as the level lit is.
      if(gTerrain)
        K.shell.xy += cloudRiseOf(K.kind) * gBroad.x;
      len = (K.shell.y - K.shell.x) / rising;
      q = o + gWay * ((0.5 * (K.shell.x + K.shell.y) - altitude) / rising);
      foot = max(w, 0.25 * len);
    }
    float stretch = len > 1.0 ? cloudDensity(K, q, foot, false) * len : 0.0;
    if(crossing == 1)
      gCrossSecond.w = stretch;
    else if(crossing == 2)
      gCrossThird.w = stretch;
    tau += stretch;
  }
  return cloudLit(gLighting, h, tau);
}

// The runs along the view (main), in order: each one's stretch, its level, and how much of the
// pixel it covers (cloudTopCover).
vec2 gRuns[2 * CLOUD_LEVELS_MOST];
int gLevels[2 * CLOUD_LEVELS_MOST];
float gCovers[2 * CLOUD_LEVELS_MOST];

// Whether level `L` may hold cloud anywhere in a stretch of the view about `o` (from the camera)
// whose field it spans `extent` (m) across, from `fieldA` to `fieldB`, between the altitudes `lo`
// and `hi`: a bound on what cloudDensity could find there at any footprint. The cover's mean over
// twice the extent, past it by four of its deviations there, the most the lumps add and three of
// the edge's widths, against the least the cover needs in it: at its lowest, let down by the
// pixel's footprint `w` (over which cloudDensity blurs the need up and down), and toward a local
// weather's edge raised as little as at the stretch's end or middle furthest inside it. A stretch
// it says holds none is passed over unread.
bool cloudMaybe(CloudLevel L, vec3 o, float extent, float lo, float hi, float w, vec2 fieldA, vec2 fieldB) {
  float depth = L.shell.y - L.shell.x;
  if(hi <= L.shell.x || lo >= L.shell.y)
    return false;
  float u = max((lo - min(w, depth) - L.shell.x) / depth, 0.0);
  vec3 p = uCloudCamera + o;
  vec2 field = cloudFieldOf(p);
  float rounding = max(u - CLOUD_ROUNDED, 0.0) / (1.0 - CLOUD_ROUNDED);
  float need = L.need.x + (L.need.y - L.need.x) * pow(u, CLOUD_DOME) + L.need.w * rounding * rounding;
#if !defined(CLOUD_GLOBAL)
  float inside = max(cloudLocalEdge(field), max(cloudLocalEdge(fieldA), cloudLocalEdge(fieldB)));
  if(inside <= 0.0)
    return false;
  need += (1.0 - inside) * (L.need.y - L.need.x + L.need.w);
#endif
  vec2 c = cloudCoverOf(L, cloudFootOf(o, cloudUpOf(p), cloudAltitudeOf(p)), field, 2.0 * extent);
  return c.x + 4.0 * sqrt(c.y) + L.look.y * CLOUD_LUMPS_MOST + 3.0 * L.need.z > need;
}

// The lowest a stretch of the view from `t` to `to` passes over the sea's sphere, its ends
// `altitudeA` and `altitudeB` over it: an end, or where the view passes closest to the Earth's
// centre within it.
float cloudLowestAlong(float t, float to, float altitudeA, float altitudeB) {
  float lo = min(altitudeA, altitudeB);
  if(uCloudInvRadius > 0.0) {
    float closest = -(dot(uCloudCamera, gD) + gD.z / uCloudInvRadius);
    if(closest > t && closest < to)
      lo = min(lo, cloudAltitudeOf(cloudFieldPoint(gD, closest)));
  }
  return lo;
}

// The view's `count` runs (gRuns, gLevels), marched front to back in one loop. Each turn of it
// either looks into a stretch ahead (cloudMaybe) or walks a step: the step's level placed at its
// middle (cloudSet, every step: where the level was placed must not depend on where the steps
// fell), its extinction read there over the pixel's footprint (cloudDensity), taken as
// even along the step (exactly: cloudAdd), and lit where the step's light comes from on average,
// 1/τ − 1/(e^τ − 1) of the way in for its optical depth τ.
//
// The footprint read is the pixel's cone where the step lies, and nothing else of the march: how
// the steps fall changes what is drawn only by how finely they resolve it (documents/clouds.md,
// "The march"). A step is as long as resolves what it reads, and no longer:
//
// - the pattern: uCloudDetail.x of the footprint's width, but no finer than two texels of the
//   shape volume (what the finest of it holds);
// - the level's depth as placed at the last step (a global weather's deck can be a third of its
//   type's): uCloudMarch.y steps up it, along the view's slope through it, so what lies over and
//   under (the tops' edge, the light falling off into a deck) is resolved however grazing the
//   view. Sized by the deepest the level can be instead, a thin deck's top was found up to a step
//   late, by where the steps fell, and moved as the camera did (2026-11-11). Away from the deck,
//   in the clear air of the level's shell over or under it, the steps are sized by the shell's
//   whole depth instead; one that crosses the deck as placed at its middle is walked again from
//   where it began, sized by the deck (deckAgain). Walked in the deck's steps all through the
//   shell, the clear air far off took a sixth more of the march's turns, and the skip's misses
//   from 20 km up were three times as many (2026-11-11);
// - what it holds: the extinction the last steps found (halved each step since), so a step through
//   cloud hides about uCloudMarch.z: the light a view sees comes from within a free path or two of
//   where it enters cloud, and changes as fast. A step that found more than CLOUD_AGAIN is walked
//   again, shorter, sized by what it found.
//
// Clear air is passed over: past a step finding no cloud, the march looks into a stretch twice as
// long ahead, and on as long as each is clear, up to its run's own layout (its uCloudShells.w
// steps, growing geometrically from its near end); a stretch that may hold cloud is looked into
// again at half its length, down to a step's. In a local weather the bound (cloudMaybe) holds
// whatever the stretch, so how they fall changes how much is walked, not what is found. In a
// global weather it does not quite: the level is placed at the stretch's middle (cloudSet), from
// the weather systems' map, whose mipmaps hold means, so a cloudier or deeper place within a long
// stretch can be passed over (documents/clouds.md, known issue 10). Walking all of a global
// weather's clear air instead took 2.5–3.5 times the steps and 1.4–1.6 times the march's time;
// skipping, from 20 km up 15–17 % of the clouds' pixels were over 0.02 off a march four times
// finer (by 0.02 on average, the far band), 0.04–0.13 % over 0.3 (2026-11-11).
//
// One loop, its turns alike: the density's and the light's reads compiled into it once (written
// as loops in loops, the march's link took 16 s, 2026-11-10).
//
// A run that covers only part of the pixel (gCovers: under a level's top's horizon,
// cloudTopCover) is marched with only that share of the light left (gTransmit), so it adds only
// that share of what it holds; the rest passes it by (`skip`) and joins again as it ends.
// Stopped short within one, the march goes on to what lies behind it, seen in the rest.
// Snapshots of all it had added, taken at each run and blended as it ended, were the same image
// at 4–9 % more of the march (A1000, 2026-11-19).
void cloudMarchRuns(int count) {
  int r = -1;
  int l = 0;
  // The run: its near end, how far it reaches, the distance its layout grows from and by how much
  // a step.
  float start = 0.0;
  float end = -1.0;
  float near = 50.0;
  float grow = 0.0;
  // Where the march is (its field's point and its altitude), the extinction the last steps found,
  // and the stretch ahead to look into (none: walking).
  float t = 0.0;
  vec2 fieldA = vec2(0.0);
  float altitudeA = 0.0;
  float rho = 0.0;
  float look = 0.0;
  // The broad ground along a run of the level that rises over it (cloudRiseOf): its height read at
  // two places along the view (x and y) in z and w, taken in a straight line between, and read on
  // as the march passes y (CLOUD_TERRAIN_REREAD); y under x for none.
  vec4 broadAlong = vec4(0.0, -1.0, 0.0, 0.0);
  // The level as placed for the last step (cloudSet), and which level that was; and whether the
  // step is walked again because the last crossed the deck (see above).
  CloudLevel P = cloudLevel(0);
  int placedLevel = -1;
  bool deckAgain = false;
  // The light left that passes the run by: none where it covers the whole pixel (gCovers).
  float skip = 0.0;
  for(int turn = 0; turn < uCloudMarchMost; turn++) {
    if(gTransmit < uCloudDetail.z) {
      if(skip <= 0.0)
        break;
      t = end;
    }
    if(t >= end) {
      gTransmit += skip;
      skip = 0.0;
      r++;
      if(r >= count)
        break;
      l = gLevels[r];
      skip = (1.0 - gCovers[r]) * gTransmit;
      gTransmit -= skip;
      vec2 run = gRuns[r];
      start = max(run.x, 0.0);
      end = run.y;
      near = max(start, 50.0);
      grow = exp(log(1.0 + (end - start) / near) / uCloudShells[l].w) - 1.0;
      t = start;
      rho = 0.0;
      deckAgain = false;
      look = near * grow;
      vec3 a = cloudFieldPoint(gD, t);
      fieldA = cloudFieldOf(a);
      altitudeA = cloudAltitudeOf(a);
      broadAlong = vec4(0.0, -1.0, 0.0, 0.0);
      if(gTerrain && cloudRiseOf(uCloudKinds[l]) > 0.0) {
        float next = t + max(CLOUD_TERRAIN_REREAD.x, CLOUD_TERRAIN_REREAD.y * t);
        broadAlong = vec4(t, next, cloudTerrainBroad(cloudUpEarthOf(a)).x, cloudTerrainBroad(cloudUpEarthOf(cloudFieldPoint(gD, next))).x);
      }
    }
    // A step's length from here (see above): through cloud, and through clear air past what the
    // last steps found.
    vec4 shell = placedLevel == l ? P.shell : uCloudShells[l];
    float texel = uCloudLooks[l].w * CLOUD_COVER_SIZE / CLOUD_LUMP_TILES / CLOUD_SHAPE_TEXELS;
    float climb = dot(gDir, cloudUpAt(t));
    float rise = abs(climb);
    float pattern = uCloudDetail.x * uCloudMarch.w * t;
    float layer = (shell.y - shell.x) / (uCloudMarch.y * max(rise, 0.02));
    float inCloud = min(max(pattern, 2.0 * texel), layer);
    // In clear air: the deck's steps where the next of the whole shell's would come within reach of
    // it (a quarter more, for the view's curve over the Earth), the shell's elsewhere.
    float clearMost = max(pattern, CLOUD_STEP_TEXELS * texel);
    vec4 whole = uCloudShells[l];
    float wholeStep = min(clearMost, (whole.y - whole.x) / (uCloudMarch.y * max(rise, 0.02)));
    float ahead = altitudeA + climb * 1.25 * max(wholeStep * uCloudStepScale, 1.0);
    bool nearDeck = deckAgain || placedLevel != l || (max(altitudeA, ahead) > shell.x && min(altitudeA, ahead) < shell.y);
    float fine = rho > 0.0 ? min(inCloud, uCloudMarch.z / rho) : (nearDeck ? min(clearMost, layer) : wholeStep);
    fine = max(fine * uCloudStepScale, 1.0);
    bool skim = look > fine;
    float len = skim ? look : fine;
    float to = t + len;
    if(to > end - 0.25 * len)
      to = end;
    vec3 b = cloudFieldPoint(gD, to);
    vec2 fieldB = cloudFieldOf(b);
    float altitudeB = cloudAltitudeOf(b);
    len = to - t;
    float mid = t + 0.5 * len;
    vec3 o = gD * mid;
    float foot = max(uCloudMarch.w * mid, 0.5);
#if !defined(CLOUD_GLOBAL)
    gEdgeNoise = cloudEdgeNoise(cloudFieldOf(uCloudCamera + o));
#endif
    if(broadAlong.y >= broadAlong.x) {
      if(mid > broadAlong.y) {
        float next = mid + max(CLOUD_TERRAIN_REREAD.x, CLOUD_TERRAIN_REREAD.y * mid);
        broadAlong = vec4(broadAlong.y, next, broadAlong.w, cloudTerrainBroad(cloudUpEarthOf(cloudFieldPoint(gD, next))).x);
      }
      gBroad.x = mix(broadAlong.z, broadAlong.w, clamp((mid - broadAlong.x) / max(broadAlong.y - broadAlong.x, 1.0), 0.0, 1.0));
    }
    CloudLevel S = cloudLevel(l);
    bool found = false;
    if(skim) {
      gCost += 0.25;
      float lo = cloudLowestAlong(t, to, altitudeA, altitudeB);
      float hi = max(altitudeA, altitudeB);
      float extent = max(foot, length(fieldB - fieldA));
      if(cloudSet(S, uCloudCamera + o, extent) && cloudMaybe(S, o, extent, lo, hi, foot, fieldA, fieldB)) {
        look = 0.5 * len;
        continue;
      }
      look = min(2.0 * len, (to - start + near) * grow);
    } else {
      P = S;
      bool placed = cloudSet(P, uCloudCamera + o, foot);
      placedLevel = l;
      // Longer than the deck's steps and crossing the deck as placed here: walked again from where
      // it began, sized by the deck.
      if(placed && !deckAgain) {
        float deckStep = max(min(clearMost, (P.shell.y - P.shell.x) / (uCloudMarch.y * max(rise, 0.02))) * uCloudStepScale, 1.0);
        if(len > CLOUD_AGAIN * deckStep && max(altitudeA, altitudeB) > P.shell.x && cloudLowestAlong(t, to, altitudeA, altitudeB) < P.shell.y) {
          deckAgain = true;
          continue;
        }
      }
      gClear = 1e3;
      float sigma = placed ? cloudDensity(P, o, foot, true) : 0.0;
      float clear = gClear;
      gCost += 1.0;
      float tau = sigma * len;
      // Longer than a step through what it found: walked again from where it began, as short as
      // that.
      float want = max(min(inCloud, uCloudMarch.z / max(sigma, 1e-9)) * uCloudStepScale, 1.0);
      if(sigma > 0.0 && len > CLOUD_AGAIN * want) {
        rho = sigma;
        continue;
      }
      if(tau > 0.0 && gTransmit * (1.0 - exp(-tau)) > 1e-4) {
        float into = tau < 1e-3 ? 0.5 : 1.0 / tau - 1.0 / (exp(min(tau, 80.0)) - 1.0);
        cloudAdd(t, len, sigma, cloudLight(P, l, gD * (t + into * len), foot));
      }
      found = sigma > 0.0;
      // Past cloud, what it found halves each step, and is forgotten once a tenth of the level's.
      rho = found ? max(sigma, 0.5 * rho) : (rho < 0.2 * shell.z ? 0.0 : 0.5 * rho);
      look = !found && clear > CLOUD_CLEAR ? 2.0 * len : 0.0;
    }
    t = to;
    deckAgain = false;
    fieldA = fieldB;
    altitudeA = altitudeB;
  }
  gTransmit += skip;
}

#if defined(CLOUD_BAKE)
// What the bakes see (CloudsRenderer.bake: the scene's bakes of the air and the sea's
// reflection, blurred in both): each run through a level read once at its middle over a footprint
// of half its length (or the pixel's cone, where wider) — its own cover's mean and spread along
// it, no lumps — and lit there through a cloud's skin toward the light (CLOUD_LIGHT_SKIN) as
// dense as that read says: not marched toward the light, nor across the levels over it. Lit as
// the view is (cloudLight), its program took as long to compile as the march's (6.8 s, RTX A1000,
// uncached) and the six faces 3.4 ms; this, 1.4 ms (2026-11-16).
void cloudBakeRuns(int count) {
  for(int r = 0; r < 2 * CLOUD_LEVELS_MOST; r++) {
    if(r >= count || gTransmit < 0.01)
      break;
    int l = gLevels[r];
    vec2 run = gRuns[r];
    float from = max(run.x, 0.0);
    float len = run.y - from;
    if(len <= 1.0)
      continue;
    float mid = from + 0.5 * len;
    vec3 o = gD * mid;
    float foot = max(uCloudMarch.w * mid, 0.5 * len);
#if !defined(CLOUD_GLOBAL)
    gEdgeNoise = cloudEdgeNoise(cloudFieldOf(uCloudCamera + o));
#endif
    if(gTerrain && cloudRiseOf(uCloudKinds[l]) > 0.0)
      gBroad = cloudTerrainBroad(cloudUpEarthOf(uCloudCamera + o));
    CloudLevel P = cloudLevel(l);
    if(!cloudSet(P, uCloudCamera + o, foot))
      continue;
    float sigma = cloudDensity(P, o, foot, false);
    if(sigma <= 0.0)
      continue;
    vec3 p = uCloudCamera + o;
    float altitude = cloudAltitudeOf(p);
    float h = clamp((altitude - P.shell.x) / max(P.shell.y - P.shell.x, 1.0), 0.0, 1.0);
    float toTop = max(P.shell.y - altitude, 0.0) / max(cloudRisingAt(p), 0.05);
    float toward = sigma * min(CLOUD_LIGHT_SKIN * uCloudScale, toTop);
    cloudAdd(from, len, sigma, cloudLit(gLighting, h, toward));
  }
}
#endif

// Where the column at `field` stands `altitude` over the sea, on the field's frame (on the plane
// with the globe off): its up part written as the difference it is, to keep its precision.
vec3 cloudFieldColumn(vec2 field, float altitude) {
  if(uCloudInvRadius <= 0.0)
    return vec3(field, altitude);
  float R = 1.0 / uCloudInvRadius;
  float f2 = dot(field, field);
  float l = sqrt(f2 + R * R);
  return vec3(field * ((R + altitude) / l), R * (altitude - f2 / (l + R)) / l);
}

#if defined(CLOUD_LIGHT_MAP)
// The level drawn (its layer), and how far its wind has carried its clouds since the drawing's
// time (m on the field): its rows drawn over several frames are all of that time.
uniform int uCloudLightLevel;
uniform vec2 uCloudLightShift;

// A texel of level uCloudLightLevel's light map (CloudFieldMap): the ray toward the light from
// where it leaves the level's base, through its shell, in CLOUD_LIGHT_STEPS stretches each read at
// its middle over half its length or a texel, as the march's light's are (cloudLight); out, the
// optical depth from its base, and from a quarter, half and three quarters of the way up, to its
// top. Height and distance go together along it by the light's rise at the weather's middle (no
// less than 0.05, as the march's light takes it), as they are read (cloudLightFromMap).
void main() {
  gTerrain = uCloudTerrain.x > 0.5 && globeOn();
  vec3 way = cloudLightWay(uCloudFrameM);
  gWay = vec3(dot(way, uCloudFrameE), dot(way, uCloudFrameN), dot(way, uCloudFrameM));
  float r = max(gWay.z, 0.05);
  float side = 2.0 * uCloudLightArea.z;
  float texel = side / uCloudLightArea.w;
  vec2 field = uCloudLightArea.xy + (gl_FragCoord.xy / uCloudLightArea.w - 0.5) * side + uCloudLightShift;
  CloudLevel S = cloudLevel(uCloudLightLevel);
  vec3 b = cloudFieldColumn(field, S.shell.x);
  if(gTerrain)
    gBroad = cloudTerrainBroad(cloudUpEarthOf(b));
  gEdgeNoise = cloudEdgeNoise(field);
  if(!cloudSet(S, b, texel)) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float depth = S.shell.y - S.shell.x;
  b = cloudFieldColumn(field, S.shell.x);
  float len = depth / (r * float(CLOUD_LIGHT_STEPS));
  vec4 quarters = vec4(0.0);
  for(int k = 0; k < CLOUD_LIGHT_STEPS; k++) {
    vec3 q = b + gWay * (len * (float(k) + 0.5));
    float tau = cloudDensity(S, q - uCloudCamera, max(texel, 0.5 * len), false) * len;
    quarters += tau * vec4(equal(ivec4(k * 4 / CLOUD_LIGHT_STEPS), ivec4(0, 1, 2, 3)));
  }
  gl_FragColor = vec4(dot(quarters, vec4(1.0)), quarters.y + quarters.z + quarters.w, quarters.z + quarters.w, quarters.w);
}
#elif defined(CLOUD_COVER_MAP)
// A texel of level uCloudCoverLevel's cover map (CloudFieldMap): the cover of the column at its
// middle, read from the cover volume over a texel as the march reads it (cloudCoverAt), as the
// clouds were at the drawing's time (uCloudCoverShift: where those lie now); out, its mean.
uniform int uCloudCoverLevel;
uniform vec2 uCloudCoverShift;

void main() {
  float side = 2.0 * uCloudCoverArea.z;
  float texel = side / uCloudCoverArea.w;
  vec2 field = uCloudCoverArea.xy + (gl_FragCoord.xy / uCloudCoverArea.w - 0.5) * side + uCloudCoverShift;
  CloudLevel L = cloudLevel(uCloudCoverLevel);
  vec3 o = cloudFieldColumn(field, 0.0) - uCloudCamera;
  vec2 c = cloudCoverAt(L, cloudFootOf(o, vec3(0.0, 0.0, 1.0), 0.0), texel);
  gl_FragColor = vec4(c.x, 0.0, 0.0, 1.0);
}
#elif defined(CLOUD_PLACE_MAP) && defined(CLOUD_GLOBAL)
// A texel of the weather baked about the camera (CloudPlaceMap): layer uCloudPlaceLayer of what
// cloudPlace reads at its middle, over a texel: the cloud map (0) or its types (1), both
// drawings, drifted, the newer dissolved in.
uniform int uCloudPlaceLayer;

void main() {
  vec2 uv = (gl_FragCoord.xy / uCloudPlaceArea.y * 2.0 - 1.0) * uCloudPlaceArea.x;
  vec3 way = normalize(uCloudPlaceAxes[2] + uv.x * uCloudPlaceAxes[0] + uv.y * uCloudPlaceAxes[1]);
  float lod = log2(max(uCloudPlaceArea.z * uCloudMapTexels, 1.0));
  float blend = cloudMapShare(way);
  vec4 value = vec4(0.0);
  if(uCloudPlaceLayer == 0)
    value = cloudMapBlend(uCloudMap, uCloudMapNext, way, lod, blend);
  else
    value = cloudMapBlend(uCloudTypes, uCloudTypesNext, way, max(lod - 1.0, 0.0), blend);
  gl_FragColor = value;
}
#elif defined(CLOUD_SHADOW)
// The clouds' shadows (CloudsRenderer.updateShadow): over a square about the camera's foot
// (its middle from the camera and how far it reaches to its sides, world; its east and north),
// texels a side.
uniform vec4 uCloudShadowPlace;
uniform vec3 uCloudShadowEast;
uniform vec3 uCloudShadowNorth;
uniform float uCloudShadowSize;

// Samples across each level toward the light (CloudsRenderer.updateShadow's own count).
uniform int uCloudShadowSamples;

// The share of the light (the sun's, or the moon's) that reaches the ground under a texel of the
// square through the levels: across each, as it rises over the broad ground there, toward the
// light in uCloudShadowSamples stretches, each placed (cloudSet) and read with the lumps the
// view's march reads where the footprint resolves them (no narrower than a texel), so the
// shadows are the clouds drawn. Read without them until 2026-11-18, a broken field's clouds
// averaged into a faint haze: fair cumulus covering a fifth of the sky shaded 1% of the sea,
// letting 60% of the light through at most. None where the light is under the horizon.
void main() {
  gTerrain = uCloudTerrain.x > 0.5 && globeOn();
  vec2 st = gl_FragCoord.xy / uCloudShadowSize * 2.0 - 1.0;
  vec3 delta = uCloudShadowPlace.xyz + (uCloudShadowEast * st.x + uCloudShadowNorth * st.y) * uCloudShadowPlace.w;
  vec3 p = uCloudCamera + vec3(dot(delta, uCloudFrameE), dot(delta, uCloudFrameN), dot(delta, uCloudFrameM));
  vec2 field = cloudFieldOf(p);
  float ground = gTerrain ? max(cloudGround(cloudUpEarthOf(p)), 0.0) : 0.0;
  vec3 g = cloudFieldColumn(field, ground);
  vec3 up = cloudUpOf(g);
  vec3 way = cloudLightWay(uCloudFrameE * up.x + uCloudFrameN * up.y + uCloudFrameM * up.z);
  gWay = vec3(dot(way, uCloudFrameE), dot(way, uCloudFrameN), dot(way, uCloudFrameM));
  float rising = dot(gWay, up);
  if(rising <= 0.0) {
    gl_FragColor = vec4(1.0);
    return;
  }
  float r = max(rising, 0.05);
  float texel = 2.0 * uCloudShadowPlace.w / uCloudShadowSize;
  if(gTerrain)
    gBroad = cloudTerrainBroad(cloudUpEarthOf(g));
  gEdgeNoise = cloudEdgeNoise(field);
  float tau = 0.0;
  for(int l = 0; l < CLOUD_LEVELS_MOST; l++) {
    if(l >= uCloudLevelCount)
      break;
    CloudLevel L = cloudLevel(l);
    float rise = gTerrain ? cloudRiseOf(L.kind) * gBroad.x : 0.0;
    float from = max(L.shell.x + rise - ground, 0.0) / r;
    float to = max(L.shell.y + rise - ground, 0.0) / r;
    if(to <= from)
      continue;
    float len = (to - from) / float(uCloudShadowSamples);
    float extent = max(texel, 0.5 * len);
    for(int k = 0; k < uCloudShadowSamples; k++) {
      vec3 q = g + gWay * (from + (float(k) + 0.5) * len);
      CloudLevel S = L;
      if(cloudSet(S, q, extent))
        tau += cloudDensity(S, q - uCloudCamera, extent, true) * len;
    }
  }
  gl_FragColor = vec4(exp(-tau), 0.0, 0.0, 1.0);
}
#else
void main() {
  vec3 dir = normalize(vCloudDirection);
  // Derivatives first, before anything branches: of the full image's pixels, the quarter march's
  // spanning two (uCloudDerivative 0.5). A march pixel's width (radians), for the levels' tops
  // (cloudTopCover).
  float pixel = length(fwidth(dir)) * uCloudDerivative;

  float R = uGlobe.x;
  float height = globeOn() ? uGlobeCamera.z : globeCameraHeight() - globeLevel();
  gO = uGlobeCameraRadial.xyz * (R + height);
  gDir = dir;
  gHeight = height;
  gD = vec3(dot(dir, uCloudFrameE), dot(dir, uCloudFrameN), dot(dir, uCloudFrameM));
  vec2 reach = globeReach(cameraPosition, dir, 0.0);
  float ground = reach.y < 0.5 ? reach.x : CLOUD_FAR;
#if defined(CLOUD_GLOBAL)
  if(uCloudDebug == 3) {
    if(ground >= CLOUD_FAR) {
      gl_FragColor = vec4(0.0);
      gl_FragDepth = 1.0;
      return;
    }
    vec3 p = cloudFieldPoint(gD, ground);
    vec3 way = normalize(uCloudFieldEarth * vec3(p.xy, p.z + uCloudEarthRadius));
    vec4 m = cloudMapBlend(uCloudMap, uCloudMapNext, way, 0.0, cloudMapShare(way));
    gl_FragColor = vec4(m.r, m.b, m.a, 1.0);
    gl_FragDepth = 0.0;
    return;
  }
#endif

  // The ground, on the globe: the low level rises over it (cloudRiseOf).
  gTerrain = uCloudTerrain.x > 0.5 && globeOn();

  // Each level's runs along the view, within the local weather's radius: two at most a level
  // (before the view dips under its base and after it comes back up), marched front to back.
#if defined(CLOUD_GLOBAL)
  vec2 local = vec2(0.0, CLOUD_FAR);
#else
  vec2 local = cloudLocalSpan(gD);
#endif
  vec2 runs[2 * CLOUD_LEVELS_MOST];
  int levels[2 * CLOUD_LEVELS_MOST];
  float covers[2 * CLOUD_LEVELS_MOST];
  int count = 0;
  for(int l = 0; l < CLOUD_LEVELS_MOST; l++) {
    if(l >= uCloudLevelCount)
      break;
    vec2 near;
    vec2 far;
    vec2 shell = uCloudShells[l].xy;
    float riseShare = gTerrain ? cloudRiseOf(uCloudKinds[l]) : 0.0;
    float riseMost = riseShare * uCloudTerrain.y;
    // The top its runs are cut at.
    float top = shell.y + riseMost;
    cloudRuns(gO, dir, height, shell + vec2(0.0, riseMost), ground, near, far);
    // Over the ground, only as far up as the level rises along this view: its broad rise read
    // along the runs that could hold it, so a view through a level over the sea steps through the
    // level, not through its rise over the highest ground anywhere.
    if(riseMost > 0.0) {
      vec2 rises = vec2(CLOUD_FAR, -CLOUD_FAR);
      for(int k = 0; k < 2 * CLOUD_TERRAIN_ALONG; k++) {
        vec2 span = k < CLOUD_TERRAIN_ALONG ? near : far;
        if(span.x >= span.y)
          continue;
        float along = mix(span.x, span.y, float(k % CLOUD_TERRAIN_ALONG) / float(CLOUD_TERRAIN_ALONG - 1));
        float rise = riseShare * cloudTerrainBroad(cloudUpEarthOf(cloudFieldPoint(gD, along))).x;
        rises = vec2(min(rises.x, rise), max(rises.y, rise));
      }
      if(rises.x <= rises.y) {
        top = shell.y + rises.y + CLOUD_TERRAIN_SPARE;
        cloudRuns(gO, dir, height, shell + rises + vec2(-CLOUD_TERRAIN_SPARE, CLOUD_TERRAIN_SPARE), ground, near, far);
      }
    }
    float cover = cloudTopCover(dir, top, pixel);
    near = vec2(max(near.x, local.x), min(near.y, local.y));
    far = vec2(max(far.x, local.x), min(far.y, local.y));
    if(near.x < near.y) {
      runs[count] = near;
      levels[count] = l;
      covers[count] = cover;
      count++;
    }
    if(far.x < far.y) {
      runs[count] = far;
      levels[count] = l;
      covers[count] = cover;
      count++;
    }
  }
  // In order along the view: the shells nest, so runs never overlap.
  for(int i = 1; i < 2 * CLOUD_LEVELS_MOST; i++) {
    if(i >= count)
      break;
    for(int j = 2 * CLOUD_LEVELS_MOST - 1; j > 0; j--) {
      if(j > i || runs[j].x >= runs[j - 1].x)
        continue;
      vec2 run = runs[j];
      runs[j] = runs[j - 1];
      runs[j - 1] = run;
      int level = levels[j];
      levels[j] = levels[j - 1];
      levels[j - 1] = level;
      float share = covers[j];
      covers[j] = covers[j - 1];
      covers[j - 1] = share;
    }
  }

  for(int r = 0; r < 2 * CLOUD_LEVELS_MOST; r++) {
    gRuns[r] = runs[r];
    gLevels[r] = levels[r];
    gCovers[r] = covers[r];
  }
  // Lit as where the view first meets cloud.
  gLighting = cloudLightingAt(dir, cloudUpAt(count > 0 ? max(runs[0].x, 0.0) : 0.0));
  gWay = vec3(dot(gLighting.way, uCloudFrameE), dot(gLighting.way, uCloudFrameN), dot(gLighting.way, uCloudFrameM));
#if defined(CLOUD_BAKE)
  cloudBakeRuns(count);
#else
  cloudMarchRuns(count);
#endif

  if(uCloudDebug == 1) {
    // The march's cost: blue none, through green and yellow, to red at its most.
    float cost = clamp(gCost / uCloudMarch.x, 0.0, 1.0);
    vec3 heat = clamp(vec3(4.0 * cost - 2.0, 2.0 - abs(4.0 * cost - 2.0), 2.0 - 4.0 * cost), 0.0, 1.0);
    gl_FragColor = vec4(heat, 1.0);
    gl_FragDepth = 0.999999;
    return;
  }
  float alpha = 1.0 - gTransmit;
  if(alpha < 1e-4) {
    gl_FragColor = vec4(0.0);
    gl_FragDepth = 1.0;
    return;
  }
  // Where their light comes from on average: hazed over that distance.
  float mean = gDepthSum / max(gWeight, 1e-6);
  vec3 lit = uCloudDebug == 2 ? vec3(1.0) : gColor / alpha;
  vec3 seen = lit;
  if(uCloudAir > 0.5 && uCloudDebug == 0) {
    vec3 p = cameraPosition + dir * mean;
    seen = cloudFromSpace(cloudThroughAir(lit, dir, mean), lit, p, globeAltitude(p));
  }
  // Stopped short (uCloudDetail.z): as opaque as where it stops, over what it hides once
  // stopped, so a view stopped there hides all behind it.
  float shown = clamp(alpha / (1.0 - uCloudDetail.z), 0.0, 1.0);
  gl_FragColor = vec4(seen * shown, shown);
  // Their front (CLOUD_FRONT), where they hide that much at all: as log2 over
  // CLOUD_DEPTH_RANGE, which the composite reads.
  float depth = gFront >= 0.0 ? gFront : mean;
  gl_FragDepth = clamp(log2(max(depth, 1.0)) / CLOUD_DEPTH_RANGE, 0.0, 0.999999);
}
#endif

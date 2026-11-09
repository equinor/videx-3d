// The 3D clouds (SceneryCloudVolume), marched along each pixel's view ray through up to three
// cloud levels' shells about the Earth's centre (low, middle, high: CLOUD_LEVELS_MOST), at a
// share of the screen's resolution. Written as premultiplied linear colour and alpha, and as
// depth log2 of the distance to their front (CLOUD_FRONT): the composite
// (cloud-volume-composite.glsl) draws them over the scene at that depth. One colour attachment,
// so ANGLE compiles its pixel shader once (scenery.md, Performance).
//
// Each level is rounded masses of many sizes, from a map of the cover fixed to the Earth
// (scenery-cloud-cover.ts: a tile of noise, each level reading it at its own scale, turn and
// stretch, drifting with its own wind) and a profile up its shell: the higher, the more cover a
// column needs to reach it, so the clouds are domed over flat bases and round off below the
// shell's top. Its look (its type's: how soft, lumpy, towering, massed, stretched and dense)
// comes in uniforms, so a type is data, not code.
//
// Stable as the camera moves, however fast and far (documents/clouds.md): every sample takes in
// what the stretch of the view it stands for holds, never finer — the cover map read
// anisotropically along the stretch (its mean and its spread, which widens the clouds' edge),
// the shape volume's lumps only where the stretch resolves them (their spread where it does
// not) — so it hardly matters where a sample lands, and nothing is jittered. The levels' runs
// along a view are marched front to back.

#include <common>
#include ./sky-gradient.glsl
#include ./cloud-field.glsl
#include ./cloud-light.glsl

// The steps along a run at the quality (for the cost view), and the angle a pixel of the
// clouds' image spans (w, radians).
uniform vec4 uCloudMarch;
// 0 drawn, 1 the march's cost (its steps over uCloudMarch.x), 2 unlit (white, as opaque as the
// clouds are), 3 a global weather's map: each level's cover where the view meets the sea (low
// red, middle green, high blue).
uniform int uCloudDebug;
// 1 hazed by the air between them and the camera, 0 not.
uniform float uCloudAir;
// The cover volume (CloudCoverVolume): (patches, masses, patches², masses²), with mipmaps,
// repeating every way, read on the Earth's curved surface where each column stands
// (cloudFootOf), so the clouds are fixed to the Earth and keep their shape anywhere on it. Laid
// on the plane touching the Earth at the weather's middle instead (a 2D map, 2026-11-09), they
// were squashed far round the Earth (60 times, 83° from the middle) and past 90° not reached.
uniform sampler3D uCloudCover;
// The levels drawn (a uniform count keeps the loops loops in Direct3D), from the ground up;
// each one's shell (base and top over the sea, m; its extinction in cloud, 1 / m; its steps
// along a run), the cover its columns need (at its base: its share under cloud, softCoverLevel;
// at its top: its tallest clouds'), its edge's width and how far that need climbs over its
// upper part (cover); its look (the masses' weight against the patches, how far the lumps move
// the cover, a cloud's size in m for how cloud and sky mixed hide what lies behind, the cover
// volume's texel in m); its pattern on the Earth: from metres fixed on the Earth to its cover
// volume's tiles (turned as its wind has carried it about the Earth's centre, stretched along
// it), and where the camera lies in it, from 64-bit floats (in the cover, its broad read, and
// the lumps' two tilings: four a level).
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
// Stretches toward the light, short steps through a part holding cloud at most (cloudFine), and
// the runs along a view at most (two a level): uniform counts, so Direct3D keeps the loops loops
// rather than copying the march into each.
uniform int uCloudLightSamples;
uniform int uCloudFineSteps;
uniform int uCloudRunsMost;
// The clouds' scale (relative).
uniform float uCloudScale;
// The local weather's outline: the share of its radius its cloud gives way over, and how far a
// broad noise pushes its edge in and out (a share of its radius).
uniform vec2 uCloudLocalShape;
// Each level's kind: its chain of types' first row (uCloudType*, uCloudCoverTable), its last
// place along the chain, its channel of the cloud map (0 low, 1 middle, 2 high), and its index.
uniform vec4 uCloudKinds[CLOUD_LEVELS_MOST];

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
// Each type's row: its cover map's quantiles (softCoverTexel: the cover its columns need for a
// share under cloud), one a texel, filtered linearly; its edge's width and how far its lumps
// move the cover (cover), how far it towers, and its masses' weight; its base, its tops at no
// cover and at full cover (m), and its extinction (1 / m); and the most its cover reaches.
uniform sampler2D uCloudCoverTable;
uniform vec4 uCloudTypeLooks[CLOUD_TYPES];
uniform vec4 uCloudTypeHeights[CLOUD_TYPES];
uniform vec4 uCloudTypeMore[CLOUD_TYPES];
// How far the level covering most dominates where it lies (cloudLayersInProportion), whether a
// level's look follows its place along its chain (1) or is its chain's first (0), and whether
// the low cloud's thickness sets how deep and dense the cloud is (1) or its type alone (0).
uniform vec4 uCloudGlobal;
#endif

varying vec3 vCloudDirection;

// Where along the view what lies behind is drawn over the clouds (their depth): where they hide
// this share of it.
#define CLOUD_FRONT 0.1
// A step holding cloud is split in this many parts, each read for what it holds.
#define CLOUD_SPLIT 4
// Over this share of a level's depth its base fades in.
#define CLOUD_BASE_FADE 0.05
// A step along a view spans no less than this many pixels' footprints: as fine as that, a view
// straight down through a level from high up spent its steps where nothing changes.
#define CLOUD_STEP_FOOTPRINTS 2.0
// A part holding cloud is walked in short steps this many of its level's mean free paths
// (1 / extinction) long (cloudFine). At 4, faint bands came back at a shallow angle; at 2, each
// step was near opaque, so the clouds were lit as at one point a step, and where a part's whole
// number of steps dropped by one the steps doubled: their tops coarsened inside a circle about
// the camera, as under a magnifying glass.
#define CLOUD_FINE 1.0
// The first stretch toward the light: a cloud's skin (m, at scale 1), how its lit side and its
// shaded side differ.
#define CLOUD_LIGHT_SKIN 200.0
// The logistic standing for a normal distribution's CDF: its slope.
#define CLOUD_LOGISTIC 1.702
// The shape volume's broadest features: this share of its tile.
#define CLOUD_FEATURE 0.25
// The lumps' second tiling: this many times broader (turned, CLOUD_LUMPS_TURN).
#define CLOUD_LUMP_BROADER 1.618
// The clouds' tops round off from this share of a level's depth up (cloudShare).
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
// A stretch whose share in cloud is less than CLOUD_LEAST is left out, unlit: the clouds' soft
// edge never quite reaches nothing, and gated on a far smaller optical depth, every stretch of the
// clear air between them was lit, each light read with the levels over it. One holding cloud but
// hiding less than CLOUD_THIN (optical depth) is taken whole, lit once, not split nor walked in
// short steps.
#define CLOUD_LEAST 1e-3
#define CLOUD_THIN 0.02

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

// A cloud level (the uniforms' `l`th). In a global weather, its shell's base and top, its
// extinction, its need and its look's masses and lumps are its place's (cloudPlace), read once a
// step and once a part of one (cloudMarch).
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
  return L;
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

// Where to read the cover a column needs for `share` under cloud from a row of
// uCloudCoverTable: softCoverTexel (soft-clouds.ts).
float cloudCoverTexel(float share) {
  return ((1.0 - clamp(share, 0.0, 1.0)) * float(CLOUD_QUANTILES) + 0.5) / float(CLOUD_QUANTILES + 1);
}

// Level `L` as the weather systems have it at `p` (on the field's frame), read over `extent`
// (m): its cover there (none: false), kept in proportion to the level covering most there; its
// place along its chain of types, its look and its heights the types' between which it lies;
// the cover its columns need from its cover; its extinction, and with the low cloud's thickness
// (uCloudGlobal.z) how deep and dense it is.
bool cloudPlace(inout CloudLevel L, vec3 p, float extent) {
  vec3 way = normalize(uCloudFieldEarth * vec3(p.xy, p.z + uCloudEarthRadius));
  float lod = log2(max(2.0 * extent * uCloudMapTexels, 1.0));
  float blend = cloudMapShare(way);
  vec4 m = cloudMapBlend(uCloudMap, uCloudMapNext, way, lod, blend);
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
    vec4 t = cloudMapBlend(uCloudTypes, uCloudTypesNext, way, max(lod - 1.0, 0.0), blend);
    place = (channel == 0 ? t.r : (channel == 1 ? t.g : t.b)) * L.kind.y;
  }
  float i = min(floor(place), max(L.kind.y - 1.0, 0.0));
  float w = clamp(place - i, 0.0, 1.0);
  int r0 = int(L.kind.x + i);
  int r1 = L.kind.y > 0.0 ? r0 + 1 : r0;
  vec4 look = mix(uCloudTypeLooks[r0], uCloudTypeLooks[r1], w);
  vec4 heights = mix(uCloudTypeHeights[r0], uCloudTypeHeights[r1], w);
  float highest = mix(uCloudTypeMore[r0].x, uCloudTypeMore[r1].x, w);
  // The rows between them, filtered.
  float row = (float(r0) + w * float(r1 - r0) + 0.5) / float(CLOUD_TYPES);
  float needBase = textureLod(uCloudCoverTable, vec2(cloudCoverTexel(cover), row), 0.0).r;
  float needTop = textureLod(uCloudCoverTable, vec2(cloudCoverTexel(cover * (0.02 + 0.3 * look.z)), row), 0.0).r;
  needTop = max(needTop, needBase + 1e-4);
  L.need = vec4(needBase, needTop, look.x, max(highest + CLOUD_ROUND_REACH * (look.y + look.x) - needTop, 0.0));
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

// Level `L`'s cover's mean and spread over `extent` (m) about where a column stands (`foot`,
// cloudFootOf): the volume read there for the masses and the fine patches, and a second time
// CLOUD_PATCHES_BROADER times broader, turned, for the broad patches, which the fine ones run on
// from (CLOUD_PATCHES_FINE). A 3D texture is filtered every way alike, so a stretch of a view is
// read over all of its extent: read narrower, at its middle, what lay between its samples was
// skipped, and grains came and went as the view moved.
vec2 cloudCoverAt(CloudLevel L, vec3 foot, float extent) {
  vec3 at = L.turn * foot;
  float lod = log2(max(extent / L.look.w, 1.0));
  vec4 c = textureLod(uCloudCover, at + L.place, lod);
  vec4 b = textureLod(uCloudCover, CLOUD_PATCHES_TURN * at / CLOUD_PATCHES_BROADER + L.broad, max(lod - log2(CLOUD_PATCHES_BROADER), 0.0));
  float w = L.look.x;
  float f = CLOUD_PATCHES_FINE;
  float spread = max(b.z - b.x * b.x, 0.0) + f * f * max(c.z - c.x * c.x, 0.0) + w * w * max(c.w - c.y * c.y, 0.0);
  return vec2(b.x + f * c.x + w * c.y, spread);
}

// The share in cloud of a stretch of a view about `p` in level `L` (x), and how much of the
// spread its edge was widened by is the stretch's own unresolved detail rather than the clouds'
// soft edge (y): `along` the stretch's extent on the field (m), `across` the width it takes in
// across it (m), `rise` how far it climbs (m). Not `fine` (toward the light), the lumps' spread
// alone. In a global weather, `L`
// as the weather systems have it there (cloudPlace, read by the caller). Only the part of the
// stretch's climb within L's shell holds cloud: its share of the climb, read at its middle. Read
// at the stretch's middle alone, a place's cloud thinner than its level's shell was missed
// wherever a stretch's middle passed over or under it though the stretch ran through it, and as
// the steps, laid out from the camera, moved with it, whole clouds came and went.
vec2 cloudShare(CloudLevel L, vec3 o, vec2 along, float across, float rise, bool fine) {
  vec3 p = uCloudCamera + o;
  float altitude = cloudAltitudeOf(p);
  float own = altitude;
  float depth = L.shell.y - L.shell.x;
  float within = 1.0;
  if(rise > 1.0) {
    float lo = max(altitude - 0.5 * rise, L.shell.x);
    float hi = min(altitude + 0.5 * rise, L.shell.y);
    if(hi <= lo)
      return vec2(0.0);
    within = (hi - lo) / rise;
    altitude = 0.5 * (lo + hi);
    rise = hi - lo;
  }
  float u = (altitude - L.shell.x) / depth;
  // The base fades in, over the stretch's climb too.
  float base = smoothstep(-0.5 * rise, CLOUD_BASE_FADE * depth + 0.5 * rise, altitude - L.shell.x);
  if(base <= 0.0 || u >= 1.0)
    return vec2(0.0);
  vec2 field = cloudFieldOf(p);
  vec3 up = cloudUpOf(p);
  vec2 c = cloudCoverAt(L, cloudFootOf(o, up, own), max(length(along), across));
  // The cover the column needs here, and its spread over the stretch's climb.
  float h = clamp(u, 0.0, 1.0);
  float span = L.need.y - L.need.x;
  float need = L.need.x + span * pow(h, CLOUD_DOME);
  float slope = span * CLOUD_DOME * pow(max(h, 0.05), CLOUD_DOME - 1.0) / depth;
  // Over the level's upper part the need climbs on (as the square of the way up it), by the
  // top past the most any column reaches (need.w): each cloud's top rounds off at a height of
  // its own cover's, and none reaches the level's top, which cut the tallest flat.
  float rounding = max(h - CLOUD_ROUNDED, 0.0) / (1.0 - CLOUD_ROUNDED);
  need += L.need.w * rounding * rounding;
  slope += L.need.w * 2.0 * rounding / ((1.0 - CLOUD_ROUNDED) * depth);
  float spread = c.y + slope * slope * rise * rise / 12.0;
  // The lumps where the stretch resolves them, as the pixel's footprint sees them across it and
  // half its extent along it; their spread where it does not. Their tile is the cover's over
  // CLOUD_LUMP_TILES, turned and stretched with it.
  float tile = L.look.w * CLOUD_COVER_SIZE / CLOUD_LUMP_TILES;
  float res = max(across, 0.5 * max(length(along), rise));
  float keep = fine ? 1.0 - smoothstep(0.15, 0.5, res / (CLOUD_FEATURE * tile)) : 0.0;
  float mean = c.x;
  if(keep > 0.0) {
    // Read twice, the second turned and CLOUD_LUMP_BROADER times broader, at equal weight: one
    // tiling's period showed as a grid over a whole deck (as the coverage's once did).
    float broader = tile * CLOUD_LUMP_BROADER;
    // In 3D where the point lies (at the middle of its climb within the level), fixed on the
    // Earth.
    vec3 at = L.turn * (uCloudFieldEarth * (o + up * (altitude - own))) * CLOUD_LUMP_TILES;
    vec3 q = at + L.lump;
    vec3 q2 = CLOUD_LUMPS_TURN * at / CLOUD_LUMP_BROADER + L.lump2;
    float lod = max(log2(max(res, 1.0) * CLOUD_SHAPE_TEXELS / tile), 0.0);
    float lod2 = max(log2(max(res, 1.0) * CLOUD_SHAPE_TEXELS / broader), 0.0);
    float n = textureLod(uCloudShape, q, lod).r + textureLod(uCloudShape, q2, lod2).r;
    n = (0.5 * n - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y * 1.41421356;
    mean += L.look.y * keep * n;
  }
  spread += L.look.y * L.look.y * (1.0 - keep * keep);
  float soft = L.need.z * L.need.z;
  // Toward the local weather's edge, fewer and smaller clouds: the need raised, by its edge past
  // the most any column reaches. Faded instead, they turned see-through, a haze from far off.
  float inside = cloudLocalEdge(field);
  float apart = (1.0 - inside) * (span + L.need.w + 4.0 * sqrt(soft + spread));
  float x = (mean - need - apart) * inversesqrt(soft + spread);
  float share = within * base * smoothstep(0.0, 0.15, inside) / (1.0 + exp(-CLOUD_LOGISTIC * x));
  return vec2(share, spread / (soft + spread));
}

// The optical depth of a stretch of level `L` `len` long with `share` of it in cloud. Where the
// share is the stretch's own unresolved detail (`unresolved`), cloud and sky mixed in chunks of
// a cloud's size, each hiding what its cloud does; where it is the clouds' soft edge, a thin fog.
float cloudDepth(CloudLevel L, float share, float unresolved, float len) {
  float sigma = L.shell.z;
  float chunk = min(L.look.z, len);
  float mixed = -log(max(1.0 - share * (1.0 - exp(-sigma * chunk)), 1e-6)) * (len / chunk);
  return mix(sigma * share * len, mixed, unresolved);
}

// The optical depth toward the light across level `K`'s cloud, from a point `o` from the camera
// (at `altitude`)
// under it: a stretch across it, taken in whole, where the light crosses its middle. In a global
// weather, its cloud's where the light crosses its shell (cloudPlace), at that cloud's own
// middle (read once, at the shell's): read at the middle of the whole shell, it was over the
// top of a place's lower cloud, and the shadow came and went in sharp straight edges where that
// cloud's top passed it.
float cloudCrossing(CloudLevel K, vec3 o, float altitude, float rising, float across) {
  float len = (K.shell.y - K.shell.x) / rising;
  vec3 q = o + gWay * ((0.5 * (K.shell.x + K.shell.y) - altitude) / rising);
#if defined(CLOUD_GLOBAL)
  if(!cloudPlace(K, uCloudCamera + q, max(across, 0.25 * len)))
    return 0.0;
  len = (K.shell.y - K.shell.x) / rising;
  q = o + gWay * ((0.5 * (K.shell.x + K.shell.y) - altitude) / rising);
#endif
  vec2 s = cloudShare(K, q, gWay.xy * len, max(across, 0.25 * len), K.shell.y - K.shell.x, false);
  return cloudDepth(K, s.x, s.y, len);
}

// The optical depth toward the light through the levels over level `l`, from the point `o` from
// the camera: a far, broad
// shadow, read once a step (cloudMarch) and lent to the points lit in it. Each level read by a
// constant index: read in a loop by the level's own, through the uniform arrays, in every point
// lit, three levels cost three times one.
float cloudAbove(int l, vec3 o, float across) {
  vec3 p = uCloudCamera + o;
  float rising = cloudRisingAt(p);
  if(rising <= 0.02)
    return 0.0;
  float altitude = cloudAltitudeOf(p);
  float tau = 0.0;
  if(l < 1 && uCloudLevelCount > 1)
    tau += cloudCrossing(cloudLevel(1), o, altitude, rising, across);
  if(l < 2 && uCloudLevelCount > 2)
    tau += cloudCrossing(cloudLevel(2), o, altitude, rising, across);
  return tau;
}

// The light a point `o` from the camera of level `L` scatters toward it: the light's through its shell
// toward it (gWay), in uCloudLightSamples stretches each taken in whole (no narrower than
// `across`), the first a cloud's skin (CLOUD_LIGHT_SKIN), the rest growing geometrically; then
// `above`, through the levels over it (cloudAbove); and the sky's and the ground's by its height
// in its level. The cloud toward the light hides it as a stretch of cloud and sky mixed does
// (cloudDepth), as the view's own stretches do: chosen by eye over its density as it is
// (2026-11-09), which shaded the clouds' undersides far darker. It lets more of the sun through
// deep in a cloud, so clouds facing the sun, or seen from above in a high sun, are brighter.
vec3 cloudLight(CloudLevel L, vec3 o, float across, float above) {
  vec3 p = uCloudCamera + o;
  float altitude = cloudAltitudeOf(p);
  float depth = L.shell.y - L.shell.x;
  float rising = cloudRisingAt(p);
  float toTop = max(L.shell.y - altitude, 0.0) / max(rising, 0.05);
  float reach = min(toTop, 6.0 * L.look.z);
  float skin = min(CLOUD_LIGHT_SKIN * uCloudScale, reach);
  float grow = uCloudLightSamples > 1 ? pow(max(reach / max(skin, 1.0), 1.0), 1.0 / float(uCloudLightSamples - 1)) : 1.0;
  float tau = above;
  float before = 0.0;
  float d = skin;
  for(int j = 0; j < uCloudLightSamples; j++) {
    float len = d - before;
    if(len > 1.0) {
      vec3 q = o + gWay * (before + 0.5 * len);
      vec2 s = cloudShare(L, q, gWay.xy * len, max(across, 0.25 * len), abs(rising) * len, false);
      tau += cloudDepth(L, s.x, s.y, len);
    }
    before = d;
    d *= grow;
  }
  float h = clamp((altitude - L.shell.x) / depth, 0.0, 1.0);
  return cloudLit(gLighting, h, tau, 0.0, rising);
}

// A part of a view from `from`, `len` long, holding level `L`'s cloud (in a global weather, as
// placed for the part: its short steps and their light read no map of their own), the field's
// point and
// the altitude at its start `field`, `altitude`, `above` the depth toward the light through the
// levels over it (cloudAbove): walked in short steps CLOUD_FINE of its mean
// free paths long (fewer and longer past uCloudFineSteps), each read for its own share and lit
// where its light comes from on average, 1/τ − 1/(e^τ − 1) of the way in for its optical depth
// τ: near its front where it is dense, its middle where it is thin. The light a view sees comes
// from within a free path or two of where it enters a cloud, and changes as fast: lit once per
// long step, the clouds banded where the steps fell, as the camera tilted. Not shortened only as
// far as a pixel's footprint: that bounds the detail across the view, not along it, and from
// high up, one step through a level was lit 100 m into the clouds' shade, their tops dark.
void cloudFine(CloudLevel L, float from, float len, vec2 field, float altitude, float above) {
  int count = int(clamp(ceil(len * L.shell.z / CLOUD_FINE), 1.0, float(uCloudFineSteps)));
  float stride = len / float(count);
  for(int g = 0; g < uCloudFineSteps; g++) {
    if(g >= count || gTransmit < 0.01)
      break;
    gCost += 0.25;
    float end = from + stride * float(g + 1);
    vec3 q = cloudFieldPoint(gD, end);
    vec2 fieldQ = cloudFieldOf(q);
    float altitudeQ = cloudAltitudeOf(q);
    float middle = end - 0.5 * stride;
    float across = max(uCloudMarch.w * middle, 0.5);
    vec2 s = cloudShare(L, gD * middle, fieldQ - field, across, abs(altitudeQ - altitude), true);
    if(s.x > CLOUD_LEAST) {
      float tau = cloudDepth(L, s.x, s.y, stride);
      float into = tau < 1e-3 ? 0.5 : 1.0 / tau - 1.0 / (exp(min(tau, 80.0)) - 1.0);
      vec3 light = cloudLight(L, gD * (end - stride + into * stride), max(across, 0.5 * stride), above);
      cloudAdd(end - stride, stride, tau / stride, light);
    }
    field = fieldQ;
    altitude = altitudeQ;
  }
}

// Level `L` (the `l`th) along a run, in stretches growing geometrically from its near end: as a
// geometric series of its length over its distance in the level's steps, but none finer than
// CLOUD_STEP_FOOTPRINTS pixels' footprints. Each stretch read in its middle for what it holds;
// one holding cloud (CLOUD_THIN or more) split in CLOUD_SPLIT parts, each read for its own
// share: a stretch's share is read along all of it, and a long one, at a shallow angle to the
// level, smeared the clouds' fronts over the rows of pixels it spans. A part holding cloud is
// walked in short steps (cloudFine). What holds less is taken whole, lit once.
void cloudMarch(CloudLevel L, int l, vec2 run) {
  int n = int(L.shell.w);
  float span = run.y - run.x;
  float near = max(run.x, 50.0);
  // In the log of the distance: the run's extent, and a step.
  float k = max(log(1.0 + span / near), 1e-4);
  float dk = max(k / float(n), log(1.0 + CLOUD_STEP_FOOTPRINTS * uCloudMarch.w));
  float from = run.x;
  float u = 0.0;
  float next = dk;
  vec3 a = cloudFieldPoint(gD, from);
  vec2 fieldA = cloudFieldOf(a);
  float altitudeA = cloudAltitudeOf(a);
  for(int i = 0; i <= n; i++) {
    if(gTransmit < 0.01 || u >= k)
      break;
    gCost += 1.0;
    u = min(next, k);
    next += dk;
    float to = run.x + near * (exp(u) - 1.0);
    float len = to - from;
    vec3 b = cloudFieldPoint(gD, to);
    vec2 fieldB = cloudFieldOf(b);
    float altitudeB = cloudAltitudeOf(b);
    float t = from + 0.5 * len;
    float across = max(uCloudMarch.w * t, 0.5);
#if !defined(CLOUD_GLOBAL)
    gEdgeNoise = cloudEdgeNoise(0.5 * (fieldA + fieldB));
#endif
    // In a global weather, the step placed as the weather systems have it over all of it, so it
    // misses no cloud in it; each part placed at its middle, as fine as a pixel's footprint, and
    // its short steps and their light lent that (cloudFine): read in each of them, at the extent
    // of each, the cloud changed as a tilt of the view changed the steps, and its light, read
    // apart, lit another cloud than the one it lit.
    vec3 om = gD * t;
    float rise = abs(altitudeB - altitudeA);
    CloudLevel S = L;
    vec2 s = cloudPlace(S, uCloudCamera + om, max(across, max(length(fieldB - fieldA), rise))) ? cloudShare(S, om, fieldB - fieldA, across, rise, true) : vec2(0.0);
    float tau = s.x > CLOUD_LEAST ? cloudDepth(S, s.x, s.y, len) : 0.0;
    float above = tau > 0.0 ? cloudAbove(l, om, max(across, 0.5 * len)) : 0.0;
    if(tau > 0.0 && tau < CLOUD_THIN)
      cloudAdd(from, len, tau / len, cloudLight(S, om, max(across, 0.5 * len), above));
    else if(tau >= CLOUD_THIN) {
      float part = len / float(CLOUD_SPLIT);
      vec2 fieldP = fieldA;
      float altitudeP = altitudeA;
      for(int j = 0; j < CLOUD_SPLIT; j++) {
        if(gTransmit < 0.01)
          break;
        float end = from + part * float(j + 1);
        vec3 q = cloudFieldPoint(gD, end);
        vec2 fieldQ = cloudFieldOf(q);
        float altitudeQ = cloudAltitudeOf(q);
        float middle = end - 0.5 * part;
        float acrossP = max(uCloudMarch.w * middle, 0.5);
        vec3 oP = gD * middle;
        CloudLevel P = L;
        vec2 sp = cloudPlace(P, uCloudCamera + oP, acrossP) ? cloudShare(P, oP, fieldQ - fieldP, acrossP, abs(altitudeQ - altitudeP), true) : vec2(0.0);
        float tauP = sp.x > CLOUD_LEAST ? cloudDepth(P, sp.x, sp.y, part) : 0.0;
        if(tauP >= CLOUD_THIN)
          cloudFine(P, end - part, part, fieldP, altitudeP, above);
        else if(tauP > 0.0)
          cloudAdd(end - part, part, tauP / part, cloudLight(P, oP, max(acrossP, 0.5 * part), above));
        fieldP = fieldQ;
        altitudeP = altitudeQ;
      }
    }
    from = to;
    fieldA = fieldB;
    altitudeA = altitudeB;
  }
}

void main() {
  vec3 dir = normalize(vCloudDirection);
  // Derivatives first, before anything branches.
  float blend = max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));

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

  // Each level's runs along the view, within the local weather's radius: two at most a level
  // (before the view dips under its base and after it comes back up), marched front to back.
#if defined(CLOUD_GLOBAL)
  vec2 local = vec2(0.0, CLOUD_FAR);
#else
  vec2 local = cloudLocalSpan(gD);
#endif
  vec2 runs[2 * CLOUD_LEVELS_MOST];
  int levels[2 * CLOUD_LEVELS_MOST];
  int count = 0;
  for(int l = 0; l < CLOUD_LEVELS_MOST; l++) {
    if(l >= uCloudLevelCount)
      break;
    vec2 near;
    vec2 far;
    cloudRuns(gO, dir, height, uCloudShells[l].xy, ground, near, far);
    near = vec2(max(near.x, local.x), min(near.y, local.y));
    far = vec2(max(far.x, local.x), min(far.y, local.y));
    if(near.x < near.y) {
      runs[count] = near;
      levels[count] = l;
      count++;
    }
    if(far.x < far.y) {
      runs[count] = far;
      levels[count] = l;
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
    }
  }

  // Lit as where the view first meets cloud.
  gLighting = cloudLightingAt(dir, cloudUpAt(count > 0 ? max(runs[0].x, 0.0) : 0.0));
  gWay = vec3(dot(gLighting.way, uCloudFrameE), dot(gLighting.way, uCloudFrameN), dot(gLighting.way, uCloudFrameM));
  for(int r = 0; r < uCloudRunsMost; r++) {
    if(r >= count || gTransmit < 0.01)
      break;
    int l = levels[r];
    cloudMarch(cloudLevel(l), l, runs[r]);
  }

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
    seen = cloudFromSpace(cloudThroughAir(lit, dir, mean, blend), lit, p, globeAltitude(p));
  }
  gl_FragColor = vec4(seen * alpha, alpha);
  // Their front (CLOUD_FRONT), where they hide that much at all: as log2 over
  // CLOUD_DEPTH_RANGE, which the composite reads.
  float depth = gFront >= 0.0 ? gFront : mean;
  gl_FragDepth = clamp(log2(max(depth, 1.0)) / CLOUD_DEPTH_RANGE, 0.0, 0.999999);
}

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
// clouds are).
uniform int uCloudDebug;
// 1 hazed by the air between them and the camera, 0 not.
uniform float uCloudAir;
// The cover map: (patches, masses, patches², masses²), with mipmaps, filtered anisotropically,
// repeating.
uniform sampler2D uCloudCover;
// The levels drawn (a uniform count keeps the loops loops in Direct3D), from the ground up;
// each one's shell (base and top over the sea, m; its extinction in cloud, 1 / m; its steps
// along a run), the cover its columns need (at its base: its share under cloud, softCoverLevel;
// at its top: its tallest clouds'), its edge's width and how far that need climbs over its
// upper part (cover); its look (the masses' weight against the patches, how far the lumps move
// the cover, a cloud's size in m for how cloud and sky mixed hide what lies behind, the map's
// texel across the wind in m); the field to its map (2 × 2, column-major: turned with its wind,
// stretched along it); and its map's drift and its second lump tiling's (in tiles).
uniform int uCloudLevelCount;
uniform vec4 uCloudShells[CLOUD_LEVELS_MOST];
uniform vec4 uCloudNeeds[CLOUD_LEVELS_MOST];
uniform vec4 uCloudLooks[CLOUD_LEVELS_MOST];
uniform vec4 uCloudMaps[CLOUD_LEVELS_MOST];
uniform vec4 uCloudShifts[CLOUD_LEVELS_MOST];
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
// The lumps' second tiling: this many times broader, and shifted in height (in its tiles).
#define CLOUD_LUMP_BROADER 1.618
#define CLOUD_LUMP_RISE 0.13
// The clouds' tops round off from this share of a level's depth up (cloudShare).
#define CLOUD_ROUNDED 0.5
// How the cover a column needs rises up a level (a power): domed tops over flat bases.
#define CLOUD_DOME 2.0
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

// A cloud level (the uniforms' `l`th).
struct CloudLevel {
  vec4 shell;
  vec4 need;
  vec4 look;
  mat2 map;
  vec4 shift;
};

CloudLevel cloudLevel(int l) {
  CloudLevel L;
  L.shell = uCloudShells[l];
  L.need = uCloudNeeds[l];
  L.look = uCloudLooks[l];
  vec4 m = uCloudMaps[l];
  L.map = mat2(m.xy, m.zw);
  L.shift = uCloudShifts[l];
  return L;
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

// The broad noise pushing the local weather's edge in and out at `field` (fixed on the Earth),
// −1 to 1: the cover map's broadest patches, a few across it. It changes over tens of kilometres,
// so it is read once a step along a view (gEdgeNoise), not in every sample of it.
float cloudEdgeNoise(vec2 field) {
  if(uCloudLocalShape.y <= 0.0)
    return 0.0;
  return clamp(3.0 * textureLod(uCloudCover, field / (3.0 * uCloudLocalRadius) + 0.29, 5.0).r, -1.0, 1.0);
}
float gEdgeNoise = 0.0;

// How far inside the local weather `field` lies (fixed on the Earth): 1 well inside, 0 beyond
// its edge. Its edge is pushed in and out by gEdgeNoise, so it is no circle; never past its
// radius, so what lies outside need not be marched.
float cloudLocalEdge(vec2 field) {
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

// The cover of level `L`'s map from its patches and masses (`c`: their means and second
// moments): its mean and its spread (variance). The two are independent noises, so their mix's
// spread is the patches' and the weighed masses' together.
vec2 cloudCoverOf(CloudLevel L, vec4 c) {
  float w = L.look.x;
  float spread = max(c.z - c.x * c.x, 0.0) + w * w * max(c.w - c.y * c.y, 0.0);
  return vec2(c.x + w * c.y, spread);
}

// Level `L`'s cover's mean and spread over a stretch at `field`: `along` the stretch's extent
// on the field (m), `across` the width it takes in across it (m). Filtered anisotropically,
// long along the stretch and narrow across it.
vec2 cloudCoverOver(CloudLevel L, vec2 field, vec2 along, float across) {
  vec2 uv = L.map * field - L.shift.xy;
  float a = length(along);
  vec2 axis = a > 1e-3 ? along / a : vec2(1.0, 0.0);
  vec2 gx = L.map * (axis * max(a, across));
  vec2 gy = L.map * (vec2(-axis.y, axis.x) * across);
  return cloudCoverOf(L, textureGrad(uCloudCover, uv, gx, gy));
}

// Its mean and spread about `field`, over `extent` (m) every way: coarser and cheaper, for the
// light.
vec2 cloudCoverAround(CloudLevel L, vec2 field, float extent) {
  vec2 uv = L.map * field - L.shift.xy;
  return cloudCoverOf(L, textureLod(uCloudCover, uv, max(log2(extent / L.look.w), 0.0)));
}

// The share in cloud of a stretch of a view about `p` in level `L` (x), and how much of the
// spread its edge was widened by is the stretch's own unresolved detail rather than the clouds'
// soft edge (y): `along` the stretch's extent on the field (m), `across` the width it takes in
// across it (m), `rise` how far it climbs (m). Not `fine` (toward the light), the map read
// every way over the stretch's extent, and the lumps' spread alone.
vec2 cloudShare(CloudLevel L, vec3 p, vec2 along, float across, float rise, bool fine) {
  float altitude = cloudAltitudeOf(p);
  float depth = L.shell.y - L.shell.x;
  float u = (altitude - L.shell.x) / depth;
  // The base fades in, over the stretch's climb too.
  float base = smoothstep(-0.5 * rise, CLOUD_BASE_FADE * depth + 0.5 * rise, altitude - L.shell.x);
  if(base <= 0.0 || u >= 1.0)
    return vec2(0.0);
  vec2 field = cloudFieldOf(p);
  vec2 c = fine ? cloudCoverOver(L, field, along, across) : cloudCoverAround(L, field, max(length(along), across));
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
  // half its extent along it; their spread where it does not. Their tile is the map's over
  // CLOUD_LUMP_TILES, turned and stretched with it.
  float tile = L.look.w * CLOUD_COVER_SIZE / CLOUD_LUMP_TILES;
  float res = max(across, 0.5 * max(length(along), rise));
  float keep = fine ? 1.0 - smoothstep(0.15, 0.5, res / (CLOUD_FEATURE * tile)) : 0.0;
  float mean = c.x;
  if(keep > 0.0) {
    // Read twice, the second turned and CLOUD_LUMP_BROADER times broader, at equal weight: one
    // tiling's period showed as a grid over a whole deck (as the coverage's once did).
    vec2 at = L.map * field;
    float broader = tile * CLOUD_LUMP_BROADER;
    vec3 q = vec3((at - L.shift.xy) * CLOUD_LUMP_TILES, altitude / tile);
    vec3 q2 = vec3(mat2(0.8, 0.6, -0.6, 0.8) * at * (CLOUD_LUMP_TILES / CLOUD_LUMP_BROADER) - L.shift.zw, altitude / broader + CLOUD_LUMP_RISE);
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
  float share = base * smoothstep(0.0, 0.15, inside) / (1.0 + exp(-CLOUD_LOGISTIC * x));
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

// The optical depth toward the light across level `K`'s shell, from a point `p` (at `altitude`)
// under it: a stretch across the shell, taken in whole, where the light crosses its middle.
float cloudCrossing(CloudLevel K, vec3 p, float altitude, float rising, float across) {
  float len = (K.shell.y - K.shell.x) / rising;
  vec3 q = p + gWay * ((0.5 * (K.shell.x + K.shell.y) - altitude) / rising);
  vec2 s = cloudShare(K, q, gWay.xy * len, max(across, 0.25 * len), K.shell.y - K.shell.x, false);
  return cloudDepth(K, s.x, s.y, len);
}

// The optical depth toward the light through the levels over level `l`, from `p`: a far, broad
// shadow, read once a step (cloudMarch) and lent to the points lit in it. Each level read by a
// constant index: read in a loop by the level's own, through the uniform arrays, in every point
// lit, three levels cost three times one.
float cloudAbove(int l, vec3 p, float across) {
  float rising = gWay.z;
  if(rising <= 0.02)
    return 0.0;
  float altitude = cloudAltitudeOf(p);
  float tau = 0.0;
  if(l < 1 && uCloudLevelCount > 1)
    tau += cloudCrossing(cloudLevel(1), p, altitude, rising, across);
  if(l < 2 && uCloudLevelCount > 2)
    tau += cloudCrossing(cloudLevel(2), p, altitude, rising, across);
  return tau;
}

// The light a point `p` of level `L` scatters toward the camera: the light's through its shell
// toward it (gWay), in uCloudLightSamples stretches each taken in whole (no narrower than
// `across`), the first a cloud's skin (CLOUD_LIGHT_SKIN), the rest growing geometrically; then
// `above`, through the levels over it (cloudAbove); and the sky's and the ground's by its height
// in its level. The cloud toward the light hides it as a stretch of cloud and sky mixed does
// (cloudDepth), as the view's own stretches do: chosen by eye over its density as it is
// (2026-11-09), which shaded the clouds' undersides far darker. It lets more of the sun through
// deep in a cloud, so clouds facing the sun, or seen from above in a high sun, are brighter.
vec3 cloudLight(CloudLevel L, vec3 p, float across, float above) {
  float altitude = cloudAltitudeOf(p);
  float depth = L.shell.y - L.shell.x;
  float rising = gWay.z;
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
      vec3 q = p + gWay * (before + 0.5 * len);
      vec2 s = cloudShare(L, q, gWay.xy * len, max(across, 0.25 * len), abs(gWay.z) * len, false);
      tau += cloudDepth(L, s.x, s.y, len);
    }
    before = d;
    d *= grow;
  }
  float h = clamp((altitude - L.shell.x) / depth, 0.0, 1.0);
  return cloudLit(gLighting, h, tau, 0.0, rising);
}

// A part of a view from `from`, `len` long, holding level `L`'s cloud, the field's point and
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
    vec2 s = cloudShare(L, cloudFieldPoint(gD, middle), fieldQ - field, across, abs(altitudeQ - altitude), true);
    if(s.x > CLOUD_LEAST) {
      float tau = cloudDepth(L, s.x, s.y, stride);
      float into = tau < 1e-3 ? 0.5 : 1.0 / tau - 1.0 / (exp(min(tau, 80.0)) - 1.0);
      vec3 light = cloudLight(L, cloudFieldPoint(gD, end - stride + into * stride), max(across, 0.5 * stride), above);
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
    gEdgeNoise = cloudEdgeNoise(0.5 * (fieldA + fieldB));
    vec2 s = cloudShare(L, cloudFieldPoint(gD, t), fieldB - fieldA, across, abs(altitudeB - altitudeA), true);
    float tau = s.x > CLOUD_LEAST ? cloudDepth(L, s.x, s.y, len) : 0.0;
    float above = tau > 0.0 ? cloudAbove(l, cloudFieldPoint(gD, t), max(across, 0.5 * len)) : 0.0;
    if(tau > 0.0 && tau < CLOUD_THIN)
      cloudAdd(from, len, tau / len, cloudLight(L, cloudFieldPoint(gD, t), max(across, 0.5 * len), above));
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
        vec2 sp = cloudShare(L, cloudFieldPoint(gD, middle), fieldQ - fieldP, acrossP, abs(altitudeQ - altitudeP), true);
        float tauP = sp.x > CLOUD_LEAST ? cloudDepth(L, sp.x, sp.y, part) : 0.0;
        if(tauP >= CLOUD_THIN)
          cloudFine(L, end - part, part, fieldP, altitudeP, above);
        else if(tauP > 0.0)
          cloudAdd(end - part, part, tauP / part, cloudLight(L, cloudFieldPoint(gD, middle), max(acrossP, 0.5 * part), above));
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

  // Each level's runs along the view, within the local weather's radius: two at most a level
  // (before the view dips under its base and after it comes back up), marched front to back.
  vec2 local = cloudLocalSpan(gD);
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

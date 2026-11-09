// The 3D clouds (SceneryCloudVolume), marched along each pixel's view ray through one cloud
// layer's shell about the Earth's centre, at a share of the screen's resolution. Written as
// premultiplied linear colour and alpha, and as depth log2 of the distance to their front
// (CLOUD_FRONT): the composite (cloud-volume-composite.glsl) draws them over the scene at that
// depth. One colour attachment, so ANGLE compiles its pixel shader once (scenery.md,
// Performance).
//
// Stable as the camera moves (documents/clouds.md, "The march"): every sample lies where it
// does from where the view crosses something fixed on the field — a cell's edge, a cloud's
// column, the layer's shells — never from the camera, and nothing is jittered. A view through
// the cumulus jumps from one such crossing to the next (cloudMarchCumulus), stepping only
// within clouds' columns, in steps of their own size: as fine far off as near, however long
// the view runs through the layer. A grid's clouds smaller than uCloudPixels give way to their
// mean (cloudCumulusMean). Through the strato, a fixed count of samples spread over the run.
// Through the soft clouds (CLOUD_SOFT_CLOUDS, a spike), a fixed count of stretches growing with
// the distance, each taking in what it holds and never finer (cloudMarchSoft).

#include <common>
#include ./sky-gradient.glsl
#include ./cloud-field.glsl
#include ./cloud-light.glsl

// The most iterations along a view (crossings and samples), a cumulus's samples across its
// radius, the strato's samples along a run, and the angle a pixel of the clouds' image spans
// (radians).
uniform vec4 uCloudMarch;
// A grid's clouds are drawn as themselves while this many pixels across; smaller, as their mean.
uniform float uCloudPixels;
// Samples toward the light: a uniform count keeps the loop a loop in Direct3D.
uniform int uCloudLightSamples;
// 0 drawn, 1 the march's cost (its iterations over uCloudMarch.x), 2 unlit (white, as opaque as
// the clouds are).
uniform int uCloudDebug;
// 1 hazed by the air between them and the camera, 0 not.
uniform float uCloudAir;

varying vec3 vCloudDirection;

// Where along the view what lies behind is drawn over the clouds (their depth): where they hide
// this share of it.
#define CLOUD_FRONT 0.1
// In cloud close to the camera, a step is no longer than this share of its distance, nor
// shorter than this (metres).
#define CLOUD_NEAR_GROWTH 0.2
#define CLOUD_NEAR_STEP 5.0
// In cloud, a step spans at most this optical depth (and no less than most of a footprint).
#define CLOUD_STEP_DEPTH 1.5

// The view, set once by main: from the camera (world: its offset from the sphere's centre, and
// its height over the sea), its way (world, and on the field's frame), how its clouds are lit
// (cloudLightingAt), and what it has gathered so far: premultiplied colour, what it still lets
// through, where its light comes from (weighed), its front, and its iterations.
vec3 gO;
vec3 gDir;
vec3 gD;
float gHeight;
CloudLighting gLighting;
vec3 gColor = vec3(0.0);
float gTransmit = 1.0;
float gDepthSum = 0.0;
float gWeight = 0.0;
float gFront = -1.0;
float gCost = 0.0;

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

// The stretch of a view along `d` (on the field's frame) within the local weather's radius of
// its axis (the line from the Earth's centre through its middle): its near and far distance,
// x > y where it passes outside. What lies outside holds no cloud, and is not marched.
vec2 cloudLocalSpan(vec3 d) {
  vec2 o = uCloudCamera.xy;
  float a = dot(d.xy, d.xy);
  float b = dot(o, d.xy);
  float outside = dot(o, o) - uCloudLayer.w * uCloudLayer.w;
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

// Where along a step of optical depth `tau` what it absorbs lies on average (a share of the
// step): half way in thin cloud, nearer its start the denser. The weight of a step's far end in
// the light it adds, for light running straight between its ends.
float cloudAbsorbedAlong(float tau) {
  if(tau < 1e-3)
    return 0.5;
  float kept = exp(-tau);
  return 1.0 / tau - kept / (1.0 - kept);
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

#if defined(CLOUD_SOFT_CLOUDS)

// Soft clouds (a spike, 2026-11-09): rounded masses of many sizes in one layer, from a map of
// the cover fixed to the Earth (scenery-cloud-cover.ts: a tile of noise, drifting with the
// wind) and a profile up the layer: the higher, the more cover a column needs to reach it, so
// the clouds are domed over flat bases. Every sample takes in what the stretch of the view it
// stands for holds, never finer: the cover map read anisotropically along the stretch (its mean
// and its spread, which widens the clouds' edge), and the shape volume's lumps only where the
// stretch resolves them (their spread where it does not). So it hardly matters where a sample
// lands: the clouds neither shimmer nor morph as the camera moves, however fast, and cover the
// same share of the sky near and far.

// The cover map: (cover, cover squared), with mipmaps, filtered anisotropically; its period (m),
// how far the wind has carried it (east, north; m, wrapped to its period), and its texel (m).
uniform sampler2D uSoftCover;
uniform vec4 uSoftMap;
// The cover a column needs at the layer's base (the layer's share under cloud: softCoverLevel)
// and at its top (the tallest clouds'), the edge's width (cover), and how the cover needed rises
// up the layer (a power: higher, rounder domes over flatter bases).
uniform vec4 uSoftLevel;
// The lumps: the shape volume's tile (m) and how far its Perlin-Worley moves the cover (cover);
// and a cloud's size (m: how a stretch of cloud and sky mixed hides what lies behind).
uniform vec4 uSoftLumps;
// Stretches toward the light: a uniform count keeps the loop a loop in Direct3D.
uniform int uSoftLightSamples;
// Short steps through a part of a step holding cloud, at most (softFine): a uniform count, as
// uSoftLightSamples.
uniform int uSoftFineSteps;

// Over this share of the layer's depth its base fades in.
#define SOFT_BASE 0.05
// A step along a view spans no less than this many pixels' footprints: as fine as that, a view
// straight down through the layer from high up spent its steps where nothing changes.
#define SOFT_STEP_FOOTPRINTS 2.0
// A step holding cloud is split in this many parts, each read for what it holds.
#define SOFT_SPLIT 4
// A part holding cloud is walked in short steps this many of the clouds' mean free paths
// (1 / extinction) long (softFine). At 4, faint bands came back at a shallow angle.
#define SOFT_FINE 2.0
// The first stretch toward the light: a cloud's skin (m, at scale 1), how its lit side and its
// shaded side differ.
#define SOFT_LIGHT_SKIN 200.0
// The logistic standing for a normal distribution's CDF: its slope.
#define SOFT_LOGISTIC 1.702
// The shape volume's broadest features: this share of its tile.
#define SOFT_FEATURE 0.25

// The cover map's mean and spread (its variance) over a stretch at `field`: `along` the
// stretch's extent on the field (m), `across` the width it takes in across it (m). Filtered
// anisotropically, long along the stretch and narrow across it.
vec2 softCoverOver(vec2 field, vec2 along, float across) {
  vec2 uv = fract((field - uSoftMap.yz) / uSoftMap.x);
  float a = length(along);
  vec2 axis = a > 1e-3 ? along / a : vec2(1.0, 0.0);
  vec2 gx = axis * (max(a, across) / uSoftMap.x);
  vec2 gy = vec2(-axis.y, axis.x) * (across / uSoftMap.x);
  vec2 c = textureGrad(uSoftCover, uv, gx, gy).rg;
  return vec2(c.x, max(c.y - c.x * c.x, 0.0));
}

// The cover map's mean and spread about `field`, over `extent` (m) every way: coarser and
// cheaper, for the light.
vec2 softCoverAround(vec2 field, float extent) {
  vec2 uv = fract((field - uSoftMap.yz) / uSoftMap.x);
  vec2 c = textureLod(uSoftCover, uv, max(log2(extent / uSoftMap.w), 0.0)).rg;
  return vec2(c.x, max(c.y - c.x * c.x, 0.0));
}

// The share in cloud of a stretch of a view about `p` (x), and how much of the spread its edge
// was widened by is the stretch's own unresolved detail rather than the clouds' soft edge (y):
// `along` the stretch's extent on the field (m), `across` the width it takes in across it (m),
// `rise` how far it climbs (m). Not `fine` (toward the light), the map read every way over the
// stretch's extent, and the lumps' spread alone.
vec2 softShare(vec3 p, vec2 along, float across, float rise, bool fine) {
  float altitude = cloudAltitudeOf(p);
  float depth = uCloudLayer.y - uCloudLayer.x;
  float u = (altitude - uCloudLayer.x) / depth;
  // The base fades in, over the stretch's climb too.
  float base = smoothstep(-0.5 * rise, SOFT_BASE * depth + 0.5 * rise, altitude - uCloudLayer.x);
  if(base <= 0.0 || u >= 1.0)
    return vec2(0.0);
  vec2 field = cloudFieldOf(p);
  vec2 c = fine ? softCoverOver(field, along, across) : softCoverAround(field, max(length(along), across));
  // The cover the column needs here, and its spread over the stretch's climb.
  float h = clamp(u, 0.0, 1.0);
  float span = uSoftLevel.y - uSoftLevel.x;
  float level = uSoftLevel.x + span * pow(h, uSoftLevel.w);
  float slope = span * uSoftLevel.w * pow(max(h, 0.05), uSoftLevel.w - 1.0) / depth;
  float spread = c.y + slope * slope * rise * rise / 12.0;
  // The lumps where the stretch resolves them, as the pixel's footprint sees them across it and
  // half its extent along it; their spread where it does not.
  float tile = uSoftLumps.x;
  float res = max(across, 0.5 * max(length(along), rise));
  float keep = fine ? 1.0 - smoothstep(0.15, 0.5, res / (SOFT_FEATURE * tile)) : 0.0;
  float mean = c.x;
  if(keep > 0.0) {
    vec3 q = vec3(field - uSoftMap.yz, altitude) / tile;
    float lod = max(log2(max(res, 1.0) * CLOUD_SHAPE_TEXELS / tile), 0.0);
    float n = (textureLod(uCloudShape, q, lod).r - CLOUD_PERLIN_WORLEY.x) / CLOUD_PERLIN_WORLEY.y;
    mean += uSoftLumps.y * keep * n;
  }
  spread += uSoftLumps.y * uSoftLumps.y * (1.0 - keep * keep);
  float soft = uSoftLevel.z * uSoftLevel.z;
  float x = (mean - level) * inversesqrt(soft + spread);
  float share = base * cloudLocalEdge(field) / (1.0 + exp(-SOFT_LOGISTIC * x));
  return vec2(share, spread / (soft + spread));
}

// The optical depth of a stretch `len` long with `share` of it in cloud. Where the share is the
// stretch's own unresolved detail (`unresolved`), cloud and sky mixed in chunks of a cloud's
// size, each hiding what its cloud does; where it is the clouds' soft edge, a thin fog.
float softDepth(float share, float unresolved, float len) {
  float sigma = uCloudLook.x;
  float chunk = min(uSoftLumps.z, len);
  float mixed = -log(max(1.0 - share * (1.0 - exp(-sigma * chunk)), 1e-6)) * (len / chunk);
  return mix(sigma * share * len, mixed, unresolved);
}

// The light a point `p` of cloud scatters toward the camera, `way` the light's way (on the
// field's frame): the light's through the layer toward it, in uSoftLightSamples stretches each
// taken in whole (no narrower than `across`), the first a cloud's skin (SOFT_LIGHT_SKIN), the
// rest growing geometrically; and the sky's and the ground's by its height in the layer. The
// cloud toward the light hides it as a stretch of cloud and sky mixed does (softDepth), as the
// view's own stretches do: chosen by eye over its density as it is (2026-11-09), which shaded
// the clouds' undersides far darker. It lets more of the sun through deep in a cloud, so clouds
// facing the sun, or seen from above in a high sun, are brighter.
vec3 softLight(vec3 p, vec3 way, float across) {
  float altitude = cloudAltitudeOf(p);
  float depth = uCloudLayer.y - uCloudLayer.x;
  float rising = way.z;
  float toTop = max(uCloudLayer.y - altitude, 0.0) / max(rising, 0.05);
  float reach = min(toTop, 6.0 * uSoftLumps.z);
  float skin = min(SOFT_LIGHT_SKIN * uCloudLook.z, reach);
  float grow = uSoftLightSamples > 1 ? pow(max(reach / max(skin, 1.0), 1.0), 1.0 / float(uSoftLightSamples - 1)) : 1.0;
  float tau = 0.0;
  float before = 0.0;
  float d = skin;
  for(int j = 0; j < uSoftLightSamples; j++) {
    float len = d - before;
    if(len > 1.0) {
      vec3 q = p + way * (before + 0.5 * len);
      vec2 s = softShare(q, way.xy * len, max(across, 0.25 * len), abs(way.z) * len, false);
      tau += softDepth(s.x, s.y, len);
    }
    before = d;
    d *= grow;
  }
  float h = clamp((altitude - uCloudLayer.x) / depth, 0.0, 1.0);
  return cloudLit(gLighting, h, tau, 0.0, rising);
}

// A part of a view from `from`, `len` long, holding cloud, the field's point and the altitude at
// its start `field`, `altitude`: walked in short steps SOFT_FINE of the clouds' mean free paths
// long (fewer and longer past uSoftFineSteps), each read for its own share and lit where its
// light comes from on average, 1/τ − 1/(e^τ − 1) of the way in for its optical depth τ: near
// its front where it is dense, its middle where it is thin. The light a view sees comes from
// within a free path or two of where it enters a cloud, and changes as fast: lit once per long
// step, the clouds banded where the steps fell, as the camera tilted. Not shortened only as far
// as a pixel's footprint: that bounds the detail across the view, not along it, and from high
// up, one step through the layer was lit 100 m into the clouds' shade, their tops dark.
void softFine(float from, float len, vec2 field, float altitude, vec3 way) {
  int count = int(clamp(ceil(len * uCloudLook.x / SOFT_FINE), 1.0, float(uSoftFineSteps)));
  float stride = len / float(count);
  for(int g = 0; g < uSoftFineSteps; g++) {
    if(g >= count || gTransmit < 0.01)
      break;
    gCost += 0.25;
    float end = from + stride * float(g + 1);
    vec3 q = cloudFieldPoint(gD, end);
    vec2 fieldQ = cloudFieldOf(q);
    float altitudeQ = cloudAltitudeOf(q);
    float middle = end - 0.5 * stride;
    float across = max(uCloudMarch.w * middle, 0.5);
    vec2 s = softShare(cloudFieldPoint(gD, middle), fieldQ - field, across, abs(altitudeQ - altitude), true);
    if(s.x > 1e-3) {
      float tau = softDepth(s.x, s.y, stride);
      float into = tau < 1e-3 ? 0.5 : 1.0 / tau - 1.0 / (exp(min(tau, 80.0)) - 1.0);
      vec3 light = softLight(cloudFieldPoint(gD, end - stride + into * stride), way, max(across, 0.5 * stride));
      cloudAdd(end - stride, stride, tau / stride, light);
    }
    field = fieldQ;
    altitude = altitudeQ;
  }
}

// The soft clouds along a run, in stretches growing geometrically from its near end: as a
// geometric series of its length over its distance in uCloudMarch.z steps, but none finer than
// SOFT_STEP_FOOTPRINTS pixels' footprints; the grid offset by `offset` of a step (0 to 1: the
// first stretch that share of one). Each stretch read in its middle for what it holds; one
// holding cloud split in SOFT_SPLIT parts, each read for its own share: a stretch's share is
// read along all of it, and a long one, at a shallow angle to the layer, smeared the clouds'
// fronts over the rows of pixels it spans. Split only where the whole holds some cloud, so the
// parts' and the whole's estimates differ only where both are nothing. A part holding cloud is
// walked in short steps (softFine).
void cloudMarchSoft(vec2 run, float offset) {
  int n = int(uCloudMarch.z);
  float span = run.y - run.x;
  float near = max(run.x, 50.0);
  // In the log of the distance: the run's extent, and a step.
  float k = max(log(1.0 + span / near), 1e-4);
  float dk = max(k / float(n), log(1.0 + SOFT_STEP_FOOTPRINTS * uCloudMarch.w));
  vec3 way = vec3(dot(gLighting.way, uCloudFrameE), dot(gLighting.way, uCloudFrameN), dot(gLighting.way, uCloudFrameM));
  float from = run.x;
  float u = 0.0;
  float next = max(offset, 1e-3) * dk;
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
    vec2 s = softShare(cloudFieldPoint(gD, t), fieldB - fieldA, max(uCloudMarch.w * t, 0.5), abs(altitudeB - altitudeA), true);
    if(s.x > 1e-3) {
      float part = len / float(SOFT_SPLIT);
      vec2 fieldP = fieldA;
      float altitudeP = altitudeA;
      for(int j = 0; j < SOFT_SPLIT; j++) {
        if(gTransmit < 0.01)
          break;
        float end = from + part * float(j + 1);
        vec3 q = cloudFieldPoint(gD, end);
        vec2 fieldQ = cloudFieldOf(q);
        float altitudeQ = cloudAltitudeOf(q);
        float middle = end - 0.5 * part;
        vec2 sp = softShare(cloudFieldPoint(gD, middle), fieldQ - fieldP, max(uCloudMarch.w * middle, 0.5), abs(altitudeQ - altitudeP), true);
        if(sp.x > 1e-3)
          softFine(end - part, part, fieldP, altitudeP, way);
        fieldP = fieldQ;
        altitudeP = altitudeQ;
      }
    }
    from = to;
    fieldA = fieldB;
    altitudeA = altitudeB;
  }
}
#elif defined(CLOUD_STRATO)

// The strato along a run: uCloudMarch.z samples, spread from the run's near end as a geometric
// series of its length over its distance (each in the middle of its stretch), so their places
// follow the shells it crosses, not the camera. The field's octaves are taken in as far as the
// footprint and the stretch resolve them.
void cloudMarchStrato(vec2 run) {
  int n = int(uCloudMarch.z);
  float span = run.y - run.x;
  float near = 200.0 * uCloudLook.z;
  float k = max(log(1.0 + span / max(run.x, near)), 1e-3);
  float ek = exp(k) - 1.0;
  float horizontal = length(gD.xy);
  float from = run.x;
  for(int i = 0; i < n; i++) {
    if(gTransmit < 0.01)
      break;
    gCost += 1.0;
    float to = run.x + span * (exp(k * float(i + 1) / float(n)) - 1.0) / ek;
    float len = to - from;
    float t = from + 0.5 * len;
    vec3 p = cloudFieldPoint(gD, t);
    float altitude = cloudAltitudeOf(p);
    float footprint = max(max(uCloudMarch.w * t, 0.5 * len * horizontal), 1.0);
    vec3 column = cloudStratoAt(cloudFieldOf(p), footprint);
    float density = cloudStratoDensity(column, altitude);
    if(density > 0.0) {
      // Toward the light, and straight up: through the column's own veil, over this point.
      vec3 up = cloudUpAt(t);
      float rising = dot(gLighting.way, up);
      float deck = uCloudLook.x * column.x * 0.6 * max(column.z - altitude, 0.0);
      float h = (altitude - column.y) / max(column.z - column.y, 1.0);
      cloudAdd(from, len, uCloudLook.x * density, cloudLit(gLighting, h, deck / max(rising, 0.08), deck, rising));
    }
    from = to;
  }
}

#else

// How far grid `k`'s clouds are drawn as themselves `t` along the view (1), not as their mean
// (0): while its largest are at least uCloudPixels across, given way over the last 40 %.
float cloudGridNear(int k, float t) {
  float reach = 2.0 * uCloudGrids[k].z / (uCloudMarch.w * uCloudPixels);
  return 1.0 - smoothstep(0.6 * reach, reach, t);
}

// The grids' clouds as their mean at `field`, `altitude` (as far as each has given way to it
// `t` along the view; with `all`, every grid wholly): the extinction, and how far up their
// clouds it lies (`h`, for their light). Each grid's share of the ground under cloud thins
// toward its clouds' tops; what a stretch of it hides is per chord of a cloud: the gaps let all
// through, the clouds e^(−σ chord), so it hides what the clouds would, not a haze of their
// density.
float cloudCumulusMean(vec2 field, float altitude, float t, bool all, out float h) {
  h = 0.5;
  float edge = cloudLocalEdge(field);
  if(edge <= 0.0)
    return 0.0;
  float z = altitude - uCloudLayer.x;
  float sigma = 0.0;
  float up = 0.0;
  for(int k = 0; k < uCloudGridCount; k++) {
    float far = all ? 1.0 : 1.0 - cloudGridNear(k, t);
    vec4 mean = uCloudGridMeans[k];
    float top = 1.25 * mean.z;
    if(far <= 0.0 || mean.x <= 0.0 || z <= 0.0 || z >= top)
      continue;
    float share = mean.x * edge * far * (1.0 - (z / top) * (z / top));
    float chord = 1.6 * mean.y;
    float s = -log(max(1.0 - share * (1.0 - exp(-0.85 * uCloudLook.x * chord)), 1e-6)) / chord;
    sigma += s;
    up += s * z / top;
  }
  if(sigma > 0.0)
    h = up / sigma;
  return sigma;
}

// A stretch from `t`, `len` long, of the grids' clouds as their mean (cloudCumulusMean), lit as
// a cloud is on average where it lies.
void cloudMeanStep(float t, float len, bool all) {
  float at = t + 0.5 * len;
  vec3 p = cloudFieldPoint(gD, at);
  float h;
  float sigma = cloudCumulusMean(cloudFieldOf(p), cloudAltitudeOf(p), at, all, h);
  if(sigma * len < 1e-4)
    return;
  cloudAdd(t, len, sigma, cloudLit(gLighting, h, 1.5 + 3.0 * (1.0 - h), 0.0, 0.0));
}

// The way the view's track runs on the field (the same all along it), set by cloudMarchCumulus.
vec2 gTrack;

// Which way the view's track runs along grid `k`'s axes.
ivec2 cloudGridDirs(int k) {
  vec2 turn = uCloudGridTurns[k];
  return ivec2(sign(vec2(dot(gTrack, turn), dot(gTrack, vec2(-turn.y, turn.x)))));
}

// Where a view's track crosses out of `cell` of grid `k` past `t`: (across its x, across its y).
vec2 cloudGridExits(int k, ivec2 cell, float t) {
  vec4 grid = uCloudGrids[k];
  vec2 shift = uCloudGridShifts[k];
  vec2 turn = uCloudGridTurns[k];
  vec2 ax = turn;
  vec2 ay = vec2(-turn.y, turn.x);
  ivec2 dirs = cloudGridDirs(k);
  float x = dirs.x == 0 ? CLOUD_FAR : cloudFieldCross(gD, ax, float(cell.x + (dirs.x > 0 ? 1 : 0)) * grid.x + dot(shift, ax), t);
  float y = dirs.y == 0 ? CLOUD_FAR : cloudFieldCross(gD, ay, float(cell.y + (dirs.y > 0 ? 1 : 0)) * grid.x + dot(shift, ay), t);
  return vec2(x, y);
}

// Grid `k` at `cell`, which the view entered at `entered`, from `t` on: where the view enters and
// leaves its cloud's column (x, y; CLOUD_FAR where there is none, or it misses it), where it
// leaves the cell (z), and how far the grid is drawn at all (w); and its cloud's radius (0 for
// none).
vec4 cloudGridSlot(int k, ivec2 cell, float t, float entered, out float radius) {
  radius = 0.0;
  vec4 grid = uCloudGrids[k];
  float reach = 2.0 * grid.z / (uCloudMarch.w * uCloudPixels);
  if(t >= reach || grid.w <= 0.0)
    return vec4(CLOUD_FAR, CLOUD_FAR, CLOUD_FAR, 0.0);
  vec2 exits = cloudGridExits(k, cell, entered);
  float exit = min(min(exits.x, exits.y), reach);
  vec4 slot = vec4(CLOUD_FAR, CLOUD_FAR, exit, reach);
  Cumulus c;
  if(cloudCumulusAt(k, cell, c)) {
    float footprint = max(uCloudMarch.w * t, 1.0);
    vec2 column = cloudFieldColumn(gD, c.middle, cloudCumulusReach(c, footprint));
    float soft = cloudCumulusSoft(c.radius, footprint);
    vec2 below = cloudBelow(gO, gDir, gHeight, c.base + c.height + (CLOUD_BILLOW_OUT + CLOUD_DETAIL_OUT) * c.radius + 0.5 * soft);
    float enter = max(max(column.x, below.x), t);
    float leave = min(min(column.y, below.y), exit);
    if(enter < leave) {
      slot.xy = vec2(enter, leave);
      radius = c.radius;
    }
  }
  return slot;
}

// The light reaching cumulus `c` at a point `p` (on the field's frame), `altitude` over the sea,
// up `up` (world), toward the light: the optical depth through its own cloud (`depth` is added
// to), and how much its body takes in the point (for the clouds' height there). Its billows
// close by (one sample a tenth of its radius on: the creases' shade on each other), then its
// body's mass on to its top or across it (uCloudLightSamples samples of cloudCumulusBody,
// nearer first, each taking in as much as it stands for): the body alone further on, so the
// samples do not slice its billows into bands as the point moves.
float cloudCumulusShade(Cumulus c, vec3 p, vec2 here, float altitude, vec3 way, float rising, float footprint, inout float depth) {
  float near = 0.2 * c.radius;
  float span = max(min(max(c.base + c.height + 0.3 * c.radius - altitude, 0.0) / rising, 2.4 * c.radius), near) - near;
  vec3 q = p + way * (0.5 * near);
  float shade = cloudCumulusDensity(c, cloudFieldOf(q), cloudAltitudeOf(q), max(footprint, 0.3 * c.radius), false) * near;
  float n = float(uCloudLightSamples);
  for(int j = 0; j < uCloudLightSamples; j++) {
    float a = pow(float(j) / n, 1.5);
    float b = pow(float(j + 1) / n, 1.5);
    q = p + way * (near + 0.5 * (a + b) * span);
    shade += cloudCumulusBody(c, cloudFieldOf(q), cloudAltitudeOf(q)) * (b - a) * span;
  }
  depth += uCloudLook.x * shade;
  return cloudCumulusBody(c, here, altitude);
}

// Each grid's cell about the view, and its slot there (cloudGridSlot) and cloud's radius.
ivec2 gCells[CLOUD_GRIDS];
vec4 gSlots[CLOUD_GRIDS];
float gRadii[CLOUD_GRIDS];

// The cumulus `t` along the view, of the grids whose cloud's column the view is in at `from`:
// how far into the cloud it lies furthest in (x, cloudCumulusEdge's: the clouds' union), the
// density there (y, as far as the grid is drawn as its clouds at all), and its light (`light`:
// where it is cloud at all, or with `always`, wherever there is a cloud's column). The light
// through every one of those clouds, and as high up them as their bodies there have it:
// through the one it lies furthest in alone, it jumped where two met.
vec2 cloudCumulusSample(float t, float from, bool always, out vec3 light) {
  vec3 p = cloudFieldPoint(gD, t);
  vec2 here = cloudFieldOf(p);
  float altitude = cloudAltitudeOf(p);
  float footprint = max(uCloudMarch.w * t, 1.0);
  vec2 best = vec2(-1e9, 0.0);
  for(int k = 0; k < uCloudGridCount; k++) {
    vec4 s = gSlots[k];
    if(!(s.x <= from && from < s.y))
      continue;
    Cumulus c;
    if(!cloudCumulusAt(k, gCells[k], c))
      continue;
    vec2 e = cloudCumulusEdge(c, here, altitude, footprint, true);
    e.y *= cloudGridNear(k, t);
    if(e.x > best.x)
      best = e;
  }
  light = vec3(0.0);
  if(best.x > -1e8 && (always || (best.x > -0.5 && best.y > 0.0))) {
    vec3 up = cloudUpAt(t);
    vec3 way = vec3(dot(gLighting.way, uCloudFrameE), dot(gLighting.way, uCloudFrameN), dot(gLighting.way, uCloudFrameM));
    float rising = max(dot(gLighting.way, up), 0.05);
    float depth = 0.0;
    float heights = 0.0;
    float weights = 1e-4;
    for(int k = 0; k < uCloudGridCount; k++) {
      vec4 s = gSlots[k];
      if(!(s.x <= from && from < s.y))
        continue;
      Cumulus c;
      if(!cloudCumulusAt(k, gCells[k], c))
        continue;
      float w = cloudCumulusShade(c, p, here, altitude, way, rising, footprint, depth) + 1e-3;
      heights += w * clamp((altitude - c.base) / max(c.height, 1.0), 0.0, 1.0);
      weights += w;
    }
    light = cloudLit(gLighting, heights / weights, depth, 0.0, 0.0);
  }
  return best;
}
// The cumulus along a run: from crossing to crossing of each grid's cells and its clouds'
// columns, every one of them fixed on the field; within a column, steps of a share of its
// cloud's radius (uCloudMarch.y across it), and no shorter than the footprint, each step's share
// in cloud integrated between its ends (cloudShareAlong), lit as its ends are. The grids'
// clouds far off give way to their mean as they shrink under uCloudPixels; what the iterations
// do not reach, the mean takes in a few stretches.
void cloudMarchCumulus(vec2 run) {
  float s0 = 1.0 + uCloudCamera.z * uCloudInvRadius;
  float s1 = gD.z * uCloudInvRadius;
  gTrack = gD.xy * (s0 + s1 * run.x) - (uCloudCamera.xy + gD.xy * run.x) * s1;
  float t = run.x;
  vec2 field = cloudFieldOf(cloudFieldPoint(gD, t));
  // From where the grids' mean starts to show.
  float meanFrom = CLOUD_FAR;
  for(int k = 0; k < uCloudGridCount; k++) {
    gCells[k] = ivec2(floor(cloudGridOf(k, field) / uCloudGrids[k].x));
    gSlots[k] = cloudGridSlot(k, gCells[k], t, t, gRadii[k]);
    meanFrom = min(meanFrom, 1.2 * uCloudGrids[k].z / (uCloudMarch.w * uCloudPixels));
  }
  // The last sample in a column (its edge and density, and light), while the steps go on in it.
  bool started = false;
  vec2 last = vec2(0.0);
  vec3 lastLight = vec3(0.0);
  int iterations = int(uCloudMarch.x);
  for(int i = 0; i < iterations; i++) {
    if(t >= run.y || gTransmit < 0.01)
      break;
    gCost += 1.0;
    // Each grid's cell brought up to `t` (a step in cloud may have crossed one or two); the
    // next crossing of any; and the columns `t` lies in: where they all end (`leave`), and the
    // least of their clouds.
    float next = run.y;
    float leave = t;
    float least = CLOUD_FAR;
    bool spent = true;
    for(int k = 0; k < uCloudGridCount; k++) {
      for(int a = 0; a < 3; a++) {
        if(!(t >= gSlots[k].z && gSlots[k].z < gSlots[k].w))
          break;
        float entered = gSlots[k].z;
        vec2 exits = cloudGridExits(k, gCells[k], entered - 1e-3 * max(entered, 1.0));
        ivec2 dirs = cloudGridDirs(k);
        if(exits.x <= exits.y)
          gCells[k].x += dirs.x;
        if(exits.y <= exits.x)
          gCells[k].y += dirs.y;
        gSlots[k] = cloudGridSlot(k, gCells[k], t, entered, gRadii[k]);
      }
      if(t >= gSlots[k].w)
        gSlots[k] = vec4(CLOUD_FAR, CLOUD_FAR, CLOUD_FAR, 0.0);
      vec4 s = gSlots[k];
      if(s.x <= t && t < s.y) {
        leave = max(leave, s.y);
        least = min(least, gRadii[k]);
      } else if(s.x > t)
        next = min(next, s.x);
      next = min(next, s.z);
      spent = spent && s.z >= CLOUD_FAR;
    }

    if(least >= CLOUD_FAR) {
      // Clear of every grid's clouds up to the next crossing: only their mean, far off; past
      // every grid's reach, in stretches growing with the distance.
      started = false;
      float len = next - t;
      if(spent)
        len = min(len, max(0.2 * t, (run.y - run.x) / 8.0));
      if(t + len > meanFrom)
        cloudMeanStep(t, len, false);
      t += len;
      continue;
    }

    // In the columns: a step of a share of the least of their clouds, no shorter than the
    // footprint, its share in cloud from its two ends. Cut only where the columns all end
    // (where there is no cloud): cut at a cell's edge or another column's, the steps would
    // start over on those upright planes and cylinders, and seam the clouds along them.
    if(!started) {
      last = cloudCumulusSample(t, t, false, lastLight);
      started = true;
    }
    float footprint = max(uCloudMarch.w * t, 1.0);
    // Close to the camera, no longer than a share of the distance: a pixel spans there far less
    // than a share of a cloud, and steps as long sliced what lay close by into shards along the
    // view. In cloud, no deeper than CLOUD_STEP_DEPTH: the skin the light comes from resolved.
    float stride = min(max(least / uCloudMarch.y, 0.75 * footprint), max(CLOUD_NEAR_GROWTH * t, CLOUD_NEAR_STEP));
    stride = min(stride, max(CLOUD_STEP_DEPTH / (uCloudLook.x * max(last.y, 0.25)), 0.75 * footprint));
    float len = min(stride, min(leave, run.y) - t);
    vec3 light;
    vec2 here = cloudCumulusSample(t + len, t, false, light);
    float share = cloudShareAlong(last.x, here.x);
    if(share > 0.0) {
      // Lit from where it crosses into the cloud where it does (the light at a step's far end,
      // deep inside, jumped as the edge moved within the step), else from its near end, on to
      // its far end as far as the step's absorption lies along it: front-loaded in dense cloud
      // (cloudAbsorbedAlong). Evenly between the ends, the darker far end took over wherever
      // the edge fell late in a step, and banded the clouds' surfaces along the steps.
      float sigma = uCloudLook.x * 0.5 * (last.y + here.y) * share;
      vec3 near = lastLight;
      if(last.x < 0.0 && here.x >= 0.0)
        cloudCumulusSample(t + len * clamp(-last.x / (here.x - last.x), 0.0, 1.0), t, true, near);
      else if(cloudShare(last.x) <= 0.0)
        near = light;
      vec3 far = cloudShare(here.x) > 0.0 ? light : near;
      cloudAdd(t, len, sigma, mix(near, far, cloudAbsorbedAlong(sigma * len)));
    }
    last = here;
    lastLight = light;
    if(t + len > meanFrom)
      cloudMeanStep(t, len, false);
    t += len;
  }
  // What the iterations did not reach: the grids' mean, in four stretches.
  if(t < run.y && gTransmit >= 0.01) {
    float len = (run.y - t) / 4.0;
    for(int j = 0; j < 4; j++)
      cloudMeanStep(t + float(j) * len, len, true);
  }
}
#endif

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

  // The layer's runs along the view, within the local weather's radius; lit as where the view
  // first meets it.
  vec2 local = cloudLocalSpan(gD);
  vec2 runs[2];
  cloudRuns(gO, dir, height, uCloudLayer.xy, ground, runs[0], runs[1]);
  float first = max(runs[0].x < runs[0].y ? runs[0].x : runs[1].x, local.x);
  gLighting = cloudLightingAt(dir, cloudUpAt(max(first, 0.0)));
  for(int s = 0; s < 2; s++) {
    vec2 run = vec2(max(runs[s].x, local.x), min(runs[s].y, local.y));
    if(run.x >= run.y || gTransmit < 0.01)
      continue;
#if defined(CLOUD_SOFT_CLOUDS)
    cloudMarchSoft(run, 1.0);
#elif defined(CLOUD_STRATO)
    cloudMarchStrato(run);
#else
    cloudMarchCumulus(run);
#endif
  }

  if(uCloudDebug == 1) {
    // The march's cost: blue none, through green and yellow, to red at its most.
#if defined(CLOUD_SOFT_CLOUDS)
    float cost = clamp(gCost / uCloudMarch.z, 0.0, 1.0);
#else
    float cost = clamp(gCost / uCloudMarch.x, 0.0, 1.0);
#endif
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

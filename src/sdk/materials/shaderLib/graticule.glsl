// Lines on the Earth (a graticule), as a SceneryGraticule draws them over what is seen of
// the Earth from the air: latitude and longitude, the UTM zones and the nautical time zones,
// each a width in screen pixels at any distance (the SDK's pristine lines, grid.glsl),
// fading out where they crowd. Needs <common> and globe.glsl, and the globe placed on the
// Earth (a frame: uGlobeSphere.w). On and off by its uniforms (graticuleOn): compiled in,
// it costs a uniform branch while off.
//
// Take graticuleAt where control flow is uniform (it takes derivatives), then
// graticuleOver anywhere.

// Per kind (GRATICULE_LAT_LON, GRATICULE_UTM, GRATICULE_TIME_ZONES): its colour, linear,
// and opacity; and its width in pixels (0: off).
uniform vec4 uGraticuleColors[3];
uniform vec4 uGraticuleLines[3];
// Latitude and longitude's step for the whole view, in degrees (graticuleStep, from how
// far the view is zoomed), the next finer step, and how much of it is drawn.
uniform vec3 uGraticuleLatLon;
// Where the lines are measured from, under the camera (setGraticuleOrigin): its whole
// degrees of longitude and latitude, and what is left of them; its offset on the globe's
// sphere (Δχ, ΔΛ, radians), w 1 once set; and the latitude from it in degrees, a series in
// Δχ from its (δ, δ², δ³).
uniform vec4 uGraticuleBase;
uniform vec4 uGraticuleOrigin;
uniform vec3 uGraticuleSeries;

#define GRATICULE_LAT_LON 0
#define GRATICULE_UTM 1
#define GRATICULE_TIME_ZONES 2

// Within this of the camera's ground on the sphere, north or south (radians, ~190 km), the
// latitude is measured from it (its series); beyond, from the latitude itself. The
// longitude is measured from it everywhere.
#define GRATICULE_NEAR 0.03

// Meridians run on to a pole past the last parallel before it only when that parallel lies
// within this latitude (degrees), and are thinned toward the poles to keep cells at least
// this wide for their height (graticuleMeridianThinning, GRATICULE_POLE_CAP and
// GRATICULE_CELL_ASPECT in graticule.ts).
#define GRATICULE_POLE_CAP 60.0
#define GRATICULE_CELL_ASPECT 0.5

// How the step's meridians thin toward the poles, then the finer step's: twelve each, 0
// past the end (graticuleMeridianChain).
uniform vec4 uGraticuleThinning[6];

// The lines themselves, as the SDK's grids draw them.
#include ./grid.glsl

// Where a pixel lies on the Earth, for the lines: its longitude and latitude in degrees as
// whole degrees (`base`, the same for every pixel) and what is left (`local`), which
// 32-bit floats hold to a centimetre near the camera, where the latitude and longitude
// themselves hold to half a metre (`lonLat`: for which zone a pixel is in, never for a
// line's offset); and how much `local` changes from it to the next pixel along x and y
// (longitude unwrapped across 180°).
struct GraticuleAt {
  vec2 lonLat;
  vec2 base;
  vec2 local;
  vec2 dLon;
  vec2 dLat;
};

// Whether any lines are drawn: the globe on the Earth, and a kind with a width. By uniforms
// alone, so turning the lines on or off compiles nothing, and costs next to nothing off.
bool graticuleOn() {
  return uGlobeSphere.w > 0.5 &&
    (uGraticuleLines[GRATICULE_LAT_LON].x > 0.0 ||
    uGraticuleLines[GRATICULE_UTM].x > 0.0 ||
    uGraticuleLines[GRATICULE_TIME_ZONES].x > 0.0);
}

// The ground under `p`; all zero with no lines to draw (graticuleOn). ⚠️ Derivatives.
GraticuleAt graticuleAt(vec3 p) {
  GraticuleAt at;
  at.lonLat = vec2(0.0);
  at.base = vec2(0.0);
  at.local = vec2(0.0);
  at.dLon = vec2(0.0);
  at.dLat = vec2(0.0);
  // The same for every pixel: the derivatives below stay defined.
  if(!graticuleOn())
    return at;
  vec2 offset = globeSphereOffset(p);
  vec2 lonLat = (globeGeographicAt(offset) * (180.0 / GLOBE_PI)).yx;
  at.base = uGraticuleBase.xy;
  // From the camera's ground: longitude closed form (globeGeographicAt's), good anywhere;
  // latitude by its series, within GRATICULE_NEAR of it north or south. Not by longitude
  // too: about a pole, ground a few kilometres off lies at any longitude, and the latitude
  // itself is coarsest there (an asin near 1: tens of metres), so the ring around a polar
  // cap came out grainy. Before it is set, the latitude and longitude themselves.
  vec2 d = offset - uGraticuleOrigin.xy;
  d.y -= 2.0 * GLOBE_PI * floor(d.y / (2.0 * GLOBE_PI) + 0.5);
  float lon = d.y - (uGlobeSphere.z - 1.0) * (sin(offset.y) - sin(uGraticuleOrigin.y));
  vec3 s = uGraticuleSeries;
  float lat = d.x * (s.x + d.x * (s.y + d.x * s.z));
  vec2 near = uGraticuleBase.zw + vec2(lon * (180.0 / GLOBE_PI), lat);
  vec2 far = lonLat - at.base;
  far.x -= 360.0 * floor(far.x / 360.0 + 0.5);
  bool set = uGraticuleOrigin.w > 0.5;
  at.local = vec2(set ? near.x : far.x, set && abs(d.x) < GRATICULE_NEAR ? near.y : far.y);
  at.lonLat = lonLat;
  vec2 dLon = vec2(dFdx(at.local.x), dFdy(at.local.x));
  at.dLon = dLon - 360.0 * floor(dLon / 360.0 + 0.5);
  at.dLat = vec2(dFdx(at.local.y), dFdy(at.local.y));
  return at;
}

// How much of lines `apart` pixels apart on screen is kept: none up to `gone`, all from
// `full`, eased between on a log scale.
float graticuleKept(float apart, float gone, float full) {
  return smoothstep(log2(gone), log2(full), log2(max(apart, 1e-6)));
}

// How much of the pixel the nearest of lines `spacing` degrees apart covers, `off` degrees
// from it, their coordinate changing by `perPixel` degrees a pixel: `width` pixels wide
// (pristineLine), fading out only where they crowd too close to tell apart, from 6 pixels
// apart to none at 2.
float graticuleLine(float off, float spacing, float perPixel, float width) {
  float p = max(perPixel, 1e-9);
  float uvDeriv = 2.0 * p / spacing;
  float line = pristineLine(2.0 * abs(off) / spacing, uvDeriv, 0.5 * width * uvDeriv);
  return line * graticuleKept(spacing / p, 2.0, 6.0);
}

// Degrees to the nearest multiple of `step` from `from`.
float graticuleOff(float value, float step, float from) {
  float v = value - from;
  return v - step * floor(v / step + 0.5);
}

// The same along a coordinate `base + local` (GraticuleAt), so it holds where `local` does:
// `base` (whole degrees) less `from` (whole or half) brought to the nearest line first,
// exactly for steps of whole degrees, and to none for steps that divide a degree, then
// `local` from there.
float graticuleOffAt(float base, float local, float step, float from) {
  float b = base - from;
  float perDegree = 1.0 / step;
  bool divides = step < 1.0 && abs(perDegree - floor(perDegree + 0.5)) < 1e-3 && from == floor(from);
  b = divides ? 0.0 : b - step * floor(b / step + 0.5);
  return graticuleOff(b + local, step, 0.0);
}

// Degrees from `at` along a coordinate `base + local`, as precisely as `local`.
float graticuleFrom(float base, float local, float at) {
  return (base - at) + local;
}

// Degrees of longitude from `at` the shorter way round: `base + local` is measured from the
// camera's longitude, so a meridian may lie a turn away from it.
float graticuleFromLon(float base, float local, float at) {
  float v = graticuleFrom(base, local, at);
  return v - 360.0 * floor(v / 360.0 + 0.5);
}

// The first of a step's thinning (uGraticuleThinning from `from`) that is `needed` or
// more; 0 if none is (graticuleThinningPick).
float graticuleThinningPick(int from, float needed) {
  float m = 0.0;
  float least = needed * (1.0 - 1e-4);
  for(int i = 2; i >= 0; i--) {
    vec4 c = uGraticuleThinning[from + i];
    m = c.w >= least ? c.w : m;
    m = c.z >= least ? c.z : m;
    m = c.y >= least ? c.y : m;
    m = c.x >= least ? c.x : m;
  }
  return m;
}

// Which of the meridians every `step` degrees are drawn where `at` lies, `offParallel`
// degrees from the nearest parallel: every m-th, 0 for none (graticuleMeridianThinning).
// The band is told by which side of that parallel it lies, so m changes exactly under it.
float graticuleMeridianThinning(GraticuleAt at, float step, float offParallel, int from) {
  float nearest = floor((at.lonLat.y - offParallel) / step + 0.5);
  float band = offParallel >= 0.0 ? nearest : nearest - 1.0;
  float a = abs(band * step);
  float b = abs((band + 1.0) * step);
  float equatorward = min(a, b);
  float poleward = min(max(a, b), 90.0);
  if(equatorward >= 90.0)
    return 0.0;
  bool last = poleward >= 90.0 - 1e-4;
  if(last && equatorward > GRATICULE_POLE_CAP + 1e-4)
    return 0.0;
  float narrowest = cos(radians(last ? equatorward : poleward));
  return graticuleThinningPick(from, GRATICULE_CELL_ASPECT / max(narrowest, 1e-6));
}

// Degrees of longitude to the nearest of every m-th meridian every `step` degrees, as
// precisely as `local`: from the nearest meridian (graticuleOffAt), on by whole steps to
// the nearest kept, which is that one wherever a line is drawn. `m` divides the meridians
// round the Earth, so the kept meet themselves at the date line.
float graticuleMeridianOff(GraticuleAt at, float step, float m) {
  float off = graticuleOffAt(at.base.x, at.local.x, step, 0.0);
  if(m <= 1.0)
    return off;
  float j = floor((at.lonLat.x - off) / step + 0.5);
  float dj = j - m * floor(j / m + 0.5);
  return off + dj * step;
}

// Lines every `step` degrees of latitude and longitude, the meridians thinned toward the
// poles by the step's thinning from `from` in uGraticuleThinning: cut clean under the
// parallels where they thin, and none in a cap that holds too few.
float graticuleLatLonAt(GraticuleAt at, float step, float width, int from) {
  float lon = length(at.dLon);
  float lat = length(at.dLat);
  float offParallel = graticuleOffAt(at.base.y, at.local.y, step, 0.0);
  float m = graticuleMeridianThinning(at, step, offParallel, from);
  float meridian = m > 0.0 ? graticuleLine(graticuleMeridianOff(at, step, m), step * m, lon, width) : 0.0;
  // None at a pole itself, a point, which would be drawn as a ring a line wide.
  float nearest = floor((at.lonLat.y - offParallel) / step + 0.5) * step;
  float parallel = abs(nearest) >= 90.0 - 1e-4 ? 0.0 : graticuleLine(offParallel, step, lat, width);
  return max(meridian, parallel);
}

// Latitude and longitude at the view's step, the same for both everywhere on screen, and
// the next finer step as it fades in (uGraticuleLatLon). Each step's lines are among the
// next finer one's.
float graticuleLatLon(GraticuleAt at, float width) {
  vec3 steps = uGraticuleLatLon;
  float cover = graticuleLatLonAt(at, steps.x, width, 0);
  if(steps.z > 0.0)
    cover = max(cover, steps.z * graticuleLatLonAt(at, steps.y, width, 3));
  return cover;
}

// Degrees of longitude to the nearest UTM zone's edge at `at`: every 6°, but Norway's
// zone 32V reaching west to 3°E (56°N–64°N), and Svalbard's 31X, 33X, 35X and 37X edged at
// 9°, 21°, 33° and 42°E (72°N–84°N).
float graticuleUtmMeridian(GraticuleAt at) {
  float lon = at.lonLat.x;
  float lat = at.lonLat.y;
  float b = at.base.x;
  float l = at.local.x;
  if(lat >= 56.0 && lat < 64.0 && lon >= 0.0 && lon <= 12.0)
    return min(min(abs(graticuleFromLon(b, l, 0.0)), abs(graticuleFromLon(b, l, 3.0))), abs(graticuleFromLon(b, l, 12.0)));
  if(lat >= 72.0 && lat < 84.0 && lon >= 0.0 && lon <= 42.0)
    return min(min(min(abs(graticuleFromLon(b, l, 0.0)), abs(graticuleFromLon(b, l, 9.0))), min(abs(graticuleFromLon(b, l, 21.0)), abs(graticuleFromLon(b, l, 33.0)))), abs(graticuleFromLon(b, l, 42.0)));
  return abs(graticuleOffAt(b, l, 6.0, 0.0));
}

// The UTM zones: their edges from 80°S to 84°N, and their latitude bands' every 8° from
// 80°S, the last (X) 12° to 84°N.
float graticuleUtm(GraticuleAt at, float width) {
  float lon = length(at.dLon);
  float lat = length(at.dLat);
  float y = at.lonLat.y;
  float inside = step(-80.0, y) * step(y, 84.0);
  float meridian = inside * graticuleLine(graticuleUtmMeridian(at), 6.0, lon, width);
  float band = y <= 76.0 ? abs(graticuleOffAt(at.base.y, at.local.y, 8.0, -80.0)) : abs(graticuleFrom(at.base.y, at.local.y, 84.0));
  band = y < -84.0 ? abs(graticuleFrom(at.base.y, at.local.y, -80.0)) : band;
  float parallel = graticuleLine(band, 8.0, lat, width);
  return max(meridian, parallel);
}

// The nautical time zones: meridians 7.5° east and west of every 15th, and the date line.
float graticuleTimeZones(GraticuleAt at, float width) {
  float lon = length(at.dLon);
  float off = min(abs(graticuleOffAt(at.base.x, at.local.x, 15.0, 7.5)), abs(graticuleOffAt(at.base.x, at.local.x, 360.0, 180.0)));
  return graticuleLine(off, 15.0, lon, width);
}

// `color` with the lines over it: latitude and longitude, then the time zones, then the
// UTM zones on top. Nothing without the globe on the Earth.
vec3 graticuleOver(vec3 color, GraticuleAt at) {
  if(!graticuleOn())
    return color;
  vec4 lines = uGraticuleLines[GRATICULE_LAT_LON];
  if(lines.x > 0.0) {
    vec4 tint = uGraticuleColors[GRATICULE_LAT_LON];
    color = mix(color, tint.rgb, tint.a * graticuleLatLon(at, lines.x));
  }
  lines = uGraticuleLines[GRATICULE_TIME_ZONES];
  if(lines.x > 0.0) {
    vec4 tint = uGraticuleColors[GRATICULE_TIME_ZONES];
    color = mix(color, tint.rgb, tint.a * graticuleTimeZones(at, lines.x));
  }
  lines = uGraticuleLines[GRATICULE_UTM];
  if(lines.x > 0.0) {
    vec4 tint = uGraticuleColors[GRATICULE_UTM];
    color = mix(color, tint.rgb, tint.a * graticuleUtm(at, lines.x));
  }
  return color;
}

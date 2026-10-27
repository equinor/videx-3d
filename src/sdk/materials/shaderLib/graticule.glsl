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

#define GRATICULE_LAT_LON 0
#define GRATICULE_UTM 1
#define GRATICULE_TIME_ZONES 2

// The lines themselves, as the SDK's grids draw them.
#include ./grid.glsl

// Where a pixel lies on the Earth: its longitude and latitude (degrees), and how much each
// changes from it to the next pixel along x and y (longitude unwrapped across 180°).
struct GraticuleAt {
  vec2 lonLat;
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
  at.dLon = vec2(0.0);
  at.dLat = vec2(0.0);
  // The same for every pixel: the derivatives below stay defined.
  if(!graticuleOn())
    return at;
  vec2 latLon = globeGeographic(p) * (180.0 / GLOBE_PI);
  at.lonLat = latLon.yx;
  vec2 dLon = vec2(dFdx(at.lonLat.x), dFdy(at.lonLat.x));
  at.dLon = dLon - 360.0 * floor(dLon / 360.0 + 0.5);
  at.dLat = vec2(dFdx(at.lonLat.y), dFdy(at.lonLat.y));
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

// Lines every `step` degrees of latitude and longitude.
float graticuleLatLonAt(GraticuleAt at, float step, float width) {
  float lon = length(at.dLon);
  float lat = length(at.dLat);
  float meridian = graticuleLine(graticuleOff(at.lonLat.x, step, 0.0), step, lon, width);
  float parallel = graticuleLine(graticuleOff(at.lonLat.y, step, 0.0), step, lat, width);
  return max(meridian, parallel);
}

// Latitude and longitude at the view's step, the same for both everywhere on screen, and
// the next finer step as it fades in (uGraticuleLatLon). Each step's lines are among the
// next finer one's.
float graticuleLatLon(GraticuleAt at, float width) {
  vec3 steps = uGraticuleLatLon;
  float cover = graticuleLatLonAt(at, steps.x, width);
  if(steps.z > 0.0)
    cover = max(cover, steps.z * graticuleLatLonAt(at, steps.y, width));
  return cover;
}

// Degrees of longitude to the nearest UTM zone's edge at `lonLat`: every 6°, but Norway's
// zone 32V reaching west to 3°E (56°N–64°N), and Svalbard's 31X, 33X, 35X and 37X edged at
// 9°, 21°, 33° and 42°E (72°N–84°N).
float graticuleUtmMeridian(vec2 lonLat) {
  float lon = lonLat.x;
  float lat = lonLat.y;
  if(lat >= 56.0 && lat < 64.0 && lon >= 0.0 && lon <= 12.0)
    return min(min(abs(lon), abs(lon - 3.0)), abs(lon - 12.0));
  if(lat >= 72.0 && lat < 84.0 && lon >= 0.0 && lon <= 42.0)
    return min(min(min(abs(lon), abs(lon - 9.0)), min(abs(lon - 21.0), abs(lon - 33.0))), abs(lon - 42.0));
  return abs(graticuleOff(lon, 6.0, 0.0));
}

// The UTM zones: their edges from 80°S to 84°N, and their latitude bands' every 8° from
// 80°S, the last (X) 12° to 84°N.
float graticuleUtm(GraticuleAt at, float width) {
  float lon = length(at.dLon);
  float lat = length(at.dLat);
  float y = at.lonLat.y;
  float inside = step(-80.0, y) * step(y, 84.0);
  float meridian = inside * graticuleLine(graticuleUtmMeridian(at.lonLat), 6.0, lon, width);
  float band = y <= 76.0 ? abs(graticuleOff(y, 8.0, -80.0)) : abs(y - 84.0);
  band = y < -84.0 ? abs(y + 80.0) : band;
  float parallel = graticuleLine(band, 8.0, lat, width);
  return max(meridian, parallel);
}

// The nautical time zones: meridians 7.5° east and west of every 15th, and the date line.
float graticuleTimeZones(GraticuleAt at, float width) {
  float lon = length(at.dLon);
  float off = min(abs(graticuleOff(at.lonLat.x, 15.0, 7.5)), 180.0 - abs(at.lonLat.x));
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

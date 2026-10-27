// The Earth as the scene draws it: the twin of the sdk's `Globe`, which keeps these
// uniforms. A sphere fixed in the scene whose cap over a disc is cut flat by the sea's level
// plane, its centre just far enough below for the plane to meet the sphere on the disc's
// edge; off (uGlobe.w 0), the level plane everywhere. In 32-bit floats: about the disc's
// centre, in forms that subtract no near-equal numbers (see documents/world.md, step 2).

uniform vec3 uGlobeUp; // the scene's up, normalised
uniform vec4 uGlobeDisc; // the disc's centre on the level plane, and its radius
uniform vec4 uGlobe; // the sphere's radius, its centre's depth below the disc's centre, the disc's radius squared, 1 while on
// The camera drawing, as `Globe.setCamera` sets it (once, on the CPU, instead of per pixel):
uniform vec4 uGlobeCamera; // its height (globeHeight), |camera − C|² − R², and |camera − C| − R
uniform vec3 uGlobeCameraUp; // up at it (globeUpAt)
uniform vec3 uGlobeCameraLook; // the up it sees the sky by (Globe.lookUp)
uniform vec4 uGlobeCameraRadial; // away from the sphere's centre through it, and how far its view runs to graze the sphere
uniform vec2 uGlobeCameraDip; // the sine and cosine of its horizon's dip below its own level

bool globeOn() {
  return uGlobe.w > 0.5;
}

// The sea's level along up.
float globeLevel() {
  return dot(uGlobeDisc.xyz, uGlobeUp);
}

// Height of `p` over the ground: over the plane above the disc, over the sphere beyond.
float globeAltitude(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  float h = dot(v, uGlobeUp);
  if(!globeOn())
    return h;
  vec3 across = v - uGlobeUp * h;
  float d2 = dot(across, across);
  if(d2 <= uGlobe.z)
    return h;
  float hs = h + uGlobe.y;
  // (|p − C|² − R²) / (|p − C| + R), the numerator about the disc's centre.
  return (d2 - uGlobe.z + h * (h + 2.0 * uGlobe.y)) / (sqrt(d2 + hs * hs) + uGlobe.x);
}

// `p`'s height along up as it is measured over the field: its altitude over the globe, from
// the sea's level. With the globe off, dot(p, up).
float globeHeight(vec3 p) {
  return globeAltitude(p) + globeLevel();
}

// The camera's height (globeHeight), from its uniform: no square root per pixel.
float globeCameraHeight() {
  return globeOn() ? uGlobeCamera.x : dot(cameraPosition, uGlobeUp);
}

// The height (globeHeight) of a view's `origin`: the camera, or a point moved straight along
// up from it over the disc, where the globe is the level plane.
float globeViewHeight(vec3 origin) {
  return globeCameraHeight() + dot(origin - cameraPosition, uGlobeUp);
}

// Up at `p`: the scene's above the disc, away from the sphere's centre beyond.
vec3 globeUpAt(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  vec3 across = v - uGlobeUp * dot(v, uGlobeUp);
  if(!globeOn() || dot(across, across) <= uGlobe.z)
    return uGlobeUp;
  return normalize(v + uGlobeUp * uGlobe.y);
}

// Up at the camera (globeUpAt), from its uniform.
vec3 globeCameraUp() {
  return globeOn() ? uGlobeCameraUp : uGlobeUp;
}

// The up the camera sees the sky by (Globe.lookUp): the scene's over the disc, up where the
// camera is far off, eased between.
vec3 globeCameraLook() {
  return globeOn() ? uGlobeCameraLook : uGlobeUp;
}

// `v` turned as `from` turns onto `to` (both unit): the shortest turn between them. Not for
// opposite ones.
vec3 globeTurnFrom(vec3 v, vec3 from, vec3 to) {
  vec3 c = cross(from, to);
  return v + cross(c, v) + cross(c, cross(c, v)) / (1.0 + dot(from, to));
}

// `v` turned as the scene's up turns onto `up` (unit): a normal or a direction of the flat
// frame, as it lies where the globe's up is `up`.
vec3 globeTurn(vec3 v, vec3 up) {
  return globeTurnFrom(v, uGlobeUp, up);
}

// The inverse: `v` where the globe's up is `up`, turned back into the flat frame.
vec3 globeUnturn(vec3 v, vec3 up) {
  return globeTurnFrom(v, up, uGlobeUp);
}

// The point `height` over the ground at world X/Z `xz`: over the disc, the level plane's;
// beyond, the plane's point carried along the line from the sphere's centre onto the
// sphere, and `height` along up there.
vec3 globePlace(vec2 xz, float height) {
  vec3 p = vec3(xz.x, 0.0, xz.y);
  p += uGlobeUp * (globeLevel() - dot(p, uGlobeUp));
  vec3 v = p - uGlobeDisc.xyz;
  float d2 = dot(v, v);
  if(!globeOn() || d2 <= uGlobe.z)
    return p + uGlobeUp * height;
  float s = uGlobe.y;
  float q = sqrt(d2 + s * s);
  // (R + height) / q − 1, with R − q written as (r² − d²) / (R + q).
  float k = (height + (uGlobe.z - d2) / (uGlobe.x + q)) / q;
  return uGlobeDisc.xyz + v + v * k + uGlobeUp * (s * k);
}

// The map point under `p`: where the line from the sphere's centre through it meets the
// level plane, which globePlace carries back. Under the disc, straight down.
vec3 globeFoot(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  float h = dot(v, uGlobeUp);
  vec3 across = v - uGlobeUp * h;
  if(!globeOn() || dot(across, across) <= uGlobe.z)
    return uGlobeDisc.xyz + across;
  return uGlobeDisc.xyz + across * (uGlobe.y / (h + uGlobe.y));
}

// On the Earth (with a frame, `Globe.setFrame`): uniform vec3s true east and north at the
// disc's centre, and the conformal sphere's latitude there.
uniform vec3 uGlobeEast;
uniform vec3 uGlobeNorth;
uniform vec4 uGlobeSphere; // sin χ₀, cos χ₀, n, 1 with a frame

float globeHaversine(float angle) {
  float sine = sin(0.5 * angle);
  return sine * sine;
}

// The direction from the sphere's centre at `offset` (Δχ, ΔΛ: `Globe.sphereOffset`),
// about the disc's centre: its east, north and up parts (x, y, z), and how far up falls
// short of 1 (w), all written so nothing near-equal is subtracted near it.
vec4 globeSphereDirection(vec2 offset) {
  float sinChi0 = uGlobeSphere.x;
  float cosChi0 = uGlobeSphere.y;
  float cosChi = cosChi0 * cos(offset.x) - sinChi0 * sin(offset.x);
  float havLambda = globeHaversine(offset.y);
  float below = 2.0 * (globeHaversine(offset.x) + cosChi * cosChi0 * havLambda);
  return vec4(cosChi * sin(offset.y), sin(offset.x) + 2.0 * cosChi * sinChi0 * havLambda, 1.0 - below, below);
}

// The point `height` over the ground at `offset` (Δχ, ΔΛ: `Globe.sphereOffset`): the twin
// of `Globe.geodetic`. On the sphere, along the line from its centre; over the disc, where
// that line meets the level plane. Off, the sphere laid flat about the disc's centre
// (stereographically), with nothing to curve.
vec3 globeGeodetic(vec2 offset, float height) {
  vec4 d = globeSphereDirection(offset);
  vec3 c = uGlobeDisc.xyz;
  vec3 across = d.x * uGlobeEast + d.y * uGlobeNorth;
  if(!globeOn())
    return c + across * (2.0 * uGlobe.x / (1.0 + d.z)) + uGlobeUp * height;
  float R = uGlobe.x;
  float s = uGlobe.y;
  float reach = s / d.z;
  if(d.z > 0.0 && reach * reach * dot(d.xy, d.xy) <= uGlobe.z)
    return c + across * reach + uGlobeUp * height;
  // R (e, n, u − 1) + (R − s) up about the disc's centre, then `height` along up there.
  float lift = uGlobe.z / (R + s) - R * d.w;
  return c + across * (R + height) + uGlobeUp * (lift + height * d.z);
}

// True east where `offset` lies on the sphere (unit): along its parallel, toward growing
// longitude.
vec3 globeGeodeticEast(vec2 offset) {
  float sinChi0 = uGlobeSphere.x;
  float cosChi0 = uGlobeSphere.y;
  float s = sin(offset.y);
  return cos(offset.y) * uGlobeEast + (sinChi0 * s) * uGlobeNorth - (cosChi0 * s) * uGlobeUp;
}

// The offset (Δχ, ΔΛ) on the sphere of the ground under `p`, as `globeGeodetic` places it:
// its inverse, written about the disc's centre so it holds near the field in 32-bit floats.
vec2 globeSphereOffset(vec3 p) {
  vec3 v = p - uGlobeDisc.xyz;
  float h = dot(v, uGlobeUp);
  vec3 across = v - uGlobeUp * h;
  float e = dot(across, uGlobeEast);
  float n = dot(across, uGlobeNorth);
  float u = uGlobe.y + (dot(across, across) <= uGlobe.z ? 0.0 : h);
  float sinChi0 = uGlobeSphere.x;
  float cosChi0 = uGlobeSphere.y;
  // The direction's latitude about the disc's centre's, from its parts: sin and cos of
  // Δχ, scaled alike, with its distance from the axis `w` and its part along it `q`.
  float q = u * cosChi0 - n * sinChi0;
  float w = sqrt(e * e + q * q);
  float sinD = n - sinChi0 * e * e / max(q + w, 1e-30);
  float cosD = n * sinChi0 * cosChi0 + u * sinChi0 * sinChi0 + w * cosChi0;
  return vec2(atan(sinD, cosD), atan(e, q));
}

// Where the disc's centre lies on the Earth: its longitude (radians), and the conformal
// sphere's ½ ln c.
uniform vec2 uGlobeLocation;

// WGS84's first eccentricity, and π.
#define GLOBE_WGS84_E 0.0818191908426215
#define GLOBE_PI 3.141592653589793

// The latitude and longitude (WGS84, radians; longitude in [−π, π)) at `offset` (Δχ, ΔΛ:
// `Globe.sphereOffset`), to metres in 32-bit floats (a kilometre or two at the poles).
// Needs a frame.
vec2 globeGeographicAt(vec2 offset) {
  float n = uGlobeSphere.z;
  float sinChi = clamp(uGlobeSphere.x * cos(offset.x) + uGlobeSphere.y * sin(offset.x), -0.9999999, 0.9999999);
  // The conformal latitude's inverse (conformal-sphere.ts, geodeticLatitude), in 3 steps.
  float q = (atanh(sinChi) - uGlobeLocation.y) / n;
  float sinPhi = tanh(q);
  for(int i = 0; i < 3; i++)
    sinPhi = tanh(q + GLOBE_WGS84_E * atanh(GLOBE_WGS84_E * sinPhi));
  // Δλ + (n − 1) sin Δλ, undone to first order: (n − 1)² is a few parts in 10⁸.
  float lambda = uGlobeLocation.x + offset.y - (n - 1.0) * sin(offset.y);
  lambda -= 2.0 * GLOBE_PI * floor((lambda + GLOBE_PI) / (2.0 * GLOBE_PI));
  return vec2(asin(sinPhi), lambda);
}

// The latitude and longitude (radians) of the ground under `p`: the twin of
// `Globe.geographic`. Needs a frame.
vec2 globeGeographic(vec3 p) {
  return globeGeographicAt(globeSphereOffset(p));
}

// Where a view from `origin` along `dir` (unit) meets the ground `below` lower — a seabed:
// the plane `below` down over the disc, the sphere of radius R − below beyond: how far
// along it, and 1 if it misses. A miss, or a view from inside the sphere, reports where the
// ray passes closest to the sphere's centre, ahead, so the derivatives stay continuous; a
// ray through the cut-off cap, over the field and below its top, leaves the sphere again
// over the plane and meets nothing.
vec2 globeReach(vec3 origin, vec3 dir, float below) {
  vec3 v = origin - uGlobeDisc.xyz;
  float up = dot(v, uGlobeUp);
  float h = up + below;
  float fall = -dot(dir, uGlobeUp);
  if(!globeOn())
    return vec2(h / max(abs(fall), 1e-6), h > 0.0 && fall > 0.0 ? 0.0 : 1.0);
  float R = uGlobe.x;
  float s = uGlobe.y;
  float r2 = uGlobe.z;
  // Where the lowered plane meets the lowered sphere, squared: a hair inside the disc.
  float rho2 = r2 - 2.0 * below * r2 / (R + s);
  if(h > 0.0 && fall > 0.0) {
    float t = h / fall;
    vec3 at = v + dir * t;
    at -= uGlobeUp * dot(at, uGlobeUp);
    if(dot(at, at) <= rho2)
      return vec2(t, 0.0);
  }
  // |origin − C|² − (R − below)², about the disc's centre.
  float b = dot(v, dir) + s * dot(dir, uGlobeUp);
  float outside = dot(v, v) + 2.0 * s * up - r2 + below * (2.0 * R - below);
  float closest = max(-b, 0.0);
  float d = b * b - outside;
  if(outside <= 0.0 || b >= 0.0 || d < 0.0)
    return vec2(closest, 1.0);
  float t = outside / (-b + sqrt(d));
  vec3 at = v + dir * t;
  float over = dot(at, uGlobeUp) + below;
  at -= uGlobeUp * dot(at, uGlobeUp);
  if(over > 0.0 && dot(at, at) <= rho2)
    return vec2(closest, 1.0);
  return vec2(t, 0.0);
}

// The sine of the elevation, from the level of `look` (unit), of the horizon seen from
// `origin` along the bearing of `dir`: where a view grazes the sphere, about the origin's
// own up; or, from low over the field, where it leaves the disc's plane. 0 with the globe
// off, or from on or under the plane inside the sphere.
// From what it takes of the origin: `v` its offset from the disc's centre, `n` away from
// the sphere's centre through it, `outside` |origin − C|² − R², `reach` √outside and `dip`
// the sine and cosine of its horizon's dip.
float globeHorizonFrom(vec3 v, vec3 n, float outside, float reach, vec2 dip, vec3 dir, vec3 look) {
  float up = dot(v, uGlobeUp);
  vec3 level = dir - n * dot(dir, n);
  float l2 = dot(level, level);
  // Straight up or down: the horizon is the same all round.
  vec3 way = l2 > 1e-12 ? level * inversesqrt(l2) : normalize(cross(n, abs(n.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
  // Outside the sphere, the view that grazes it.
  if(outside > 0.0) {
    vec3 graze = way * dip.y - n * dip.x;
    // Unless it grazes the cut-off cap, over the field.
    vec3 at = v + graze * reach;
    float over = dot(at, uGlobeUp);
    at -= uGlobeUp * over;
    if(over <= 0.0 || dot(at, at) > uGlobe.z)
      return dot(graze, look);
  }
  if(up <= 0.0)
    return 0.0;
  // Where the view along the bearing leaves the disc's plane. From the scene's level, and
  // by how far `look` tilts from it: nothing over the disc, where it is the scene's up.
  vec3 across = v - uGlobeUp * up;
  vec3 flatWay = way - uGlobeUp * dot(way, uGlobeUp);
  flatWay *= inversesqrt(max(dot(flatWay, flatWay), 1e-12));
  float a = dot(across, flatWay);
  float run = -a + sqrt(max(a * a - dot(across, across) + uGlobe.z, 0.0));
  float tilt = dot(flatWay * run - uGlobeUp * up, look - uGlobeUp);
  return (tilt - up) * inversesqrt(max(run * run + up * up, 1e-12));
}

// From the scene's level.
float globeHorizon(vec3 origin, vec3 dir) {
  if(!globeOn())
    return 0.0;
  vec3 v = origin - uGlobeDisc.xyz;
  float s = uGlobe.y;
  // |origin − C|² − R².
  float outside = dot(v, v) + 2.0 * s * dot(v, uGlobeUp) - uGlobe.z;
  float reach = sqrt(max(outside, 0.0));
  float sinDip = reach / sqrt(uGlobe.x * uGlobe.x + max(outside, 0.0));
  vec2 dip = vec2(sinDip, sqrt(max(1.0 - sinDip * sinDip, 0.0)));
  return globeHorizonFrom(v, normalize(v + uGlobeUp * s), outside, reach, dip, dir, uGlobeUp);
}

// The same from the camera, from its uniforms, and from the level it sees the sky by
// (globeCameraLook): far off, the dip all round.
float globeCameraHorizon(vec3 dir) {
  if(!globeOn())
    return 0.0;
  return globeHorizonFrom(cameraPosition - uGlobeDisc.xyz, uGlobeCameraRadial.xyz, uGlobeCamera.y, uGlobeCameraRadial.w, uGlobeCameraDip, dir, uGlobeCameraLook);
}

// How far below the origin's own altitude over the sphere the lowest point of a view from
// it along `dir` (unit) lies: 0 for one rising from it. From `v` its offset from the disc's
// centre, `outside` |origin − C|² − R² and `above` its altitude over the sphere.
float globeDescentFrom(vec3 v, float outside, float above, vec3 dir) {
  float b = dot(v, dir) + uGlobe.y * dot(dir, uGlobeUp);
  if(b >= 0.0)
    return 0.0;
  float R = uGlobe.x;
  float lowest = outside - b * b;
  return above - lowest / (sqrt(max(R * R + lowest, 0.0)) + R);
}

float globeDescent(vec3 origin, vec3 dir) {
  if(!globeOn())
    return 0.0;
  vec3 v = origin - uGlobeDisc.xyz;
  float R = uGlobe.x;
  float outside = dot(v, v) + 2.0 * uGlobe.y * dot(v, uGlobeUp) - uGlobe.z;
  return globeDescentFrom(v, outside, outside / (sqrt(max(R * R + outside, 0.0)) + R), dir);
}

// The same from the camera, from its uniforms.
float globeCameraDescent(vec3 dir) {
  if(!globeOn())
    return 0.0;
  return globeDescentFrom(cameraPosition - uGlobeDisc.xyz, uGlobeCamera.y, uGlobeCamera.z, dir);
}

// How much higher than the camera a point `dist` along `dir` (unit) from it lies: over the
// sphere about the camera, to second order in `dist` over the camera's distance from its
// centre — under 1% of the rise off at 1000 km, and over the disc the cap's few metres —
// enough for what the air does, with no square root. Flat with the globe off.
float globeCameraRise(vec3 dir, float dist) {
  if(!globeOn())
    return dot(dir, uGlobeUp) * dist;
  float mu = dot(dir, uGlobeCameraRadial.xyz);
  return dist * (mu + 0.5 * dist * (1.0 - mu * mu) / (uGlobe.x + uGlobeCamera.z));
}

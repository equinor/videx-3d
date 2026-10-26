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

// `v` turned as the scene's up turns onto `up` (unit): a normal or a direction of the flat
// frame, as it lies where the globe's up is `up`.
vec3 globeTurn(vec3 v, vec3 up) {
  vec3 c = cross(uGlobeUp, up);
  return v + cross(c, v) + cross(c, cross(c, v)) / (1.0 + dot(uGlobeUp, up));
}

// The inverse: `v` where the globe's up is `up`, turned back into the flat frame.
vec3 globeUnturn(vec3 v, vec3 up) {
  vec3 c = cross(up, uGlobeUp);
  return v + cross(c, v) + cross(c, cross(c, v)) / (1.0 + dot(uGlobeUp, up));
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

// The sine of the elevation, from the scene's level, of the horizon seen from `origin`
// along the bearing of `dir`: where a view grazes the sphere, about the origin's own up;
// or, from low over the field, where it leaves the disc's plane. 0 with the globe off, or
// from on or under the plane inside the sphere.
// From what it takes of the origin: `v` its offset from the disc's centre, `n` away from
// the sphere's centre through it, `outside` |origin − C|² − R², `reach` √outside and `dip`
// the sine and cosine of its horizon's dip.
float globeHorizonFrom(vec3 v, vec3 n, float outside, float reach, vec2 dip, vec3 dir) {
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
      return dot(graze, uGlobeUp);
  }
  if(up <= 0.0)
    return 0.0;
  // Where the view along the bearing leaves the disc's plane.
  vec3 across = v - uGlobeUp * up;
  vec3 flatWay = way - uGlobeUp * dot(way, uGlobeUp);
  flatWay *= inversesqrt(max(dot(flatWay, flatWay), 1e-12));
  float a = dot(across, flatWay);
  float run = -a + sqrt(max(a * a - dot(across, across) + uGlobe.z, 0.0));
  return -up * inversesqrt(max(run * run + up * up, 1e-12));
}

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
  return globeHorizonFrom(v, normalize(v + uGlobeUp * s), outside, reach, dip, dir);
}

// The same from the camera, from its uniforms.
float globeCameraHorizon(vec3 dir) {
  if(!globeOn())
    return 0.0;
  return globeHorizonFrom(cameraPosition - uGlobeDisc.xyz, uGlobeCameraRadial.xyz, uGlobeCamera.y, uGlobeCameraRadial.w, uGlobeCameraDip, dir);
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

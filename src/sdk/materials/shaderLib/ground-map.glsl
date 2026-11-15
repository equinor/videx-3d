// The ground's height about the Earth, coarse (GroundMap): metres over the sea, the seabed's
// below it. A map of the whole Earth (a cube map in the frame fixed on the Earth, its height in
// a), a finer one about the camera and a finer one still close to it (squares on the planes
// touching the Earth at their middles, seen from its centre, their height in g). Included once.
#ifndef GROUND_MAP_GLSL
#define GROUND_MAP_GLSL

uniform samplerCube uGroundEarth;
// The world's directions into the frame fixed on the Earth.
uniform mat3 uGroundEarthFromWorld;
uniform sampler2D uGroundNear;
// A point from the Earth's centre (world) into the map's square: x and y across it, as shares
// of its reach, times z, how far along its middle's direction.
uniform mat3 uGroundNearFromWorld;
uniform sampler2D uGroundFine;
uniform mat3 uGroundFineFromWorld;
// The globe's disc's centre on the sea's level (world), and how far below it the Earth's centre
// lies, along uGroundUp, the up there: the Earth's centre, kept apart so a point near the field
// is taken from it without losing its precision.
uniform vec4 uGroundCentre;
uniform vec3 uGroundUp;
// Which maps are drawn: x the Earth's, y the one about the camera, z the one close to it.
uniform vec4 uGround;

// The height a map about a point (`map`, `fromWorld`) gives at `q` (from the Earth's centre),
// and how far it holds (`weight`: 1 inside, easing to nothing toward its sides).
float groundMapAbout(sampler2D map, mat3 fromWorld, vec3 q, out float weight) {
  vec3 s = fromWorld * q;
  weight = 0.0;
  if(s.z <= 0.0)
    return 0.0;
  vec2 across = s.xy / s.z;
  float edge = max(abs(across.x), abs(across.y));
  weight = 1.0 - smoothstep(0.85, 1.0, edge);
  return textureLod(map, across * 0.5 + 0.5, 0.0).g;
}

// The ground's height under `world` (metres over the sea), from the finest of its maps there;
// `covered` 1 where one is drawn, else 0 (and the height 0); `cell` how far apart, in metres,
// the texels it was read from lie there: what a slope may stray from it by.
float groundMapHeight(vec3 world, out float covered, out float cell) {
  covered = 0.0;
  cell = 0.0;
  if(uGround.x + uGround.y + uGround.z < 0.5)
    return 0.0;
  vec3 q = (world - uGroundCentre.xyz) + uGroundUp * uGroundCentre.w;
  float radius = length(q);
  float height = 0.0;
  if(uGround.x > 0.5) {
    height = textureLod(uGroundEarth, uGroundEarthFromWorld * q, 0.0).a;
    covered = 1.0;
    // A face spans a right angle.
    cell = radius * 1.5707963 / float(textureSize(uGroundEarth, 0).x);
  }
  float weight;
  if(uGround.y > 0.5) {
    float near = groundMapAbout(uGroundNear, uGroundNearFromWorld, q, weight);
    if(weight > 0.0) {
      // Its rows across are its reach's inverse: the square spans twice the reach.
      float nearCell = 2.0 * radius / (length(vec3(uGroundNearFromWorld[0][0], uGroundNearFromWorld[1][0], uGroundNearFromWorld[2][0])) * float(textureSize(uGroundNear, 0).x));
      height = covered > 0.5 ? mix(height, near, weight) : near;
      cell = covered > 0.5 ? mix(cell, nearCell, weight) : nearCell;
      covered = 1.0;
    }
  }
  if(uGround.z > 0.5) {
    float fine = groundMapAbout(uGroundFine, uGroundFineFromWorld, q, weight);
    if(weight > 0.0) {
      float fineCell = 2.0 * radius / (length(vec3(uGroundFineFromWorld[0][0], uGroundFineFromWorld[1][0], uGroundFineFromWorld[2][0])) * float(textureSize(uGroundFine, 0).x));
      height = covered > 0.5 ? mix(height, fine, weight) : fine;
      cell = covered > 0.5 ? mix(cell, fineCell, weight) : fineCell;
      covered = 1.0;
    }
  }
  return height;
}

float groundMapHeight(vec3 world, out float covered) {
  float cell;
  return groundMapHeight(world, covered, cell);
}

#endif

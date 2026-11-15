// The ground under a Scenery (scenery-ground.ts): from a grid of longitude and latitude (a
// relief's, GeoReliefGrid), drawn into the frame fixed on the Earth (z toward the conformal
// sphere's north pole, x toward its longitude 0): a face of the Earth's cube map (uTerrainMode
// 0: height over the sea never under its level, r, which the clouds meet; its slope east and
// north, g and b; the height, a, the seabed's below the sea), or a map about the camera (1: the
// height never under the sea's level, r; the height, g), a square on the plane touching the
// Earth at its middle, seen from the Earth's centre.

#include ./cloud-map-noise.glsl
#include ../../../sdk/materials/shaderLib/precise-angles.glsl

// Heights, metres (R32F, read texel by texel); its columns and rows.
uniform highp sampler2D uTerrainGrid;
uniform vec2 uTerrainGridSize;
// Its north-west node's longitude and latitude, and degrees between nodes.
uniform vec3 uTerrainGridPlace;
// The geodetic latitude (radians) at conformal latitudes from −90° to 90° in even steps: the
// globe's conformal sphere, whose latitudes the frame's are.
uniform float uTerrainLatitudes[TERRAIN_LATITUDES + 1];
// The disc's centre's longitude (radians), and the sphere's longitudes' scale less 1 (n − 1).
uniform vec2 uTerrainLongitude;
uniform int uTerrainMode;
// The map about the camera: its middle, east and north there (fixed on the Earth), and how
// far it reaches from its middle to its sides, as a tangent.
uniform vec3 uTerrainNearCentre;
uniform vec3 uTerrainNearEast;
uniform vec3 uTerrainNearNorth;
uniform float uTerrainNearReach;
// The Earth's radius, metres: for the slopes.
uniform float uTerrainRadius;

// The geodetic latitude (radians) at conformal latitude `chi`.
float terrainLatitude(float chi) {
  float x = clamp((chi / MAP_PI + 0.5) * float(TERRAIN_LATITUDES), 0.0, float(TERRAIN_LATITUDES));
  int i = int(min(floor(x), float(TERRAIN_LATITUDES - 1)));
  return mix(uTerrainLatitudes[i], uTerrainLatitudes[i + 1], x - float(i));
}

// The grid's height at node `g` (columns east, rows south), bilinear, the seabed's below the
// sea. Its columns wrap where they go round the Earth (the last is the first again).
float terrainGridHeight(vec2 g) {
  vec2 size = uTerrainGridSize;
  float span = (size.x - 1.0) * uTerrainGridPlace.z;
  bool wraps = span >= 359.999;
  g.y = clamp(g.y, 0.0, size.y - 1.0);
  if(!wraps)
    g.x = clamp(g.x, 0.0, size.x - 1.0);
  vec2 f0 = floor(g);
  vec2 f = g - f0;
  int period = int(size.x) - 1;
  int x0 = int(f0.x);
  int x1 = x0 + 1;
  if(wraps) {
    x0 = ((x0 % period) + period) % period;
    x1 = ((x1 % period) + period) % period;
  } else
    x1 = min(x1, int(size.x) - 1);
  int y0 = int(f0.y);
  int y1 = min(y0 + 1, int(size.y) - 1);
  float a = texelFetch(uTerrainGrid, ivec2(x0, y0), 0).r;
  float b = texelFetch(uTerrainGrid, ivec2(x1, y0), 0).r;
  float c = texelFetch(uTerrainGrid, ivec2(x0, y1), 0).r;
  float d = texelFetch(uTerrainGrid, ivec2(x1, y1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The same, never under the sea's level: what the clouds meet.
float terrainGridAt(vec2 g) {
  return max(terrainGridHeight(g), 0.0);
}

// Where `dir` (unit, fixed on the Earth) lies on the grid, in nodes, and its geodetic
// latitude (radians, z). Its angles by atanPrecise: the GPU's asin and atan drew the maps
// 160 m off (precise-angles.glsl).
vec3 terrainGridPlace(vec3 dir) {
  float chi = atanPrecise(dir.z, length(dir.xy));
  float latitude = terrainLatitude(chi);
  // The sphere's longitude from the disc's centre's, then the Earth's (sphereLongitude's
  // inverse, to the square of n − 1).
  float delta = atanPrecise(dir.y, dir.x) - uTerrainLongitude.x;
  delta = mod(delta + MAP_PI, 2.0 * MAP_PI) - MAP_PI;
  float longitude = degrees(uTerrainLongitude.x + delta - uTerrainLongitude.y * sin(delta));
  float step = uTerrainGridPlace.z;
  float span = (uTerrainGridSize.x - 1.0) * step;
  float middle = uTerrainGridPlace.x + 0.5 * span;
  float east = mod(longitude - middle + 180.0, 360.0) - 180.0 + 0.5 * span;
  return vec3(east / step, (uTerrainGridPlace.y - degrees(latitude)) / step, latitude);
}

void main() {
  vec2 st = gl_FragCoord.xy / uMapSize * 2.0 - 1.0;
  if(uTerrainMode == 1) {
    vec3 dir = normalize(uTerrainNearCentre + (uTerrainNearEast * st.x + uTerrainNearNorth * st.y) * uTerrainNearReach);
    float height = terrainGridHeight(terrainGridPlace(dir).xy);
    gl_FragColor = vec4(max(height, 0.0), height, 0.0, 1.0);
    return;
  }
  vec3 dir = normalize(mapDirection(st));
  vec3 g = terrainGridPlace(dir);
  float height = terrainGridHeight(g.xy);
  float h = max(height, 0.0);
  // Its slope over two nodes either way: dimensionless, east and north.
  float node = radians(uTerrainGridPlace.z) * uTerrainRadius;
  float east = (terrainGridAt(g.xy + vec2(1.0, 0.0)) - terrainGridAt(g.xy - vec2(1.0, 0.0))) / (2.0 * node * max(cos(g.z), 0.05));
  float north = (terrainGridAt(g.xy - vec2(0.0, 1.0)) - terrainGridAt(g.xy + vec2(0.0, 1.0))) / (2.0 * node);
  gl_FragColor = vec4(h, east, north, height);
}

// The void's walls' shape (SkyAbyssWalls): where their rock stands about the stage, as their
// mesh lays it (skyAbyssWallVertex), a grid by the way round their outline and the depth
// below the lid. Free of derivatives, for the vertex shader too. Needs uSkyUp, uSkyEast,
// uSkyNorth and uSkyAbyssLevel declared.

#include ../../../sdk/materials/shaderLib/sdf-functions.glsl

// The walls of a hollow about the stage (uSkyStageBox): x how far out from its edge they
// stand at the lid, y how strongly they show, z the distance they haze out over, w the size
// of their rock's features (world units).
uniform vec4 uSkyAbyssWalls;
uniform vec4 uSkyAbyssWallShape; // how far their rock stands in and out; how far they lean out per unit of depth; the depth below the lid they are black by; how far their outline wanders
uniform sampler2D uSkyAbyssWallRock; // the baked cliffs (sky-cliffs-fragment.glsl): R how far they stand out, GB their rock's relief, A its creases
uniform vec4 uSkyStageBox; // the stage's rectangle: its centre and half extents, world X/Z
uniform vec3 uSkyAbyssWallGrid; // their mesh's columns round, its rows down, and how deep it goes (skyAbyssWallGrid)
uniform vec2 uSkyAbyssWallSand; // how thick the sand over their rock is below the lid (0 for none); how bright the glow over the stage, 0 to 1
// Features across one tile of the cliffs.
#define SKY_ABYSS_CLIFF_TILE 8.0
// Tiles of the rock's relief to one of the cliffs'.
#define SKY_ABYSS_RELIEF_REPEAT 4.0
// How many mip levels coarser the cliffs are read at under the sand: it drapes their large shape alone.
#define SKY_ABYSS_SAND_LOD 3.0

// Where `p` (world) lies in the stage's plane, from its centre.
vec2 skyAbyssWallPlane(vec3 p) {
  return vec2(dot(p, uSkyEast), -dot(p, uSkyNorth)) - uSkyStageBox.xy;
}

// How far short of where the walls' rock can stand `p` (`h` its height) is, with all its
// wander and cliffs: above 0 surely in the hollow. Cheap: no lookups, nor the way round.
float skyAbyssWallGap(vec3 p, float h) {
  float inner = uSkyAbyssWalls.x + uSkyAbyssWallShape.y * max(uSkyAbyssLevel - h, 0.0) - uSkyAbyssWallShape.w - uSkyAbyssWallShape.x;
  return inner - sdfBox(skyAbyssWallPlane(p), uSkyStageBox.zw);
}

// The whole way round the walls' outline: the stage's rectangle, its corners taken at
// radius uSkyAbyssWalls.x.
float skyAbyssWallLap() {
  vec2 b = uSkyStageBox.zw;
  return 4.0 * (b.x + b.y + 1.5707963 * uSkyAbyssWalls.x);
}

// How far round the stage's rectangle `q` (from its centre) lies, from the middle of its +X
// side, its corners taken at radius `r`; and the whole way round.
vec2 skyAbyssWallAround(vec2 q, float r) {
  vec2 b = uSkyStageBox.zw;
  float quarter = 1.5707963 * r;
  vec2 d = abs(q) - b;
  float s;
  if(d.x > 0.0 && d.y > 0.0) {
    vec2 v = q - b * sign(q);
    if(q.x > 0.0 && q.y > 0.0)
      s = b.y + atan(v.y, v.x) * r;
    else if(q.y > 0.0)
      s = b.y + quarter + 2.0 * b.x + atan(-v.x, v.y) * r;
    else if(q.x < 0.0)
      s = 3.0 * b.y + 2.0 * quarter + 2.0 * b.x + atan(-v.y, -v.x) * r;
    else
      s = 3.0 * b.y + 3.0 * quarter + 4.0 * b.x + atan(v.x, -v.y) * r;
  } else if(d.x > d.y) {
    s = q.x > 0.0 ? q.y : 2.0 * b.y + 2.0 * quarter + 2.0 * b.x - q.y;
  } else {
    s = q.y > 0.0 ? b.y + quarter + b.x - q.x : 3.0 * b.y + 3.0 * quarter + 3.0 * b.x + q.x;
  }
  float around = 4.0 * (b.x + b.y + quarter);
  return vec2(mod(s, around), around);
}

// The point `d` out from the stage's rectangle `s` round it, from its centre: the inverse
// of skyAbyssWallAround at r = uSkyAbyssWalls.x. Four alike quarters, each from the middle
// of a side round a corner to the middle of the next, turned a quarter each.
vec2 skyAbyssWallOutline(float s, float d) {
  vec2 b = uSkyStageBox.zw;
  float r = uSkyAbyssWalls.x;
  float quarter = 1.5707963 * r;
  float part = b.x + b.y + quarter;
  float k = floor(s / part);
  float t = s - k * part;
  k = mod(k, 4.0);
  vec2 e = mod(k, 2.0) < 0.5 ? b : b.yx;
  vec2 q;
  if(t < e.y) {
    q = vec2(e.x + d, t);
  } else if(t < e.y + quarter) {
    float a = (t - e.y) / r;
    q = e + d * vec2(cos(a), sin(a));
  } else {
    q = vec2(e.x - (t - e.y - quarter), e.y + d);
  }
  if(k < 0.5)
    return q;
  if(k < 1.5)
    return vec2(-q.y, q.x);
  if(k < 2.5)
    return -q;
  return vec2(q.y, -q.x);
}

// How far the walls' outline wanders out, -1 to 1, a `share` of the way round it and `depth`
// below the lid: a few long waves, whole numbers of them round, drifting with depth.
float skyAbyssWallWander(float share, float depth) {
  float a = 6.2831853 * share;
  float k = depth / uSkyAbyssWalls.x;
  return 0.45 * sin(2.0 * a + 0.9 + 0.35 * k) + 0.3 * sin(3.0 * a + 2.3 - 0.5 * k) +
    0.17 * sin(5.0 * a + 4.1 + 0.7 * k) + 0.08 * sin(8.0 * a + 0.4 - 0.9 * k);
}

// How far out the walls' middle stands from the stage's edge, a `share` of the way round
// and `depth` below the lid: uSkyAbyssWalls.x at the lid, wandering in and out by
// uSkyAbyssWallShape.w and leaning out with depth.
float skyAbyssWallMiddle(float share, float depth) {
  return uSkyAbyssWalls.x + uSkyAbyssWallShape.y * depth + uSkyAbyssWallShape.w * skyAbyssWallWander(share, depth);
}

// The width of a texel of the cliffs, in world units.
float skyAbyssWallTexel() {
  return uSkyAbyssWalls.w * SKY_ABYSS_CLIFF_TILE / float(textureSize(uSkyAbyssWallRock, 0).x);
}

// How far the cliffs stand out, 0 to 1, `s` round their outline (of `around`) and `depth`
// below the lid, read at `lod`.
float skyAbyssWallCliff(float s, float around, float depth, float lod) {
  float tile = uSkyAbyssWalls.w * SKY_ABYSS_CLIFF_TILE;
  float tiles = max(floor(around / tile + 0.5), 1.0);
  return textureLod(uSkyAbyssWallRock, vec2(s / around * tiles, depth / tile), lod).x;
}

// The depth below the lid of the mesh's row `j`: rows closer together near the lid.
float skyAbyssWallRowDepth(float j) {
  float k = j / uSkyAbyssWallGrid.y;
  return uSkyAbyssWallGrid.z * k * k;
}

// The cliffs' mip level the mesh's row `j` reads them at: as coarse as its cells are wide.
float skyAbyssWallRowLod(float j) {
  float rows = uSkyAbyssWallGrid.y;
  float across = skyAbyssWallLap() / uSkyAbyssWallGrid.x;
  float down = uSkyAbyssWallGrid.z * (2.0 * j + 1.0) / (rows * rows);
  return log2(max(max(across, down) / skyAbyssWallTexel(), 1.0));
}

// How thick the sand over their rock is a `share` of the way round their outline:
// uSkyAbyssWallSand.x, a little more or less in a few long waves, whole numbers of them round.
float skyAbyssWallSandDepth(float share) {
  float a = 6.2831853 * share;
  return uSkyAbyssWallSand.x * (1.0 + 0.2 * sin(3.0 * a + 1.3) + 0.1 * sin(7.0 * a + 4.2));
}

// How much of the walls is rock rather than sand, 0 to 1, `depth` below the lid a `share` of
// the way round: none in the sand, all below it, eased across their contact; all without sand.
float skyAbyssWallRockShare(float depth, float share) {
  float sand = skyAbyssWallSandDepth(share);
  return uSkyAbyssWallSand.x > 0.0 ? smoothstep(0.8 * sand, 1.2 * sand, depth) : 1.0;
}

// The mesh's vertex in column `ij.x` round the outline and row `ij.y` down from the lid
// (world, xyz), pushed out to the rock's face, and how far that stands out of the walls'
// middle (w). Their cliffs stand in and out of the middle by uSkyAbyssWallShape.x. In the
// sand the face follows the rock's top, read coarser, so it drapes the rock's large shape.
vec4 skyAbyssWallVertex(vec2 ij) {
  float around = skyAbyssWallLap();
  float s = mod(ij.x / uSkyAbyssWallGrid.x * around, around);
  float depth = skyAbyssWallRowDepth(ij.y);
  float lod = skyAbyssWallRowLod(ij.y);
  float cliff = skyAbyssWallCliff(s, around, depth, lod);
  float share = s / around;
  float rock = skyAbyssWallRockShare(depth, share);
  if(rock < 1.0) {
    float top = 1.2 * skyAbyssWallSandDepth(share);
    cliff = mix(skyAbyssWallCliff(s, around, max(depth, top), lod + SKY_ABYSS_SAND_LOD), cliff, rock);
  }
  float off = uSkyAbyssWallShape.x * (1.0 - 2.0 * cliff);
  vec2 q = skyAbyssWallOutline(s, max(skyAbyssWallMiddle(share, depth) + off, 0.0)) + uSkyStageBox.xy;
  return vec4(uSkyEast * q.x - uSkyNorth * q.y + uSkyUp * (uSkyAbyssLevel - depth), off);
}

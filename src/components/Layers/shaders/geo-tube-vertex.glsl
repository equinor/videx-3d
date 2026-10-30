// GeoTubes: lines in longitude and latitude drawn as tubes, one instance a
// segment between two nodes, each ring placed here (tube-segment.glsl): on the globe where
// its node's latitude and longitude lie (globeGeodetic), on the ground — the relief drawn
// under it with GEO_TUBE_DRAPE (relief-tile-height.glsl), else the ground found when the
// nodes were made — lifted off it by its free span and then by its own radius, so it rests
// on the ground. Its radius is its diameter as built, exaggerated, never under
// `uTubeMinPixels` across on screen. Rings at a shared node are built from the same node's
// data in both segments, so the tube runs on without a seam.
// ⚠️ Assumes the default `up` (+Y).

#include <common>
#include <logdepthbuf_pars_vertex>
#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/tube-segment.glsl
#include ./geo-reveal.glsl
#ifdef GEO_TUBE_DRAPE
#include ./relief-tile-height.glsl
#endif

uniform vec2 resolution;
uniform float uTubeExaggeration;
uniform float uTubeMinPixels;
// Two texels a feature: its colour and opacity; its diameter as built (x).
uniform highp sampler2D uTubeStyles;
uniform float uTubeStylesWidth;

attribute vec3 vertex;
// Per node, A the segment's start and B its end: its place on the conformal sphere from the
// globe's disc's centre (Globe.sphereOffset), its lift off the ground (a free span), and the
// ground found when it was made (where no relief tile is drawn under it).
attribute vec4 tubeNodeA;
attribute vec4 tubeNodeB;
// Its way along the line, east, north and up; and 1 where it ends a part (A: no segment).
attribute vec4 tubeTangentA;
attribute vec4 tubeTangentB;
attribute float tubeIdA;
// The relief's tile drawn under it: where it lies across it (0…1 east and south), and its
// group (-1: none), whose texels say what the relief draws there now (GeoTubeReliefGroups).
attribute vec3 tubeReliefA;
attribute vec3 tubeReliefB;
#ifdef GEO_TUBE_DRAPE
// Two texels a group: its tile's slot and blend (x, y); where it lies in the tile it blends
// from, and that tile's slot.
uniform highp sampler2D uTubeReliefGroups;
#endif

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec4 vTubeColor;
// Where its axis lies, and how high over the sea, for the water over it.
varying vec3 vTubeWorld;
varying float vTubeHeight;

vec4 tubeStyle(int index) {
  int width = int(uTubeStylesWidth);
  return texelFetch(uTubeStyles, ivec2(index % width, index / width), 0);
}

float tubeGround(vec4 node, vec3 relief) {
  #ifdef GEO_TUBE_DRAPE
  if(relief.z < -0.5)
    return node.w;
  int i = 2 * int(relief.z + 0.5);
  int width = GEO_TUBE_GROUPS_WIDTH;
  vec4 own = texelFetch(uTubeReliefGroups, ivec2(i % width, i / width), 0);
  vec4 from = texelFetch(uTubeReliefGroups, ivec2((i + 1) % width, (i + 1) / width), 0);
  return geoTileReliefGround(vec4(0.0, 0.0, 1.0, own.x), from, own.y, relief.xy, node.w);
  #else
  return node.w;
  #endif
}

void main() {
  // The node A ends a part: no segment from it.
  if(tubeTangentA.w > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  int id = int(tubeIdA + 0.5);
  vTubeColor = tubeStyle(2 * id);
  float diameter = tubeStyle(2 * id + 1).x;

  float t = vertex.y;
  // Revealed as a map, on the sea where it lies under it.
  float heightA = geoRevealHeight(tubeGround(tubeNodeA, tubeReliefA) + tubeNodeA.z);
  float heightB = geoRevealHeight(tubeGround(tubeNodeB, tubeReliefB) + tubeNodeB.z);
  vec2 offset = mix(tubeNodeA.xy, tubeNodeB.xy, t);
  float height = mix(heightA, heightB, t);
  vec3 axis = mix(globeGeodetic(tubeNodeA.xy, heightA), globeGeodetic(tubeNodeB.xy, heightB), t);

  // East, north and up where it lies: the tangent from them, and a frame normal across it,
  // the side of it facing up (a pipe never stands upright).
  vec3 up = globeUpAt(axis);
  vec3 east = globeGeodeticEast(offset);
  east = normalize(east - up * dot(east, up));
  vec3 north = cross(up, east);
  vec3 way = normalize(mix(tubeTangentA.xyz, tubeTangentB.xyz, t));
  vec3 tangent = normalize(east * way.x + north * way.y + up * way.z);
  vec3 side = normalize(cross(tangent, up));
  vec3 normal = normalize(cross(side, tangent));
  vec3 k = tubeRingDirection(normal, tangent, tubeRingAngle(vertex.x));

  // As built, exaggerated; never under the least pixels across. Resting on the ground: its
  // axis a radius over it.
  float radius = 0.5 * diameter * uTubeExaggeration;
  float least = tubeMinWorldRadius(viewMatrix * vec4(axis, 1.0), 0.5 * uTubeMinPixels, resolution);
  radius = max(radius, least);
  axis += up * radius;
  vTubeWorld = axis;
  vTubeHeight = height;

  vec3 world = axis + k * radius;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(mat3(viewMatrix) * k);
  gl_Position = projectionMatrix * mvPosition;
  // ⚠️ Far off, clip z rounds past w in fp32 and clips vertices at random (as the relief's).
  gl_Position.z = min(gl_Position.z, gl_Position.w * (1.0 - 1e-7));
  #include <logdepthbuf_vertex>
}

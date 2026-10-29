// A minimap's relief (Minimap): the ground at each pixel from the relief's tiles — the
// stage's own, its layers merged over its base in longitude and latitude — read through an
// index of the tiles drawn (../../../Scenery/shaders/relief-atlas.glsl), looked as the stage
// looks them (SceneryReliefLooks: a colour ramp by height, contours), then either:
// - shaded: the colour, lit from the upper left of the screen by the ground's slope, which
//   the four neighbouring pixels give, or
// - outline: the coast and the contours as lines over a faint land fill.
// Drawn on its own canvas, on demand, so it costs nothing while the view holds still.

#include <common>
#include ../../../Scenery/shaders/relief-atlas.glsl
#include ../../../../sdk/materials/shaderLib/color-ramp.glsl
#include ../../../../sdk/materials/shaderLib/contours.glsl

// The looks (SceneryReliefLooks), as relief-fragment.glsl reads them: a column per look, 0
// the relief's own and 1 + i its layer i's.
uniform highp sampler2D uReliefLook;
uniform sampler2D uColorRamps;

// x: 0 shaded, 1 outline; y: the slope's vertical exaggeration; z: how strongly the slope
// shades, 0 to 1; w: ground metres a device pixel spans.
uniform vec4 uMinimap;
// The sea's colour where the look's seabed takes it, darkened with depth.
uniform vec3 uSeaColor;
// Outline mode: the line's colour, and the land's fill (rgb, alpha).
uniform vec3 uOutlineColor;
uniform vec4 uOutlineFill;

// The latitude of the view's middle, degrees: vGeo's is relative to it.
uniform float uMinimapLatitude;
// How much of this view is drawn (two cross-fade as one projection gives way to another),
// and its projection: 0 the scene's map, 1 Web Mercator, 2 Equal Earth, 3 Lambert conformal
// conic (map-projections.ts).
uniform float uMinimapOpacity;
uniform int uMinimapProjection;
// 3, Lambert conformal conic: its cone (map-projections.ts `cone`): n, R·F, the radius of
// its origin's parallel and of the parallel it ends at.
uniform vec4 uMinimapCone;

varying vec2 vGeo;
varying vec2 vPlane;
varying vec3 vDir;

// 1 where the longitude and latitude are worked out per pixel from the plane (a wide view in
// a projection, whose grid cells may straddle the map's edge at the antimeridian), 0 where
// they are interpolated across the grid (precise in 32 bits, and a close view never
// reaches the edge).
uniform float uMinimapExact;
// 1 where the scene's map is seen wide: the longitude and latitude from the direction the
// grid interpolates (vDir), longitude from the middle's.
uniform float uMinimapSphere;

// Equal Earth's polynomial (map-projections.ts).
#define EE_A1 1.340264
#define EE_A2 -0.081106
#define EE_A3 0.000893
#define EE_A4 0.003796
#define EE_RADIUS 6371008.8
#define MERCATOR_RADIUS 6378137.0

// Equal Earth's y / R at parametric latitude t, and its derivative.
float eeY(float t) {
  float t2 = t * t;
  float t6 = t2 * t2 * t2;
  return t * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2));
}
float eeDY(float t) {
  float t2 = t * t;
  float t6 = t2 * t2 * t2;
  return EE_A1 + 3.0 * EE_A2 * t2 + t6 * (7.0 * EE_A3 + 9.0 * EE_A4 * t2);
}
// The parametric latitude at y / R, by Newton's method.
float eeTheta(float yr) {
  float maxT = asin(sqrt(3.0) / 2.0);
  float t = clamp(yr / EE_A1, -maxT, maxT);
  for(int i = 0; i < 6; i++)
    t = clamp(t - (eeY(t) - yr) / eeDY(t), -maxT, maxT);
  return t;
}

// The longitude (from the map's central meridian: the middle's) and latitude, degrees, at a
// point of the projection's plane (east and south).
vec2 minimapLonLat(vec2 plane) {
  vec2 p = vec2(plane.x, -plane.y);
  if(uMinimapProjection == 1)
    return degrees(vec2(p.x / MERCATOR_RADIUS, 2.0 * atan(exp(p.y / MERCATOR_RADIUS)) - 0.5 * PI));
  if(uMinimapProjection == 3) {
    float n = uMinimapCone.x;
    float s = n < 0.0 ? -1.0 : 1.0;
    vec2 fromApex = vec2(s * p.x, s * (uMinimapCone.z - p.y));
    float r = max(length(fromApex), 1e-3);
    float theta = atan(fromApex.x, fromApex.y);
    float latitude = s * (2.0 * atan(pow(abs(uMinimapCone.y) / r, 1.0 / abs(n))) - 0.5 * PI);
    return degrees(vec2(theta / n, latitude));
  }
  float t = eeTheta(p.y / EE_RADIUS);
  float lambda = 3.0 * (p.x / EE_RADIUS) * eeDY(t) / (2.0 * sqrt(3.0) * max(cos(t), 1e-6));
  return degrees(vec2(lambda, asin(clamp(sin(t) * 2.0 / sqrt(3.0), -1.0, 1.0))));
}

// How much of the pixel lies on the projection's map (its plane's point east and south):
// all of it in the scene's own; Web Mercator's square; Equal Earth's rounded outline; a
// Lambert cone's wedge.
float minimapOnMap(vec2 plane) {
  if(uMinimapProjection == 0)
    return 1.0;
  vec2 p = vec2(plane.x, -plane.y);
  vec2 pixel = max(fwidth(p), vec2(1e-3));
  if(uMinimapProjection == 1) {
    vec2 edge = vec2(MERCATOR_RADIUS * PI) - abs(p);
    return clamp(min(edge.x / pixel.x, edge.y / pixel.y) + 0.5, 0.0, 1.0);
  }
  if(uMinimapProjection == 3) {
    // About the cone's apex: within its wedge of 180° either side of the meridian (an arc
    // of the radius there), and short of where it ends.
    float n = uMinimapCone.x;
    float s = n < 0.0 ? -1.0 : 1.0;
    vec2 fromApex = vec2(s * p.x, s * (uMinimapCone.z - p.y));
    float r = length(fromApex);
    float theta = atan(fromApex.x, fromApex.y);
    float size = length(pixel);
    float wedge = (abs(n) * PI - abs(theta)) * r / size;
    float end = (abs(uMinimapCone.w) - r) / size;
    return clamp(min(wedge, end) + 0.5, 0.0, 1.0);
  }
  float maxT = asin(sqrt(3.0) / 2.0);
  float t = eeTheta(p.y / EE_RADIUS);
  float topY = eeY(maxT) * EE_RADIUS;
  float edgeX = EE_RADIUS * 2.0 * sqrt(3.0) * PI * cos(t) / (3.0 * eeDY(t));
  float inside = min((edgeX - abs(p.x)) / pixel.x, (topY - abs(p.y)) / pixel.y);
  return clamp(inside + 0.5, 0.0, 1.0);
}

// How far below the sea the seabed's colour darkens to half.
#define MINIMAP_BED_DARKEN 600.0
// The light's direction on the screen: from the upper left, a little above it.
#define MINIMAP_LIGHT normalize(vec3(-0.55, 0.65, 0.6))

vec4 minimapLookRow(int look, int row) {
  return texelFetch(uReliefLook, ivec2(look, row), 0);
}

// The colour of ground `height` metres from the sea's level by look `look`.
vec3 minimapAlbedo(float height, int look) {
  vec4 landRamp = minimapLookRow(look, 0);
  vec4 bedRamp = minimapLookRow(look, 2);
  vec3 land = landRamp.x >= 0.0 ? colorRampAt(uColorRamps, landRamp, height) : minimapLookRow(look, 1).rgb;
  vec3 bed = uSeaColor;
  if(bedRamp.x >= 0.0)
    bed = colorRampAt(uColorRamps, bedRamp, height);
  else if(bedRamp.x > -1.5)
    bed *= mix(1.0, 0.5, smoothstep(0.0, MINIMAP_BED_DARKEN, -height));
  return mix(bed, land, smoothstep(-1.0, 1.0, height));
}

// How much of the pixel look `look`'s contour lines cover, for ground `height` whose gradient
// on the screen is `gHeight` (metres a pixel); none on the seabed if the look says so.
float minimapContourCover(float height, float gHeight, int look) {
  vec4 lines = minimapLookRow(look, 3);
  if(lines.x <= 0.0 || (height < 0.0 && lines.w < 0.5))
    return 0.0;
  return contourCover(height, gHeight, lines.x, lines.y, lines.z);
}

// The ground at `geo` (degrees east and north of the view's middle), in the index's
// coordinates: east and south, the longitude the short way round.
vec4 minimapGround(vec2 geo) {
  float east = geo.x - 360.0 * floor((geo.x + 180.0) / 360.0);
  return reliefAtlasGround(vec2(east, -geo.y));
}

void main() {
  // Before anything branches: the outline's derivatives.
  float onMap = minimapOnMap(vPlane);
  // Where the pixel lies, degrees east and north of the middle: per pixel from the plane in
  // a wide projected view, else as the grid interpolates it.
  vec2 geo = vGeo;
  if(uMinimapExact > 0.5 && uMinimapProjection != 0)
    geo = minimapLonLat(vPlane) - vec2(0.0, uMinimapLatitude);
  else if(uMinimapSphere > 0.5) {
    vec3 d = normalize(vDir);
    geo = degrees(vec2(atan(d.y, d.x), asin(clamp(d.z, -1.0, 1.0)))) - vec2(0.0, uMinimapLatitude);
  }
  // A pixel's step across and up the screen, in degrees; the short way round where the
  // longitude wraps between neighbouring pixels.
  vec2 stepX = dFdx(geo);
  vec2 stepY = dFdy(geo);
  stepX.x -= 360.0 * floor(stepX.x / 360.0 + 0.5);
  stepY.x -= 360.0 * floor(stepY.x / 360.0 + 0.5);

  vec4 ground = minimapGround(geo);
  float east = minimapGround(geo + stepX).x;
  float west = minimapGround(geo - stepX).x;
  float north = minimapGround(geo + stepY).x;
  float south = minimapGround(geo - stepY).x;

  float height = ground.x;
  int look = int(ground.z + 0.5);
  // Metres up per pixel across and up the screen: from the tiles' normals, filtered between
  // their nodes as the stage shades them, so the slope runs on smoothly across cells and
  // tiles; the heights' own differences are faceted, a cell to a facet.
  vec3 n = reliefAtlasNormal(vec2(geo.x - 360.0 * floor((geo.x + 180.0) / 360.0), -geo.y));
  vec2 rise = vec2(-n.x, n.z) / max(n.y, 1e-3);
  float metresPerDegree = 6371008.8 * PI / 180.0;
  vec2 toMetres = vec2(cos(radians(uMinimapLatitude + geo.y)), 1.0) * metresPerDegree;
  vec2 slope = vec2(dot(rise, stepX * toMetres), dot(rise, stepY * toMetres));
  float cover = smoothstep(0.0, 0.5, ground.y);
  float lines = minimapContourCover(height, length(slope), look);

  vec4 color;
  if(uMinimap.x < 0.5) {
    vec3 albedo = minimapAlbedo(height, look);
    vec4 shade = minimapLookRow(look, 4);
    albedo = contourShade(albedo, lines, int(minimapLookRow(look, 1).w + 0.5), shade.w, shade.rgb);
    vec2 gradient = slope / uMinimap.w * uMinimap.y;
    vec3 normal = normalize(vec3(-gradient, 1.0));
    float lit = dot(normal, MINIMAP_LIGHT) / MINIMAP_LIGHT.z;
    color = vec4(albedo * mix(1.0, clamp(lit, 0.25, 1.6), uMinimap.z), cover);
  } else {
    bool land = height >= 0.0;
    bool coast = land != (east >= 0.0) || land != (west >= 0.0) || land != (north >= 0.0) || land != (south >= 0.0);
    float line = coast ? 1.0 : lines * 0.6;
    float fill = land ? uOutlineFill.a : 0.0;
    vec3 rgb = mix(uOutlineFill.rgb, uOutlineColor, line);
    color = vec4(rgb, mix(fill, 1.0, line) * cover);
  }

  gl_FragColor = color;
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
  // Premultiplied, and added to the other view's while they cross-fade.
  gl_FragColor *= uMinimapOpacity * onMap;
}

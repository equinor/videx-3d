// GeoGraticule's lines, a GeoTileLayer drawn from its shader alone: latitude and longitude,
// the UTM zones and the nautical time zones, as graticule.glsl draws them where the pixel
// lies on the Earth (vGeoTileWorld, before the lift), over nothing — premultiplied,
// see-through between the lines. Drawn with no swaps (transition 0), so this sample is
// taken once, where control flow is uniform, as graticuleAt's derivatives need.

#include ../../../sdk/materials/shaderLib/globe.glsl
#include ../../../sdk/materials/shaderLib/graticule.glsl

vec4 geoTileSample(float slot, vec2 uv, float texelMetres) {
  return graticuleLines(graticuleAt(vGeoTileWorld));
}

// A geographic tile (sdk/tiles/geo-tile-keys) drawn on the globe (globe.glsl, included
// first): where a point of it lies on the conformal sphere, as globeGeodetic's offset.
// Per tile, from geoTileOffsets: its west and east edges' longitude, and its north
// edge's, middle's and south edge's latitude, each from the globe's disc's centre.
// Shared by the relief's tiles and the overlays' (GeoPolygons).

// A latitude along the tile, `t` from its north edge (0) to its south edge (1): the
// quadratic through its three, which neighbours along an edge share.
float geoTileLatitudeAt(vec3 chi, float t) {
  return chi.x * (1.0 - t) * (1.0 - 2.0 * t) + chi.y * 4.0 * t * (1.0 - t) + chi.z * t * (2.0 * t - 1.0);
}

// The point `t` across the tile (0…1 east, 0…1 south) as globeGeodetic's offset (Δχ, ΔΛ).
vec2 geoTileOffset(vec2 longitude, vec3 chi, vec2 t) {
  return vec2(geoTileLatitudeAt(chi, t.y), mix(longitude.x, longitude.y, t.x));
}

// The point `t` across a tile, across the ancestor it blends from (TileTransitions): `from`
// its offset there and its size (tileOffsetIn).
vec2 geoTileFrom(vec3 from, vec2 t) {
  return from.xy + t * from.z;
}

// A geographic layer revealed as a map (its `reveal`, LayerReveal): lifted to the sea's level
// where it lies below it, and drawn over the sea (drawOverSea). x: 1 while revealed; y how
// much of it shows while it fades in, else 1.
uniform vec2 uGeoReveal;

// `height` metres over the sea's level, lifted to it while revealed.
float geoRevealHeight(float height) {
  return uGeoReveal.x > 0.5 ? max(height, 0.0) : height;
}

#ifdef GEO_REVEAL_FRAGMENT
// Whether an opaque fragment is left out while the layer fades in: a screen door (a 4x4
// Bayer pattern), so what is drawn stays opaque and keeps writing depth.
bool geoRevealDoor() {
  if(uGeoReveal.y >= 1.0)
    return false;
  const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  return (bayer[p.x + 4 * p.y] + 0.5) / 16.0 >= uGeoReveal.y;
}
#endif

// A tube's silhouette darkened toward `shadingColor` (Trajectory, GeoTubes), with analytic
// anti-aliasing. The darkening is ADDITIVE toward the rim: `pow(1 - N·V, falloff)` is
// exactly 0 where the tube faces the view (N·V = 1) for any strength and falloff, so the
// tube's middle keeps exactly its colour — important where colour encodes data. `fwidth`
// floors N·V so the dark rim cannot shrink below about a pixel (no jagged fringe), and the
// clamp keeps thin, far tubes flat at their colour.

// How far toward the shading colour, 0…`strength`, at a fragment with `normal` seen along
// `viewPosition` (both view space; the view position from the fragment toward the camera).
float tubeRimDarken(vec3 normal, vec3 viewPosition, float strength, float falloff) {
  float ndv = clamp(dot(normalize(normal), normalize(viewPosition)), 0.0, 1.0);
  float ndvAA = clamp(max(ndv, fwidth(ndv)), 0.0, 1.0);
  return strength * pow(1.0 - ndvAA, falloff);
}

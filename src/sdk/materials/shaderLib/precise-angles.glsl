// Angles to about a metre on the Earth. On Windows WebGL runs through ANGLE on Direct3D, whose
// shader compiler expands atan and asin into short polynomials: measured 1.1e-5 rad off for atan
// and 2.5e-5 for asin, 35 m and 160 m on the Earth (the ground maps were drawn that far off,
// 2026-11-15). Fine for a direction, not for a place: wherever an angle becomes a latitude or
// a longitude, take it from here. One Newton step on sin and cos, the GPU's own and good to a
// few parts in 10^7, takes the error to that. For a latitude from a unit direction `d`,
// atanPrecise(d.z, length(d.xy)), not asin(d.z): exact up to the poles. Included once.
#ifndef PRECISE_ANGLES_GLSL
#define PRECISE_ANGLES_GLSL

// atan(y, x), to a few parts in 10^7 radians; that of (0, 0) as atan's.
float atanPrecise(float y, float x) {
  float a = atan(y, x);
  float c = cos(a);
  float s = sin(a);
  // (x, y) turned back by `a`: its length along, and the small part across it.
  float along = x * c + y * s;
  return along > 0.0 ? a + (y * c - x * s) / along : a;
}

#endif

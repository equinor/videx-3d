// A tube drawn segment by segment in the vertex shader (Trajectory, GeoTubes): each
// instance a segment between two centreline points, each ring vertex placed in the vertex
// shader, so the radius is a uniform and never rebuilds geometry. Include after <common>.

// `v` rotated by -angle about the unit `axis` (Rodrigues).
vec3 tubeRotateAboutAxis(vec3 v, vec3 axis, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return v * c - cross(axis, v) * s + axis * (dot(axis, v) * (1.0 - c));
}

// The angle of a ring vertex `around` (0…1) the tube.
float tubeRingAngle(float around) {
  return (0.5 - around) * 2.0 * PI;
}

// A ring vertex's outward direction, which is its normal too: the frame's `normal` turned
// by `angle` about the unit `tangent`. A frame normal that turns least along the tube keeps
// the ring from twisting.
vec3 tubeRingDirection(vec3 normal, vec3 tangent, float angle) {
  return normalize(tubeRotateAboutAxis(normal, tangent, angle));
}

// The world radius that `pixels` span on screen at `mvAxis` (a view-space point), for
// perspective (clip.w = -viewZ) and orthographic (clip.w = 1) projections alike: a floor
// that keeps a thin tube a line of that width from afar. 0 pixels is 0: no floor, the tube
// as built, thinning out of sight with distance as any geometry does.
float tubeMinWorldRadius(vec4 mvAxis, float pixels, vec2 resolution) {
  vec4 clipAxis = projectionMatrix * mvAxis;
  return (pixels * 2.0 / resolution.y) * clipAxis.w / projectionMatrix[1][1];
}

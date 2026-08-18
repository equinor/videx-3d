// Exact "which side of the fence" for a point in the stack's XZ.
//
// ⭐⭐ The curve is CARRIED, not reconstructed. A rasterised signed distance cannot
// reproduce a polyline: bilinear is exact for distance to a straight line, but at
// every vertex the true field has a crease that the interpolant rounds off. Measured
// on real wells that put the discard boundary up to 0.6 of a cell away from the cut
// face, which reads as gaps and a wavy edge along the seam. Reading the segments
// themselves puts it back on the polyline to float precision.
//
// ⚠️⚠️ Must match `fenceSideAt` in `fence-segments.ts`. They are the same algorithm
// over the same data rather than two reconstructions, so this is a much weaker thing
// to keep true than the width parity contract it replaces.
//
// ⚠️ `texture2D` with NEAREST filtering rather than `texelFetch`: these shaders are
// compiled as GLSL ES 1.00 by three's material pipeline, where `texelFetch` does not
// exist. The UVs below are texel CENTRES, so the read is still exact.

uniform sampler2D fenceCells;      // r: offset, g: count
uniform sampler2D fenceSegments;   // xy: start, zw: end
uniform vec4 fenceIndex;           // xy: origin, z: reach (metres per cell), w: removed cross sign
uniform vec2 fenceIndexSize;       // index grid, in cells
uniform vec2 fenceSegmentsSize;    // segment texture, in texels

#ifndef FENCE_MAX_SEGMENTS
#define FENCE_MAX_SEGMENTS 32
#endif

vec4 fenceTexel(sampler2D map, float at, vec2 size) {
  float row = floor(at / size.x);
  float column = at - row * size.x;
  return texture2D(map, (vec2(column, row) + 0.5) / size);
}

// The flood-fill sign, which is the only thing that knows the global topology.
// ⚠️ NEAREST, not the smoothed read a depth map wants: this is a SIGN, and
// interpolating it is exactly the mistake being corrected.
float fenceCoarse(sampler2D map, mat3 toUv, vec2 size, vec2 xz) {
  vec2 texel = (toUv * vec3(xz, 1.0)).xy * size - 0.5;
  vec2 at = clamp(floor(texel + 0.5), vec2(0.0), size - 1.0);
  return texture2D(map, (at + 0.5) / size).r;
}

// Signed distance to the fence in metres, NEGATIVE on the half being removed.
//
// ⭐⭐ POSITION from the segments, SIDE from the flood fill. The boundary is where the
// distance is zero, so it is the polyline exactly; but which half a point is in is a
// question about the whole curve, and only the fill knows the answer.
//
// ⚠️⚠️ Taking the side from the nearest segment's cross product is wrong wherever the
// curve doubles back: the two arms of a hairpin are oppositely oriented, so inside the
// pocket the local answer contradicts the topology — and being near the curve, it would
// win. That left a sliver of block on the wrong side along every tight hairpin and every
// sharp trace-to-run-out corner.
//
// ⚠️ ONE return. The D3D translator warns "potentially uninitialized" on early returns
// out of a loop-bearing function, and a warning about undefined behaviour in the one
// function the whole cut depends on is not worth carrying.
float fenceSide(sampler2D map, mat3 toUv, vec2 size, vec2 xz) {
  float result = fenceCoarse(map, toUv, size, xz);
  vec2 cell = floor((xz - fenceIndex.xy) / fenceIndex.z);
  bool inside = cell.x >= 0.0 && cell.y >= 0.0
    && cell.x < fenceIndexSize.x && cell.y < fenceIndexSize.y;

  if (inside) {
    vec2 record = fenceTexel(fenceCells, cell.y * fenceIndexSize.x + cell.x, fenceIndexSize).rg;
    float count = record.g;
    if (count >= 0.5) {
      float best = 1e30;
      float bestCross = 0.0;
      for (int i = 0; i < FENCE_MAX_SEGMENTS; i++) {
        if (float(i) >= count) break;
        vec4 segment = fenceTexel(fenceSegments, record.r + float(i), fenceSegmentsSize);
        vec2 a = segment.xy;
        vec2 edge = segment.zw - a;
        float len2 = dot(edge, edge);
        float t = len2 > 0.0 ? clamp(dot(xz - a, edge) / len2, 0.0, 1.0) : 0.0;
        vec2 delta = xz - (a + edge * t);
        float d2 = dot(delta, delta);
        if (d2 < best) {
          best = d2;
          bestCross = edge.x * (xz.y - a.y) - edge.y * (xz.x - a.x);
        }
      }

      float d = sqrt(best);
      // Past `reach` the nearest segment may not be listed in this cell, and the point
      // is more than a cell from the curve anyway, so the fill is safe and right there.
      if (d <= fenceIndex.z) {
        // ⭐ The nearest segment's own side. Inside a hairpin pocket both arms give the
        // SAME answer — they are oppositely oriented, so "left of" one is "left of" the
        // other — which is why the local rule is safe and stepping out to read the fill
        // is not: that step can land past the opposite arm.
        float orientation = bestCross >= 0.0 ? 1.0 : -1.0;
        result = orientation == fenceIndex.w ? -d : d;
      }
    }
  }
  return result;
}

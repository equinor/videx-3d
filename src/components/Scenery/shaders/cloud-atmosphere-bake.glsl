// The 3D clouds' density volume (CloudAtmosphereVolume, scenery-cloud-atmosphere.ts), a slice at a
// time, from the atmosphere (sdk/weather/atmosphere.ts) over a square domain about the local
// weather's middle, at a time: the air's own condensate where it is saturated, and the bubbles of
// the thermals rising through it, living their lives (thermalCondensate), as listed and binned on
// the CPU (sdk/weather/thermal-field.ts); each as cloud-atmosphere-bubble.glsl takes it in.
//
// Out: r the condensate over BAKE_CONDENSATE (g/kg).

precision highp float;
precision highp int;
precision highp sampler3D;

#include ./cloud-atmosphere-bubble.glsl

// Texels along the volume's sides.
uniform vec3 uBakeSize;
// The heights it spans (m): where the atmosphere's clouds can lie (atmosphereExtent).
uniform vec2 uBakeExtent;
// The bubbles' bins (binBubbles): (start, count) each, east fastest, then up, then north; the
// bins across and up, and their sides (m). The bins' lists of bubbles, BAKE_INDEX_ROW to a row.
uniform sampler2D uBakeBins;
uniform sampler2D uBakeIndices;
uniform vec4 uBakeBinGrid;

#define BAKE_CONDENSATE 3.0
#define BAKE_INDEX_ROW 2048
// The domain's edge, where the clouds thin out (m).
#define BAKE_EDGE 1500.0

void main() {
  vec3 uvw = vec3(gl_FragCoord.xy, uBakeDomain.y + 0.5) / uBakeSize;
  vec2 xy = (uvw.xy - 0.5) * 2.0 * uBakeDomain.x;
  float z = mix(uBakeExtent.x, uBakeExtent.y, uvw.z);
  float voxel = 2.0 * uBakeDomain.x / uBakeSize.x;
  float edge = smoothstep(0.0, BAKE_EDGE, uBakeDomain.x - max(abs(xy.x), abs(xy.y)));
  float table = bakeTableHeight(xy, z, voxel);
  float around = bakeAir(xy, z, table);

  // The bubbles about the point, from its bin: as much as any has of its water over the air's.
  float excess = 0.0;
  ivec3 bin = clamp(ivec3(floor(vec3((xy + uBakeDomain.x) / uBakeBinGrid.z, uvw.z * uBakeBinGrid.y))), ivec3(0), ivec3(int(uBakeBinGrid.x) - 1, int(uBakeBinGrid.x) - 1, int(uBakeBinGrid.y) - 1));
  vec2 list = texelFetch(uBakeBins, ivec2(bin.x, bin.y * int(uBakeBinGrid.y) + bin.z), 0).rg;
  int start = int(list.x);
  int count = int(list.y);
  // The whole list, however long: cut short, a bin would leave out bubbles its neighbours take in,
  // and the clouds would crease along its faces.
  for(int i = 0; i < count; i++) {
    int k = start + i;
    int index = int(texelFetch(uBakeIndices, ivec2(k % BAKE_INDEX_ROW, k / BAKE_INDEX_ROW), 0).r);
    excess = max(excess, bakeBubble(index, xy, z, table, around, voxel));
  }
  float condensate = max(around + excess, 0.0);
  gl_FragColor = vec4(condensate * edge / BAKE_CONDENSATE, 0.0, 0.0, 1.0);
}

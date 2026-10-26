// The Earth's curve as the sky lowers its sea and the stage's relief: nothing over the flat
// disc the sea keeps (uSkyFlat: its centre, world, and radius), and beyond it half the
// curvature times the run past the disc squared, the run measured along the level from the
// camera to the point and the disc's edge from where that line leaves it.
// `SkyMaterial.curveDrop` is its twin on the CPU. ⚠️ Assumes the default `up` (+Y).

uniform float uSkyCurvature; // 1 over the Earth's radius; 0 for a flat sea
uniform vec4 uSkyFlat;

// How far below the level the curved sea lies at world X/Z, as the camera sees it.
float skyCurveDrop(vec2 xz) {
  if(uSkyCurvature <= 0.0)
    return 0.0;
  vec2 level = xz - cameraPosition.xz;
  float run = length(level);
  if(run <= 1e-3)
    return 0.0;
  float inner = uSkyFlat.w - dot(cameraPosition.xz - uSkyFlat.xz, level / run);
  float past = max(run - inner, 0.0);
  return 0.5 * uSkyCurvature * past * past;
}
